import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { Tabs, Card, Button, Space, App, Switch, Tag, Drawer, Input, List, Typography } from "antd"
import {
  ReloadOutlined, ThunderboltOutlined, SettingOutlined,
  SearchOutlined, RobotOutlined, VideoCameraOutlined,
  ExportOutlined, EditOutlined, FileTextOutlined, FileProtectOutlined, CloudDownloadOutlined,
} from "@ant-design/icons"
import { trendsApi } from "../services/api"

const { Text } = Typography

const FILE_ICONS = {
  ai_interests: "🎯",
  frequency_words: "🔑",
  ai_analysis_prompt: "📊",
  topic_to_video_prompt: "🎬",
}

export default function TrendBoard() {
  const navigate = useNavigate()
  const [crawling, setCrawling] = useState(false)
  const [filterMethod, setFilterMethod] = useState("ai")
  const [reportKey, setReportKey] = useState(0)
  const [topicKey, setTopicKey] = useState(0)
  const [topicGenerating, setTopicGenerating] = useState(false)
  const [crawlerLoading, setCrawlerLoading] = useState(false)
  const [crawlerResults, setCrawlerResults] = useState({ weixin: [], rmw_health: [], cifst: [], cfsn: [], kepu: [] })
  const [activeTab, setActiveTab] = useState("topics")
  const [topics, setTopics] = useState([])
  const [topicsGeneratedAt, setTopicsGeneratedAt] = useState(null)

    const loadCrawlerData = async () => {
    try {
      const data = await trendsApi.list(null, 500)
      if (Array.isArray(data)) {
        setCrawlerResults({
          weixin: data.filter(t => t.platform === "weixin"),
          rmw_health: data.filter(t => t.platform === "rmw_health"),
          cifst: data.filter(t => t.platform === "cifst"),
          cfsn: data.filter(t => t.platform === "cfsn"),
          kepu: data.filter(t => t.platform === "kepu"),
        })
      }
    } catch (e) { /* ignore */ }
  }
  useEffect(() => {
    if (activeTab === "crawler") loadCrawlerData()
  }, [activeTab])

  const loadTopics = async () => {
    try {
      const data = await trendsApi.getTopicData()
      setTopics(data.topics || [])
      setTopicsGeneratedAt(data.generated_at)
    } catch (e) { setTopics([]) }
  }
  useEffect(() => { loadTopics() }, [topicKey])
  const [configFiles, setConfigFiles] = useState([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingFile, setEditingFile] = useState(null)
  const [editingContent, setEditingContent] = useState("")
  const [saving, setSaving] = useState(false)
  const { message } = App.useApp()

  const loadConfig = async () => {
    try {
      const [files, methodRes] = await Promise.all([
        trendsApi.listConfigFiles(), trendsApi.getMethod(),
      ])
      // Only show config files relevant to TrendBoard (filter out TextToVideo/Competitor prompts)
      const trendKeys = ["ai_interests", "frequency_words", "ai_analysis_prompt", "topic_to_video_prompt"]
      setConfigFiles((files.files || []).filter(f => trendKeys.includes(f.key)))
      setFilterMethod(methodRes.method || "ai")
    } catch (e) { /**/ }
  }
  useEffect(() => { loadConfig() }, [])

  const openEditor = async (file) => {
    setEditingFile(file)
    setDrawerOpen(true)
    try {
      const res = await trendsApi.getConfigFile(file.key)
      setEditingContent(res.content || "")
    } catch (e) {
      setEditingContent("")
    }
  }

  const handleSave = async () => {
    if (!editingFile) return
    setSaving(true)
    try {
      await trendsApi.saveConfigFile(editingFile.key, editingContent)
      message.success(`${editingFile.filename} 已保存`)
      setDrawerOpen(false)
    } catch (e) { message.error(e.message) }
    finally { setSaving(false) }
  }

  const handleCrawl = async () => {
    setCrawling(true)
    try {
      const start = await trendsApi.crawl()
      if (!start.ok) { message.error(start.error || "启动失败"); setCrawling(false); return }
      message.info("采集已启动，约需2-3分钟...", 2)
      let n = 0
      while (n < 90) {
        await new Promise(r => setTimeout(r, 3000))
        const st = await trendsApi.crawlStatus(); n++
        if (!st.running) {
          if (st.result && st.result.ok) {
            message.success("采集完成，正在生成选题...")
            setReportKey(k => k + 1)
            await generateTopics()
          } else {
            message.error("采集失败: " + (st.result ? st.result.error : "未知错误"))
          }
          break
        }
      }
    } catch (e) { message.error("采集失败: " + e.message) }
    finally { setCrawling(false) }
  }

  const handleCrawlAll = async () => {
    setCrawlerLoading(true)
    try {
      const results = await Promise.all([
        trendsApi.refreshWechat().catch(e => ({ ok: false, count: 0, error: e.message })),
        trendsApi.refreshRmwHealth().catch(e => ({ ok: false, count: 0, error: e.message })),
        trendsApi.refreshCifst().catch(e => ({ ok: false, count: 0, error: e.message })),
        trendsApi.refreshCfsn().catch(e => ({ ok: false, count: 0, error: e.message })),
        trendsApi.refreshKepu().catch(e => ({ ok: false, count: 0, error: e.message })),
      ])
      const data = await trendsApi.list(null, 500)
      if (Array.isArray(data)) {
        const wx = data.filter(t => t.platform === "weixin")
        const rmw = data.filter(t => t.platform === "rmw_health")
        const cifst = data.filter(t => t.platform === "cifst")
        const cfsn = data.filter(t => t.platform === "cfsn")
        const kepu = data.filter(t => t.platform === "kepu")
        setCrawlerResults({ weixin: wx, rmw_health: rmw, cifst: cifst, cfsn: cfsn, kepu: kepu })
        message.success(`微信热文 ${wx.length} | 人民网 ${rmw.length} | 食科学会 ${cifst.length} | 食品安全网 ${cfsn.length} | 科普中国 ${kepu.length}`)
      }
    } catch (e) {
      message.error("爬取失败: " + e.message)
    } finally {
      setCrawlerLoading(false)
    }
  }

  const generateTopics = async () => {
    setTopicGenerating(true)
    try {
      const start = await trendsApi.generateTopics()
      if (!start.ok) { message.warning(start.error || "无法启动"); setTopicGenerating(false); return }
      let n = 0
      while (n < 30) {
        await new Promise(r => setTimeout(r, 2000))
        const st = await trendsApi.topicStatus(); n++
        if (!st.running) {
          if (st.result && st.result.ok) {
            message.success(`选题生成完成，共 ${st.result.count} 个`)
            setTopicKey(k => k + 1)
          } else {
            setTopicKey(k => k + 1)
          }
          break
        }
      }
    } catch (e) { message.error(e.message) }
    finally { setTopicGenerating(false) }
  }

  const handleMethodToggle = async (checked) => {
    const method = checked ? "ai" : "keyword"
    try {
      await trendsApi.setMethod(method)
      setFilterMethod(method)
      message.success(`已切换，下次采集生效`)
    } catch (e) { message.error(e.message) }
  }

  const tabs = [
    {
      key: "config", label: "采集配置", icon: <SettingOutlined />,
      children: (
        <div style={{ maxWidth: 700 }}>
          <Card size="small" style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <Text strong>检索方式</Text>
                <div style={{ color: "#888", fontSize: 13, marginTop: 2 }}>
                  <Tag color={filterMethod === "ai" ? "blue" : "orange"}>
                    {filterMethod === "ai" ? "AI 语义检索" : "关键词匹配"}
                  </Tag>
                  切换后下次采集生效
                </div>
              </div>
              <Space>
                <span style={{ color: "#888", fontSize: 13 }}>关键词</span>
                <Switch checked={filterMethod === "ai"} onChange={handleMethodToggle}
                  checkedChildren={<RobotOutlined />} unCheckedChildren="K" />
                <span style={{ color: "#888", fontSize: 13 }}>AI</span>
              </Space>
            </div>
          </Card>

          <Card size="small" title={<span><FileProtectOutlined style={{ marginRight: 6 }} />配置文件</span>}>
            <List
              dataSource={configFiles}
              renderItem={file => (
                <List.Item
                  extra={
                    <Button size="small" icon={<EditOutlined />} onClick={() => openEditor(file)}>编辑</Button>
                  }
                >
                  <List.Item.Meta
                    avatar={<span style={{ fontSize: 20 }}>{FILE_ICONS[file.key] || "📄"}</span>}
                    title={<span style={{ fontFamily: "monospace", fontSize: 13 }}>{file.filename}</span>}
                    description={<span style={{ fontSize: 12 }}>{file.description} · {file.exists ? `${(file.size / 1024).toFixed(1)} KB` : "不存在"}</span>}
                  />
                </List.Item>
              )}
            />
          </Card>
        </div>
      ),
    },
    {
      key: "report", label: "热点报告", icon: <SearchOutlined />,
      children: (
        <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 180px)" }}>
          <div style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Tag color={filterMethod === "ai" ? "blue" : "orange"}>
              {filterMethod === "ai" ? "AI 检索" : "关键词检索"}
            </Tag>
            <Space>
              <Button size="small" type="primary" icon={<ReloadOutlined />} onClick={handleCrawl} loading={crawling}>重新采集</Button>
              <Button size="small" icon={<ReloadOutlined />} onClick={() => setReportKey(k => k + 1)}>刷新</Button>
              <Button size="small" icon={<ExportOutlined />} onClick={() => window.open(trendsApi.getReport(), "_blank")}>新窗口</Button>
            </Space>
          </div>
          <iframe key={reportKey} src={trendsApi.getReport()}
            style={{ flex: 1, width: "100%", border: "1px solid #dce9e7", borderRadius: 12, background: "#fff" }}
            title="TrendRadar 报告" />
        </div>
      ),
    },
    {
      key: "crawler", label: "热点爬虫", icon: <CloudDownloadOutlined />,
      children: (
        <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 180px)", overflow: "auto" }}>
          <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
            <span style={{ color: "#666", fontSize: 13 }}>
              一键爬取微信热文、人民网健康、食科学会、食品安全网、科普中国
            </span>
            <Button type="primary" icon={<CloudDownloadOutlined />} onClick={handleCrawlAll} loading={crawlerLoading}>
              全部爬取
            </Button>
          </div>

          <div style={{ display: "flex", gap: 16, flex: 1, overflow: "auto" }}>
            {[
              { key: "weixin", label: "微信热文", color: "#07c160" },
              { key: "rmw_health", label: "人民网健康", color: "#e60012" },
              { key: "cifst", label: "食科学会", color: "#1a73e8" },
              { key: "cfsn", label: "食品安全网", color: "#fa8c16" },
              { key: "kepu", label: "科普中国", color: "#722ed1" },
            ].map(src => (
              <Card
                key={src.key}
                size="small"
                title={<span style={{ color: src.color }}>{src.label} ({crawlerResults[src.key]?.length || 0})</span>}
                style={{ flex: 1, minWidth: 200 }}
                bodyStyle={{ padding: 0, maxHeight: "calc(100vh - 300px)", overflow: "auto" }}
              >
                {crawlerResults[src.key]?.length > 0 ? (
                  <List
                    size="small"
                    dataSource={crawlerResults[src.key]}
                    renderItem={(item, i) => (
                      <List.Item style={{ padding: "8px 12px" }}>
                        <a href={item.url} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
                          {i + 1}. {item.title}
                        </a>
                      </List.Item>
                    )}
                  />
                ) : (
                  <div style={{ padding: 20, textAlign: "center", color: "#999", fontSize: 13 }}>
                    暂无数据，点击"全部爬取"
                  </div>
                )}
              </Card>
            ))}
          </div>
        </div>
      ),
    },
    {
      key: "topics", label: "视频选题", icon: <VideoCameraOutlined />,
      children: (
        <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 180px)", overflow: "auto" }}>
          <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
            <span style={{ color: "#666", fontSize: 13 }}>
              🎬 热搜 → 视频选题
              {topicsGeneratedAt && <span style={{ color: "#aaa", fontSize: 12, marginLeft: 8 }}>生成于 {topicsGeneratedAt}</span>}
            </span>
            <Space>
              <Button size="small" icon={<ReloadOutlined />} onClick={generateTopics} loading={topicGenerating}>重新生成</Button>
            </Space>
          </div>

          {topics.length === 0 ? (
            <Card style={{ textAlign: "center", padding: 40, color: "#999" }}>
              <p style={{ fontSize: 16, marginBottom: 8 }}>🎬 暂无选题</p>
              <p style={{ fontSize: 13 }}>请先采集热点，然后生成选题</p>
            </Card>
          ) : (
            topics.map((t, i) => (
              <Card
                key={i}
                size="small"
                style={{ marginBottom: 12 }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{t.video_topic}</span>
                    <span style={{ fontSize: 11, color: '#888' }}>{t.duration || 30}s</span>
                  </div>
                  <Button
                    type="primary"
                    size="small"
                    icon={<ThunderboltOutlined />}
                    onClick={() => navigate("/text-to-video?topic=" + i)}
                  >
                    去制作
                  </Button>
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                  {t.source_title && (
                    <div style={{ display: 'flex', marginBottom: 2 }}>
                      <span style={{ color: '#888', width: 56, flexShrink: 0 }}>来源</span>
                      <span><a href={t.source_url} target="_blank" rel="noreferrer" style={{ color: '#4f46e5' }}>{t.source_title}</a></span>
                    </div>
                  )}
                  <div style={{ display: 'flex', marginBottom: 2 }}>
                    <span style={{ color: '#888', width: 56, flexShrink: 0 }}>钩子</span>
                    <span>
                      {t.hook_type && <Tag color="orange" style={{fontSize:10}}>{t.hook_type}</Tag>}
                      <span style={{color:'#e67e22',fontWeight:500}}>{t.hook}</span>
                    </span>
                  </div>
                  <div style={{ display: 'flex', marginBottom: 2 }}>
                    <span style={{ color: '#888', width: 56, flexShrink: 0 }}>角度</span>
                    <span style={{ color: '#555' }}>{t.angle}</span>
                  </div>
                  {t.content_outline?.length > 0 && (
                    <div style={{ display: 'flex', marginBottom: 2 }}>
                      <span style={{ color: '#888', width: 56, flexShrink: 0 }}>要点</span>
                      <span>
                        {t.content_outline.map((p, j) => (
                          <div key={j} style={{ display: 'flex', alignItems: 'flex-start', gap: 4, marginBottom: 1 }}>
                            <span style={{ width: 4, height: 4, borderRadius: 2, background: '#888', flexShrink: 0, marginTop: 7 }} />
                            <span style={{ color: '#333' }}>{p}</span>
                          </div>
                        ))}
                      </span>
                    </div>
                  )}
                  {t.target_emotion && (
                    <div style={{ display: 'flex', marginBottom: 2 }}>
                      <span style={{ color: '#888', width: 56, flexShrink: 0 }}>情绪</span>
                      <span style={{ color: '#555' }}>{t.target_emotion}</span>
                    </div>
                  )}
                  {t.product_link && t.product_link !== "纯养号内容暂不植入" && (
                    <div style={{ display: 'flex' }}>
                      <span style={{ color: '#888', width: 56, flexShrink: 0 }}>产品</span>
                      <span style={{ color: '#555' }}>{t.product_link}</span>
                    </div>
                  )}
                </div>
              </Card>
            ))
          )}
        </div>
      ),
    },
  ]

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}><ThunderboltOutlined style={{ marginRight: 8 }} />选题看板</h2>
        
      </div>
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabs} />

      <Drawer
        title={editingFile ? <span><FileTextOutlined style={{ marginRight: 8 }} />{editingFile.filename}</span> : "编辑文件"}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={700}
        extra={
          <Button type="primary" onClick={handleSave} loading={saving}>保存</Button>
        }
      >
        <Input.TextArea
          value={editingContent}
          onChange={e => setEditingContent(e.target.value)}
          style={{ fontFamily: "monospace", fontSize: 13, height: "calc(100vh - 180px)" }}
          placeholder="输入文件内容..."
        />
      </Drawer>
    </div>
  )
}

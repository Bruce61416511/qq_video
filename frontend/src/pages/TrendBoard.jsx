import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { Tabs, Card, Button, Space, App, Switch, Tag, Drawer, Input, List, Typography } from "antd"
import {
  ReloadOutlined, ThunderboltOutlined, SettingOutlined,
  SearchOutlined, RobotOutlined, VideoCameraOutlined,
  ExportOutlined, EditOutlined, FileTextOutlined, FileProtectOutlined,
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
  const [activeTab, setActiveTab] = useState("topics")
  const [topics, setTopics] = useState([])
  const [topicsGeneratedAt, setTopicsGeneratedAt] = useState(null)

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
      setConfigFiles(files.files || [])
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
                title={
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{
                      width: 22, height: 22, borderRadius: 11,
                      background: "#005d50", color: "#fff",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, fontWeight: 700, flexShrink: 0
                    }}>{i + 1}</span>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{t.video_topic}</span>
                    <span style={{ fontSize: 11, color: "#888" }}>{t.duration || 30}s</span>
                  </div>
                }
                extra={
                  <Button
                    type="primary"
                    size="small"
                    icon={<ThunderboltOutlined />}
                    onClick={() => navigate("/text-to-video?topic=" + i)}
                  >
                    去制作
                  </Button>
                }
              >
                <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                  <tbody>
                    {t.source_title && (
                      <tr>
                        <td style={{ color: "#888", padding: "2px 8px 2px 0", whiteSpace: "nowrap", verticalAlign: "top", width: 70 }}>来源</td>
                        <td style={{ padding: "2px 0" }}>
                          <a href={t.source_url} target="_blank" rel="noreferrer" style={{ color: "#4f46e5" }}>{t.source_title}</a>
                        </td>
                      </tr>
                    )}
                    <tr>
                      <td style={{ color: "#888", padding: "2px 8px 2px 0", whiteSpace: "nowrap", verticalAlign: "top", width: 70 }}>标签</td>
                      <td style={{ padding: "2px 0" }}>
                        {t.hook_type && <Tag color="orange" style={{ fontSize: 11 }}>{t.hook_type}</Tag>}
                        {t.target_emotion && <Tag color="default" style={{ fontSize: 11 }}>{t.target_emotion}</Tag>}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ color: "#e67e22", fontWeight: 600, padding: "4px 8px 4px 0", whiteSpace: "nowrap", verticalAlign: "top", width: 70 }}>黄金3秒</td>
                      <td style={{ padding: "4px 0", fontWeight: 500, color: "#333" }}>{t.hook}</td>
                    </tr>
                    <tr>
                      <td style={{ color: "#888", padding: "2px 8px 2px 0", whiteSpace: "nowrap", verticalAlign: "top", width: 70 }}>角度</td>
                      <td style={{ padding: "2px 0", color: "#555" }}>{t.angle}</td>
                    </tr>
                    {t.content_outline?.length > 0 && (
                      <tr>
                        <td style={{ color: "#888", padding: "4px 8px 4px 0", whiteSpace: "nowrap", verticalAlign: "top", width: 70 }}>要点</td>
                        <td style={{ padding: "4px 0" }}>
                          {t.content_outline.map((p, j) => (
                            <div key={j} style={{ display: "flex", alignItems: "flex-start", padding: "3px 0", gap: 6 }}>
                              <span style={{ width: 4, height: 4, borderRadius: 2, background: "#005d50", flexShrink: 0, marginTop: 7 }} />
                              <span style={{ fontSize: 12, lineHeight: "18px", color: "#333" }}>{p}</span>
                            </div>
                          ))}
                        </td>
                      </tr>
                    )}
                    {t.product_link && t.product_link !== "纯养号内容暂不植入" && (
                      <tr>
                        <td style={{ color: "#888", padding: "4px 8px 2px 0", whiteSpace: "nowrap", verticalAlign: "top", width: 70 }}>产品</td>
                        <td style={{ padding: "4px 0", fontSize: 12, color: "#666" }}>{t.product_link}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
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
        <Button type="primary" icon={<ReloadOutlined />} onClick={handleCrawl} loading={crawling}>重新采集</Button>
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
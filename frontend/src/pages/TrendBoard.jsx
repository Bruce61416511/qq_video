import { useState, useEffect } from "react"
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
  const [crawling, setCrawling] = useState(false)
  const [filterMethod, setFilterMethod] = useState("ai")
  const [reportKey, setReportKey] = useState(0)
  const [topicKey, setTopicKey] = useState(0)
  const [topicGenerating, setTopicGenerating] = useState(false)
  const [activeTab, setActiveTab] = useState("config")
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
            style={{ flex: 1, width: "100%", border: "1px solid #e8e8e8", borderRadius: 8, background: "#fff" }}
            title="TrendRadar 报告" />
        </div>
      ),
    },
    {
      key: "topics", label: "视频选题", icon: <VideoCameraOutlined />,
      children: (
        <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 180px)" }}>
          <div style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: "#888", fontSize: 13 }}>🎬 热搜 → 视频选题 · Top 5 高相关热搜自动生成</span>
            <Space>
              <Button size="small" icon={<ReloadOutlined />} onClick={generateTopics} loading={topicGenerating}>重新生成</Button>
              <Button size="small" icon={<ExportOutlined />} onClick={() => window.open(trendsApi.getTopicReport(), "_blank")}>新窗口</Button>
            </Space>
          </div>
          <iframe key={topicKey} src={trendsApi.getTopicReport()}
            style={{ flex: 1, width: "100%", border: "1px solid #e8e8e8", borderRadius: 8, background: "#fff" }}
            title="视频选题" />
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
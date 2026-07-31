import { useState, useEffect } from "react"
import { Tabs, Card, Button, Input, Table, Space, App, Popconfirm, Drawer, Tag, Upload, Progress } from "antd"
import {
  ThunderboltOutlined, SettingOutlined, FileProtectOutlined,
  EditOutlined, FileTextOutlined, DeleteOutlined, SaveOutlined, UploadOutlined,
  EyeOutlined, PlusOutlined
} from "@ant-design/icons"
import { trendsApi } from "../services/api"

const BASE = "http://localhost:8000/api"

const { TextArea } = Input

export default function CompetitorAnalysis() {
  const [activeTab, setActiveTab] = useState("analyze")
  const [source, setSource] = useState("")
  const [videoFile, setVideoFile] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeProgress, setAnalyzeProgress] = useState(0)
  const [result, setResult] = useState(null)
  const [templateName, setTemplateName] = useState("")
  const [saving, setSaving] = useState(false)
  const [templates, setTemplates] = useState([])
  const [loadingTemplates, setLoadingTemplates] = useState(false)
  const [viewTemplate, setViewTemplate] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingFile, setEditingFile] = useState(null)
  const [editingContent, setEditingContent] = useState("")
  const [savingConfig, setSavingConfig] = useState(false)
  const { message } = App.useApp()

  const loadTemplates = async () => {
    setLoadingTemplates(true)
    try {
      const res = await fetch(BASE + "/media/competitor-templates")
      const data = await res.json()
      setTemplates(Array.isArray(data) ? data : [])
    } catch (e) { }
    finally { setLoadingTemplates(false) }
  }

  useEffect(() => { loadTemplates() }, [])

  const handleAnalyze = async () => {
    if (!source.trim()) { message.warning("请输入竞品视频描述"); return }
    setAnalyzing(true)
    try {
      const res = await fetch(BASE + "/media/analyze-competitor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: source.trim() }),
      })
      const data = await res.json()
      if (data.error) { message.error(data.error); return }
      setResult(data)
      setTemplateName(data.style || "未命名模板")
      message.success("拆解完成！")
    } catch (e) {
      message.error("拆解失败: " + e.message)
    } finally { setAnalyzing(false) }
  }

  const handleSave = async () => {
    if (!result) return
    setSaving(true)
    try {
      await fetch(BASE + "/media/competitor-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: templateName || "未命名模板",
          source: source.trim(),
          framework: JSON.stringify(result),
        }),
      })
      message.success("已保存到模板库")
      loadTemplates()
    } catch (e) { message.error("保存失败") }
    finally { setSaving(false) }
  }

  const handleDelete = async (id) => {
    try {
      await fetch(BASE + "/media/competitor-templates/" + id, { method: "DELETE" })
      message.success("已删除")
      loadTemplates()
    } catch (e) { message.error("删除失败") }
  }

  const handleView = async (template) => {
    try {
      const res = await fetch(BASE + "/media/competitor-templates/" + template.id)
      const data = await res.json()
      setViewTemplate(data)
    } catch (e) { }
  }

  const openConfigEditor = async (file) => {
    setEditingFile(file)
    setDrawerOpen(true)
    try {
      const res = await trendsApi.getConfigFile(file.key)
      setEditingContent(res.content || "")
    } catch (e) { setEditingContent("") }
  }

  const handleSaveConfig = async () => {
    if (!editingFile) return
    setSavingConfig(true)
    try {
      await trendsApi.saveConfigFile(editingFile.key, editingContent)
      message.success(editingFile.filename + " 已保存")
      setDrawerOpen(false)
    } catch (e) { message.error(e.message) }
    finally { setSavingConfig(false) }
  }

  const configFiles = [
    { key: "competitor_analysis_prompt", filename: "competitor_analysis_prompt.txt", description: "竞品拆解提示词：分析竞品视频输出框架" },
  ]

  const shotColumns = [
    { title: "镜号", dataIndex: "index", width: 50, render: (v) => <Tag color="green">镜{v}</Tag> },
    { title: "时长", dataIndex: "duration", width: 60, render: (v) => v + "s" },
    { title: "类型", dataIndex: "type", width: 80, render: (v) => <Tag>{v}</Tag> },
    { title: "画面描述", dataIndex: "desc", ellipsis: true },
    { title: "配音文案", dataIndex: "script", ellipsis: true },
  ]

  const templateColumns = [
    { title: "名称", dataIndex: "name", key: "name", width: 200 },
    { title: "来源", dataIndex: "source", key: "source", ellipsis: true, width: 250, render: (t) => t?.substring(0, 60) || "-" },
    { title: "创建时间", dataIndex: "created_at", key: "created_at", width: 160 },
    {
      title: "操作", key: "action", width: 200,
      render: (_, record) => (
        <Space>
          <Button size="small" icon={<EyeOutlined />} onClick={() => handleView(record)}>查看</Button>
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const tabs = [
    {
      key: "analyze", label: "拆解视频", icon: <ThunderboltOutlined />,
      children: (
        <div style={{ maxWidth: 900 }}>
          <Card size="small" title="上传竞品视频" style={{ marginBottom: 16 }}>
            <Upload
              beforeUpload={file => { setVideoFile(file); return false }}
              accept="video/*"
              maxCount={1}
              onRemove={() => setVideoFile(null)}
              fileList={videoFile ? [{
                uid: "-1", name: videoFile.name,
                status: "done", size: videoFile.size,
              }] : []}
            >
              <Button icon={<UploadOutlined />} size="large">
                选择视频文件
              </Button>
            </Upload>
            {videoFile && (
              <div style={{ marginTop: 12, color: "#52676a", fontSize: 13 }}>
                已选择：{videoFile.name} (约{(videoFile.size / 1024 / 1024).toFixed(1)}MB)
              </div>
            )}
          </Card>

          <Card size="small" title="视频描述（可选）" style={{ marginBottom: 16 }}>
            <TextArea
              rows={2}
              value={source}
              onChange={e => setSource(e.target.value)}
              placeholder="补充说明竞品风格、目标人群等..."
            />
          </Card>

          {analyzing && (
            <div style={{ textAlign: "center", padding: 24 }}>
              <Progress percent={analyzeProgress} status="active" strokeColor="#005d50" />
              <p style={{ marginTop: 8, color: "#8c8c8c" }}>正在拆解视频，请稍候...</p>
            </div>
          )}

          <div style={{ textAlign: "right" }}>
            <Button
              type="primary"
              size="large"
              icon={<ThunderboltOutlined />}
              onClick={async () => {
                if (!videoFile) { message.warning("请先上传视频"); return }
                setAnalyzing(true)
                setAnalyzeProgress(30)
                try {
                  const form = new FormData()
                  form.append("file", videoFile)
                  setAnalyzeProgress(60)
                  const res = await fetch(BASE + "/media/analyze-competitor-video", {
                    method: "POST", body: form,
                  })
                  const data = await res.json()
                  setAnalyzeProgress(100)
                  if (data.error) { message.error(data.error); return }
                  setResult(data)
                  setTemplateName(data.style || "未命名模板")
                  message.success("拆解完成！共" + (data.frame_count || "?") + "帧，" + (data.duration || "?") + "s")
                } catch (e) {
                  message.error("拆解失败: " + e.message)
                } finally { setAnalyzing(false); setAnalyzeProgress(0) }
              }}
              loading={analyzing}
              disabled={!videoFile}
            >
              AI 拆解
            </Button>
          </div>

          {result && !result.error && (
            <Card size="small" title="拆解结果">
              <div style={{ marginBottom: 12 }}>
                <Tag color="blue">风格：{result.style}</Tag>
                <Tag color="green">时长：{result.total_duration}s</Tag>
                {result.hook_pattern && <Tag color="orange">{result.hook_pattern}</Tag>}
                {result.bgm_emotion && <Tag color="purple">BGM: {result.bgm_emotion}</Tag>}
              </div>
              {result.shots && (
                <Table
                  columns={shotColumns}
                  dataSource={result.shots}
                  rowKey="index"
                  pagination={false}
                  size="small"
                />
              )}
              {result.highlights && (
                <div style={{ marginTop: 12 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>✨ 亮点：</span>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 13 }}>
                    {result.highlights.map((h, i) => <li key={i}>{h}</li>)}
                  </ul>
                </div>
              )}
              <div style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center" }}>
                <Input
                  style={{ flex: 1 }}
                  value={templateName}
                  onChange={e => setTemplateName(e.target.value)}
                  placeholder="模板名称"
                />
                <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>
                  保存到模板库
                </Button>
              </div>
            </Card>
          )}
          {result?.error && (
            <Card size="small"><div style={{ color: "#c53030" }}>{result.error}</div></Card>
          )}
        </div>
      ),
    },
    {
      key: "templates", label: "模板管理", icon: <FileProtectOutlined />,
      children: (
        <div style={{ maxWidth: 900 }}>
          <Table
            columns={templateColumns}
            dataSource={templates}
            rowKey="id"
            loading={loadingTemplates}
            pagination={{ pageSize: 15 }}
            locale={{ emptyText: "暂无模板，去拆解视频页创建" }}
          />
          {viewTemplate && (
            <Drawer
              title={viewTemplate.name}
              open={!!viewTemplate}
              onClose={() => setViewTemplate(null)}
              width={700}
            >
              <p style={{ color: "#8c8c8c", fontSize: 13, marginBottom: 12 }}>
                来源：{viewTemplate.source?.substring(0, 100) || "-"}
              </p>
              {(() => {
                try {
                  const fw = typeof viewTemplate.framework === "string"
                    ? JSON.parse(viewTemplate.framework) : viewTemplate.framework
                  return (
                    <div>
                      <Space style={{ marginBottom: 12 }}>
                        {fw.style && <Tag color="blue">{fw.style}</Tag>}
                        {fw.total_duration && <Tag color="green">{fw.total_duration}s</Tag>}
                        {fw.hook_pattern && <Tag color="orange">{fw.hook_pattern}</Tag>}
                      </Space>
                      {fw.shots && (
                        <Table columns={shotColumns} dataSource={fw.shots} rowKey="index" pagination={false} size="small" />
                      )}
                    </div>
                  )
                } catch (e) {
                  return <pre style={{ fontSize: 12 }}>{viewTemplate.framework}</pre>
                }
              })()}
            </Drawer>
          )}
        </div>
      ),
    },
    {
      key: "config", label: "拆解配置", icon: <SettingOutlined />,
      children: (
        <div style={{ maxWidth: 700 }}>
          <Card size="small" title={<span><FileProtectOutlined style={{ marginRight: 6 }} />提示词文件</span>}>
            <table style={{ width: "100%", fontSize: 13 }}>
              <tbody>
                {configFiles.map(file => (
                  <tr key={file.key} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={{ padding: "10px 0" }}>
                      <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{file.filename}</span>
                      <div style={{ fontSize: 12, color: "#8c8c8c" }}>{file.description}</div>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Button size="small" icon={<EditOutlined />} onClick={() => openConfigEditor(file)}>
                        编辑
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      ),
    },
  ]

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#142528", letterSpacing: "-0.3px" }}>
          <ThunderboltOutlined style={{ marginRight: 10, color: "#005d50" }} />
          爆款拆解
        </h2>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "#52676a" }}>
          分析竞品视频的分镜框架，保存为可复用模板
        </p>
      </div>
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabs} />
      <Drawer
        title={editingFile ? <span><FileTextOutlined style={{ marginRight: 8 }} />{editingFile.filename}</span> : "编辑文件"}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={700}
        extra={<Button type="primary" onClick={handleSaveConfig} loading={savingConfig}>保存</Button>}
      >
        <TextArea
          value={editingContent}
          onChange={e => setEditingContent(e.target.value)}
          style={{ fontFamily: "monospace", fontSize: 13, height: "calc(100vh - 180px)" }}
          placeholder="输入文件内容..."
        />
      </Drawer>
    </div>
  )
}

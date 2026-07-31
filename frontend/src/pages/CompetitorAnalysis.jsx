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

  const parseFramework = (f) => {
    if (!f) return {}
    try { return typeof f === "string" ? JSON.parse(f) : f } catch { return {} }
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
    { title: "时长", dataIndex: "duration", width: 55, render: (v) => v + "s" },
    { title: "类型", dataIndex: "shot_type", width: 70, render: (v) => <Tag>{v}</Tag> },
    { title: "景别", dataIndex: "shot_size", width: 55, render: (v) => v && <Tag color="blue">{v}</Tag> },
    { title: "运镜", dataIndex: "camera_movement", width: 60, render: (v) => v && <Tag color="purple">{v}</Tag> },
    { title: "画面描述", dataIndex: "visual_desc", ellipsis: true },
    { title: "配音文案", dataIndex: "script", ellipsis: true },
  ]

  const templateColumns = [
    { title: "名称", dataIndex: "name", key: "name", width: 180, render: (t, r) => {
      const fw = parseFramework(r.framework)
      return <div><div style={{fontWeight:500}}>{t}</div><div style={{fontSize:12,color:"#888"}}>{fw?.style ? fw.style + ' · ' : ''}{fw?.total_duration ? fw.total_duration + 's' : ''}{fw?.shots ? ' · ' + fw.shots.length + '镜' : ''}</div></div>
    }},
    { title: "叙事", dataIndex: "framework", key: "narrative", width: 120, render: (f) => {
      const fw = parseFramework(f)
      return <Tag>{fw?.narrative_arc || '-'}</Tag>
    }},
    { title: "钩子", dataIndex: "framework", key: "hook", ellipsis: true, render: (f) => {
      const fw = parseFramework(f)
      return fw?.hook?.hook_text || '-'
    }},
    { title: "创建时间", dataIndex: "created_at", key: "created_at", width: 150 },
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
          {viewTemplate && (() => {
            let fw = {}
            try {
              fw = typeof viewTemplate.framework === "string"
                ? JSON.parse(viewTemplate.framework) : viewTemplate.framework
            } catch (e) {}

            return (
            <Drawer
              title={<div><span style={{marginRight:12}}>{viewTemplate.name}</span><Tag color="blue">{fw.style || "-"}</Tag><Tag>{fw.total_duration || "?"}s · {(fw.shots||[]).length}镜</Tag></div>}
              open={!!viewTemplate}
              onClose={() => setViewTemplate(null)}
              width={780}
            >
              {/* 整体信息 */}
              <Card size="small" title="基本信息" style={{ marginBottom: 12 }}>
                <Space wrap size={[8,8]}>
                  <Tag color="blue">风格：{fw.style || "-"}</Tag>
                  <Tag color="purple">情绪：{fw.tone || "-"}</Tag>
                  <Tag color="cyan">叙事：{fw.narrative_arc || "-"}</Tag>
                  <Tag>时长：{fw.total_duration || "?"}s</Tag>
                </Space>
                {fw.target_audience && (
                  <div style={{marginTop:8,fontSize:12,color:"#666"}}>
                    目标人群：{fw.target_audience.age_range && <Tag color="geekblue" style={{fontSize:11}}>{fw.target_audience.age_range}岁</Tag>}
                    {fw.target_audience.gender && fw.target_audience.gender !== "不限" && <Tag style={{fontSize:11}}>{fw.target_audience.gender}</Tag>}
                    {fw.target_audience.interests?.map((v,i) => <Tag key={i} color="green" style={{fontSize:11}}>{v}</Tag>)}
                    {fw.target_audience.pain_points?.length > 0 && <div style={{marginTop:4}}>痛点：{fw.target_audience.pain_points.join(" · ")}</div>}
                  </div>
                )}
              </Card>

              {/* 钩子 */}
              {fw.hook && (
                <Card size="small" title={<span><ThunderboltOutlined style={{color:"#faad14"}} /> 开头钩子</span>} style={{ marginBottom: 12 }}>
                  <Space wrap>
                    <Tag color="orange">{fw.hook.hook_type}</Tag>
                  </Space>
                  <div style={{marginTop:6}}>
                    <p style={{fontSize:13,color:"#333",margin:"4px 0"}}><strong>口播：</strong>{fw.hook.hook_text || "-"}</p>
                    <p style={{fontSize:13,color:"#666",margin:"4px 0"}}><strong>画面：</strong>{fw.hook.hook_visual || "-"}</p>
                  </div>
                </Card>
              )}

              {/* 分镜 */}
              {fw.shots && fw.shots.length > 0 && (
                <Card size="small" title={<span><FileTextOutlined /> 分镜拆解（{fw.shots.length}镜）</span>} style={{ marginBottom: 12 }}>
                  <Table columns={shotColumns} dataSource={fw.shots} rowKey="index" pagination={false} size="small" scroll={{x:700}} />
                </Card>
              )}

              {/* 音频 */}
              {fw.audio && (
                <Card size="small" title="音频设计" style={{ marginBottom: 12 }}>
                  <Space wrap>
                    <Tag color="magenta">BGM：{fw.audio.bgm_style || "-"}</Tag>
                  </Space>
                  {fw.audio.bgm_emotion_curve && <p style={{fontSize:13,color:"#666",margin:"6px 0 0"}}>情绪曲线：{fw.audio.bgm_emotion_curve}</p>}
                  {fw.audio.sound_effects?.length > 0 && (
                    <div style={{marginTop:4}}>
                      {fw.audio.sound_effects.map((se, i) => (
                        <Tag key={i} color="gold" style={{fontSize:11}}>
                          {typeof se === "string" ? se : `${se.time}s ${se.effect}`}
                        </Tag>
                      ))}
                    </div>
                  )}
                </Card>
              )}

              {/* 流量策略 */}
              {fw.traffic_strategy && (
                <Card size="small" title="流量策略" style={{ marginBottom: 12 }}>
                  {fw.traffic_strategy.retention_tactics?.length > 0 && (
                    <div style={{marginBottom:6}}>
                      <span style={{fontSize:12,color:"#888"}}>留存技巧：</span>
                      {fw.traffic_strategy.retention_tactics.map((v,i) => <Tag key={i} color="blue" style={{fontSize:11}}>{v}</Tag>)}
                    </div>
                  )}
                  <Space wrap>
                    {fw.traffic_strategy.cta_type && <Tag color="red">CTA：{fw.traffic_strategy.cta_type}</Tag>}
                    {fw.traffic_strategy.cta_placement > 0 && <Tag>出现在镜{fw.traffic_strategy.cta_placement}</Tag>}
                  </Space>
                  {fw.traffic_strategy.hashtag_suggestions?.length > 0 && (
                    <div style={{marginTop:6}}>
                      {fw.traffic_strategy.hashtag_suggestions.map((v,i) => <Tag key={i} color="green" style={{fontSize:11}}>{v}</Tag>)}
                    </div>
                  )}
                </Card>
              )}

              {/* 可复制要素 */}
              {fw.replicability && (
                <Card size="small" title="可复制要素" style={{ marginBottom: 12 }}>
                  {fw.replicability.winning_factors?.length > 0 && (
                    <div style={{marginBottom:8}}>
                      <div style={{fontSize:12,fontWeight:500,marginBottom:4}}>爆款因子</div>
                      {fw.replicability.winning_factors.map((v,i) => <Tag key={i} color="volcano" style={{fontSize:11,marginBottom:4}}>{i+1}. {v}</Tag>)}
                    </div>
                  )}
                  {fw.replicability.copyable_elements?.length > 0 && (
                    <div style={{marginBottom:8}}>
                      <div style={{fontSize:12,fontWeight:500,marginBottom:4}}>可直接复用</div>
                      {fw.replicability.copyable_elements.map((v,i) => <Tag key={i} color="purple" style={{fontSize:11,marginBottom:4}}>{i+1}. {v}</Tag>)}
                    </div>
                  )}
                  {fw.replicability.improvement_opportunities?.length > 0 && (
                    <div>
                      <div style={{fontSize:12,fontWeight:500,marginBottom:4}}>改进空间</div>
                      {fw.replicability.improvement_opportunities.map((v,i) => <Tag key={i} color="default" style={{fontSize:11,marginBottom:4}}>{i+1}. {v}</Tag>)}
                    </div>
                  )}
                </Card>
              )}

            </Drawer>
            )
          })()}
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

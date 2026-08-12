import React, { useState, useEffect } from 'react'
import { Card, Input, Button, InputNumber, Space, Tag, Alert, Progress, message, Steps, Typography, Tabs, Modal, Drawer, List } from 'antd'
import { EditOutlined, ThunderboltOutlined, DeleteOutlined, AudioOutlined, PictureOutlined, ArrowLeftOutlined, CopyOutlined, VideoCameraOutlined, PlayCircleOutlined, DownloadOutlined, SettingOutlined, FileTextOutlined } from '@ant-design/icons'

const { TextArea } = Input
const { Text, Title } = Typography

const stepItems = [
  { title: "话题输入" },
  { title: "旁白分镜" },
  { title: "配音合成" },
  { title: "分镜提示词" },
  { title: "生成视频片段" },
  { title: "合成导出" },
]

export default function KepuTab() {
  const [current, setCurrent] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingStep, setLoadingStep] = useState("")
  const [topic, setTopic] = useState("")
  const [shotCount, setShotCount] = useState(3)
  const [narrations, setNarrations] = useState([])
  const [ttsResults, setTtsResults] = useState([])
  const [scenes, setScenes] = useState([])
  const [editingIndex, setEditingIndex] = useState(-1)
  const [editText, setEditText] = useState("")
  const [editingSceneIdx, setEditingSceneIdx] = useState(-1)
  const [editSceneText, setEditSceneText] = useState("")
  const [loaded, setLoaded] = useState(false)
  const [concatVisible, setConcatVisible] = useState(false)
  const [concatText, setConcatText] = useState("")
  const [clips, setClips] = useState([])
  const [composeResult, setComposeResult] = useState(null)
  const [composeLoading, setComposeLoading] = useState(false)
  const [clipEditIdx, setClipEditIdx] = useState(-1)
  const [clipEditText, setClipEditText] = useState("")
  const [activeTab, setActiveTab] = useState("studio")
  const [configDrawerOpen, setConfigDrawerOpen] = useState(false)
  const [editingFile, setEditingFile] = useState(null)
  const [editingContent, setEditingContent] = useState("")
  const [savingConfig, setSavingConfig] = useState(false)

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("kepu_state"))
      if (saved) {
        if (saved.topic) setTopic(saved.topic)
        if (saved.shotCount) setShotCount(saved.shotCount)
        if (saved.current !== undefined) setCurrent(saved.current)
        if (saved.narrations) setNarrations(saved.narrations)
        if (saved.ttsResults) setTtsResults(saved.ttsResults)
        if (saved.scenes) setScenes(saved.scenes)
        if (saved.clips) setClips(saved.clips)
        if (saved.composeResult) setComposeResult(saved.composeResult)
      }
    } catch (e) {}
    setLoaded(true)
  }, [])

  useEffect(() => {
    if (!loaded) return
    const state = { topic, shotCount, current, narrations, ttsResults, scenes, clips, composeResult }
    localStorage.setItem("kepu_state", JSON.stringify(state))
  }, [loaded, topic, shotCount, current, narrations, ttsResults, scenes, clips, composeResult])

  const handleReset = () => {
    setTopic("")
    setShotCount(3)
    setNarrations([])
    setTtsResults([])
    setScenes([])
    setClips([])
    setComposeResult(null)
    setCurrent(0)
    localStorage.removeItem("kepu_state")
    message.info("已清除全部数据")
  }

  const handleGenerateScript = async () => {
    if (!topic.trim()) { message.warning("请输入话题"); return }
    setLoading(true)
    setLoadingStep("正在生成剧本...")
    try {
      const res = await fetch("http://localhost:8000/api/kepu/script", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topic.trim(), shot_count: shotCount }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || "失败")
      const nars = [
        { voice_script: data.script.hook, stage: "hook", index: 0 },
        ...data.script.body.map((text, i) => ({ voice_script: text, stage: "body", index: i + 1 })),
        { voice_script: data.script.ending, stage: "ending", index: data.script.body.length + 1 },
      ]
      setNarrations(nars)
      setTtsResults([])
      setScenes([])
      setClips([])
      setComposeResult(null)
      setCurrent(1)
      message.success("剧本生成成功")
    } catch (e) {
      message.error("失败: " + e.message)
    } finally { setLoading(false) }
  }

  const handleEdit = (i) => { setEditingIndex(i); setEditText(narrations[i]?.voice_script || "") }
  const handleSaveEdit = (i) => {
    const u = [...narrations]; u[i] = { ...u[i], voice_script: editText }; setNarrations(u); setEditingIndex(-1)
  }
  const handleDelete = (i) => {
    if (narrations.length <= 3) { message.warning("最少3个分镜"); return }
    const u = narrations.filter((_, j) => j !== i).map((n, j) => ({ ...n, index: j }))
    setNarrations(u)
  }

  const handleConcat = () => {
    const text = narrations.filter(n => n.voice_script.trim()).map(n => n.voice_script).join("\n\n")
    setConcatText(text)
    setConcatVisible(true)
  }

  const handleTts = async () => {
    const valid = narrations.filter(n => n.voice_script.trim())
    if (!valid.length) { message.warning("无旁白内容"); return }
    setLoading(true); setLoadingStep("正在合成语音...")
    try {
      const res = await fetch("http://localhost:8000/api/kepu/tts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ narrations: valid }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || "失败")
      setTtsResults(data.segments)
      setCurrent(2)
      message.success("TTS合成成功")
    } catch (e) {
      message.error("失败: " + e.message)
    } finally { setLoading(false) }
  }

  const handleGenerateScenes = async () => {
    const valid = narrations.filter(n => n.voice_script.trim())
    if (!valid.length) { message.warning("无旁白"); return }
    const durations = ttsResults.map(r => r.duration)
    if (!durations.length) { message.warning("请先生成TTS"); return }
    setLoading(true); setLoadingStep("正在生成分镜提示词...")
    try {
      const res = await fetch("http://localhost:8000/api/kepu/scenes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ narrations: valid, durations }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || "失败")
      setScenes(data.scenes)
      setCurrent(3)
      message.success("分镜提示词生成成功")
    } catch (e) {
      message.error("失败: " + e.message)
    } finally { setLoading(false) }
  }

  const handleGenerateVideo = async () => {
    const validScenes = scenes.filter(s => s.scene_prompt?.trim())
    if (!validScenes.length) { message.warning("无分镜提示词"); return }
    const durations = ttsResults.map(r => r.duration)
    setLoading(true); setLoadingStep("正在生成视频片段 (1/" + validScenes.length + ")...")
    try {
      const res = await fetch("http://localhost:8000/api/kepu/generate-video", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenes: validScenes, durations, size: "9:16", resolution: "1080P" }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || "失败")
      setClips(data.clips || [])
      setCurrent(4)
      message.success("视频片段生成完成")
    } catch (e) {
      message.error("失败: " + e.message)
    } finally { setLoading(false) }
  }

  const handleGenerateSingleClip = async (sceneIdx) => {
    const scene = scenes[sceneIdx]
    const promptToUse = sceneIdx === clipEditIdx && clipEditText.trim() ? clipEditText.trim() : scene?.scene_prompt?.trim()
    if (!promptToUse) { message.warning("无分镜提示词"); return }
    const tts = ttsResults[sceneIdx]
    const duration = tts?.duration || 5
    const updatedClips = [...clips]
    updatedClips[sceneIdx] = { ...updatedClips[sceneIdx], status: "generating", video_path: "", error: "" }
    setClips(updatedClips)
    if (promptToUse !== scene?.scene_prompt) {
      const updatedScenes = [...scenes]
      updatedScenes[sceneIdx] = { ...updatedScenes[sceneIdx], scene_prompt: promptToUse }
      setScenes(updatedScenes)
    }
    setClipEditIdx(-1)
    try {
      const res = await fetch("http://localhost:8000/api/kepu/clip/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scene_prompt: promptToUse, duration, size: "9:16", resolution: "1080P", index: sceneIdx }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.detail || "生成失败")
      const clip = data.clip
      const newClips = [...clips]
      newClips[sceneIdx] = {
        video_path: clip.video_path || "",
        prompt: clip.prompt || "",
        status: clip.status === "done" ? "done" : "error",
        error: clip.status !== "done" ? (clip.message || "生成失败") : "",
      }
      setClips(newClips)
      message.success("分镜 " + (sceneIdx + 1) + " 生成完成")
    } catch (e) {
      const newClips = [...clips]
      newClips[sceneIdx] = { ...newClips[sceneIdx], status: "error", error: e.message }
      setClips(newClips)
      message.error("生成失败: " + e.message)
    }
  }

  const handleCompose = async () => {
    if (!clips.length) { message.warning("无视频片段"); return }
    const composedClips = clips.map((clip, i) => {
      const tts = ttsResults[i] || {}
      const nar = narrations[i] || {}
      return {
        video_path: clip.video_path || "",
        audio_path: tts.audio_path || "",
        subtitle: nar.voice_script || "",
        duration: tts.duration || 5,
      }
    })
    setComposeLoading(true)
    try {
      const res = await fetch("http://localhost:8000/api/kepu/compose", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clips: composedClips, size: "9:16", resolution: "1080P" }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || data.detail || "合成失败")
      setComposeResult(data)
      setCurrent(5)
      message.success("视频合成完成")
    } catch (e) {
      message.error("合成失败: " + e.message)
    } finally { setComposeLoading(false) }
  }

  const openConfigEditor = async (file) => {
    setEditingFile(file)
    try {
      const res = await fetch("http://localhost:8000/api/kepu/prompts")
      const data = await res.json()
      const key = file.key === "script" ? "kepu_script_prompt_txt" : "kepu_scene_prompt_txt"
      setEditingContent(data.prompts?.[key] || "")
    } catch (e) { setEditingContent("") }
    setConfigDrawerOpen(true)
  }
  const handleSaveConfig = async () => {
    if (!editingFile) return
    setSavingConfig(true)
    try {
      const key = editingFile.key === "script" ? "kepu_script_prompt_txt" : "kepu_scene_prompt_txt"
      await fetch("http://localhost:8000/api/kepu/prompts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompts: { [key]: editingContent } }),
      })
      message.success(editingFile.filename + " 已保存")
      setConfigDrawerOpen(false)
    } catch (e) { message.error("保存失败: " + e.message) }
    finally { setSavingConfig(false) }
  }

  const configFiles = [
    { key: "script", filename: "kepu_script_prompt.txt", description: "剧本提示词 - 控制旁白分镜生成逻辑" },
    { key: "scene", filename: "kepu_scene_prompt.txt", description: "分镜提示词 - 控制画面/镜头/风格" },
  ]

  const tabItems = [
    {
      key: "studio",
      label: "创作工作台",
      children: (
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
            <Title level={3} style={{ margin: 0 }}>科普创作</Title>
            <Space>
              <Button size="small" danger onClick={handleReset}>清除全部</Button>
            </Space>
          </div>

          <Steps current={current} items={stepItems} size="small" style={{ marginBottom: 24 }} onChange={(step) => setCurrent(step)} />

          {current === 0 && (
            <Card title="话题输入" style={{ maxWidth: 700 }}>
              <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                <div>
                  <Text strong>输入话题</Text>
                  <TextArea value={topic} onChange={e => setTopic(e.target.value)} placeholder="例如：酱油为什么这么鲜" rows={3} style={{ marginTop: 8 }} />
                </div>
                <div>
                  <Text strong>正文分镜数</Text>
                  <InputNumber min={3} max={8} value={shotCount} onChange={v => setShotCount(v || 3)} style={{ marginLeft: 12, width: 100 }} />
                </div>
                <Button type="primary" icon={<ThunderboltOutlined />} onClick={handleGenerateScript} loading={loading} block>
                  生成剧本
                </Button>
              </Space>
            </Card>
          )}

          {current === 1 && (
            <Card title="旁白分镜"
              extra={<Button size="small" onClick={() => setCurrent(0)} icon={<ArrowLeftOutlined />}>返回</Button>}
              style={{ maxWidth: 700 }}>
              {narrations.map((nar, i) => {
                const charCount = (nar.voice_script || "").length
                const estDuration = Math.round(charCount / 4.0 * 10) / 10
                return (
                <div key={i} style={{ marginBottom: 12, padding: 12, borderRadius: 8, border: "1px solid #e8e8e8", background: "#fafafa" }}>
                  <Space style={{ marginBottom: 4 }}>
                    <Tag color={nar.stage === "hook" ? "red" : nar.stage === "ending" ? "green" : "blue"}>
                      {nar.stage === "hook" ? "钩子" : nar.stage === "ending" ? "结尾" : "正文" + nar.index}
                    </Tag>
                    <Tag color={(nar.stage === "hook" ? charCount > 55 : charCount > 50) ? "red" : estDuration > 15 ? "orange" : "default"}>
                      {(nar.stage === "hook" ? charCount > 55 : charCount > 50) ? charCount + "字 " + estDuration + "s 超限" : estDuration > 15 ? charCount + "字 " + estDuration + "s" : charCount + "字 " + estDuration + "s"}
                    </Tag>
                    {editingIndex !== i && (
                      <Button size="small" type="text" icon={<EditOutlined />} onClick={() => handleEdit(i)} />
                    )}
                  </Space>
                  {editingIndex === i ? (
                    <div>
                      <TextArea value={editText} onChange={e => setEditText(e.target.value)} rows={3} style={{ marginBottom: 8 }} />
                      <Button size="small" type="primary" onClick={() => handleSaveEdit(i)}>保存</Button>
                      <Button size="small" style={{ marginLeft: 8 }} onClick={() => setEditingIndex(-1)}>取消</Button>
                    </div>
                  ) : (
                    <div style={{ color: "#333", fontSize: 13, lineHeight: 1.8 }}>{nar.voice_script}</div>
                  )}
                </div>
              )})}
              <Space style={{ marginTop: 8 }}>
                <Button icon={<CopyOutlined />} onClick={handleConcat}>串联旁白</Button>
                <Button type="primary" icon={<AudioOutlined />} onClick={handleTts} loading={loading}>生成TTS</Button>
              </Space>
            </Card>
          )}

          {current === 2 && (
            <Card title="配音合成"
              extra={<Button size="small" onClick={() => setCurrent(1)} icon={<ArrowLeftOutlined />}>返回</Button>}
              style={{ maxWidth: 700 }}>
              {narrations.filter(n => n.voice_script.trim()).map((nar, i) => {
                const tts = ttsResults[i]
                return (
                  <div key={i} style={{ marginBottom: 12, padding: 12, borderRadius: 8, border: "1px solid #e8e8e8", background: "#fafafa" }}>
                    <Space><Tag color="blue">第{i + 1} 分镜</Tag>{tts && <Tag color="green">{tts.duration}s</Tag>}</Space>
                    <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>{nar.voice_script.substring(0, 60)}...</div>
                    {tts?.audio_path && <audio controls style={{ width: "100%", marginTop: 8, height: 32 }} src={"http://localhost:8000" + tts.audio_path} />}
                  </div>
                )
              })}
              <Space style={{ marginTop: 8 }}>
                <Button type="primary" icon={<PictureOutlined />} onClick={handleGenerateScenes} loading={loading}>生成分镜提示词</Button>
              </Space>
            </Card>
          )}

          {current === 3 && (
            <Card title="分镜提示词"
              extra={<Button size="small" onClick={() => setCurrent(2)} icon={<ArrowLeftOutlined />}>返回</Button>}
              style={{ maxWidth: 700 }}>
              {scenes.map((scene, i) => {
                const nar = narrations[i], tts = ttsResults[i]
                return (
                  <div key={i} style={{ marginBottom: 12, padding: 12, borderRadius: 8, border: "1px solid #e8e8e8", background: "#fafafa" }}>
                    <Space style={{ marginBottom: 4 }}>
                      <Tag color="purple">第{i + 1} 分镜</Tag>
                      <Tag color="blue">{(tts?.duration || "-") + "s"}</Tag>
                      <Text type="secondary" style={{ fontSize: 12 }}>{scene.stage}</Text>
                    </Space>
                    <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>旁白: {(nar?.voice_script?.substring(0, 50) || "")}...</div>
                    {editingSceneIdx === i ? (
                      <div>
                        <TextArea value={editSceneText} onChange={e => setEditSceneText(e.target.value)} rows={4} style={{ fontSize: 12, marginBottom: 4 }} />
                        <Button size="small" type="primary" onClick={() => { const u = [...scenes]; u[i] = { ...u[i], scene_prompt: editSceneText }; setScenes(u); setEditingSceneIdx(-1) }}>保存</Button>
                        <Button size="small" style={{ marginLeft: 8 }} onClick={() => setEditingSceneIdx(-1)}>取消</Button>
                      </div>
                    ) : (
                      <div>
                        <div style={{ fontSize: 12, color: "#666", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{scene.scene_prompt}</div>
                        <Button size="small" type="link" style={{ padding: 0, height: 20, fontSize: 11 }}
                          onClick={() => { setEditingSceneIdx(i); setEditSceneText(scene.scene_prompt || "") }}>编辑</Button>
                      </div>
                    )}
                  </div>
                )
              })}
              <Button type="primary" icon={<VideoCameraOutlined />} onClick={() => { setClips(new Array(scenes.length).fill({ video_path: "", status: "pending", error: "" })); setCurrent(4) }} style={{ marginTop: 12 }} block>
                下一步：生成视频片段
              </Button>
            </Card>
          )}

          {current === 4 && (
            <Card title="生成视频片段"
              extra={<Button size="small" onClick={() => setCurrent(3)} icon={<ArrowLeftOutlined />}>返回</Button>}
              style={{ maxWidth: 900 }}>
              <Alert type="info" message="逐个生成，不满意可编辑提示词后重新生成" style={{ marginBottom: 16 }} />
              {scenes.map((scene, i) => {
                const nar = narrations[i], tts = ttsResults[i]
                const clip = clips[i] || { status: "pending", video_path: "", error: "" }
                const isGenerating = clip.status === "generating"
                const isDone = clip.status === "done"
                const isError = clip.status === "error"
                const hasVideo = isDone && clip.video_path && (clip.video_path.startsWith("http://") || clip.video_path.startsWith("https://"))
                const isEditing = clipEditIdx === i
                return (
                  <div key={i} style={{ marginBottom: 12, padding: 12, borderRadius: 8, border: "1px solid #e8e8e8", background: isDone ? "#f6ffed" : isError ? "#fff2f0" : "#fafafa" }}>
                    <Space style={{ marginBottom: 8 }}>
                      <Tag color="purple">分镜 {i + 1}/{scenes.length}</Tag>
                      <Tag color="blue">{tts?.duration || "-"}s</Tag>
                      {isDone && <Tag color="green">已生成</Tag>}
                      {isGenerating && <Tag color="orange">生成中...</Tag>}
                      {isError && <Tag color="red">失败</Tag>}
                      {clip.status === "pending" && <Tag>待生成</Tag>}
                    </Space>
                    <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>旁白: {(nar?.voice_script || "").substring(0, 60)}...</div>
                    <div style={{ marginBottom: 8 }}>
                      <Text type="secondary" style={{ fontSize: 11 }}>提示词：</Text>
                      {isEditing ? (
                        <div>
                          <TextArea value={clipEditText} onChange={e => setClipEditText(e.target.value)} rows={3} style={{ fontSize: 12, margin: "4px 0" }} />
                          <Space>
                            <Button size="small" type="primary" onClick={() => setClipEditIdx(-1)}>确认</Button>
                            <Button size="small" onClick={() => setClipEditIdx(-1)}>取消</Button>
                          </Space>
                        </div>
                      ) : (
                        <div style={{ fontSize: 11, color: "#999", lineHeight: 1.5, maxHeight: 36, overflow: "hidden" }}>
                          {scene?.scene_prompt?.substring(0, 120) || "无"}...
                        </div>
                      )}
                    </div>
                    {isGenerating && <Progress percent={50} status="active" size="small" style={{ marginBottom: 8 }} />}
                    {hasVideo && (
                      <video controls style={{ width: "100%", maxHeight: 240, borderRadius: 8, background: "#000", marginBottom: 8 }} src={clip.video_path} />
                    )}
                    {isError && <Alert type="error" message={clip.error || "生成失败"} style={{ marginBottom: 8 }} />}
                    <Space>
                      <Button
                        size="small"
                        type="primary"
                        icon={<VideoCameraOutlined />}
                        loading={isGenerating}
                        onClick={() => handleGenerateSingleClip(i)}
                        disabled={isGenerating}
                      >
                        {isDone ? "重新生成" : isGenerating ? "生成中..." : "生成"}
                      </Button>
                      {!isGenerating && (
                        <Button size="small" icon={<EditOutlined />}
                          onClick={() => { setClipEditIdx(i); setClipEditText(scene?.scene_prompt || "") }}>
                          编辑提示词
                        </Button>
                      )}
                    </Space>
                  </div>
                )
              })}
              {clips.filter(c => c?.status === "done").length > 0 && (
                <Button type="primary" icon={<PlayCircleOutlined />} onClick={handleCompose} loading={composeLoading} block style={{ marginTop: 12 }}>
                  合成最终视频 ({clips.filter(c => c?.status === "done").length}/{scenes.length} 个片段)
                </Button>
              )}
            </Card>
          )}

          {current === 5 && (
            <Card title="合成导出"
              extra={<Button size="small" onClick={() => setCurrent(4)} icon={<ArrowLeftOutlined />}>返回</Button>}
              style={{ maxWidth: 900 }}>
              {composeResult?.ok ? (
                <div style={{ textAlign: "center", padding: 24 }}>
                  <div style={{ fontSize: 48, marginBottom: 16 }}>🎬</div>
                  <Title level={4}>视频合成完成</Title>
                  {composeResult.duration && <Text type="secondary">总时长: {composeResult.duration}秒</Text>}
                  <div style={{ marginTop: 24 }}>
                    <video controls style={{ width: "100%", maxHeight: 480, borderRadius: 8, background: "#000" }}
                      src={"http://localhost:8000/uploads/" + (composeResult.path || "").split("/").pop()} />
                  </div>
                  <Space style={{ marginTop: 16 }}>
                    <Button type="primary" icon={<DownloadOutlined />}
                      onClick={() => {
                        const url = "http://localhost:8000/uploads/" + (composeResult.path || "").split("/").pop()
                        window.open(url, "_blank")
                      }}>
                      下载视频
                    </Button>
                    <Button onClick={handleReset}>新建科普视频</Button>
                  </Space>
                </div>
              ) : (
                <Alert type="error" message={composeResult?.error || "合成失败，请重试"} />
              )}
            </Card>
          )}
        </div>
      ),
    },
    {
      key: "config",
      label: "生成配置",
      icon: <SettingOutlined />,
      children: (
        <div style={{ maxWidth: 700 }}>
          <Card size="small" title={<span><FileTextOutlined style={{ marginRight: 6 }} />提示词文件</span>}>
            <List
              dataSource={configFiles}
              renderItem={file => (
                <List.Item extra={<Button size="small" icon={<EditOutlined />} onClick={() => openConfigEditor(file)}>编辑</Button>}>
                  <List.Item.Meta
                    title={<span style={{ fontFamily: "monospace", fontWeight: 600, fontSize: 13 }}>{file.filename}</span>}
                    description={<span style={{ fontSize: 12, color: "#8c8c8c" }}>{file.description}</span>}
                  />
                </List.Item>
              )}
            />
          </Card>
          <Card size="small" style={{ marginTop: 16 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>使用说明</span>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12, color: "#6c777b", lineHeight: 2 }}>
              <li>修改提示词后点击保存，下次生成时生效</li>
              <li>剧本提示词控制旁白分镜的内容风格和字数限制</li>
              <li>分镜提示词控制画面描述、镜头运动、光线等视觉元素</li>
            </ul>
          </Card>
        </div>
      ),
    },
  ]

  return (
    <div>
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
      <Drawer
        title={editingFile ? <span><FileTextOutlined style={{ marginRight: 8 }} />{editingFile.filename}</span> : "编辑文件"}
        open={configDrawerOpen}
        onClose={() => setConfigDrawerOpen(false)}
        width={700}
        extra={<Button type="primary" onClick={handleSaveConfig} loading={savingConfig}>保存</Button>}
      >
        <Input.TextArea
          value={editingContent}
          onChange={e => setEditingContent(e.target.value)}
          style={{ fontFamily: "monospace", fontSize: 13, height: "calc(100vh - 180px)" }}
          placeholder="输入文件内容..."
        />
      </Drawer>

      <Modal title="串联旁白" open={concatVisible} onCancel={() => setConcatVisible(false)} footer={[
        <Button key="copy" type="primary" onClick={() => { navigator.clipboard.writeText(concatText); message.success("已复制") }}>复制全文</Button>,
        <Button key="close" onClick={() => setConcatVisible(false)}>关闭</Button>
      ]} width={600}>
        <div style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 2, maxHeight: 400, overflow: "auto", background: "#fafafa", padding: 16, borderRadius: 8 }}>
          {concatText}
        </div>
      </Modal>
    </div>
  )
}

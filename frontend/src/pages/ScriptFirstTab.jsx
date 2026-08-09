import React from 'react'
import { useState, useEffect, useRef } from 'react'
import {
  Steps, Input, Button, Card, App, Select, Tag, Space, Divider,
  Typography, Spin, Tooltip, Alert, Progress
} from 'antd'
import {
  ThunderboltOutlined, LoadingOutlined, CheckCircleOutlined,
  EditOutlined, ReloadOutlined, SoundOutlined,
  ArrowRightOutlined, ArrowLeftOutlined, AudioOutlined, FileTextOutlined,
  PlayCircleOutlined, EyeOutlined, VideoCameraOutlined
} from '@ant-design/icons'
import { mediaApi } from '../services/api'

const { TextArea } = Input
const { Text } = Typography

const STAGE_LABELS = { hook: '钩子', evidence: '证据', scene: '场景', cta: 'CTA' }

class ScriptFirstErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <h3 style={{ color: '#e74c3c' }}>组件渲染错误</h3>
          <pre style={{ background: '#1e1e1e', color: '#d4d4d4', padding: 16, borderRadius: 8, fontSize: 12, textAlign: 'left', maxHeight: 300, overflow: 'auto' }}>
            {this.state.error.toString()}
          </pre>
        </div>
      )
    }
    return <ScriptFirstTabInner {...this.props} />
  }
}

function ScriptFirstTabInner({ videoTopics, competitorTemplates }) {
  const { message } = App.useApp()

  // Step
  const [current, setCurrent] = useState(0)

  // Input mode: 'topic' or 'free'
  const [inputMode, setInputMode] = useState('topic')
  const [selectedTopicId, setSelectedTopicId] = useState(null)
  const [selectedTopic, setSelectedTopic] = useState(null)
  const [freeText, setFreeText] = useState('')
  const [selectedTemplateId, setSelectedTemplateId] = useState(null)

  // Pipeline data
  const [outline, setOutline] = useState(null)
  const [narrations, setNarrations] = useState([])
  const [ttsResults, setTtsResults] = useState([])
  const [scenes, setScenes] = useState([])
  const [totalDuration, setTotalDuration] = useState(0)

  // Loading states
  const [loading, setLoading] = useState(false)
  const [loadingStep, setLoadingStep] = useState('')

  // Editing
  const [editingIndex, setEditingIndex] = useState(-1)
  const [editText, setEditText] = useState('')
  const [regeneratingIndex, setRegeneratingIndex] = useState(-1)
  const [editingSceneIndex, setEditingSceneIndex] = useState(-1)
  const [editSceneText, setEditSceneText] = useState("")
  const [collapsedTemplate, setCollapsedTemplate] = useState(false)
  const [mediaId, setMediaId] = useState(null)
  const [shotProgress, setShotProgress] = useState({})
  const [composing, setComposing] = useState(false)
  const [compositionResult, setCompositionResult] = useState(null)
  const [composedVideo, setComposedVideo] = useState(null)

  // Persist pipeline state to localStorage
  React.useEffect(() => {
    const hasData = outline || narrations.length > 0 || ttsResults.length > 0 || scenes.length > 0
    if (!hasData) return
    try {
      localStorage.setItem('script_first_state', JSON.stringify({
        current, outline, narrations, ttsResults, scenes,
        freeText, inputMode, selectedTopic, selectedTopicId, selectedTemplateId, totalDuration,
        mediaId, shotProgress,
      }))
    } catch {}
  }, [current, outline, narrations, ttsResults, scenes, freeText, inputMode, selectedTopic, selectedTopicId, selectedTemplateId, totalDuration, mediaId, shotProgress])

  React.useEffect(() => {
    try {
      const saved = localStorage.getItem('script_first_state')
      if (!saved) return
      const s = JSON.parse(saved)
      if (s.current !== undefined) setCurrent(s.current)
      if (s.outline) setOutline(s.outline)
      if (s.narrations) setNarrations(s.narrations)
      if (s.ttsResults) setTtsResults(s.ttsResults)
      if (s.scenes) setScenes(s.scenes)
      if (s.freeText) setFreeText(s.freeText)
      if (s.inputMode) setInputMode(s.inputMode)
      if (s.selectedTopic) setSelectedTopic(s.selectedTopic)
      if (s.selectedTopicId) setSelectedTopicId(s.selectedTopicId)
      if (s.selectedTemplateId) setSelectedTemplateId(s.selectedTemplateId)
      if (s.totalDuration) setTotalDuration(s.totalDuration)
      if (s.mediaId) setMediaId(s.mediaId)
      if (s.shotProgress) setShotProgress(s.shotProgress)
    } catch {}
  }, [])

  // ▸▸▸ Step 0: Generate Outline ▸▸▸
  const handleCreateOutline = async () => {
    if (!freeText.trim()) { message.warning('请输入自由文本'); return }
    setLoading(true)
    setLoadingStep('正在生成 outline...')
    try {
      let competitorFramework = ''
      if (selectedTemplateId) {
        const tpl = competitorTemplates.find(t => t.id === selectedTemplateId)
        if (tpl) competitorFramework = tpl.framework
      }
      const res = await mediaApi.scriptCreateOutline(freeText.trim(), competitorFramework)
      setOutline(res.outline)
      setCurrent(1)
      message.success('Outline 生成成功')
    } catch (e) {
      message.error('生成失败: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  // ▸▸▸ Direct to narrations (when topic has outline) ▸▸▸
  const handleTopicToNarrations = async () => {
    if (!selectedTopic) { message.warning('请选择一个选题'); return }
    const outlineList = selectedTopic.content_outline
    if (!outlineList?.length) { message.warning('选题无 content_outline'); return }
    setLoading(true)
    setLoadingStep('正在生成旁白...')
    try {
      let competitorFramework = ''
      if (selectedTemplateId) {
        const tpl = competitorTemplates.find(t => t.id === selectedTemplateId)
        if (tpl) competitorFramework = tpl.framework
      }
      const res = await mediaApi.scriptNarration(outlineList, competitorFramework)
      setNarrations(res.narrations)
      setOutline(selectedTopic)
      setCurrent(2)
      message.success('旁白生成成功')
    } catch (e) {
      message.error('生成旁白失败: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  // ▸▸▸ Step 1 (from outline): Generate Narrations ▸▸▸
  const handleGenerateNarration = async () => {
    const outlineList = outline?.content_outline
    if (!outlineList?.length) { message.warning('Outline 为空'); return }
    setLoading(true)
    setLoadingStep('正在生成旁白...')
    try {
      let competitorFramework = ''
      if (selectedTemplateId) {
        const tpl = competitorTemplates.find(t => t.id === selectedTemplateId)
        if (tpl) competitorFramework = tpl.framework
      }
      const res = await mediaApi.scriptNarration(outlineList, competitorFramework)
      setNarrations(res.narrations)
      setCurrent(2)
      message.success('旁白生成成功')
    } catch (e) {
      message.error('生成旁白失败: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  // ▸▸▸ Step 2: TTS synthesize ▸▸▸
  const handleSynthesizeTts = async () => {
    if (!narrations.length) { message.warning('请先生成旁白'); return }
    setLoading(true)
    setLoadingStep('正在合成语音...')
    try {
      const res = await mediaApi.scriptTts(narrations)
      setTtsResults(res.segments || [])
      setTotalDuration(res.total_duration || 0)
      setCurrent(3)
      message.success(`TTS 合成完成，总时长 ${res.total_duration}s`)
    } catch (e) {
      message.error('TTS 合成失败: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  // ▸▸▸ Step 3: Generate Scenes ▸▸▸
  const handleGenerateScenes = async () => {
    if (!narrations.length || !ttsResults.length) {
      message.warning('请先完成旁白和 TTS')
      return
    }
    setLoading(true)
    setLoadingStep('正在生成分镜画面...')
    try {
      const outlineList = outline?.content_outline || []
      const durations = ttsResults.map(r => r.duration)
      let competitorFramework = ''
      if (selectedTemplateId) {
        const tpl = competitorTemplates.find(t => t.id === selectedTemplateId)
        if (tpl) competitorFramework = tpl.framework
      }
      const res = await mediaApi.scriptScenes(outlineList, narrations, durations, competitorFramework)
      setScenes(res.scenes)
      setCurrent(4)
      message.success('分镜画面生成完成')
    } catch (e) {
      message.error('生成分镜失败: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  // ▸▸▸ One-shot full pipeline ▸▸▸
  const handleOneShot = async () => {
    if (inputMode === 'topic' && !selectedTopic) { message.warning('请选择一个选题'); return }
    if (inputMode === 'free' && !freeText.trim()) { message.warning('请输入自由文本'); return }

    setLoading(true)
    setLoadingStep('一键生成中...')

    try {
      let competitorFramework = ''
      if (selectedTemplateId) {
        const tpl = competitorTemplates.find(t => t.id === selectedTemplateId)
        if (tpl) competitorFramework = tpl.framework
      }
      const payload = { competitor_framework: competitorFramework }
      if (inputMode === 'topic') {
        payload.topic = selectedTopic
      } else {
        payload.text = freeText.trim()
      }
      const res = await mediaApi.scriptGenerate(payload)
      setOutline(res.outline)
      setNarrations(res.narrations)
      setTtsResults(res.tts_results)
      setScenes(res.scenes)
      setTotalDuration(res.total_duration)
      setCurrent(4)
      message.success(`一键生成完成！总时长 ${res.total_duration}s`)
    } catch (e) {
      message.error('生成失败: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  // ▸▸▸ Single segment TTS regenerate ▸▸▸
  const handleRegenerateSegment = async (index) => {
    const nar = narrations[index]
    if (!nar?.voice_script) return
    setRegeneratingIndex(index)
    try {
      const res = await mediaApi.scriptRegenerate(nar.voice_script, null, index)
      if (res.segment) {
        setTtsResults(prev => {
          const next = [...prev]
          next[index] = res.segment
          return next
        })
        setTotalDuration(prev => {
          const old = ttsResults[index]?.duration || 0
          return prev - old + (res.segment.duration || 0)
        })
      }
      message.success('重新合成完成')
    } catch (e) {
      message.error('重新合成失败: ' + e.message)
    } finally {
      setRegeneratingIndex(-1)
    }
  }

  // ▸▸▸ Edit narration and regenerate ▸▸▸
  const handleEditNarration = (index) => {
    setEditingIndex(index)
    setEditText(narrations[index]?.voice_script || '')
  }

  const handleSaveEdit = async () => {
    const idx = editingIndex
    setNarrations(prev => prev.map((n, i) => i === idx ? { ...n, voice_script: editText } : n))
    setEditingIndex(-1)
    // Also re-TTS this segment
    await handleRegenerateSegment(idx)
  }

  // ▸▸▸ Reset ▸▸▸
  const resetAll = () => {
    setCurrent(0)
    setOutline(null)
    setNarrations([])
    setTtsResults([])
    setScenes([])
    setTotalDuration(0)
    setFreeText('')
    setSelectedTopic(null)
    setSelectedTopicId(null)
    setSelectedTemplateId(null)
    setEditingIndex(-1)
    setEditText('')
    try { localStorage.removeItem('script_first_state') } catch {}
  }

    // Edit scene prompt in final shots
  function handleEditScene(index) {
    setEditingSceneIndex(index)
    setEditSceneText(scenes[index]?.scene_prompt || "")
  }

  function handleSaveScene() {
    const idx = editingSceneIndex
    setScenes(prev => prev.map((s, i) => i === idx ? { ...s, scene_prompt: editSceneText } : s))
    setEditingSceneIndex(-1)
    message.success("Scene prompt updated")
  }

  // Cancel a shot generation
  const pollRefs = useRef({})
  async function cancelShot(si) {
    if (pollRefs.current[si]) { clearInterval(pollRefs.current[si]); delete pollRefs.current[si] }
    try { await fetch("http://localhost:8000/api/media/" + mediaId + "/shots/" + si + "/cancel", { method: "POST" }) } catch (e) {}
    setShotProgress(p => ({ ...p, [si]: { status: "cancelled" } }))
  }

  // Generate a single shot video
  async function generateSingleShot(si) {
    if (!mediaId) return
    setShotProgress(p => ({ ...p, [si]: { status: "generating", progress: 5 } }))
    try {
      const res = await fetch("http://localhost:8000/api/media/" + mediaId + "/shots/" + si + "/generate", { method: "POST" })
      if (!res.ok) { setShotProgress(p => ({ ...p, [si]: { status: "failed" } })); return }
      await new Promise((resolve, reject) => {
        const poll = setInterval(async () => {
          if (pollRefs.current[si] !== poll) { resolve(); return }
          try {
            const spRes = await fetch("http://localhost:8000/api/media/" + mediaId + "/shots")
            const shots = await spRes.json()
            const s = shots.find(sh => sh.shot_index === si)
            if (s) {
              setShotProgress(p => ({ ...p, [si]: { status: s.status === "done" ? "done" : s.status === "failed" ? "failed" : "generating", progress: s.progress || 0, video_path: s.clip_path || "", audio_path: s.audio_path || "" } }))
              if (s.status === "done" || s.status === "failed") { clearInterval(poll); delete pollRefs.current[si]; resolve() }
            }
          } catch (e) {}
        }, 2000)
        pollRefs.current[si] = poll
        setTimeout(() => { 
          if (pollRefs.current[si] === poll) { clearInterval(poll); delete pollRefs.current[si]; setShotProgress(p => ({ ...p, [si]: { status: "failed", error: "timeout" } })); resolve() }
        }, 600000)
      })
    } catch (e) {
      setShotProgress(p => ({ ...p, [si]: { status: "failed", error: e.message } }))
    }
  }

  // Generate all shot videos sequentially
  function generateAllShots(mid, count) {
    const go = async (idx) => {
      if (idx > count) return
      setShotProgress(p => ({ ...p, [idx]: { status: "generating", progress: 5 } }))
      try {
        const res = await fetch("http://localhost:8000/api/media/" + mid + "/shots/" + idx + "/generate", { method: "POST" })
        if (!res.ok) { setShotProgress(p => ({ ...p, [idx]: { status: "failed" } })); go(idx + 1); return }
        await new Promise((resolve) => {
          const poll = setInterval(async () => {
            try {
              const spRes = await fetch("http://localhost:8000/api/media/" + mid + "/shots")
              const shots = await spRes.json()
              const s = shots.find(sh => sh.shot_index === idx)
              if (s) {
                setShotProgress(p => ({ ...p, [idx]: { status: s.status === "done" ? "done" : s.status === "failed" ? "failed" : "generating", progress: s.progress || 0, video_path: s.clip_path || "", audio_path: s.audio_path || "" } }))
                if (s.status === "done" || s.status === "failed") { clearInterval(poll); resolve() }
              }
            } catch (e) {}
          }, 2000)
          setTimeout(() => { clearInterval(poll); setShotProgress(p => ({ ...p, [idx]: { status: "failed", error: "timeout" } })); resolve() }, 600000)
        })
      } catch (e) {
        setShotProgress(p => ({ ...p, [idx]: { status: "failed", error: e.message } }))
      }
      go(idx + 1)
    }
    go(1)
  }

  // Compose final video
  async function handleCompose() {
    if (!mediaId) return
    setComposing(true)
    try {
      const res = await fetch("http://localhost:8000/api/media/" + mediaId + "/compose", { method: "POST" })
      const data = await res.json()
      setCompositionResult(data)
      setComposedVideo(null)
      message.success("Composing, please wait...")
      let pollCount = 0
      const pid = setInterval(async () => {
        pollCount++
        try {
          const mr = await fetch("http://localhost:8000/api/media/" + mediaId)
          const media = await mr.json()
          if (media.status === "ready" && media.filepath) {
            clearInterval(pid)
            const fn = media.filepath.split(/[\\\\/]/).pop()
            setComposedVideo("http://localhost:8000/uploads/" + fn)
            setComposing(false)
            message.success("Compose done!")
          } else if (media.status === "failed") {
            clearInterval(pid); setComposing(false); message.error("Compose failed")
          }
          if (pollCount > 80) { clearInterval(pid); setComposing(false); message.error("Timeout") }
        } catch (e) { if (pollCount > 80) { clearInterval(pid); setComposing(false) } }
      }, 3000)
    } catch (e) {
      message.error("Compose failed: " + e.message)
    } finally {
      setComposing(false)
    }
  }

  async function handleSaveAndGenerate() {

    const prompt = outline?.video_topic || "Script-First"
    const shotItems = narrations.map((nar, i) => ({
      scene_prompt: scenes[i]?.scene_prompt || "",
      voice_script: nar.voice_script || "",
      duration: String(Math.round(ttsResults[i]?.duration || 5)),
    }))

    try {
      const res = await fetch("http://localhost:8000/api/media/save-shots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          size: "9:16",
          resolution: "1080P",
          shots: shotItems,
        }),
      })
      const data = await res.json()
      setMediaId(data.media_id)
      setCurrent(5)
      message.success("已保存！" + shotItems.length + " 个分镜就绪，可逐个生成。")
    } catch (e) {
      message.error("Save failed: " + e.message)
    }
  }

  // ▸▸▸ Render: Step 0 - Input ▸▸▸
  const renderInput = () => (
    <div style={{ maxWidth: 700 }}>
      <Space style={{ marginBottom: 16 }}>
        <Button type={inputMode === 'topic' ? 'primary' : 'default'} onClick={() => setInputMode('topic')}>
          从选题
        </Button>
        <Button type={inputMode === 'free' ? 'primary' : 'default'} onClick={() => setInputMode('free')}>
          自由输入
        </Button>
      </Space>

      {inputMode === 'topic' && (
        <Card size="small" title="选择今日选题">
          <Select
            showSearch
            placeholder="搜索选题..."
            style={{ width: '100%', marginBottom: 12 }}
            filterOption={(input, option) => option.label.toLowerCase().includes(input.toLowerCase())}
            value={selectedTopicId}
            onChange={(val) => {
              setSelectedTopicId(val)
              const topic = videoTopics[val]
              setSelectedTopic(topic || null)
            }}
            options={videoTopics.map((t, i) => ({
              label: t.video_topic || t.source_title || '选题' ,
              value: i,
            }))}
          />
                    {selectedTopic && (
            <Card size="small" style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                <div style={{ display: "flex", marginBottom: 2 }}>
                  <span style={{ color: "#888", width: 48, flexShrink: 0 }}>标题</span>
                  <span style={{ fontWeight: 500 }}>{selectedTopic.video_topic}</span>
                </div>
                {selectedTopic.angle && (
                  <div style={{ display: "flex", marginBottom: 2 }}>
                    <span style={{ color: "#888", width: 48, flexShrink: 0 }}>角度</span>
                    <span style={{ color: "#555" }}>{selectedTopic.angle}</span>
                  </div>
                )}
                <div style={{ display: "flex", marginBottom: 2 }}>
                  <span style={{ color: "#888", width: 48, flexShrink: 0 }}>钩子</span>
                  <span>
                    {selectedTopic.hook_type && <Tag color="orange" style={{fontSize:10}}>{selectedTopic.hook_type}</Tag>}
                    <span style={{color:"#e67e22",fontWeight:500}}>{selectedTopic.hook}</span>
                  </span>
                </div>
                {selectedTopic.content_outline?.length > 0 && (() => {
                  const items = selectedTopic.content_outline.filter(p => typeof p !== "object" || p.stage !== "hook")
                  if (!items.length) return null
                  const labels = {evidence:"证据",scene:"场景",cta:"行动"}
                  return (
                    <div style={{ display: "flex", marginBottom: 2 }}>
                      <span style={{ color: "#888", width: 48, flexShrink: 0 }}>要点</span>
                      <span>
                        {items.map((p, i) => {
                          const isObj = typeof p === "object" && p !== null
                          const label = isObj ? (labels[p.stage] || "") : ""
                          return (
                            <div key={i} style={{ marginBottom: 1 }}>
                              {isObj && <span style={{ color: "#aaa", marginRight: 6 }}>{label}</span>}
                              <span style={{ color: "#555" }}>{isObj ? p.point : p}</span>
                              {isObj && (p.data_point || p.sensory || p.emotion) && (
                                <span style={{ color: "#bbb", fontSize: 10, marginLeft: 4 }}>
                                  {p.data_point && "📊 " + p.data_point}
                                  {(p.data_point && (p.sensory || p.emotion)) && " · "}
                                  {p.sensory && "👃 " + p.sensory}
                                  {(p.sensory && p.emotion) && " · "}
                                  {p.emotion && "💭 " + p.emotion}
                                </span>
                              )}
                            </div>
                          )
                        })}
                      </span>
                    </div>
                  )
                })()}
                {selectedTopic.target_emotion && (
                  <div style={{ display: "flex", marginBottom: 2 }}>
                    <span style={{ color: "#888", width: 48, flexShrink: 0 }}>情绪</span>
                    <span style={{ color: "#555" }}>{selectedTopic.target_emotion}</span>
                  </div>
                )}
                {selectedTopic.product_link && selectedTopic.product_link !== "无需植入" && (
                  <div style={{ display: "flex", marginBottom: 2 }}>
                    <span style={{ color: "#888", width: 48, flexShrink: 0 }}>产品</span>
                    <span style={{ color: "#555" }}>{selectedTopic.product_link}</span>
                  </div>
                )}
                <div style={{ display: "flex" }}>
                  <span style={{ color: "#888", width: 48, flexShrink: 0 }}>时长</span>
                  <span>{selectedTopic.duration || 40}s · {selectedTopic.content_outline?.length || 0} 个分镜</span>
                </div>
              </div>
            </Card>
          )}
          {competitorTemplates.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <span style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 6 }}>
                选择爆款模板
              </span>
              <Select
                allowClear
                placeholder="不参考爆款模板..."
                style={{ width: "100%" }}
                value={selectedTemplateId}
                onChange={setSelectedTemplateId}
                options={competitorTemplates.map(t => ({ label: t.name, value: t.id }))}
              />
              {selectedTemplateId && (() => {
                const tpl = competitorTemplates.find(t => t.id === selectedTemplateId)
                if (!tpl) return null
                let fw = {}
                try { fw = JSON.parse(tpl.framework) } catch {}
                return (
                  <>
                    <div style={{ display: "flex", alignItems: "center", cursor: "pointer", marginTop: 12, marginBottom: 8 }}
                      onClick={() => setCollapsedTemplate(c => !c)}>
                      {collapsedTemplate
                        ? <span style={{ marginRight: 6, fontSize: 12, color: "#888" }}>+</span>
                        : <span style={{ marginRight: 6, fontSize: 12, color: "#888" }}>-</span>}
                      <span style={{ fontWeight: 600, fontSize: 14 }}>爆款视频模板</span>
                    </div>
                    {!collapsedTemplate && (
                      <Card size="small" style={{ background: "#fafafa" }}>
                        <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                          <div style={{ display: "flex", marginBottom: 2 }}>
                            <span style={{ color: "#888", width: 48, flexShrink: 0 }}>风格</span>
                            <span>
                              {fw.style && <Tag color="blue" style={{fontSize:10}}>{fw.style}</Tag>}
                              {fw.tone && <Tag color="purple" style={{fontSize:10}}>{fw.tone}</Tag>}
                              {fw.narrative_arc && <Tag color="cyan" style={{fontSize:10}}>{fw.narrative_arc}</Tag>}
                            </span>
                          </div>
                          <div style={{ display: "flex", marginBottom: 2 }}>
                            <span style={{ color: "#888", width: 48, flexShrink: 0 }}>时长</span>
                            <span>{fw.total_duration || "?"}s · {(fw.shots || []).length} 镜</span>
                          </div>
                          {fw.target_audience && (
                            <div style={{ display: "flex", marginBottom: 2 }}>
                              <span style={{ color: "#888", width: 48, flexShrink: 0 }}>受众</span>
                              <span style={{ color: "#555" }}>
                                {fw.target_audience.age_range && <Tag color="green" style={{fontSize:10}}>{fw.target_audience.age_range}</Tag>}
                                {fw.target_audience.gender && fw.target_audience.gender !== "不限" && <Tag color="green" style={{fontSize:10}}>{fw.target_audience.gender}</Tag>}
                                {fw.target_audience.interests?.slice(0,2).join(" · ")}
                                {fw.target_audience.pain_points?.slice(0,2).join(" · ")}
                              </span>
                            </div>
                          )}
                          {fw.hook?.hook_visual && (
                            <div style={{ display: "flex", marginBottom: 2 }}>
                              <span style={{ color: "#888", width: 48, flexShrink: 0 }}>钩子画面</span>
                              <span style={{ color: "#555" }}>{fw.hook.hook_visual.substring(0, 50)}{fw.hook.hook_visual.length > 50 ? "..." : ""}</span>
                            </div>
                          )}
                          {(fw.shots || []).length > 0 && (
                            <div style={{ display: "flex", marginBottom: 2 }}>
                              <span style={{ color: "#888", width: 48, flexShrink: 0 }}>分镜</span>
                              <div style={{ flex: 1 }}>
                                {fw.shots.map((s, i) => (
                                  <div key={i} style={{ marginBottom: 2 }}>
                                    <Tag color="geekblue" style={{fontSize:10, marginRight:4}}>镜{s.index||i+1}</Tag>
                                    <span style={{color:"#888"}}>{s.duration}s {s.shot_size||""}{s.camera_movement && s.camera_movement !== "固定" ? " " + s.camera_movement : ""} {s.shot_type||""}</span>
                                    {s.emotion_beat && <Tag color="volcano" style={{fontSize:10, marginLeft:4}}>{s.emotion_beat}</Tag>}
                                    {s.visual_desc && <div style={{color:"#555", paddingLeft:4}}>{s.visual_desc.substring(0, 40)}{s.visual_desc.length > 40 ? "..." : ""}</div>}
                                    {s.script && <div style={{color:"#e67e22", paddingLeft:4, fontSize:11}}>🎤 {s.script.substring(0, 40)}{s.script.length > 40 ? "..." : ""}</div>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {fw.traffic_strategy?.cta_type && fw.traffic_strategy.cta_type !== "无" && (
                            <div style={{ display: "flex", marginBottom: 2 }}>
                              <span style={{ color: "#888", width: 48, flexShrink: 0 }}>CTA</span>
                              <span style={{ color: "#555" }}>{fw.traffic_strategy.cta_type}{fw.traffic_strategy.cta_placement ? "（第" + fw.traffic_strategy.cta_placement + "镜）" : ""}</span>
                            </div>
                          )}
                          {fw.replicability?.copyable_elements?.length > 0 && (
                            <div style={{ display: "flex", marginBottom: 2 }}>
                              <span style={{ color: "#888", width: 48, flexShrink: 0 }}>可复用</span>
                              <span style={{ color: "#555" }}>{fw.replicability.copyable_elements.slice(0, 3).join(" · ")}</span>
                            </div>
                          )}
                          {fw.replicability?.winning_factors?.length > 0 && (
                            <div style={{ display: "flex", marginBottom: 2 }}>
                              <span style={{ color: "#888", width: 48, flexShrink: 0 }}>爆款因子</span>
                              <span style={{ color: "#555" }}>{fw.replicability.winning_factors.slice(0, 3).join(" · ")}</span>
                            </div>
                          )}
                          {fw.replicability?.improvement_opportunities?.length > 0 && (
                            <div style={{ display: "flex", marginBottom: 2 }}>
                              <span style={{ color: "#888", width: 48, flexShrink: 0 }}>改进点</span>
                              <span style={{ color: "#555" }}>{fw.replicability.improvement_opportunities.slice(0, 2).join(" · ")}</span>
                            </div>
                          )}
                        </div>
                      </Card>
                    )}
                  </>
                )
              })()}
            </div>
          )}
          <Button
            type="primary"
            block
            size="large"
            icon={<ThunderboltOutlined />}
            loading={loading}
            onClick={handleTopicToNarrations}
          >
            生成旁白
          </Button>
          <Button
            block
            size="large"
            icon={<ThunderboltOutlined />}
            loading={loading}
            onClick={handleOneShot}
            style={{ marginTop: 8 }}
          >
            一键生成全部
          </Button>
        </Card>
      )}

      {inputMode === 'free' && (
        <Card size="small" title="自由输入">
          <TextArea
            value={freeText}
            onChange={e => setFreeText(e.target.value)}
            rows={4}
            placeholder="输入你想做的视频主题或一句话描述..."
            style={{ marginBottom: 12 }}
          />
          {competitorTemplates.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <span style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 6 }}>
                选择爆款模板
              </span>
              <Select
                allowClear
                placeholder="不参考爆款模板..."
                style={{ width: "100%" }}
                value={selectedTemplateId}
                onChange={setSelectedTemplateId}
                options={competitorTemplates.map(t => ({ label: t.name, value: t.id }))}
              />
              {selectedTemplateId && (() => {
                const tpl = competitorTemplates.find(t => t.id === selectedTemplateId)
                if (!tpl) return null
                let fw = {}
                try { fw = JSON.parse(tpl.framework) } catch {}
                return (
                  <>
                    <div style={{ display: "flex", alignItems: "center", cursor: "pointer", marginTop: 12, marginBottom: 8 }}
                      onClick={() => setCollapsedTemplate(c => !c)}>
                      {collapsedTemplate
                        ? <span style={{ marginRight: 6, fontSize: 12, color: "#888" }}>+</span>
                        : <span style={{ marginRight: 6, fontSize: 12, color: "#888" }}>-</span>}
                      <span style={{ fontWeight: 600, fontSize: 14 }}>爆款视频模板</span>
                    </div>
                    {!collapsedTemplate && (
                      <Card size="small" style={{ background: "#fafafa" }}>
                        <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                          <div style={{ display: "flex", marginBottom: 2 }}>
                            <span style={{ color: "#888", width: 48, flexShrink: 0 }}>风格</span>
                            <span>
                              {fw.style && <Tag color="blue" style={{fontSize:10}}>{fw.style}</Tag>}
                              {fw.tone && <Tag color="purple" style={{fontSize:10}}>{fw.tone}</Tag>}
                              {fw.narrative_arc && <Tag color="cyan" style={{fontSize:10}}>{fw.narrative_arc}</Tag>}
                            </span>
                          </div>
                          <div style={{ display: "flex", marginBottom: 2 }}>
                            <span style={{ color: "#888", width: 48, flexShrink: 0 }}>时长</span>
                            <span>{fw.total_duration || "?"}s · {(fw.shots || []).length} 镜</span>
                          </div>
                          {fw.target_audience && (
                            <div style={{ display: "flex", marginBottom: 2 }}>
                              <span style={{ color: "#888", width: 48, flexShrink: 0 }}>受众</span>
                              <span style={{ color: "#555" }}>
                                {fw.target_audience.age_range && <Tag color="green" style={{fontSize:10}}>{fw.target_audience.age_range}</Tag>}
                                {fw.target_audience.gender && fw.target_audience.gender !== "不限" && <Tag color="green" style={{fontSize:10}}>{fw.target_audience.gender}</Tag>}
                                {fw.target_audience.interests?.slice(0,2).join(" · ")}
                                {fw.target_audience.pain_points?.slice(0,2).join(" · ")}
                              </span>
                            </div>
                          )}
                          {fw.hook?.hook_visual && (
                            <div style={{ display: "flex", marginBottom: 2 }}>
                              <span style={{ color: "#888", width: 48, flexShrink: 0 }}>钩子画面</span>
                              <span style={{ color: "#555" }}>{fw.hook.hook_visual.substring(0, 50)}{fw.hook.hook_visual.length > 50 ? "..." : ""}</span>
                            </div>
                          )}
                          {(fw.shots || []).length > 0 && (
                            <div style={{ display: "flex", marginBottom: 2 }}>
                              <span style={{ color: "#888", width: 48, flexShrink: 0 }}>分镜</span>
                              <div style={{ flex: 1 }}>
                                {fw.shots.map((s, i) => (
                                  <div key={i} style={{ marginBottom: 2 }}>
                                    <Tag color="geekblue" style={{fontSize:10, marginRight:4}}>镜{s.index||i+1}</Tag>
                                    <span style={{color:"#888"}}>{s.duration}s {s.shot_size||""}{s.camera_movement && s.camera_movement !== "固定" ? " " + s.camera_movement : ""} {s.shot_type||""}</span>
                                    {s.emotion_beat && <Tag color="volcano" style={{fontSize:10, marginLeft:4}}>{s.emotion_beat}</Tag>}
                                    {s.visual_desc && <div style={{color:"#555", paddingLeft:4}}>{s.visual_desc.substring(0, 40)}{s.visual_desc.length > 40 ? "..." : ""}</div>}
                                    {s.script && <div style={{color:"#e67e22", paddingLeft:4, fontSize:11}}>🎤 {s.script.substring(0, 40)}{s.script.length > 40 ? "..." : ""}</div>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {fw.traffic_strategy?.cta_type && fw.traffic_strategy.cta_type !== "无" && (
                            <div style={{ display: "flex", marginBottom: 2 }}>
                              <span style={{ color: "#888", width: 48, flexShrink: 0 }}>CTA</span>
                              <span style={{ color: "#555" }}>{fw.traffic_strategy.cta_type}{fw.traffic_strategy.cta_placement ? "（第" + fw.traffic_strategy.cta_placement + "镜）" : ""}</span>
                            </div>
                          )}
                          {fw.replicability?.copyable_elements?.length > 0 && (
                            <div style={{ display: "flex", marginBottom: 2 }}>
                              <span style={{ color: "#888", width: 48, flexShrink: 0 }}>可复用</span>
                              <span style={{ color: "#555" }}>{fw.replicability.copyable_elements.slice(0, 3).join(" · ")}</span>
                            </div>
                          )}
                          {fw.replicability?.winning_factors?.length > 0 && (
                            <div style={{ display: "flex", marginBottom: 2 }}>
                              <span style={{ color: "#888", width: 48, flexShrink: 0 }}>爆款因子</span>
                              <span style={{ color: "#555" }}>{fw.replicability.winning_factors.slice(0, 3).join(" · ")}</span>
                            </div>
                          )}
                          {fw.replicability?.improvement_opportunities?.length > 0 && (
                            <div style={{ display: "flex", marginBottom: 2 }}>
                              <span style={{ color: "#888", width: 48, flexShrink: 0 }}>改进点</span>
                              <span style={{ color: "#555" }}>{fw.replicability.improvement_opportunities.slice(0, 2).join(" · ")}</span>
                            </div>
                          )}
                        </div>
                      </Card>
                    )}
                  </>
                )
              })()}
            </div>
          )}
          <Space style={{ width: '100%' }} direction="vertical">
            <Button
              type="primary"
              block
              size="large"
              icon={<ThunderboltOutlined />}
              loading={loading}
              onClick={handleCreateOutline}
            >
              生成 Outline
            </Button>
            <Button
              block
              size="large"
              icon={<ThunderboltOutlined />}
              loading={loading}
              onClick={handleOneShot}
            >
              一键生成全部
            </Button>
          </Space>
        </Card>
      )}
    </div>
  )

  // ▸▸▸ Render: Step 1 - Outline preview ▸▸▸
  const renderOutline = () => (
    <Card
      title="📋 Outline 预览"
      extra={<Button size="small" onClick={() => setCurrent(0)} icon={<ArrowLeftOutlined />}>返回</Button>}
      style={{ maxWidth: 700 }}
    >
      {outline && (
        <div style={{ marginBottom: 16, padding: 16, background: '#f6f8fa', borderRadius: 8 }}>
          <div style={{ marginBottom: 8 }}><Text strong>选题: </Text>{outline.video_topic || '--'}</div>
          <div style={{ marginBottom: 8 }}><Text strong>角度: </Text>{outline.angle || '--'}</div>
          <div style={{ marginBottom: 8 }}><Text strong>钩子类型: </Text>{outline.hook_type || '--'}</div>
          <div style={{ marginBottom: 8 }}><Text strong>黄金钩子: </Text>{outline.hook || '--'}</div>
          <div style={{ marginBottom: 8 }}><Text strong>情绪走向: </Text>{outline.target_emotion || '--'}</div>
          <div style={{ marginBottom: 12 }}>
            <Text strong>分段大纲: </Text>
            {(outline.content_outline || []).map((item, i) => (
              <Tag key={i} style={{ marginTop: 4 }}>
                {STAGE_LABELS[item.stage] || item.stage}: {item.point?.substring(0, 30)}...
              </Tag>
            ))}
          </div>
        </div>
      )}
      <Button
        type="primary"
        block
        icon={<ArrowRightOutlined />}
        loading={loading}
        onClick={handleGenerateNarration}
      >
        下一步：生成旁白
      </Button>
    </Card>
  )

  // ▸▸▸ Render: Step 2 - Narrations ▸▸▸
  const renderNarrations = () => (
    <Card
      title="🎙️ 配音旁白"
      extra={<Button size="small" onClick={() => setCurrent(1)} icon={<ArrowLeftOutlined />}>返回</Button>}
      style={{ maxWidth: 700 }}
    >
      {narrations.map((nar, i) => (
        <div key={i} style={{
          marginBottom: 12, padding: 12, borderRadius: 8,
          border: '1px solid #e8e8e8', background: editingIndex === i ? '#fffbe6' : '#fafafa'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <Tag color="purple">{STAGE_LABELS[nar.stage] || nar.stage || `段${i + 1}`}</Tag>
            <Button size="small" icon={<EditOutlined />} onClick={() => handleEditNarration(i)}>编辑</Button>
          </div>
          {editingIndex === i ? (
            <div>
              <TextArea
                value={editText}
                onChange={e => setEditText(e.target.value)}
                rows={3}
                style={{ marginBottom: 8 }}
              />
              <Space>
                <Button size="small" type="primary" onClick={handleSaveEdit}>保存并重新合成</Button>
                <Button size="small" onClick={() => setEditingIndex(-1)}>取消</Button>
              </Space>
            </div>
          ) : (
            <div style={{ color: '#333', lineHeight: 1.8, fontSize: 14 }}>{nar.voice_script}</div>
          )}
        </div>
      ))}
      <Divider />
      <Button
        type="primary"
        block
        icon={<SoundOutlined />}
        loading={loading}
        onClick={handleSynthesizeTts}
      >
        下一步：合成语音
      </Button>
    </Card>
  )

  // ▸▸▸ Render: Step 3 - TTS Results ▸▸▸
  const renderTtsResults = () => (
    <Card
      title={<span><AudioOutlined style={{ marginRight: 6 }} />语音合成结果</span>}
      extra={<Button size="small" onClick={() => setCurrent(2)} icon={<ArrowLeftOutlined />}>返回编辑旁白</Button>}
      style={{ maxWidth: 700 }}
    >
      <Alert
        type="info"
        message={`总时长: ${totalDuration.toFixed(1)}s`}
        style={{ marginBottom: 16 }}
      />
      {ttsResults.map((seg, i) => (
        <div key={i} style={{
          marginBottom: 12, padding: 12, borderRadius: 8,
          border: '1px solid #e8e8e8', background: '#fafafa'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Tag color="cyan">{STAGE_LABELS[narrations[i]?.stage] || `段${i + 1}`}</Tag>
            <Tag color="blue">{seg.duration}s</Tag>
          </div>
          <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 4, wordBreak: 'break-all' }}>
            {seg.audio_path || 'TTS 失败 - 使用估算时长'}
          </div>
          {seg.audio_path && (
            <audio controls style={{ width: '100%', marginTop: 8, height: 36 }}>
              <source src={`http://localhost:8000${seg.audio_path}`} />
            </audio>
          )}
          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={regeneratingIndex === i}
            onClick={() => handleRegenerateSegment(i)}
            style={{ marginTop: 8 }}
          >
            重新合成
          </Button>
        </div>
      ))}
      <Divider />
      <Button
        type="primary"
        block
        icon={<EyeOutlined />}
        loading={loading}
        onClick={handleGenerateScenes}
      >
        下一步：生成分镜画面
      </Button>
    </Card>
  )

  // ▸▸▸ Render: Step 4 - Final Shots ▸▸▸
  const renderFinalShots = () => (
    <Card
      title="🎬 最终分镜"
      extra={<Button size="small" onClick={() => setCurrent(3)} icon={<ArrowLeftOutlined />}>返回</Button>}
      style={{ maxWidth: 700 }}
    >
      <Alert
        type="success"
        message={`✅ 智能分镜完成！${narrations.length} 个分镜，总旁白时长 ${totalDuration.toFixed(1)}s`}
        style={{ marginBottom: 16 }}
      />
      {narrations.map((nar, i) => {
        const seg = ttsResults[i] || {}
        const scene = scenes[i] || {}
        return (
          <Card
            key={i}
            size="small"
            title={<span><Tag color="purple">{STAGE_LABELS[nar.stage] || 段}</Tag> <Tag color="blue">{seg.duration || 0}s</Tag></span>}
            style={{ marginBottom: 12 }}
          >
            <div style={{ marginBottom: 8 }}>
              <Text strong>🎙️ 旁白: </Text>
              <div style={{ color: '#333', lineHeight: 1.6, fontSize: 13 }}>{nar.voice_script}</div>
            </div>
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <Text strong>🎬 画面: </Text>
                <Button size="small" icon={<EditOutlined />} onClick={() => handleEditScene(i)}>编辑画面</Button>
              </div>
              {editingSceneIndex === i ? (
                <div>
                  <TextArea value={editSceneText} onChange={e => setEditSceneText(e.target.value)} rows={4} style={{ marginBottom: 8, fontSize: 12 }} />
                  <Space>
                    <Button size="small" type="primary" onClick={handleSaveScene}>保存</Button>
                    <Button size="small" onClick={() => setEditingSceneIndex(-1)}>取消</Button>
                  </Space>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "#666", whiteSpace: "pre-wrap" }}>
                  {scene.scene_prompt || "（未生成）"}
                </div>
              )}
            </div>
            {seg.audio_path && (
              <audio controls style={{ width: '100%', height: 36 }}>
                <source src={`http://localhost:8000${seg.audio_path}`} />
              </audio>
            )}
          </Card>
        )
      })}
      <Divider />
      <Space direction="vertical" style={{ width: "100%" }} size="middle">
        <Button type="primary" block size="large" icon={<VideoCameraOutlined />}
          onClick={handleSaveAndGenerate}>
          保存分镜并生成视频
        </Button>
        <Button block size="large" onClick={resetAll} icon={<ReloadOutlined />}>
          重新开始
        </Button>
      </Space>
    </Card>
  )

  // ▸▸▸ Render: Step 5 - Video Generation ▸▸▸
  const shotTotal = narrations.length
  const allShotsDone = shotTotal > 0 && Array.from({length: shotTotal}, (_, i) => i + 1).every(si => {
    const p = shotProgress[si]
    return p && p.status === "done"
  })

  const renderVideoGen = () => (
    <Card
      title={<span><VideoCameraOutlined style={{ marginRight: 6 }} />视频生成</span>}
      extra={<Button size="small" onClick={() => setCurrent(4)} icon={<ArrowLeftOutlined />}>返回分镜</Button>}
      style={{ maxWidth: 700 }}
    >
      {narrations.map((nar, i) => {
        const si = i + 1
        const prog = shotProgress[si]
        const statusColors = { generating: "processing", done: "success", failed: "error" }
        return (
          <div key={i} style={{ marginBottom: 12, padding: 12, borderRadius: 8, border: "1px solid #e8e8e8", background: "#fafafa" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <Space>
                <Tag color="purple">{STAGE_LABELS[nar.stage] || `分镜 ${si}`}</Tag>
                <Tag color="blue">{ttsResults[i]?.duration || 0}s</Tag>
                <Tag color={statusColors[prog?.status] || "default"}>
                  {prog?.status === "generating" ? "生成中..." : prog?.status === "done" ? "完成" : prog?.status === "failed" ? "失败" : "等待中"}
                </Tag>
              </Space>
              <Space>
                <Button size="small" onClick={async () => { try { const lr = await fetch("http://localhost:8000/api/media"); const ml = await lr.json(); const cur = ml.find(m => m.id === mediaId); const curPrompt = cur?.prompt || ""; for (const m of ml) { if (curPrompt && m.prompt !== curPrompt) continue; const sr = await fetch("http://localhost:8000/api/media/"+m.id+"/shots"); const shots = await sr.json(); const s = shots.find(sh => sh.shot_index === si); if (s && s.clip_path) { setShotProgress(p => ({ ...p, [si]: { status: s.status, progress: s.progress||100, video_path: s.clip_path, audio_path: s.audio_path||"" } })); if (!mediaId) setMediaId(m.id); break } } } catch(e){} }}>加载</Button>
                {(shotProgress[si]?.status === "done" || shotProgress[si]?.status === "failed") && <Button size="small" danger onClick={() => { setShotProgress(p => { const n = {...p}; delete n[si]; return n }) }}>清除</Button>}
                {prog?.status === "generating" ? (
                  <Button size="small" danger onClick={() => cancelShot(si)}>取消</Button>
                ) : (
                  <Button size="small" type="primary" onClick={() => generateSingleShot(si)} loading={false}>
                    {prog?.status === "done" ? "重新生成" : prog?.status === "failed" ? "重试" : "生成"}
                  </Button>
                )}
              </Space>
            </div>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 4, whiteSpace: "pre-wrap" }}><span style={{ color: "#999" }}>旁白：</span>
              {nar.voice_script?.substring(0, 60)}{(nar.voice_script?.length > 60) ? "..." : ""}
            </div>
            {editingSceneIndex === (mediaId + "_" + si) ? (
              <div style={{ marginBottom: 4 }}>
                <TextArea value={editSceneText} onChange={e => setEditSceneText(e.target.value)} rows={3} style={{ fontSize: 12, marginBottom: 4 }} />
                <Space size="small">
                  <Button size="small" type="primary" onClick={() => { const p = editSceneText; setScenes(prev => prev.map((s,idx) => idx===i ? {...s, scene_prompt: p} : s)); setEditingSceneIndex(-1) }}>保存</Button>
                  <Button size="small" onClick={() => setEditingSceneIndex(-1)}>取消</Button>
                </Space>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>
                <span style={{ color: "#999" }}>提示词：</span>
                {(scenes[i]?.scene_prompt || "").substring(0, 80)}{(scenes[i]?.scene_prompt?.length > 80) ? "..." : ""}
                <Button size="small" type="link" style={{ padding: 0, height: 20, fontSize: 11 }} onClick={() => { setEditingSceneIndex(mediaId + "_" + si); setEditSceneText(scenes[i]?.scene_prompt || "") }}>编辑</Button>
              </div>
            )}
            {prog?.status === "generating" && <Progress percent={prog.progress || 0} size="small" status="active" />}
            {prog?.status === "done" && prog.video_path && (
              <video controls style={{ width: "100%", maxHeight: 200, borderRadius: 8 }} src={"http://localhost:8000/uploads/" + prog.video_path.split(/[\\/]/).pop()} />
            )}
            {prog?.status === "failed" && <div style={{ color: "#e74c3c", fontSize: 12 }}>Failed: {prog.error || "Unknown error"}</div>}
          </div>
        )
      })}
      <Divider />
      <Space direction="vertical" style={{ width: "100%" }} size="middle">
        <Button block icon={<ThunderboltOutlined />} onClick={() => {
          for (let si = 1; si <= shotTotal; si++) {
            if (!shotProgress[si] || shotProgress[si].status !== "done") {
              generateSingleShot(si)
            }
          }
        }}>
          全部生成 ({shotTotal - Object.values(shotProgress).filter(p => p.status === "done").length} 个待生成)
        </Button>
        {allShotsDone && (
          <Button type="primary" block size="large" icon={<CheckCircleOutlined />} loading={composing} onClick={handleCompose}>
            合成视频
          </Button>
        )}
        {!allShotsDone && (
          <Alert type="info" message="Generate each clip individually, or use '全部生成' above." />
        )}
      </Space>
      {composedVideo && (
        <div style={{ marginTop: 12 }}>
          <Alert type="success" style={{ marginBottom: 8 }} message={`Composed! Media ID: ${compositionResult?.media_id || mediaId}`} />
          <video controls style={{ width: "100%", maxHeight: 360, borderRadius: 8 }} src={composedVideo} />
        </div>
      )}
      {compositionResult && !composedVideo && (
        <Alert type="info" style={{ marginTop: 12 }} message={`Composing... Media ID: ${compositionResult?.media_id || mediaId}`} />
      )}
    </Card>
  )

  // ▸▸▸ Loading overlay ▸▸▸
  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
        <div style={{ marginTop: 16, fontSize: 16, color: '#8c8c8c' }}>{loadingStep}</div>
        <div style={{ marginTop: 12, color: "#bbb", fontSize: 12 }}>请耐心等待，AI 正在处理中...</div>
      </div>
    )
  }

  // ▸▸▸ Main render ▸▸▸
  return (
    <div style={{ maxWidth: 780 }}>
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#142528' }}>
            智能分镜
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#8c8c8c' }}>
            旁白优先，真实时长驱动画面节奏
          </p>
        </div>
        <Tooltip title="恢复初始状态">
          <Button size="small" icon={<ReloadOutlined />} onClick={resetAll}>重置</Button>
        </Tooltip>
      </div>

      <Steps
        current={current}
        size="small"
        style={{ marginBottom: 24 }}
        onChange={(step) => {
          // Backward: always allow
          if (step < current) { setCurrent(step); return }
          // Forward one step: validate data exists
          if (step === current + 1) {
            if ((step === 1 && outline) || (step === 2 && narrations.length) || (step === 3 && ttsResults.length) || (step === 4 && scenes.length)) {
              setCurrent(step)
            }
          }
        }}
        items={[
          { title: '输入/选题', icon: <EditOutlined /> },
          { title: 'Outline', icon: <FileTextOutlined /> },
          { title: '旁白', icon: <SoundOutlined /> },
          { title: 'TTS 合成', icon: <AudioOutlined /> },
          { title: '分镜确认', icon: <CheckCircleOutlined /> },
          { title: '视频生成', icon: <VideoCameraOutlined /> },
        ]}
      />

      {current === 0 && renderInput()}
      {current === 1 && renderOutline()}
      {current === 2 && renderNarrations()}
      {current === 3 && renderTtsResults()}
      {current === 4 && renderFinalShots()}
      {current === 5 && renderVideoGen()}

      {current === 0 && (
        <Card size="small" style={{ marginTop: 20 }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>💡 智能分镜说明</span>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: '#8c8c8c', lineHeight: 2 }}>
            <li>有选题：直接用选题的 outline，跳过 outline 生成步骤</li>
            <li>无选题：输入自由文本，AI 自动生成 outline</li>
            <li>旁白内容优先，不凑字数，TTS 真实时长驱动画面节奏</li>
            <li>竞品模板可选，透传到旁白和分镜阶段做风格参考</li>
          </ul>
        </Card>
      )}
    </div>
  )
}

export default ScriptFirstErrorBoundary

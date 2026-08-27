import React, { useState, useEffect } from 'react'
import { Card, Input, Button, InputNumber, Space, Tag, Alert, Progress, message, Steps, Typography, Tabs, Modal, Drawer, List, Divider, Select } from 'antd'
import { EditOutlined, PlusOutlined, ThunderboltOutlined, DeleteOutlined, AudioOutlined, PictureOutlined, ArrowLeftOutlined, CopyOutlined, VideoCameraOutlined, PlayCircleOutlined, DownloadOutlined, SettingOutlined, FileTextOutlined, FolderOpenOutlined, SaveOutlined } from '@ant-design/icons'

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
  const [totalDuration, setTotalDuration] = useState(45)
  const [fullScript, setFullScript] = useState("")
  const [splitLoading, setSplitLoading] = useState(false)
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
  const [projectDirs, setProjectDirs] = useState([])
  const [selectedProjectDir, setSelectedProjectDir] = useState("current")
  const [projectLoading, setProjectLoading] = useState(false)
  const [regeneratingAudioIdx, setRegeneratingAudioIdx] = useState(-1)
  const [audioEpoch, setAudioEpoch] = useState(0)

  // maxStep 从数据自动推导：完成到哪个步骤
  const maxStep = composeResult ? 5 : clips.length > 0 ? 4 : scenes.length > 0 ? 3 : ttsResults.length > 0 ? 2 : narrations.length > 0 ? 1 : 0

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("kepu_state"))
      if (saved) {
        if (saved.topic) setTopic(saved.topic)
        if (saved.totalDuration) setTotalDuration(saved.totalDuration)
        if (saved.fullScript) setFullScript(saved.fullScript)
        if (saved.current !== undefined) setCurrent(saved.current)
        if (saved.narrations) setNarrations(saved.narrations)
        if (saved.ttsResults) setTtsResults(saved.ttsResults)
        if (saved.scenes) setScenes(saved.scenes)
        if (saved.clips) setClips(saved.clips)
        if (saved.composeResult) setComposeResult(saved.composeResult)
        if (saved.audioEpoch) setAudioEpoch(saved.audioEpoch)
        if (saved.activeTab) setActiveTab(saved.activeTab)
      }
    } catch (e) {}
    setLoaded(true)
  }, [])

  useEffect(() => {
    if (!loaded) return
    const state = { topic, totalDuration, fullScript, current, narrations, ttsResults, scenes, clips, composeResult, audioEpoch, activeTab }
    localStorage.setItem("kepu_state", JSON.stringify(state))
  }, [loaded, topic, totalDuration, fullScript, current, narrations, ttsResults, scenes, clips, composeResult, audioEpoch, activeTab])

  // 回到话题输入页时，如果 fullScript 为空但有旁白，从旁白重建
  useEffect(() => {
    if (current === 0 && !fullScript && narrations.length > 0) {
      const rebuilt = narrations.map(n => n.voice_script || "").filter(Boolean).join("\n\n")
      if (rebuilt) setFullScript(rebuilt)
    }
  }, [current, fullScript, narrations])

  const handleReset = () => {
    setTopic("")
    setTotalDuration(45)
    setNarrations([])
    setTtsResults([])
    setScenes([])
    setClips([])
    setComposeResult(null)
    setAudioEpoch(0)
    setFullScript("")
    setCurrent(0)
    localStorage.removeItem("kepu_state")
    message.info("已清除全部数据")
  }

  // 总时长由实际旁白字数决定（约 4 字/秒），而非镜头数×15
  const totalCharsOf = (list) => (list || []).reduce((s, n) => s + (n.voice_script || "").length, 0)

  const projectPayloadFrom = (n = narrations, t = ttsResults, s = scenes) => ({
    topic: topic || "",
    size: "9:16",
    resolution: "1080P",
    voice_id: "zh-CN-YunjianNeural",
    shots: (n || []).map((nar, i) => ({
      index: i,
      stage: nar?.stage || "body",
      voice_script: nar?.voice_script || "",
      scene_prompt: s?.[i]?.scene_prompt || "",
      duration: Number(t?.[i]?.duration || 0),
      video: `kepu_clip_${String(i + 1).padStart(2, "0")}.mp4`,
      audio: `kepu_audio_${String(i + 1).padStart(2, "0")}.mp3`,
    })),
  })

  const saveProjectToBackend = async (payload) => {
    const body = payload || projectPayloadFrom()
    const res = await fetch("http://localhost:8000/api/kepu/projects/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project: body }),
    })
    const data = await res.json()
    if (!res.ok || !data.ok) throw new Error(data.detail || "保存项目失败")
    return data
  }

  const saveProjectQuietly = async (payload) => {
    try {
      await saveProjectToBackend(payload)
      await fetchProjectDirs()
    } catch (e) {
      console.error("save project failed", e)
    }
  }

  const fetchProjectDirs = async () => {
    try {
      const res = await fetch("http://localhost:8000/api/kepu/projects/directories")
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.detail || "加载项目目录失败")
      const dirs = data.directories || []
      setProjectDirs(dirs)
      if (!dirs.some(d => d.key === selectedProjectDir)) setSelectedProjectDir("current")
    } catch (e) {
      console.error("fetch project dirs failed", e)
    }
  }

  const applyProjectData = (data, quiet = false) => {
    const project = data.project || {}
    const shots = Array.isArray(project.shots) ? project.shots : []
    const videoFiles = new Set(data.video_files || [])
    const audioFiles = new Set(data.audio_files || [])

    setTopic(project.topic || "")
    setFullScript(shots.map(s => s.voice_script || "").filter(Boolean).join("\n\n"))
    const nars = shots.map(s => ({
      voice_script: s.voice_script || "",
      stage: s.stage || "body",
      index: Number(s.index ?? 0),
    }))
    setNarrations(nars)

    const nextTts = shots.map(s => ({
      index: Number(s.index ?? 0),
      audio_path: s.audio && audioFiles.has(s.audio) ? `/uploads/clip/${s.audio}` : "",
      duration: Number(s.duration || 0),
      text: s.voice_script || "",
    }))
    setTtsResults(nextTts)

    setScenes(shots.map(s => ({ scene_prompt: s.scene_prompt || "", stage: s.stage || "body" })))

    const nextClips = shots.map(s => {
      const hasVideo = Boolean(s.video && videoFiles.has(s.video))
      return {
        video_path: hasVideo ? `http://localhost:8000/uploads/clip/${s.video}` : "",
        prompt: s.scene_prompt || "",
        status: hasVideo ? "done" : "error",
        error: hasVideo ? "" : "视频不存在",
      }
    })
    setClips(nextClips)
    setComposeResult(null)
    setAudioEpoch(Date.now())
    setTotalDuration(Math.max(15, Math.ceil(nars.reduce((sum, n) => sum + (n.voice_script || "").length, 0) / 4)))

    const hasVideo = shots.some(s => s.video && videoFiles.has(s.video))
    const hasScene = shots.some(s => (s.scene_prompt || "").trim())
    const hasAudio = shots.some(s => s.audio && audioFiles.has(s.audio))
    setCurrent(hasVideo ? 4 : hasScene ? 3 : hasAudio ? 2 : shots.length ? 1 : 0)
    if (!quiet) message.success("项目已加载")
  }

  const handleLoadProject = async () => {
    if (!selectedProjectDir) return
    setProjectLoading(true)
    try {
      const res = await fetch("http://localhost:8000/api/kepu/projects/load", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir: selectedProjectDir }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.detail || "载入项目失败")
      applyProjectData(data)
      await fetchProjectDirs()
    } catch (e) {
      message.error("载入项目失败: " + e.message)
    } finally {
      setProjectLoading(false)
    }
  }

  const loadCurrentProject = async (quiet = false) => {
    setProjectLoading(true)
    try {
      const res = await fetch("http://localhost:8000/api/kepu/projects/load", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir: "current" }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.detail || "加载项目失败")
      applyProjectData(data, quiet)
      setSelectedProjectDir("current")
      await fetchProjectDirs()
    } catch (e) {
      if (quiet) console.error("auto load current project failed", e)
      else message.error("加载项目失败: " + e.message)
    } finally {
      setProjectLoading(false)
    }
  }

  useEffect(() => {
    if (loaded) {
      loadCurrentProject(true)
    }
  }, [loaded])

  const handleSaveCurrentProject = async () => {
    try {
      await saveProjectToBackend(projectPayloadFrom())
      await fetchProjectDirs()
      message.success("当前项目已保存")
    } catch (e) {
      message.error("保存项目失败: " + e.message)
    }
  }

  useEffect(() => { fetchProjectDirs() }, [])

  const handleGenerateFullScript = async () => {
    if (!topic.trim()) { message.warning("请输入话题"); return }
    setLoading(true)
    setLoadingStep("正在生成连续剧本...")
    try {
      const res = await fetch("http://localhost:8000/api/kepu/full-script", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topic.trim(), total_duration: totalDuration }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.detail || "生成失败")
      setFullScript(data.full_text)
      message.success("连续剧本生成成功，可编辑后拆分")
    } catch (e) {
      message.error("生成失败: " + e.message)
    } finally { setLoading(false) }
  }

  const handleSplitScript = async () => {
    if (!fullScript.trim()) { message.warning("请先生成剧本"); return }
    setSplitLoading(true)
    setLoadingStep("正在拆分为分镜...")
    try {
      const res = await fetch("http://localhost:8000/api/kepu/split-script", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_text: fullScript.trim(), total_duration: totalDuration }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.detail || "拆分失败")
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
      // 总时长由实际旁白字数决定（约4字/秒），而非镜头数×15
      setTotalDuration(Math.max(15, Math.ceil(totalCharsOf(nars) / 4)))
      setCurrent(1)
      await saveProjectQuietly(projectPayloadFrom(nars, [], []))
      message.success(`分镜拆分完成，共 ${nars.length} 个镜头`)
    } catch (e) {
      message.error("拆分失败: " + e.message)
    } finally { setSplitLoading(false) }
  }

  const handleAddBody = () => {
    const endingItem = narrations.find(n => n.stage === "ending")
    const endingIdx = narrations.indexOf(endingItem)
    const bodyCount = narrations.filter(n => n.stage === "body").length
    const newBody = { voice_script: "", stage: "body", index: bodyCount + 1 }
    const updated = [...narrations]
    updated.splice(endingIdx, 0, newBody)
    updated.forEach((n, i) => {
      if (n.stage === "body") n.index = updated.filter((x, k) => x.stage === "body" && k <= i).length
    })
    setNarrations(updated)
    setTotalDuration(Math.max(15, Math.ceil(totalCharsOf(updated) / 4)))
    message.success("已添加正文分镜")
  }

  const handleAddBodyAfter = (i) => {
    const bodyCount = narrations.filter(n => n.stage === "body").length
    const newBody = { voice_script: "", stage: "body", index: bodyCount + 1 }
    const updated = [...narrations]
    updated.splice(i + 1, 0, newBody)
    updated.forEach((n, idx) => {
      if (n.stage === "body") n.index = updated.filter((x, k) => x.stage === "body" && k <= idx).length
    })
    setNarrations(updated)
    setTotalDuration(Math.max(15, Math.ceil(totalCharsOf(updated) / 4)))
    message.success("已添加正文分镜")
  }
  const handleEdit = (i) => { setEditingIndex(i); setEditText(narrations[i]?.voice_script || "") }
  const handleSaveEdit = (i) => {
    const u = [...narrations]; u[i] = { ...u[i], voice_script: editText }; setNarrations(u); setEditingIndex(-1)
    saveProjectQuietly(projectPayloadFrom(u, ttsResults, scenes))
  }
  const handleEditScene = (i) => {
    setEditingSceneIdx(i)
    setEditSceneText(scenes[i]?.scene_prompt || "")
  }

  const handleSaveScene = (i) => {
    const u = [...scenes]
    u[i] = { ...u[i], scene_prompt: editSceneText }
    setScenes(u)
    setEditingSceneIdx(-1)
    saveProjectQuietly(projectPayloadFrom(narrations, ttsResults, u))
  }

  const handleDelete = (i) => {
    const nar = narrations[i]
    if (nar.stage === "hook" || nar.stage === "ending") { message.warning("钩子和结尾不能删除"); return }
    if (narrations.filter(n => n.stage === "body").length <= 1) { message.warning("至少保留1段正文"); return }
    const u = narrations.filter((_, j) => j !== i)
    u.forEach((n, idx) => {
      if (n.stage === "body") n.index = u.filter((x, k) => x.stage === "body" && k <= idx).length
    })
    setNarrations(u)
    setTotalDuration(Math.max(15, Math.ceil(totalCharsOf(u) / 4)))
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
    await saveProjectQuietly(projectPayloadFrom(narrations, ttsResults, scenes))
    try {
      const res = await fetch("http://localhost:8000/api/kepu/tts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ narrations: valid }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || "失败")
      setTtsResults(data.segments)
      await saveProjectQuietly(projectPayloadFrom(narrations, data.segments, scenes))
      setCurrent(2)
      const failedCount = (data.segments || []).filter(s => !s.audio_path).length
      if (failedCount > 0) {
        message.warning(`TTS 合成完成，但有 ${failedCount} 段配音生成失败（未生成音频文件），请检查 TTS 服务/网络后重试`)
      } else {
        message.success("TTS合成成功")
      }
    } catch (e) {
      message.error("失败: " + e.message)
    } finally { setLoading(false) }
  }

  const handleRegenerateAudio = async (i) => {
    const nar = narrations[i]
    if (!nar?.voice_script?.trim()) { message.warning("无旁白内容"); return }
    setRegeneratingAudioIdx(i)
    try {
      const res = await fetch("http://localhost:8000/api/kepu/tts/single", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: nar.voice_script, index: i }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.detail || "音频生成失败")
      const u = [...ttsResults]
      u[i] = { ...u[i], ...data.segment }
      setTtsResults(u)
      setAudioEpoch(Date.now())
      await saveProjectQuietly(projectPayloadFrom(narrations, u, scenes))
      message.success("分镜 " + (i + 1) + " 音频已重新生成")
    } catch (e) {
      message.error("音频生成失败: " + e.message)
    } finally {
      setRegeneratingAudioIdx(-1)
    }
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
      await saveProjectQuietly(projectPayloadFrom(narrations, ttsResults, data.scenes))
      setCurrent(3)
      message.success("分镜提示词生成成功")
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
    const scenesForSave = [...scenes]
    if (promptToUse !== scene?.scene_prompt) {
      scenesForSave[sceneIdx] = { ...scenesForSave[sceneIdx], scene_prompt: promptToUse }
    }
    await saveProjectQuietly(projectPayloadFrom(narrations, ttsResults, scenesForSave))
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
      await saveProjectQuietly(projectPayloadFrom(narrations, ttsResults, scenesForSave))
      message.success("分镜 " + (sceneIdx + 1) + " 生成完成")
    } catch (e) {
      const newClips = [...clips]
      newClips[sceneIdx] = { ...newClips[sceneIdx], status: "error", error: e.message }
      setClips(newClips)
      message.error("生成失败: " + e.message)
    }
  }

  const handleCopyScenes = async () => {
    if (!scenes.length) { message.warning("暂无分镜提示词"); return }
    const stageMap = { hook: "钩子", body: "正文", ending: "结尾", evidence: "论据", scene: "场景", cta: "行动号召" }
    const text = scenes.map((scene, i) => {
      const nar = narrations[i] || {}
      const tts = ttsResults[i] || {}
      const stageLabel = scene?.stage && stageMap[scene.stage] ? `（${stageMap[scene.stage]}）` : ""
      return `【分镜 ${i + 1}${stageLabel}】${tts?.duration ? ` ${tts.duration}s` : ""}\n旁白：${nar.voice_script || ""}\n提示词：${scene?.scene_prompt || ""}`
    }).join("\n\n")
    try {
      await navigator.clipboard.writeText(text)
      message.success("已复制全部分镜文案")
    } catch (e) {
      message.error("复制失败，请检查浏览器剪贴板权限")
    }
  }
  const handleCompose = async () => {
    if (!clips.length) { message.warning("无视频片段"); return }
    const composedClips = clips.map((clip, i) => {
      const tts = ttsResults[i] || {}
      const nar = narrations[i] || {}
      return {
        video_path: `/uploads/clip/kepu_clip_${String(i + 1).padStart(2, "0")}.mp4`,
        audio_path: tts.audio_path || "",
        subtitle: nar.voice_script || "",
        duration: tts.duration || 5,
      }
    })
    setComposeLoading(true)
    try {
      const res = await fetch("http://localhost:8000/api/kepu/compose", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clips: composedClips, size: "9:16", resolution: "1080P", topic }),
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
      const keyMap = { full_script: "kepu_full_script_prompt.txt", split_script: "kepu_split_script_prompt.txt", scene: "kepu_scene_prompt.txt" }
      const key = keyMap[file.key] || file.filename
      setEditingContent(data.prompts?.[key] || "")
    } catch (e) { setEditingContent("") }
    setConfigDrawerOpen(true)
  }
  const handleSaveConfig = async () => {
    if (!editingFile) return
    setSavingConfig(true)
    try {
      const keyMap2 = { full_script: "kepu_full_script_prompt.txt", split_script: "kepu_split_script_prompt.txt", scene: "kepu_scene_prompt.txt" }
      const key = keyMap2[editingFile.key] || editingFile.filename
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
    { key: "full_script", filename: "kepu_full_script_prompt.txt", description: "连续剧本提示词" },
    { key: "split_script", filename: "kepu_split_script_prompt.txt", description: "分镜拆分提示词" },
    { key: "scene", filename: "kepu_scene_prompt.txt", description: "分镜画面提示词" },
  ]

  const renderModifyShot = (i) => {
    const nar = narrations[i] || {}
    const tts = ttsResults[i] || {}
    const scene = scenes[i] || {}
    const clip = clips[i] || { status: "pending", video_path: "", error: "" }
    const isAudioRegen = regeneratingAudioIdx === i
    const isVideoGen = clip.status === "generating"
    const audioSrc = tts.audio_path
      ? (tts.audio_path.startsWith("http://") || tts.audio_path.startsWith("https://")
        ? tts.audio_path
        : "http://localhost:8000" + tts.audio_path) + "?v=" + (audioEpoch || 0)
      : ""
    const stageMap = { hook: "钩子", body: "正文", ending: "结尾", evidence: "论据", scene: "场景", cta: "行动号召" }
    const stageLabel = nar.stage && stageMap[nar.stage] ? ` · ${stageMap[nar.stage]}` : ""
    return (
      <Card key={i} size="small" title={`分镜 ${i + 1}${stageLabel}`} style={{ marginBottom: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Text strong>旁白</Text>
              {editingIndex === i ? (
                <Button size="small" type="primary" onClick={() => handleSaveEdit(i)}>保存</Button>
              ) : (
                <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(i)}>编辑</Button>
              )}
            </div>
            {editingIndex === i ? (
              <TextArea value={editText} onChange={e => setEditText(e.target.value)} rows={4} style={{ marginTop: 8 }} />
            ) : (
              <div style={{ whiteSpace: "pre-wrap", marginTop: 8, color: nar.voice_script ? "rgba(0,0,0,0.85)" : "#8c8c8c" }}>
                {nar.voice_script || "暂无旁白"}
              </div>
            )}
            {audioSrc ? (
              <audio controls style={{ width: "100%", marginTop: 8, height: 32 }} src={audioSrc} />
            ) : (
              <Alert type="warning" message="暂无音频" style={{ marginTop: 8 }} />
            )}
            <Button
              size="small"
              icon={<AudioOutlined />}
              loading={isAudioRegen}
              disabled={!nar.voice_script?.trim()}
              onClick={() => handleRegenerateAudio(i)}
              style={{ marginTop: 8 }}
            >
              重新生成音频
            </Button>
          </div>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Text strong>分镜提示词</Text>
              {editingSceneIdx === i ? (
                <Button size="small" type="primary" onClick={() => handleSaveScene(i)}>保存</Button>
              ) : (
                <Button size="small" icon={<EditOutlined />} onClick={() => handleEditScene(i)}>编辑</Button>
              )}
            </div>
            {editingSceneIdx === i ? (
              <TextArea value={editSceneText} onChange={e => setEditSceneText(e.target.value)} rows={5} style={{ marginTop: 8 }} />
            ) : (
              <div style={{ whiteSpace: "pre-wrap", marginTop: 8, color: scene.scene_prompt ? "rgba(0,0,0,0.85)" : "#8c8c8c" }}>
                {scene.scene_prompt || "暂无分镜提示词"}
              </div>
            )}
            {clip.video_path ? (
              <video controls style={{ width: "100%", maxHeight: 220, borderRadius: 8, background: "#000", marginTop: 8 }} src={clip.video_path} />
            ) : (
              <Alert type="warning" message={clip.error || "暂无视频"} style={{ marginTop: 8 }} />
            )}
            <Button
              size="small"
              type="primary"
              icon={<VideoCameraOutlined />}
              loading={isVideoGen}
              disabled={isVideoGen || !scene.scene_prompt?.trim()}
              onClick={() => handleGenerateSingleClip(i)}
              style={{ marginTop: 8 }}
            >
              重新生成视频
            </Button>
            {clip.error && clip.status !== "generating" ? (
              <div style={{ color: "#cf1322", marginTop: 8 }}>{clip.error}</div>
            ) : null}
          </div>
        </div>
      </Card>
    )
  }

  const tabItems = [
    {
      key: "studio",
      label: "创作工作台",
      children: (
        <div style={{ maxWidth: 900 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
            <Title level={3} style={{ margin: 0 }}>科普创作</Title>
            <Space wrap>
              <Button size="small" danger onClick={handleReset}>清除全部</Button>
            </Space>
          </div>
          <Steps current={current} items={stepItems} size="small" style={{ marginBottom: 24 }} onChange={(step) => { if (step <= maxStep) setCurrent(step) }} />
          {current === 0 && (
            <Card title="话题输入" style={{ maxWidth: 700 }}>
              <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                <div>
                  <Text strong>输入话题</Text>
                  <TextArea value={topic} onChange={e => setTopic(e.target.value)} placeholder="例如：酱油为什么这么鲜" rows={3} style={{ marginTop: 8 }} />
                </div>
                <div>
                  <Text strong>总时长</Text>
                  <InputNumber min={15} max={300} step={5} value={totalDuration} onChange={v => setTotalDuration(v || 45)} style={{ marginLeft: 12, width: 100 }} addonAfter="秒" />
                  <Text type="secondary" style={{ marginLeft: 12 }}>分镜数量由 AI 按内容决定</Text>
                </div>

                <Button type="primary" icon={<ThunderboltOutlined />} onClick={handleGenerateFullScript} loading={loading && !splitLoading} block>
                  步骤1：生成连续剧本
                </Button>

                {fullScript && (
                  <>
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                        <Text strong>连续剧本（可编辑）</Text>
                        <Text type="secondary">{fullScript.replace(/\s/g, "").length} 字</Text>
                      </div>
                      <TextArea
                        value={fullScript}
                        onChange={e => setFullScript(e.target.value)}
                        rows={12}
                        style={{ fontFamily: "inherit" }}
                      />
                    </div>
                    <Button
                      type="primary"
                      icon={<ThunderboltOutlined />}
                      onClick={handleSplitScript}
                      loading={splitLoading}
                      block
                      style={{ background: "#52c41a", borderColor: "#52c41a" }}
                    >
                      步骤2：拆分为分镜（数量由 AI 决定）
                    </Button>
                  </>
                )}

              </Space>
            </Card>
          )}
          {current === 1 && (
            <Card title="旁白分镜"
              extra={<Space><Text type="secondary" style={{ fontSize: 12 }}>预估总时长：{Math.round(narrations.reduce((sum, n) => sum + (n.voice_script || "").length, 0) / 4.0)}s / {totalDuration}s</Text><Button size="small" onClick={() => setCurrent(0)} icon={<ArrowLeftOutlined />}>返回</Button></Space>}
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
                    <Tag color={charCount > 60 ? "red" : "default"}>{charCount}字 {estDuration}s{charCount > 60 ? " !" : ""}</Tag>
                    {editingIndex !== i && (
                      <Space size={0}>
                        <Button size="small" type="text" icon={<EditOutlined />} onClick={() => handleEdit(i)} />
                        {nar.stage === "body" && (
                          <>
                            <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => handleDelete(i)} />
                            <Button size="small" type="text" icon={<PlusOutlined />} onClick={() => handleAddBodyAfter(i)} />
                          </>
                        )}
                      </Space>
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
                <Button icon={<EditOutlined />} onClick={handleAddBody}>添加正文</Button>
                <Button type="primary" icon={<AudioOutlined />} onClick={handleTts} loading={loading}>生成TTS</Button>
              </Space>
            </Card>
          )}
          {current === 2 && (
            <Card title="配音合成"
              extra={<Space><Text type="secondary" style={{ fontSize: 12 }}>音频总时长：{ttsResults.reduce((sum, r) => sum + r.duration, 0).toFixed(1)}s</Text><Button size="small" onClick={() => setCurrent(1)} icon={<ArrowLeftOutlined />}>返回</Button></Space>}
              style={{ maxWidth: 700 }}>
              {narrations.filter(n => n.voice_script.trim()).map((nar, i) => {
                const tts = ttsResults[i]
                return (
                  <div key={i} style={{ marginBottom: 12, padding: 12, borderRadius: 8, border: "1px solid #e8e8e8", background: "#fafafa" }}>
                    <Space><Tag color="blue">第{i + 1} 分镜</Tag>{tts && <Tag color="green">{tts.duration}s</Tag>}</Space>
                    <div style={{ fontSize: 13, color: "#666", marginTop: 4, whiteSpace: "pre-wrap", lineHeight: 1.7, wordBreak: "break-word" }}>{nar.voice_script}</div>
                    {tts?.audio_path ? (
                      <audio controls style={{ width: "100%", marginTop: 8, height: 32 }} src={"http://localhost:8000" + tts.audio_path + "?v=" + (audioEpoch || 0)} />
                    ) : (
                      <div style={{ marginTop: 8, fontSize: 12, color: "#fa8c16" }}>⚠️ 该段配音生成失败，无音频可播放（TTS 服务/网络异常）</div>
                    )}
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
                    </Space>
                    <div style={{ fontSize: 12, color: "#666", marginBottom: 8, whiteSpace: "pre-wrap", lineHeight: 1.6, wordBreak: "break-word" }}>旁白：{nar?.voice_script || ""}</div>
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
              <Button icon={<CopyOutlined />} onClick={handleCopyScenes} block style={{ marginTop: 12 }}>复制全部分镜文案</Button>
              <Button type="primary" icon={<VideoCameraOutlined />} onClick={() => { setClips(new Array(scenes.length).fill({ video_path: "", status: "pending", error: "" })); setCurrent(4) }} style={{ marginTop: 8 }} block>
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
                      <Button size="small" type="primary" icon={<VideoCameraOutlined />} loading={isGenerating}
                        onClick={() => handleGenerateSingleClip(i)} disabled={isGenerating}>
                        {isDone ? "重新生成" : isGenerating ? "生成中..." : "生成"}
                      </Button>
                      {!isGenerating && (
                        <Button size="small" icon={<EditOutlined />}
                          onClick={() => { setClipEditIdx(i); setClipEditText(scene?.scene_prompt || "") }}>编辑提示词</Button>
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
                      src={"http://localhost:8000/uploads/" + (composeResult.path || "").split("/").pop().split("\\").pop()} />
                  </div>
                  <Space style={{ marginTop: 16 }}>
                    <Button type="primary" icon={<DownloadOutlined />}
                      onClick={() => { window.open("http://localhost:8000/uploads/" + (composeResult.path || "").split("/").pop().split("\\").pop(), "_blank") }}>下载视频</Button>
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
        </div>
      ),
    },
    {
      key: "modify",
      label: "修改创作",
      icon: <EditOutlined />,
      children: (
        <div style={{ maxWidth: 1100 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
            <Title level={3} style={{ margin: 0 }}>修改创作</Title>
            <Space wrap>
              <Select
                size="middle"
                style={{ width: 240 }}
                value={selectedProjectDir}
                onChange={setSelectedProjectDir}
                options={(projectDirs || []).map(d => ({ value: d.key, label: d.label }))}
                placeholder="选择要导入的项目目录"
              />
              <Button type="primary" icon={<FolderOpenOutlined />} loading={projectLoading} onClick={handleLoadProject}>导入</Button>
            </Space>
          </div>
          {narrations.length === 0 ? (
            <Alert
              type="info"
              showIcon
              message="请先选择项目目录并点击导入"
              description="导入后会展示每个分镜的旁白、音频、分镜提示词和视频，并支持单独编辑或重新生成。"
            />
          ) : (
            <>
              <div style={{ marginBottom: 12 }}>
                <Text type="secondary">当前导入目录：{selectedProjectDir} · 共 {narrations.length} 个分镜</Text>
              </div>
              {narrations.map((_, i) => renderModifyShot(i))}
            </>
          )}
        </div>
      ),
    },
  ]

  return (
    <div>
      <Tabs
        activeKey={activeTab}
        onChange={(key) => {
          setActiveTab(key)
          if (key === "modify") loadCurrentProject(true)
        }}
        items={tabItems}
      />
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

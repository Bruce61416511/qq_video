import { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Steps, Input, Button, Card, App, Select, Tabs, Drawer, List, Modal,
  Space, Tag, Tooltip, Alert, Popconfirm, Divider, Progress, Timeline, Typography
} from 'antd'
import {
  ThunderboltOutlined, LoadingOutlined, CheckCircleOutlined,
  EditOutlined, FileTextOutlined, FileProtectOutlined, SettingOutlined,
  ReloadOutlined, ArrowRightOutlined,
  ArrowLeftOutlined, VideoCameraOutlined, EyeOutlined
} from '@ant-design/icons'
import { mediaApi, trendsApi } from '../services/api'

const { TextArea } = Input

const SIZE_OPTIONS = [
  { value: '9:16', label: '9:16 竖屏' },
  { value: '16:9', label: '16:9 横屏' },
  { value: '1:1', label: '1:1 方形' },
]

const RESOLUTION_OPTIONS = [
  { value: '720P', label: '720P' },
  { value: '1080P', label: '1080P' },
]

const DURATION_OPTIONS = [
  { value: '3', label: '3秒' },
  { value: '5', label: '5秒' },
  { value: '10', label: '10秒' },
  { value: '15', label: '15秒' },
  { value: '30', label: '30秒' },
]

export default function TextToVideo() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { message } = App.useApp()

  // Video topics from trends
  const [videoTopics, setVideoTopics] = useState([])
  const [selectedTopicId, setSelectedTopicId] = useState(null)
  const [selectedTopic, setSelectedTopic] = useState(null)
  const [selectedTemplateId, setSelectedTemplateId] = useState(null)
  const [competitorTemplates, setCompetitorTemplates] = useState([])
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewData, setPreviewData] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [activeTab, setActiveTab] = useState("video")
  const [configDrawerOpen, setConfigDrawerOpen] = useState(false)
  const [editingFile, setEditingFile] = useState(null)
  const [editingContent, setEditingContent] = useState("")
  const [savingConfig, setSavingConfig] = useState(false)
  const [configFiles] = useState([
    { key: "shot_topic_prompt", filename: "shot_topic_prompt.txt", description: "选题拆镜提示词", exists: true },
    { key: "manual_topic_prompt", filename: "manual_topic_prompt.txt", description: "手动拆镜提示词", exists: true },
  ])

  // Load video topics on mount
  useEffect(() => {
    trendsApi.getTopicData().then(data => {
      if (data && data.topics) setVideoTopics(data.topics)
    }).catch(() => {})
    fetch("http://localhost:8000/api/media/competitor-templates")
      .then(r => r.json()).then(d => setCompetitorTemplates(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])
  // Auto-select topic from URL param (from TrendBoard)
  useEffect(() => {
    const idx = searchParams.get("topic")
    if (idx != null && videoTopics.length > 0) {
      handleTopicSelect(parseInt(idx))
    }
  }, [videoTopics, searchParams])

  // 切换路由后恢复分镜状态
  useEffect(() => {
    try {
      const saved = localStorage.getItem("text_to_video_state")
      if (saved) {
        const state = JSON.parse(saved)
        if (state.shots && state.shots.length) setShots(state.shots)
        if (state.current != null) setCurrent(state.current)
        if (state.selectedTopic) setSelectedTopic(state.selectedTopic)
        if (state.selectedTopicId != null) setSelectedTopicId(state.selectedTopicId)
        if (state.selectedTemplateId != null) setSelectedTemplateId(state.selectedTemplateId)
      }
    } catch (e) {}
  }, [])


  // Step state
  const [current, setCurrent] = useState(0)

  // Step 1 - inputs
  const [topic, setTopic] = useState('')
  const [size, setSize] = useState('9:16')
  const [resolution, setResolution] = useState('1080P')
  const [shotCount, setShotCount] = useState(3)
  const [shotDuration, setShotDuration] = useState('5')

  // Handle topic selection from dropdown
  const markTopicUsed = (topic) => {
    const sourceTitle = topic?.source_title || topic?.video_topic || ""
    const id = sourceTitle || Date.now().toString()
    setUsedTopics(prev => {
      const next = prev.includes(id) ? prev : [...prev, id]
      localStorage.setItem("used_topic_ids", JSON.stringify(next))
      return next
    })
  }
  const isTopicUsed = (topic) => {
    const sourceTitle = topic?.source_title || topic?.video_topic || ""
    return usedTopics.includes(sourceTitle)
  }

  const handleTopicSelect = (idx) => {
    if (idx === undefined || idx === null) {
      setSelectedTopicId(null)
      setSelectedTopic(null)
      setShots([])
      setCurrent(0)
      localStorage.removeItem("text_to_video_state")
      return
    }
    const t = videoTopics[idx]
    if (!t) { setSelectedTopicId(null); setSelectedTopic(null); return }
    setSelectedTopicId(idx)
    setSelectedTopic(t)
    // Auto-calculate
    const outlineLen = t.content_outline?.length || 3
    const totalDur = t.duration || 45
    setShotCount(outlineLen + 2)
    setShotDuration(String(Math.max(3, Math.floor(totalDur / (outlineLen + 2)))))
  }

  // Step 2 - shots
  const [shots, setShots] = useState([])
  const [usedTopics, setUsedTopics] = useState(() => {
    try { return JSON.parse(localStorage.getItem("used_topic_ids") || "[]") } catch { return [] }
  })
  const [shotsLoading, setShotsLoading] = useState(false)
  // 持久化分镜状态到 localStorage（仅在有数据时保存，防止空状态覆盖）
  useEffect(() => {
    if (shots.length > 0 || selectedTopic) {
      const state = { shots, current, selectedTopic, selectedTopicId, selectedTemplateId }
      localStorage.setItem("text_to_video_state", JSON.stringify(state))
    }
  }, [shots, current, selectedTopic, selectedTopicId, selectedTemplateId])

  const [regeneratingIndex, setRegeneratingIndex] = useState(-1)

  // Step 3 - generating
  const [generating, setGenerating] = useState(false)
  const [resultMedia, setResultMedia] = useState(null)

  // Generate shot plan
  const openConfigEditor = async (file) => {
    setEditingFile(file)
    setConfigDrawerOpen(true)
    try { const res = await trendsApi.getConfigFile(file.key); setEditingContent(res.content || "") } catch (e) { setEditingContent("") }
  }

  const handleSaveConfig = async () => {
    if (!editingFile) return
    setSavingConfig(true)
    try { await trendsApi.saveConfigFile(editingFile.key, editingContent); message.success(editingFile.filename + " 已保存"); setConfigDrawerOpen(false) } catch (e) { message.error(e.message) }
    finally { setSavingConfig(false) }
  }

  const handleGenerateShots = useCallback(async () => {
    if (selectedTopic) {
      setShotsLoading(true)
      try {
        const topicWithTemplate = { ...selectedTopic }
        if (selectedTemplateId) {
          const tpl = competitorTemplates.find(t => t.id === selectedTemplateId)
          if (tpl) topicWithTemplate.competitor_framework = tpl.framework
        }
        const data = await mediaApi.generateShotsFromTopic(topicWithTemplate)
        setShots(data.shots || [])
        setCurrent(1)
        markTopicUsed(selectedTopic)
        message.success(`已生成 ${data.shots.length} 个分镜方案`)
      } catch (e) {
        message.error('生成分镜失败: ' + e.message)
      } finally {
        setShotsLoading(false)
      }
      return
    }
    if (!topic.trim()) { message.warning('请输入视频主题'); return }
    setShotsLoading(true)
    try {
      let data
      if (selectedTemplateId) {
        const tpl = competitorTemplates.find(t => t.id === selectedTemplateId)
        const manualData = { video_topic: topic.trim(), angle: '', hook: topic.trim().substring(0, 30), hook_type: '', content_outline: topic.trim().split(/[\n,，]/).filter(Boolean), target_emotion: '', product_link: '', duration: parseInt(shotDuration) * (parseInt(shotCount) || 3) }
        if (tpl) manualData.competitor_framework = tpl.framework
        data = await mediaApi.generateShotsFromTopic(manualData)
      } else {
        data = await mediaApi.generateShots(topic.trim(), shotCount, shotDuration)
      }
      setShots(data.shots || [])
      setCurrent(1)
      message.success(`已生成 ${data.shots.length} 个分镜方案`)
    } catch (e) {
      message.error('生成分镜失败: ' + e.message)
    } finally {
      setShotsLoading(false)
    }
  }, [topic, shotCount, shotDuration, selectedTopic, message])

  // Update a shot field
  const updateShot = (index, field, value) => {
    setShots(prev => prev.map((s, i) => i === index ? { ...s, [field]: value } : s))
  }

  // Regenerate single shot
  const regenerateShot = async (index) => {
    setRegeneratingIndex(index)
    try {
      const data = await mediaApi.generateShots(topic.trim(), 1, shotDuration)
      if (data.shots && data.shots.length > 0) {
        updateShot(index, 'scene_prompt', data.shots[0].scene_prompt)
        updateShot(index, 'voice_script', data.shots[0].voice_script)
      }
    } catch (e) {
      message.error('重新生成失败')
    } finally {
      setRegeneratingIndex(-1)
    }
  }

  // Regenerate all shots
  const regenerateAll = async () => {
    setShotsLoading(true)
    try {
      const data = await mediaApi.generateShots(topic.trim(), shotCount, shotDuration)
      setShots(data.shots || [])
      message.success(`已重新生成 ${data.shots.length} 个分镜`)
    } catch (e) {
      message.error('重新生成失败: ' + e.message)
    } finally {
      setShotsLoading(false)
    }
  }

  // Step 3: submit to backend
  const handleSubmitGenerate = async () => {
    setGenerating(true)
    setCurrent(2)
    try {
      const media = await mediaApi.generate(topic.trim(), size, resolution, shots)
      setResultMedia(media)
      message.success('视频生成任务已提交！前往素材库查看进度')
    } catch (e) {
      message.error('提交失败: ' + e.message)
    } finally {
      setGenerating(false)
    }
  }

  // Reset
  const resetAll = () => {
    setCurrent(0)
    setShots([])
    setResultMedia(null)
  }

  // ---------- Step 1: Input ----------
  const renderStep1 = () => (
    <Card>
      {videoTopics.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <span style={{ fontWeight: 600, fontSize: 14, display: 'block', marginBottom: 8 }}>
            📋 从今日选题中选择
          </span>
          <Select
            placeholder="手动输入 或 选择一个选题..."
            style={{ width: '100%' }}
            allowClear
            value={selectedTopicId}
            onChange={handleTopicSelect}
            options={videoTopics.map((t, i) => ({
              value: i,
              label: `${i + 1}. ${t.video_topic || t.source_title?.substring(0, 40)}`,
            }))}
          />
        </div>
      )}

      {selectedTopic ? (
        <div>
          <Card size="small" style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>选题确认</div>
            <div style={{ fontSize: 12, lineHeight: 1.8 }}>
              <div style={{ display: 'flex', marginBottom: 2 }}>
                <span style={{ color: '#888', width: 56, flexShrink: 0 }}>标题</span>
                <span style={{ fontWeight: 500 }}>{selectedTopic.video_topic}</span>
              </div>
              {selectedTopic.angle && (
                <div style={{ display: 'flex', marginBottom: 2 }}>
                  <span style={{ color: '#888', width: 56, flexShrink: 0 }}>角度</span>
                  <span style={{ color: '#555' }}>{selectedTopic.angle}</span>
                </div>
              )}
              <div style={{ display: 'flex', marginBottom: 2 }}>
                <span style={{ color: '#888', width: 56, flexShrink: 0 }}>钩子</span>
                <span>
                  {selectedTopic.hook_type && <Tag color="orange" style={{fontSize:10}}>{selectedTopic.hook_type}</Tag>}
                  <span style={{color:'#e67e22',fontWeight:500}}>{selectedTopic.hook}</span>
                </span>
              </div>
              {selectedTopic.content_outline?.length > 0 && (
                <div style={{ display: 'flex', marginBottom: 2 }}>
                  <span style={{ color: '#888', width: 56, flexShrink: 0 }}>要点</span>
                  <span>
                    {selectedTopic.content_outline.map((p, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 4, marginBottom: 2 }}>
                        <span style={{ width: 4, height: 4, borderRadius: 2, background: '#888', flexShrink: 0, marginTop: 7 }} />
                        <span style={{ color: '#333' }}>{p}</span>
                      </div>
                    ))}
                  </span>
                </div>
              )}
              {selectedTopic.target_emotion && (
                <div style={{ display: 'flex', marginBottom: 2 }}>
                  <span style={{ color: '#888', width: 56, flexShrink: 0 }}>情绪</span>
                  <span style={{ color: '#555' }}>{selectedTopic.target_emotion}</span>
                </div>
              )}
              {selectedTopic.product_link && selectedTopic.product_link !== '纯养号内容暂不植入' && (
                <div style={{ display: 'flex', marginBottom: 2 }}>
                  <span style={{ color: '#888', width: 56, flexShrink: 0 }}>产品</span>
                  <span style={{ color: '#555' }}>{selectedTopic.product_link}</span>
                </div>
              )}
              <div style={{ display: 'flex' }}>
                <span style={{ color: '#888', width: 56, flexShrink: 0 }}>时长</span>
                <span>{selectedTopic.duration || 45}s · 自动拆 {shotCount} 镜 · 每镜 {shotDuration}s</span>
              </div>
            </div>
          </Card>

          <Space size="middle" wrap>
            <div>
              <span style={{ fontWeight: 600, fontSize: 13, display: 'block', marginBottom: 4 }}>画面比例</span>
              <Select value={size} onChange={setSize} options={SIZE_OPTIONS} style={{ width: 120 }} />
            </div>
            <div>
              <span style={{ fontWeight: 600, fontSize: 13, display: 'block', marginBottom: 4 }}>分辨率</span>
              <Select value={resolution} onChange={setResolution} options={RESOLUTION_OPTIONS} style={{ width: 100 }} />
            </div>
          </Space>

          {/* 竞品模板参考（手动+选题均可使用） */}
          {competitorTemplates.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <span style={{ fontWeight: 600, fontSize: 14, display: 'block', marginBottom: 8 }}>
                竞品参考模板（可选）
              </span>
              <Select
                placeholder="不参考竞品模板..."
                style={{ width: '100%' }}
                allowClear
                value={selectedTemplateId}
                onChange={setSelectedTemplateId}
                options={competitorTemplates.map(t => ({
                  value: t.id,
                  label: t.name,
                }))}
              />
              {selectedTemplateId && (() => {
                const tpl = competitorTemplates.find(t => t.id === selectedTemplateId)
                if (!tpl) return null
                let fw = {}
                try { fw = JSON.parse(tpl.framework) } catch {}
                return (
                  <Card size="small" style={{ marginTop: 8, background: '#fafafa' }}>
                    <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>模板预览（将发送给 LLM）</div>
                    <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                      <div style={{ display: 'flex', marginBottom: 2 }}>
                        <span style={{ color: '#888', width: 48, flexShrink: 0 }}>风格</span>
                        <span>
                          {fw.style && <Tag color="blue" style={{fontSize:10}}>{fw.style}</Tag>}
                          {fw.tone && <Tag color="purple" style={{fontSize:10}}>{fw.tone}</Tag>}
                          {fw.narrative_arc && <Tag color="cyan" style={{fontSize:10}}>{fw.narrative_arc}</Tag>}
                        </span>
                      </div>
                      <div style={{ display: 'flex', marginBottom: 2 }}>
                        <span style={{ color: '#888', width: 48, flexShrink: 0 }}>时长</span>
                        <span>{fw.total_duration || '?'}s · {(fw.shots || []).length} 镜</span>
                      </div>
                      {fw.target_audience && (
                        <div style={{ display: 'flex', marginBottom: 2 }}>
                          <span style={{ color: '#888', width: 48, flexShrink: 0 }}>受众</span>
                          <span style={{ color: '#555' }}>
                            {fw.target_audience.age_range && <Tag color="green" style={{fontSize:10}}>{fw.target_audience.age_range}</Tag>}
                            {fw.target_audience.gender && fw.target_audience.gender !== '不限' && <Tag color="green" style={{fontSize:10}}>{fw.target_audience.gender}</Tag>}
                            {fw.target_audience.pain_points?.slice(0,2).join(' · ')}
                          </span>
                        </div>
                      )}
                      {fw.hook?.hook_visual && (
                        <div style={{ display: 'flex', marginBottom: 2 }}>
                          <span style={{ color: '#888', width: 48, flexShrink: 0 }}>钩子画面</span>
                          <span style={{ color: '#555' }}>{fw.hook.hook_visual.substring(0, 50)}{fw.hook.hook_visual.length > 50 ? '...' : ''}</span>
                        </div>
                      )}
                      {(fw.shots || []).length > 0 && (
                        <div style={{ display: 'flex', marginBottom: 2 }}>
                          <span style={{ color: '#888', width: 48, flexShrink: 0 }}>分镜</span>
                          <div style={{ flex: 1 }}>
                            {fw.shots.slice(0, 5).map((s, i) => (
                              <div key={i} style={{ marginBottom: 2 }}>
                                <Tag color="geekblue" style={{fontSize:10, marginRight:4}}>镜{s.index||i+1}</Tag>
                                <span style={{color:'#888'}}>{s.duration}s {s.shot_size||''} {s.shot_type||''}</span>
                                {s.emotion_beat && <Tag color="volcano" style={{fontSize:10, marginLeft:4}}>{s.emotion_beat}</Tag>}
                                {s.visual_desc && <div style={{color:'#555', paddingLeft:4}}>{s.visual_desc.substring(0, 40)}{s.visual_desc.length > 40 ? '...' : ''}</div>}
                                {s.script && <div style={{color:'#e67e22', paddingLeft:4, fontSize:11}}>🎤 {s.script.substring(0, 40)}{s.script.length > 40 ? '...' : ''}</div>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {fw.traffic_strategy?.cta_type && fw.traffic_strategy.cta_type !== '无' && (
                        <div style={{ display: 'flex', marginBottom: 2 }}>
                          <span style={{ color: '#888', width: 48, flexShrink: 0 }}>CTA</span>
                          <span style={{ color: '#555' }}>{fw.traffic_strategy.cta_type}{fw.traffic_strategy.cta_placement ? `（第${fw.traffic_strategy.cta_placement}镜）` : ''}</span>
                        </div>
                      )}
                      {fw.replicability?.copyable_elements?.length > 0 && (
                        <div style={{ display: 'flex', marginBottom: 2 }}>
                          <span style={{ color: '#888', width: 48, flexShrink: 0 }}>可复用</span>
                          <span style={{ color: '#555' }}>{fw.replicability.copyable_elements.slice(0, 3).join(' · ')}</span>
                        </div>
                      )}
                      {fw.replicability?.improvement_opportunities?.length > 0 && (
                        <div style={{ display: 'flex', marginBottom: 2 }}>
                          <span style={{ color: '#888', width: 48, flexShrink: 0 }}>改进点</span>
                          <span style={{ color: '#555' }}>{fw.replicability.improvement_opportunities.slice(0, 2).join(' · ')}</span>
                        </div>
                      )}
                    </div>
                  </Card>
                )
              })()}
            </div>
          )}

          <div style={{ marginTop: 24 }}>
            <Space.Compact block>
              <Button type="primary" size="large" style={{ width: "75%" }} loading={shotsLoading}
                onClick={handleGenerateShots}
                icon={<ThunderboltOutlined />}>
                🎬 一键生成分镜方案
              </Button>
              <Button size="large" style={{ width: "25%" }} loading={previewLoading}
                onClick={async () => {
                  setPreviewLoading(true);
                  try {
                    const topicData = selectedTopic ? { ...selectedTopic } : { video_topic: topic, content_outline: [] };
                    if (selectedTemplateId) {
                      const tpl = competitorTemplates.find(t => t.id === selectedTemplateId);
                      if (tpl) topicData.competitor_framework = tpl.framework;
                    }
                    const res = await fetch("http://localhost:8000/api/media/generate-shots-preview", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(topicData),
                    });
                    const data = await res.json();
                    setPreviewData(data);
                    setPreviewOpen(true);
                  } catch (e) {
                    message.error("预览失败: " + e.message);
                  } finally {
                    setPreviewLoading(false);
                  }
                }}
                icon={<EyeOutlined />}>
                预览
              </Button>
            </Space.Compact>
          </div>
          
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 20 }}>
            <span style={{ fontWeight: 600, fontSize: 14, display: 'block', marginBottom: 8 }}>
              视频主题 <span style={{ color: '#ff4d4f' }}>*</span>
            </span>
            <TextArea
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder={'从以下四个方面描述你想制作的视频：\n1. 主题方向：要讲什么\n2. 目标人群：给谁看\n3. 风格调性：暖色调/科技感/电影感/治愈风\n4. 核心卖点：最想突出的 1-2 个信息'}
              rows={5}
              maxLength={500}
              showCount
            />
          </div>

          <Space size="middle" wrap>
            <div>
              <span style={{ fontWeight: 600, fontSize: 13, display: 'block', marginBottom: 4 }}>画面比例</span>
              <Select value={size} onChange={setSize} options={SIZE_OPTIONS} style={{ width: 120 }} />
            </div>
            <div>
              <span style={{ fontWeight: 600, fontSize: 13, display: 'block', marginBottom: 4 }}>分辨率</span>
              <Select value={resolution} onChange={setResolution} options={RESOLUTION_OPTIONS} style={{ width: 100 }} />
            </div>
            <div>
              <span style={{ fontWeight: 600, fontSize: 13, display: 'block', marginBottom: 4 }}>分镜数量</span>
              <Select value={shotCount} onChange={setShotCount}
                options={[1,2,3,4,5,6,7,8,9,10].map(n => ({ value: n, label: `${n} 镜` }))}
                style={{ width: 80 }} />
            </div>
            <div>
              <span style={{ fontWeight: 600, fontSize: 13, display: 'block', marginBottom: 4 }}>每镜时长</span>
              <Select value={shotDuration} onChange={setShotDuration} options={DURATION_OPTIONS} style={{ width: 80 }} />
            </div>
          </Space>

          {/* 竞品模板参考 */}
          {competitorTemplates.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <span style={{ fontWeight: 600, fontSize: 14, display: 'block', marginBottom: 8 }}>
                竞品参考模板（可选）
              </span>
              <Select
                placeholder="不参考竞品模板..."
                style={{ width: '100%' }}
                allowClear
                value={selectedTemplateId}
                onChange={setSelectedTemplateId}
                options={competitorTemplates.map(t => ({
                  value: t.id,
                  label: t.name,
                }))}
              />
              {selectedTemplateId && (() => {
                const tpl = competitorTemplates.find(t => t.id === selectedTemplateId)
                if (!tpl) return null
                let fw = {}
                try { fw = JSON.parse(tpl.framework) } catch {}
                return (
                  <Card size="small" style={{ marginTop: 8, background: '#fafafa' }}>
                    <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>模板预览（将发送给 LLM）</div>
                    <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                      <div style={{ display: 'flex', marginBottom: 2 }}>
                        <span style={{ color: '#888', width: 48, flexShrink: 0 }}>风格</span>
                        <span>
                          {fw.style && <Tag color="blue" style={{fontSize:10}}>{fw.style}</Tag>}
                          {fw.tone && <Tag color="purple" style={{fontSize:10}}>{fw.tone}</Tag>}
                          {fw.narrative_arc && <Tag color="cyan" style={{fontSize:10}}>{fw.narrative_arc}</Tag>}
                        </span>
                      </div>
                      <div style={{ display: 'flex', marginBottom: 2 }}>
                        <span style={{ color: '#888', width: 48, flexShrink: 0 }}>时长</span>
                        <span>{fw.total_duration || '?'}s · {(fw.shots || []).length} 镜</span>
                      </div>
                      {fw.target_audience && (
                        <div style={{ display: 'flex', marginBottom: 2 }}>
                          <span style={{ color: '#888', width: 48, flexShrink: 0 }}>受众</span>
                          <span style={{ color: '#555' }}>
                            {fw.target_audience.age_range && <Tag color="green" style={{fontSize:10}}>{fw.target_audience.age_range}</Tag>}
                            {fw.target_audience.gender && fw.target_audience.gender !== '不限' && <Tag color="green" style={{fontSize:10}}>{fw.target_audience.gender}</Tag>}
                            {fw.target_audience.pain_points?.slice(0,2).join(' · ')}
                          </span>
                        </div>
                      )}
                      {fw.hook?.hook_visual && (
                        <div style={{ display: 'flex', marginBottom: 2 }}>
                          <span style={{ color: '#888', width: 48, flexShrink: 0 }}>钩子画面</span>
                          <span style={{ color: '#555' }}>{fw.hook.hook_visual.substring(0, 50)}{fw.hook.hook_visual.length > 50 ? '...' : ''}</span>
                        </div>
                      )}
                      {(fw.shots || []).length > 0 && (
                        <div style={{ display: 'flex', marginBottom: 2 }}>
                          <span style={{ color: '#888', width: 48, flexShrink: 0 }}>分镜</span>
                          <div style={{ flex: 1 }}>
                            {fw.shots.slice(0, 5).map((s, i) => (
                              <div key={i} style={{ marginBottom: 2 }}>
                                <Tag color="geekblue" style={{fontSize:10, marginRight:4}}>镜{s.index||i+1}</Tag>
                                <span style={{color:'#888'}}>{s.duration}s {s.shot_size||''} {s.shot_type||''}</span>
                                {s.emotion_beat && <Tag color="volcano" style={{fontSize:10, marginLeft:4}}>{s.emotion_beat}</Tag>}
                                {s.visual_desc && <div style={{color:'#555', paddingLeft:4}}>{s.visual_desc.substring(0, 40)}{s.visual_desc.length > 40 ? '...' : ''}</div>}
                                {s.script && <div style={{color:'#e67e22', paddingLeft:4, fontSize:11}}>🎤 {s.script.substring(0, 40)}{s.script.length > 40 ? '...' : ''}</div>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {fw.traffic_strategy?.cta_type && fw.traffic_strategy.cta_type !== '无' && (
                        <div style={{ display: 'flex', marginBottom: 2 }}>
                          <span style={{ color: '#888', width: 48, flexShrink: 0 }}>CTA</span>
                          <span style={{ color: '#555' }}>{fw.traffic_strategy.cta_type}{fw.traffic_strategy.cta_placement ? `（第${fw.traffic_strategy.cta_placement}镜）` : ''}</span>
                        </div>
                      )}
                      {fw.replicability?.copyable_elements?.length > 0 && (
                        <div style={{ display: 'flex', marginBottom: 2 }}>
                          <span style={{ color: '#888', width: 48, flexShrink: 0 }}>可复用</span>
                          <span style={{ color: '#555' }}>{fw.replicability.copyable_elements.slice(0, 3).join(' · ')}</span>
                        </div>
                      )}
                      {fw.replicability?.improvement_opportunities?.length > 0 && (
                        <div style={{ display: 'flex', marginBottom: 2 }}>
                          <span style={{ color: '#888', width: 48, flexShrink: 0 }}>改进点</span>
                          <span style={{ color: '#555' }}>{fw.replicability.improvement_opportunities.slice(0, 2).join(' · ')}</span>
                        </div>
                      )}
                    </div>
                  </Card>
                )
              })()}
            </div>
          )}

          <div style={{ marginTop: 24 }}>
            <Space.Compact block>
              <Button type="primary" size="large" style={{ width: "75%" }} loading={shotsLoading}
                onClick={handleGenerateShots}
                icon={<ThunderboltOutlined />}>
                生成分镜方案
              </Button>
              <Button size="large" style={{ width: "25%" }} loading={previewLoading}
                onClick={async () => {
                  setPreviewLoading(true);
                  try {
                    const manualData = { video_topic: topic.trim(), angle: '', hook: topic.trim().substring(0, 30), hook_type: '', content_outline: topic.trim().split(/[\n,，]/).filter(Boolean), target_emotion: '', product_link: '', duration: parseInt(shotDuration) * (parseInt(shotCount) || 3) };
                    if (selectedTemplateId) {
                      const tpl = competitorTemplates.find(t => t.id === selectedTemplateId);
                      if (tpl) manualData.competitor_framework = tpl.framework;
                    }
                    const res = await fetch("http://localhost:8000/api/media/generate-shots-preview", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(manualData),
                    });
                    const data = await res.json();
                    setPreviewData(data);
                    setPreviewOpen(true);
                  } catch (e) {
                    message.error("预览失败: " + e.message);
                  } finally {
                    setPreviewLoading(false);
                  }
                }}
                icon={<EyeOutlined />}>
                预览
              </Button>
            </Space.Compact>
          </div>
        </>
      )}
    </Card>
  )

  // ---------- Step 2: Edit shots ----------
  const renderStep2 = () => (
    <>
      {/* 选题摘要 */}
      <Card size="small" style={{ marginBottom: 16, background: '#eefcf8', border: '1px solid #a9ebe0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>📋 原始选题</span>
          <Button size="small" type="link" onClick={() => setCurrent(0)} icon={<ArrowLeftOutlined />}>返回修改</Button>
        </div>
        {selectedTopic ? (
          <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.8 }}>
            <div><strong>标题：</strong>{selectedTopic.video_topic}</div>
            {selectedTopic.hook_type && <div><strong>🎯 钩子类型：</strong><Tag color="orange">{selectedTopic.hook_type}</Tag></div>}
            {selectedTopic.angle && <div><strong>角度：</strong>{selectedTopic.angle}</div>}
            {selectedTopic.hook && <div style={{ color: '#e67e22' }}><strong>⚡ 黄金3秒：</strong>{selectedTopic.hook}</div>}
            {selectedTopic.content_outline?.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>📝 内容要点：</div>
                {selectedTopic.content_outline.map((p, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'flex-start',
                    padding: '5px 8px', marginBottom: 4,
                    background: '#f0faf6', borderRadius: 6,
                    
                    gap: 6
                  }}>
                    <span style={{
                      width: 5, height: 5, borderRadius: 3,
                      background: '#333', flexShrink: 0, marginTop: 7
                    }} />
                    <span style={{ fontSize: 12, lineHeight: '18px', color: '#444' }}>{p}</span>
                  </div>
                ))}
              </div>
            )}
            {selectedTopic.target_emotion && <div><strong>🎭 目标情绪：</strong>{selectedTopic.target_emotion}</div>}
            {selectedTopic.product_link && <div><strong>🔗 产品关联：</strong>{selectedTopic.product_link}</div>}
            <div><strong>⏱ 总时长：</strong>{selectedTopic.duration || 30}s</div>
          </div>
        ) : (
          <div style={{ marginTop: 8, fontSize: 13 }}>
            <div><strong>主题：</strong>{topic}</div>
            <div><strong>分镜数量：</strong>{shotCount} 镜 | <strong>每镜时长：</strong>{shotDuration}s</div>
          </div>
        )}
      </Card>

      <Card title={<span><VideoCameraOutlined style={{ marginRight: 6 }} />分镜方案 · 点击编辑</span>}
        extra={
        <Space>
          <Button size="small" icon={<ReloadOutlined />} loading={shotsLoading} onClick={regenerateAll}>全部重新生成</Button>
          <Button size="small" onClick={() => setCurrent(0)} icon={<ArrowLeftOutlined />}>返回修改主题</Button>
        </Space>
      }>
      {shots.map((shot, idx) => (
        <div key={idx} style={{
          marginBottom: 16, padding: 16, borderRadius: 8,
          border: '1px solid #eefcf8', background: '#eefcf8',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Tag color="blue">分镜 {idx + 1}</Tag>
            <Space size={4}>
              <Tag>{shot.duration || shotDuration}秒</Tag>
              <Tooltip title="重新生成此分镜">
                <Button size="small" type="text" icon={<ReloadOutlined />}
                  loading={regeneratingIndex === idx} onClick={() => regenerateShot(idx)} />
              </Tooltip>
            </Space>
          </div>
          <div style={{ marginBottom: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 12, color: '#666' }}>画面提示词</span>
            <TextArea value={shot.scene_prompt || ''} rows={3}
              onChange={e => updateShot(idx, 'scene_prompt', e.target.value)}
              placeholder="画面描述..." style={{ fontFamily: 'monospace', fontSize: 12 }} />
          </div>
          <div>
            <span style={{ fontWeight: 600, fontSize: 12, color: '#666' }}>配音文案</span>
            <TextArea value={shot.voice_script || ''} rows={2}
              onChange={e => updateShot(idx, 'voice_script', e.target.value)}
              placeholder="配音内容..." style={{ fontFamily: 'monospace', fontSize: 12 }} />
          </div>
        </div>
      ))}
      <Divider />
      <div style={{ textAlign: 'right' }}>
        <Popconfirm title="确认提交？将开始生成视频" onConfirm={handleSubmitGenerate}>
          <Button type="primary" size="large" icon={<ArrowRightOutlined />}>
            确认并生成视频
          </Button>
        </Popconfirm>
      </div>
    </Card>
    </>
  )

  // For step 3: poll for status
  const [polling, setPolling] = useState(false)
  const [shotStatuses, setShotStatuses] = useState([])
  const mediaRef = useRef(resultMedia)

  useEffect(() => { mediaRef.current = resultMedia }, [resultMedia])

  useEffect(() => {
    if (current !== 2 || !resultMedia || polling) return
    let cancel = false
    const poll = async () => {
      try {
        const shots = await mediaApi.getShots(resultMedia.id)
        if (cancel) return
        setShotStatuses(shots || [])
        const allDone = shots.every(s => s.status === 'done' || s.status === 'failed')
        if (!allDone) setTimeout(poll, 3000)
        else {
          const media = await mediaApi.list()
            .then(list => list.find(m => m.id === mediaRef.current?.id))
          if (media) setResultMedia(media)
        }
      } catch (e) { if (!cancel) setTimeout(poll, 3000) }
    }
    setPolling(true)
    setTimeout(poll, 2000)
    return () => { cancel = true }
  }, [current, resultMedia, polling])

  const shotDone = shotStatuses.filter(s => s.status === 'done').length
  const shotTotal = shotStatuses.length || shots.length
  const mediaReady = resultMedia?.status === 'ready'

  // ---------- Step 3: Result ----------
  const renderStep3 = () => (
    <Card>
      {generating ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <LoadingOutlined style={{ fontSize: 48, color: '#005d50' }} />
          <p style={{ marginTop: 16, fontSize: 15, color: '#8c8c8c' }}>正在提交任务...</p>
        </div>
      ) : (
        <div>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            {mediaReady ? (
              <CheckCircleOutlined style={{ fontSize: 48, color: '#52c41a' }} />
            ) : (
              <LoadingOutlined style={{ fontSize: 48, color: '#005d50' }} />
            )}
            <h3 style={{ marginTop: 8 }}>
              {mediaReady ? '视频生成完成！' : '视频生成中...'}
            </h3>
            <Progress
              percent={shotTotal > 0 ? Math.round((shotDone / shotTotal) * 100) : 0}
              status={mediaReady ? 'success' : 'active'}
              format={() => `${shotDone}/${shotTotal} 分镜`}
              style={{ maxWidth: 300, margin: '0 auto' }}
            />
          </div>

          <Timeline
            items={shotStatuses.map((s, i) => {
              const statusColors = {
                pending: 'gray', tts: 'purple', video: 'blue',
                downloading: 'cyan', done: 'green', failed: 'red',
              }
              const statusLabels = {
                pending: '排队中', tts: '配音中', video: '生成画面',
                downloading: '下载中', done: '已完成', failed: '失败',
              }
              return {
                color: statusColors[s.status] || 'gray',
                children: (
                  <div>
                    <strong>分镜 {s.shot_index}</strong>
                    <Tag color={statusColors[s.status]} style={{ marginLeft: 8 }}>
                      {statusLabels[s.status] || s.status}
                    </Tag>
                    <span style={{ fontSize: 12, color: '#8c8c8c', marginLeft: 8 }}>{s.duration}秒</span>
                    {s.status === 'video' && s.progress > 0 && (
                      <Progress percent={s.progress} size="small" style={{ marginTop: 4 }} />
                    )}
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: '#8c8c8c' }}>
                      画面: {s.scene_prompt?.substring(0, 40)}...
                    </p>
                  </div>
                ),
              }
            })}
          />

          {mediaReady && (
            <>
              <Divider />
              <div style={{ textAlign: 'center' }}>
                <p><strong>文件名：</strong>{resultMedia.name}</p>
                <Space>
                  <Button type="primary" icon={<VideoCameraOutlined />} onClick={() => navigate('/media')}>
                    前往素材库查看
                  </Button>
                  <Button onClick={resetAll}>继续创作</Button>
                </Space>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  )

  const { Text } = Typography

  const tabItems = [
    {
      key: "video", label: "文生视频", icon: <VideoCameraOutlined />,
      children: (
        <div style={{ maxWidth: 780 }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#142528', letterSpacing: '-0.3px' }}>文生视频</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#8c8c8c' }}>
          AI 智能分镜 — 输入主题自动拆分分镜，逐镜编辑后生成完整视频
        </p>
      </div>

      <Steps
        current={current}
        size="small"
        style={{ marginBottom: 24 }}
        items={[
          { title: '输入主题', icon: <EditOutlined /> },
          { title: '编辑分镜', icon: <VideoCameraOutlined /> },
          { title: '生成视频', icon: <CheckCircleOutlined /> },
        ]}
      />

      {current === 0 && renderStep1()}
      {current === 1 && renderStep2()}
      {current === 2 && renderStep3()}

      {current === 0 && (
        <Card size="small" style={{ marginTop: 20 }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>💡 提示</span>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: '#8c8c8c', lineHeight: 2 }}>
            <li>选择今日选题自动拆镜，或手动输入主题自由创作</li>
            <li>Step 2 可逐镜编辑画面提示词和配音文案</li>
            <li>生成的视频会自动存入素材库</li>
          </ul>
        </Card>
      )}
        </div>
      ),
    },
    {
      key: "config", label: "生成配置", icon: <SettingOutlined />,
      children: (
        <div style={{ maxWidth: 700 }}>
          <Card size="small" title={<span><FileProtectOutlined style={{ marginRight: 6 }} />提示词文件</span>}>
            <List
              dataSource={configFiles}
              renderItem={file => (
                <List.Item extra={<Button size="small" icon={<EditOutlined />} onClick={() => openConfigEditor(file)}>编辑</Button>}>
                  <List.Item.Meta
                    avatar={<span style={{ fontSize: 20 }}>{file.key === "shot_topic_prompt" ? "🎬" : "✏️"}</span>}
                    title={<span style={{ fontFamily: "monospace", fontSize: 13 }}>{file.filename}</span>}
                    description={<span style={{ fontSize: 12 }}>{file.description}</span>}
                  />
                </List.Item>
              )}
            />
          </Card>
          <Card size="small" style={{ marginTop: 16 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>💡 提示</span>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12, color: "#6c777b", lineHeight: 2 }}>
              <li>shot_topic_prompt.txt — 控制从热搜选题自动生成分镜</li>
              <li>manual_topic_prompt.txt — 控制手动输入主题时生成分镜</li>
            </ul>
          </Card>
        </div>
      ),
    },
  ]

  return (
    <div>
      <Modal
        title="📋 发送给 LLM 的数据预览"
        open={previewOpen}
        onCancel={() => setPreviewOpen(false)}
        width={900}
        footer={null}
      >
        {previewData && (
          <div style={{ maxHeight: "70vh", overflow: "auto" }}>
            <div style={{ marginBottom: 16 }}>
              <Tag color="blue">System Prompt ({previewData.system_prompt?.length || 0} 字)</Tag>
              <pre style={{
                background: "#1e1e1e", color: "#d4d4d4", padding: 16, borderRadius: 8,
                fontSize: 12, whiteSpace: "pre-wrap", maxHeight: 300, overflow: "auto"
              }}>
                {previewData.system_prompt}
              </pre>
            </div>
            <div style={{ marginBottom: 16 }}>
              <Tag color="green">User Message ({previewData.user_message?.length || 0} 字)</Tag>
              <pre style={{
                background: "#1e1e1e", color: "#d4d4d4", padding: 16, borderRadius: 8,
                fontSize: 12, whiteSpace: "pre-wrap", maxHeight: 300, overflow: "auto"
              }}>
                {previewData.user_message}
              </pre>
            </div>
            <div>
              <Tag>参数</Tag>
              <div style={{ fontSize: 12, color: "#8c8c8c", marginTop: 4 }}>
                model: {previewData.model} | temperature: {previewData.temperature} | max_tokens: {previewData.max_tokens}
              </div>
            </div>
          </div>
        )}
      </Modal>
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
    </div>
  )
}
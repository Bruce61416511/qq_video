import { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Steps, Input, Button, Card, App, Select,
  Space, Tag, Tooltip, Alert, Popconfirm, Divider, Progress, Timeline
} from 'antd'
import {
  ThunderboltOutlined, LoadingOutlined, CheckCircleOutlined,
  EditOutlined, ReloadOutlined, ArrowRightOutlined,
  ArrowLeftOutlined, VideoCameraOutlined
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
  const { message } = App.useApp()

  // Video topics from trends
  const [videoTopics, setVideoTopics] = useState([])
  const [selectedTopicId, setSelectedTopicId] = useState(null)

  // Load video topics on mount
  useEffect(() => {
    trendsApi.getTopicData().then(data => {
      if (data && data.topics) setVideoTopics(data.topics)
    }).catch(() => {})
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
  const handleTopicSelect = (idx) => {
    const t = videoTopics[idx]
    if (!t) return
    setSelectedTopicId(idx)

    const parts = [
      `视频选题：${t.video_topic || ''}`,
      `切入角度：${t.angle || ''}`,
      t.hook ? `黄金3秒开头：${t.hook}` : '',
      t.content_outline && t.content_outline.length > 0
        ? `内容要点：\n${t.content_outline.map((p, i) => `  ${i + 1}. ${p}`).join('\n')}`
        : '',
      t.target_emotion ? `目标情绪：${t.target_emotion}` : '',
      t.product_link ? `产品关联：${t.product_link}` : '',
      `时长建议：${t.duration || 30}秒`,
    ].filter(Boolean)
    setTopic(parts.join('\n'))
    if (t.duration) setShotDuration(String(Math.max(3, Math.floor((t.duration || 30) / (t.content_outline?.length || 3)))))
  }

  // Step 2 - shots
  const [shots, setShots] = useState([])
  const [shotsLoading, setShotsLoading] = useState(false)
  const [regeneratingIndex, setRegeneratingIndex] = useState(-1)

  // Step 3 - generating
  const [generating, setGenerating] = useState(false)
  const [resultMedia, setResultMedia] = useState(null)

  // Generate shot plan
  const handleGenerateShots = useCallback(async () => {
    if (!topic.trim()) { message.warning('请输入视频主题'); return }
    setShotsLoading(true)
    try {
      const data = await mediaApi.generateShots(topic.trim(), shotCount, shotDuration)
      setShots(data.shots || [])
      setCurrent(1)
      message.success(`已生成 ${data.shots.length} 个分镜方案`)
    } catch (e) {
      message.error('生成分镜失败: ' + e.message)
    } finally {
      setShotsLoading(false)
    }
  }, [topic, shotCount, shotDuration, message])

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
      {/* Video topic selector */}
      {videoTopics.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <span style={{ fontWeight: 600, fontSize: 14, display: 'block', marginBottom: 8 }}>
            📋 从今日选题中选择
          </span>
          <Select
            placeholder="选择一个选题自动填充..."
            style={{ width: '100%' }}
            value={selectedTopicId}
            onChange={handleTopicSelect}
            options={videoTopics.map((t, i) => ({
              value: i,
              label: `${i + 1}. ${t.video_topic || t.source_title?.substring(0, 40)}`,
            }))}
          />
        </div>
      )}

      <div style={{ marginBottom: 20 }}>
        <span style={{ fontWeight: 600, fontSize: 14, display: 'block', marginBottom: 8 }}>
          视频主题 <span style={{ color: '#ff4d4f' }}>*</span>
        </span>
        <TextArea
          value={topic}
          onChange={e => setTopic(e.target.value)}
          placeholder={'从以下四个方面描述你想制作的视频：\n1. 主题方向：要讲什么\n2. 目标人群：给谁看\n3. 风格调性：暖色调/科技感/电影感/治愈风\n4. 核心卖点：最想突出的 1-2 个信息\n\n例如：\n益生菌对肠道健康的好处，面向25-35岁上班族女性，暖色调+食材特写+轻快节奏，突出100亿活菌数据和肠道菌群对比'}
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

      <div style={{ marginTop: 24 }}>
        <Button type="primary" size="large" block loading={shotsLoading}
          onClick={handleGenerateShots}
          icon={<ThunderboltOutlined />}>
          生成分镜方案
        </Button>
      </div>
    </Card>
  )

  // ---------- Step 2: Edit shots ----------
  const renderStep2 = () => (
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
          border: '1px solid #f0f0f0', background: '#fafafa',
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
          <LoadingOutlined style={{ fontSize: 48, color: '#1677ff' }} />
          <p style={{ marginTop: 16, fontSize: 15, color: '#8c8c8c' }}>正在提交任务...</p>
        </div>
      ) : (
        <div>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            {mediaReady ? (
              <CheckCircleOutlined style={{ fontSize: 48, color: '#52c41a' }} />
            ) : (
              <LoadingOutlined style={{ fontSize: 48, color: '#1677ff' }} />
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

  return (
    <div style={{ maxWidth: 780 }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>文生视频</h2>
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

      {/* Tips */}
      {current === 0 && (
        <Card size="small" style={{ marginTop: 20 }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>💡 文案提示</span>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: '#8c8c8c', lineHeight: 2 }}>
            <li>从主题、人群、风格、卖点四个维度描述，AI 拆分的分镜最精准</li>
            <li>卖点建议包含具体数据（如：100亿活菌、提高30%），LLM 会在分镜中自动融入对比可视化</li>
            <li>生成的视频会自动存入素材库，可在素材库中选择发布</li>
          </ul>
        </Card>
      )}
    </div>
  )
}
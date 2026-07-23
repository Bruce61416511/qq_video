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
import { mediaApi } from '../services/api'

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

  // Step state
  const [current, setCurrent] = useState(0)

  // Step 1 - inputs
  const [topic, setTopic] = useState('')
  const [size, setSize] = useState('9:16')
  const [resolution, setResolution] = useState('1080P')
  const [shotCount, setShotCount] = useState(3)
  const [shotDuration, setShotDuration] = useState('5')

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
      <div style={{ marginBottom: 20 }}>
        <span style={{ fontWeight: 600, fontSize: 14, display: 'block', marginBottom: 8 }}>
          视频主题 <span style={{ color: '#ff4d4f' }}>*</span>
        </span>
        <TextArea
          value={topic}
          onChange={e => setTopic(e.target.value)}
          placeholder={'描述你想制作的视频内容，例如：\n\n一段关于益生菌对肠道健康益处的科普短视频，暖色调，食品特写镜头，配轻快的背景音乐'}
          rows={5}
          maxLength={500}
          showCount
        />
      </div>

      <Space size="large" style={{ marginBottom: 24 }} wrap>
        <div>
          <span style={{ fontWeight: 600, fontSize: 13, display: 'block', marginBottom: 4 }}>视频尺寸</span>
          <Select value={size} onChange={setSize} options={SIZE_OPTIONS} style={{ width: 140 }} />
        </div>
        <div>
          <span style={{ fontWeight: 600, fontSize: 13, display: 'block', marginBottom: 4 }}>分辨率</span>
          <Select value={resolution} onChange={setResolution} options={RESOLUTION_OPTIONS} style={{ width: 120 }} />
        </div>
        <div>
          <span style={{ fontWeight: 600, fontSize: 13, display: 'block', marginBottom: 4 }}>分镜数量</span>
          <Select value={shotCount} onChange={setShotCount} options={[2,3,4,5,6,7,8,9,10].map(n => ({ value: n, label: n+'个' }))} style={{ width: 100 }} />
        </div>
        <div>
          <span style={{ fontWeight: 600, fontSize: 13, display: 'block', marginBottom: 4 }}>每镜时长</span>
          <Select value={shotDuration} onChange={setShotDuration} options={DURATION_OPTIONS} style={{ width: 110 }} />
        </div>
      </Space>

      <Button
        type="primary"
        size="large"
        icon={shotsLoading ? <LoadingOutlined /> : <ThunderboltOutlined />}
        onClick={handleGenerateShots}
        loading={shotsLoading}
        disabled={!topic.trim()}
        block
      >
        AI 生成分镜方案
      </Button>
    </Card>
  )

  // ---------- Step 2: Edit Shots ----------
  const renderStep2 = () => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <span style={{ fontWeight: 600, fontSize: 14 }}>编辑分镜方案</span>
          <Tag color="blue" style={{ marginLeft: 8 }}>{shots.length} 个分镜</Tag>
        </div>
        <Space>
          <Tooltip title="基于当前主题重新生成全部">
            <Button icon={<ReloadOutlined />} onClick={regenerateAll} loading={shotsLoading} size="small">
              重新生成全部
            </Button>
          </Tooltip>
          <Popconfirm title="返回上一步将丢失当前编辑" onConfirm={() => setCurrent(0)} okText="确定" cancelText="取消">
            <Button icon={<ArrowLeftOutlined />} size="small">返回修改主题</Button>
          </Popconfirm>
        </Space>
      </div>

      {shots.map((shot, i) => (
        <Card
          key={i}
          size="small"
          title={
            <Space>
              <Tag color="purple">分镜 {i + 1}</Tag>
              <Select
                value={shot.duration}
                onChange={v => updateShot(i, 'duration', v)}
                options={DURATION_OPTIONS}
                size="small"
              />
            </Space>
          }
          extra={
            <Tooltip title="重新生成此分镜">
              <Button
                type="text"
                icon={regeneratingIndex === i ? <LoadingOutlined /> : <ReloadOutlined />}
                onClick={() => regenerateShot(i)}
                loading={regeneratingIndex === i}
                size="small"
              />
            </Tooltip>
          }
          style={{ marginBottom: 12 }}
        >
          <div style={{ marginBottom: 10 }}>
            <span style={{ fontWeight: 600, fontSize: 12, color: '#8c8c8c' }}>🎬 画面提示词</span>
            <TextArea
              value={shot.scene_prompt}
              onChange={e => updateShot(i, 'scene_prompt', e.target.value)}
              rows={2}
              style={{ marginTop: 4 }}
            />
          </div>
          <div>
            <span style={{ fontWeight: 600, fontSize: 12, color: '#8c8c8c' }}>🎙️ 语音文案</span>
            <TextArea
              value={shot.voice_script}
              onChange={e => updateShot(i, 'voice_script', e.target.value)}
              rows={2}
              style={{ marginTop: 4 }}
            />
          </div>
        </Card>
      ))}

      <Divider />

      <div style={{ textAlign: 'right' }}>
        <Button
          type="primary"
          size="large"
          icon={<ArrowRightOutlined />}
          onClick={handleSubmitGenerate}
          disabled={shots.length === 0}
        >
          确认并生成视频
        </Button>
      </div>
    </div>
  )

  // Shot status polling
  const [shotStatuses, setShotStatuses] = useState([])
  const pollRef = useRef(null)

  useEffect(() => {
    if (current === 2 && resultMedia?.id) {
      const poll = async () => {
        try {
          const data = await mediaApi.getShots(resultMedia.id)
          setShotStatuses(data || [])
          // Check if media is done
          const list = await mediaApi.list()
          const m = list.find(x => x.id === resultMedia.id)
          if (m) setResultMedia(m)
        } catch (e) { /* ignore */ }
      }
      poll()
      pollRef.current = setInterval(poll, 3000)
      return () => clearInterval(pollRef.current)
    } else {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [current, resultMedia?.id])

  // Auto-restore: check for in-progress generation on mount
  useEffect(() => {
    const restore = async () => {
      try {
        const list = await mediaApi.list()
        const generating = list.find(m => m.status === 'generating' && m.source === 'ai')
        if (generating) {
          setResultMedia(generating)
          setCurrent(2)
          setTopic(generating.prompt || '')
          // Try loading shots
          try {
            const data = await mediaApi.getShots(generating.id)
            if (data && data.length > 0) {
              setShots(data.map(s => ({
                scene_prompt: s.scene_prompt,
                voice_script: s.voice_script,
                duration: s.duration,
              })))
            }
          } catch (e) { /* ignore */ }
        }
      } catch (e) { /* ignore */ }
    }
    restore()
  }, [])


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
                pending: 'gray',
                generating: 'blue',
                done: 'green',
                failed: 'red',
              }
              const statusLabels = {
                pending: '等待中',
                generating: '生成中...',
                done: '已完成',
                failed: '失败',
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
            <li>描述越详细，AI 拆分分镜越精准（场景、色调、节奏）</li>
            <li>食品大健康方向建议：食材特写 + 科普讲解 + 生活场景</li>
            <li>生成的视频会自动存入素材库，可在素材库中选择发布</li>
          </ul>
        </Card>
      )}
    </div>
  )
}
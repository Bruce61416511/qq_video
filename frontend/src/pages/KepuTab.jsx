import React, { useState, useEffect } from 'react'
import { Card, Input, Button, InputNumber, Space, Tag, Alert, Progress, message, Steps, Typography, Tabs } from 'antd'
import { EditOutlined, ThunderboltOutlined, PlusOutlined, DeleteOutlined, AudioOutlined, PictureOutlined, ArrowLeftOutlined } from '@ant-design/icons'

const { TextArea } = Input
const { Text, Title } = Typography

const stepItems = [
  { title: '话题输入' },
  { title: '旁白分镜' },
  { title: '配音合成' },
  { title: '生成视频' },
]

export default function KepuTab() {
  const [current, setCurrent] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingStep, setLoadingStep] = useState('')
  const [topic, setTopic] = useState('')
  const [shotCount, setShotCount] = useState(3)
  const [narrations, setNarrations] = useState([])
  const [ttsResults, setTtsResults] = useState([])
  const [scenes, setScenes] = useState([])
  const [editingIndex, setEditingIndex] = useState(-1)
  const [editText, setEditText] = useState('')
  const [editingSceneIdx, setEditingSceneIdx] = useState(-1)
  const [tabMode, setTabMode] = useState('studio')
  const [scriptPrompt, setScriptPrompt] = useState('')
  const [scenePrompt, setScenePrompt] = useState('')
  const [promptLoading, setPromptLoading] = useState(false)
  const [editSceneText, setEditSceneText] = useState('')

  const [loaded, setLoaded] = useState(false)

  // Load/Save state from localStorage
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('kepu_state'))
      if (saved) {
        if (saved.topic) setTopic(saved.topic)
        if (saved.shotCount) setShotCount(saved.shotCount)
        if (saved.current !== undefined) setCurrent(saved.current)
        if (saved.narrations) setNarrations(saved.narrations)
        if (saved.ttsResults) setTtsResults(saved.ttsResults)
        if (saved.scenes) setScenes(saved.scenes)
      }
    } catch (e) {}
    setLoaded(true)
  }, [])

  useEffect(() => {
    if (!loaded) return
    const state = { topic, shotCount, current, narrations, ttsResults, scenes }
    localStorage.setItem('kepu_state', JSON.stringify(state))
  }, [loaded, topic, shotCount, current, narrations, ttsResults, scenes])

  const handleGenerateScript = async () => {
    if (!topic.trim()) { message.warning('请输入话题'); return }
    setLoading(true)
    setLoadingStep('正在生成剧本...')
    try {
      const res = await fetch('http://localhost:8000/api/kepu/script', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: topic.trim(), shot_count: shotCount }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || '失败')
      const nars = [
        { voice_script: data.script.hook, stage: 'hook', index: 0 },
        ...data.script.body.map((text, i) => ({ voice_script: text, stage: 'body', index: i + 1 })),
        { voice_script: data.script.ending, stage: 'ending', index: data.script.body.length + 1 },
      ]
      setNarrations(nars)
      setCurrent(1)
      message.success('剧本生成成功')
    } catch (e) {
      message.error('失败: ' + e.message)
    } finally { setLoading(false) }
  }

  const handleEdit = (i) => { setEditingIndex(i); setEditText(narrations[i]?.voice_script || '') }
  const handleSaveEdit = (i) => {
    const u = [...narrations]; u[i] = { ...u[i], voice_script: editText }; setNarrations(u); setEditingIndex(-1)
  }
  const handleDelete = (i) => {
    if (narrations.length <= 3) { message.warning('Min 3 shots'); return }
    const u = narrations.filter((_, j) => j !== i).map((n, j) => ({ ...n, index: j }))
    setNarrations(u)
  }
  const handleAdd正文 = () => {
    const hook = narrations[0], ending = narrations[narrations.length - 1]
    const bodyNars = narrations.slice(1, -1)
    const new正文 = { voice_script: '', stage: 'body', index: bodyNars.length + 1 }
    const u = [hook, ...bodyNars, new正文, ending].map((n, j) => ({ ...n, index: j }))
    setNarrations(u)
  }

  const handleTts = async () => {
    const valid = narrations.filter(n => n.voice_script.trim())
    if (!valid.length) { message.warning('无旁白内容'); return }
    setLoading(true); setLoadingStep('正在合成语音...')
    try {
      const res = await fetch('http://localhost:8000/api/kepu/tts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ narrations: valid }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'TTS failed')
      setTtsResults(data.segments || []); setCurrent(2)
      message.success('TTS完成: ' + data.total_duration + 's')
    } catch (e) { message.error('TTS失败: ' + e.message) }
    finally { setLoading(false) }
  }

  const handleGenerateScenes = async () => {
    if (!ttsResults.length) { message.warning('请先生成TTS'); return }
    setLoading(true); setLoadingStep('正在生成分镜提示词...')
    try {
      const res = await fetch('http://localhost:8000/api/kepu/scenes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          narrations: narrations.filter(n => n.voice_script.trim()),
          durations: ttsResults.map(r => r.duration),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || '失败')
      setScenes(data.scenes || []); setCurrent(3)
      message.success('分镜提示词生成完成')
    } catch (e) { message.error('失败: ' + e.message) }
    finally { setLoading(false) }
  }

  if (loading && loadingStep) {
    return <div style={{ textAlign: 'center', padding: 80 }}>
      <Title level={4}>{loadingStep}</Title>
      <Progress percent={99} status="active" style={{ maxWidth: 400 }} />
    </div>
  }

  const tagColors = { hook: 'red', body: 'blue', ending: 'green' }
  const tagLabels = { hook: '钩子', body: '正文', ending: '结尾' }

  const loadPrompts = async () => {
    setPromptLoading(true)
    try {
      const res = await fetch('http://localhost:8000/api/kepu/prompts')
      const data = await res.json()
      setScriptPrompt(data.prompts['kepu_script_prompt.txt'] || '')
      setScenePrompt(data.prompts['kepu_scene_prompt.txt'] || '')
    } catch (e) { message.error('加载提示词失败') }
    finally { setPromptLoading(false) }
  }

  const savePrompts = async () => {
    setPromptLoading(true)
    try {
      const res = await fetch('http://localhost:8000/api/kepu/prompts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompts: { 'kepu_script_prompt.txt': scriptPrompt, 'kepu_scene_prompt.txt': scenePrompt } }),
      })
      if (!res.ok) throw new Error('保存失败')
      message.success('提示词已保存')
    } catch (e) { message.error('保存失败: ' + e.message) }
    finally { setPromptLoading(false) }
  }

  const tabItems = [
    { key: 'studio', label: '智能分镜' },
    { key: 'config', label: '生成配置' },
  ]

  return (
    <div style={{ padding: 24 }}>
      <Tabs activeKey={tabMode} onChange={(key) => { setTabMode(key); if (key === 'config') loadPrompts() }} items={tabItems} style={{ maxWidth: 700 }} />

      {tabMode === 'config' && (
        <Card title="提示词配置" style={{ maxWidth: 700 }}>
          <Alert type="info" message="编辑提示词以自定义大模型行为。修改后下次生成生效。" style={{ marginBottom: 16 }} />
          <div style={{ marginBottom: 16 }}>
            <Text strong>剧本提示词 (kepu_script_prompt.txt)</Text>
            <TextArea rows={12} value={scriptPrompt} onChange={e => setScriptPrompt(e.target.value)}
              style={{ marginTop: 8, fontFamily: 'monospace', fontSize: 12 }} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <Text strong>分镜提示词 (kepu_scene_prompt.txt)</Text>
            <TextArea rows={12} value={scenePrompt} onChange={e => setScenePrompt(e.target.value)}
              style={{ marginTop: 8, fontFamily: 'monospace', fontSize: 12 }} />
          </div>
          <Space>
            <Button onClick={loadPrompts} loading={promptLoading}>从服务器加载</Button>
            <Button type="primary" onClick={savePrompts} loading={promptLoading}>保存到服务器</Button>
          </Space>
        </Card>
      )}

      {tabMode === 'studio' && (<>
      <Steps current={current} onChange={setCurrent} items={stepItems} style={{ maxWidth: 700, marginBottom: 32, cursor: 'pointer' }} />

      {current === 0 && (
        <Card title="话题输入" style={{ maxWidth: 700 }}>
          <div style={{ marginBottom: 16 }}>
            <Text strong>视频话题</Text>
            <TextArea value={topic} onChange={e => setTopic(e.target.value)}
              placeholder="例如：千年酱香：酱油的前世今生" rows={3} style={{ marginTop: 8 }} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <Text strong>正文分镜数</Text>
            <div style={{ marginTop: 8 }}>
              <InputNumber min={1} max={10} value={shotCount} onChange={v => setShotCount(v)} />
              <Text type="secondary" style={{ marginLeft: 8 }}>{shotCount + 2} 个分镜 (钩子 + {shotCount}正文 + 结尾)</Text>
            </div>
          </div>
          <Button type="primary" block icon={<ThunderboltOutlined />} loading={loading} onClick={handleGenerateScript}>
            Generate Script
          </Button>
        </Card>
      )}

      {current === 1 && (
        <Card title={'旁白分镜 (' + narrations.length + ' 镜, 总时长约' + (narrations.reduce((s, n) => s + n.voice_script.length, 0) / 4.8).toFixed(0) + '秒)'}
          extra={<Button size="small" onClick={() => setCurrent(0)} icon={<ArrowLeftOutlined />}>返回</Button>}
          style={{ maxWidth: 700 }}>
          {narrations.map((nar, i) => (
            <div key={i} style={{ marginBottom: 12, padding: 12, borderRadius: 8, border: '1px solid #e8e8e8', background: editingIndex === i ? '#fffbe6' : '#fafafa' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <Space>
                  <Tag color={tagColors[nar.stage] || nar.stage}>{tagLabels[nar.stage]}</Tag>
                  <Text type="secondary" style={{ fontSize: 12 }}>第 {i + 1} 分镜</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>{nar.voice_script.length}字 / {(nar.voice_script.length / 4.8).toFixed(1)}秒</Text>
                </Space>
                <Space size="small">
                  <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(i)}>编辑</Button>
                  {nar.stage === 'body' && <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(i)} />}
                </Space>
              </div>
              {editingIndex === i ? (
                <div>
                  <TextArea value={editText} onChange={e => setEditText(e.target.value)} rows={3} style={{ marginBottom: 8 }} />
                  <Button size="small" type="primary" onClick={() => handleSaveEdit(i)}>保存</Button>
                  <Button size="small" style={{ marginLeft: 8 }} onClick={() => setEditingIndex(-1)}>取消</Button>
                </div>
              ) : (
                <div style={{ color: '#333', fontSize: 13, lineHeight: 1.8 }}>{nar.voice_script}</div>
              )}
            </div>
          ))}
          <Space style={{ marginTop: 8 }}>
            <Button icon={<PlusOutlined />} onClick={handleAdd正文}>Add 正文 Shot</Button>
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
              <div key={i} style={{ marginBottom: 12, padding: 12, borderRadius: 8, border: '1px solid #e8e8e8', background: '#fafafa' }}>
                <Space><Tag color="blue">第 {i + 1} 分镜</Tag>{tts && <Tag color="green">{tts.duration}s</Tag>}</Space>
                <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>{nar.voice_script.substring(0, 60)}...</div>
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
              <div key={i} style={{ marginBottom: 12, padding: 12, borderRadius: 8, border: '1px solid #e8e8e8', background: '#fafafa' }}>
                <Space style={{ marginBottom: 4 }}>
                  <Tag color="purple">第 {i + 1} 分镜</Tag>
                  <Tag color="blue">{(tts?.duration || '-') + 's'}</Tag>
                  <Text type="secondary" style={{ fontSize: 12 }}>{scene.stage}</Text>
                </Space>
                <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>旁白: {(nar?.voice_script?.substring(0, 50) || '')}...</div>
                {editingSceneIdx === i ? (
                  <div>
                    <TextArea value={editSceneText} onChange={e => setEditSceneText(e.target.value)} rows={4} style={{ fontSize: 12, marginBottom: 4 }} />
                    <Button size="small" type="primary" onClick={() => { const u = [...scenes]; u[i] = { ...u[i], scene_prompt: editSceneText }; setScenes(u); setEditingSceneIdx(-1) }}>保存</Button>
                    <Button size="small" style={{ marginLeft: 8 }} onClick={() => setEditingSceneIdx(-1)}>取消</Button>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 12, color: '#666', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{scene.scene_prompt}</div>
                    <Button size="small" type="link" style={{ padding: 0, height: 20, fontSize: 11 }}
                      onClick={() => { setEditingSceneIdx(i); setEditSceneText(scene.scene_prompt || '') }}>编辑</Button>
                  </div>
                )}
              </div>
            )
          })}
          <Alert type="info" message="Prompts ready. 请到「产品创作」页面保存并生成视频." style={{ marginTop: 12 }} />
        </Card>
      )}
    </>
  )}
    </div>
  )
}

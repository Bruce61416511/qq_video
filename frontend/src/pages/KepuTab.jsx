import React, { useState } from 'react'
import { Card, Input, Button, InputNumber, Space, Tag, Alert, Progress, message, Steps, Typography, Tabs } from 'antd'
import { EditOutlined, ThunderboltOutlined, PlusOutlined, DeleteOutlined, AudioOutlined, PictureOutlined, ArrowLeftOutlined } from '@ant-design/icons'

const { TextArea } = Input
const { Text, Title } = Typography

const stepItems = [
  { title: 'Topic' },
  { title: 'Script' },
  { title: 'TTS' },
  { title: 'Scenes' },
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

  const handleGenerateScript = async () => {
    if (!topic.trim()) { message.warning('Please enter a topic'); return }
    setLoading(true)
    setLoadingStep('Generating script...')
    try {
      const res = await fetch('http://localhost:8000/api/kepu/script', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: topic.trim(), shot_count: shotCount }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Failed')
      const nars = [
        { voice_script: data.script.hook, stage: 'hook', index: 0 },
        ...data.script.body.map((text, i) => ({ voice_script: text, stage: 'body', index: i + 1 })),
        { voice_script: data.script.ending, stage: 'ending', index: data.script.body.length + 1 },
      ]
      setNarrations(nars)
      setCurrent(1)
      message.success('Script generated')
    } catch (e) {
      message.error('Failed: ' + e.message)
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
  const handleAddBody = () => {
    const hook = narrations[0], ending = narrations[narrations.length - 1]
    const bodyNars = narrations.slice(1, -1)
    const newBody = { voice_script: '', stage: 'body', index: bodyNars.length + 1 }
    const u = [hook, ...bodyNars, newBody, ending].map((n, j) => ({ ...n, index: j }))
    setNarrations(u)
  }

  const handleTts = async () => {
    const valid = narrations.filter(n => n.voice_script.trim())
    if (!valid.length) { message.warning('No narration content'); return }
    setLoading(true); setLoadingStep('Synthesizing TTS...')
    try {
      const res = await fetch('http://localhost:8000/api/kepu/tts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ narrations: valid }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'TTS failed')
      setTtsResults(data.segments || []); setCurrent(2)
      message.success('TTS done: ' + data.total_duration + 's')
    } catch (e) { message.error('TTS failed: ' + e.message) }
    finally { setLoading(false) }
  }

  const handleGenerateScenes = async () => {
    if (!ttsResults.length) { message.warning('Run TTS first'); return }
    setLoading(true); setLoadingStep('Generating scene prompts...')
    try {
      const res = await fetch('http://localhost:8000/api/kepu/scenes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          narrations: narrations.filter(n => n.voice_script.trim()),
          durations: ttsResults.map(r => r.duration),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Failed')
      setScenes(data.scenes || []); setCurrent(3)
      message.success('Scene prompts generated')
    } catch (e) { message.error('Failed: ' + e.message) }
    finally { setLoading(false) }
  }

  if (loading && loadingStep) {
    return <div style={{ textAlign: 'center', padding: 80 }}>
      <Title level={4}>{loadingStep}</Title>
      <Progress percent={99} status="active" style={{ maxWidth: 400 }} />
    </div>
  }

  const tagColors = { hook: 'red', body: 'blue', ending: 'green' }
  const tagLabels = { hook: 'Hook', body: 'Body', ending: 'Ending' }

  const loadPrompts = async () => {
    setPromptLoading(true)
    try {
      const res = await fetch('http://localhost:8000/api/kepu/prompts')
      const data = await res.json()
      setScriptPrompt(data.prompts['kepu_script_prompt.txt'] || '')
      setScenePrompt(data.prompts['kepu_scene_prompt.txt'] || '')
    } catch (e) { message.error('Failed to load prompts') }
    finally { setPromptLoading(false) }
  }

  const savePrompts = async () => {
    setPromptLoading(true)
    try {
      const res = await fetch('http://localhost:8000/api/kepu/prompts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompts: { 'kepu_script_prompt.txt': scriptPrompt, 'kepu_scene_prompt.txt': scenePrompt } }),
      })
      if (!res.ok) throw new Error('Save failed')
      message.success('Prompts saved')
    } catch (e) { message.error('Save failed: ' + e.message) }
    finally { setPromptLoading(false) }
  }

  const tabItems = [
    { key: 'studio', label: 'Smart Studio' },
    { key: 'config', label: 'Prompt Config' },
  ]

  return (
    <div style={{ padding: 24 }}>
      <Tabs activeKey={tabMode} onChange={(key) => { setTabMode(key); if (key === 'config') loadPrompts() }} items={tabItems} style={{ maxWidth: 700 }} />

      {tabMode === 'config' && (
        <Card title="Prompt Configuration" style={{ maxWidth: 700 }}>
          <Alert type="info" message="Edit prompts to customize LLM behavior. Changes take effect on next generation." style={{ marginBottom: 16 }} />
          <div style={{ marginBottom: 16 }}>
            <Text strong>Script Prompt (kepu_script_prompt.txt)</Text>
            <TextArea rows={12} value={scriptPrompt} onChange={e => setScriptPrompt(e.target.value)}
              style={{ marginTop: 8, fontFamily: 'monospace', fontSize: 12 }} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <Text strong>Scene Prompt (kepu_scene_prompt.txt)</Text>
            <TextArea rows={12} value={scenePrompt} onChange={e => setScenePrompt(e.target.value)}
              style={{ marginTop: 8, fontFamily: 'monospace', fontSize: 12 }} />
          </div>
          <Space>
            <Button onClick={loadPrompts} loading={promptLoading}>Load from Server</Button>
            <Button type="primary" onClick={savePrompts} loading={promptLoading}>Save to Server</Button>
          </Space>
        </Card>
      )}

      {tabMode === 'studio' && (<>
      <Steps current={current} items={stepItems} style={{ maxWidth: 700, marginBottom: 32 }} />

      {current === 0 && (
        <Card title="Topic" style={{ maxWidth: 700 }}>
          <div style={{ marginBottom: 16 }}>
            <Text strong>Video Topic</Text>
            <TextArea value={topic} onChange={e => setTopic(e.target.value)}
              placeholder="e.g. The 2000-year history of soy sauce" rows={3} style={{ marginTop: 8 }} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <Text strong>Body Shots</Text>
            <div style={{ marginTop: 8 }}>
              <InputNumber min={1} max={10} value={shotCount} onChange={v => setShotCount(v)} />
              <Text type="secondary" style={{ marginLeft: 8 }}>{shotCount + 2} shots (hook + {shotCount} body + ending)</Text>
            </div>
          </div>
          <Button type="primary" block icon={<ThunderboltOutlined />} loading={loading} onClick={handleGenerateScript}>
            Generate Script
          </Button>
        </Card>
      )}

      {current === 1 && (
        <Card title={'Script (' + narrations.length + ' shots)'}
          extra={<Button size="small" onClick={() => setCurrent(0)} icon={<ArrowLeftOutlined />}>Back</Button>}
          style={{ maxWidth: 700 }}>
          {narrations.map((nar, i) => (
            <div key={i} style={{ marginBottom: 12, padding: 12, borderRadius: 8, border: '1px solid #e8e8e8', background: editingIndex === i ? '#fffbe6' : '#fafafa' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <Space>
                  <Tag color={tagColors[nar.stage]}>{tagLabels[nar.stage]}</Tag>
                  <Text type="secondary" style={{ fontSize: 12 }}>Shot {i + 1}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>{nar.voice_script.length}c / ~{(nar.voice_script.length / 4.8).toFixed(1)}s</Text>
                </Space>
                <Space size="small">
                  <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(i)}>Edit</Button>
                  {nar.stage === 'body' && <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(i)} />}
                </Space>
              </div>
              {editingIndex === i ? (
                <div>
                  <TextArea value={editText} onChange={e => setEditText(e.target.value)} rows={3} style={{ marginBottom: 8 }} />
                  <Button size="small" type="primary" onClick={() => handleSaveEdit(i)}>Save</Button>
                  <Button size="small" style={{ marginLeft: 8 }} onClick={() => setEditingIndex(-1)}>Cancel</Button>
                </div>
              ) : (
                <div style={{ color: '#333', fontSize: 13, lineHeight: 1.8 }}>{nar.voice_script}</div>
              )}
            </div>
          ))}
          <Space style={{ marginTop: 8 }}>
            <Button icon={<PlusOutlined />} onClick={handleAddBody}>Add Body Shot</Button>
            <Button type="primary" icon={<AudioOutlined />} onClick={handleTts} loading={loading}>Generate TTS</Button>
          </Space>
        </Card>
      )}

      {current === 2 && (
        <Card title="TTS Result"
          extra={<Button size="small" onClick={() => setCurrent(1)} icon={<ArrowLeftOutlined />}>Back</Button>}
          style={{ maxWidth: 700 }}>
          {narrations.filter(n => n.voice_script.trim()).map((nar, i) => {
            const tts = ttsResults[i]
            return (
              <div key={i} style={{ marginBottom: 12, padding: 12, borderRadius: 8, border: '1px solid #e8e8e8', background: '#fafafa' }}>
                <Space><Tag color="blue">Shot {i + 1}</Tag>{tts && <Tag color="green">{tts.duration}s</Tag>}</Space>
                <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>{nar.voice_script.substring(0, 60)}...</div>
              </div>
            )
          })}
          <Space style={{ marginTop: 8 }}>
            <Button type="primary" icon={<PictureOutlined />} onClick={handleGenerateScenes} loading={loading}>Generate Scene Prompts</Button>
          </Space>
        </Card>
      )}

      {current === 3 && (
        <Card title="Scene Prompts"
          extra={<Button size="small" onClick={() => setCurrent(2)} icon={<ArrowLeftOutlined />}>Back</Button>}
          style={{ maxWidth: 700 }}>
          {scenes.map((scene, i) => {
            const nar = narrations[i], tts = ttsResults[i]
            return (
              <div key={i} style={{ marginBottom: 12, padding: 12, borderRadius: 8, border: '1px solid #e8e8e8', background: '#fafafa' }}>
                <Space style={{ marginBottom: 4 }}>
                  <Tag color="purple">Shot {i + 1}</Tag>
                  <Tag color="blue">{(tts?.duration || '-') + 's'}</Tag>
                  <Text type="secondary" style={{ fontSize: 12 }}>{scene.stage}</Text>
                </Space>
                <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>Narration: {(nar?.voice_script?.substring(0, 50) || '')}...</div>
                {editingSceneIdx === i ? (
                  <div>
                    <TextArea value={editSceneText} onChange={e => setEditSceneText(e.target.value)} rows={4} style={{ fontSize: 12, marginBottom: 4 }} />
                    <Button size="small" type="primary" onClick={() => { const u = [...scenes]; u[i] = { ...u[i], scene_prompt: editSceneText }; setScenes(u); setEditingSceneIdx(-1) }}>Save</Button>
                    <Button size="small" style={{ marginLeft: 8 }} onClick={() => setEditingSceneIdx(-1)}>Cancel</Button>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 12, color: '#666', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{scene.scene_prompt}</div>
                    <Button size="small" type="link" style={{ padding: 0, height: 20, fontSize: 11 }}
                      onClick={() => { setEditingSceneIdx(i); setEditSceneText(scene.scene_prompt || '') }}>Edit</Button>
                  </div>
                )}
              </div>
            )
          })}
          <Alert type="info" message="Prompts ready. Save and generate video in the product creation page." style={{ marginTop: 12 }} />
        </Card>
      )}
    </>
  )}
    </div>
  )
}

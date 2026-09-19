import { useState, useEffect, useRef } from 'react'
import { Card, Button, Modal, Input, Select, Tag, App, Space, Popconfirm, Empty, Spin, Progress, Steps, Tooltip } from 'antd'
import {
  PlusOutlined, AudioOutlined, DeleteOutlined, PlayCircleOutlined, ThunderboltOutlined,
  VideoCameraOutlined, ReloadOutlined, FileAddOutlined, SettingOutlined,
} from '@ant-design/icons'
import { avatarApi, factoryApi, imageApi } from '../services/api'
import { loadDraft, saveDraft } from '../services/draft'
import PromptConfigModal from '../components/PromptConfigModal'

const DURATION_OPTIONS = ['5', '10', '15'].map(v => ({ value: v, label: v + ' 秒' }))

const SHOT_STATUS = {
  pending: { color: 'default', text: '等待中' },
  generating: { color: 'processing', text: '生成中' },
  done: { color: 'success', text: '已完成' },
  failed: { color: 'error', text: '失败' },
}

function PolishButton({ prompt, onDone }) {
  const [loading, setLoading] = useState(false)
  const { message } = App.useApp()
  const handle = async () => {
    if (!prompt.trim()) { message.warning('请先写点内容再优化'); return }
    setLoading(true)
    try {
      const res = await imageApi.polishPrompt(prompt, 'video')
      if (res.ok) { message.success('润色完成'); onDone(res.polished) }
      else message.error(res.error || '润色失败')
    } catch (e) { message.error(e.message) } finally { setLoading(false) }
  }
  return <Button size="small" icon={<ThunderboltOutlined />} loading={loading} onClick={handle}>AI 润色</Button>
}

function CreateTaskModal({ open, onClose, onCreated, avatars }) {
  const [name, setName] = useState('')
  const [avatarId, setAvatarId] = useState(null)
  const [size, setSize] = useState('9:16')
  const [resolution, setResolution] = useState('1080P')
  const [shots, setShots] = useState([{ scene_prompt: '', voice_script: '', duration: '5', image_path: '' }])
  const [saving, setSaving] = useState(false)
  const { message } = App.useApp()

  const avatar = avatars.find(a => a.id === avatarId)

  // 草稿暂存：打开弹窗时恢复上次填到一半的内容
  useEffect(() => {
    if (!open) return
    const d = loadDraft('factory-task')
    if (d) {
      setName(d.name || '')
      setAvatarId(d.avatarId ?? (avatars.find(a => a.is_default)?.id ?? null))
      setSize(d.size || '9:16')
      setResolution(d.resolution || '1080P')
      setShots(Array.isArray(d.shots) && d.shots.length ? d.shots : [{ scene_prompt: '', voice_script: '', duration: '5', image_path: '' }])
    }
  }, [open])

  // 填写过程中自动保存草稿（任务创建成功后清除）
  useEffect(() => {
    if (!open) return
    saveDraft('factory-task', { name, avatarId, size, resolution, shots })
  }, [open, name, avatarId, size, resolution, shots])

  const reset = () => {
    setName(''); setAvatarId(avatars.find(a => a.is_default)?.id ?? null)
    setSize('9:16'); setResolution('1080P')
    setShots([{ scene_prompt: '', voice_script: '', duration: '5', image_path: '' }])
  }

  const updateShot = (i, field, value) => {
    setShots(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s))
  }
  const addShot = () => setShots(prev => [...prev, { scene_prompt: '', voice_script: '', duration: '5', image_path: '' }])
  const removeShot = (i) => setShots(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev)

  const handleCreate = async (andGenerate) => {
    if (!name.trim()) { message.warning('请填写任务名称'); return }
    if (!avatar) { message.warning('请选择形象'); return }
    if (shots.some(s => !s.scene_prompt.trim())) { message.warning('每个分镜都要填画面提示词'); return }
    setSaving(true)
    try {
      const task = await factoryApi.create({
        name: name.trim(),
        avatar_id: avatar.id,
        avatar_image: avatar.image_path,
        size, resolution,
        shots: shots.map(s => ({
          scene_prompt: s.scene_prompt.trim(),
          voice_script: s.voice_script.trim(),
          duration: s.duration,
          image_path: s.image_path || '',
        })),
      })
      message.success('任务已创建')
      saveDraft('factory-task', null)  // 任务已落库，清除草稿
      if (andGenerate) {
        await factoryApi.generate(task.id)
        message.success('已开始生成，可在列表中查看进度')
      }
      onCreated()
      onClose()
    } catch (e) { message.error(e.message) }
    finally { setSaving(false) }
  }

  return (
    <Modal title="新建口播任务" open={open} onCancel={() => { onClose(); reset() }} width={860} footer={null} destroyOnClose>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>任务名称</div>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="例：肠道菌群第3期" />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>尺寸 / 分辨率</div>
          <Space>
            <Select value={size} onChange={setSize} style={{ width: 130 }}
              options={[{ value: '9:16', label: '9:16 竖版' }, { value: '16:9', label: '16:9 横版' }]} />
            <Select value={resolution} onChange={setResolution} style={{ width: 120 }}
              options={[{ value: '720P', label: '720P' }, { value: '1080P', label: '1080P' }]} />
          </Space>
        </div>
      </div>

      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>选择形象（定妆照）</div>
      {avatars.length === 0 ? (
        <div style={{ color: '#e6a817', marginBottom: 12 }}>形象库为空，请先去「形象工坊」生成定妆照</div>
      ) : (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          {avatars.map(a => (
            <div key={a.id} onClick={() => setAvatarId(a.id)}
              style={{
                cursor: 'pointer', borderRadius: 10, overflow: 'hidden', width: 84,
                border: avatarId === a.id ? '3px solid #005d50' : '1px solid #eee', padding: 0, position: 'relative',
              }}>
              <img src={'http://localhost:8000' + a.image_url} alt={a.name} style={{ width: '100%', height: 84, objectFit: 'cover', display: 'block' }} />
              <div style={{ fontSize: 11, textAlign: 'center', padding: '3px 0', color: '#5f5e5a' }}>{a.name}</div>
              {a.is_default && <Tag color="green" style={{ position: 'absolute', top: 2, left: 2, fontSize: 10, lineHeight: '14px', padding: '0 4px' }}>默认</Tag>}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>分镜列表（画面提示词必填，台词选填）</div>
        <Button size="small" icon={<PlusOutlined />} onClick={addShot}>添加分镜</Button>
      </div>
      <div style={{ maxHeight: 340, overflowY: 'auto' }}>
        {shots.map((s, i) => (
          <Card key={i} size="small" style={{ marginBottom: 10 }}
            title={`分镜 ${i + 1}`}
            extra={shots.length > 1 && <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeShot(i)} />}
          >
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: '#5f5e5a', marginBottom: 4 }}>
                本镜起始帧（不选则使用任务默认形象；合成图会存进形象库，可在这里选）
              </div>
              <Select
                value={s.image_path || ''}
                onChange={v => updateShot(i, 'image_path', v)}
                style={{ width: 260 }}
                options={[
                  { value: '', label: `任务默认形象${avatar ? `（${avatar.name}）` : ''}` },
                  ...avatars.map(a => ({ value: a.image_path, label: a.name })),
                ]}
              />
            </div>
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                {s.voice_script.trim() ? (
                  <span style={{ fontSize: 12, color: '#b8860b' }}>
                    画面提示词（本镜有台词 → 声画同步生成：提示词描述的动作会被执行，如"轻微点头、手持产品展示"；大动作建议写得小而具体，成功率更高）
                  </span>
                ) : (
                  <span style={{ fontSize: 12, color: '#5f5e5a' }}>
                    画面提示词（本镜无台词 → 图生视频：提示词里的动作/运镜会被执行，起始帧自动使用上方所选形象）
                  </span>
                )}
                <PolishButton prompt={s.scene_prompt} onDone={v => updateShot(i, 'scene_prompt', v)} />
              </div>
              <Input.TextArea value={s.scene_prompt} rows={2}
                onChange={e => updateShot(i, 'scene_prompt', e.target.value)}
                placeholder="例：营养师站在明亮厨房里，面对镜头微笑讲解，轻微手势" />
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: '#5f5e5a', marginBottom: 4 }}>台词（选填，填了会自动配音 + 声画同步，视频时长跟随配音，最多 15 秒）</div>
                <Input.TextArea value={s.voice_script} rows={2}
                  onChange={e => updateShot(i, 'voice_script', e.target.value)}
                  placeholder="例：每天一小把坚果，肠道菌群会更喜欢哦" />
              </div>
              {s.voice_script.trim() ? (
                <Tooltip title="有台词时，视频时长自动跟随配音时长（由台词长短决定），此项不生效">
                  <Select value={s.duration} disabled options={DURATION_OPTIONS} style={{ width: 100 }} />
                </Tooltip>
              ) : (
                <Select value={s.duration} onChange={v => updateShot(i, 'duration', v)} options={DURATION_OPTIONS} style={{ width: 100 }} />
              )}
            </div>
          </Card>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
        <Button block onClick={() => handleCreate(false)} loading={saving} icon={<FileAddOutlined />}>
          仅保存
        </Button>
        <Button block type="primary" onClick={() => handleCreate(true)} loading={saving} icon={<VideoCameraOutlined />}>
          保存并开始生成
        </Button>
      </div>
    </Modal>
  )
}

function TaskCard({ task, onDelete, onRegenShot, onRegenerate }) {
  const [expanded, setExpanded] = useState(false)
  const doneCount = task.shots?.filter(s => s.status === 'done').length ?? 0
  const total = task.shots?.length ?? 0
  const generating = task.status === 'generating'

  return (
    <Card size="small" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        {task.avatar_image_url && (
          <img src={'http://localhost:8000' + task.avatar_image_url} alt="形象"
            style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8 }} />
        )}
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontWeight: 600 }}>{task.name}</span>
            <Tag color={task.status === 'done' ? 'success' : task.status === 'failed' ? 'error' : task.status === 'generating' ? 'processing' : 'default'}>
              {task.status === 'done' ? '已完成' : task.status === 'failed' ? '失败' : task.status === 'generating' ? '生成中' : '草稿'}
            </Tag>
            {task.error && <span style={{ color: '#cf1322', fontSize: 12 }}>{task.error.slice(0, 60)}</span>}
          </div>
          <div style={{ marginTop: 6, maxWidth: 420 }}>
            <Progress percent={total ? Math.round(doneCount / total * 100) : 0} size="small"
              format={() => `${doneCount}/${total}`} status={generating ? 'active' : undefined} />
          </div>
        </div>
        <Space>
          <Button size="small" onClick={() => setExpanded(!expanded)}>{expanded ? '收起' : '分镜详情'}</Button>
          {task.status !== 'done' && task.status !== 'generating' && (
            <Button size="small" type="primary" icon={<PlayCircleOutlined />} onClick={() => onRegenerate(task.id)}>生成</Button>
          )}
          {task.status === 'done' && task.video_path && (
            <Button size="small" icon={<PlayCircleOutlined />}
              onClick={() => window.open('http://localhost:8000/uploads/' + task.video_path.replace(/\\/g, '/').split('/').pop(), '_blank')}>
              播放成片
            </Button>
          )}
          <Popconfirm title="确定删除该任务？" onConfirm={() => onDelete(task.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      </div>

      {expanded && (
        <div style={{ marginTop: 12, borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
          {task.shots.map(s => (
            <div key={s.shot_index} style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
              <Tag color={SHOT_STATUS[s.status]?.color}>镜{s.shot_index}</Tag>
              <span style={{ flex: 1, fontSize: 12, color: '#5f5e5a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.scene_prompt || '（无提示词）'}
              </span>
              {s.error && <span style={{ fontSize: 11, color: '#cf1322', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.error}</span>}
              {s.clip_url && s.status === 'done' && (
                <Button size="small" icon={<PlayCircleOutlined />}
                  onClick={() => window.open('http://localhost:8000' + s.clip_url, '_blank')}>预览</Button>
              )}
              <Button size="small" icon={<ReloadOutlined />} disabled={generating}
                onClick={() => onRegenShot(task.id, s.shot_index)}>重跑</Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

export default function VideoFactory() {
  const [tasks, setTasks] = useState([])
  const [avatars, setAvatars] = useState([])
  const [loading, setLoading] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [promptCfgOpen, setPromptCfgOpen] = useState(false)
  const { message } = App.useApp()
  const pollRef = useRef(null)

  const load = async () => {
    try {
      const [t, a] = await Promise.all([factoryApi.list(), avatarApi.list()])
      setTasks(Array.isArray(t) ? t : [])
      setAvatars(Array.isArray(a) ? a : [])
    } catch (e) { message.error('加载失败: ' + e.message) }
  }

  useEffect(() => {
    setLoading(true)
    load().finally(() => setLoading(false))
  }, [])

  // 有任务在生成中时自动轮询
  useEffect(() => {
    const hasGenerating = tasks.some(t => t.status === 'generating')
    if (hasGenerating && !pollRef.current) {
      pollRef.current = setInterval(load, 4000)
    } else if (!hasGenerating && pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
  }, [tasks])

  const handleRegenerate = async (id) => {
    try { await factoryApi.generate(id); message.success('已开始生成'); load() }
    catch (e) { message.error(e.message) }
  }
  const handleRegenShot = async (id, idx) => {
    try { await factoryApi.regenerateShot(id, idx); message.success(`分镜 ${idx} 已开始重新生成`); load() }
    catch (e) { message.error(e.message) }
  }
  const handleDelete = async (id) => {
    try { await factoryApi.delete(id); message.success('已删除'); load() }
    catch (e) { message.error(e.message) }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#142528' }}>口播工厂</h2>
          <span style={{ fontSize: 13, color: '#8c8c8c' }}>固定形象 + 分镜 → 批量图生视频 → 合并成片（成片自动进素材库）</span>
        </div>
        <Space>
          <Button icon={<SettingOutlined />} onClick={() => setPromptCfgOpen(true)}>润色配置</Button>
          <Button type="primary" size="large" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            新建口播任务
          </Button>
        </Space>
      </div>

      {loading ? <Spin /> : tasks.length === 0 ? (
        <Card><Empty description="还没有任务，点「新建口播任务」开始第一支数字人视频" /></Card>
      ) : (
        tasks.map(t => (
          <TaskCard key={t.id} task={t} onDelete={handleDelete} onRegenShot={handleRegenShot} onRegenerate={handleRegenerate} />
        ))
      )}

      <CreateTaskModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={load}
        avatars={avatars}
      />

      {/* 润色提示词配置弹窗 */}
      <PromptConfigModal
        open={promptCfgOpen}
        mode="video"
        title="图生视频润色提示词"
        onClose={() => setPromptCfgOpen(false)}
      />
    </div>
  )
}

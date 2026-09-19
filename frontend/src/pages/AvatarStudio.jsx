import { useState, useEffect } from 'react'
import { Card, Button, Modal, Input, Select, Tag, App, Space, Upload, Popconfirm, Empty, Spin, Image } from 'antd'
import {
  PictureOutlined, PlusOutlined, UploadOutlined, StarOutlined, DeleteOutlined,
  ThunderboltOutlined, UserOutlined, SettingOutlined, BlockOutlined,
} from '@ant-design/icons'
import { avatarApi, imageApi } from '../services/api'
import { loadDraft, saveDraft } from '../services/draft'
import PromptConfigModal from '../components/PromptConfigModal'

const SIZE_OPTIONS = [
  { value: '9:16', label: '9:16 竖版（视频号）' },
  { value: '16:9', label: '16:9 横版' },
  { value: '1:1', label: '1:1 方形' },
]

const PROMPT_TEMPLATE = {
  人物特征: '25岁亚洲女性营养师，黑色长发扎起，面容亲切',
  服装造型: '白色衬衫，浅绿色围裙',
  表情动作: '微笑，看镜头，半身像',
  光线风格: '柔和自然光，纯色浅背景，写实风格，高清',
}

function templateToPrompt() {
  return Object.values(PROMPT_TEMPLATE).join('，')
}

const COMPOSE_TEMPLATE = '把图1的人物放进图2的场景中，让她手里拿着图3的产品，保持人物长相发型服装和产品瓶身标签不变，统一光影色调，写实风格'

function PolishButton({ prompt, mode, onDone }) {
  const [loading, setLoading] = useState(false)
  const { message } = App.useApp()
  const handle = async () => {
    if (!prompt.trim()) { message.warning('请先写点内容再优化'); return }
    setLoading(true)
    try {
      const res = await imageApi.polishPrompt(prompt, mode)
      if (res.ok) { message.success('润色完成'); onDone(res.polished) }
      else message.error(res.error || '润色失败')
    } catch (e) { message.error(e.message) } finally { setLoading(false) }
  }
  return (
    <Button size="small" icon={<ThunderboltOutlined />} loading={loading} onClick={handle}>
      AI 润色
    </Button>
  )
}

export default function AvatarStudio() {
  const [avatars, setAvatars] = useState([])
  const [loading, setLoading] = useState(false)
  const [genOpen, setGenOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const { message } = App.useApp()

  // 生成弹窗状态（草稿暂存：切页回来自动恢复，任务保存后清除）
  const savedGen = loadDraft('avatar-gen') || {}
  const [genPrompt, setGenPrompt] = useState(savedGen.genPrompt ?? '')
  const [genSize, setGenSize] = useState(savedGen.genSize ?? '9:16')
  const [genCount, setGenCount] = useState(savedGen.genCount ?? 2)
  const [genLoading, setGenLoading] = useState(false)
  const [genResults, setGenResults] = useState(savedGen.genResults ?? [])   // [{url}]
  const [genSelected, setGenSelected] = useState(savedGen.genSelected ?? '')

  // 保存弹窗
  const [saveName, setSaveName] = useState('')
  const [saving, setSaving] = useState(false)

  // 上传弹窗
  const [uploadFile, setUploadFile] = useState(null)
  const [uploadName, setUploadName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [promptCfgOpen, setPromptCfgOpen] = useState(false)

  // 多图合成弹窗（人物图 + 场景图 + 产品图 -> 合成起始帧）
  const [composeOpen, setComposeOpen] = useState(false)
  const [composeFiles, setComposeFiles] = useState([])
  const [composePrompt, setComposePrompt] = useState('')
  const [composeSize, setComposeSize] = useState('9:16')
  const [composeLoading, setComposeLoading] = useState(false)
  const [composeResult, setComposeResult] = useState(null)   // { image_url, image_path }
  const [composeSaveName, setComposeSaveName] = useState('')
  const [composeSaving, setComposeSaving] = useState(false)

  const load = async () => {
    setLoading(true)
    try { setAvatars(await avatarApi.list()) }
    catch (e) { message.error('加载形象失败: ' + e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  // 生图草稿自动保存（保存进形象库后清除）
  useEffect(() => {
    if (!genPrompt && !genResults.length) return
    saveDraft('avatar-gen', { genPrompt, genSize, genCount, genResults, genSelected })
  }, [genPrompt, genSize, genCount, genResults, genSelected])

  const handleGenerate = async () => {
    if (!genPrompt.trim()) { message.warning('请填写提示词'); return }
    setGenLoading(true); setGenResults([]); setGenSelected('')
    try {
      const res = await imageApi.generate(genPrompt.trim(), genSize, genCount)
      if (res.ok && res.urls?.length) {
        setGenResults(res.urls.map(u => ({ url: u })))
        message.success('生成完成，挑一张满意的保存')
      } else {
        message.error(res.message || res.error || '生成失败')
      }
    } catch (e) { message.error(e.message) }
    finally { setGenLoading(false) }
  }

  const openSave = (url) => {
    setGenSelected(url)
    setSaveName('')
    setSaveOpen(true)
  }

  const handleSave = async () => {
    if (!saveName.trim()) { message.warning('请给形象起个名字'); return }
    setSaving(true)
    try {
      await avatarApi.create(saveName.trim(), genPrompt.trim(), genSelected)
      message.success('已存入形象库')
      saveDraft('avatar-gen', null)  // 已入形象库，清除生图草稿
      setSaveOpen(false); setGenOpen(false); setGenResults([])
      load()
    } catch (e) { message.error(e.message) }
    finally { setSaving(false) }
  }

  const handleUpload = async () => {
    if (!uploadFile) { message.warning('请选择图片'); return }
    if (!uploadName.trim()) { message.warning('请给形象起个名字'); return }
    setUploading(true)
    try {
      await avatarApi.upload(uploadFile, uploadName.trim())
      message.success('已存入形象库')
      setUploadOpen(false); setUploadFile(null); setUploadName('')
      load()
    } catch (e) { message.error(e.message) }
    finally { setUploading(false) }
  }

  const setDefault = async (a) => {
    try { await avatarApi.update(a.id, { is_default: 1 }); message.success(`已将「${a.name}」设为默认形象`); load() }
    catch (e) { message.error(e.message) }
  }

  const handleCompose = async () => {
    if (!composeFiles.length) { message.warning('请上传 1~3 张参考图'); return }
    if (!composePrompt.trim()) { message.warning('请填写合成指令'); return }
    setComposeLoading(true); setComposeResult(null)
    try {
      const res = await imageApi.compose(composeFiles.map(f => f.originFileObj || f), composePrompt.trim(), composeSize)
      if (res.ok) {
        setComposeResult(res)
        message.success('合成完成，可保存到形象库')
      } else {
        message.error(res.message || res.error || '合成失败')
      }
    } catch (e) { message.error(e.message) }
    finally { setComposeLoading(false) }
  }

  const handleComposeSave = async () => {
    if (!composeResult) return
    if (!composeSaveName.trim()) { message.warning('请给形象起个名字'); return }
    setComposeSaving(true)
    try {
      await avatarApi.create(composeSaveName.trim(), composePrompt.trim(), '', composeResult.image_path)
      message.success('合成图已存入形象库')
      setComposeOpen(false); setComposeResult(null); setComposeFiles([]); setComposeSaveName('')
      load()
    } catch (e) { message.error(e.message) }
    finally { setComposeSaving(false) }
  }

  const remove = async (a) => {
    try { await avatarApi.delete(a.id); message.success('已删除'); load() }
    catch (e) { message.error(e.message) }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#142528' }}>形象工坊</h2>
          <span style={{ fontSize: 13, color: '#8c8c8c' }}>制作和管理数字人定妆照 · 形象一次做好，反复使用</span>
        </div>
        <Space>
          <Button icon={<SettingOutlined />} onClick={() => setPromptCfgOpen(true)}>润色配置</Button>
          <Button icon={<UploadOutlined />} onClick={() => setUploadOpen(true)}>上传形象</Button>
          <Button icon={<BlockOutlined />} onClick={() => { setComposeOpen(true); if (!composePrompt.trim()) setComposePrompt(COMPOSE_TEMPLATE) }}>
            多图合成
          </Button>
          <Button type="primary" icon={<PlusOutlined />} size="large" onClick={() => { setGenOpen(true); if (!genPrompt.trim()) setGenPrompt(templateToPrompt()) }}>
            AI 生成形象
          </Button>
        </Space>
      </div>

      {loading ? <Spin /> : avatars.length === 0 ? (
        <Card><Empty description="还没有形象，先点「AI 生成形象」做一张定妆照" /></Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
          {avatars.map(a => (
            <Card key={a.id} size="small" hoverable
              cover={
                <div style={{ height: 220, background: '#f0faf7', borderRadius: '14px 14px 0 0', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {a.image_url
                    ? <Image src={'http://localhost:8000' + a.image_url} alt={a.name} width="100%" height="100%" style={{ objectFit: 'cover' }} preview={{ cover: <span style={{ fontSize: 12 }}>查看原图</span> }} />
                    : <PictureOutlined style={{ fontSize: 40, color: '#bfbfbf' }} />}
                </div>
              }>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Space size={6}>
                  <UserOutlined style={{ color: '#005d50' }} />
                  <span style={{ fontWeight: 600 }}>{a.name}</span>
                  {a.is_default && <Tag color="green">默认</Tag>}
                </Space>
              </div>
              {a.prompt && (
                <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 6, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {a.prompt}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                {!a.is_default && (
                  <Button size="small" icon={<StarOutlined />} onClick={() => setDefault(a)}>设为默认</Button>
                )}
                <Popconfirm title="确定删除该形象？" onConfirm={() => remove(a)}>
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* AI 生成弹窗 */}
      <Modal
        title="AI 生成定妆照"
        open={genOpen}
        onCancel={() => setGenOpen(false)}
        width={680}
        footer={null}
      >
        <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: '#5f5e5a' }}>提示词（人物特征 + 服装 + 表情 + 构图 + 光线风格）</span>
          <Space>
            <Button size="small" onClick={() => setGenPrompt(templateToPrompt())}>填入模板</Button>
            <PolishButton prompt={genPrompt} mode="image" onDone={setGenPrompt} />
          </Space>
        </div>
        <Input.TextArea
          value={genPrompt}
          onChange={e => setGenPrompt(e.target.value)}
          rows={4}
          placeholder="例：25岁亚洲女性营养师，黑色长发，白衬衫，微笑看镜头，半身像，柔和自然光，纯色背景，写实风格"
        />
        <div style={{ display: 'flex', gap: 12, marginTop: 12, alignItems: 'center' }}>
          <Select value={genSize} onChange={setGenSize} options={SIZE_OPTIONS} style={{ width: 180 }} />
          <Select value={genCount} onChange={setGenCount}
            options={[1, 2, 3, 4].map(n => ({ value: n, label: `生成 ${n} 张` }))} style={{ width: 120 }} />
          <Button type="primary" loading={genLoading} onClick={handleGenerate} icon={<PictureOutlined />}>
            生成图片
          </Button>
        </div>

        {genLoading && <div style={{ textAlign: 'center', padding: 40 }}><Spin tip="正在生成，约 10~30 秒..." /></div>}

        {genResults.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(genResults.length, 4)}, 1fr)`, gap: 12, marginTop: 16 }}>
            {genResults.map((r, i) => (
              <div key={i} style={{ position: 'relative', border: genSelected === r.url ? '3px solid #005d50' : '1px solid #eee', borderRadius: 10, overflow: 'hidden' }}>
                <Image src={r.url} alt={`结果${i + 1}`} width="100%" style={{ display: 'block' }} preview={{ cover: <span style={{ fontSize: 12 }}>查看原图</span> }} />
                <div style={{ padding: 8, textAlign: 'center' }}>
                  <Button size="small" type={genSelected === r.url ? 'primary' : 'default'} onClick={() => openSave(r.url)}>
                    保存到形象库
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* 命名保存弹窗 */}
      <Modal title="保存到形象库" open={saveOpen} onCancel={() => setSaveOpen(false)}
        onOk={handleSave} okText="保存" confirmLoading={saving}>
        {genSelected && <Image src={genSelected} alt="选中" width="100%" style={{ maxHeight: 300, objectFit: 'contain', marginBottom: 12 }} preview={{ cover: <span style={{ fontSize: 12 }}>查看原图</span> }} />}
        <Input value={saveName} onChange={e => setSaveName(e.target.value)} placeholder="形象名称，例：营养师小雨" />
        <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 8 }}>生成时用的提示词会自动存档，以后可基于它生成同款新角度。</div>
      </Modal>

      {/* 上传弹窗 */}
      <Modal title="上传形象图片" open={uploadOpen} onCancel={() => setUploadOpen(false)}
        onOk={handleUpload} okText="保存" confirmLoading={uploading}>
        <Upload maxCount={1} accept="image/*" beforeUpload={f => { setUploadFile(f); return false }} showUploadList>
          <Button icon={<UploadOutlined />}>选择图片</Button>
        </Upload>
        {uploadFile && <div style={{ marginTop: 8, fontSize: 13 }}>{uploadFile.name}</div>}
        <Input style={{ marginTop: 12 }} value={uploadName} onChange={e => setUploadName(e.target.value)} placeholder="形象名称，例：营养师小雨" />
      </Modal>
      {/* 多图合成弹窗 */}
      <Modal
        title="多图合成（人物 + 场景 + 产品）"
        open={composeOpen}
        onCancel={() => setComposeOpen(false)}
        width={720}
        footer={null}
      >
        <div style={{ fontSize: 13, color: '#5f5e5a', marginBottom: 8 }}>
          上传 1~3 张参考图（建议顺序：图1 人物、图2 场景、图3 产品），模型会按指令把它们融合成一张全新的起始帧。
        </div>
        <Upload
          maxCount={3}
          multiple
          accept="image/*"
          listType="picture-card"
          fileList={composeFiles}
          beforeUpload={() => false}
          onChange={({ fileList: fl }) => setComposeFiles(fl.slice(0, 3))}
        >
          {composeFiles.length < 3 && (
            <div>
              <PlusOutlined />
              <div style={{ marginTop: 6, fontSize: 12 }}>上传图片</div>
            </div>
          )}
        </Upload>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '10px 0 6px' }}>
          <span style={{ fontSize: 13, color: '#5f5e5a' }}>合成指令（用 图1/图2/图3 指代各张图）</span>
          <Space>
            <Button size="small" onClick={() => setComposePrompt(COMPOSE_TEMPLATE)}>填入模板</Button>
            <PolishButton prompt={composePrompt} mode="compose" onDone={setComposePrompt} />
          </Space>
        </div>
        <Input.TextArea
          value={composePrompt}
          onChange={e => setComposePrompt(e.target.value)}
          rows={3}
          placeholder="例：把图1的人物放进图2的场景中，手里拿着图3的产品，保持人物长相和产品标签不变"
        />
        <div style={{ display: 'flex', gap: 12, marginTop: 12, alignItems: 'center' }}>
          <Select value={composeSize} onChange={setComposeSize} options={SIZE_OPTIONS} style={{ width: 180 }} />
          <Button type="primary" loading={composeLoading} onClick={handleCompose} icon={<BlockOutlined />}>
            开始合成
          </Button>
          <span style={{ fontSize: 12, color: '#8c8c8c' }}>约 10~30 秒，几毛钱一张</span>
        </div>

        {composeLoading && <div style={{ textAlign: 'center', padding: 30 }}><Spin tip="正在合成..." /></div>}

        {composeResult && (
          <div style={{ marginTop: 16, borderTop: '1px solid #f0f0f0', paddingTop: 14 }}>
            <Image src={'http://localhost:8000' + composeResult.image_url} alt="合成结果"
              width="100%" style={{ maxWidth: '100%', maxHeight: 320, objectFit: 'contain', display: 'block', margin: '0 auto', borderRadius: 8 }} preview={{ cover: <span style={{ fontSize: 12 }}>查看原图</span> }} />
            <div style={{ display: 'flex', gap: 12, marginTop: 12, justifyContent: 'center' }}>
              <Input value={composeSaveName} onChange={e => setComposeSaveName(e.target.value)}
                placeholder="形象名称，例：营养师-厨房-汽水" style={{ width: 260 }} />
              <Button type="primary" loading={composeSaving} onClick={handleComposeSave}>保存到形象库</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* 润色提示词配置弹窗 */}
      <PromptConfigModal
        open={promptCfgOpen}
        mode="image"
        title="文生图润色提示词"
        onClose={() => setPromptCfgOpen(false)}
      />
    </div>
  )
}

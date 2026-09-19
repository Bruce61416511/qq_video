import { useEffect, useState } from 'react'
import { Modal, Input, Button, App, Spin, Tag, Tabs } from 'antd'
import { imageApi } from '../services/api'

/**
 * 润色提示词配置弹窗（形象工坊 / 口播工厂共用）
 * 三个页签：image（文生图润色）| video（图生视频润色）| compose（多图合成润色）
 * mode prop = 打开时默认定位的页签
 * 保存留空 = 恢复默认（删除自定义值，回退到 backend/app/prompts/ 下的 txt 文件）
 */
const TAB_ITEMS = [
  { key: 'image', label: '文生图润色' },
  { key: 'video', label: '图生视频润色' },
  { key: 'compose', label: '多图合成润色' },
]
const TAB_TITLES = { image: '文生图', video: '图生视频', compose: '多图合成' }

export default function PromptConfigModal({ open, mode, title, onClose }) {
  const [activeTab, setActiveTab] = useState(mode || 'image')
  const [value, setValue] = useState('')
  const [fileDefault, setFileDefault] = useState('')
  const [isCustom, setIsCustom] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const { message } = App.useApp()

  useEffect(() => {
    if (!open) return
    setActiveTab(mode || 'image')
  }, [open, mode])

  useEffect(() => {
    if (!open) return
    setLoading(true)
    imageApi.getPolishConfig(activeTab)
      .then(c => {
        setValue(c.effective || '')
        setFileDefault(c.file_default || '')
        setIsCustom(!!c.is_custom)
      })
      .catch(e => message.error('读取配置失败: ' + e.message))
      .finally(() => setLoading(false))
  }, [open, activeTab])

  const save = async (prompt) => {
    setSaving(true)
    try {
      await imageApi.savePolishConfig(activeTab, prompt)
      message.success(prompt.trim() ? `${TAB_TITLES[activeTab]}：已保存，立即生效` : `${TAB_TITLES[activeTab]}：已恢复默认`)
      onClose()
    } catch (e) { message.error(e.message) }
    finally { setSaving(false) }
  }

  return (
    <Modal
      title={<span>{title || '润色提示词配置'} {isCustom && <Tag color="orange">{TAB_TITLES[activeTab]}已自定义</Tag>}</span>}
      open={open}
      onCancel={onClose}
      width={720}
      footer={[
        <Button key="reset" onClick={() => save('')} disabled={saving || loading}>恢复默认</Button>,
        <Button key="ok" type="primary" loading={saving} onClick={() => save(value)}>保存当前页签</Button>,
      ]}
    >
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={TAB_ITEMS.map(t => ({ key: t.key, label: t.label }))}
      />
      {loading ? <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div> : (
        <>
          <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 8 }}>
            这是「{TAB_TITLES[activeTab]}」AI 润色按钮背后使用的提示词（System Prompt）。修改保存后立即生效，无需重启后端。
            保存空内容 = 恢复默认值（默认值文件：backend/app/prompts/）。
          </div>
          <Input.TextArea
            value={value}
            onChange={e => setValue(e.target.value)}
            rows={10}
            placeholder="润色提示词（System Prompt）"
          />
          {fileDefault && !isCustom && (
            <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 8 }}>
              当前使用文件默认值，可在上方修改后保存为自定义版本。
            </div>
          )}
        </>
      )}
    </Modal>
  )
}

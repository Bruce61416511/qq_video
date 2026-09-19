import { useEffect, useState } from 'react'
import { Modal, Input, Button, App, Spin, Tag } from 'antd'
import { imageApi } from '../services/api'

/**
 * 润色提示词配置弹窗（形象工坊 / 口播工厂共用）
 * mode: 'image'（文生图润色）| 'video'（图生视频润色）
 * 保存留空 = 恢复默认（删除自定义值，回退到 backend/app/prompts/ 下的 txt 文件）
 */
export default function PromptConfigModal({ open, mode, title, onClose }) {
  const [value, setValue] = useState('')
  const [fileDefault, setFileDefault] = useState('')
  const [isCustom, setIsCustom] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const { message } = App.useApp()

  useEffect(() => {
    if (!open) return
    setLoading(true)
    imageApi.getPolishConfig(mode)
      .then(c => {
        setValue(c.effective || '')
        setFileDefault(c.file_default || '')
        setIsCustom(!!c.is_custom)
      })
      .catch(e => message.error('读取配置失败: ' + e.message))
      .finally(() => setLoading(false))
  }, [open, mode])

  const save = async (prompt) => {
    setSaving(true)
    try {
      await imageApi.savePolishConfig(mode, prompt)
      message.success(prompt.trim() ? '已保存，立即生效' : '已恢复默认')
      onClose()
    } catch (e) { message.error(e.message) }
    finally { setSaving(false) }
  }

  return (
    <Modal
      title={<span>{title} {isCustom && <Tag color="orange">已自定义</Tag>}</span>}
      open={open}
      onCancel={onClose}
      width={720}
      footer={[
        <Button key="reset" onClick={() => save('')} disabled={saving || loading}>恢复默认</Button>,
        <Button key="ok" type="primary" loading={saving} onClick={() => save(value)}>保存</Button>,
      ]}
    >
      {loading ? <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div> : (
        <>
          <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 8 }}>
            这是页面里「AI 润色」按钮背后使用的提示词（System Prompt）。修改保存后立即生效，无需重启后端。
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

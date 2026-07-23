import { useState, useEffect } from 'react'
import { Modal, Form, Input, DatePicker, Tag, Select, App } from 'antd'
import { accountsApi, mediaApi, publishApi } from '../services/api'

export default function PublishModal({ video, onClose }) {
  const [form] = Form.useForm()
  const [accounts, setAccounts] = useState([])
  const [mediaList, setMediaList] = useState([])
  const [selectedIds, setSelectedIds] = useState([])
  const [selectedMediaId, setSelectedMediaId] = useState(video?.id || null)
  const [submitting, setSubmitting] = useState(false)
  const { message } = App.useApp()

  useEffect(() => {
    accountsApi.list().then(data => setAccounts(Array.isArray(data) ? data : [])).catch(() => {})
    mediaApi.list().then(data => setMediaList(Array.isArray(data) ? data : [])).catch(() => {})
  }, [])

  const handleOk = async () => {
    try {
      const vals = await form.validateFields()
      if (selectedIds.length === 0) { message.warning('请至少选择一个账号'); return }
      if (!selectedMediaId) { message.warning('请选择一个视频'); return }
      setSubmitting(true)
      await publishApi.create({
        media_id: selectedMediaId,
        account_ids: selectedIds,
        title: vals.title,
        tags: vals.tags || '',
      })
      message.success(`发布任务已提交！${selectedIds.length} 个账号`)
      onClose()
    } catch (e) {
      message.error(e.message || '提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  const selectedMedia = mediaList.find(m => m.id === selectedMediaId)

  return (
    <Modal title="发布视频" open onOk={handleOk} onCancel={onClose} okText="确认发布" cancelText="取消" width={580} destroyOnClose confirmLoading={submitting}>
      <Form form={form} layout="vertical">
        <Form.Item label="选择视频" required>
          <Select
            placeholder="从素材库选择视频"
            value={selectedMediaId}
            onChange={setSelectedMediaId}
            options={mediaList.filter(m => m.status === 'ready').map(m => ({
              value: m.id,
              label: `${m.name} (${m.duration || '?'} · ${m.size || '?'})`,
            }))}
            style={{ width: '100%' }}
            notFoundContent="暂无可用视频，请先生成或上传"
          />
        </Form.Item>

        {selectedMedia && (
          <div style={{ display: 'flex', gap: 12, padding: 12, background: '#fafafa', borderRadius: 8, marginBottom: 20 }}>
            <div style={{ width: 80, height: 50, background: '#e8e8e8', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#bfbfbf' }}>预览</div>
            <div>
              <div style={{ fontWeight: 500 }}>{selectedMedia.name}</div>
              <div style={{ fontSize: 12, color: '#8c8c8c' }}>{selectedMedia.size} · {selectedMedia.duration}</div>
            </div>
          </div>
        )}

        <Form.Item label="选择发布账号" required>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {accounts.map(acc => {
              const active = selectedIds.includes(acc.id)
              const can = acc.status === 'online'
              return (
                <Tag.CheckableTag
                  key={acc.id}
                  checked={active}
                  onChange={() => can && setSelectedIds(prev => prev.includes(acc.id) ? prev.filter(x => x !== acc.id) : [...prev, acc.id])}
                  style={{ padding: '4px 14px', borderRadius: 20, opacity: can ? 1 : 0.4, cursor: can ? 'pointer' : 'not-allowed' }}
                >
                  <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', marginRight: 6, background: acc.status === 'online' ? '#52c41a' : acc.status === 'expired' ? '#faad14' : '#d9d9d9' }} />
                  {acc.name}
                </Tag.CheckableTag>
              )
            })}
          </div>
          <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 4 }}>仅绿色在线账号可选</div>
        </Form.Item>

        <Form.Item label="视频标题/描述" name="title" rules={[{ required: true, message: '请输入视频标题' }]}>
          <Input.TextArea rows={3} maxLength={1000} showCount placeholder="输入视频标题或描述内容..." />
        </Form.Item>

        <Form.Item label="话题标签" name="tags">
          <Input placeholder="例如: #健康饮食 #食品科普 #养生" />
        </Form.Item>

        <Form.Item label="定时发布" name="schedule">
          <DatePicker showTime style={{ width: '100%' }} placeholder="留空则立即发布" />
        </Form.Item>
      </Form>
    </Modal>
  )
}

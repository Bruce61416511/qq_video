import { useState, useEffect } from 'react'
import { Table, Button, Tag, Space, Upload, Popconfirm, App } from 'antd'
import { UploadOutlined, SendOutlined, DeleteOutlined, CheckCircleOutlined, LoadingOutlined, CloseCircleOutlined, PlayCircleOutlined } from '@ant-design/icons'
import PublishModal from '../components/PublishModal'
import { mediaApi } from '../services/api'

const statusMap = {
  ready: { color: 'success', icon: <CheckCircleOutlined />, text: '就绪' },
  generating: { color: 'processing', icon: <LoadingOutlined />, text: '生成中' },
  failed: { color: 'error', icon: <CloseCircleOutlined />, text: '失败' },
}

export default function MediaLibrary() {
  const [media, setMedia] = useState([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState([])
  const [publishVideo, setPublishVideo] = useState(null)
  const { message } = App.useApp()

  const loadMedia = async () => {
    setLoading(true)
    try {
      const data = await mediaApi.list()
      setMedia(Array.isArray(data) ? data : [])
    } catch (e) {
      message.error('加载素材失败: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadMedia() }, [])

  const handleUpload = async (file) => {
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await fetch('http://localhost:8001/api/media/upload', { method: 'POST', body: formData })
      if (!res.ok) throw new Error('上传失败')
      message.success(`上传成功: ${file.name}`)
      loadMedia()
    } catch (e) {
      message.error('上传失败: ' + e.message)
    }
    return false
  }

  const deleteMedia = async (id) => {
    try {
      await mediaApi.delete(id)
      message.success('已删除')
      loadMedia()
    } catch (e) {
      message.error(e.message)
    }
  }

  const playVideo = (record) => {
    const name = (record.filepath || '').replace(/\\/g, '/').split('/').pop()
    if (!name) { message.warning('文件路径无效'); return }
    window.open('http://localhost:8001/uploads/' + name, '_blank')
  }

  const readyCount = media.filter(m => m.status === 'ready').length

  const columns = [
    {
      title: '素材名称', dataIndex: 'name', key: 'name', width: 260,
      render: (t, r) => (
        <Space>
          <div style={{ width: 72, height: 44, background: '#f0f0f0', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#bfbfbf' }}>
            {r.status === 'generating' ? '生成中' : '缩略图'}
          </div>
          <span style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160, display: 'inline-block' }}>{t}</span>
        </Space>
      ),
    },
    { title: '大小', dataIndex: 'size', key: 'size', width: 100 },
    { title: '时长', dataIndex: 'duration', key: 'duration', width: 80 },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at', width: 180, render: t => <span style={{ color: '#8c8c8c' }}>{t ? new Date(t).toLocaleString('zh-CN') : ''}</span> },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 110,
      render: (s) => {
        const m = statusMap[s] || statusMap.ready
        return <Tag icon={m.icon} color={m.color}>{m.text}</Tag>
      },
    },
    {
      title: '操作', key: 'action', width: 220,
      render: (_, r) => (
        <Space>
          {r.status === 'ready' && (
            <Button size="small" icon={<PlayCircleOutlined />} onClick={() => playVideo(r)}>播放</Button>
          )}
          <Button type="primary" size="small" icon={<SendOutlined />} disabled={r.status !== 'ready'} onClick={() => setPublishVideo(r)}>发布</Button>
          <Popconfirm title="确定删除？" onConfirm={() => deleteMedia(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>素材库</h2>
          <span style={{ fontSize: 13, color: '#8c8c8c' }}>共 {media.length} 个素材 · {readyCount} 个就绪</span>
        </div>
        <Space>
          <Upload beforeUpload={handleUpload} showUploadList={false} accept="video/*">
            <Button type="primary" icon={<UploadOutlined />} size="large">上传视频</Button>
          </Upload>
        </Space>
      </div>

      <Table
        columns={columns}
        dataSource={media}
        rowKey="id"
        pagination={false}
        loading={loading}
        rowSelection={{
          selectedRowKeys: selected,
          onChange: setSelected,
          getCheckboxProps: (r) => ({ disabled: r.status !== 'ready' }),
        }}
      />

      {publishVideo && <PublishModal video={publishVideo} onClose={() => { setPublishVideo(null); loadMedia() }} />}
    </div>
  )
}

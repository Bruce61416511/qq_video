import { useState, useEffect } from 'react'
import { Table, Tag, Space, App, Button, Popconfirm } from 'antd'
import { CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined, ClockCircleOutlined, DeleteOutlined } from '@ant-design/icons'
import { publishApi, accountsApi, mediaApi } from '../services/api'

const statusMap = {
  pending: { color: 'default', icon: <ClockCircleOutlined />, text: '排队中' },
  running: { color: 'processing', icon: <LoadingOutlined />, text: '发布中' },
  success: { color: 'success', icon: <CheckCircleOutlined />, text: '成功' },
  failed: { color: 'error', icon: <CloseCircleOutlined />, text: '失败' },
}

export default function PublishTasks() {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(false)
  const [accounts, setAccounts] = useState({})
  const [mediaMap, setMediaMap] = useState({})
  const { message } = App.useApp()

  const loadData = async () => {
    setLoading(true)
    try {
      const [taskData, accData, medData] = await Promise.all([
        publishApi.tasks(),
        accountsApi.list(),
        mediaApi.list(),
      ])
      const taskList = Array.isArray(taskData) ? taskData : []
      const accList = Array.isArray(accData) ? accData : []
      const medList = Array.isArray(medData) ? medData : []

      const accMap = {}
      accList.forEach(a => { accMap[a.id] = a.name })
      const mMap = {}
      medList.forEach(m => { mMap[m.id] = m.name })

      setTasks(taskList.reverse())
      setAccounts(accMap)
      setMediaMap(mMap)
    } catch (e) {
      message.error('加载失败: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  useEffect(() => {
    const hasActive = tasks.some(t => t.status === 'pending' || t.status === 'running')
    if (!hasActive) return
    const timer = setInterval(loadData, 5000)
    return () => clearInterval(timer)
  }, [tasks])

  const clearAll = async () => {
    try {
      await publishApi.clearAll()
      message.success('已清除所有发布记录')
      loadData()
    } catch (e) {
      message.error('清除失败: ' + e.message)
    }
  }

  const columns = [
    { title: '#', dataIndex: 'id', key: 'id', width: 60 },
    {
      title: '账号', dataIndex: 'account_id', key: 'account_id', width: 140,
      render: (id) => accounts[id] || `#${id}`,
    },
    {
      title: '视频', dataIndex: 'media_id', key: 'media_id', width: 180,
      render: (id) => mediaMap[id] || `#${id}`,
      ellipsis: true,
    },
    { title: '标题', dataIndex: 'title', key: 'title', ellipsis: true },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 100,
      render: (s) => {
        const m = statusMap[s] || statusMap.pending
        return <Tag icon={m.icon} color={m.color}>{m.text}</Tag>
      },
    },
    {
      title: '错误信息', dataIndex: 'error_msg', key: 'error_msg', width: 240,
      render: (msg) => msg ? <span style={{ color: '#ff4d4f', fontSize: 13 }}>{msg}</span> : <span style={{ color: '#ccc' }}>-</span>,
    },
    {
      title: '时间', dataIndex: 'created_at', key: 'created_at', width: 170,
      render: (t) => t ? new Date(t).toLocaleString('zh-CN') : '',
    },
  ]

  const successCount = tasks.filter(t => t.status === 'success').length
  const failCount = tasks.filter(t => t.status === 'failed').length
  const activeCount = tasks.filter(t => t.status === 'pending' || t.status === 'running').length

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>发布记录</h2>
          <Space style={{ marginTop: 4 }}>
            <span style={{ fontSize: 13, color: '#8c8c8c' }}>
              共 {tasks.length} 条 · 成功 {successCount} · 失败 {failCount}
            </span>
            {activeCount > 0 && (
              <Tag icon={<LoadingOutlined spin />} color="processing">进行中 {activeCount}</Tag>
            )}
          </Space>
        </div>
        <Space>
          {tasks.length > 0 && (
            <Popconfirm title="确定清除所有发布记录？" onConfirm={clearAll} okText="确定" cancelText="取消">
              <Button danger icon={<DeleteOutlined />}>清除所有记录</Button>
            </Popconfirm>
          )}
          <a onClick={loadData} style={{ fontSize: 13, cursor: 'pointer', lineHeight: '32px' }}>刷新</a>
        </Space>
      </div>

      <Table
        columns={columns}
        dataSource={tasks}
        rowKey="id"
        pagination={{ pageSize: 20 }}
        loading={loading}
        size="middle"
      />
    </div>
  )
}

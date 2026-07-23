import { useState, useEffect } from 'react'
import { Table, Button, Modal, Input, Space, Popconfirm, App } from 'antd'
import { PlusOutlined, QrcodeOutlined, ReloadOutlined, SendOutlined, DeleteOutlined, UserOutlined, LoadingOutlined, CheckCircleOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import PublishModal from '../components/PublishModal'
import { accountsApi } from '../services/api'

const MAX = 10

export default function Accounts() {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [qrOpen, setQrOpen] = useState(false)
  const [qrId, setQrId] = useState(null)
  const [publishTarget, setPublishTarget] = useState(null)
  const { message } = App.useApp()

  const loadAccounts = async () => {
    setLoading(true)
    try {
      const data = await accountsApi.list()
      setAccounts(Array.isArray(data) ? data : [])
    }
    catch (e) { message.error('加载账号失败: ' + e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { loadAccounts() }, [])

  const addAccount = async () => {
    if (!newName.trim()) return
    if (accounts.length >= MAX) { message.warning('已达上限 ' + MAX + ' 个'); return }
    try { await accountsApi.create(newName.trim()); setNewName(''); setAddOpen(false); message.success('已添加'); loadAccounts() }
    catch (e) { message.error(e.message) }
  }

  const showQR = async (id) => {
    setQrId(id); setQrOpen(true)
    try {
      await accountsApi.qrcode(id)
      startPolling(id)
    } catch (e) { message.error('扫码失败: ' + e.message); setQrOpen(false) }
  }

  const startPolling = async (id) => {
    for (let i = 0; i < 150; i++) {
      await new Promise(r => setTimeout(r, 2000))
      try {
        const list = await accountsApi.list()
        const acc = (Array.isArray(list) ? list : []).find(a => a.id === id)
        if (acc && acc.status === 'online') {
          message.success('绑定成功: ' + acc.name)
          setQrOpen(false); setQrId(null)
          loadAccounts()
          return
        }
      } catch (e) { }
      try {
        const s = await accountsApi.qrcodeStatus(id)
        if (!s || s.status === "not_found") {
          try {
            const list = await accountsApi.list()
            const acc = (Array.isArray(list) ? list : []).find(a => a.id === id)
            if (acc && acc.status === "online") {
              message.success("已绑定: " + acc.name)
            } else {
              message.info("会话已结束")
            }
          } catch (e) { }
          setQrOpen(false); setQrId(null)
          loadAccounts()
          return
        }
        if (s && s.status === 'success') {
          try {
            await accountsApi.bind(id)
            message.success('绑定成功')
          } catch (e) {
            message.warning('绑定成功，请刷新: ' + e.message)
          }
          setQrOpen(false); setQrId(null)
          loadAccounts()
          return
        }
        if (s && s.status === 'error') {
          message.error(s.message || '登录失败')
          setQrOpen(false); setQrId(null)
          return
        }
      } catch (e) { }
    }
    message.warning('登录超时 (5分钟)')
    setQrOpen(false); setQrId(null)
  }

  const checkAccount = async (id) => {
    message.loading({ content: '正在检查登录态...', key: 'check' })
    try {
      const result = await accountsApi.validate(id)
      if (result.valid) {
        message.success({ content: '登录有效 · ' + (result.nickname || ''), key: 'check' })
      } else {
        message.warning({ content: '登录已过期', key: 'check' })
      }
      loadAccounts()
    } catch (e) {
      message.error({ content: '检查失败: ' + e.message, key: 'check' })
    }
  }

  const deleteAccount = async (id) => {
    try { await accountsApi.delete(id); message.success('已删除'); loadAccounts() }
    catch (e) { message.error(e.message) }
  }

  const columns = [
    {
      title: '账号', dataIndex: 'name', key: 'name', width: 250,
      render: (text, record) => (
        <Space>
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4f46e5', fontWeight: 700, fontSize: 14 }}>
            <UserOutlined />
          </div>
          <div>
            <div style={{ fontWeight: 600 }}>{text}</div>
            {record.channel_name && <div style={{ fontSize: 12, color: '#8c8c8c' }}>{record.channel_name}</div>}
          </div>
        </Space>
      ),
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 100,
      render: (s) => {
        const map = { online: { color: '#52c41a', text: '在线' }, expired: { color: '#faad14', text: '已过期' }, offline: { color: '#d9d9d9', text: '离线' } }
        const m = map[s] || map.offline
        return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 6, height: 6, borderRadius: '50%', display: 'inline-block', background: m.color }} />{m.text}</span>
      },
    },
    { title: '上次登录', dataIndex: 'last_login', key: 'last_login', width: 180, render: (t) => <span style={{ color: '#8c8c8c' }}>{t || '从未登录'}</span> },
    {
      title: '操作', key: 'action', width: 380,
      render: (_, record) => (
        <Space>
          {record.status === 'offline' && <Button type="primary" size="small" icon={<QrcodeOutlined />} onClick={() => showQR(record.id)}>扫码绑定</Button>}
          {record.status === 'expired' && <Button size="small" icon={<ReloadOutlined />} onClick={() => showQR(record.id)}>重新扫码</Button>}
          {record.status === 'online' && <Button size="small" icon={<SafetyCertificateOutlined />} onClick={() => checkAccount(record.id)}>检查登录</Button>}
          <Button type={record.status === 'online' ? 'primary' : 'default'} size="small" icon={<SendOutlined />} disabled={record.status !== 'online'} onClick={() => setPublishTarget(record)}>发布</Button>
          <Popconfirm title="确定删除？" onConfirm={() => deleteAccount(record.id)}><Button size="small" danger icon={<DeleteOutlined />} /></Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div><h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>账号管理</h2><span style={{ fontSize: 13, color: '#8c8c8c' }}>{accounts.length}/{MAX} 个账号</span></div>
        <Button type="primary" icon={<PlusOutlined />} disabled={accounts.length >= MAX} onClick={() => setAddOpen(true)} size="large">添加账号</Button>
      </div>
      <Table columns={columns} dataSource={accounts} rowKey="id" pagination={false} loading={loading} />
      <Modal title="添加账号" open={addOpen} onOk={addAccount} onCancel={() => { setAddOpen(false); setNewName('') }} okText="确认" cancelText="取消">
        <Input placeholder="账号名称" value={newName} onChange={e => setNewName(e.target.value)} style={{ marginTop: 8 }} />
      </Modal>
      <Modal title="扫码登录" open={qrOpen} onCancel={() => { setQrOpen(false); setQrId(null) }} footer={null} width={420} centered>
        <div style={{ textAlign: 'center', padding: '24px 16px' }}>
          <LoadingOutlined style={{ fontSize: 40, color: '#4f46e5', marginBottom: 16 }} spin />
          <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>请在弹出的浏览器窗口中扫码</p>
          <p style={{ fontSize: 13, color: '#8c8c8c', marginBottom: 16 }}>
            已打开 Chromium 浏览器并显示二维码。<br />
            请使用手机微信扫描。
          </p>
          <div style={{ background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 8, padding: 12 }}>
            <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 6 }} />
            <span style={{ fontSize: 13 }}>自动检测登录中...</span>
          </div>
        </div>
      </Modal>
      {publishTarget && <PublishModal video={null} onClose={() => setPublishTarget(null)} />}
    </div>
  )
}

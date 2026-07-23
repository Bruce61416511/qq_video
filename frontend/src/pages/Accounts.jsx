import { useState, useEffect } from 'react'
import { Table, Button, Modal, Input, Space, Popconfirm, App } from 'antd'
import { PlusOutlined, QrcodeOutlined, ReloadOutlined, SendOutlined, DeleteOutlined, UserOutlined, LoadingOutlined, CheckCircleOutlined } from '@ant-design/icons'
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
  const [qrScanning, setQrScanning] = useState(false)
  const [publishTarget, setPublishTarget] = useState(null)
  const { message } = App.useApp()

  const loadAccounts = async () => {
    setLoading(true)
    try {
      const data = await accountsApi.list()
      setAccounts(Array.isArray(data) ? data : [])
      // Auto-validate online accounts
      try { await accountsApi.checkAll() } catch {}
      // Reload after validation
      const updated = await accountsApi.list()
      setAccounts(Array.isArray(updated) ? updated : [])
    }
    catch (e) { message.error('Failed to load accounts: ' + e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { loadAccounts() }, [])

  const addAccount = async () => {
    if (!newName.trim()) return
    if (accounts.length >= MAX) { message.warning('Max ' + MAX + ' accounts'); return }
    try { await accountsApi.create(newName.trim()); setNewName(''); setAddOpen(false); message.success('Added'); loadAccounts() }
    catch (e) { message.error(e.message) }
  }

  const showQR = async (id) => {
    setQrId(id); setQrOpen(true); setQrScanning(false)
    try {
      await accountsApi.qrcode(id)
      startPolling(id)
    } catch (e) { message.error('Error: ' + e.message); setQrOpen(false) }
  }

  const startPolling = async (id) => {
    for (let i = 0; i < 150; i++) {
      await new Promise(r => setTimeout(r, 2000))
      try {
        const list = await accountsApi.list()
        const acc = (Array.isArray(list) ? list : []).find(a => a.id === id)
        if (acc && acc.status === 'online') {
          message.success('Bound successfully: ' + acc.name)
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
              message.success("Already bound: " + acc.name)
            } else {
              message.info("Session ended")
            }
          } catch (e) { }
          setQrOpen(false); setQrId(null)
          loadAccounts()
          return
        }
        if (s && s.status === 'success') {
          try {
            await accountsApi.bind(id)
            message.success('Bound successfully')
          } catch (e) {
            message.warning('Bound but refresh needed: ' + e.message)
          }
          setQrOpen(false); setQrId(null)
          loadAccounts()
          return
        }
        if (s && s.status === 'error') {
          message.error(s.message || 'Login failed')
          setQrOpen(false); setQrId(null)
          return
        }
      } catch (e) { }
    }
    message.warning('Login timeout (5 min)')
    setQrOpen(false); setQrId(null)
  }

  const deleteAccount = async (id) => {
    try { await accountsApi.delete(id); message.success('Deleted'); loadAccounts() }
    catch (e) { message.error(e.message) }
  }

  const columns = [
    {
      title: 'Account', dataIndex: 'name', key: 'name', width: 250,
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
      title: 'Status', dataIndex: 'status', key: 'status', width: 120,
      render: (s) => {
        const map = { online: { color: '#52c41a', text: 'Online' }, expired: { color: '#faad14', text: 'Expired' }, offline: { color: '#d9d9d9', text: 'Offline' } }
        const m = map[s] || map.offline
        return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 6, height: 6, borderRadius: '50%', display: 'inline-block', background: m.color }} />{m.text}</span>
      },
    },
    { title: 'Last Login', dataIndex: 'last_login', key: 'last_login', width: 180, render: (t) => <span style={{ color: '#8c8c8c' }}>{t || 'Never'}</span> },
    {
      title: 'Actions', key: 'action', width: 300,
      render: (_, record) => (
        <Space>
          {record.status === 'offline' && <Button type="primary" size="small" icon={<QrcodeOutlined />} onClick={() => showQR(record.id)}>Bind</Button>}
          {record.status === 'expired' && <Button size="small" icon={<ReloadOutlined />} onClick={() => showQR(record.id)}>Rescan</Button>}
          <Button type={record.status === 'online' ? 'primary' : 'default'} size="small" icon={<SendOutlined />} disabled={record.status !== 'online'} onClick={() => setPublishTarget(record)}>Publish</Button>
          <Popconfirm title="Delete?" onConfirm={() => deleteAccount(record.id)}><Button size="small" danger icon={<DeleteOutlined />} /></Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div><h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Account Management</h2><span style={{ fontSize: 13, color: '#8c8c8c' }}>{accounts.length}/{MAX} accounts</span></div>
        <Button type="primary" icon={<PlusOutlined />} disabled={accounts.length >= MAX} onClick={() => setAddOpen(true)} size="large">Add Account</Button>
      </div>
      <Table columns={columns} dataSource={accounts} rowKey="id" pagination={false} loading={loading} />
      <Modal title="Add Account" open={addOpen} onOk={addAccount} onCancel={() => { setAddOpen(false); setNewName('') }} okText="Confirm" cancelText="Cancel">
        <Input placeholder="Account name" value={newName} onChange={e => setNewName(e.target.value)} style={{ marginTop: 8 }} />
      </Modal>
      <Modal title="Scan to Login" open={qrOpen} onCancel={() => { setQrOpen(false); setQrId(null) }} footer={null} width={420} centered>
        <div style={{ textAlign: 'center', padding: '24px 16px' }}>
          <LoadingOutlined style={{ fontSize: 40, color: '#4f46e5', marginBottom: 16 }} spin />
          <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Scan QR code in the browser window</p>
          <p style={{ fontSize: 13, color: '#8c8c8c', marginBottom: 16 }}>
            A Chromium browser has opened with a QR code.<br />
            Use WeChat on your phone to scan it.
          </p>
          <div style={{ background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 8, padding: 12 }}>
            <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 6 }} />
            <span style={{ fontSize: 13 }}>Auto-detecting login...</span>
          </div>
        </div>
      </Modal>
      {publishTarget && <PublishModal video={null} onClose={() => setPublishTarget(null)} />}
    </div>
  )
}

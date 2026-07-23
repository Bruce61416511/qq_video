import { useRef } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { Layout, Menu, theme } from 'antd'
import { TeamOutlined, VideoCameraOutlined, ThunderboltOutlined, HistoryOutlined, SettingOutlined } from '@ant-design/icons'
import Accounts from './pages/Accounts'
import MediaLibrary from './pages/MediaLibrary'
import TextToVideo from './pages/TextToVideo'
import PublishTasks from './pages/PublishTasks'
import Settings from './pages/Settings'

const { Sider, Content } = Layout

const menuItems = [
  { key: '/', icon: <TeamOutlined />, label: '账号管理' },
  { key: '/media', icon: <VideoCameraOutlined />, label: '素材库' },
  { key: '/text-to-video', icon: <ThunderboltOutlined />, label: '文生视频' },
  { key: '/tasks', icon: <HistoryOutlined />, label: '发布记录' },
  { key: '/settings', icon: <SettingOutlined />, label: '设置' },
]

export default function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const { token: t } = theme.useToken()
  const contentRef = useRef(null)

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        width={220}
        style={{ background: '#001529' }}
      >
        <div style={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <span style={{ color: '#fff', fontSize: 17, fontWeight: 700, letterSpacing: 1 }}>视频号助手</span>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ borderRight: 0, marginTop: 4 }}
        />
        <div style={{ position: 'absolute', bottom: 0, width: '100%', padding: '12px 24px', borderTop: '1px solid rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>
          账号上限 10 个
        </div>
      </Sider>
      <Layout>
        <Content ref={contentRef} style={{ margin: 24, padding: 24, background: t.colorBgContainer, borderRadius: t.borderRadiusLG, minHeight: 'calc(100vh - 48px)' }}>
          <Routes>
            <Route path="/" element={<Accounts />} />
            <Route path="/media" element={<MediaLibrary />} />
            <Route path="/text-to-video" element={<TextToVideo />} />
            <Route path="/tasks" element={<PublishTasks />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  )
}
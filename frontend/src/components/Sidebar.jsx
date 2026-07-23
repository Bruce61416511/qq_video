import { NavLink, useLocation } from 'react-router-dom'
import { Users, Film, Wand2 } from 'lucide-react'

const navItems = [
  { to: '/', icon: Users, label: '账号管理' },
  { to: '/media', icon: Film, label: '素材库' },
  { to: '/text-to-video', icon: Wand2, label: '文生视频' },
]

export default function Sidebar() {
  const location = useLocation()

  return (
    <aside style={{
      position: 'fixed', top: 0, left: 0,
      width: 'var(--sidebar-width)', height: '100vh',
      background: 'var(--sidebar-bg)', color: '#fff',
      display: 'flex', flexDirection: 'column', zIndex: 100,
    }}>
      <div style={{ padding: '24px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <h1 style={{ fontSize: '17px', fontWeight: 700, letterSpacing: '0.5px', color: '#e0e7ff' }}>视频号助手</h1>
        <p style={{ fontSize: '11px', color: 'var(--gray-400)', marginTop: '4px' }}>素人矩阵管理</p>
      </div>
      <nav style={{ flex: 1, padding: '12px 10px' }}>
        {navItems.map(({ to, icon: Icon, label }) => {
          const active = location.pathname === to
          return (
            <NavLink key={to} to={to} style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '10px 14px', borderRadius: 'var(--radius)',
              color: active ? '#fff' : 'var(--gray-400)',
              background: active ? 'var(--primary)' : 'transparent',
              textDecoration: 'none', fontSize: '14px',
              fontWeight: active ? 600 : 400, marginBottom: '4px',
              transition: 'all 0.15s',
            }}>
              <Icon size={18} />
              {label}
            </NavLink>
          )
        })}
      </nav>
      <div style={{ padding: '16px 20px', borderTop: '1px solid rgba(255,255,255,0.08)', fontSize: '11px', color: 'var(--gray-500)' }}>
        账号上限 10 个
      </div>
    </aside>
  )
}

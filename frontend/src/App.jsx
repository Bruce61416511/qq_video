import { useRef, useState } from "react"
import { Routes, Route, useNavigate, useLocation } from "react-router-dom"
import { Layout, Menu, ConfigProvider, theme } from "antd"
import {
  TeamOutlined, VideoCameraOutlined, ThunderboltOutlined, ExperimentOutlined, BulbOutlined,
  HistoryOutlined, SettingOutlined, FireOutlined,
} from "@ant-design/icons"
import Accounts from "./pages/Accounts"
import MediaLibrary from "./pages/MediaLibrary"
import TextToVideo from "./pages/TextToVideo"
import KepuTab from "./pages/KepuTab"
import PublishTasks from "./pages/PublishTasks"
import Settings from "./pages/Settings"
import TrendBoard from "./pages/TrendBoard"
import CompetitorAnalysis from "./pages/CompetitorAnalysis"

const { Sider, Content } = Layout

const menuItems = [
  { key: "/", icon: <TeamOutlined />, label: "账号管理" },
  { key: "/trends", icon: <FireOutlined />, label: "热搜看板" },
  { key: "/competitor", icon: <ExperimentOutlined />, label: "爆款拆解" },
  { key: "/text-to-video", icon: <ThunderboltOutlined />, label: "产品创作" },
  { key: "/kepu", icon: <BulbOutlined />, label: "科普创作" },
  { key: "/media", icon: <VideoCameraOutlined />, label: "素材管理" },
  { key: "/tasks", icon: <HistoryOutlined />, label: "发布记录" },
  { key: "/settings", icon: <SettingOutlined />, label: "设置" },
]

const brandTheme = {
  token: {
    colorPrimary: "#005d50",
    colorInfo: "#005d50",
    colorSuccess: "#17857e",
    colorWarning: "#e6a817",
    colorError: "#c53030",
    borderRadius: 10,
    borderRadiusLG: 14,
    fontFamily: "Inter, ui-sans-serif, system-ui, BlinkMacSystemFont, Segoe UI, Microsoft YaHei, PingFang SC, sans-serif",
  },
  components: {
    Menu: {
      darkItemBg: "transparent",
      darkItemSelectedBg: "rgba(255,255,255,0.15)",
      darkItemHoverBg: "rgba(255,255,255,0.08)",
    },
  },
}

export default function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const { token: t } = theme.useToken()
  const contentRef = useRef(null)
  const [collapsed, setCollapsed] = useState(false)

  return (
    <ConfigProvider theme={brandTheme}>
      <Layout style={{ minHeight: "100vh" }}>
        <Sider collapsible collapsed={collapsed} onCollapse={setCollapsed} width={230} collapsedWidth={64} trigger={null} style={{
          background: "linear-gradient(180deg, #00473f 0%, #005d50 40%, #006d60 100%)",
          borderRight: "none",
        }}>
          <div style={{
            height: 68, display: "flex", alignItems: "center", gap: 10,
            padding: "0 20px", borderBottom: "1px solid rgba(255,255,255,0.08)",
          }}>
            <div style={{
              width: 34, height: 34, borderRadius: 10,
              background: "linear-gradient(135deg, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0.08) 100%)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 18, fontWeight: 800, color: "#fff",
              backdropFilter: "blur(4px)",
            }}>
              V
            </div>
            <div>
              <div style={{ color: "#fff", fontSize: 15, fontWeight: 700, lineHeight: 1.2 }}>
                视频号助手
              </div>
              <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 11 }}>
                素人矩阵管理
              </div>
            </div>
          </div>

          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[location.pathname]}
            items={menuItems}
            onClick={({ key }) => navigate(key)}
            style={{
              background: "transparent", borderRight: 0, marginTop: 8,
              padding: "0 8px", fontWeight: 500,
            }}
          />

          <div style={{
            position: "absolute", bottom: 0, width: "100%",
          }}>
            <button
              onClick={() => setCollapsed(!collapsed)}
              style={{
                width: "100%", height: 36, border: "none",
                borderTop: "1px solid rgba(255,255,255,0.06)",
                background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.4)",
                cursor: "pointer", display: "flex", alignItems: "center",
                justifyContent: "center", fontSize: 14, transition: "all 0.2s",
              }}
              title={collapsed ? "展开侧边栏" : "折叠侧边栏"}
            >
              {collapsed ? "→" : "←"}
            </button>
            <div style={{
              padding: "12px 20px",
              borderTop: "1px solid rgba(255,255,255,0.06)",
              background: "rgba(0,0,0,0.1)",
              backdropFilter: "blur(8px)",
              color: "rgba(255,255,255,0.35)", fontSize: 12,
            }}>
              账号上限 10 个
            </div>
          </div>
        </Sider>

        <Layout style={{ background: "#f5f7f6" }}>
          <Content ref={contentRef} style={{
            margin: 20, padding: 28, background: "#fff",
            borderRadius: 16,
            minHeight: "calc(100vh - 40px)",
            boxShadow: "0 4px 24px rgba(0,0,0,0.04)",
          }}>
            <Routes>
              <Route path="/" element={<Accounts />} />
              <Route path="/trends" element={<TrendBoard />} />
              <Route path="/competitor" element={<CompetitorAnalysis />} />
              <Route path="/media" element={<MediaLibrary />} />
              <Route path="/text-to-video" element={<TextToVideo />} />
              <Route path="/kepu" element={<KepuTab />} />
              <Route path="/tasks" element={<PublishTasks />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  )
}

import { useState, useEffect, useRef } from "react"
import { Tabs, Card, Input, Button, Space, App, Row, Col, Modal, Switch, Tag } from "antd"
import {
  ReloadOutlined, ThunderboltOutlined, SettingOutlined,
  PlusOutlined, DeleteOutlined, EditOutlined, SearchOutlined,
  RobotOutlined, ExportOutlined,
} from "@ant-design/icons"
import { trendsApi } from "../services/api"

export default function TrendBoard() {
  const [loading, setLoading] = useState(false)
  const [crawling, setCrawling] = useState(false)
  const [groups, setGroups] = useState({})
  const [interestsContent, setInterestsContent] = useState("")
  const [savingGroups, setSavingGroups] = useState(false)
  const [savingInterests, setSavingInterests] = useState(false)
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [newGroupName, setNewGroupName] = useState("")
  const [filterMethod, setFilterMethod] = useState("ai")
  const [reportKey, setReportKey] = useState(0)
  const [activeTab, setActiveTab] = useState("config")
  const iframeRef = useRef(null)
  const { message } = App.useApp()

  const loadConfig = async () => {
    try {
      const [g, interests, methodRes] = await Promise.all([
        trendsApi.getGroups(), trendsApi.getInterests(),
        trendsApi.getMethod(),
      ])
      setGroups(g || {})
      setInterestsContent(interests.content || "")
      setFilterMethod(methodRes.method || "ai")
    } catch (e) { /**/ }
  }
  useEffect(() => { loadConfig() }, [])

  const handleCrawl = async () => {
    setCrawling(true)
    try {
      const start = await trendsApi.crawl()
      if (!start.ok) { message.error(start.error || "启动失败"); setCrawling(false); return }
      message.info("采集已启动，约需2-3分钟...", 2)
      let n = 0
      while (n < 90) {
        await new Promise(r => setTimeout(r, 3000))
        const st = await trendsApi.crawlStatus(); n++
        if (!st.running) {
          if (st.result && st.result.ok) {
            message.success("采集完成")
            setReportKey(k => k + 1) // 刷新 iframe
          } else {
            message.error("采集失败: " + (st.result ? st.result.error : "未知错误"))
          }
          break
        }
      }
    } catch (e) { message.error("采集失败: " + e.message) }
    finally { setCrawling(false) }
  }

  const handleMethodToggle = async (checked) => {
    const method = checked ? "ai" : "keyword"
    try {
      await trendsApi.setMethod(method)
      setFilterMethod(method)
      message.success(`已切换为 ${method === "ai" ? "AI 检索" : "关键词检索"}，下次采集生效`)
    } catch (e) { message.error(e.message) }
  }

  const handleSaveGroups = async () => {
    setSavingGroups(true)
    try { await trendsApi.setGroups(groups); message.success("已保存") }
    catch (e) { message.error(e.message) }
    finally { setSavingGroups(false) }
  }
  const handleSaveInterests = async () => {
    setSavingInterests(true)
    try { await trendsApi.setInterests(interestsContent); message.success("已保存") }
    catch (e) { message.error(e.message) }
    finally { setSavingInterests(false) }
  }
  const addGroup = () => {
    const name = newGroupName.trim()
    if (!name) return message.warning("请输入组名")
    if (groups[name]) return message.warning("组名已存在")
    setGroups(prev => ({ ...prev, [name]: [] }))
    setNewGroupName(""); setAddModalOpen(false)
  }
  const confirmDeleteGroup = (name) => {
    Modal.confirm({ title: "删除分组", content: "确定删除 \"" + name + "\" 分组？", okText: "删除", okType: "danger",
      onOk: () => setGroups(prev => { const n = { ...prev }; delete n[name]; return n }) })
  }
  const renameGroup = (oldName) => {
    let val = oldName
    Modal.confirm({ title: "重命名分组", content: <Input defaultValue={oldName} onChange={e => val = e.target.value} />,
      onOk: () => {
        const n = val.trim(); if (!n || n === oldName) return
        if (groups[n]) { message.warning("组名已存在"); return Promise.reject() }
        setGroups(prev => { const next = {}; for (const [k, v] of Object.entries(prev)) next[k === oldName ? n : k] = v; return next })
      } })
  }
  const updateGroup = (name, value) => setGroups(prev => ({ ...prev, [name]: value }))

  const tabs = [
    {
      key: "config", label: "采集配置", icon: <SettingOutlined />,
      children: (
        <div>
          <Card size="small" style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <span style={{ fontWeight: 600 }}>检索方式</span>
                <div style={{ color: "#888", fontSize: 13, marginTop: 4 }}>
                  当前：<Tag color={filterMethod === "ai" ? "blue" : "orange"}>{filterMethod === "ai" ? "AI 语义检索" : "关键词匹配检索"}</Tag>
                  &nbsp;切换后下次采集生效
                </div>
              </div>
              <Space>
                <span style={{ color: "#888" }}>关键词</span>
                <Switch checked={filterMethod === "ai"} onChange={handleMethodToggle} checkedChildren={<RobotOutlined />} unCheckedChildren="K" />
                <span style={{ color: "#888" }}>AI</span>
              </Space>
            </div>
          </Card>

          <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h4 style={{ margin: 0 }}>关键词分组（{filterMethod === "keyword" ? "生效中" : "仅 AI 模式异常回退时使用"}）</h4>
            <Button type="dashed" icon={<PlusOutlined />} onClick={() => setAddModalOpen(true)}>新增分组</Button>
          </div>
          {Object.keys(groups).length === 0 && <Card style={{ textAlign: "center", color: "#999", padding: 40 }}>暂无关键词分组，点击上方按钮开始配置</Card>}
          <Row gutter={[16, 16]}>
            {Object.entries(groups).map(([name, keywords]) => (
              <Col xs={24} md={12} key={name}>
                <Card title={name} size="small" extra={<Space size={0}><Button type="text" size="small" icon={<EditOutlined />} onClick={() => renameGroup(name)} /><Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => confirmDeleteGroup(name)} /></Space>}>
                  <Input.TextArea rows={5} value={Array.isArray(keywords) ? keywords.join("\n") : keywords} onChange={e => updateGroup(name, e.target.value.split("\n").filter(Boolean))} placeholder="每行一个关键词" style={{ fontFamily: "monospace", fontSize: 13 }} />
                </Card>
              </Col>
            ))}
          </Row>
          {Object.keys(groups).length > 0 && <Button type="primary" onClick={handleSaveGroups} loading={savingGroups} style={{ marginTop: 16 }}>保存关键词</Button>}
          <Modal title="新增分组" open={addModalOpen} onOk={addGroup} onCancel={() => { setAddModalOpen(false); setNewGroupName("") }}><Input placeholder="输入分组名称" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} onPressEnter={addGroup} /></Modal>

          <Card title="AI 兴趣方向" size="small" style={{ marginTop: 24 }}>
            <div style={{ color: "#888", fontSize: 13, marginBottom: 8 }}>
              {filterMethod === "ai" ? "AI 模式用此文件做语义过滤，描述你关注的内容方向" : "仅 AI 模式下生效"}
            </div>
            <Input.TextArea rows={8} value={interestsContent} onChange={e => setInterestsContent(e.target.value)} placeholder="描述你关注的内容方向，AI 用来自动分类热搜..." style={{ fontFamily: "monospace", fontSize: 13 }} />
            <Button type="primary" onClick={handleSaveInterests} loading={savingInterests} style={{ marginTop: 12 }}>保存</Button>
          </Card>
        </div>
      ),
    },
    {
      key: "report", label: "检索结果", icon: <SearchOutlined />,
      children: (
        <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 180px)" }}>
          <div style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: "#888" }}>
              TrendRadar 报告 · 
              <Tag color={filterMethod === "ai" ? "blue" : "orange"} style={{ marginLeft: 8 }}>
                {filterMethod === "ai" ? "AI 检索" : "关键词检索"}
              </Tag>
            </span>
            <Space>
              <Button size="small" icon={<ReloadOutlined />} onClick={() => setReportKey(k => k + 1)}>刷新报告</Button>
              <Button size="small" icon={<ExportOutlined />} onClick={() => window.open(trendsApi.getReport(), '_blank')}>新窗口打开</Button>
            </Space>
          </div>
          <iframe
            ref={iframeRef}
            key={reportKey}
            src={trendsApi.getReport()}
            style={{ flex: 1, width: "100%", border: "1px solid #e8e8e8", borderRadius: 8, background: "#fff" }}
            title="TrendRadar 报告"
          />
        </div>
      ),
    },
  ]

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}><ThunderboltOutlined style={{ marginRight: 8 }} />选题看板</h2>
        <Button type="primary" icon={<ReloadOutlined />} onClick={handleCrawl} loading={crawling}>重新采集</Button>
      </div>
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabs} />
    </div>
  )
}
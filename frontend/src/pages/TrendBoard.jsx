import { useState, useEffect } from "react"
import { Tabs, Card, Input, Button, Table, Tag, Space, App, Row, Col, Modal, Switch } from "antd"
import {
  ReloadOutlined, StarOutlined, StarFilled, EyeInvisibleOutlined,
  ThunderboltOutlined, SettingOutlined, PlusOutlined, DeleteOutlined,
  EditOutlined, RobotOutlined, SearchOutlined,
} from "@ant-design/icons"
import { trendsApi } from "../services/api"

const PLATFORM_COLORS = {
  weibo: "#e6162d", douyin: "#000", baidu: "#2932e1",
  zhihu: "#0066ff", toutiao: "#e13b40", "bilibili-hot-search": "#fb7299",
}

export default function TrendBoard() {
  const [topics, setTopics] = useState([])
  const [aiData, setAiData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [crawling, setCrawling] = useState(false)
  const [groups, setGroups] = useState({})
  const [interestsContent, setInterestsContent] = useState("")
  const [savingGroups, setSavingGroups] = useState(false)
  const [savingInterests, setSavingInterests] = useState(false)
  const [savingAi, setSavingAi] = useState(false)
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [newGroupName, setNewGroupName] = useState("")
  const [aiConfig, setAiConfig] = useState({})
  const [activeTab, setActiveTab] = useState("config")
  const { message } = App.useApp()

  const loadTopics = async () => {
    setLoading(true)
    try { setTopics(await trendsApi.list(null, 200, 0) || []) }
    catch (e) { message.error("加载失败: " + e.message) }
    finally { setLoading(false) }
  }
  const loadAiAnalysis = async () => {
    setAiLoading(true)
    try { setAiData(await trendsApi.aiAnalysis()) }
    catch (e) { /**/ }
    finally { setAiLoading(false) }
  }
  const loadConfig = async () => {
    try {
      const [g, interests, ai] = await Promise.all([
        trendsApi.getGroups(), trendsApi.getInterests(),
      ])
      setGroups(g || {}); setInterestsContent(interests.content || ""); setAiConfig(ai || {})
    } catch (e) { /**/ }
  }
  useEffect(() => { loadConfig(); loadTopics(); loadAiAnalysis() }, [])

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
          if (st.result && st.result.ok) { message.success("采集完成"); await loadTopics(); await loadAiAnalysis() }
          else { message.error("采集失败: " + (st.result ? st.result.error : "未知错误")) }
          break
        }
      }
    } catch (e) { message.error("采集失败: " + e.message) }
    finally { setCrawling(false) }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    try { const res = await trendsApi.refresh(); message.success("新增 " + res.count + " 条"); await loadTopics() }
    catch (e) { message.error("刷新失败: " + e.message) }
    finally { setRefreshing(false) }
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
  const handleSaveAi = async () => {
    setSavingAi(true)
    try { await trendsApi.setAiConfig(aiConfig); message.success("已保存") }
    catch (e) { message.error(e.message) }
    finally { setSavingAi(false) }
  }
  const handleStatus = async (id, status) => { try { await trendsApi.updateStatus(id, status); await loadTopics() } catch (e) { message.error(e.message) } }
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

  const kwCols = [
    { title: "标题", dataIndex: "title", key: "title", render: (t, r) => <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>{t}</a> },
    { title: "平台", dataIndex: "platform", key: "platform", width: 100, render: p => <Tag color={PLATFORM_COLORS[p] || "#888"}>{p}</Tag> },
    { title: "热度", dataIndex: "heat_score", key: "hs", width: 80, sorter: (a, b) => a.heat_score - b.heat_score, render: s => <span style={{ color: s > 8000 ? "#ff4d4f" : s > 5000 ? "#fa8c16" : "#666" }}>🔥 {s}</span> },
    { title: "匹配词", dataIndex: "matched_keywords", key: "mk", width: 120, render: kw => kw ? <Tag>{kw}</Tag> : null },
    { title: "操作", key: "act", width: 100, render: (_, r) => (
      <Space>
        {r.status === "favorited" ? <Button type="text" size="small" icon={<StarFilled style={{ color: "#faad14" }} />} onClick={() => handleStatus(r.id, "new")} /> : <Button type="text" size="small" icon={<StarOutlined />} onClick={() => handleStatus(r.id, "favorited")} />}
        <Button type="text" size="small" danger icon={<EyeInvisibleOutlined />} onClick={() => handleStatus(r.id, "ignored")} />
      </Space>
    ) },
  ]
  const aiCols = [
    { title: "标题", dataIndex: "title", key: "t", width: 300, render: (t, r) => <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>{t}</a> },
    { title: "平台", dataIndex: "platform_id", key: "p", width: 90, render: p => <Tag color={PLATFORM_COLORS[p] || "#888"}>{p}</Tag> },
    { title: "标签", dataIndex: "tag", key: "tag", width: 120, render: t => <Tag color="blue">{t}</Tag> },
    { title: "相关度", dataIndex: "relevance_score", key: "rs", width: 80, sorter: (a, b) => a.relevance_score - b.relevance_score, render: s => <span style={{ color: s > 0.8 ? "#52c41a" : s > 0.5 ? "#fa8c16" : "#999" }}>{(s * 100).toFixed(0)}%</span> },
  ]

  const tabs = [
    {
      key: "config", label: "采集配置", icon: <SettingOutlined />,
      children: (
        <div>
          
          <div style={{ marginBottom: 16 }}><Button type="dashed" icon={<PlusOutlined />} onClick={() => setAddModalOpen(true)}>新增关键词分组</Button></div>
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
            <Input.TextArea rows={8} value={interestsContent} onChange={e => setInterestsContent(e.target.value)} placeholder="描述你关注的内容方向，AI 用来自动分类热搜..." style={{ fontFamily: "monospace", fontSize: 13 }} />
            <Button type="primary" onClick={handleSaveInterests} loading={savingInterests} style={{ marginTop: 12 }}>保存</Button>
          </Card>
        </div>
      ),
    },
    {
      key: "keyword", label: "关键词检索结果", icon: <SearchOutlined />,
      children: (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ color: "#999" }}>共 {topics.length} 条（按 frequency_words.txt 过滤）</span>
            <Button size="small" icon={<ReloadOutlined />} onClick={handleRefresh} loading={refreshing}>刷新</Button>
          </div>
          <Table columns={kwCols} dataSource={topics} rowKey="id" loading={loading} pagination={{ pageSize: 30, showSizeChanger: false }} size="middle" />
        </div>
      ),
    },
    {
      key: "ai", label: "AI 检索结果", icon: <RobotOutlined />,
      children: (
        <div>
          {aiData && aiData.message ? (
            <Card style={{ textAlign: "center", color: "#999", padding: 40 }}>{aiData.message}</Card>
          ) : (
            <>
              {aiData && aiData.tags && aiData.tags.length > 0 && <div style={{ marginBottom: 12 }}>{aiData.tags.map(t => <Tag key={t.tag} color="blue">{t.tag}</Tag>)}</div>}
              <div style={{ marginBottom: 8, color: "#999" }}>共 {aiData ? aiData.total : 0} 条（AI 语义匹配）</div>
              <Table columns={aiCols} dataSource={aiData ? aiData.results : []} rowKey={(r, i) => i} loading={aiLoading} pagination={{ pageSize: 30, showSizeChanger: false }} size="middle" />
            </>
          )}
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
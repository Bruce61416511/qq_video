import { useState, useEffect } from 'react'
import { Card, Input, Button, Select, App, Space, Tag } from 'antd'
import { SaveOutlined, ApiOutlined } from '@ant-design/icons'
import { settingsApi } from '../services/api'

export default function Settings() {
  const [saving, setSaving] = useState(false)
  const [config, setConfig] = useState({
    ai_service: { label: 'AI 服务', value: '' },
    api_key: { label: 'API Key', value: '' },
    api_secret: { label: 'API Secret', value: '' },
  })
  const { message } = App.useApp()

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      const list = await settingsApi.list()
      const map = { ...config }
      if (Array.isArray(list)) {
        list.forEach(s => {
          if (map[s.key]) map[s.key].value = s.value
        })
      }
      setConfig(map)
    } catch (e) {
      // settings may not exist yet
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      for (const [key, obj] of Object.entries(config)) {
        await settingsApi.set(key, obj.value)
      }
      message.success('设置已保存')
    } catch (e) {
      message.error('保存失败: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>设置</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#8c8c8c' }}>配置 AI 视频生成服务的接入凭证</p>
      </div>

      <Card>
        <div style={{ marginBottom: 24 }}>
          <span style={{ fontWeight: 600, fontSize: 14, display: 'block', marginBottom: 8 }}>AI 服务</span>
          <Select
            style={{ width: '100%' }}
            value={config.ai_service.value || undefined}
            placeholder="选择 AI 服务"
            onChange={v => setConfig({ ...config, ai_service: { ...config.ai_service, value: v } })}
            options={[
              { value: 'jimeng', label: '即梦 Jimeng' },
              { value: 'kling', label: '可灵 Kling' },
              { value: 'runway', label: 'Runway Gen-3' },
            ]}
          />
        </div>

        <div style={{ marginBottom: 24 }}>
          <span style={{ fontWeight: 600, fontSize: 14, display: 'block', marginBottom: 8 }}>API Key</span>
          <Input.Password
            placeholder="输入 API Key"
            value={config.api_key.value}
            onChange={e => setConfig({ ...config, api_key: { ...config.api_key, value: e.target.value } })}
          />
        </div>

        <div style={{ marginBottom: 24 }}>
          <span style={{ fontWeight: 600, fontSize: 14, display: 'block', marginBottom: 8 }}>API Secret</span>
          <Input.Password
            placeholder="输入 API Secret（选填）"
            value={config.api_secret.value}
            onChange={e => setConfig({ ...config, api_secret: { ...config.api_secret, value: e.target.value } })}
          />
        </div>

        <Button
          type="primary"
          icon={<SaveOutlined />}
          onClick={handleSave}
          loading={saving}
        >
          保存设置
        </Button>
      </Card>

      <Card size="small" style={{ marginTop: 20 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}><ApiOutlined /> 配置状态</span>
        <div style={{ marginTop: 8 }}>
          {Object.entries(config).map(([key, obj]) => (
            <Tag key={key} color={obj.value ? 'green' : 'default'} style={{ marginBottom: 4 }}>
              {obj.label}: {obj.value ? '已配置' : '未设置'}
            </Tag>
          ))}
        </div>
      </Card>
    </div>
  )
}
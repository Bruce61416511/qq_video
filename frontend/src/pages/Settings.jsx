import { useState, useEffect } from 'react'
import { Card, Input, Button, Select, App, Space, Tag, Divider } from 'antd'
import {
  SaveOutlined, RobotOutlined, SoundOutlined, VideoCameraOutlined,
  CheckCircleOutlined, ExclamationCircleOutlined
} from '@ant-design/icons'
import { settingsApi } from '../services/api'

const SETTING_KEYS = {
  llm_service: { label: 'LLM 服务', section: 'llm' },
  llm_model: { label: 'LLM 模型', section: 'llm' },
  llm_api_key: { label: 'LLM API Key', section: 'llm' },
  llm_api_secret: { label: 'LLM API Secret', section: 'llm' },
  tts_service: { label: 'TTS 服务', section: 'tts' },
  tts_model: { label: 'TTS 模型', section: 'tts' },
  tts_voice: { label: 'TTS 音色', section: 'tts' },
  tts_api_key: { label: 'TTS API Key', section: 'tts' },
  video_service: { label: '视频生成服务', section: 'video' },
  video_model: { label: '视频模型', section: 'video' },
  video_api_key: { label: '视频 API Key', section: 'video' },
  video_api_secret: { label: '视频 API Secret', section: 'video' },
}


const TTS_MODEL_OPTIONS = [
  { value: 'qwen-audio-3.0-tts-flash', label: 'qwen-audio-3.0-tts-flash (推荐)' },
  { value: 'qwen-audio-3.0-tts-plus', label: 'qwen-audio-3.0-tts-plus' },
]

const TTS_VOICE_OPTIONS = [
  { value: 'longanhuan_v3.6', label: '龙安欢 v3.6 (温柔女声·推荐)' },
  { value: 'longxiaochun', label: '龙小春 (知性女声)' },
  { value: 'longxiaoxia', label: '龙小夏 (活泼女声)' },
  { value: 'longyichen', label: '龙一辰 (沉稳男声)' },
]

const LLM_MODEL_OPTIONS = [
  { value: 'gpt-4o', label: 'gpt-4o' },
  { value: 'deepseek-chat', label: 'deepseek-chat' },
  { value: 'qwen-plus', label: 'qwen-plus' },
  { value: 'glm-4', label: 'glm-4' },
  { value: 'moonshot-v1-8k', label: 'moonshot-v1-8k' },
]

const VIDEO_MODEL_OPTIONS = [
  { value: 'wanx2.1-t2v-plus', label: 'wanx2.1-t2v-plus (推荐)' },
  { value: 'kling-v1', label: 'kling-v1' },
  { value: 'kling-v1-5', label: 'kling-v1-5' },
]

const LLM_OPTIONS = [
  { value: 'openai', label: 'OpenAI (GPT-4o)' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'qwen', label: '通义千问' },
  { value: 'zhipu', label: '智谱 GLM' },
  { value: 'moonshot', label: 'Moonshot' },
]

const TTS_OPTIONS = [
  { value: 'bailian_tts', label: '阿里云百炼 CosyVoice' },
  { value: 'edge_tts', label: 'Edge TTS (免费·海外可用)' },
  { value: 'openai_tts', label: 'OpenAI TTS' },
  { value: 'chattss', label: 'ChatTTS' },
  { value: 'fish_audio', label: 'Fish Audio' },
]

const VIDEO_OPTIONS = [
  { value: 'jimeng', label: '即梦 Jimeng' },
  { value: 'kling', label: '可灵 Kling' },
  { value: 'runway', label: 'Runway Gen-3' },
  { value: 'wan', label: 'Wan-2.1' },
  { value: 'cogvideo', label: 'CogVideo (开源/免费)' },
]

function ServiceCard({ icon, title, desc, serviceKey, keyKey, secretKey, serviceOptions, config, setConfig, hasSecret }) {
  return (
    <Card style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        {icon}
        <div>
          <span style={{ fontWeight: 700, fontSize: 15 }}>{title}</span>
          <p style={{ margin: 0, fontSize: 12, color: '#8c8c8c' }}>{desc}</p>
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <span style={{ fontWeight: 600, fontSize: 13, display: 'block', marginBottom: 4 }}>服务商</span>
        <Select
          style={{ width: '100%' }}
          value={config[serviceKey]?.value || undefined}
          placeholder="选择服务商"
          onChange={v => setConfig(prev => ({ ...prev, [serviceKey]: { ...prev[serviceKey], value: v } }))}
          options={serviceOptions}
        />
      </div>

      {(title === 'TTS 语音合成' || title === 'LLM 分镜策划' || title === '视频生成') && (
        <div style={{ marginBottom: 14 }}>
          <span style={{ fontWeight: 600, fontSize: 13, display: 'block', marginBottom: 4 }}>模型</span>
          <Select
            style={{ width: '100%' }}
            value={config[serviceKey.replace('_service', '_model')]?.value || undefined}
            placeholder="选择模型"
            onChange={v => setConfig(prev => ({ ...prev, [serviceKey.replace('_service', '_model')]: { ...prev[serviceKey.replace('_service', '_model')], value: v } }))}
            options={
              title === 'LLM 分镜策划' ? LLM_MODEL_OPTIONS :
              title === 'TTS 语音合成' ? TTS_MODEL_OPTIONS :
              VIDEO_MODEL_OPTIONS
            }
          />
        </div>
      )}

      {title === 'TTS 语音合成' && (
        <div style={{ marginBottom: 14 }}>
          <span style={{ fontWeight: 600, fontSize: 13, display: 'block', marginBottom: 4 }}>音色</span>
          <Select
            style={{ width: '100%' }}
            value={config['tts_voice']?.value || undefined}
            placeholder="选择音色"
            onChange={v => setConfig(prev => ({ ...prev, tts_voice: { ...prev['tts_voice'], value: v } }))}
            options={TTS_VOICE_OPTIONS}
          />
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <span style={{ fontWeight: 600, fontSize: 13, display: 'block', marginBottom: 4 }}>API Key</span>
        <Input.Password
          placeholder="输入 API Key"
          value={config[keyKey]?.value || ''}
          onChange={e => setConfig(prev => ({ ...prev, [keyKey]: { ...prev[keyKey], value: e.target.value } }))}
        />
      </div>

      {hasSecret && (
        <div>
          <span style={{ fontWeight: 600, fontSize: 13, display: 'block', marginBottom: 4 }}>
            API Secret <span style={{ color: '#8c8c8c', fontWeight: 400 }}>（选填）</span>
          </span>
          <Input.Password
            placeholder="输入 API Secret"
            value={config[secretKey]?.value || ''}
            onChange={e => setConfig(prev => ({ ...prev, [secretKey]: { ...prev[secretKey], value: e.target.value } }))}
          />
        </div>
      )}
    </Card>
  )
}

export default function Settings() {
  const [saving, setSaving] = useState(false)
  const [config, setConfig] = useState({})
  const { message } = App.useApp()

  useEffect(() => { loadSettings() }, [])

  const loadSettings = async () => {
    try {
      const list = await settingsApi.list()
      const map = {}
      Object.keys(SETTING_KEYS).forEach(k => {
        map[k] = { label: SETTING_KEYS[k].label, value: '' }
      })
      if (Array.isArray(list)) {
        list.forEach(s => {
          if (map[s.key]) map[s.key].value = s.value
        })
      }
      setConfig(map)
    } catch (e) { /* settings may not exist yet */ }
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

  const keysForSection = (section) =>
    Object.entries(SETTING_KEYS).filter(([, v]) => v.section === section).map(([k]) => k)

  const sectionConfigured = (section) => {
    const keys = keysForSection(section)
    // at least service + api_key are set
    const serviceKey = keys.find(k => k.endsWith('_service'))
    const apiKey = keys.find(k => k.endsWith('_api_key'))
    return config[serviceKey]?.value && config[apiKey]?.value
  }

  const renderStatusTag = (section) => {
    const ok = sectionConfigured(section)
    return (
      <Tag
        icon={ok ? <CheckCircleOutlined /> : <ExclamationCircleOutlined />}
        color={ok ? 'green' : 'default'}
      >
        {ok ? '已配置' : '未配置'}
      </Tag>
    )
  }

  return (
    <div style={{ maxWidth: 780 }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>设置</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#8c8c8c' }}>
          配置 AI 视频生成的三个环节 —— LLM 分镜策划 → TTS 语音合成 → 视频生成
        </p>
      </div>

      <ServiceCard
        icon={<RobotOutlined style={{ fontSize: 22, color: '#1677ff' }} />}
        title="LLM 分镜策划"
        desc="将主题拆分为画面提示词 + 语音文案"
        serviceKey="llm_service"
        keyKey="llm_api_key"
        secretKey="llm_api_secret"
        serviceOptions={LLM_OPTIONS}
        config={config}
        setConfig={setConfig}
        hasSecret={false}
      />

      <ServiceCard
        icon={<SoundOutlined style={{ fontSize: 22, color: '#52c41a' }} />}
        title="TTS 语音合成"
        desc="将语音文案转换为配音音频"
        serviceKey="tts_service"
        keyKey="tts_api_key"
        secretKey="tts_api_secret"
        serviceOptions={TTS_OPTIONS}
        config={config}
        setConfig={setConfig}
        hasSecret={false}
      />

      <ServiceCard
        icon={<VideoCameraOutlined style={{ fontSize: 22, color: '#fa8c16' }} />}
        title="视频生成"
        desc="根据画面提示词生成视频画面"
        serviceKey="video_service"
        keyKey="video_api_key"
        secretKey="video_api_secret"
        serviceOptions={VIDEO_OPTIONS}
        config={config}
        setConfig={setConfig}
        hasSecret
      />

      <Button
        type="primary"
        size="large"
        icon={<SaveOutlined />}
        onClick={handleSave}
        loading={saving}
        block
      >
        保存设置
      </Button>

      <Card size="small" style={{ marginTop: 20 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>配置状态</span>
        <Divider style={{ margin: '10px 0' }} />
        <Space size="middle">
          <div>
            <RobotOutlined style={{ marginRight: 4 }} />LLM 分镜
            {renderStatusTag('llm')}
          </div>
          <div>
            <SoundOutlined style={{ marginRight: 4 }} />TTS 语音
            {renderStatusTag('tts')}
          </div>
          <div>
            <VideoCameraOutlined style={{ marginRight: 4 }} />视频生成
            {renderStatusTag('video')}
          </div>
        </Space>
      </Card>
    </div>
  )
}
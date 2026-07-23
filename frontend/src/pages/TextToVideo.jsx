import { useState } from 'react'
import { Input, Button, Alert, Card, App } from 'antd'
import { ThunderboltOutlined, LoadingOutlined, CheckCircleOutlined } from '@ant-design/icons'
import { mediaApi } from '../services/api'

const { TextArea } = Input

export default function TextToVideo() {
  const [prompt, setPrompt] = useState('')
  const [generating, setGenerating] = useState(false)
  const [done, setDone] = useState(false)
  const [result, setResult] = useState(null)
  const { message } = App.useApp()

  const handleGenerate = async () => {
    if (!prompt.trim()) { message.warning('请输入视频文案描述'); return }
    setGenerating(true); setDone(false); setResult(null)
    try {
      const media = await mediaApi.generate(prompt.trim())
      setResult(media)
      setDone(true)
      setPrompt('')
      message.success('视频生成任务已提交！前往素材库查看进度')
    } catch (e) {
      message.error('生成失败: ' + e.message)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>文生视频</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#8c8c8c' }}>输入文案描述，AI 自动生成视频并存入素材库</p>
      </div>

      <Card>
        <div style={{ marginBottom: 16 }}>
          <span style={{ fontWeight: 600, fontSize: 14, display: 'block', marginBottom: 8 }}>视频文案描述</span>
          <TextArea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder={'描述你想要的视频内容，例如：\n\n一段关于益生菌对肠道健康益处的科普短视频，暖色调，食品特写镜头，配轻快的背景音乐'}
            rows={6}
            maxLength={500}
            disabled={generating}
            showCount
          />
        </div>

        <Button
          type="primary"
          size="large"
          icon={generating ? <LoadingOutlined /> : <ThunderboltOutlined />}
          onClick={handleGenerate}
          disabled={!prompt.trim() || generating}
          loading={generating}
        >
          {generating ? '提交中...' : '生成视频'}
        </Button>

        {generating && (
          <Alert message="正在提交视频生成任务..." type="info" showIcon icon={<LoadingOutlined />} style={{ marginTop: 16 }} />
        )}

        {done && result && (
          <Alert
            type="success"
            showIcon
            icon={<CheckCircleOutlined />}
            message="生成任务已提交！"
            description={
              <div>
                <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                  <div style={{ width: 80, height: 50, background: '#f0f0f0', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#bfbfbf' }}>缩略图</div>
                  <div><strong>{result.name}</strong><p style={{ margin: 0, color: '#8c8c8c', fontSize: 12 }}>状态: {result.status}</p></div>
                </div>
                <a href="/media" style={{ display: 'inline-block', marginTop: 8, fontWeight: 500 }}>前往素材库查看进度 →</a>
              </div>
            }
            style={{ marginTop: 16 }}
          />
        )}
      </Card>

      <Card size="small" style={{ marginTop: 20 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>💡 文案提示</span>
        <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: '#8c8c8c', lineHeight: 2 }}>
          <li>描述越详细，生成效果越好（场景、色调、节奏）</li>
          <li>食品大健康方向建议：食材特写 + 科普讲解 + 生活场景</li>
          <li>生成的视频会自动存入素材库，可在素材库中选择发布</li>
        </ul>
      </Card>
    </div>
  )
}

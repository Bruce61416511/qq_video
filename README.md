# 视频号智能助手

AI 驱动的微信视频号矩阵管理系统，支持 AI 分镜策划 → 视频生成 → 配音 → 字幕合成 → 多账号一键发布。

## 功能概览

| 模块 | 功能 |
|------|------|
| **账号管理** | 批量管理微信视频号（上限 10 个），扫码登录，状态监控 |
| **素材库** | 上传/管理视频素材，AI 生成分镜进度追踪，预览播放 |
| **文生视频** | 3 步向导：输入主题 → AI 分镜策划 → 视频生成 + 配音 + 字幕 → 自动入库 |
| **发布管理** | 多账号同时发布，定时发布，发布记录与状态追踪 |
| **系统设置** | LLM / TTS / 视频生成 三环节独立配置，模型/音色可选，服务商可混搭 |

## 技术架构

```
┌──────────────────────────────────────────────────────┐
│  前端 (React 19 + Ant Design 6 + Vite)  port 5173   │
│  /           账号管理                                │
│  /media      素材库                                  │
│  /text-to-video  文生视频（3 步向导）                │
│  /tasks      发布记录                                │
│  /settings   系统设置（模型+音色可选）                │
└──────────────────────┬───────────────────────────────┘
                       │ REST API
┌──────────────────────┴───────────────────────────────┐
│  后端 (FastAPI + SQLite + Playwright)  port 8001     │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │ LLM 分镜 │  │ TTS 配音 │  │ 视频生成 │           │
│  │ 通义千问 │  │ CosyVoice│  │ Wan-2.1  │           │
│  │ DeepSeek │  │ OpenAI   │  │ Kling    │           │
│  │ OpenAI   │  │ ChatTTS  │  │ 即梦     │           │
│  │ 智谱 GLM │  │          │  │ Runway   │           │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘           │
│       └──────────────┴─────────────┘                 │
│                      ↓                               │
│          ffmpeg 合成（画面 + 配音 + 字幕）             │
│                      ↓                               │
│          Playwright 发布到视频号                      │
└──────────────────────────────────────────────────────┘
```

## 目录结构

```
AI微信视频发布/
├── backend/
│   ├── app/
│   │   ├── config.py              # 配置（路径、设置缓存）
│   │   ├── database.py            # SQLite 异步数据库
│   │   ├── main.py                # FastAPI 入口
│   │   ├── models/
│   │   │   └── models.py          # 数据模型
│   │   ├── routers/
│   │   │   ├── accounts.py        # 账号管理 + 扫码登录
│   │   │   ├── media.py           # 素材管理 + 视频生成管线
│   │   │   ├── publish.py         # 发布任务
│   │   │   └── settings.py        # 系统设置
│   │   ├── schemas/
│   │   │   └── schemas.py         # Pydantic 模型
│   │   └── services/
│   │       ├── llm_service.py     # LLM 分镜（通义千问/DeepSeek/OpenAI 等）
│   │       ├── tts_service.py     # TTS 配音（百炼 CosyVoice / OpenAI / ChatTTS）
│   │       ├── video_gen_service.py  # 视频生成（Wan-2.1 / Kling / 即梦 / Runway）
│   │       ├── video_composer.py     # ffmpeg 合成（画面+配音+字幕）
│   │       ├── publisher_engine.py   # Playwright 发布引擎
│   │       ├── qrcode_service.py     # 扫码登录
│   │       └── worker.py             # 后台任务队列
│   ├── uploads/                   # 视频素材
│   ├── cookies/                   # 微信登录 Cookie
│   ├── screenshots/               # 发布截图
│   └── requirements.txt
│
├── frontend/
│   ├── src/
│   │   ├── App.jsx                # 主布局
│   │   ├── pages/
│   │   │   ├── Accounts.jsx       # 账号管理
│   │   │   ├── MediaLibrary.jsx   # 素材库（含分镜进度展开）
│   │   │   ├── TextToVideo.jsx    # 文生视频 3 步向导
│   │   │   ├── PublishTasks.jsx   # 发布记录
│   │   │   └── Settings.jsx       # 系统设置（模型/音色可配）
│   │   ├── components/
│   │   │   └── PublishModal.jsx   # 发布弹窗
│   │   └── services/
│   │       └── api.js             # API 封装
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
│
└── README.md
```

## 快速开始

### 环境要求

- Python 3.10+
- Node.js 18+
- ffmpeg（视频合成必需）

### 1. 克隆项目

```bash
git clone <repo-url>
cd AI微信视频发布
```

### 2. 安装系统依赖

**Windows：**
```powershell
# ffmpeg：下载 https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip
# 解压后将 bin 目录加入系统 PATH

# Playwright 浏览器
playwright install chromium
```

**Linux (Ubuntu/Debian)：**
```bash
# ffmpeg
sudo apt install ffmpeg -y

# Playwright 浏览器 + 系统依赖
pip install playwright
playwright install chromium
playwright install-deps chromium
```

**macOS：**
```bash
# ffmpeg
brew install ffmpeg

# Playwright
playwright install chromium
```

### 3. 后端安装

```bash
cd backend

# 推荐使用虚拟环境
python -m venv venv
source venv/bin/activate  # Linux/macOS
# venv\Scriptsctivate   # Windows

pip install -r requirements.txt
```

### 4. 前端安装

```bash
cd frontend
npm install
```

### 5. 启动服务

```bash
# 终端 1 - 后端 (port 8001)
cd backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 8001

# 终端 2 - 前端 (port 5173)
cd frontend
npm run dev
```

访问 `http://localhost:5173`

## 使用流程

### 第一步：配置 API Key

进入 **设置** → 配置三个环节。推荐使用**阿里云百炼**，一个 Key 覆盖全部三个环节：

| 环节 | 推荐服务 | 推荐模型 | 申请地址 |
|------|---------|---------|---------|
| LLM 分镜 | 通义千问 | qwen-plus | https://bailian.console.aliyun.com |
| TTS 配音 | 百炼 CosyVoice | qwen-audio-3.0-tts-flash | https://bailian.console.aliyun.com |
| 视频生成 | 百炼 Wan-2.1 | wanx2.1-t2v-plus | https://bailian.console.aliyun.com |

> **一个百炼 API Key 即可同时用于 LLM、TTS 和视频生成。** 也可混搭其他服务商（如 LLM 用 DeepSeek 更省钱）。

### 第二步：添加视频号账号

1. 进入 **账号管理** → **新增账号**
2. 点击 **扫码登录**，用手机微信扫描弹出的浏览器二维码
3. 扫码确认后自动获取登录状态

### 第三步：制作视频

1. 进入 **文生视频** → 输入主题
2. 设置尺寸（推荐 9:16 竖屏）、分镜数量、每镜时长
3. 点击 **AI 生成分镜方案** → LLM 自动拆解分镜
4. 编辑每个分镜的**画面提示词**和**配音文案**
5. 点击 **确认并生成视频** → 后台执行：
   - TTS 生成每镜配音音频
   - Wan-2.1 生成每镜视频画面
   - ffmpeg 合成画面 + 配音 + 字幕 → 最终视频
6. 生成完成后自动存入素材库，可在文生视频 Step 3 或素材库展开行查看实时进度

### 第四步：发布视频

1. 进入 **素材库** → 找到就绪视频
2. 点击 **发布**，勾选目标账号，填写标题和标签
3. 点击 **确认发布**

## 视频生成管线

点击「确认并生成视频」后，后端异步执行：

```
用户提交 {shots: [{scene_prompt, voice_script, duration}, ...]}
                          │
          ┌───────────────┴───────────────┐
          │     遍历每个分镜（串行）       │
          └───────────────┬───────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                  ▼
   ┌──────────┐    ┌──────────────┐   ┌──────────┐
   │ 镜1      │    │ 镜2          │   │ 镜N      │
   │① TTS配音 │    │① TTS配音    │   │① TTS配音 │
   │② 视频生成│    │② 视频生成   │   │② 视频生成│
   └────┬─────┘    └──────┬───────┘   └────┬─────┘
        └─────────────────┼─────────────────┘
                          ▼
              ┌───────────────────┐
              │  ffmpeg 合成      │
              │  拼接所有片段     │
              │  叠加配音音频     │
              │  烧录字幕文字     │
              │  → 最终视频.mp4   │
              └────────┬──────────┘
                       ▼
              ┌───────────────────┐
              │  存入素材库       │
              │  状态 → ready     │
              └───────────────────┘
```

- **分镜进度实时可见**：文生视频 Step 3 和素材库展开行均可查看
- **无 ffmpeg 降级**：若系统未装 ffmpeg，各分镜单独保存为独立视频入库

### 各环节耗时

| 环节 | 单镜耗时 | 说明 |
|------|---------|------|
| TTS 配音 | 1-3 秒 | 百炼 CosyVoice，dashscope SDK WebSocket 流式 |
| Wan-2.1 生成 | 1-3 分钟 | 提交异步任务 + 轮询等待 |
| ffmpeg 合成 | < 10 秒 | 本地处理 |
| **总计（4镜）** | **5-12 分钟** | |

### 成本参考（4镜×5秒，Wan-2.1）

约 **12 元/条**。省钱建议：
- 减至 2 镜 → 约 6 元/条
- 换 CogVideo 自部署 → 免费
- 图生视频模式 → 约 0.5 元/镜

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/accounts | 账号列表 |
| POST | /api/accounts?name=xxx | 新增账号 |
| DELETE | /api/accounts/:id | 删除账号 |
| GET | /api/accounts/:id/qrcode | 获取登录二维码 |
| GET | /api/accounts/:id/qrcode/status | 查询扫码状态 |
| GET | /api/media | 素材列表 |
| POST | /api/media/upload | 上传视频 |
| POST | /api/media/generate-shots | AI 生成分镜方案 |
| POST | /api/media/generate | 提交视频生成任务 |
| GET | /api/media/:id/shots | 查询分镜进度 |
| DELETE | /api/media/:id | 删除素材 |
| POST | /api/publish | 创建发布任务 |
| GET | /api/publish/tasks | 发布任务列表 |
| POST | /api/publish/tasks/:id/cancel | 取消发布 |
| GET | /api/settings | 系统设置列表 |
| PUT | /api/settings/:key | 更新设置 |

## 可选 AI 服务

### LLM（分镜策划）

| 服务 | 模型 | base_url |
|------|------|----------|
| 通义千问 | qwen-plus | https://dashscope.aliyuncs.com/compatible-mode/v1 |
| DeepSeek | deepseek-chat | https://api.deepseek.com/v1 |
| OpenAI | gpt-4o | https://api.openai.com/v1 |
| 智谱 GLM | glm-4 | https://open.bigmodel.cn/api/paas/v4 |
| Moonshot | moonshot-v1-8k | https://api.moonshot.cn/v1 |

### 视频生成

| 服务 | 模型 | 说明 |
|------|------|------|
| Wan-2.1 | wanx2.1-t2v-plus | 阿里云百炼，性价比最高 |
| 可灵 Kling | kling-v1 | 效果最好，价格较高 |
| 即梦 Jimeng | - | 字节系，有免费额度 |
| Runway | gen-3 | 海外服务，质量高 |
| CogVideo | - | 开源，可本地部署（免费） |

### TTS（语音合成）

| 服务 | 模型 | 说明 |
|------|------|------|
| 百炼 CosyVoice | qwen-audio-3.0-tts-flash | 国内直连，dashscope SDK，音色可选 |
| Edge TTS | - | 微软免费（海外可用，国内可能被墙） |
| OpenAI TTS | tts-1 | 需科学上网 |
| ChatTTS | - | 开源，中文自然度最佳，需 GPU |

> Settings 页面支持切换 TTS 音色：龙安欢（温柔女声）、龙小春（知性女声）、龙小夏（活泼女声）、龙一辰（沉稳男声）。

## 配置说明

所有 API Key 存储在 SQLite 数据库 `settings` 表中，代码无硬编码。部署到新环境时通过 Settings 页面配置即可，无需修改代码。

当前推荐配置（一个百炼 Key 全覆盖）：

| 环节 | 服务 | 模型 | Key |
|------|------|------|-----|
| LLM 分镜 | 通义千问 | qwen-plus | sk-xxx（百炼） |
| TTS 配音 | 百炼 CosyVoice | qwen-audio-3.0-tts-flash | sk-xxx（同上） |
| 视频生成 | 百炼 Wan-2.1 | wanx2.1-t2v-plus | sk-xxx（同上） |

## 注意事项

- 扫码登录有效期由微信服务端决定，过期后状态自动标记为 expired，需重新扫码
- 首次使用发布功能需 `playwright install chromium`
- Wan-2.1 单条约 12 元，建议先用短时长、少分镜控制成本
- ffmpeg 合成需系统安装 ffmpeg，未安装时各分镜分别入库
- Edge TTS 国内可能被墙，推荐使用百炼 CosyVoice
- 后端重启后卡在 `generating` 状态的视频会自动标记为失败

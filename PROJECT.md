# 素人视频号智能体 - 项目文档

> 最后更新: 2026-07-22

## 项目概述

面向食品大健康方向的微信视频号矩阵管理系统，支持 30 个微信视频号账号的统一管理、AI 视频生成和批量发布。

- **定位**：单人管理 30 个素人视频号
- **内容方向**：食品、大健康、养生
- **账号性质**：自养号，不可丢失
- **内容来源**：纯 AI 生成

---

## 技术架构

```
前端 React (Ant Design) ──HTTP──→ 后端 FastAPI ──┬── SQLite 数据库
                                                 ├── Playwright 浏览器引擎 ← channels.weixin.qq.com
                                                 └── AI 视频 API (即梦/可灵，待对接)
```

| 层 | 技术 | 说明 |
|---|---|---|
| 前端 | React + Vite + Ant Design | 三页面 SPA |
| 后端 | Python FastAPI + SQLAlchemy | 异步 REST API |
| 数据库 | SQLite | 本地文件数据库，单用户够用 |
| 浏览器引擎 | Playwright + Chromium | 自动化操作视频号网页端（参考 Matrix） |

---

## 已完成模块

### 前端 (frontend/)

#### 页面一：账号管理 `/`
- 新增账号（上限 10 个），需填名称用于内部识别
- 账号列表展示：名称、状态（🟢在线 / 🟡待扫码 / ⚪未绑定）、最后登录时间
- 扫码绑定：调后端 API 生成二维码（本地 SVG 占位，云端 Playwright 真实扫码）
- 每个账号旁有「发布」按钮，仅在线状态可用
- 删除账号（带确认弹窗）
- 文件：`frontend/src/pages/Accounts.jsx`

#### 页面二：素材库 `/media`
- 素材列表展示：缩略图占位、名称、大小、时长、状态、创建时间
- 上传视频：支持本地视频文件上传
- 多选素材：Checkbox 选择，仅就绪状态可选
- 发布选中：勾选后弹出发布弹窗
- 删除素材
- 文件：`frontend/src/pages/MediaLibrary.jsx`

#### 页面三：文生视频 `/text-to-video`
- 文案输入框（最多 500 字）
- 点击「生成视频」提交 AI 生成任务到后端
- 生成成功后显示结果 + 跳转素材库链接
- 文件：`frontend/src/pages/TextToVideo.jsx`

#### 发布弹窗（共用组件）
- 从后端拉取真实账号列表
- 多选账号（仅在线可选）
- 表单：标题/描述（必填）、话题标签、定时发布
- 调后端 API 创建发布任务 → Worker 自动执行
- 文件：`frontend/src/components/PublishModal.jsx`

#### API 服务层
- 封装 accounts、media、publish 三个模块
- 文件：`frontend/src/services/api.js`

---

### 后端 (backend/)

#### 项目结构

```
backend/
├── app/
│   ├── main.py                  # FastAPI 入口，CORS，启动 Worker
│   ├── config.py                # 配置（数据库URL、上传目录、最大账号数）
│   ├── database.py              # 异步 SQLAlchemy 引擎
│   ├── models/
│   │   ├── __init__.py
│   │   └── models.py            # 数据表：Account, Media, PublishTask
│   ├── schemas/
│   │   └── schemas.py           # Pydantic 请求/响应模型
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── accounts.py          # 账号 CRUD + 真实扫码登录（含降级）
│   │   ├── media.py             # 素材上传/列表/删除 + AI 生成任务
│   │   └── publish.py           # 发布任务创建/查询
│   └── services/
│       ├── __init__.py
│       ├── qrcode_service.py    # 扫码登录引擎（Playwright 真实扫码 + SVG 降级）
│       ├── publisher_engine.py  # 视频号发布引擎（参考 Matrix TencentVideo）
│       └── worker.py            # 后台任务队列 Worker
├── cookies/                     # Playwright 登录 Session JSON 文件
├── uploads/                     # 视频文件存储目录
├── requirements.txt
└── data.db                      # SQLite 数据库文件
```

#### 数据库表设计

与之前一致，3 张表：`accounts`、`media`、`publish_tasks`。

#### API 接口（已全部实现）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/accounts` | 获取所有账号 |
| POST | `/api/accounts?name=xxx` | 添加账号 |
| DELETE | `/api/accounts/{id}` | 删除账号 |
| GET | `/api/accounts/{id}/qrcode` | 获取登录二维码（Playwright 真实 / SVG 降级） |
| GET | `/api/accounts/{id}/qrcode/status` | 轮询扫码状态 |
| POST | `/api/accounts/{id}/bind` | 完成绑定（保存 Cookie，更新状态） |
| POST | `/api/accounts/{id}/validate` | 校验 Cookie 是否有效 |
| GET | `/api/media` | 获取所有素材 |
| POST | `/api/media/upload` | 上传视频 |
| DELETE | `/api/media/{id}` | 删除素材 |
| POST | `/api/media/generate` | 提交 AI 生成任务 |
| POST | `/api/publish` | 创建发布任务（Worker 自动消费） |
| GET | `/api/publish/tasks` | 查询发布任务列表 |

---

### 扫码登录流程（完整实现）

**云端模式（有 Playwright + Chromium）：**
```
前端点「扫码绑定」→ 后端 Playwright 打开 channels.weixin.qq.com 登录页
→ 截图真实微信二维码 → 返回 base64 给前端
→ 前端展示，用户用微信扫 → 后端轮询检测扫码成功
→ 提取 Cookie + 昵称 + 头像 → JSON 文件落盘（cookies/account_{id}.json）
→ 更新账号状态为 🟢 在线
```

**本地模式（无 Chromium）：**
```
自动降级为 SVG 占位二维码 → 前端展示 → 点绑定直接标记为在线（模拟）
```

---

### 发布引擎（参考 Matrix `tencent_uploader/main.py`）

```
Worker 从 publish_tasks 取 pending 任务
  ↓
1. Cookie 有效性校验（访问 post/create 页，检查是否被重定向到登录页）
2. 恢复 Session → 打开 channels.weixin.qq.com/platform/post/create
3. 上传视频文件 (input[type="file"])
4. 等待上传完成（最大 120s）
5. 填标题 (div.input-editor)
6. 添加话题标签
7. 设置定时发布时间（如有）
8. 点击「发表」按钮
9. 等待成功 → 标记任务完成
10. 随机间隔 5-15 分钟后处理下一个任务
```

---

### 部署到云端时需要的操作

```bash
# 安装 Playwright 浏览器
pip install playwright
playwright install chromium
playwright install-deps  # Linux 系统依赖

# 启动后端
cd backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

部署后扫码和发布自动从降级模式切换为真实模式。

---

## 待完成模块

### 1. AI 视频生成 API 对接

需要即梦（Jimeng）或可灵（Kling）的 API Key。代码预留了 `POST /api/media/generate` 接口，目前只创建数据库记录（status=generating），未真正调 AI API。

### 2. 内容差异化

30 个号不能发完全相同的视频。需自动做片头/片尾替换、文案变体、滤镜微调。

### 3. 账号健康监控

发布后检查审核状态、播放量、互动数据，异常预警（限流、降权、封号）。

### 4. 封面自动生成

目前发布不设置自定义封面，视频号会自动截取。后续可加 AI 生成封面图。

---

## 启动方式

### 前端
```bash
cd frontend
npm install
npm run dev
# http://localhost:5173
```

### 后端
```bash
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
# API 文档 http://localhost:8000/docs
```

---

## 技术决策记录

| 决策 | 原因 |
|------|------|
| 不走手机 ADB 自动化 | 30 个号不能丢，手机端自动化封号风险太高 |
| 走视频号助手网页端 | 官方后台，Session 可持久化 |
| 参考 Matrix 源码 | Stars 最多，Playwright 流程成熟，直接复用思路 |
| 先素材库再发布 | 同一视频多号发布，避免重复上传 |
| 单人模式 | 不需要多用户/多租户 |
| 不设系统登录 | 单人使用 |
| 前端 Ant Design | 企业级组件库，中文生态好 |
| 后端 FastAPI + SQLite | 轻量、异步、单文件数据库 |
| 本地降级模式 | 无 Chromium 时 SVG 占位 + 模拟发布，方便开发调试 |
| 随机发布间隔 5-15min | 模拟真人行为，降低风控概率 |

---

## 项目目录总览

```
AI微信视频发布/
├── frontend/                     # React + Vite + Ant Design
│   ├── src/
│   │   ├── main.jsx
│   │   ├── App.jsx               # 布局 + 路由
│   │   ├── index.css
│   │   ├── pages/
│   │   │   ├── Accounts.jsx      # 账号管理
│   │   │   ├── MediaLibrary.jsx  # 素材库
│   │   │   └── TextToVideo.jsx   # 文生视频
│   │   ├── components/
│   │   │   └── PublishModal.jsx  # 发布弹窗
│   │   └── services/
│   │       └── api.js            # API 请求封装
│   ├── package.json
│   └── vite.config.js
├── backend/                      # Python FastAPI
│   ├── app/
│   │   ├── main.py               # 应用入口 + Worker 启动
│   │   ├── config.py             # 配置
│   │   ├── database.py           # 数据库引擎
│   │   ├── models/
│   │   │   ├── __init__.py
│   │   │   └── models.py         # ORM 模型
│   │   ├── schemas/
│   │   │   └── schemas.py        # Pydantic 模型
│   │   ├── routers/
│   │   │   ├── __init__.py
│   │   │   ├── accounts.py       # 账号路由（含真实扫码）
│   │   │   ├── media.py          # 素材路由
│   │   │   └── publish.py        # 发布路由
│   │   └── services/
│   │       ├── __init__.py
│   │       ├── qrcode_service.py # 扫码登录引擎
│   │       ├── publisher_engine.py # 发布引擎
│   │       └── worker.py         # 任务队列 Worker
│   ├── cookies/                  # 登录 Session 存储
│   ├── uploads/                  # 视频文件存储
│   ├── requirements.txt
│   └── data.db
├── matrix_ref/                   # Matrix 项目参考
└── PROJECT.md                    # 本文件
```

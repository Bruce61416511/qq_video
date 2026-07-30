# 全链路内容工厂 - 改造计划

> 创建日期: 2026-07-30
> 状态: 规划中

---

## 总览

从"视频号发布工具"升级为"选题→模板→分镜→合成→发布→数据"全链路 AI 内容工厂。

目标平台：抖音（主）、快手/小红书（辅）
内容方向：大健康 / 食品 / 养生 / 药食同源

---

## 改造步骤

### 第一步：热点洞察

**目标**：自动抓取全网热搜，筛选大健康/食品相关话题，作为每日选题输入。

**后端新增**：
- ackend/app/services/trend_service.py — 热搜抓取引擎
- ackend/app/routers/trends.py — 选题 API
- 数据表 hot_topics：热搜话题存储

**核心逻辑**：
- 对接热搜源（微博热搜 API / 抖音热榜 / TrendRadar）
- 关键词过滤：大健康、食品、养生、药食同源、中医、减肥、抗衰 等
- 按热度 + 相关度排序，每日定时刷新
- 支持人工筛选/收藏为选题

**前端新增**：
- rontend/src/pages/TrendBoard.jsx — 选题看板页

**状态**：⏳ 待开始

---

### 第二步：模板积累

**目标**：拆解爆款视频结构，沉淀为可复用的标准化模板库。

**后端新增**：
- ackend/app/services/template_service.py — 模板拆解引擎
- ackend/app/routers/templates.py — 模板 CRUD API
- 数据表 	emplates：爆款模板存储

**核心逻辑**：
- 输入：爆款视频文案/字幕
- AI 自动拆解结构：黄金3秒、叙事节奏、情绪曲线、行动指令
- 按品类（养生/食品/减肥/中医）和风格（口播/剧情/科普/Vlog）分类
- 存储为结构化 JSON（镜头列表 + 节奏标注）

**前端新增**：
- rontend/src/pages/TemplateLibrary.jsx — 模板库页

**状态**：⏳ 待开始

---

### 第三步：分镜生成升级

**目标**：将热点+模板+卖点+人群组合输入，批量生成标准化分镜。

**改造现有**：
- ackend/app/services/llm_service.py — LLM 分镜服务
- ackend/app/routers/media.py — 素材路由

**核心升级**：
- Prompt 四合一输入：
  `
  热搜话题 + 爆款模板结构 + 产品卖点/目标人群 + 分镜格式要求
  `
- 输出标准化 JSON：
  `json
  {
    "shots": [
      {
        "index": 1,
        "scene": "特写",
        "duration": 3,
        "visual": "画面描述...",
        "narration": "台词...",
        "emotion": "好奇/惊讶/共鸣",
        "transition": "硬切"
      }
    ]
  }
  `
- 支持批量生成：一个选题 × N 个模板 → N 组分镜方案

**状态**：⏳ 待开始

---

### 第四步：视频合成增强

**目标**：按分镜逐镜生成/采集素材，配音+字幕合成完整视频。

**改造现有**：
- ackend/app/services/video_gen_service.py — 视频生成服务
- ackend/app/services/video_composer.py — ffmpeg 合成

**核心增强**：
- 分镜预览：生成前逐镜预览确认
- 单镜重生成：不满意的分镜单独重来，不影响其他镜
- 片头/片尾模板、品牌水印叠加
- 封面自动生成（提取关键帧 + AI 标题）

**状态**：⏳ 待开始

---

### 第五步：平台发布迁移

**目标**：发布目标从视频号切换到抖音（复用 matrix_repo），支持多平台。

**改造现有**：
- ackend/app/services/publisher_engine.py — 发布引擎
- 复用 matrix_repo/douyin_uploader/ — 抖音上传器

**核心升级**：
- 发布平台：抖音（主）、快手、小红书（辅）
- 定时发布 + 真人节奏模拟（随机间隔）
- 发布状态追踪：排队 → 上传中 → 审核中 → 已发布 → 被拒
- 多账号矩阵：独立 Cookie/IP/设备指纹隔离

**状态**：⏳ 待开始

---

### 第六步：数据回溯闭环

**目标**：回收视频数据 → 评估模板效果 → 驱动模板库迭代优化。

**后端新增**：
- ackend/app/services/analytics_service.py — 数据回收服务
- ackend/app/routers/analytics.py — 数据分析 API
- 数据表 ideo_metrics：视频指标存储

**核心逻辑**：
- 对接抖音开放平台 API：播放量、点赞、评论、分享、完播率、转化
- 按视频 + 平台记录每日指标
- 关联模板：计算每个模板的平均效果分（加权：播放×1 + 互动×3 + 转化×5）
- 模板自动排序：高分优先推荐，低分降权/淘汰
- 生成优化建议（如"该模板3秒完播率低，建议强化黄金开头"）

**前端新增**：
- rontend/src/pages/DataDashboard.jsx — 数据看板页

**状态**：⏳ 待开始

---

### 第七步：前端重构

**目标**：适配新管线，重新组织页面与导航。

**新增页面**：
- TrendBoard.jsx — 选题看板（热点浏览、筛选、收藏）
- TemplateLibrary.jsx — 模板库（浏览、分类、新建/编辑）
- DataDashboard.jsx — 数据看板（关键指标图表）

**改造页面**：
- TextToVideo.jsx — 升级为完整管线入口（选题→模板→分镜→生成）
- Accounts.jsx — 适配抖音等多平台账号管理

**导航重组**：
`
📊 选题看板     → 热点洞察 + 选题管理
📋 模板库       → 爆款模板 CRUD
🎬 视频生产     → 文生视频（管线入口）
📦 素材库       → 成品视频管理
🚀 发布管理     → 多平台发布任务
📈 数据看板     → 指标回收与模板评分
⚙️ 系统设置     → API Key / 模型配置
`

**状态**：⏳ 待开始

---

## 依赖关系

`
第一步（热点）──┐
                ├──→ 第三步（分镜）──→ 第四步（合成）──→ 第五步（发布）──→ 第六步（数据）
第二步（模板）──┘                                                          │
                └──────────────────────────────────────────────────────────┘
                                    （数据反馈迭代模板 → 回到第二步）

第七步（前端重构）贯穿全程，随各步后端就绪逐步推进。
`

---

## 数据表新增

| 表名 | 所属步骤 | 核心字段 |
|------|---------|---------|
| hot_topics | ① 热点洞察 | title, source, heat_score, keywords, collected_at |
| 	emplates | ② 模板积累 | name, category, style, structure_json, source_video, score |
| ideo_metrics | ⑥ 数据回溯 | video_id, platform, views, likes, comments, shares, conversion, recorded_at |

---

## 后端新增文件

| 文件 | 所属步骤 |
|------|---------|
| ackend/app/services/trend_service.py | ① |
| ackend/app/routers/trends.py | ① |
| ackend/app/services/template_service.py | ② |
| ackend/app/routers/templates.py | ② |
| ackend/app/services/analytics_service.py | ⑥ |
| ackend/app/routers/analytics.py | ⑥ |

---

## 前端新增文件

| 文件 | 所属步骤 |
|------|---------|
| rontend/src/pages/TrendBoard.jsx | ① |
| rontend/src/pages/TemplateLibrary.jsx | ② |
| rontend/src/pages/DataDashboard.jsx | ⑥ |

---

## 进度追踪

- [ ] 第一步：热点洞察
- [ ] 第二步：模板积累
- [ ] 第三步：分镜生成升级
- [ ] 第四步：视频合成增强
- [ ] 第五步：平台发布迁移
- [ ] 第六步：数据回溯闭环
- [ ] 第七步：前端重构

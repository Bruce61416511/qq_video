# 商业化改造方案

> 本文档记录了从 Demo 到商用级别需要解决的问题，以及不同视频生成模型的 API 参数差异分析。
> 基于 AI微信视频发布 项目（FastAPI + React + SQLite）。

---

## 一、不同模型 API 参数对比

### 1.1 当前项目支持的参数

项目目前仅透传以下通用参数到视频生成 API：

| 参数 | 说明 | 来源 |
|------|------|------|
| `prompt` | 画面描述（scene_prompt） | 分镜规划自动生成 |
| `size` | 画面比例（9:16 / 16:9 / 1:1） | 前端用户选择 |
| `resolution` | 分辨率（720P / 1080P） | 前端用户选择 |
| `duration` | 时长（3s / 5s / 10s / 15s / 30s） | 前端用户选择 |
| `api_key` / `api_secret` | 凭证 | Settings 配置 |

### 1.2 各模型完整参数对比

| 参数 | Wan2.1 (DashScope) | 即梦 Jimeng | Kling | Runway | CogVideo |
|------|:--:|:--:|:--:|:--:|:--:|
| `prompt` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `size`/`resolution` | ✅ `1280*720` 格式 | ✅ 比例格式 | ✅ 比例格式 | ✅ 比例格式 | ✅ |
| `duration` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `negative_prompt` | ✅ | ❓不明确 | ❌ | ❌ | ❌ |
| `seed` | ✅ | ✅ | ❌ | ✅ | ✅ |
| `prompt_extend` | ✅ **独有** | ❌ | ❌ | ❌ | ❌ |
| `cfg_scale` | ❌ | ✅ **独有** | ✅ | ❌ | ❌ |
| `motion_scale` | ❌ | ✅ **独有** | ❌ | ❌ | ❌ |
| `mode` | ❌ | ❌ | ✅ `std/pro` | ❌ | ❌ |
| `steps` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `sampler` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `fps` | ❌ | ❓ | ❌ | ❌ | ❓ |

### 1.3 设计哲学差异

| 模型 | 设计思路 | 适合场景 |
|------|---------|---------|
| **Wan2.1** | 少即是多，内部自动调优，`prompt_extend` 降低 prompt 工程门槛 | **批量自动化生产**，稳定性高 |
| **即梦** | 精细可控，暴露 `cfg_scale`/`motion_scale` 等旋钮 | 精调单条视频，有经验的用户 |
| **Kling** | 中等可控，有模式切换 | 质量优先，成本较高 |
| **Runway** | 偏专业创作者，API 相对简单 | 高端制作，费用最高 |
| **CogVideo** | 开源免费，参数少 | 低成本/离线使用 |

### 1.4 核心调参参数详解

#### Negative Prompt（Wan2.1 支持）

告诉模型"不要生成什么"，对画面清洁度提升显著。

**万能模板：**
```
blurry, low resolution, distorted, ugly, bad anatomy,
disfigured, extra fingers, extra limbs, fused fingers,
text, watermark, logo, jpeg artifacts, grain,
oversaturated, overexposed, jittery, still image, static
```

**按题材追加：**

| 视频类型 | 追加内容 |
|----------|---------|
| 人物出镜 | `extra fingers, mutated hands, poorly drawn face, cloned face` |
| 自然风景 | `overexposed, washed out, oversaturated, plastic texture` |
| 产品展示 | `distorted product, incorrect shape, wrong color, reflection artifact` |
| 食物 | `unappetizing, plastic texture, wrong proportion, unnatural colors` |

**注意事项：**
- 10-20 个词最佳，太多反而效果差
- 不要写与 prompt 矛盾的内容
- 强排斥词：`blurry`、`distorted`、`text`/`watermark`、`low quality`
- 弱排斥词：`cartoon`、`horror`、`dark`（只能微调倾向）

#### Seed（Wan2.1、即梦、Runway 支持）

随机数种子，决定视频初始噪点分布。**相同 seed + 相同 prompt = 完全相同视频。**

| 使用场景 | 策略 |
|---------|------|
| 首次生成 | 不传 seed（随机） |
| 效果满意，微调 prompt | 用上次返回的 seed |
| 效果不满意，换花样 | 不传 seed（换随机） |
| A/B 测试 | 固定 seed，只改 prompt |
| 批量保持风格一致 | seed + 固定偏移（100, 200, 300...） |

**常见误区：**
- `seed=0` ≠ 随机，0 就是一个固定种子
- seed 跟质量毫无关系，只决定初始噪点
- 想要随机：不传 seed 参数

### 1.5 前端多模型适配方案

三种方案对比：

| 方案 | 复杂度 | 优点 | 缺点 |
|------|--------|------|------|
| **最小公约数**（当前） | 低 | 一套表单通用 | 浪费模型能力 |
| **动态参数面板**（推荐） | 中 | 释放每个模型能力 | 新增模型需加配置 |
| **抽象参数层** | 高 | 用户无感切换 | 维护成本高，不推荐 |

**推荐方案**：动态参数面板，切换 `video_service` 时参数区跟着变，与现有 Settings 的模型下拉联动模式一致。

---

## 二、商业化改造清单

### P0 — 不做会直接崩

#### 2.1 异步任务架构

**当前问题：**
- 使用 `asyncio.create_task` 跑后台生成
- 服务重启 → 进行中的视频全部丢失
- 任务失败 → 无重试机制
- 无并发控制 → 多用户同时生成必被 API 限流

**改造方案：Celery + Redis**
- 任务持久化到 Redis/DB，重启不丢
- 失败自动重试（指数退避：10s → 30s → 90s → 270s）
- Worker 并发数可控，配合 API 限流阈值
- 优先级队列（付费用户优先）
- 任务状态可观测：排队中 / 生成中 / 完成 / 失败

#### 2.2 API Key 安全管理

**当前问题：**
- API Key 明文存 SQLite
- 前端可完整读取
- 无额度/余额监控

**改造方案：**
- **加密存储**：AES-256 加密，密钥从环境变量 / KMS 读取
- **多用户隔离**：用户表 + 外键，每人独享自己的 Key
- **前端脱敏**：只显示后 4 位（`sk-****abcd`）
- **余额监控**：定时查各 API 余额，低于阈值企业微信/邮件告警
- **密钥轮换**：支持在线更新 Key，不影响进行中任务

### P1 — 不做用户会流失

#### 2.3 微信账号风控

**当前隐患：**

| 行为 | 风险 |
|------|------|
| 同一 IP 频繁切换账号 | 关联封号 |
| Cookie 过期无感知 | 发布静默失败 |
| 发布频率过高 | 被限流/封禁 |
| 多账号用同一设备指纹 | 批量封禁 |

**改造方案：**
- **账号隔离**：每账号独立浏览器 profile + 独享代理 IP
- **发布节奏**：模拟人类行为，随机间隔 5-15 分钟
- **状态监控**：定时校验 Cookie 有效性，过期自动告警/标记
- **渐进式发布**：新账号每天 1 条起步，养号 1 周后逐步放开
- **封禁检测**：发布失败时解析微信返回的错误码，区分"网络问题"和"账号被限"

#### 2.4 模型容灾与 Fallback

**当前问题：**
- 单一模型挂了 = 全站停服

**改造方案：多级降级链**
```
Wan(主) → 失败 → Kling(备1) → 失败 → 即梦(备2) → 失败 → 占位视频 + 告警
```

配合成本策略：主用便宜的（Wan），贵的做 backup（Kling/Runway）。

### P2 — 规模化后必做

#### 2.5 存储层升级

| 组件 | 当前 | 商用 |
|------|------|------|
| 数据库 | SQLite | PostgreSQL |
| 视频存储 | 本地 `uploads/` | 对象存储 OSS/S3 + CDN |

- SQLite 并发写会锁死，PostgreSQL 支持多 Worker 并发
- OSS + CDN 按量付费，视频加载速度有保障

#### 2.6 内容安全审核

**风险：** 用户 prompt 不可控，一条违规视频 = 平台封禁

**改造方案：**
- **Prompt 层**：敏感词过滤（政治/色情/暴力），命中直接拦截
- **结果层**：视频生成后抽关键帧 → 内容安全 API（阿里云/腾讯云）
- **发布层**：微信端最后一次拦截，失败回传具体封禁原因

### P3 — 用户体验加分

#### 2.7 成本可视化

每个任务记录明细：
- 用了什么模型（Wan / Kling / 即梦）
- 消耗了多少秒数 / tokens
- 换算金额
- 前端展示 + 月度账单导出

无此功能，用户不敢大量使用。

---

## 三、优先级总览

| 优先级 | 事项 | 不做的后果 | 预估工作量 |
|--------|------|-----------|-----------|
| **P0** | 任务队列（Celery + Redis） | 重启丢任务，并发崩溃 | 3-5 天 |
| **P0** | API Key 加密存储 | 安全合规底线 | 1-2 天 |
| **P1** | 微信风控策略 | 用户封号 = 流失 | 3-5 天 |
| **P1** | 模型 Fallback | 单点故障 = 停服 | 1-2 天 |
| **P1** | 多模型参数适配 | 浪费模型能力 | 2-3 天 |
| **P2** | PostgreSQL + OSS | 数据量大才疼 | 2-3 天 |
| **P2** | 内容安全审核 | 平台封禁风险 | 1-2 天 |
| **P3** | 成本可视化 | 用户不敢大量用 | 1-2 天 |

---

## 四、技术债务（Demo 遗留）

以下为 Demo 阶段遗留问题，商用前必须清理：

- [x] `asyncio.create_task` 改 Celery 任务队列
- [x] SQLite 改 PostgreSQL
- [x] `start.ps1` 手动启动改 systemd / Docker Compose
- [x] 前端 dev server 改 Nginx 反向代理
- [x] Vite proxy 仅开发用，生产需改 Nginx
- [x] Cookie 明文存 SQLite 改加密存储
- [x] 无日志系统 → 接入结构化日志（JSON 格式 + ELK）
- [x] 无监控告警 → 接入 Prometheus + Grafana
- [x] 无 CI/CD → GitHub Actions / Jenkins
- [x] 即梦 API 接入为占位状态（`not_implemented`）
- [x] CogVideo API 接入为占位状态
- [x] Runway API 接入为占位状态

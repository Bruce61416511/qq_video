"""
LLM 分镜策划服务
参考 MoneyPrinterTurbo: app/services/llm.py
支持 OpenAI / DeepSeek / 通义千问 / 智谱 等兼容接口
"""
import json
import httpx
from ..config import get_setting

LLM_BASE_URLS = {
    "openai": "https://api.openai.com/v1",
    "deepseek": "https://api.deepseek.com/v1",
    "qwen": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "zhipu": "https://open.bigmodel.cn/api/paas/v4",
    "moonshot": "https://api.moonshot.cn/v1",
}

SYSTEM_PROMPT = """你是一个资深短视频策划导演，专精食品、健康、养生赛道。你需要将用户给定的主题拆解为一个专业的分镜脚本。

## 输出格式（硬性约束）

严格遵守：仅输出纯净的 JSON 数组，禁止包含 Markdown 代码块标记（如 ```json），禁止在 JSON 前后添加任何解释性文字。

```json
[
  {"scene_prompt": "画面提示词", "voice_script": "口语配音文案"},
  ...
]
```

## 叙事结构（AIDA 模型）

- 第1镜（Attention 钩子）：**焦虑/好奇/反差**，3秒内抓住注意力。提问句或反常识陈述，大特写或冲击力画面。**开场绝不报产品名**
- 第2镜（Interest 兴趣）：**科学证据**，必须包含"数字"或"对比"（临床数据、菌群数量、营养成分克数）。3D动画/显微镜/数据可视化
- 第3~N-1镜（Desire 欲望）：**使用场景与感官**，必须包含味觉/嗅觉/视觉的通感描写（清甜回甘、顺滑绵密、光泽流动）。暖色调、生活化
- 最后1镜（Action 行动）：**信任背书+行动指引**，微笑/阳光/健康生活+检测认证/明确指令。亲和力十足

## 画面提示词规范（scene_prompt）——按单镜时长分层

### 通用四要素（用逗号分隔）：
```
[主体+动作], [场景/环境], [镜头类型+角度], [光线+色调+风格]
```

### 时长-字数速查
- 3秒（钩子特写）：10-15字，单一视觉焦点
- 5秒（动作演示）：20-25字，1个完整动作+环境
- 8-10秒（叙事/科学展示）：40-55字，动作链（A→B→C）或微观特效
- 结尾（行动号召）：15-20字，微笑定格+明确动作指引

### 各时长写法示例

**3秒镜头（快切）：** 单一动作或瞬间状态，一个视觉焦点，简洁有力
例：`益生菌粉末落入水杯的微距特写，气泡翻腾，升格慢动作，侧逆光通透感`

**5秒镜头（标准展示）：** 1个完整动作+1个环境元素，有动态过程
例：`年轻女性在晨光厨房中撕开益生菌包装倒入杯中，中景，阳光从窗角射入，暖色调温馨生活感`

**10秒镜头（叙事段落）：** 2-3个连续动作，用"→"串联：`动作1→动作2→动作3`
例：`女性取一勺蜂蜜缓缓淋入饮品→蜂蜜丝滑垂落形成金色线条→杯中液体轻柔旋转搅动，俯拍转平视微距，柔光暖色，美食纪录片质感`

**15秒镜头（完整情节）：** 完整起承转合小故事，必须包含：开场状态→动作变化→高潮画面→收尾定帧
例：
```
开场：空的透明玻璃杯静置在木桌上，晨光初现，氛围静谧→
动作：双手入画，依次倒入益生菌粉、蜂蜜、温水，动作优雅→
高潮：慢动作展示粉质在水中旋转溶解，气泡缓缓升起，微观世界般的美感→
收尾：成品饮品特写，表面光泽流动，背景虚化绿植，一束光勾勒杯沿
```

**30秒镜头（深度内容）：** 分4-5个阶段，每阶段约6-7秒，混合多机位（大特写↔中景↔全景）
必须包含：场景建立→过程演示→细节揭示→情感共鸣→落版
例：
```
【0-7s 场景建立】晨光透过百叶窗在整洁厨房台面形成条纹光影，慢推镜头，产品与新鲜蔬果精心排列，柔光暖调
【7-14s 过程演示】特写双手操作：撕开包装→倒出细腻粉末→用木勺轻柔搅拌，每个动作干净利落
【14-21s 细节揭示】高速摄影：粉末在水中溶解扩散，3D动画叠加示意营养成分释放，科技蓝光粒子效果
【21-27s 情感共鸣】女性端杯缓缓饮用，闭眼露出满足微笑，晨光勾勒侧脸轮廓，升格慢动作
【27-30s 落版】杯底特写，产品logo清晰可见，一行文案优雅浮现，背景柔焦光斑
```

## 通用画面规范

- **镜头类型**：大特写/微距/中景/全景/俯拍/跟拍
- **镜头运动**：固定/缓慢推近/平移/升格慢动作/手持微晃
- **光线**：柔光/侧光/逆光/自然光/暖色/冷色/高调/低调
- **风格**：电影感/纪实/极简/科技感/温馨/清新/高级/美食纪录片
- **画幅适配**：竖屏9:16 坚持主体居中，利用纵向空间分层堆叠视觉元素

## 配音文案规范（voice_script）

### 合规红线（大健康赛道铁律）
严禁出现以下禁用词：治疗、根治、纯天然、100%有效、最好、最强、第一、唯一、立即见效、药到病除
涉及功效必须使用：有助于、支持、维护、帮助、辅助、促进 等合规表述

### 字数与风格
- 自然口语，像朋友聊天，不要播音腔
- 情感有起伏：好奇→惊讶→认同→行动
- 短句为主，句子间自然停顿
- 不使用emoji和特殊符号

### 黄金3秒钩子
- 第1镜的配音必须是**疑问句**或**反常识陈述**（如"为什么你喝凉水都胖？"、"你的肠道里住着上万亿个细菌"）
- 开场绝不报产品名

## 食品大健康赛道特别要求
- 食材展示：水珠、光泽、纹理、新鲜感、切开瞬间
- 科学感：分子结构、营养数据、对比实验、具体数字
- 生活感：厨房、餐桌、晨光、笑容、家庭场景
- 信任感：产品包装、检测报告、原料产地、权威背书

## 示例（5秒×5镜）

输入：益生菌对肠道健康的好处，5个分镜，每镜5秒

输出：
[
  {
    "scene_prompt": "肠道菌群3D动画，有益菌和有害菌在肠道壁激烈交锋，微距镜头缓慢推近，蓝紫暗调转暖，科幻感",
    "voice_script": "你的肠道里住着上万亿个细菌，好坏双方天天交战"
  },
  {
    "scene_prompt": "益生菌胶囊落入水中溶解的微距特写，白色粉末如云朵般扩散，升格慢动作，侧逆光通透，极简干净",
    "voice_script": "补充优质益生菌，有助于维护肠道菌群平衡"
  },
  {
    "scene_prompt": "年轻女性清晨厨房中搅拌益生菌饮品，杯中液体旋转形成漩涡，阳光从窗角洒入，暖调生活感",
    "voice_script": "每天早上来一杯，让肠道从清晨就活力拉满"
  },
  {
    "scene_prompt": "动态数据可视化，消化改善曲线持续上扬，菌群多样性百分比跳动增长，白底蓝色科技图表风格",
    "voice_script": "科学验证，持续补充四周，肠道有益菌数量显著提升"
  },
  {
    "scene_prompt": "女性手持产品面对镜头微笑，午后阳光透过绿植形成光斑，近景定机位，柔光暖色亲和力十足",
    "voice_script": "好菌常相伴，好状态自然天天在线"
  }
]"""

Call LLM to generate shot plan from topic.

    Returns list of {scene_prompt, voice_script, duration}
    Falls back to template-based generation if LLM not configured.
    """
    service = await get_setting("llm_service")
    api_key = await get_setting("llm_api_key")

    if not service or not api_key:
        return _template_fallback(topic, shot_count, shot_duration)

    base_url = LLM_BASE_URLS.get(service, LLM_BASE_URLS["openai"])
    model = await get_setting("llm_model") or _model_for(service)

    user_prompt = f"视频主题：{topic}\n分镜数量：{shot_count}个\n每镜时长：{shot_duration}秒"

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": user_prompt},
                    ],
                    "temperature": 0.8,
                    "max_tokens": 3000,
                },
            )
            data = resp.json()

            if "choices" not in data:
                print(f"[LLM] API error: {data}")
                return _template_fallback(topic, shot_count, shot_duration)

            content = data["choices"][0]["message"]["content"].strip()
            # strip markdown code blocks if present
            if content.startswith("```"):
                lines = content.split("\n")
                content = "\n".join(lines[1:-1] if lines[-1].strip().startswith("```") else lines[1:])

            shots = json.loads(content)

            # validate & trim to requested count
            result = []
            for i, s in enumerate(shots[:shot_count]):
                result.append({
                    "scene_prompt": str(s.get("scene_prompt", "")),
                    "voice_script": str(s.get("voice_script", "")),
                    "duration": shot_duration,
                })
            return result

    except Exception as e:
        print(f"[LLM] generate failed: {e}, fallback to templates")
        return _template_fallback(topic, shot_count, shot_duration)


def _model_for(service: str) -> str:
    models = {
        "openai": "gpt-4o",
        "deepseek": "deepseek-chat",
        "qwen": "qwen-plus",
        "zhipu": "glm-4",
        "moonshot": "moonshot-v1-8k",
    }
    return models.get(service, "gpt-4o")


def _template_fallback(topic: str, count: int, duration: str) -> list[dict]:
    """Template-based fallback when LLM is not available."""
    templates = [
        {"scene": "微距特写镜头，暖色调，光线柔和，强调食材质感", "voice": "让我们来了解{}。科学研究表明，它对健康有着显著的益处。"},
        {"scene": "3D动画演示，展示营养成分和功效机制，科技感", "voice": "{}含有丰富的营养成分，能够有效改善身体机能。"},
        {"scene": "自然场景，真实生活中的使用画面，阳光温暖", "voice": "每天适量摄入{}，你会感受到身体的变化。"},
        {"scene": "对比画面，展示使用前后效果，色调明亮", "voice": "选择优质的{}产品，为健康保驾护航。"},
        {"scene": "产品特写，展示包装和成分标签，专业感", "voice": "{}已经获得越来越多消费者的认可和信赖。"},
        {"scene": "人物镜头，微笑展示产品使用，亲切自然", "voice": "养成好习惯，让{}成为你生活中的一部分。"},
        {"scene": "慢镜头，食材放入水中的瞬间，透明清澈", "voice": "{}的独特之处在于它的高纯度和易吸收特性。"},
        {"scene": "俯瞰镜头，餐桌上健康食材的摆放，构图精美", "voice": "合理的饮食搭配{}，是最佳的养生之道。"},
        {"scene": "实验室场景，科研人员研究，白蓝色调", "voice": "多年的研究证实{}对维持人体平衡至关重要。"},
        {"scene": "户外自然光线，健康生活方式展示，活力感", "voice": "从今天开始，让{}帮助你迈向更健康的生活。"},
    ]
    shots = []
    for i in range(count):
        t = templates[i % len(templates)]
        shots.append({
            "scene_prompt": t["scene"].format(topic),
            "voice_script": t["voice"].format(topic),
            "duration": duration,
        })
    return shots
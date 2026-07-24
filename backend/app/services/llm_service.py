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

SYSTEM_PROMPT = """你是一个资深短视频策划导演，专精食品、健康、养生赛道。将用户给定的主题拆解为专业分镜脚本。

## 硬性约束

1. **仅输出纯净 JSON 数组**。禁止 Markdown 代码块（```json），禁止 JSON 前后加任何解释文字。
2. **总镜头数 = 用户指定的 shot_count**。不多不少。
3. **大健康合规红线**：禁用词 —— 治疗、根治、纯天然、100%有效、最好、最强、第一、唯一、立即见效。功效表述必须用：有助于、支持、维护、帮助、辅助、促进。

## 叙事结构（AIDA）

| 镜头 | 阶段 | 核心任务 | 关键要求 |
|------|------|---------|---------|
| 镜1 | Attention 钩子 | 焦虑/好奇/反差 | **提问句或反常识陈述**，绝不出场产品名，大特写+冲击力 |
| 镜2 | Interest 兴趣 | 科学证据 | **必须含具体数字或对比**（200亿、0蔗糖、提升30%），动画/数据可视化 |
| 镜3~N-1 | Desire 欲望 | 使用场景+感官 | **必须含味觉/嗅觉/视觉通感**（酸甜带气、顺滑绵密、光泽流动），暖调生活化 |
| 最后1镜 | Action 行动 | 信任+指令 | 微笑定格，**明确行动指引**（左下角试试/点击了解/搜索xxx），亲和力 |

## 画面提示词规范（scene_prompt）

### 格式模板
```
【{时长}秒】{主体+动作→动作链}, {场景环境}, {镜头类型+运动}, {光线色调+风格}, {特殊要求}
```

### 要素清单
- **时长前缀**：每条 scene_prompt 以 `【5秒】` 或 `【10秒】` 开头
- **动作链**：多动作用 `→` 串联，如 `粉末飘落→水中溶解→气泡升腾`
- **镜头**：大特写/微距/中景/全景/俯拍/跟拍 | 固定/推近/平移/升格慢动作
- **光线**：柔光/侧逆光/暖金/冷蓝/科技蓝 | 必须写色调过渡（冷蓝→暖金）
- **风格**：电影感/科技感/美食纪录片/温馨治愈
- **竖屏安全区**：核心主体居中偏下，四边留白给 UI 图标

### 字数公式
每镜 voice_script 字数 ≈ 时长秒数 × 4。3秒≈12字、5秒≈20字、10秒≈40字。

## 配音文案规范（voice_script）

- 自然口语，像朋友聊天，不加 emoji
- 镜1 必须是疑问句或反常识陈述，绝不出场产品名
- 镜2 必须含具体数字
- 最后镜必须含行动指令（试试/点击/搜索）
- 情感起伏：好奇→惊讶→认同→行动

## 食品大健康加分项

食材质感（水珠/光泽/纹理）、科学证据（具体数字/对比/动画）、生活场景（厨房/晨光/笑容）、信任元素（包装/检测/logo）

## 示例

输入：益生菌对肠道健康的好处，3个分镜，每镜5秒

输出：
[
  {
    "scene_prompt": "【5秒】暗调客厅，女性疲惫瘫坐沙发，右手按压微凸腹部，唇边残留火锅红油渍，大特写面部倦容与手部关联，冷蓝侧逆光，背景凌乱餐桌虚化，电影感压抑开场",
    "voice_script": "吃完火锅肚子胀？试试这个。"
  },
  {
    "scene_prompt": "【5秒】微观肠道暗场，荧光蓝益生菌粒子如流星雨撞击油腻黏膜→撞击瞬间炸裂为果蔬光谱涟漪→暖金柔光扩散，右下角弹出'200亿活菌 0蔗糖 0脂肪'，冷蓝转暖金渐变，科技感粒子特效",
    "voice_script": "两百亿活菌加果蔬发酵，零糖零脂没负担。"
  },
  {
    "scene_prompt": "【5秒】晨光厨房，女性撕开袋装倒入玻璃杯，琥珀色液体气泡细密升腾→举杯轻抿闭眼微笑，阳光勾勒侧脸轮廓，暖金主调，背景绿植柔焦虚化，温和治愈收尾",
    "voice_script": "酸甜带气，清爽解腻。左下角试试吧。"
  }
]"""


async def generate_shot_plan(topic: str, shot_count: int, shot_duration: str) -> list[dict]:
    """Call LLM to generate shot plan from topic.

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

            content_text = data["choices"][0]["message"]["content"].strip()
            if content_text.startswith("```"):
                lines_text = content_text.split("\n")
                content_text = "\n".join(lines_text[1:-1] if lines_text[-1].strip().startswith("```") else lines_text[1:])

            shots = json.loads(content_text)

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
"""
LLM 分镜策划服务
参考 MoneyPrinterTurbo: app/services/llm.py
支持 OpenAI / DeepSeek / 通义千问 / 智谱 等兼容接口
"""
import json
import httpx
from pathlib import Path
from ..config import get_setting

LLM_BASE_URLS = {
    "openai": "https://api.openai.com/v1",
    "deepseek": "https://api.deepseek.com/v1",
    "qwen": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "zhipu": "https://open.bigmodel.cn/api/paas/v4",
    "moonshot": "https://api.moonshot.cn/v1",
}

PROMPT_DIR = Path(__file__).parent.parent.parent.parent / "TrendRadar-master" / "config"

def _load_prompt(filename: str, fallback: str) -> str:
    """从配置文件读取提示词，文件不存在时使用硬编码兜底。"""
    p = PROMPT_DIR / filename
    if p.exists():
        return p.read_text(encoding="utf-8-sig").strip()
    return fallback

SYSTEM_PROMPT = _load_prompt(
    "manual_topic_prompt.txt",
    """你是一个资深短视频策划导演，专精食品、健康、养生赛道。将用户给定的主题拆解为专业分镜脚本。

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
)


TOPIC_SHOT_PROMPT = _load_prompt(
    "shot_topic_prompt.txt",
    """你是一个短视频分镜导演。根据给定的选题结构生成分镜脚本。

## 分镜规则
- 镜1（{hook_dur}s）：直接使用黄金3秒文案作为配音，生成对应的画面提示词
- 中间N镜：每个内容要点一个分镜，画面+配音
- 最后一镜（{end_dur}s）：总结收尾 + 情绪引导

## 输出格式
返回 JSON 数组，每个元素包含 scene_prompt 和 voice_script：
[
  {{"scene_prompt": "画面描述...", "voice_script": "配音文案..."}},
  ...
]

## 要求
- scene_prompt 以【Xs】开头标注时长
- 画风：暖色调、生活化、接地气
- 配音：口语化、像朋友聊天"""
)
async def generate_shot_plan_from_topic(
    video_topic: str,
    angle: str,
    hook: str,
    hook_type: str = "",
    content_outline: list = None,
    target_emotion: str = "",
    product_link: str = "",
    total_duration: int = 45,
    competitor_framework: str = "",
) -> list[dict]:
    """从选题结构化数据生成分镜。"""
    import os, json, re
    from openai import AsyncOpenAI

    content_outline = content_outline or []
    outline_count = len(content_outline) if content_outline else 0
    if outline_count == 0:
        outline_count = 3

    shot_count = outline_count + 2  # 开头 + N个要点 + 结尾
    base_dur = max(3, total_duration // shot_count)
    hook_dur = min(base_dur, 5)  # 黄金3秒不超过5秒
    end_dur = base_dur
    mid_dur = (total_duration - hook_dur - end_dur) // outline_count if outline_count > 0 else base_dur

    prompt = TOPIC_SHOT_PROMPT.format(hook_dur=hook_dur, end_dur=end_dur)

    outline_text = "\n".join(f"{i+1}. {o}" for i, o in enumerate(content_outline)) if content_outline else "无"

    user_content = f"""视频选题：{video_topic}
切入角度：{angle}
黄金3秒：{hook}
钩子类型：{hook_type}
目标情绪：{target_emotion}
产品关联：{product_link}
总时长：{total_duration}s

内容要点：
{outline_text}

分镜规划：共{shot_count}镜，镜1({hook_dur}s)+中间{outline_count}镜(各{mid_dur}s)+结尾({end_dur}s)
"""

    if competitor_framework:
        try:
            fw = json.loads(competitor_framework) if isinstance(competitor_framework, str) else competitor_framework
            shots_ref = fw.get("shots", [])
            if shots_ref:
                ref_text = "\n".join(f"  - 镜{s.get("index", "?")}（{s.get("duration", "?")}s {s.get("type", "")}）：{s.get("desc", "")} | {s.get("script", "")}" for s in shots_ref)
                user_content += f"""\n\n竞品参考框架（{fw.get("style", "")}）：\n{ref_text}\n\n请参考以上竞品框架的分镜节奏和风格，生成新选题的分镜方案。"""
        except:
            pass

    api_key = await get_setting("llm_api_key")
    if not api_key:
        return _fallback_topic_shots(hook, content_outline, hook_dur, mid_dur, end_dur)

    model = (await get_setting("llm_model")) or "qwen-plus"
    base_url = (await get_setting("llm_base_url")) or "https://dashscope.aliyuncs.com/compatible-mode/v1"

    client = AsyncOpenAI(api_key=api_key, base_url=base_url)

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": user_content},
            ],
            temperature=0.7,
            max_tokens=2000,
        )
        content = response.choices[0].message.content
        json_match = re.search(r'\[[\s\S]*\]', content)
        if json_match:
            shots = json.loads(json_match.group())
            for i, s in enumerate(shots):
                if i == 0:
                    s["duration"] = str(hook_dur)
                elif i == len(shots) - 1:
                    s["duration"] = str(end_dur)
                else:
                    s["duration"] = str(mid_dur)
            return shots
    except Exception as e:
        pass

    return _fallback_topic_shots(hook, content_outline, hook_dur, mid_dur, end_dur)


def _fallback_topic_shots(hook, outline, hook_dur, mid_dur, end_dur):
    """LLM 不可用时的降级模板。"""
    shots = []
    # 镜1：黄金3秒
    shots.append({
        "scene_prompt": f"【{hook_dur}s】主持人正面中景，真诚注视镜头，暖色自然光，背景虚化居家环境",
        "voice_script": hook,
        "duration": str(hook_dur),
    })
    # 中间镜
    for i, point in enumerate(outline or []):
        shots.append({
            "scene_prompt": f"【{mid_dur}s】要点{i+1}相关画面，字幕叠加关键词，暖色调，生活化场景",
            "voice_script": point,
            "duration": str(mid_dur),
        })
    # 结尾
    shots.append({
        "scene_prompt": f"【{end_dur}s】主持人微笑中景回归，暖光渐亮，字幕弹出关注引导",
        "voice_script": "关注我，每天一个健康小知识。",
        "duration": str(end_dur),
    })
    return shots


def _get_setting(key: str, default: str = "") -> str:
    """从 settings 表同步读取配置。"""
    try:
        import asyncio
        from ..database import async_session
        from ..models.models import Setting
        from sqlalchemy import select as _select

        async def _get():
            async with async_session() as db:
                r = await db.execute(_select(Setting).where(Setting.key == key))
                s = r.scalar_one_or_none()
                return s.value if s else default

        try:
            loop = asyncio.get_running_loop()
            return loop.run_until_complete(asyncio.ensure_future(_get()))
        except RuntimeError:
            return asyncio.run(_get())
    except Exception:
        return default

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

ANALYSIS_PROMPT_FILE = "competitor_analysis_prompt.txt"

async def analyze_competitor(source_text: str) -> dict:
    import json, re
    from openai import AsyncOpenAI

    prompt = _load_prompt(ANALYSIS_PROMPT_FILE, "你是短视频拆解分析师，输出结构化JSON。")

    api_key = await get_setting("llm_api_key")
    if not api_key:
        return {"error": "未配置 LLM API Key"}

    model = (await get_setting("llm_model")) or "qwen-plus"
    base_url = (await get_setting("llm_base_url")) or "https://dashscope.aliyuncs.com/compatible-mode/v1"

    client = AsyncOpenAI(api_key=api_key, base_url=base_url)

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": "请拆解以下竞品视频，输出结构化分镜框架 JSON：\n\n" + source_text},
            ],
            temperature=0.5,
            max_tokens=2000,
        )
        result = response.choices[0].message.content
        json_match = re.search(r'\{[\s\S]*\}', result)
        if json_match:
            return json.loads(json_match.group())
        return {"error": "LLM 未返回有效 JSON", "raw": result}
    except Exception as e:
        return {"error": str(e)}

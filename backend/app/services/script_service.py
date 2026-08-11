"""
Script-First 流水线服务
替代旧"时长分配+字数校验+扩展/截断"流程，先写旁白再TTS拿真实时长。

核心流程：
1. create_outline       — 自由文本 → 结构化 outline（无选题时）
2. generate_narration   — outline + 模板(可选) → 4段自然旁白
3. synthesize_tts       — 旁白 → mp3 + ffprobe真实时长
4. generate_scenes      — 旁白+真实时长+模板(可选) → 分镜提示词
5. script_generate      — 一键全流程（选题或自由文本 → 完整分镜+音频）
"""

import json
import re
import uuid
import asyncio
import subprocess
from pathlib import Path
from openai import AsyncOpenAI

from ..config import get_setting, UPLOAD_DIR

PROMPT_DIR = Path(__file__).parent.parent / "prompts"


def _load_prompt(filename: str) -> str:
    p = PROMPT_DIR / filename
    if p.exists():
        return p.read_text(encoding="utf-8-sig").strip()
    return ""


def _probe_duration(file_path: str) -> float:
    """ffprobe 获取音频真实时长（秒）。失败返回 0。"""
    try:
        probe = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", file_path],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=10,
        )
        if probe.returncode == 0:
            info = json.loads(probe.stdout)
            return float(info.get("format", {}).get("duration", 0))
    except Exception:
        pass
    return 0.0


async def _call_llm(system_prompt: str, user_message: str, temperature: float = 0.7, max_tokens: int = 4000) -> str:
    """通用 LLM 调用，返回原始文本。"""
    api_key = await get_setting("llm_api_key")
    if not api_key:
        raise RuntimeError("未配置 LLM API Key")

    model = (await get_setting("llm_model")) or "qwen-plus"
    base_url = (await get_setting("llm_base_url")) or "https://dashscope.aliyuncs.com/compatible-mode/v1"

    client = AsyncOpenAI(api_key=api_key, base_url=base_url)

    response = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        temperature=temperature,
        max_tokens=max_tokens,
    )
    content = response.choices[0].message.content.strip()
    return content


def _extract_json(text: str):
    """从 LLM 返回文本中提取 JSON 对象/数组。"""
    text = text.strip()
    # 去掉 markdown 代码块
    if text.startswith("`"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1] if lines[-1].strip().startswith("`") else lines[1:])
    # 查找最外层 JSON
    if text.startswith("{"):
        match = re.search(r"\{[\s\S]*\}", text)
    elif text.startswith("["):
        match = re.search(r"\[[\s\S]*\]", text)
    else:
        match = re.search(r"[\{\[][\s\S]*[\}\]]", text)
    if match:
        return json.loads(match.group())
    return None


# ═══════════════════════════════════════════
# Step 0: 自由文本 → outline
# ═══════════════════════════════════════════

async def create_outline(free_text: str, competitor_framework: str = "") -> dict:
    """无选题时，从自由文本生成结构化 outline。"""
    prompt = _load_prompt("topic_outline_creation_prompt.txt")
    if not prompt:
        raise RuntimeError("topic_outline_creation_prompt.txt 缺失")

    user_message = f"用户输入：{free_text}"
    if competitor_framework:
        user_message += f"\n\n【竞品参考框架】\n{competitor_framework}\n\n请参考以上框架的风格基调，生成选题 outline。"

    raw = await _call_llm(prompt, user_message)
    result = _extract_json(raw)
    if not result:
        raise RuntimeError(f"LLM 未返回有效 outline JSON: {raw[:200]}")
    return result


# ═══════════════════════════════════════════
# Step 1: outline → 旁白
# ═══════════════════════════════════════════

def _format_outline_for_narration(outline: list) -> str:
    """将 content_outline 格式化为旁白 prompt 可读文本（含产品植入）。"""
    lines = []
    for i, item in enumerate(outline):
        if isinstance(item, str):
            lines.append(f"镜{i+1}: {item}")
        elif isinstance(item, dict):
            stage = item.get("stage", f"镜{i+1}")
            point = item.get("point", "")
            parts = [f"{stage}: {point}"]
            # Include product_moment if present
            pm = item.get("product_moment", "")
            if pm:
                parts.append(f"  产品植入: {pm}")
            # Include emotion for tone guidance
            em = item.get("emotion", "")
            if em:
                parts.append(f"  情绪: {em}")
            lines.append("\n".join(parts))
    return "\n".join(lines)


async def generate_narration(outline: list, competitor_framework: str = "", total_duration: int = 60, golden_hook: str = "") -> list[dict]:
    """从 outline 生成 4 段自然旁白（带字数约束）。"""
    prompt = _load_prompt("narration_prompt.txt")
    if not prompt:
        raise RuntimeError("narration_prompt.txt 缺失")

    # 中文 TTS 约 4 字/秒，按比例分配字数
    hook_chars = max(20, int(total_duration * 0.25 * 4))
    evidence_chars = max(30, int(total_duration * 0.33 * 4))
    scene_chars = max(30, int(total_duration * 0.30 * 4))
    cta_chars = max(15, total_duration * 4 - hook_chars - evidence_chars - scene_chars)

    outline_text = _format_outline_for_narration(outline)
    user_message = f"选题大纲：\n{outline_text}\n\n目标总时长：{total_duration}s（约{total_duration * 4}字）\n每镜目标字数：hook({hook_chars}字) / evidence({evidence_chars}字) / scene({scene_chars}字) / cta({cta_chars}字)"
    if golden_hook:
        user_message += f"\n\n黄金钩子：{golden_hook}\n（请在 hook 段旁白中直接复述这句钩子）"
    if competitor_framework:
        user_message += f"\n\n【竞品参考框架（风格/语感对齐）】\n{competitor_framework}"

    raw = await _call_llm(prompt, user_message)
    result = _extract_json(raw)
    if not result or not isinstance(result, list):
        raise RuntimeError(f"LLM 未返回有效旁白 JSON 数组: {raw[:200]}")
    return result


# ═══════════════════════════════════════════
# Step 2: 旁白 → TTS + 真实时长
# ═══════════════════════════════════════════

async def _synthesize_single(text: str, voice_id: str, idx: int) -> dict:
    """合成单段旁白为 mp3，返回 {index, audio_path, duration}。"""
    audio_dir = UPLOAD_DIR / "audio"
    audio_dir.mkdir(exist_ok=True)
    output_path = str(audio_dir / f"script_tts_{uuid.uuid4().hex}.mp3")

    from .tts_service import generate_voice as tts_generate
    result_path = await tts_generate(text, voice_id, output_path)

    if result_path:
        duration = _probe_duration(result_path)
        # Convert absolute path to relative (from uploads dir)
        try:
            rel = str(Path(result_path).relative_to(UPLOAD_DIR))
            result_path = "/uploads/" + rel.replace("\\", "/")
        except ValueError:
            pass
    else:
        # Fallback: estimate 4 chars/s
        duration = len(text) / 4.0
        result_path = ""

    return {
        "index": idx,
        "audio_path": result_path,
        "duration": round(duration, 1),
        "text": text,
    }


async def synthesize_tts(narrations: list[dict], voice_id: str = None) -> list[dict]:
    """4 段旁白并行 TTS 合成，返回每段的 mp3 路径和真实时长。"""
    if not voice_id:
        voice_id = await get_setting("tts_voice") or "longanhuan_v3.6"

    tasks = []
    for i, item in enumerate(narrations):
        text = item.get("voice_script", "")
        if text:
            tasks.append(_synthesize_single(text, voice_id, i))

    results = await asyncio.gather(*tasks)
    # 按 index 排序
    results.sort(key=lambda x: x["index"])
    return results


# ═══════════════════════════════════════════
# Step 3: 旁白 + 真实时长 → 分镜
# ═══════════════════════════════════════════

async def generate_scenes(
    outline: list,
    narrations: list[dict],
    durations: list[float],
    competitor_framework: str = "",
) -> list[dict]:
    """基于旁白文本和真实 TTS 时长，生成每镜的画面提示词。"""
    prompt = _load_prompt("scene_prompt.txt")
    if not prompt:
        raise RuntimeError("scene_prompt.txt 缺失")

    # 构建 voice_script 列表
    voice_lines = []
    for n in narrations:
        voice_lines.append(n.get("voice_script", ""))

    # 构建时长列表
    dur_lines = ", ".join(f"{d:.1f}s" for d in durations)

    # 构建 outline 可读文本
    outline_text = _format_outline_for_narration(outline)

    user_message = f"""选题大纲：
{outline_text}

配音文案：
{json.dumps(voice_lines, ensure_ascii=False)}

每镜时长: [{dur_lines}]"""

    if competitor_framework:
        user_message += f"\n\n【竞品参考框架（画面风格/镜头节奏对齐）】\n{competitor_framework}"

    raw = await _call_llm(prompt, user_message, temperature=0.5)
    result = _extract_json(raw)
    if not result or not isinstance(result, list):
        raise RuntimeError(f"LLM 未返回有效分镜 JSON 数组: {raw[:200]}")
    return result


# ═══════════════════════════════════════════
# 一键全流程
# ═══════════════════════════════════════════

async def script_generate(
    free_text: str = "",
    topic_data: dict = None,
    competitor_framework: str = "",
    voice_id: str = None,
    total_duration: int = 60,
) -> dict:
    """
    一键 Script-First 全流程。

    支持两种输入方式：
    - free_text: 无选题时的自由文本输入
    - topic_data: 有选题时的结构化数据（需含 content_outline）

    返回完整结果：outline + narrations + tts_results + scenes
    """
    # Step 0: 确保有 outline
    if topic_data and topic_data.get("content_outline"):
        outline_list = topic_data["content_outline"]
    elif free_text:
        full_outline = await create_outline(free_text, competitor_framework)
        outline_list = full_outline.get("content_outline", [])
        topic_data = full_outline  # 后续步骤可能用到其他字段
    else:
        raise ValueError("请提供 free_text 或带 content_outline 的 topic_data")

    if not outline_list:
        raise ValueError("content_outline 为空，无法继续")

    # Step 1: 生成旁白
    golden_hook = topic_data.get("hook", "") if topic_data else ""
    narrations = await generate_narration(outline_list, competitor_framework, total_duration, golden_hook)

    # Step 2: TTS 合成
    tts_results = await synthesize_tts(narrations, voice_id)
    durations = [r["duration"] for r in tts_results]

    # Step 3: 生成分镜
    scenes = await generate_scenes(outline_list, narrations, durations, competitor_framework)

    # 拼合完整结果
    shots = []
    for i in range(len(narrations)):
        shot = {
            "index": i,
            "stage": narrations[i].get("stage", ""),
            "voice_script": narrations[i].get("voice_script", ""),
            "scene_prompt": scenes[i].get("scene_prompt", "") if i < len(scenes) else "",
            "audio_path": tts_results[i].get("audio_path", ""),
            "duration": tts_results[i].get("duration", 0),
        }
        shots.append(shot)

    return {
        "outline": topic_data,
        "narrations": narrations,
        "tts_results": tts_results,
        "scenes": scenes,
        "shots": shots,
        "total_duration": round(sum(durations), 1),
    }

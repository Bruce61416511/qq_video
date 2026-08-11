"""
科普创作服务：剧本 → TTS → 分镜提示词 → 视频
完全独立，不与产品创作共享代码。
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
    return p.read_text(encoding="utf-8-sig").strip() if p.exists() else ""


async def _call_llm(system_prompt: str, user_message: str, temperature: float = 0.7, max_tokens: int = 4000) -> str:
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
    return response.choices[0].message.content.strip()


def _extract_json(text: str):
    text = text.strip()
    if text.startswith("`"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1] if lines[-1].strip().startswith("`") else lines[1:])
    if text.startswith("{"):
        match = re.search(r"\{[\s\S]*\}", text)
    elif text.startswith("["):
        match = re.search(r"\[[\s\S]*\]", text)
    else:
        match = re.search(r"[\{\[][\s\S]*[\}\]]", text)
    return json.loads(match.group()) if match else None


def _probe_duration(file_path: str) -> float:
    try:
        probe = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", file_path],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=10,
        )
        if probe.returncode == 0:
            return float(json.loads(probe.stdout).get("format", {}).get("duration", 0))
    except Exception:
        pass
    return 0.0


# ══════════════════════════════════
# Step 1: 话题 → 剧本
# ══════════════════════════════════

async def generate_script(topic: str, shot_count: int = 3) -> dict:
    """输入话题和分镜数，返回 {hook, body, ending}。"""
    prompt = _load_prompt("kepu_script_prompt.txt")
    if not prompt:
        raise RuntimeError("kepu_script_prompt.txt 缺失")

    user_message = f"话题：{topic}\n正文分镜数：{shot_count}"
    raw = await _call_llm(prompt, user_message)
    result = _extract_json(raw)
    if not result or "hook" not in result or "body" not in result:
        raise RuntimeError(f"LLM 未返回有效剧本 JSON: {raw[:200]}")
    return result


# ══════════════════════════════════
# Step 2: 剧本 → TTS
# ══════════════════════════════════

def _build_narrations(script: dict) -> list[dict]:
    """将剧本转为旁白数组：[hook, body[0], body[1], ..., ending]"""
    narrations = [{"voice_script": script["hook"], "stage": "hook"}]
    for body_text in script["body"]:
        narrations.append({"voice_script": body_text, "stage": "body"})
    narrations.append({"voice_script": script["ending"], "stage": "ending"})
    return narrations


async def _synthesize_single(text: str, voice_id: str, idx: int) -> dict:
    audio_dir = UPLOAD_DIR / "audio"
    audio_dir.mkdir(exist_ok=True)
    output_path = str(audio_dir / f"kepu_tts_{uuid.uuid4().hex}.mp3")

    from .tts_service import generate_voice as tts_generate
    result_path = await tts_generate(text, voice_id, output_path)

    if result_path:
        duration = _probe_duration(result_path)
        try:
            rel = str(Path(result_path).relative_to(UPLOAD_DIR))
            result_path = "/uploads/" + rel.replace("\\", "/")
        except ValueError:
            pass
    else:
        duration = len(text) / 4.0
        result_path = ""

    return {"index": idx, "audio_path": result_path, "duration": round(duration, 1), "text": text}


async def synthesize_tts(narrations: list[dict], voice_id: str = None) -> list[dict]:
    if not voice_id:
        voice_id = await get_setting("tts_voice") or "longanhuan_v3.6"

    tasks = [_synthesize_single(n["voice_script"], voice_id, i) for i, n in enumerate(narrations)]
    results = await asyncio.gather(*tasks)
    results.sort(key=lambda x: x["index"])
    return results


# ══════════════════════════════════
# Step 3: 旁白 + 时长 → 分镜提示词
# ══════════════════════════════════

async def generate_scenes(narrations: list[dict], durations: list[float]) -> list[dict]:
    prompt = _load_prompt("kepu_scene_prompt.txt")
    if not prompt:
        raise RuntimeError("kepu_scene_prompt.txt 缺失")

    voice_lines = [n["voice_script"] for n in narrations]
    dur_lines = ", ".join(f"{d:.1f}s" for d in durations)

    user_message = f"配音文案：\n{json.dumps(voice_lines, ensure_ascii=False)}\n\n每镜时长: [{dur_lines}]"
    raw = await _call_llm(prompt, user_message, temperature=0.5)
    result = _extract_json(raw)
    if not result or not isinstance(result, list):
        raise RuntimeError(f"LLM 未返回有效分镜 JSON 数组: {raw[:200]}")
    return result
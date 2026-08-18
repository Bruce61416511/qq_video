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

    # Strip self-count annotations like 【58字】
    def _clean(text: str) -> str:
        return re.sub(r"[【]?\d+字[】]?", "", text).strip()
    result["hook"] = _clean(result["hook"])
    result["body"] = [_clean(b) for b in result.get("body", [])]
    result["ending"] = _clean(result.get("ending", ""))
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
    return result# ══════════════════════════════════
# Step 4: 分镜提示词 → AI 视频片段
# ══════════════════════════════════

async def generate_kepu_clips(
    scenes: list[dict],
    durations: list[float],
    size: str = "9:16",
    resolution: str = "1080P",
) -> list[dict]:
    """为每个分镜调用 AI 视频生成服务，返回 [{"video_path": ..., "prompt": ...}, ...]"""
    from .video_gen_service import generate_video_clip
    import time

    clips = []
    for i, scene in enumerate(scenes):
        scene_prompt = scene.get("scene_prompt", "")
        if not scene_prompt:
            clips.append({"video_path": "", "prompt": "", "error": "empty prompt"})
            continue
        # 合并多行 scene_prompt 为单行
        prompt = scene_prompt.replace("\n", "，").strip()
        dur_str = str(max(5, min(15, int(durations[i] if i < len(durations) else 5))))
        print(f"[Kepu] Generating clip {i+1}/{len(scenes)}, duration={dur_str}s")
        result = await generate_video_clip(prompt, duration=dur_str, size=size, resolution=resolution)
        if isinstance(result, dict):
            clips.append({
                "index": i,
                "video_path": result.get("url", ""),
                "prompt": prompt,
                "status": result.get("status", "error"),
                "message": result.get("message", ""),
            })
        else:
            clips.append({"index": i, "video_path": str(result), "prompt": prompt, "status": "done"})
        # 避免并发过高，间隔一下
        time.sleep(0.5)
    return clips


# ══════════════════════════════════
# Step 5: 全流程编排
# ══════════════════════════════════

async def run_kepu_pipeline(
    topic: str,
    shot_count: int = 3,
    voice_id: str = None,
    size: str = "9:16",
    resolution: str = "1080P",
) -> dict:
    """科普视频一键全流程：话题 → 剧本 → TTS → 分镜 → 视频片段 → 合成"""
    import uuid

    # Step 1: 剧本
    print(f"[Kepu] Step 1/5: 生成剧本, topic={topic[:30]}...")
    script = await generate_script(topic, shot_count)

    # Step 2: 构建旁白数组 + TTS
    print(f"[Kepu] Step 2/5: TTS 合成...")
    narrations = [{"voice_script": script["hook"], "stage": "hook"}]
    for body_text in script["body"]:
        narrations.append({"voice_script": body_text, "stage": "body"})
    narrations.append({"voice_script": script["ending"], "stage": "ending"})

    tts_results = await synthesize_tts(narrations, voice_id)
    durations = [r["duration"] for r in tts_results]

    # Step 3: 分镜提示词
    print(f"[Kepu] Step 3/5: 生成分镜提示词, {len(narrations)} 镜...")
    scenes = await generate_scenes(narrations, durations)

    # Step 4: AI 视频片段
    print(f"[Kepu] Step 4/5: AI 视频生成...")
    clips = await generate_kepu_clips(scenes, durations, size=size, resolution=resolution)

    # 构建视频+音频素材列表
    from pathlib import Path
    composed_clips = []
    for i in range(len(narrations)):
        audio_path = ""
        audio_rel = tts_results[i].get("audio_path", "") if i < len(tts_results) else ""
        if audio_rel:
            # tts_results 里的 audio_path 已经是 /uploads/audio/xxx.mp3 格式
            from ..config import UPLOAD_DIR
            full_audio = UPLOAD_DIR.parent / audio_rel.lstrip("/")
            if full_audio.exists():
                audio_path = str(full_audio)
        clip_info = clips[i] if i < len(clips) else {}
        composed_clips.append({
            "video_path": clip_info.get("video_path", ""),
            "audio_path": audio_path,
            "subtitle": narrations[i].get("voice_script", ""),
            "duration": durations[i] if i < len(durations) else 5,
        })

    # Step 5: 合成
    print(f"[Kepu] Step 5/5: 视频合成...")
    from .video_composer import compose_video
    output_path = str(UPLOAD_DIR / f"kepu_{uuid.uuid4().hex}.mp4")
    comp_result = await compose_video(composed_clips, output_path, size=size, resolution=resolution)

    return {
        "script": script,
        "scenes": scenes,
        "narrations": narrations,
        "tts_segments": tts_results,
        "clips": clips,
        "compose": comp_result,
        "video_path": comp_result.get("path", ""),
    }


# ══════════════════════════════════
# 事实核查：标注脚本中可验证/推测/不准确的内容
# ══════════════════════════════════

async def verify_script(script: dict) -> dict:
    """对生成的剧本逐句标注准确性，返回 {hook, body[], ending} 每段附标注"""
    verify_prompt = '''你是科普内容事实核查员。对以下短视频脚本，逐句标注准确性。

标注标签（三选一）：
- [可验证]：该陈述有公认的科学依据，可在教科书中找到
- [推测]：可能是对的，但表述过于精确或存在学术争议
- [不准确]：该陈述明显有误或不符合主流科学共识

输出纯 JSON：
{
  "hook": {"text": "...", "label": "可验证", "note": "简短说明"},
  "body": [
    {"text": "...", "label": "推测", "note": "简短说明"},
    ...
  ],
  "ending": {"text": "...", "label": "可验证", "note": "简短说明"}
}

判断标准：
- 涉及微生物代谢顺序、精确数字（如180天、300种风味）→ 如无法确认，标[推测]
- 涉及年份/史实（如三千年前周朝）→ 如无法确认，标[推测]
- 基本科学常识（如蛋白质分解为氨基酸）→ [可验证]
- 明确错误的因果关系 → [不准确]
'''

    import json as _json
    # Build script text
    script_text = f"hook: {script['hook']}\n\n"
    for i, b in enumerate(script['body']):
        script_text += f"body{i+1}: {b}\n"
    script_text += f"\nending: {script['ending']}"

    raw = await _call_llm(verify_prompt, script_text, temperature=0.1, max_tokens=2000)
    result = _extract_json(raw)
    if not result:
        raise RuntimeError(f"事实核查 LLM 未返回有效 JSON: {raw[:200]}")
    return result


# ════════════════════════════════════════
# 新增：两步式剧本生成
# ════════════════════════════════════════

async def generate_full_script(topic: str, total_duration: int = 60) -> str:
    """话题 + 总时长 → 连续旁白文稿（纯文本，不分镜）"""
    prompt = _load_prompt("kepu_full_script_prompt.txt")
    if not prompt:
        raise RuntimeError("kepu_full_script_prompt.txt 缺失")

    user_message = f"话题：{topic}\n视频总时长：{total_duration}秒（参考字数约{total_duration * 4}字，每秒4字）"
    raw = await _call_llm(prompt, user_message, temperature=0.75, max_tokens=3000)
    if not raw or len(raw.strip()) < 30:
        raise RuntimeError("LLM 未生成有效剧本")
    return raw.strip()


async def split_full_script(full_text: str, reference_duration: int = None) -> dict:
    """连续文稿 → 由模型按内容自主拆分为 {hook, body, ending}"""
    prompt = _load_prompt("kepu_split_script_prompt.txt")
    if not prompt:
        raise RuntimeError("kepu_split_script_prompt.txt 缺失")

    ref_note = f"参考总时长：{reference_duration}秒（仅作节奏参考，不要据此硬算镜头数）\n\n" if reference_duration else ""
    user_message = f"{ref_note}连续文稿：\n{full_text}"
    raw = await _call_llm(prompt, user_message, temperature=0.3, max_tokens=2000)
    result = _extract_json(raw)
    if not result or "hook" not in result or "body" not in result:
        raise RuntimeError(f"LLM 未返回有效分镜 JSON: {raw[:200]}")

    def _clean(text: str) -> str:
        return re.sub(r"[（\(]?\d+字[）\)]?", "", text).strip()
    result["hook"] = _clean(result["hook"])
    result["body"] = [_clean(b) for b in result.get("body", [])]
    result["ending"] = _clean(result.get("ending", ""))
    return result


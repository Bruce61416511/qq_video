"""科普创作路由：剧本 / TTS / 分镜提示词 / 视频生成"""

from fastapi import APIRouter, Body, HTTPException
from ..services.kepu_service import generate_script, synthesize_tts, generate_scenes

router = APIRouter(prefix="/api/kepu", tags=["科普创作"])


@router.post("/script")
async def create_script(data: dict = Body(...)):
    """话题 → 剧本 (hook + body + ending)"""
    topic = data.get("topic", "").strip()
    shot_count = int(data.get("shot_count", 3))
    if not topic:
        raise HTTPException(400, "topic 参数不能为空")
    try:
        script = await generate_script(topic, shot_count)
        return {"script": script}
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/tts")
async def script_tts(data: dict = Body(...)):
    """旁白数组 → TTS mp3 + 真实时长"""
    narrations = data.get("narrations", [])
    voice_id = data.get("voice", None)
    if not narrations:
        raise HTTPException(400, "narrations 参数不能为空")
    try:
        results = await synthesize_tts(narrations, voice_id)
        return {"segments": results, "total_duration": round(sum(r["duration"] for r in results), 1)}
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/scenes")
async def script_scenes(data: dict = Body(...)):
    """旁白 + TTS时长 → 分镜提示词"""
    narrations = data.get("narrations", [])
    durations = data.get("durations", [])
    if not narrations or not durations:
        raise HTTPException(400, "narrations / durations 参数不能为空")
    try:
        scenes = await generate_scenes(narrations, durations)
        return {"scenes": scenes}
    except Exception as e:
        raise HTTPException(500, str(e))

@router.get("/prompts")
async def get_prompts():
    """Get kepu prompt content"""
    from pathlib import Path
    prompt_dir = Path(__file__).parent.parent / "prompts"
    result = {}
    for name in ["kepu_script_prompt.txt", "kepu_scene_prompt.txt"]:
        p = prompt_dir / name
        if p.exists():
            result[name] = p.read_text(encoding="utf-8-sig").strip()
        else:
            result[name] = ""
    return {"prompts": result}


@router.post("/prompts")
async def save_prompts(data: dict = Body(...)):
    """Save kepu prompt content"""
    from pathlib import Path
    prompt_dir = Path(__file__).parent.parent / "prompts"
    prompts = data.get("prompts", {})
    for name, text in prompts.items():
        p = prompt_dir / name
        p.write_text(text, encoding="utf-8")
    return {"status": "ok"}


@router.post("/generate")
async def kepu_generate(data: dict = Body(...)):
    """科普视频一键生成：话题 → 完整视频"""
    topic = data.get("topic", "").strip()
    shot_count = int(data.get("shot_count", 3))
    voice_id = data.get("voice", None)
    size = data.get("size", "9:16")
    resolution = data.get("resolution", "1080P")

    if not topic:
        raise HTTPException(400, "topic 参数不能为空")

    try:
        from ..services.kepu_service import run_kepu_pipeline
        result = await run_kepu_pipeline(
            topic=topic,
            shot_count=shot_count,
            voice_id=voice_id,
            size=size,
            resolution=resolution,
        )
        return {
            "ok": True,
            "script": result["script"],
            "video_path": result["video_path"],
            "compose": result["compose"],
        }
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/generate-video")
async def kepu_generate_video(data: dict = Body(...)):
    """已有分镜 → AI 视频片段"""
    scenes = data.get("scenes", [])
    durations = data.get("durations", [])
    size = data.get("size", "9:16")
    resolution = data.get("resolution", "1080P")

    if not scenes:
        raise HTTPException(400, "scenes 参数不能为空")

    try:
        from ..services.kepu_service import generate_kepu_clips
        clips = await generate_kepu_clips(scenes, durations, size=size, resolution=resolution)
        return {"ok": True, "clips": clips}
    except Exception as e:
        raise HTTPException(500, str(e))

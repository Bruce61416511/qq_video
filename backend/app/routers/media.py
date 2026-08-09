import os
import uuid
import asyncio
import traceback
from datetime import datetime
from fastapi import APIRouter, Body, Depends, UploadFile, File, HTTPException
from pathlib import Path
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from ..database import get_db, async_session
from ..models import Media, MediaShot, MediaStatus
from ..schemas.schemas import MediaOut, MediaShotOut, VideoGenerateRequest, GenerateShotsRequest, ShotItem
from ..config import UPLOAD_DIR, get_setting

router = APIRouter(prefix="/api/media", tags=["media"])

_bg_tasks: set = set()


@router.get("", response_model=list[MediaOut])
async def list_media(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Media).order_by(Media.created_at.desc()))
    media_list = result.scalars().all()
    changed = False
    for m in media_list:
        if m.status == MediaStatus.ready and not os.path.exists(m.filepath):
            m.status = MediaStatus.failed
            m.duration = "file missing"
            changed = True
    if changed:
        await db.commit()
    return media_list


@router.post("/upload", response_model=MediaOut)
async def upload_video(file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    ext = os.path.splitext(file.filename)[1] or ".mp4"
    filename = f"{uuid.uuid4().hex}{ext}"
    filepath = UPLOAD_DIR / filename
    content = await file.read()
    with open(filepath, "wb") as f:
        f.write(content)
    size_mb = len(content) / (1024 * 1024)
    media = Media(
        name=file.filename,
        filepath=str(filepath),
        size=f"{size_mb:.1f} MB",
        duration="--:--",
        status=MediaStatus.ready,
        source="upload",
    )
    db.add(media)
    await db.commit()
    await db.refresh(media)
    return media


@router.delete("/{media_id}")
async def delete_media(media_id: int, db: AsyncSession = Depends(get_db)):
    m = await db.get(Media, media_id)
    if not m:
        raise HTTPException(404, "media not found")
    if os.path.exists(m.filepath):
        os.remove(m.filepath)
    await db.execute(delete(MediaShot).where(MediaShot.media_id == media_id))
    await db.delete(m)
    await db.commit()
    return {"ok": True}



@router.get("/{media_id}/shots", response_model=list[MediaShotOut])
async def get_shots(media_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(MediaShot).where(MediaShot.media_id == media_id).order_by(MediaShot.shot_index)
    )
    return result.scalars().all()



@router.post("/generate-shots-from-topic")
async def generate_shots_from_topic(data: dict = Body(...)):
    """从选题结构化数据生成分镜方案。"""
    from ..services.llm_service import generate_shot_plan_from_topic, TOPIC_SHOT_PROMPT, build_topic_user_message, _format_outline_text
    shot_count = int(data.get("shot_count", 0))
    shot_duration = int(data.get("shot_duration", 0))
    total_duration = shot_count * shot_duration if shot_count and shot_duration else data.get("duration", 45)
    shots = await generate_shot_plan_from_topic(
        video_topic=data.get("video_topic", ""),
        angle=data.get("angle", ""),
        hook=data.get("hook", ""),
        hook_type=data.get("hook_type", ""),
        content_outline=data.get("content_outline", []),
        target_emotion=data.get("target_emotion", ""),
        product_link=data.get("product_link", ""),
        total_duration=total_duration,
        competitor_framework=data.get("competitor_framework", ""),
    )
    is_fallback = any(s.get("fallback") for s in shots)
    return {"shots": shots, "fallback": is_fallback}


@router.post("/generate-shots-preview")
async def generate_shots_preview(data: dict = Body(...)):
    """Preview the system prompt and user message sent to LLM, without actual call."""
    from ..services.llm_service import TOPIC_SHOT_PROMPT, SYSTEM_PROMPT, build_topic_user_message, _parse_competitor_framework, _format_outline_text
    import json as _json

    video_topic = data.get("video_topic", "")
    angle = data.get("angle", "")
    hook = data.get("hook", "")
    hook_type = data.get("hook_type", "")
    content_outline = data.get("content_outline", [])
    target_emotion = data.get("target_emotion", "")
    product_link = data.get("product_link", "")
    total_duration = data.get("duration", 45)
    competitor_framework = data.get("competitor_framework", "")

    outline_count = len(content_outline) if content_outline else 0
    if outline_count == 0:
        outline_count = 3
    is_structured = content_outline and isinstance(content_outline[0], dict)
    shot_count = outline_count if is_structured else outline_count + 2
    base_dur = max(3, total_duration // shot_count)
    hook_dur = min(base_dur, 5)
    end_dur = base_dur
    mid_dur = (total_duration - hook_dur - end_dur) // outline_count if outline_count > 0 else base_dur

    outline_text = _format_outline_text(content_outline)

    # Manual mode (no hook_type) uses SYSTEM_PROMPT; topic mode uses TOPIC_SHOT_PROMPT
    is_manual = not hook_type
    prompt_template = SYSTEM_PROMPT if is_manual else TOPIC_SHOT_PROMPT
    system_prompt = prompt_template.replace("{hook_dur}", str(hook_dur)).replace("{end_dur}", str(end_dur))

    if is_manual:
        # Manual mode: use frontend shot_count/shot_duration if provided
        _man_shot_count = data.get("shot_count", shot_count)
        _man_shot_dur = data.get("shot_duration", str(int(total_duration/shot_count) if shot_count else 5))
        user_message = f"视频主题：{video_topic}\n分镜数量：{_man_shot_count}个\n每镜时长：{_man_shot_dur}秒"
        if competitor_framework:
            parts = _parse_competitor_framework(competitor_framework)
            if parts:
                framework_text = "\n".join(parts)
                user_message += f"\n\n【竞品参考框架】\n{framework_text}\n\n请参考以上竞品框架的风格基调、分镜节奏、景别递进，生成视频分镜方案。"
    else:
        user_message = build_topic_user_message(
            video_topic=video_topic,
            angle=angle,
            hook=hook,
            hook_type=hook_type,
            content_outline=content_outline,
            target_emotion=target_emotion,
            product_link=product_link,
            total_duration=total_duration,
            hook_dur=hook_dur,
            mid_dur=mid_dur,
            end_dur=end_dur,
            outline_count=outline_count,
            shot_count=shot_count,
            outline_text=outline_text,
            competitor_framework=competitor_framework,
        )

    return {
        "system_prompt": system_prompt,
        "user_message": user_message,
        "model": "from settings",
        "temperature": 0.7,
        "max_tokens": 4000,
    }

@router.post("/generate-shots")
async def generate_shots(data: dict = Body(...)):
    """AI generates shot plan from topic using LLM (with template fallback)."""
    from ..services.llm_service import generate_shot_plan

    topic = data.get("topic", "")
    shot_count = data.get("shot_count", 3)
    shot_duration = data.get("shot_duration", "5")
    competitor_framework = data.get("competitor_framework", "")

    count = max(1, min(int(shot_count), 10))
    dur = str(shot_duration)

    shots = await generate_shot_plan(topic, count, dur, competitor_framework)
    # Ensure duration is set on each shot
    for s in shots:
        if "duration" not in s:
            s["duration"] = dur

    is_fallback = any(s.get("fallback") for s in shots)
    return {"shots": shots, "fallback": is_fallback}


@router.post("/generate", response_model=MediaOut)
async def generate_video(req: VideoGenerateRequest, db: AsyncSession = Depends(get_db)):
    """Create media record and kick off async video generation pipeline."""
    prompt_short = req.prompt[:30] if len(req.prompt) > 30 else req.prompt
    filename = f"ai_{uuid.uuid4().hex}.mp4"
    total_dur = sum(int(s.duration) for s in req.shots) if req.shots else 0

    media = Media(
        name=f"{prompt_short}.mp4",
        filepath=str(UPLOAD_DIR / filename),
        size="-",
        duration=f"{total_dur}s" if total_dur else "-",
        status=MediaStatus.generating,
        source="ai",
        prompt=req.prompt,
        video_size=req.size,
        video_duration=str(total_dur)+'s' if total_dur else '-',
        video_resolution=req.resolution,
    )
    db.add(media)
    await db.commit()
    await db.refresh(media)

    # Save shots
    for i, shot in enumerate(req.shots):
        ms = MediaShot(
            media_id=media.id,
            shot_index=i + 1,
            scene_prompt=shot.scene_prompt,
            voice_script=shot.voice_script,
            duration=shot.duration,
            status="pending",
        )
        db.add(ms)
    await db.commit()

    # Kick off background generation
    task = asyncio.create_task(_run_generation_pipeline(media.id, req))
    _bg_tasks.add(task)
    task.add_done_callback(_bg_tasks.discard)

    return media


async def _run_generation_pipeline(media_id: int, req: VideoGenerateRequest):
    """Background pipeline:
    1. For each shot: generate video clip + generate voice audio
    2. Compose all clips into final video
    3. Update media record
    """
    try:
        await _do_run_pipeline(media_id, req)
    except Exception as e:
        print(f"[Pipeline] FATAL: {traceback.format_exc()}")
        await _update_media(media_id, status=MediaStatus.failed, duration=str(e)[:100])

async def _do_run_pipeline(media_id: int, req: VideoGenerateRequest):
    from ..services.video_gen_service import generate_video_clip
    from ..services.tts_service import generate_voice
    from ..services.video_composer import compose_video

    print(f"[Pipeline] starting for media #{media_id}: {req.prompt[:40]}...")
    clips = []

    for i, shot in enumerate(req.shots):
        shot_index = i + 1
        print(f"[Pipeline] shot {shot_index}/{len(req.shots)}: scene='{shot.scene_prompt[:30]}...'")

        # TTS phase
        await _update_shot_status(media_id, shot_index, "tts")

        # Generate voice audio (do this first, it's fast with edge-tts)
        audio_path = ""
        if shot.voice_script.strip():
            audio_path = await generate_voice(shot.voice_script)

        # Video generation phase
        await _update_shot_status(media_id, shot_index, "video")

        # Clamp shot duration to Wan API limits (5-15s)
        target_dur = int(shot.duration)
        if target_dur > 15:
            print(f"[Pipeline] shot {shot_index}: duration {target_dur}s clamped to 15s (Wan max)")
            target_dur = 15
        elif target_dur < 5:
            print(f"[Pipeline] shot {shot_index}: duration {target_dur}s clamped to 5s (Wan min)")
            target_dur = 5
        shot.duration = str(target_dur)  # update in-memory for consistent duration

        # Generate video clip with progress tracking
        async def update_progress(pct):
            await _update_shot(media_id, shot_index, progress=pct)

        # Video generation with up to 2 retries on failure
        max_retries = 2
        video_result = None
        for retry in range(max_retries + 1):
            if retry > 0:
                print(f"[Pipeline] shot {shot_index}: retry {retry}/{max_retries}")
                await _update_shot_status(media_id, shot_index, "video")
            video_result = await generate_video_clip(
                prompt=shot.scene_prompt,
                duration=str(target_dur),
                size=req.size,
                resolution=req.resolution,
                progress_callback=update_progress if retry == 0 else None,
            )
            if isinstance(video_result, dict) and video_result.get("status") == "done":
                break
            if isinstance(video_result, dict) and video_result.get("status") == "no_api":
                break  # don't retry if no API key configured

        clip = {
            "video_path": "",
            "audio_path": audio_path if audio_path else "",
            "subtitle": shot.voice_script,
            "duration": int(shot.duration),
        }

        if isinstance(video_result, dict):
            if video_result.get("status") == "done" and video_result.get("url"):
                await _update_shot_status(media_id, shot_index, "downloading")
                clip["video_path"] = await _download_video(video_result["url"], media_id, shot_index)
            elif video_result.get("status") == "no_api":
                print(f"[Pipeline] shot {shot_index}: {video_result.get('message')}")
                clip["video_path"] = await _create_placeholder_clip(shot.scene_prompt, shot.duration, req.size)
            else:
                print(f"[Pipeline] shot {shot_index}: failed after {max_retries} retries - {video_result.get('message')}")
                clip["video_path"] = await _create_placeholder_clip(shot.scene_prompt, shot.duration, req.size)
        else:
            clip["video_path"] = str(video_result) if video_result else ""

        clips.append(clip)

        # Update shot status
        status = "done" if clip["video_path"] and os.path.exists(clip["video_path"]) else "failed"
        await _update_shot(media_id, shot_index, status=status, clip_path=clip["video_path"], audio_path=clip["audio_path"])

    # Compose final video (or save individual clips if ffmpeg not available)
    print(f"[Pipeline] composing {len(clips)} clips...")
    valid_clips = [c for c in clips if c.get("video_path") and os.path.exists(c.get("video_path", ""))]

    if valid_clips:
        output_path = str(UPLOAD_DIR / f"ai_{uuid.uuid4().hex}.mp4")
        result = await compose_video(valid_clips, output_path, req.size, req.resolution)

        if result.get("ok"):
            await _update_media(media_id, filepath=result["path"], duration=f"{result['duration']}s", status=MediaStatus.ready)
            print(f"[Pipeline] media #{media_id} done: {result['path']}")
        else:
            # Composition failed (e.g. no ffmpeg) - save individual clips as separate media
            error_msg = result.get("error", "compose failed")
            print(f"[Pipeline] media #{media_id} compose failed: {error_msg}")
            
            if "ffmpeg" in error_msg.lower() or "not found" in error_msg.lower():
                # Save each clip as individual media item
                from ..database import async_session as db_session
                async with db_session() as db:
                    parent = await db.get(Media, media_id)
                    saved_count = 0
                    for i, clip in enumerate(valid_clips):
                        shot = req.shots[i] if i < len(req.shots) else None
                        clip_name = f"镜{i+1}_{parent.name}" if parent else f"镜{i+1}.mp4"
                        clip_media = Media(
                            name=clip_name,
                            filepath=clip["video_path"],
                            size="-",
                            duration=f"{shot.duration}s" if shot else "-",
                            status=MediaStatus.ready,
                            source="ai",
                            prompt=shot.scene_prompt if shot else "",
                            video_size=req.size,
                            video_resolution=req.resolution,
                        )
                        db.add(clip_media)
                        saved_count += 1
                    # Mark parent as partial
                    parent.status = MediaStatus.ready
                    parent.duration = f"{saved_count} clips (ffmpeg unavailable)"
                    await db.commit()
                    print(f"[Pipeline] saved {saved_count} individual clips to media library")
            else:
                await _update_media(media_id, status=MediaStatus.failed, duration=error_msg)
    else:
        await _update_media(media_id, status=MediaStatus.failed, duration="no valid clips")
        print(f"[Pipeline] media #{media_id} failed: no valid clips")


async def _update_shot_status(media_id: int, shot_index: int, status: str):
    """Update a single shot's status."""
    try:
        async with async_session() as db:
            result = await db.execute(
                select(MediaShot).where(
                    MediaShot.media_id == media_id,
                    MediaShot.shot_index == shot_index,
                )
            )
            shot = result.scalar_one_or_none()
            if shot:
                shot.status = status
                await db.commit()
    except Exception as e:
        print(f"[Pipeline] update shot status error: {e}")


async def _update_shot(media_id: int, shot_index: int, status: str = None, clip_path: str = "", audio_path: str = "", progress: int = None):
    """Update a shot's fields."""
    try:
        async with async_session() as db:
            result = await db.execute(
                select(MediaShot).where(
                    MediaShot.media_id == media_id,
                    MediaShot.shot_index == shot_index,
                )
            )
            shot = result.scalar_one_or_none()
            if shot:
                if status:
                    shot.status = status
                if clip_path:
                    shot.clip_path = clip_path
                if audio_path:
                    shot.audio_path = audio_path
                if progress is not None:
                    shot.progress = progress
                await db.commit()
    except Exception as e:
        print(f"[Pipeline] update shot error: {e}")


async def _update_media(media_id: int, **kwargs):
    """Update media record fields."""
    try:
        async with async_session() as db:
            m = await db.get(Media, media_id)
            if m:
                for k, v in kwargs.items():
                    setattr(m, k, v)
                await db.commit()
    except Exception as e:
        print(f"[Pipeline] update media error: {e}")


async def _download_video(url: str, media_id: int, shot_index: int) -> str:
    """Download video from URL to uploads dir."""
    try:
        import httpx
        output_path = str(UPLOAD_DIR / f"clip_{media_id}_{shot_index}_{uuid.uuid4().hex[:8]}.mp4")
        async with httpx.AsyncClient(timeout=300.0) as client:
            resp = await client.get(url)
            if resp.status_code == 200:
                with open(output_path, "wb") as f:
                    f.write(resp.content)
                return output_path
    except Exception as e:
        print(f"[Pipeline] download error: {e}")
    return ""


async def _create_placeholder_clip(prompt: str, duration: str, size: str) -> str:
    """Create a placeholder video clip (black screen with text) using ffmpeg."""
    import platform, re as _re
    try:
        output = str(UPLOAD_DIR / f"placeholder_{uuid.uuid4().hex[:8]}.mp4")
        safe_prompt = _re.sub(r'[^\w\u4e00-\u9fff\u3000-\u303f\uff00-\uffef,;:!?.()（） ]', '', prompt[:80])
        if not safe_prompt.strip():
            safe_prompt = "placeholder"
        size_map = {"9:16": "1080x1920", "16:9": "1920x1080", "1:1": "1080x1080"}
        res = size_map.get(size, "1080x1920")

        font_file = ""
        if platform.system() == "Windows":
            for f in ["C:/Windows/Fonts/simhei.ttf", "C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/arial.ttf"]:
                if os.path.exists(f):
                    font_file = f.replace("\\", "/").replace(":", "\\:")
                    break
        elif platform.system() == "Darwin":
            font_file = "/System/Library/Fonts/PingFang.ttc"
        else:
            for f in ["/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"]:
                if os.path.exists(f):
                    font_file = f
                    break

        ff_font = f"fontfile='{font_file}':" if font_file else ""
        cmd = [
            "ffmpeg", "-y",
            "-f", "lavfi",
            "-i", f"color=color=0x1a1a2e:size={res}:rate=24:duration={duration},{ff_font}drawtext=text='{safe_prompt}':fontcolor=white:fontsize=32:x=(w-text_w)/2:y=(h-text_h)/2",
            "-c:v", "libx264", "-preset", "ultrafast",
            "-movflags", "+faststart",
            output,
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
        if not os.path.exists(output) and stderr:
            print(f"[Pipeline] ffmpeg stderr: {stderr.decode('utf-8', errors='replace')[:300]}")
        if os.path.exists(output):
            return output
    except Exception as e:
        print(f"[Pipeline] placeholder error: {e}")
    return ""


# ====== background shot generation ======

_shot_tasks = {}  # (media_id, shot_index) -> asyncio.Task
_shot_cancel = set()  # set of (media_id, shot_index) to cancel

async def cleanup_stale_shots():
    """On startup, reset shots stuck in running states to pending."""
    from ..models.models import Media, MediaShot
    running_states = ["generating", "video", "tts", "downloading"]
    async with async_session() as db:
        result = await db.execute(
            select(MediaShot).where(MediaShot.status.in_(running_states))
        )
        stale = result.scalars().all()
        for shot in stale:
            shot.status = "pending"
            shot.progress = 0
        if stale:
            await db.commit()
            print(f"[Startup] Reset {len(stale)} stale shots to pending")

        # Also reset media stuck in generating
        result2 = await db.execute(
            select(Media).where(Media.status == MediaStatus.generating)
        )
        stale_media = result2.scalars().all()
        for m in stale_media:
            m.status = MediaStatus.pending
        if stale_media:
            await db.commit()
            print(f"[Startup] Reset {len(stale_media)} stale media to pending")


async def _run_shot_generation(media_id: int, shot_index: int):
    """Background task: generate video + audio for one shot with progress updates."""
    from ..services.video_gen_service import generate_video_clip
    from ..services.tts_service import generate_voice

    async with async_session() as db:
        result = await db.execute(
            select(MediaShot).where(
                MediaShot.media_id == media_id,
                MediaShot.shot_index == shot_index,
            )
        )
        shot = result.scalar_one_or_none()
        if not shot:
            return
        scene_prompt = shot.scene_prompt
        voice_script = shot.voice_script
        duration = shot.duration
        media_result = await db.execute(select(Media).where(Media.id == media_id))
        media = media_result.scalar_one_or_none()
        size = media.video_size if media else "9:16"
        resolution = media.video_resolution if media else "1080P"

    # Step 1: TTS
    if (media_id, shot_index) in _shot_cancel:
        await _update_shot(media_id, shot_index, status="cancelled", progress=0)
        _shot_cancel.discard((media_id, shot_index))
        return
    await _update_shot(media_id, shot_index, status="tts", progress=10)
    audio_path = ""
    if voice_script and voice_script.strip():
        try:
            audio_path = await generate_voice(voice_script)
            if audio_path:
                await _update_shot(media_id, shot_index, audio_path=audio_path, progress=30)
            else:
                print(f"[ShotGen] TTS returned empty for shot {shot_index}")
        except Exception as e:
            print(f"[ShotGen] TTS error for shot {shot_index}: {e}")

    # Step 2: Video generation
    await _update_shot(media_id, shot_index, status="video", progress=35)

    async def _progress_cb(pct: int):
        mapped = 35 + int(pct * 0.5)
        await _update_shot(media_id, shot_index, progress=mapped)

    try:
        video_result = await generate_video_clip(
            prompt=scene_prompt,
            duration=duration,
            size=size,
            resolution=resolution,
            progress_callback=_progress_cb,
        )
    except Exception as e:
        video_result = {"status": "error", "message": str(e)}

    clip_path = ""
    status = "failed"

    if isinstance(video_result, dict):
        result_status = video_result.get("status", "")
        if result_status == "done" and video_result.get("url"):
            await _update_shot(media_id, shot_index, status="downloading", progress=88)
            clip_path = await _download_video(video_result["url"], media_id, shot_index)
            if clip_path and os.path.exists(clip_path):
                status = "done"
            else:
                status = "failed"
                clip_path = f"download_failed: {video_result.get('url', '')[:80]}"
        elif result_status == "no_api":
            clip_path = await _create_placeholder_clip(scene_prompt, duration, size)
            status = "done" if clip_path else "failed"
        else:
            status = "failed"
            err_msg = video_result.get("message", result_status or "unknown")
            clip_path = f"gen_failed: {err_msg[:200]}"
    elif video_result:
        clip_path = str(video_result)
        status = "done" if os.path.exists(clip_path) else "failed"

    await _update_shot(media_id, shot_index, status=status, clip_path=clip_path if status == "done" else clip_path, progress=100 if status == "done" else 0)
    print(f"[ShotGen] shot {media_id}/{shot_index}: status={status} clip={clip_path[:80] if clip_path else 'none'}")


async def _run_shot_video_only(media_id: int, shot_index: int):
    """Background task: generate ONLY video for one shot (skip TTS)."""
    from ..services.video_gen_service import generate_video_clip

    async with async_session() as db:
        result = await db.execute(
            select(MediaShot).where(
                MediaShot.media_id == media_id,
                MediaShot.shot_index == shot_index,
            )
        )
        shot = result.scalar_one_or_none()
        if not shot:
            return
        scene_prompt = shot.scene_prompt
        duration = shot.duration
        media_result = await db.execute(select(Media).where(Media.id == media_id))
        media = media_result.scalar_one_or_none()
        size = media.video_size if media else "9:16"
        resolution = media.video_resolution if media else "1080P"

    if (media_id, shot_index) in _shot_cancel:
        await _update_shot(media_id, shot_index, status="cancelled", progress=0)
        _shot_cancel.discard((media_id, shot_index))
        return
    await _update_shot(media_id, shot_index, status="video", progress=5)

    async def _progress_cb(pct: int):
        mapped = 5 + int(pct * 0.85)
        await _update_shot(media_id, shot_index, progress=mapped)

    try:
        video_result = await generate_video_clip(
            prompt=scene_prompt,
            duration=duration,
            size=size,
            resolution=resolution,
            progress_callback=_progress_cb,
        )
    except Exception as e:
        video_result = {"status": "error", "message": str(e)}

    clip_path = ""
    status = "failed"

    if isinstance(video_result, dict):
        result_status = video_result.get("status", "")
        if result_status == "done" and video_result.get("url"):
            await _update_shot(media_id, shot_index, status="downloading", progress=92)
            clip_path = await _download_video(video_result["url"], media_id, shot_index)
            if clip_path and os.path.exists(clip_path):
                status = "done"
            else:
                status = "failed"
                clip_path = f"download_failed: {video_result.get('url', '')[:80]}"
        elif result_status == "no_api":
            clip_path = await _create_placeholder_clip(scene_prompt, duration, size)
            status = "done" if clip_path else "failed"
        else:
            status = "failed"
            err_msg = video_result.get("message", result_status or "unknown")
            clip_path = f"gen_failed: {err_msg[:200]}"
    elif video_result:
        clip_path = str(video_result)
        status = "done" if os.path.exists(clip_path) else "failed"

    await _update_shot(media_id, shot_index, status=status, clip_path=clip_path if status == "done" else clip_path, progress=100 if status == "done" else 0)
    print(f"[ShotVideo] shot {media_id}/{shot_index}: status={status} clip={clip_path[:80] if clip_path else 'none'}")


async def _run_shot_audio_only(media_id: int, shot_index: int):
    """Background task: generate ONLY audio for one shot (skip video)."""
    from ..services.tts_service import generate_voice

    async with async_session() as db:
        result = await db.execute(
            select(MediaShot).where(
                MediaShot.media_id == media_id,
                MediaShot.shot_index == shot_index,
            )
        )
        shot = result.scalar_one_or_none()
        if not shot:
            return
        voice_script = shot.voice_script

    if (media_id, shot_index) in _shot_cancel:
        await _update_shot(media_id, shot_index, status="cancelled", progress=0)
        _shot_cancel.discard((media_id, shot_index))
        return
    await _update_shot(media_id, shot_index, status="tts", progress=10)
    audio_path = ""
    if voice_script and voice_script.strip():
        try:
            audio_path = await generate_voice(voice_script)
            if audio_path:
                await _update_shot(media_id, shot_index, audio_path=audio_path, status="done", progress=100)
                print(f"[ShotAudio] shot {media_id}/{shot_index}: audio generated")
            else:
                await _update_shot(media_id, shot_index, status="failed", progress=100)
                print(f"[ShotAudio] TTS returned empty for shot {shot_index}")
        except Exception as e:
            await _update_shot(media_id, shot_index, status="failed", progress=100)
            print(f"[ShotAudio] TTS error for shot {shot_index}: {e}")
    else:
        await _update_shot(media_id, shot_index, status="failed", progress=100)
        print(f"[ShotAudio] No voice_script for shot {shot_index}")
# ====== cancel shot generation ======

@router.post("/{media_id}/shots/{shot_index}/cancel")
async def cancel_shot(media_id: int, shot_index: int):
    """Cancel a running shot generation task."""
    _shot_cancel.add((media_id, shot_index))
    key = (media_id, shot_index)
    if key in _shot_tasks and not _shot_tasks[key].done():
        for task_key in [(media_id, shot_index), (media_id, shot_index, "video"), (media_id, shot_index, "audio")]:
            if task_key in _shot_tasks and not _shot_tasks[task_key].done():
                _shot_tasks[task_key].cancel()
    async with async_session() as db:
        result = await db.execute(
            select(MediaShot).where(
                MediaShot.media_id == media_id,
                MediaShot.shot_index == shot_index,
            )
        )
        shot = result.scalar_one_or_none()
        if shot and shot.status not in ("done", "failed", "cancelled"):
            shot.status = "cancelled"
            shot.progress = 0
            await db.commit()
    return {"cancelled": True, "shot_index": shot_index}





def _start_shot_task(media_id: int, shot_index: int):
    """Spawn background asyncio task for shot generation."""
    key = (media_id, shot_index)
    if key in _shot_tasks and not _shot_tasks[key].done():
        return
    task = asyncio.create_task(_run_shot_generation(media_id, shot_index))
    _shot_tasks[key] = task


def _start_shot_video_task(media_id: int, shot_index: int):
    """Spawn background task for video-only generation."""
    key = (media_id, shot_index, 'video')
    if key in _shot_tasks and not _shot_tasks[key].done():
        return
    task = asyncio.create_task(_run_shot_video_only(media_id, shot_index))
    _shot_tasks[key] = task


def _start_shot_audio_task(media_id: int, shot_index: int):
    """Spawn background task for audio-only generation."""
    key = (media_id, shot_index, 'audio')
    if key in _shot_tasks and not _shot_tasks[key].done():
        return
    task = asyncio.create_task(_run_shot_audio_only(media_id, shot_index))
    _shot_tasks[key] = task



# ====== 逐镜生成（4步流程） ======

@router.post("/save-shots")
async def save_shots(data: dict = Body(...), db: AsyncSession = Depends(get_db)):
    """Create Media + MediaShots records without starting pipeline.
    Returns media_id for subsequent per-shot generation.
    """
    prompt = data.get("prompt", "")
    size = data.get("size", "9:16")
    resolution = data.get("resolution", "1080P")
    shots_data = data.get("shots", [])

    prompt_short = prompt[:30] if len(prompt) > 30 else prompt
    filename = f"ai_{uuid.uuid4().hex}.mp4"
    total_dur = sum(int(s.get("duration", 5)) for s in shots_data)

    media = Media(
        name=f"{prompt_short}.mp4",
        filepath=str(UPLOAD_DIR / filename),
        size="-",
        duration=f"{total_dur}s" if total_dur else "-",
        status=MediaStatus.pending,
        source="ai",
        prompt=prompt,
        video_size=size,
        video_duration=str(total_dur) + 's' if total_dur else '-',
        video_resolution=resolution,
    )
    db.add(media)
    await db.commit()
    await db.refresh(media)

    for i, shot in enumerate(shots_data):
        ms = MediaShot(
            media_id=media.id,
            shot_index=i + 1,
            scene_prompt=shot.get("scene_prompt", ""),
            voice_script=shot.get("voice_script", ""),
            duration=str(shot.get("duration", 5)),
            status="pending",
        )
        db.add(ms)
    await db.commit()

    return {"media_id": media.id, "shot_count": len(shots_data)}

@router.post("/test-generate")
async def test_generate():
    """Minimal test: just create placeholder clip."""
    import uuid
    output = str(UPLOAD_DIR / f"test_{uuid.uuid4().hex[:8]}.mp4")
    safe = "test prompt"
    res = "1080x1920"
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi",
        "-i", f"color=color=0x1a1a2e:size={res}:rate=24:duration=5,drawtext=text='{safe}':fontcolor=white:fontsize=36:x=(w-text_w)/2:y=(h-text_h)/2",
        "-c:v", "libx264", "-preset", "ultrafast",
        "-movflags", "+faststart",
        output,
    ]
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        await asyncio.wait_for(proc.communicate(), timeout=30)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
    import os
    return {"ok": os.path.exists(output), "path": output}




@router.post("/{media_id}/shots/{shot_index}/generate")
async def generate_single_shot(media_id: int, shot_index: int):
    """Start video + audio generation for a single shot (async, returns immediately).
    Poll GET /{media_id}/shots for progress."""

    async with async_session() as db:
        result = await db.execute(
            select(MediaShot).where(
                MediaShot.media_id == media_id,
                MediaShot.shot_index == shot_index,
            )
        )
        shot = result.scalar_one_or_none()
        if not shot:
            raise HTTPException(404, f"Shot {shot_index} not found for media {media_id}")
        shot.status = "pending"
        shot.progress = 0
        shot.clip_path = ""
        shot.audio_path = ""
        await db.commit()

    _start_shot_task(media_id, shot_index)

    return {
        "accepted": True,
        "shot_index": shot_index,
        "status": "pending",
    }

@router.post("/{media_id}/regenerate-shot-video")
async def regenerate_shot_video(media_id: int, data: dict = Body(...)):
    """Start async video regeneration for a single shot. Poll GET /{media_id}/shots for progress."""

    shot_index = data.get("shot_index")
    scene_prompt = data.get("scene_prompt", "")

    async with async_session() as db:
        shot_result = await db.execute(
            select(MediaShot).where(
                MediaShot.media_id == media_id,
                MediaShot.shot_index == shot_index,
            )
        )
        shot = shot_result.scalar_one_or_none()
        if not shot:
            raise HTTPException(404, f"Shot {shot_index} not found")
        shot.scene_prompt = scene_prompt
        shot.status = "pending"
        shot.progress = 0
        shot.clip_path = ""
        await db.commit()

    _start_shot_video_task(media_id, shot_index)
    return {"accepted": True, "shot_index": shot_index, "status": "pending"}


@router.post("/{media_id}/regenerate-shot-audio")
async def regenerate_shot_audio(media_id: int, data: dict = Body(...)):
    """Start async audio regeneration for a single shot. Poll GET /{media_id}/shots for progress."""

    shot_index = data.get("shot_index")
    voice_script = data.get("voice_script", "")

    async with async_session() as db:
        shot_result = await db.execute(
            select(MediaShot).where(
                MediaShot.media_id == media_id,
                MediaShot.shot_index == shot_index,
            )
        )
        shot = shot_result.scalar_one_or_none()
        if not shot:
            raise HTTPException(404, f"Shot {shot_index} not found")
        shot.voice_script = voice_script
        shot.status = "pending"
        shot.progress = 0
        shot.audio_path = ""
        await db.commit()

    _start_shot_audio_task(media_id, shot_index)
    return {"accepted": True, "shot_index": shot_index, "status": "pending"}


@router.post("/{media_id}/compose")
async def compose_media(media_id: int, db: AsyncSession = Depends(get_db)):
    """Start async video composition. Poll GET /media for status."""
    media_result = await db.execute(select(Media).where(Media.id == media_id))
    media = media_result.scalar_one_or_none()
    if not media:
        raise HTTPException(404, "Media not found")
    media.status = MediaStatus.generating
    await db.commit()

    asyncio.create_task(_run_compose(media_id))
    return {"accepted": True, "media_id": media_id}


async def _run_compose(media_id: int):
    """Background task: compose all shots into final video."""
    from ..services.video_composer import compose_video

    async with async_session() as db:
        result = await db.execute(
            select(MediaShot).where(MediaShot.media_id == media_id).order_by(MediaShot.shot_index)
        )
        shots = result.scalars().all()

        media_result = await db.execute(select(Media).where(Media.id == media_id))
        media = media_result.scalar_one_or_none()
        if not media:
            return

        clips = []
        for shot in shots:
            clips.append({
                "video_path": shot.clip_path or "",
                "audio_path": shot.audio_path or "",
                "subtitle": shot.voice_script or "",
                "duration": int(shot.duration) if shot.duration else 5,
            })

        valid_clips = [c for c in clips if c.get("video_path") and os.path.exists(c.get("video_path", ""))]
        if not valid_clips:
            await _update_media(media_id, status=MediaStatus.failed, duration="没有已完成的分镜视频")
            return

        output_path = str(UPLOAD_DIR / f"ai_{uuid.uuid4().hex}.mp4")
        comp_result = await compose_video(valid_clips, output_path, media.video_size or "9:16", media.video_resolution or "1080P")

        # Clean up ASS subtitle temp files
        for f in Path(str(UPLOAD_DIR)).glob("sub_*.ass"):
            try: f.unlink()
            except: pass
        if comp_result.get("ok"):
            await _update_media(media_id, filepath=comp_result["path"], duration=f"{comp_result['duration']}s", status=MediaStatus.ready)
        else:
            await _update_media(media_id, status=MediaStatus.failed, duration=comp_result.get("error", ""))


import subprocess, base64, tempfile

@router.post("/analyze-competitor-video")
async def analyze_competitor_video(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(400, "请上传视频文件")

    # Save uploaded video
    video_bytes = await file.read()
    uploads_dir = Path(__file__).parent.parent.parent / "uploads"
    uploads_dir.mkdir(exist_ok=True)
    video_path = uploads_dir / f"competitor_{file.filename}"
    video_path.write_bytes(video_bytes)

    screenshots_dir = uploads_dir / "screenshots"
    screenshots_dir.mkdir(exist_ok=True)

    # Clean old screenshots
    for f in screenshots_dir.glob("*.jpg"):
        try: f.unlink()
        except: pass

    try:
        # FFmpeg: extract 1 keyframe per second (using system PATH)
        ffmpeg = "ffmpeg"

        subprocess.run([
            ffmpeg, "-i", str(video_path), "-vf", "fps=1",
            "-q:v", "2", str(screenshots_dir / "frame_%03d.jpg"),
            "-y"
        ], capture_output=True, timeout=60)

        # FFmpeg: extract audio
        audio_path = uploads_dir / "competitor_audio.mp3"
        subprocess.run([
            ffmpeg, "-i", str(video_path), "-q:a", "2",
            "-map", "a", str(audio_path), "-y"
        ], capture_output=True, timeout=30)

        # List frames
        frames = sorted(screenshots_dir.glob("frame_*.jpg"))
        frame_count = len(frames)

        # Get video duration
        probe = subprocess.run([
            ffmpeg, "-i", str(video_path)
        ], capture_output=True, text=True, timeout=10)
        duration = 30
        if probe.stderr:
            for line in probe.stderr.split("\n"):
                if "Duration:" in line:
                    parts = line.split("Duration:")[1].strip().split(",")[0].split(":")
                    try: duration = int(float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2]))
                    except: pass

        # Encode first 10 frames as base64
        frame_b64_list = []
        for fp in frames[:10]:
            b64 = base64.b64encode(fp.read_bytes()).decode()
            frame_b64_list.append(b64)

        # Call multimodal LLM for analysis
        from ..services.llm_service import _load_prompt

        api_key = await get_setting("llm_api_key")
        if not api_key:
            return {"error": "未配置 LLM API Key"}

        model = (await get_setting("llm_model")) or "qwen-vl-plus"
        if "qwen-plus" in model:
            model = model.replace("qwen-plus", "qwen-vl-plus")
        elif "qwen-max" in model:
            model = model.replace("qwen-max", "qwen-vl-max")

        base_url = (await get_setting("llm_base_url")) or "https://dashscope.aliyuncs.com/compatible-mode/v1"


        from openai import OpenAI
        client = OpenAI(api_key=api_key, base_url=base_url)

        prompt_text = _load_prompt("competitor_analysis_prompt.txt", "你是短视频拆解分析师，输出JSON框架。")

        # Build messages with frames
        content_parts = [{"type": "text", "text": prompt_text + f"\n\n视频时长：{duration}s，共{frame_count}帧。请拆解这个视频的分镜框架（JSON格式）。"}]

        for b64 in frame_b64_list[:8]:
            content_parts.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}})

        response = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": content_parts}],
            temperature=0.5,
            max_tokens=2000,
        )

        result_text = response.choices[0].message.content
        import json, re
        json_match = re.search(r'\{[\s\S]*\}', result_text)
        if json_match:
            result = json.loads(json_match.group())
            result["frame_count"] = frame_count
            result["duration"] = duration
            result["source_file"] = file.filename
            return result

        return {"error": "LLM未返回有效JSON", "raw": result_text[:500]}

    except Exception as e:
        return {"error": str(e)}
    finally:
        # Cleanup video
        try: video_path.unlink()
        except: pass
        try: audio_path.unlink()
        except: pass

# ====== 竞品拆解 ======

from ..models.models import CompetitorTemplate
from ..services.llm_service import analyze_competitor

@router.post("/analyze-competitor")
async def analyze_competitor_route(data: dict = Body(...)):
    source_text = data.get("source", "")
    if not source_text.strip():
        return {"error": "请输入竞品视频描述"}
    result = await analyze_competitor(source_text)
    return result


@router.get("/competitor-templates")
async def list_competitor_templates(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(CompetitorTemplate).order_by(CompetitorTemplate.id.desc())
    )
    templates = result.scalars().all()
    return [{"id": t.id, "name": t.name, "source": t.source, "framework": t.framework, "created_at": t.created_at} for t in templates]

@router.get("/competitor-templates/{template_id}")
async def get_competitor_template(template_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(CompetitorTemplate).where(CompetitorTemplate.id == template_id))
    t = result.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "模板不存在")
    return {"id": t.id, "name": t.name, "source": t.source, "framework": t.framework, "created_at": t.created_at}

@router.get("/{media_id}", response_model=MediaOut)
async def get_media(media_id: int, db: AsyncSession = Depends(get_db)):
    """Get single media record."""
    result = await db.execute(select(Media).where(Media.id == media_id))
    media = result.scalar_one_or_none()
    if not media:
        raise HTTPException(404, "Media not found")
    return media
@router.post("/competitor-templates")
async def create_competitor_template(data: dict = Body(...), db: AsyncSession = Depends(get_db)):
    t = CompetitorTemplate(
        name=data.get("name", "未命名模板"),
        source=data.get("source", ""),
        framework=data.get("framework", "{}"),
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return {"id": t.id, "name": t.name, "created_at": t.created_at}

@router.put("/competitor-templates/{template_id}")
async def update_competitor_template(template_id: int, data: dict = Body(...), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(CompetitorTemplate).where(CompetitorTemplate.id == template_id))
    t = result.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "模板不存在")
    if "name" in data: t.name = data["name"]
    if "source" in data: t.source = data["source"]
    if "framework" in data: t.framework = data["framework"]
    await db.commit()
    return {"ok": True}

@router.delete("/competitor-templates/{template_id}")
async def delete_competitor_template(template_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(CompetitorTemplate).where(CompetitorTemplate.id == template_id))
    t = result.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "模板不存在")
    await db.delete(t)
    await db.commit()
    return {"ok": True}

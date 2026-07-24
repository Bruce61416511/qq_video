import os
import uuid
import asyncio
import traceback
from datetime import datetime
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from ..database import get_db, async_session
from ..models import Media, MediaShot, MediaStatus
from ..schemas.schemas import MediaOut, MediaShotOut, VideoGenerateRequest, GenerateShotsRequest, ShotItem
from ..config import UPLOAD_DIR

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


@router.post("/generate-shots")
async def generate_shots(req: GenerateShotsRequest):
    """AI generates shot plan from topic using LLM (with template fallback)."""
    from ..services.llm_service import generate_shot_plan

    count = max(1, min(req.shot_count, 10))
    dur = req.shot_duration if req.shot_duration in ("3","5","10","15","30") else "5"

    shots = await generate_shot_plan(req.topic, count, dur)
    # Ensure duration is set on each shot
    for s in shots:
        if "duration" not in s:
            s["duration"] = dur

    return {"shots": shots}


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

        # Generate video clip with progress tracking
        async def update_progress(pct):
            await _update_shot(media_id, shot_index, progress=pct)

        video_result = await generate_video_clip(
            prompt=shot.scene_prompt,
            duration=shot.duration,
            size=req.size,
            resolution=req.resolution,
            progress_callback=update_progress,
        )

        clip = {
            "video_path": "",
            "audio_path": audio_path if audio_path else "",
            "subtitle": shot.voice_script,
            "duration": int(shot.duration),
        }

        if isinstance(video_result, dict):
            if video_result.get("status") == "done" and video_result.get("url"):
                await _update_shot_status(media_id, shot_index, "downloading")
                # Download video from URL
                clip["video_path"] = await _download_video(video_result["url"], media_id, shot_index)
            elif video_result.get("status") == "no_api":
                print(f"[Pipeline] shot {shot_index}: {video_result.get('message')}")
                # No API key - create placeholder
                clip["video_path"] = await _create_placeholder_clip(shot.scene_prompt, shot.duration, req.size)
            else:
                print(f"[Pipeline] shot {shot_index}: error - {video_result.get('message')}")
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
    try:
        import subprocess
        output = str(UPLOAD_DIR / f"placeholder_{uuid.uuid4().hex[:8]}.mp4")
        safe_prompt = prompt[:80].replace(":", "\\:").replace("'", "\\'")
        size_map = {"9:16": "1080:1920", "16:9": "1920:1080", "1:1": "1080:1080"}
        res = size_map.get(size, "1080:1920")

        cmd = [
            "ffmpeg", "-y",
            "-f", "lavfi",
            "-i", f"color=c=0x1a1a2e:s={res}:d={duration},drawtext=text='{safe_prompt}':fontcolor=white:fontsize=36:x=(w-text_w)/2:y=(h-text_h)/2",
            "-c:v", "libx264", "-preset", "ultrafast",
            "-movflags", "+faststart",
            output,
        ]
        subprocess.run(cmd, capture_output=True, timeout=30)
        if os.path.exists(output):
            return output
    except Exception as e:
        print(f"[Pipeline] placeholder error: {e}")
    return ""
import os
import uuid
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from ..database import get_db
from ..models import Media, MediaStatus
from ..schemas.schemas import MediaOut, VideoGenerateRequest
from ..config import UPLOAD_DIR

router = APIRouter(prefix="/api/media", tags=["media"])

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
    await db.delete(m)
    await db.commit()
    return {"ok": True}

@router.post("/generate", response_model=MediaOut)
async def generate_video(req: VideoGenerateRequest, db: AsyncSession = Depends(get_db)):
    prompt_short = req.prompt[:30] if len(req.prompt) > 30 else req.prompt
    filename = f"ai_{uuid.uuid4().hex}.mp4"
    media = Media(
        name=f"{prompt_short}.mp4",
        filepath=str(UPLOAD_DIR / filename),
        size="-",
        duration=f"{req.duration}s",
        status=MediaStatus.generating,
        source="ai",
        prompt=req.prompt,
        video_size=req.size,
        video_duration=req.duration,
        video_resolution=req.resolution,
    )
    db.add(media)
    await db.commit()
    await db.refresh(media)
    return media

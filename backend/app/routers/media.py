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
    # Check if files actually exist, mark as failed if not
    changed = False
    for m in media_list:
        if m.status == MediaStatus.ready and not os.path.exists(m.filepath):
            m.status = MediaStatus.failed
            m.duration = "文件丢失"
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
        raise HTTPException(404, "素材不存在")
    if os.path.exists(m.filepath):
        os.remove(m.filepath)
    await db.delete(m)
    await db.commit()
    return {"ok": True}

@router.post("/generate", response_model=MediaOut)
async def generate_video(req: VideoGenerateRequest, db: AsyncSession = Depends(get_db)):
    media = Media(
        name=f"{req.prompt[:30]}...mp4",
        filepath=str(UPLOAD_DIR / f"gen_{uuid.uuid4().hex}.mp4"),
        size="-",
        duration="-",
        status=MediaStatus.generating,
        source="ai",
        prompt=req.prompt,
    )
    db.add(media)
    await db.commit()
    await db.refresh(media)
    return media

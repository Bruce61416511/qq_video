"""形象库接口（形象工坊页）。

GET    /api/avatars            列表
POST   /api/avatars            新增（image_url 会被下载到本地）
POST   /api/avatars/upload     本地上传图片新增
PUT    /api/avatars/{id}       改名 / 设为默认
DELETE /api/avatars/{id}       删除（同时删除本地图片文件）
"""
import uuid
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import UPLOAD_DIR
from ..database import get_db
from ..models import Avatar

router = APIRouter(prefix="/api/avatars", tags=["avatars"])

AVATAR_DIR = UPLOAD_DIR / "avatars"
AVATAR_DIR.mkdir(parents=True, exist_ok=True)


class AvatarCreate(BaseModel):
    name: str
    prompt: str = ""
    image_url: str = ""   # 公网 URL（百炼返回的有时效，创建时立即下载）
    image_path: str = ""  # 或服务器本地路径（二选一）


class AvatarUpdate(BaseModel):
    name: str = ""
    is_default: int = -1  # -1 表示不修改


def _to_dict(a: Avatar) -> dict:
    return {
        "id": a.id,
        "name": a.name,
        "prompt": a.prompt or "",
        "image_path": a.image_path or "",
        "image_url": ("/uploads/avatars/" + Path(a.image_path).name) if a.image_path else "",
        "is_default": bool(a.is_default),
        "created_at": a.created_at.strftime("%Y-%m-%d %H:%M:%S") if a.created_at else "",
    }


async def _download_image(url: str) -> str:
    """下载远程图片到 uploads/avatars/，返回本地路径。"""
    ext = ".png"
    lower = url.lower().split("?")[0]
    for e in (".jpg", ".jpeg", ".webp"):
        if lower.endswith(e):
            ext = e
            break
    path = AVATAR_DIR / f"avatar_{uuid.uuid4().hex}{ext}"
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.get(url)
        if resp.status_code != 200:
            raise HTTPException(status_code=400, detail=f"图片下载失败: HTTP {resp.status_code}")
        path.write_bytes(resp.content)
    return str(path)


@router.get("")
async def list_avatars(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Avatar).order_by(Avatar.is_default.desc(), Avatar.id.desc()))
    return [_to_dict(a) for a in result.scalars().all()]


@router.post("")
async def create_avatar(req: AvatarCreate, db: AsyncSession = Depends(get_db)):
    if not req.name.strip():
        raise HTTPException(status_code=400, detail="请填写形象名称")
    image_path = ""
    if req.image_url.strip():
        image_path = await _download_image(req.image_url.strip())
    elif req.image_path.strip():
        image_path = req.image_path.strip()
    else:
        raise HTTPException(status_code=400, detail="image_url / image_path 至少传一个")

    avatar = Avatar(name=req.name.strip(), prompt=req.prompt or "", image_path=image_path)
    db.add(avatar)
    await db.commit()
    await db.refresh(avatar)
    return _to_dict(avatar)


@router.post("/upload")
async def upload_avatar(
    file: UploadFile = File(...),
    name: str = Form(...),
    prompt: str = Form(""),
    db: AsyncSession = Depends(get_db),
):
    ext = Path(file.filename or "img.png").suffix or ".png"
    path = AVATAR_DIR / f"avatar_{uuid.uuid4().hex}{ext}"
    content = await file.read()
    path.write_bytes(content)

    avatar = Avatar(name=name.strip(), prompt=prompt or "", image_path=str(path))
    db.add(avatar)
    await db.commit()
    await db.refresh(avatar)
    return _to_dict(avatar)


@router.put("/{avatar_id}")
async def update_avatar(avatar_id: int, req: AvatarUpdate, db: AsyncSession = Depends(get_db)):
    avatar = (await db.execute(select(Avatar).where(Avatar.id == avatar_id))).scalar_one_or_none()
    if not avatar:
        raise HTTPException(status_code=404, detail="形象不存在")

    if req.name.strip():
        avatar.name = req.name.strip()
    if req.is_default >= 0:
        # 先清掉旧的默认
        result = await db.execute(select(Avatar).where(Avatar.is_default == 1))
        for a in result.scalars().all():
            a.is_default = 0
        avatar.is_default = 1 if req.is_default == 1 else 0

    await db.commit()
    await db.refresh(avatar)
    return _to_dict(avatar)


@router.delete("/{avatar_id}")
async def delete_avatar(avatar_id: int, db: AsyncSession = Depends(get_db)):
    avatar = (await db.execute(select(Avatar).where(Avatar.id == avatar_id))).scalar_one_or_none()
    if not avatar:
        raise HTTPException(status_code=404, detail="形象不存在")
    try:
        if avatar.image_path:
            Path(avatar.image_path).unlink(missing_ok=True)
    except Exception as e:
        print(f"[Avatar] delete file warning: {e}")
    await db.delete(avatar)
    await db.commit()
    return {"ok": True}

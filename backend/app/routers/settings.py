from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from ..database import get_db
from ..models import Setting
from ..schemas.schemas import SettingOut, SettingUpdate

router = APIRouter(prefix="/api/settings", tags=["settings"])

@router.get("", response_model=list[SettingOut])
async def list_settings(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Setting).order_by(Setting.key))
    return result.scalars().all()

@router.get("/{key}")
async def get_setting(key: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Setting).where(Setting.key == key))
    s = result.scalar_one_or_none()
    if not s:
        return {"key": key, "value": ""}
    return {"key": s.key, "value": s.value}

@router.put("/{key}")
async def upsert_setting(key: str, req: SettingUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Setting).where(Setting.key == key))
    s = result.scalar_one_or_none()
    if s:
        s.value = req.value
    else:
        s = Setting(key=key, value=req.value)
        db.add(s)
    await db.commit()
    return {"ok": True, "key": key}

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from ..database import get_db
from ..models import PublishTask, Media, Account, AccountStatus, MediaStatus, TaskStatus
from ..schemas.schemas import PublishTaskOut, PublishRequest

router = APIRouter(prefix="/api/publish", tags=["publish"])

@router.get("/tasks", response_model=list[PublishTaskOut])
async def list_tasks(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(PublishTask).order_by(PublishTask.created_at.desc()).limit(50)
    )
    return result.scalars().all()

@router.post("")
async def create_publish(req: PublishRequest, db: AsyncSession = Depends(get_db)):
    media = await db.get(Media, req.media_id)
    if not media:
        raise HTTPException(404, "素材不存在")
    if media.status != MediaStatus.ready:
        raise HTTPException(400, "素材尚未就绪")

    tasks = []
    for aid in req.account_ids:
        acc = await db.get(Account, aid)
        if not acc:
            raise HTTPException(404, f"账号 {aid} 不存在")
        if acc.status != AccountStatus.online:
            raise HTTPException(400, f"账号 {acc.name} 不在线")

        task = PublishTask(
            media_id=req.media_id,
            account_id=aid,
            title=req.title,
            tags=req.tags,
            status=TaskStatus.pending,
        )
        db.add(task)
        tasks.append(task)

    await db.commit()
    return {"ok": True, "count": len(tasks)}

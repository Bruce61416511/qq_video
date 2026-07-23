from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from datetime import datetime
from ..database import get_db
from ..models import PublishTask, Media, Account, AccountStatus, MediaStatus, TaskStatus
from ..schemas.schemas import PublishTaskOut, PublishRequest

router = APIRouter(prefix="/api/publish", tags=["publish"])

@router.get("/tasks", response_model=list[PublishTaskOut])
async def list_tasks(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(PublishTask).order_by(PublishTask.created_at.desc()).limit(200)
    )
    return result.scalars().all()

@router.delete("/tasks")
async def clear_tasks(db: AsyncSession = Depends(get_db)):
    await db.execute(delete(PublishTask))
    await db.commit()
    return {"ok": True, "message": "所有发布记录已清除"}

@router.post("/tasks/{task_id}/cancel")
async def cancel_task(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(PublishTask, task_id)
    if not task:
        raise HTTPException(404, "任务不存在")
    if task.status != TaskStatus.running:
        raise HTTPException(400, "只能取消正在运行的任务")
    task.status = TaskStatus.failed
    task.error_msg = "用户取消"
    task.finished_at = datetime.now()
    await db.commit()
    return {"ok": True}

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

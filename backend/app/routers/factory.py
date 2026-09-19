"""口播工厂接口：固定形象 + 分镜 -> 批量图生视频 -> 合并成片。

POST   /api/factory/tasks                          创建任务（含分镜）
GET    /api/factory/tasks                          任务列表
GET    /api/factory/tasks/{id}                     任务详情（含分镜状态，前端轮询）
DELETE /api/factory/tasks/{id}                     删除任务
POST   /api/factory/tasks/{id}/generate            后台跑全部未完成分镜并合并
POST   /api/factory/tasks/{id}/shots/{index}/generate   重跑单个分镜
POST   /api/factory/tasks/{id}/compose             只合并（跳过生成）
"""
import asyncio
import os
import uuid
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import UPLOAD_DIR
from ..database import get_db
from ..models import Media, MediaStatus, FactoryShot, FactoryTask, FactoryTaskStatus

router = APIRouter(prefix="/api/factory", tags=["factory"])

_bg_tasks: set = set()


class FactoryShotIn(BaseModel):
    scene_prompt: str
    voice_script: str = ""
    duration: str = "5"
    image_path: str = ""  # 选填：本镜单独起始帧


class FactoryTaskCreate(BaseModel):
    name: str
    avatar_id: int = 0
    avatar_image: str = ""  # 形象定妆照本地路径（前端从形象库选出）
    size: str = "9:16"
    resolution: str = "1080P"
    shots: list[FactoryShotIn]


def _task_dict(t: FactoryTask, shots: list[FactoryShot] | None = None) -> dict:
    d = {
        "id": t.id,
        "name": t.name,
        "avatar_id": t.avatar_id,
        "avatar_image": t.avatar_image or "",
        "avatar_image_url": ("/uploads/avatars/" + Path(t.avatar_image).name) if t.avatar_image else "",
        "size": t.size,
        "resolution": t.resolution,
        "status": t.status.value if hasattr(t.status, "value") else str(t.status),
        "media_id": t.media_id,
        "video_path": t.video_path or "",
        "error": t.error or "",
        "created_at": t.created_at.strftime("%Y-%m-%d %H:%M:%S") if t.created_at else "",
    }
    if shots is not None:
        d["shots"] = [_shot_dict(s) for s in sorted(shots, key=lambda s: s.shot_index)]
    return d


def _shot_dict(s: FactoryShot) -> dict:
    return {
        "id": s.id,
        "shot_index": s.shot_index,
        "scene_prompt": s.scene_prompt or "",
        "voice_script": s.voice_script or "",
        "duration": s.duration or "5",
        "image_path": s.image_path or "",
        "clip_path": s.clip_path or "",
        "clip_url": ("/uploads/" + Path(s.clip_path).name) if s.clip_path else "",
        "audio_path": s.audio_path or "",
        "status": s.status or "pending",
        "error": s.error or "",
    }


async def _get_task(db: AsyncSession, task_id: int) -> FactoryTask:
    task = (await db.execute(select(FactoryTask).where(FactoryTask.id == task_id))).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    return task


async def _get_shots(db: AsyncSession, task_id: int) -> list[FactoryShot]:
    result = await db.execute(select(FactoryShot).where(FactoryShot.task_id == task_id))
    return list(result.scalars().all())


@router.post("/tasks")
async def create_task(req: FactoryTaskCreate, db: AsyncSession = Depends(get_db)):
    if not req.name.strip():
        raise HTTPException(status_code=400, detail="请填写任务名称")
    if not req.avatar_image.strip():
        raise HTTPException(status_code=400, detail="请先选择形象（定妆照）")
    if not req.shots:
        raise HTTPException(status_code=400, detail="至少添加一个分镜")

    task = FactoryTask(
        name=req.name.strip(),
        avatar_id=req.avatar_id,
        avatar_image=req.avatar_image.strip(),
        size=req.size,
        resolution=req.resolution,
        status=FactoryTaskStatus.draft,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)

    for i, s in enumerate(req.shots):
        db.add(FactoryShot(
            task_id=task.id,
            shot_index=i + 1,
            scene_prompt=s.scene_prompt,
            voice_script=s.voice_script,
            duration=s.duration,
            image_path=s.image_path.strip(),
            status="pending",
        ))
    await db.commit()

    shots = await _get_shots(db, task.id)
    return _task_dict(task, shots)


@router.get("/tasks")
async def list_tasks(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(FactoryTask).order_by(FactoryTask.id.desc()))
    tasks = result.scalars().all()
    out = []
    for t in tasks:
        shots = await _get_shots(db, t.id)
        out.append(_task_dict(t, shots))
    return out


@router.get("/tasks/{task_id}")
async def get_task(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await _get_task(db, task_id)
    shots = await _get_shots(db, task_id)
    return _task_dict(task, shots)


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await _get_task(db, task_id)
    for s in await _get_shots(db, task_id):
        await db.delete(s)
    await db.delete(task)
    await db.commit()
    return {"ok": True}


async def _download_video(url: str, task_id: int, shot_index: int) -> str:
    """下载远程视频到 uploads/factory/，返回本地路径。"""
    out_dir = UPLOAD_DIR / "factory"
    out_dir.mkdir(exist_ok=True)
    path = out_dir / f"task{task_id}_shot{shot_index}_{uuid.uuid4().hex[:8]}.mp4"
    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                return ""
            path.write_bytes(resp.content)
        return str(path)
    except Exception as e:
        print(f"[Factory] download error: {e}")
        return ""


async def _update_shot(db, shot_id: int, **kwargs):
    shot = (await db.execute(select(FactoryShot).where(FactoryShot.id == shot_id))).scalar_one_or_none()
    if not shot:
        return
    for k, v in kwargs.items():
        setattr(shot, k, v)
    await db.commit()


async def _generate_one_shot(task: FactoryTask, shot: FactoryShot):
    """生成单个分镜：TTS（选填）-> 有配音走 s2v 数字人（口型同步），无配音走图生视频。"""
    from ..services.tts_service import generate_voice
    from ..services.video_gen_service import generate_video_clip, generate_s2v_clip

    image = shot.image_path or task.avatar_image
    db = None
    from ..database import async_session
    async with async_session() as db:
        await _update_shot(db, shot.id, status="generating", error="")

    # 1) TTS（先行：s2v 需要用音频驱动口型）
    audio_path = ""
    tts_error = ""
    if (shot.voice_script or "").strip():
        try:
            audio_path = await generate_voice(shot.voice_script.strip())
        except Exception as e:
            print(f"[Factory] shot {shot.shot_index} tts error: {e}")
            tts_error = str(e)
        if not audio_path:
            # 台词配不出声音就明确失败，绝不静默降级成无声视频
            err = f"TTS 配音失败（{tts_error or '未返回音频'}），请到设置页检查 TTS 服务/模型/音色配置"
            print(f"[Factory] shot {shot.shot_index} marked failed: {err}")
            async with async_session() as db:
                await _update_shot(db, shot.id, status="failed", error=err)
            return {"ok": False, "error": err}

    # 2) 生成视频
    clip_path = ""
    error = ""
    result = None
    if audio_path:
        # 数字人模式：图 + 音频 -> wan2.2-s2v，口型与台词逐字同步
        try:
            result = await generate_s2v_clip(image, audio_path, task.resolution)
        except Exception as e:
            result = {"status": "error", "service": "s2v", "message": str(e)}
    else:
        # 无台词：图生视频（起始帧 = 本镜图 or 任务形象图）
        try:
            result = await generate_video_clip(
                prompt=shot.scene_prompt,
                duration=str(shot.duration),
                size=task.size,
                resolution=task.resolution,
                image_url=image,
            )
        except Exception as e:
            result = {"status": "error", "service": "i2v", "message": str(e)}

    if isinstance(result, dict):
        if result.get("status") == "done" and result.get("url"):
            clip_path = await _download_video(result["url"], task.id, shot.shot_index)
            if not clip_path:
                error = "视频下载失败（URL 可能已过期）"
        else:
            error = result.get("message") or result.get("status") or "生成失败"
    elif isinstance(result, str) and result:
        clip_path = result
    else:
        error = "未知返回"

    async with async_session() as db:
        status = "done" if clip_path else "failed"
        await _update_shot(db, shot.id, status=status, clip_path=clip_path,
                           audio_path=audio_path, error=error)
    return {"ok": bool(clip_path), "error": error}


async def _compose_task(task_id: int):
    """合并所有 done 分镜 -> 成片写入素材库。"""
    from ..services.video_composer import compose_video

    from ..database import async_session
    async with async_session() as db:
        task = await _get_task(db, task_id)
        shots = [s for s in await _get_shots(db, task_id) if s.status == "done" and s.clip_path]
        if not shots:
            task.status = FactoryTaskStatus.failed
            task.error = "没有可合并的分镜视频"
            await db.commit()
            return

        task.status = FactoryTaskStatus.generating
        await db.commit()

        clips = []
        for s in sorted(shots, key=lambda x: x.shot_index):
            clips.append({
                "video_path": s.clip_path,
                "audio_path": s.audio_path or "",
                "subtitle": (s.voice_script or "").strip(),
            })

        output_path = str(UPLOAD_DIR / f"factory_{uuid.uuid4().hex}.mp4")
        result = await compose_video(clips, output_path, task.size, task.resolution)

        if not result.get("ok"):
            task.status = FactoryTaskStatus.failed
            task.error = result.get("error", "合成失败")
            await db.commit()
            return

        # 写入素材库
        total_dur = sum(int(s.duration or 5) for s in shots)
        media = Media(
            name=f"{task.name}.mp4",
            filepath=output_path,
            size="-",
            duration=f"{total_dur}s" if total_dur else "-",
            status=MediaStatus.ready,
            source="ai",
            prompt=task.name,
            video_size=task.size,
            video_resolution=task.resolution,
        )
        db.add(media)
        await db.commit()
        await db.refresh(media)

        task.status = FactoryTaskStatus.done
        task.video_path = output_path
        task.media_id = media.id
        task.error = ""
        await db.commit()


async def _run_task_pipeline(task_id: int):
    """后台：逐镜生成（串行，避免并发限制）+ 合并。"""
    from ..database import async_session
    try:
        async with async_session() as db:
            task = await _get_task(db, task_id)
            shots = await _get_shots(db, task_id)
            task.status = FactoryTaskStatus.generating
            task.error = ""
            await db.commit()

        pending = [s for s in shots if s.status != "done"]
        for shot in sorted(pending, key=lambda x: x.shot_index):
            await _generate_one_shot(task, shot)

        await _compose_task(task_id)
    except Exception as e:
        print(f"[Factory] pipeline error: {e}")
        async with async_session() as db:
            try:
                task = await _get_task(db, task_id)
                task.status = FactoryTaskStatus.failed
                task.error = str(e)
                await db.commit()
            except Exception:
                pass


@router.post("/tasks/{task_id}/generate")
async def generate_task(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await _get_task(db, task_id)
    if task.status == FactoryTaskStatus.generating:
        raise HTTPException(status_code=400, detail="任务正在生成中")
    t = asyncio.create_task(_run_task_pipeline(task_id))
    _bg_tasks.add(t)
    t.add_done_callback(_bg_tasks.discard)
    return {"ok": True, "message": "已开始生成"}


@router.post("/tasks/{task_id}/shots/{shot_index}/generate")
async def regenerate_shot(task_id: int, shot_index: int, db: AsyncSession = Depends(get_db)):
    task = await _get_task(db, task_id)
    shots = await _get_shots(db, task_id)
    shot = next((s for s in shots if s.shot_index == shot_index), None)
    if not shot:
        raise HTTPException(status_code=404, detail="分镜不存在")

    task.status = FactoryTaskStatus.generating
    await db.commit()

    async def _run():
        await _generate_one_shot(task, shot)
        await _compose_task(task_id)

    t = asyncio.create_task(_run())
    _bg_tasks.add(t)
    t.add_done_callback(_bg_tasks.discard)
    return {"ok": True, "message": "已开始重新生成本镜"}


@router.post("/tasks/{task_id}/compose")
async def compose_only(task_id: int, db: AsyncSession = Depends(get_db)):
    await _get_task(db, task_id)
    t = asyncio.create_task(_compose_task(task_id))
    _bg_tasks.add(t)
    t.add_done_callback(_bg_tasks.discard)
    return {"ok": True, "message": "已开始合并"}

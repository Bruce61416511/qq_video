import asyncio
import random
import traceback
from datetime import datetime
from sqlalchemy import select
from ..database import async_session
from ..models import PublishTask, Media, Account, TaskStatus, AccountStatus

try:
    from .publisher_engine import publish_video
    HAS_PLAYWRIGHT = True
except Exception:
    HAS_PLAYWRIGHT = False

async def run_worker():
    mode = 'Playwright' if HAS_PLAYWRIGHT else 'sim'
    print(f"[Worker] publish queue started ({mode})")

    # recover stuck running tasks (older than 10 min -> back to pending)
    async with async_session() as db:
        result = await db.execute(
            select(PublishTask).where(PublishTask.status == TaskStatus.running)
        )
        stuck = result.scalars().all()
        recovered = 0
        for t in stuck:
            if t.created_at and (datetime.now() - t.created_at).total_seconds() > 600:
                t.status = TaskStatus.pending
                t.error_msg = ''
                recovered += 1
        await db.commit()
        if recovered:
            print(f"[Worker] recovered {recovered} stuck task(s)")

    while True:
        try:
            async with async_session() as db:
                result = await db.execute(
                    select(PublishTask)
                    .where(PublishTask.status == TaskStatus.pending)
                    .order_by(PublishTask.created_at.asc())
                    .limit(1)
                )
                task = result.scalar_one_or_none()

                if task is None:
                    await db.close()
                    await asyncio.sleep(5)
                    continue

                task.status = TaskStatus.running
                await db.commit()

                media = await db.get(Media, task.media_id)
                account = await db.get(Account, task.account_id)

                if not media or not account:
                    task.status = TaskStatus.failed
                    task.error_msg = "media or account not found"
                    task.finished_at = datetime.now()
                    await db.commit()
                    continue

                if HAS_PLAYWRIGHT:
                    print(f"[Worker] publish: account={account.name} video={media.name}")
                    result = await publish_video(
                        account_id=task.account_id,
                        video_path=media.filepath,
                        title=task.title,
                        tags=task.tags,
                    )

                    if result.get("ok"):
                        task.status = TaskStatus.success
                    else:
                        task.status = TaskStatus.failed
                        task.error_msg = result.get("error", "unknown error")
                        if "login" in task.error_msg.lower():
                            account.status = AccountStatus.expired
                else:
                    print(f"[Worker] mock publish: account={account.name} video={media.name}")
                    await asyncio.sleep(2)
                    task.status = TaskStatus.success
                    task.error_msg = ""

                task.finished_at = datetime.now()
                await db.commit()
                print(f"[Worker] done: {'OK' if task.status == TaskStatus.success else 'FAIL'}")

                await db.close()

                delay = random.randint(10, 30) if not HAS_PLAYWRIGHT else 30
                if task.status == TaskStatus.pending or task.status == TaskStatus.running:
                    delay = 5
                await asyncio.sleep(delay)

        except Exception as e:
            print(f"[Worker] error: {traceback.format_exc()}")
            await asyncio.sleep(10)

async def start_worker():
    asyncio.create_task(run_worker())
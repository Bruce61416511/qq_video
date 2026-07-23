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
    print(f"[Worker] 发布队列已启动 {'(Playwright 模式)' if HAS_PLAYWRIGHT else '(模拟模式 - 仅记录日志)'}")

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
                    task.error_msg = "素材或账号不存在"
                    task.finished_at = datetime.now()
                    await db.commit()
                    continue

                if HAS_PLAYWRIGHT:
                    print(f"[Worker] 发布: 账号={account.name} 视频={media.name}")
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
                        task.error_msg = result.get("error", "未知错误")
                        # If login expired, update account status
                        if "登录" in task.error_msg:
                            account.status = AccountStatus.expired
                else:
                    print(f"[Worker] 模拟发布: 账号={account.name} 视频={media.name}")
                    await asyncio.sleep(2)
                    task.status = TaskStatus.success
                    task.error_msg = ""

                task.finished_at = datetime.now()
                await db.commit()
                print(f"[Worker] 完成: {'成功' if task.status == TaskStatus.success else '失败'}")

                await db.close()

                delay = random.randint(10, 30) if not HAS_PLAYWRIGHT else random.randint(300, 900)
                if task.status == TaskStatus.pending or task.status == TaskStatus.running:
                    delay = 5
                await asyncio.sleep(delay)

        except Exception as e:
            print(f"[Worker] 错误: {traceback.format_exc()}")
            await asyncio.sleep(10)

async def start_worker():
    asyncio.create_task(run_worker())

"""热点洞察 API 路由。"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from ..database import get_db
from ..schemas.schemas import HotTopicOut, HotTopicStatusUpdate, TrendConfigUpdate
from ..services import trend_service

router = APIRouter(prefix="/api/trends", tags=["trends"])


# ── 配置文件管理 ──

@router.get("/config/frequency")
async def get_frequency_words():
    return {"content": trend_service.read_frequency_words()}


@router.put("/config/frequency")
async def set_frequency_words(req: TrendConfigUpdate):
    trend_service.write_frequency_words(req.content)
    return {"ok": True}


@router.get("/config/interests")
async def get_ai_interests():
    return {"content": trend_service.read_ai_interests()}


@router.put("/config/interests")
async def set_ai_interests(req: TrendConfigUpdate):
    trend_service.write_ai_interests(req.content)
    return {"ok": True}


# ── 热点数据 ──

@router.get("", response_model=list[HotTopicOut])
async def list_topics(
    status: str = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    return await trend_service.get_topics(db, status=status, limit=limit, offset=offset)


@router.post("/refresh")
async def refresh_topics(db: AsyncSession = Depends(get_db)):
    """手动触发从 TrendRadar 刷新热点。"""
    topics = await trend_service.fetch_and_save_topics(db)
    return {"ok": True, "count": len(topics)}


@router.put("/{topic_id}/status")
async def update_topic_status(
    topic_id: int,
    req: HotTopicStatusUpdate,
    db: AsyncSession = Depends(get_db),
):
    await trend_service.update_topic_status(db, topic_id, req.status)
    return {"ok": True}

# ── 结构化关键词组 ──

@router.get("/config/groups")
async def get_keyword_groups():
    return trend_service.read_keyword_groups()


@router.put("/config/groups")
async def set_keyword_groups(groups: dict):
    trend_service.write_keyword_groups(groups)
    return {"ok": True}
# ── TrendRadar AI 配置 ──

@router.get("/config/ai")
async def get_ai_config():
    return trend_service.read_ai_config()


@router.put("/config/ai")
async def set_ai_config(config: dict):
    trend_service.write_ai_config(config)
    return {"ok": True}
# ── 触发 TrendRadar 采集 ──

import subprocess, os
from pathlib import Path

import threading

_crawl_status = {"running": False, "result": None}

def _run_crawl():
    global _crawl_status
    _crawl_status["running"] = True
    _crawl_status["result"] = None
    tr_dir = Path(__file__).parent.parent.parent.parent / "TrendRadar-master"
    venv_python = tr_dir / ".venv" / "Scripts" / "python.exe"
    try:
        env = os.environ.copy()
        env["PYTHONIOENCODING"] = "utf-8"
        proc = subprocess.run(
            [str(venv_python), "-m", "trendradar"],
            cwd=str(tr_dir),
            capture_output=True,
            text=True,
            timeout=300,
            env=env,
        )
        _crawl_status["result"] = {"ok": True, "output": proc.stdout[-300:]}
    except subprocess.TimeoutExpired:
        _crawl_status["result"] = {"ok": False, "error": "采集超时（5分钟）"}
    except Exception as e:
        _crawl_status["result"] = {"ok": False, "error": str(e)}
    finally:
        _crawl_status["running"] = False

@router.post("/crawl")
async def trigger_crawl():
    """触发 TrendRadar 重新采集热点（后台运行）。"""
    if _crawl_status["running"]:
        return {"ok": False, "error": "采集正在进行中，请等待完成"}
    thread = threading.Thread(target=_run_crawl, daemon=True)
    thread.start()
    return {"ok": True, "message": "采集已启动，约需2-3分钟"}

@router.get("/crawl/status")
async def crawl_status():
    """查询采集任务状态。"""
    return _crawl_status
# ── AI 分析结果 ──

@router.get("/ai-analysis")
async def get_ai_analysis():
    return trend_service.read_ai_analysis()
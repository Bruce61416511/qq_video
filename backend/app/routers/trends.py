"""热点洞察 API 路由。"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from ..database import get_db
from ..schemas.schemas import HotTopicOut, HotTopicStatusUpdate, TrendConfigUpdate
from ..services import trend_service
from pathlib import Path

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
        # 从数据库读取 API Key，通过环境变量注入（不写入文件）
        import asyncio as _asyncio
        from ..database import async_session
        from ..models.models import Setting
        from sqlalchemy import select as _select
        async def _get_key():
            async with async_session() as db:
                r = await db.execute(_select(Setting).where(Setting.key == "llm_api_key"))
                s = r.scalar_one_or_none()
                return s.value if s else ""
        try:
            loop = _asyncio.get_running_loop()
        except RuntimeError:
            loop = _asyncio.new_event_loop()
            key = loop.run_until_complete(_get_key())
        else:
            key = loop.run_until_complete(_asyncio.ensure_future(_get_key()))
        if key:
            env["AI_API_KEY"] = key
        proc = subprocess.run(
            [str(venv_python), "-m", "trendradar"],
            cwd=str(tr_dir),
            capture_output=True,
            text=True,
            timeout=300,
            env=env,
        )
        _crawl_status["result"] = {"ok": True, "output": (proc.stdout or "")[-300:]}
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

# ── 报告 iframe ──

from fastapi.responses import HTMLResponse

@router.get("/report", response_class=HTMLResponse)
async def get_report():
    """返回 TrendRadar 生成的 index.html 报告。"""
    index_path = trend_service.TRENDRADAR_DIR / "output" / "index.html"
    if not index_path.exists():
        return HTMLResponse("<html><body><p style='text-align:center;color:#999;padding:40px'>暂无报告，请先点击 重新采集</p></body></html>")
    return HTMLResponse(index_path.read_text(encoding="utf-8"))

# ── 筛选方法切换 ──

@router.get("/config/method")
async def get_filter_method():
    """获取当前筛选方法（ai 或 keyword）。"""
    return {"method": trend_service.get_filter_method()}

@router.put("/config/method")
async def set_filter_method(data: dict):
    """切换筛选方法。"""
    method = data.get("method", "keyword")
    if method not in ("ai", "keyword"):
        raise HTTPException(400, "method 必须是 ai 或 keyword")
    trend_service.set_filter_method(method)
    return {"ok": True, "method": method}


# ── 选题生成 ──

from ..services import topic_to_video

@router.post("/topic-to-video/generate")
async def generate_topics():
    """触发选题生成（同步阻塞，约30-60秒）。"""
    import asyncio, concurrent.futures
    loop = asyncio.get_running_loop()
    with concurrent.futures.ThreadPoolExecutor() as pool:
        await loop.run_in_executor(pool, topic_to_video.generate)
    result = topic_to_video.get_status()["result"]
    if result and result.get("ok"):
        return {"ok": True, "count": result.get("count", 0)}
    return {"ok": False, "error": result.get("error", "生成失败") if result else "未知错误"}

@router.get("/topic-to-video/status")
async def topic_status():
    """查询选题生成状态。"""
    s = topic_to_video.get_status()
    return {"running": s["running"], "result": s["result"]}

@router.get("/topic-to-video/report", response_class=HTMLResponse)
async def topic_report():
    """返回选题 HTML 报告。"""
    return HTMLResponse(topic_to_video.get_html())


# ── 配置文件管理 ──

# 后端自己的提示词（backend/app/prompts/）
PROMPT_FILES = {
    "topic_to_video_prompt": "topic_to_video_prompt.txt",
    "competitor_analysis_prompt": "competitor_analysis_prompt.txt",
    "narration_prompt": "narration_prompt.txt",
    "scene_prompt": "scene_prompt.txt",
    "topic_outline_creation_prompt": "topic_outline_creation_prompt.txt",
}

# TrendRadar 原生配置（TrendRadar-master/config/）
TR_CONFIG_FILES = {
    "ai_interests": "ai_interests.txt",
    "frequency_words": "frequency_words.txt",
    "ai_analysis_prompt": "ai_analysis_prompt.txt",
}

ALL_CONFIG_FILES = {**PROMPT_FILES, **TR_CONFIG_FILES}

PROMPT_DIR = Path(__file__).parent.parent / "prompts"
TR_CONFIG_DIR = trend_service.TRENDRADAR_DIR / "config"

def _config_path(key: str) -> Path:
    if key in PROMPT_FILES:
        return PROMPT_DIR / PROMPT_FILES[key]
    return TR_CONFIG_DIR / TR_CONFIG_FILES[key]

@router.get("/config/files")
async def list_config_files():
    """列出所有可编辑的配置文件及路径。"""
    files = []
    for key, filename in ALL_CONFIG_FILES.items():
        path = _config_path(key)
        exists = path.exists()
        size = path.stat().st_size if exists else 0
        rel = str(path.relative_to(Path(__file__).parent.parent.parent.parent))
        files.append({
            "key": key,
            "filename": filename,
            "path": rel,
            "exists": exists,
            "size": size,
            "description": {
                "ai_interests": "根据语义筛选热搜（AI 模式专用）",
                "frequency_words": "根据关键词筛选热搜（关键词模式专用）",
                "ai_analysis_prompt": "AI 情报分析提示词（当前未启用）",
                "topic_to_video_prompt": "视频选题提示词：热搜转为可拍摄选题",
                "competitor_analysis_prompt": "竞品拆解提示词：分析竞品视频输出框架",
            }.get(key, ""),
        })
    return {"files": files}

@router.get("/config/files/{key}")
async def get_config_file(key: str):
    """读取指定配置文件内容。"""
    if key not in ALL_CONFIG_FILES:
        raise HTTPException(404, f"未知配置文件: {key}")
    path = _config_path(key)
    if not path.exists():
        return {"key": key, "content": "", "exists": False}
    return {"key": key, "content": path.read_text(encoding="utf-8"), "exists": True}

@router.put("/config/files/{key}")
async def save_config_file(key: str, data: dict):
    """保存指定配置文件内容。"""
    if key not in ALL_CONFIG_FILES:
        raise HTTPException(404, f"未知配置文件: {key}")
    content = data.get("content", "")
    path = _config_path(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return {"ok": True, "key": key}

@router.get("/topic-to-video/data")
async def get_topic_data():
    """返回视频选题的原始 JSON 数据（供文生视频页面下拉选择）。"""
    return topic_to_video.get_topic_data()

# ── AI 分析结果 ──

@router.get("/ai-analysis")
async def get_ai_analysis():
    return trend_service.read_ai_analysis()

# ── 微信热文 ──

@router.post("/wechat/refresh")
async def refresh_wechat_hot(db: AsyncSession = Depends(get_db)):
    """从 tophub.today 抓取微信 24h 热文榜。"""
    topics = await trend_service.fetch_wechat_hot_articles(db)
    return {"ok": True, "count": len(topics)}

# ── 人民网健康 ──

@router.post("/rmw-health/refresh")
async def refresh_rmw_health(db: AsyncSession = Depends(get_db)):
    """从人民网健康频道抓取文章。"""
    topics = await trend_service.fetch_rmw_health_articles(db)
    return {"ok": True, "count": len(topics)}

# ── 食科学会 ──

@router.post("/cifst/refresh")
async def refresh_cifst(db: AsyncSession = Depends(get_db)):
    """从中国食品科学技术学会抓取文章。"""
    topics = await trend_service.fetch_cifst_articles(db)
    return {"ok": True, "count": len(topics)}



# ── 中国食品安全网 ──

@router.post("/cfsn/refresh")
async def refresh_cfsn(db: AsyncSession = Depends(get_db)):
    """从中国食品安全网抓取新闻。"""
    topics = await trend_service.fetch_cfsn_articles(db)
    return {"ok": True, "count": len(topics)}

# ── 科普中国 ──

@router.post("/kepu/refresh")
async def refresh_kepu(db: AsyncSession = Depends(get_db)):
    """从科普中国首页抓取大健康文章。"""
    topics = await trend_service.fetch_kepu_articles(db)
    return {"ok": True, "count": len(topics)}

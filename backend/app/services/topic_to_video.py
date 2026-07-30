"""热搜 → 视频选题转换服务。"""
import json
import re
import sqlite3
import threading
from pathlib import Path

TRENDRADAR_DIR = Path(__file__).parent.parent.parent.parent / "TrendRadar-master"
PROMPT_FILE = TRENDRADAR_DIR / "config" / "topic_to_video_prompt.txt"
OUTPUT_FILE = TRENDRADAR_DIR / "output" / "topic_to_video.html"

_status = {"running": False, "result": None, "html": None}


def _get_top_5_ai_results() -> list[dict]:
    """从 SQLite 取 relevance_score 最高的 5 条 AI 过滤结果。"""
    db_path = TRENDRADAR_DIR / "output" / "news" / "2026-07-30.db"
    if not db_path.exists():
        # Try latest
        news_dir = TRENDRADAR_DIR / "output" / "news"
        if news_dir.exists():
            dbs = sorted(news_dir.glob("*.db"), reverse=True)
            db_path = dbs[0] if dbs else db_path
    if not db_path.exists():
        return []

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    rows = conn.execute("""
        SELECT DISTINCT n.title, n.url, n.platform_id, MAX(r.relevance_score) as score
        FROM ai_filter_results r
        JOIN news_items n ON r.news_item_id = n.id
        WHERE r.status = 'active'
        GROUP BY n.title
        ORDER BY score DESC
        LIMIT 5
    """).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def _load_prompt() -> str:
    if not PROMPT_FILE.exists():
        return ""
    return PROMPT_FILE.read_text(encoding="utf-8")


def _build_topics_text(results: list[dict]) -> str:
    lines = []
    for i, r in enumerate(results, 1):
        lines.append(f"{i}. [{r.get('platform_id', '')}] {r['title']}")
        lines.append(f"   链接: {r.get('url', '')}")
        lines.append(f"   相关度: {r.get('score', 0):.2f}")
        lines.append("")
    return "\n".join(lines)


def _get_llm_api_key() -> str:
    """从 settings 表读取 API Key（同步方式）。"""
    try:
        import asyncio
        from ..database import async_session
        from ..models.models import Setting
        from sqlalchemy import select as _select

        async def _get():
            async with async_session() as db:
                r = await db.execute(_select(Setting).where(Setting.key == "llm_api_key"))
                s = r.scalar_one_or_none()
                return s.value if s else ""

        try:
            loop = asyncio.get_running_loop()
            return loop.run_until_complete(asyncio.ensure_future(_get()))
        except RuntimeError:
            return asyncio.run(_get())
    except Exception:
        return ""


def _get_llm_model() -> str:
    """从 settings 表读取模型名。"""
    try:
        import asyncio
        from ..database import async_session
        from ..models.models import Setting
        from sqlalchemy import select as _select

        async def _get():
            async with async_session() as db:
                r = await db.execute(_select(Setting).where(Setting.key == "llm_model"))
                s = r.scalar_one_or_none()
                return s.value if s else "qwen-plus"

        try:
            loop = asyncio.get_running_loop()
            return loop.run_until_complete(asyncio.ensure_future(_get()))
        except RuntimeError:
            return asyncio.run(_get())
    except Exception:
        return "qwen-plus"


def _get_llm_base_url() -> str:
    """从 settings 表读取 API Base URL。"""
    try:
        import asyncio
        from ..database import async_session
        from ..models.models import Setting
        from sqlalchemy import select as _select

        async def _get():
            async with async_session() as db:
                r = await db.execute(_select(Setting).where(Setting.key == "llm_base_url"))
                s = r.scalar_one_or_none()
                return s.value if s else "https://dashscope.aliyuncs.com/compatible-mode/v1"

        try:
            loop = asyncio.get_running_loop()
            return loop.run_until_complete(asyncio.ensure_future(_get()))
        except RuntimeError:
            return asyncio.run(_get())
    except Exception:
        return "https://dashscope.aliyuncs.com/compatible-mode/v1"


def _generate_html(topics: list[dict], error: str = None) -> str:
    """渲染选题结果 HTML。"""
    if error:
        return f"""<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
body{{font-family:-apple-system,sans-serif;padding:40px;text-align:center;color:#999}}
</style></head><body><h2>⚠ 生成失败</h2><p>{error}</p></body></html>"""

    if not topics:
        return """<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
body{font-family:-apple-system,sans-serif;padding:40px;text-align:center;color:#999}
</style></head><body><h2>🎬 今日选题</h2><p>暂无选题，请先采集热点</p></body></html>"""

    cards = []
    for i, t in enumerate(topics):
        source_title = t.get("source_title", "")[:60]
        source_url = t.get("source_url", "#")
        video_topic = t.get("video_topic", "无标题")
        angle = t.get("angle", "")
        hook = t.get("hook", "")
        outline = t.get("content_outline", [])
        product_link = t.get("product_link", "")
        emotion = t.get("target_emotion", "")
        duration = t.get("duration", 30)

        outline_html = "".join(f"<li>{o}</li>" for o in outline) if outline else ""
        cards.append(f"""
        <div class="card">
            <div class="card-header">
                <span class="card-number">#{i+1}</span>
                <span class="card-title">{video_topic}</span>
                <span class="card-duration">⏱ {duration}s</span>
            </div>
            <div class="card-source">📰 来源：<a href="{source_url}" target="_blank">{source_title}</a></div>
            <div class="card-angle">🎯 切入角度：{angle}</div>
            <div class="card-hook">⚡ 黄金3秒：{hook}</div>
            {f'''<div class="card-outline"><ul>{outline_html}</ul></div>''' if outline_html else ''}
            <div class="card-footer">
                <span class="card-product">🫙 {product_link}</span>
                <span class="card-emotion">💭 {emotion}</span>
            </div>
        </div>""")

    return f"""<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>今日视频选题</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;color:#333;line-height:1.6;padding:20px}}
.page-title{{text-align:center;font-size:20px;font-weight:700;margin-bottom:20px;color:#4f46e5}}
.card{{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 2px 8px rgba(0,0,0,0.06)}}
.card-header{{display:flex;align-items:center;gap:10px;margin-bottom:10px}}
.card-number{{background:#4f46e5;color:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;flex-shrink:0}}
.card-title{{font-size:17px;font-weight:700;flex:1}}
.card-duration{{font-size:12px;color:#888;white-space:nowrap}}
.card-source{{font-size:13px;color:#666;margin-bottom:8px}}
.card-source a{{color:#4f46e5}}
.card-angle{{font-size:14px;color:#333;margin-bottom:8px;background:#f0f0ff;padding:6px 10px;border-radius:6px}}
.card-hook{{font-size:14px;color:#e67e22;margin-bottom:8px;font-weight:600;background:#fff8f0;padding:6px 10px;border-radius:6px}}
.card-outline ul{{padding-left:20px;font-size:14px;color:#444}}
.card-outline li{{margin-bottom:4px}}
.card-footer{{display:flex;justify-content:space-between;align-items:center;margin-top:10px;padding-top:10px;border-top:1px solid #eee;font-size:13px;color:#888}}
.empty{{text-align:center;padding:60px 20px;color:#999;font-size:16px}}
</style>
</head>
<body>
<h1 class="page-title">🎬 今日视频选题</h1>
{"".join(cards) if cards else '<div class="empty">暂无选题，请先采集热点</div>'}
</body>
</html>"""


def generate():
    """生成选题 HTML（在后台线程中运行）。"""
    global _status
    _status["running"] = True
    _status["result"] = None
    _status["html"] = None
    try:
        results = _get_top_5_ai_results()
        if not results:
            _status["html"] = _generate_html([])
            _status["result"] = {"ok": True, "count": 0, "message": "没有 AI 过滤结果"}
            return

        prompt_template = _load_prompt()
        if not prompt_template:
            _status["html"] = _generate_html([], error="提示词文件不存在")
            _status["result"] = {"ok": False, "error": "提示词文件不存在"}
            return

        topics_text = _build_topics_text(results)
        api_key = _get_llm_api_key()
        if not api_key:
            _status["html"] = _generate_html([], error="未配置 LLM API Key")
            _status["result"] = {"ok": False, "error": "未配置 LLM API Key"}
            return

        model = _get_llm_model()
        base_url = _get_llm_base_url()

        from openai import OpenAI
        client = OpenAI(api_key=api_key, base_url=base_url)

        user_content = prompt_template.replace("{hot_topics}", topics_text)

        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "你是一名短视频内容策划师。请以 JSON 格式输出。"},
                {"role": "user", "content": user_content},
            ],
            temperature=0.7,
            max_tokens=3000,
        )

        content = response.choices[0].message.content
        # Extract JSON
        json_match = re.search(r'\{[\s\S]*\}', content)
        if not json_match:
            _status["html"] = _generate_html([], error="LLM 返回格式异常")
            _status["result"] = {"ok": False, "error": "LLM 未返回有效 JSON"}
            return

        data = json.loads(json_match.group())
        topics = data.get("topics", [])

        html = _generate_html(topics)
        OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT_FILE.write_text(html, encoding="utf-8")
        _status["html"] = html
        _status["result"] = {"ok": True, "count": len(topics)}

    except Exception as e:
        _status["html"] = _generate_html([], error=str(e))
        _status["result"] = {"ok": False, "error": str(e)}
    finally:
        _status["running"] = False


def generate_async():
    """在后台线程中生成。"""
    if _status["running"]:
        return False
    t = threading.Thread(target=generate, daemon=True)
    t.start()
    return True


def get_status():
    return _status


def get_html():
    if _status["html"]:
        return _status["html"]
    if OUTPUT_FILE.exists():
        return OUTPUT_FILE.read_text(encoding="utf-8")
    return _generate_html([])
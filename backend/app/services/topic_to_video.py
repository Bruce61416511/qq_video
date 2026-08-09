"""热搜 → 视频选题转换服务。"""
import json
import re
import sqlite3
import threading
import asyncio
from datetime import datetime
from pathlib import Path

BACKEND_DIR = Path(__file__).parent.parent.parent
TRENDRADAR_DIR = Path(__file__).parent.parent.parent.parent / 'TrendRadar-master'
PROMPT_FILE = BACKEND_DIR / "app" / "prompts" / "topic_to_video_prompt.txt"
OUTPUT_FILE = BACKEND_DIR / "output" / "topic_to_video.html"
TOPIC_JSON_FILE = BACKEND_DIR / "output" / "topic_to_video.json"

_status = {"running": False, "result": None, "html": None, "generated_at": None}
_last_topics = []


def _get_report_titles() -> set:
    index_path = TRENDRADAR_DIR / "output" / "index.html"
    if not index_path.exists():
        return set()
    html = index_path.read_text(encoding="utf-8")
    titles = set()
    for m in re.finditer(r'class="news-link"[^>]*>([^<]+)</a>', html):
        titles.add(m.group(1).strip())
    return titles


def _get_all_report_ai_results() -> list[dict]:
    db_path = TRENDRADAR_DIR / "output" / "news" / "2026-07-30.db"
    if not db_path.exists():
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


def _get_setting(key: str, default: str = "") -> str:
    try:
        import asyncio
        from ..database import async_session
        from ..models.models import Setting
        from sqlalchemy import select as _select

        async def _get():
            async with async_session() as db:
                r = await db.execute(_select(Setting).where(Setting.key == key))
                s = r.scalar_one_or_none()
                return s.value if s else default

        try:
            return asyncio.run(_get())
        except RuntimeError:
            return asyncio.run(_get())
    except Exception:
        return default


def _generate_html(topics: list[dict], error: str = None, gen_time: str = None) -> str:
    if error:
        return f"""<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
body{{font-family:-apple-system,sans-serif;padding:40px;text-align:center;color:#999}}
</style></head><body><h2>生成失败</h2><p>{error}</p></body></html>"""

    if not topics:
        ts = f'<div class="gen-time">上次生成：{gen_time or "暂无"}</div>' if gen_time else ""
        return f"""<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
body{{font-family:-apple-system,sans-serif;padding:40px;text-align:center;color:#999}}
.gen-time{{font-size:12px;color:#aaa;margin-bottom:8px}}
</style></head><body><h2>🎬 今日选题</h2>{ts}<p>暂无选题，请先采集热点</p></body></html>"""

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
        duration = t.get("duration", "--")


        if outline:
            if isinstance(outline[0], dict):
                outline_html = ""
                for o in outline:
                    stage = o.get("stage", "")
                    if stage == "hook":
                        continue
                    point = o.get("point", "")
                    label = {"evidence": "证据", "scene": "场景", "cta": "行动"}.get(stage, stage)
                    outline_html += f'<li><span style="color:#999;font-size:12px">{label}</span> {point}</li>'
            else:
                outline_html = "".join(f"<li>{o}</li>" for o in outline)
        else:
            outline_html = ""
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
            {f'<div class="card-outline"><ul>{outline_html}</ul></div>' if outline_html else ''}
            <div class="card-footer">
                <span class="card-product">🫙 {product_link}</span>
                <span class="card-emotion">💭 {emotion}</span>
            </div>
        </div>""")

    ts = gen_time or "未知"

    return f"""<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>今日视频选题</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;color:#333;line-height:1.6;padding:20px}}
.page-title{{text-align:center;font-size:20px;font-weight:700;color:#4f46e5;margin-bottom:4px}}
.gen-time{{text-align:center;font-size:12px;color:#aaa;margin-bottom:20px}}
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
</style>
</head>
<body>
<h1 class="page-title">🎬 今日视频选题</h1>
<div class="gen-time">生成时间：{ts}</div>
{"".join(cards)}
</body>
</html>"""



def _get_crawler_topics() -> list[dict]:
    """从热点爬虫的 hot_topics 表读取数据。"""
    try:
        from ..database import async_session
        from ..models.models import HotTopic
        from sqlalchemy import select as _select

        async def _query():
            async with async_session() as db:
                r = await db.execute(
                    _select(HotTopic).where(
                        HotTopic.platform.in_(["weixin", "rmw_health", "cifst", "cfsn", "kepu"])
                    )
                )
                rows = r.scalars().all()
                return [
                    {
                        "title": row.title,
                        "url": row.url or "",
                        "platform_id": row.platform,
                        "score": float(row.heat_score or 5000),
                    }
                    for row in rows
                ]

        try:
            return asyncio.run(_query())
        except RuntimeError:
            return asyncio.run(_query())
    except Exception as e:
        print(f"[topic_to_video] crawler topics error: {e}")
        return []

def generate():
    global _status, _last_topics
    _status["running"] = True
    _status["result"] = None
    _status["html"] = None
    try:
        all_results = _get_all_report_ai_results()
        report_titles = _get_report_titles()
        results = [r for r in all_results if r['title'] in report_titles]
        if not report_titles:
            results = all_results
        results += _get_crawler_topics()
        results = results[:8]
        if not results:
            _status["html"] = _generate_html([], gen_time=_status.get("generated_at"))
            _status["result"] = {"ok": True, "count": 0, "message": "没有匹配的热点"}
            return

        prompt_template = _load_prompt()
        if not prompt_template:
            _status["html"] = _generate_html([], error="提示词文件不存在")
            _status["result"] = {"ok": False, "error": "提示词文件不存在"}
            return

        topics_text = _build_topics_text(results)
        api_key = _get_setting("llm_api_key")
        if not api_key:
            _status["html"] = _generate_html([], error="未配置 LLM API Key")
            _status["result"] = {"ok": False, "error": "未配置 LLM API Key"}
            return

        model = _get_setting("llm_model", "qwen-plus")
        base_url = _get_setting("llm_base_url", "https://dashscope.aliyuncs.com/compatible-mode/v1")

        from openai import OpenAI
        client = OpenAI(api_key=api_key, base_url=base_url, timeout=90.0)

        user_content = prompt_template.replace("{hot_topics}", topics_text)

        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "你是一名短视频内容策划师。请以 JSON 格式输出。"},
                {"role": "user", "content": user_content},
            ],
            temperature=0.7,
            max_tokens=1500,
        )

        content = response.choices[0].message.content
        with open(BACKEND_DIR / "output" / "_last_llm.txt", "w", encoding="utf-8") as dbg:
            dbg.write(content)
        # Remove markdown fences and fix trailing commas
        clean = content
        if "`json" in clean:
            clean = clean.split("`json")[1].split("`")[0]
        elif "`" in clean:
            clean = clean.split("`")[1].split("`")[0]
        import re as _re
        clean = _re.sub(r',\s*}', "}", clean)
        clean = _re.sub(r',\s*]', "]", clean)
        json_match = re.search(r'\{[\s\S]*\}', clean)
        if not json_match:
            _status["html"] = _generate_html([], error="LLM return fmt err")
            _status["result"] = {"ok": False, "error": "LLM no valid JSON"}
            return
        try:
            data = json.loads(json_match.group())
        except json.JSONDecodeError as je:
            _status["html"] = _generate_html([], error=f"JSON: {je}")
            _status["result"] = {"ok": False, "error": f"JSON: {je}"}
            return

        topics = data.get("topics", [])

        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        _status["generated_at"] = now
        _last_topics = topics

        # Save JSON for persistence
        TOPIC_JSON_FILE.write_text(json.dumps({"topics": topics, "generated_at": now}, ensure_ascii=False), encoding="utf-8")

        html = _generate_html(topics, gen_time=now)
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


def get_topic_data():
    global _last_topics
    if _last_topics:
        return {"topics": _last_topics, "generated_at": _status.get("generated_at")}
    if TOPIC_JSON_FILE.exists():
        try:
            data = json.loads(TOPIC_JSON_FILE.read_text(encoding="utf-8"))
            _last_topics = data.get("topics", [])
            # Ensure each topic has a duration field
            for t in _last_topics:
                if "duration" not in t or not t["duration"]:
                    t["duration"] = 40
            return {"topics": _last_topics, "generated_at": data.get("generated_at")}
        except:
            pass
    return {"topics": [], "generated_at": None}

"""热点洞察服务 - 读取 TrendRadar SQLite 数据，管理配置文件。"""

import os
import re
import sqlite3
from pathlib import Path
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from ..models.models import HotTopic, HotTopicStatus

TRENDRADAR_DIR = Path(__file__).parent.parent.parent.parent / "TrendRadar-master"
TRENDRADAR_DATA = TRENDRADAR_DIR / "output" / "news"


def _read_config_file(filename: str) -> str:
    path = TRENDRADAR_DIR / "config" / filename
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


def _write_config_file(filename: str, content: str):
    path = TRENDRADAR_DIR / "config" / filename
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def read_frequency_words() -> str:
    return _read_config_file("frequency_words.txt")


def write_frequency_words(content: str):
    _write_config_file("frequency_words.txt", content)


def read_ai_interests() -> str:
    return _read_config_file("ai_interests.txt")


def write_ai_interests(content: str):
    _write_config_file("ai_interests.txt", content)


def _parse_keywords(freq_content: str) -> list[str]:
    """从 frequency_words.txt 解析出所有关键词（支持 /regex/ 和 纯文本）。"""
    keywords = []
    for line in freq_content.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or line.startswith("["):
            continue
        # 正则形式 /pattern/ => alias
        m = re.match(r"^/(.+?)/", line)
        if m:
            keywords.append(m.group(1))
        else:
            keywords.append(re.escape(line))
    return keywords


def _latest_db() -> Path | None:
    """找到 TrendRadar 最新的数据文件。"""
    if not TRENDRADAR_DATA.exists():
        return None
    dbs = sorted(TRENDRADAR_DATA.glob("*.db"), reverse=True)
    return dbs[0] if dbs else None


async def fetch_and_save_topics(db: AsyncSession) -> list[HotTopic]:
    """从 TrendRadar SQLite 读取最新热点，关键词过滤后入库。"""
    latest = _latest_db()
    if not latest:
        return []

    freq_content = read_frequency_words()
    keywords = _parse_keywords(freq_content)
    if not keywords:
        return ['']

    combined = "|".join(keywords)
    pattern = re.compile(combined, re.IGNORECASE)

    topics = []
    try:
        conn = sqlite3.connect(str(latest))
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT title, platform_id, rank, url FROM news_items ORDER BY rank"
        ).fetchall()
        conn.close()

        for row in rows:
            title = row["title"]
            if not title:
                continue
            m = pattern.search(title)
            if not m:
                continue

            # 去重
            from sqlalchemy import select as sa_select
            existing = await db.execute(
                sa_select(HotTopic).where(HotTopic.title == title)
            )
            if existing.scalar_one_or_none():
                continue

            topic = HotTopic(
                title=title,
                url=row["url"] or "",
                platform=row["platform_id"] or "",
                heat_score=max(0, 10000 - (row["rank"] or 9999) * 100),
                matched_keywords=m.group(),
                status=HotTopicStatus.new,
            )
            db.add(topic)
            topics.append(topic)

        if topics:
            await db.commit()
    except Exception:
        pass  # 数据库读取失败不阻塞

    return topics


async def get_topics(db: AsyncSession, status: str = None, limit: int = 100,
                     offset: int = 0) -> list[HotTopic]:
    stmt = select(HotTopic)
    if status:
        stmt = stmt.where(HotTopic.status == status)
    stmt = stmt.order_by(HotTopic.heat_score.desc()).offset(offset).limit(limit)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def update_topic_status(db: AsyncSession, topic_id: int, status: str):
    result = await db.execute(select(HotTopic).where(HotTopic.id == topic_id))
    topic = result.scalar_one_or_none()
    if topic:
        topic.status = status
        await db.commit()

# ── 结构化关键词组 ──

def read_keyword_groups() -> dict:
    """从 frequency_words.txt 解析出分组关键词。"""
    raw = read_frequency_words()
    groups = {}
    current_group = None
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("[") and line.endswith("]"):
            current_group = line[1:-1]
            groups[current_group] = []
            continue
        if current_group and current_group not in ('WORD_GROUPS', 'GLOBAL_FILTER'):
            # 提取关键词：处理 /regex/ => alias 格式
            m = re.match(r"^/(.+?)/", line)
            if m:
                # 正则里 | 分隔的多个词
                for kw in re.split(r"[|]", m.group(1)):
                    kw = kw.strip().lstrip("\\b").rstrip("\\b")
                    if kw and kw not in groups[current_group]:
                        groups[current_group].append(kw)
            elif line:
                groups[current_group].append(line)
    return {k: v for k, v in groups.items() if v and k not in ('WORD_GROUPS', 'GLOBAL_FILTER')}


def write_keyword_groups(groups: dict):
    """将分组关键词写入 frequency_words.txt。"""
    lines = ["[GLOBAL_FILTER]", "", "[WORD_GROUPS]", ""]
    for group_name, keywords in groups.items():
        lines.append(f"# {'='*50}")
        lines.append(f"# {group_name}")
        lines.append(f"# {'='*50}")
        lines.append(f"[{group_name}]")
        # 生成正则模式：/词1|词2|词3/
        escaped = [re.escape(k) for k in keywords if k]
        if escaped:
            pattern = "|".join(escaped)
            lines.append(f"/{pattern}/")
        lines.append("")
    _write_config_file("frequency_words.txt", "\n".join(lines))
# ── TrendRadar AI 配置 ──

def _get_yaml_value(key_path: str) -> str:
    """从 config.yaml 读取指定键的值。处理嵌套键如 ai_analysis.enabled。"""
    path = TRENDRADAR_DIR / "config" / "config.yaml"
    if not path.exists():
        return ""
    parts = key_path.split(".")
    section_key = parts[0]
    sub_key = parts[-1] if len(parts) > 1 else None
    lines = path.read_text(encoding="utf-8").splitlines()
    depth = -1
    for i, line in enumerate(lines):
        stripped = line.strip()
        # 匹配 section 头：单独一行的 key:（后面没有值，或只有注释）
        if depth == -1 and re.match(rf"^{section_key}\s*:\s*(#.*)?$", stripped):
            # 确认下一行缩进更深（是真正的 mapping section）
            indent = len(line) - len(line.lstrip())
            depth = indent
            if not sub_key:
                return ""
            continue
        if depth >= 0:
            cur_indent = len(line) - len(line.lstrip())
            # 找到子键
            m = re.match(rf"^\s+{sub_key}\s*:\s*(.+?)(?:\s*#.*)?$", line)
            if m and cur_indent > depth:
                return m.group(1).strip().strip('"')
            # 缩进回到 section 级别或更浅，section 结束
            if line.strip() and cur_indent <= depth:
                depth = -1
    return ""
    """从 config.yaml 读取指定键的值（简单行匹配）。"""
    path = TRENDRADAR_DIR / "config" / "config.yaml"
    if not path.exists():
        return ""
    in_section = False
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith(key_path.split(".")[0] + ":"):
            in_section = True
            continue
        if in_section:
            m = re.match(rf"^\s+{key_path.split('.')[-1]}:\s*(.+?)(?:\s*#.*)?$", line)
            if m:
                return m.group(1).strip().strip('"')
            if line and not line.startswith(" ") and not line.startswith("\t"):
                break
    return ""


def _set_yaml_value(key_path: str, value: str):
    """写入 config.yaml 指定键的值。"""
    path = TRENDRADAR_DIR / "config" / "config.yaml"
    if not path.exists():
        return
    lines = path.read_text(encoding="utf-8").splitlines()
    in_section = False
    section_key = key_path.split(".")[0]
    sub_key = key_path.split(".")[-1]
    for i, line in enumerate(lines):
        if line.strip().startswith(section_key + ":"):
            in_section = True
            continue
        if in_section:
            if re.match(rf"^\s+{sub_key}:\s*", line):
                indent = len(line) - len(line.lstrip())
                lines[i] = " " * indent + f'{sub_key}: "{value}"'
                break
            if line and not line[0] in (" ", "\t"):
                break
    path.write_text("\n".join(lines), encoding="utf-8")


def read_ai_config() -> dict:
    return {
        "model": _get_yaml_value("ai.model"),
        "api_key": _get_yaml_value("ai.api_key"),
        "api_base": _get_yaml_value("ai.api_base"),
        "ai_analysis_enabled": _get_yaml_value("ai_analysis.enabled") == "true",
    }


def write_ai_config(config: dict):
    if "model" in config:
        _set_yaml_value("ai.model", config["model"])
    # API Key 不写入文件，通过环境变量 AI_API_KEY 注入
    if "api_base" in config:
        _set_yaml_value("ai.api_base", config["api_base"])
    if "ai_analysis_enabled" in config:
        _set_yaml_value("ai_analysis.enabled", "true" if config["ai_analysis_enabled"] else "false")

# ── 筛选方法切换 ──

def get_filter_method() -> str:
    """读取 config.yaml 中的 report.method。"""
    path = TRENDRADAR_DIR / "config" / "config.yaml"
    if not path.exists():
        return "keyword"
    import re as _re
    for line in path.read_text(encoding="utf-8").splitlines():
        m = _re.match(r'^\s+method:\s*"(\w+)"', line)
        if m:
            return m.group(1)
    return "keyword"

def set_filter_method(method: str):
    """写入 config.yaml 中的 report.method。"""
    path = TRENDRADAR_DIR / "config" / "config.yaml"
    if not path.exists():
        return
    import re as _re
    lines = path.read_text(encoding="utf-8").splitlines()
    for i, line in enumerate(lines):
        m = _re.match(r'^(\s+method:\s*)"(\w+)"', line)
        if m:
            lines[i] = f'{m.group(1)}"{method}"'
            break
    path.write_text("\n".join(lines), encoding="utf-8")

# ── AI 分析结果 ──

def _get_ai_tags(db_path: str) -> list[dict]:
    """从 TrendRadar SQLite 读取 AI 标签。"""
    if not Path(db_path).exists():
        return []
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT tag, description, priority FROM ai_filter_tags WHERE status='active' ORDER BY priority"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def _get_ai_results(db_path: str) -> list[dict]:
    """读取 AI 分析结果（关联新闻标题、平台、标签、分数）。"""
    if not Path(db_path).exists():
        return []
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("""
        SELECT n.title, n.platform_id, n.url, n.rank,
               r.relevance_score, t.tag, t.description
        FROM ai_filter_results r
        JOIN news_items n ON r.news_item_id = n.id
        JOIN ai_filter_tags t ON r.tag_id = t.id
        WHERE r.status = 'active'
        ORDER BY r.relevance_score DESC
        LIMIT 200
    """).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def read_ai_analysis() -> dict:
    """读取最新 AI 分析结果。"""
    latest = _latest_db()
    if not latest:
        return {"tags": [], "results": [], "message": "暂无 AI 分析数据，请先采集"}

    tags = _get_ai_tags(str(latest))
    results = _get_ai_results(str(latest))

    if not tags and not results:
        return {"tags": [], "results": [], "message": "AI 分析数据为空，请确保已启用 AI 模式并重新采集"}

    return {
        "tags": tags,
        "results": results,
        "total": len(results),
    }
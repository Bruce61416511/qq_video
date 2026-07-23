import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATABASE_URL = f"sqlite+aiosqlite:///{BASE_DIR / 'data.db'}"
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

MAX_ACCOUNTS = 10
CHANNELS_URL = "https://channels.weixin.qq.com"

# Setting cache (refreshed on read)
_setting_cache: dict[str, str] = {}
_cache_loaded = False


async def get_setting(key: str) -> str:
    """Read a setting from DB, with in-memory cache."""
    global _cache_loaded
    if not _cache_loaded:
        await _load_settings()
    return _setting_cache.get(key, "")


async def _load_settings():
    """Load all settings from DB into memory cache."""
    global _cache_loaded, _setting_cache
    try:
        from .database import async_session
        from sqlalchemy import select
        from .models import Setting

        async with async_session() as db:
            result = await db.execute(select(Setting))
            for s in result.scalars().all():
                _setting_cache[s.key] = s.value
        
        _cache_loaded = True
    except Exception as e:
        print(f"[Config] load settings failed: {e}")


def clear_setting_cache():
    """Clear cache so next read fetches from DB."""
    global _cache_loaded, _setting_cache
    _cache_loaded = False
    _setting_cache.clear()
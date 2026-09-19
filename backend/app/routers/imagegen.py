"""文生图 / 图生视频 独立接口。

POST /api/image/generate   文生图（定妆照、分镜起始帧）
POST /api/image/to-video   图生视频（一张图 + 动作提示词 -> 视频片段）
"""
from pathlib import Path

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import clear_setting_cache, get_setting
from ..database import get_db
from ..models import Setting

router = APIRouter(prefix="/api/image", tags=["image"])


class ImageGenerateRequest(BaseModel):
    prompt: str
    size: str = "9:16"  # 9:16 / 16:9 / 1:1
    count: int = 1  # 1~4


class ImageToVideoRequest(BaseModel):
    prompt: str
    image_url: str  # 公网 URL 或服务器本地路径
    duration: str = "5"  # 5~15 秒
    size: str = "9:16"
    resolution: str = "1080P"


@router.post("/generate")
async def generate_image_api(req: ImageGenerateRequest):
    """文生图：返回图片 URL 列表（URL 有时效，需及时下载保存）。"""
    from ..services.video_gen_service import generate_image

    if not req.prompt.strip():
        return {"ok": False, "error": "prompt 不能为空"}
    result = await generate_image(req.prompt, size=req.size, count=req.count)
    return {"ok": result.get("status") == "done", **result}


@router.post("/to-video")
async def image_to_video_api(req: ImageToVideoRequest):
    """图生视频：一张图 + 提示词 -> 视频片段（异步任务，返回 URL 或错误信息）。"""
    from ..services.video_gen_service import generate_video_clip

    if not req.image_url.strip():
        return {"ok": False, "error": "image_url 不能为空"}
    result = await generate_video_clip(
        prompt=req.prompt,
        duration=req.duration,
        size=req.size,
        resolution=req.resolution,
        image_url=req.image_url,
    )
    return {"ok": result.get("status") == "done", **result}


@router.get("/models")
async def list_default_models():
    """返回当前默认模型名，方便前端设置页展示。"""
    from ..services.video_gen_service import _T2I_MODEL_DEFAULT, _I2V_MODEL_DEFAULT

    return {
        "t2i_default": _T2I_MODEL_DEFAULT,
        "i2v_default": _I2V_MODEL_DEFAULT,
        "t2i_model_setting": "image_model",
        "i2v_model_setting": "video_model_i2v",
    }


POLISH_SYSTEM = {
    "image": (
        "你是 AI 绘画提示词专家。把用户随手写的中文描述扩写为一条专业的文生图提示词，"
        "按「人物特征（年龄/性别/发型）+ 服装造型 + 表情动作 + 构图景别 + 光线氛围 + 画面风格」组织，"
        "只输出最终提示词本身（一段中文，80~150字），不要任何解释、引号或前后缀。"
        "保留用户指定的核心人物特征，不得改变人物身份。"
    ),
    "video": (
        "你是 AI 视频提示词专家。把用户随手写的中文描述扩写为一条专业的图生视频提示词，"
        "重点描述「人物动作 + 镜头运动 + 表情变化 + 节奏」，动作幅度写小一点（适合口播视频），"
        "只输出最终提示词本身（一段中文，50~120字），不要任何解释、引号或前后缀。"
    ),
}


# ---- 润色 System Prompt 三级优先：设置库(页面可改) > prompts/*.txt 文件 > 代码默认值 ----
POLISH_SETTING_KEYS = {"image": "polish_image_prompt", "video": "polish_video_prompt"}
PROMPT_FILES = {"image": "polish_image_prompt.txt", "video": "polish_video_prompt.txt"}
PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts"


def _file_prompt(mode: str) -> str:
    """读取 prompts 目录下的默认提示词文件，读不到返回空。"""
    try:
        text = (PROMPTS_DIR / PROMPT_FILES[mode]).read_text(encoding="utf-8").strip()
        return text
    except Exception:
        return ""


async def _effective_polish_prompt(mode: str) -> str:
    """返回实际生效的润色 System Prompt。"""
    saved = await get_setting(POLISH_SETTING_KEYS[mode])
    if saved and saved.strip():
        return saved.strip()
    file_prompt = _file_prompt(mode)
    if file_prompt:
        return file_prompt
    return POLISH_SYSTEM[mode]


@router.get("/polish-prompt-config/{mode}")
async def get_polish_config(mode: str):
    """读取润色提示词配置：当前生效值 + 文件默认值 + 是否自定义。"""
    if mode not in POLISH_SYSTEM:
        mode = "image"
    saved = await get_setting(POLISH_SETTING_KEYS[mode])
    return {
        "mode": mode,
        "setting_key": POLISH_SETTING_KEYS[mode],
        "saved": saved or "",
        "file_default": _file_prompt(mode),
        "effective": await _effective_polish_prompt(mode),
        "is_custom": bool(saved and saved.strip()),
    }


@router.put("/polish-prompt-config/{mode}")
async def save_polish_config(mode: str, req: dict, db: AsyncSession = Depends(get_db)):
    """保存/清除润色提示词。prompt 传空字符串表示恢复默认（删除设置库里的自定义值）。"""
    if mode not in POLISH_SYSTEM:
        return {"ok": False, "error": "mode 需为 image 或 video"}
    value = (req.get("prompt") or "").strip()
    result = await db.execute(select(Setting).where(Setting.key == POLISH_SETTING_KEYS[mode]))
    s = result.scalar_one_or_none()
    if value:
        if s:
            s.value = value
        else:
            db.add(Setting(key=POLISH_SETTING_KEYS[mode], value=value))
    elif s:
        await db.delete(s)
    await db.commit()
    clear_setting_cache()
    return {"ok": True, "is_custom": bool(value)}


@router.post("/polish-prompt")
async def polish_prompt(req: dict):
    """用已配置的 LLM 润色生图/生视频提示词。body: {prompt, mode: image|video}"""
    import httpx
    from ..services.llm_service import LLM_BASE_URLS

    prompt = (req.get("prompt") or "").strip()
    mode = req.get("mode") or "image"
    if not prompt:
        return {"ok": False, "error": "prompt 不能为空"}
    if mode not in POLISH_SYSTEM:
        mode = "image"

    service = await get_setting("llm_service")
    api_key = await get_setting("llm_api_key")
    if not service or not api_key:
        return {"ok": False, "error": "请先在设置页配置 LLM 服务"}

    base_url = LLM_BASE_URLS.get(service, LLM_BASE_URLS["openai"])
    model = await get_setting("llm_model") or "gpt-4o"

    system_prompt = await _effective_polish_prompt(mode)

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.7,
                    "max_tokens": 600,
                },
            )
            if resp.status_code != 200:
                return {"ok": False, "error": f"LLM 调用失败: HTTP {resp.status_code}"}
            content = resp.json()["choices"][0]["message"]["content"].strip()
            return {"ok": True, "polished": content}
    except Exception as e:
        return {"ok": False, "error": str(e)}

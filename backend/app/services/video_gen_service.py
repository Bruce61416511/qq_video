"""
视频生成服务
参考 MoneyPrinterTurbo: app/services/material.py
支持 可灵 Kling / 即梦 Jimeng / Runway / Wan-2.1
"""
import asyncio
import httpx
from ..config import get_setting

_VIDEO_MODEL_DEFAULTS = {
    "wan": "wan2.7-t2v",
    "kling": "kling-v1",
    "jimeng": "jimeng-t2v",
    "runway": "gen3a_turbo",
    "cogvideo": "cogvideox-2b",
}

# 图生视频默认模型（百炼），可在设置 video_model_i2v 中覆盖
_I2V_MODEL_DEFAULT = "wan2.2-i2v-flash"
# 文生图默认模型（百炼），可在设置 image_model 中覆盖
_T2I_MODEL_DEFAULT = "wan2.2-t2i-flash"


def _video_model_for(service: str) -> str:
    """Return the default model for a given video service."""
    return _VIDEO_MODEL_DEFAULTS.get(service, "wanx2.1-t2v-plus")


def _ratio_to_pixels(size: str) -> str:
    """Map aspect ratio string to Bailian t2i pixel size."""
    return {"9:16": "720*1280", "16:9": "1280*720", "1:1": "1024*1024"}.get(size, "720*1280")


def _image_to_url(image: str) -> str:
    """Accept a public URL or a local file path; return what Bailian img_url expects.

    - http(s) URL: passthrough
    - local path: convert to base64 data URI
    """
    import base64
    import mimetypes
    from pathlib import Path as _Path

    if not image:
        return ""
    if image.startswith(("http://", "https://", "data:")):
        return image
    p = _Path(image)
    if p.exists():
        mime = mimetypes.guess_type(str(p))[0] or "image/png"
        b64 = base64.b64encode(p.read_bytes()).decode()
        return f"data:{mime};base64,{b64}"
    return image


async def _bailian_upload_file(api_key: str, model: str, file_path: str) -> str:
    """上传本地文件到百炼临时存储，返回 oss:// URL（48 小时有效）。

    wan2.2-s2v 要求公网 URL（不接受 base64 data URI），本地文件走此上传流程：
    1) GET /api/v1/uploads?action=getPolicy&model=xxx  获取上传凭证
    2) POST 文件到凭证里的 OSS host
    3) 拼接 oss://{upload_dir}/{filename}
    """
    import uuid as _uuid
    from pathlib import Path as _Path

    if not file_path:
        return ""
    if file_path.startswith(("http://", "https://", "oss://")):
        return file_path
    p = _Path(file_path)
    if not p.exists():
        print(f"[S2V] upload: file not found: {file_path}")
        return ""

    async with httpx.AsyncClient(timeout=120.0) as client:
        policy_resp = await client.get(
            "https://dashscope.aliyuncs.com/api/v1/uploads",
            params={"action": "getPolicy", "model": model},
            headers={"Authorization": f"Bearer {api_key}"},
        )
        if policy_resp.status_code != 200:
            print(f"[S2V] getPolicy error: {policy_resp.status_code} {policy_resp.text[:300]}")
            return ""
        data = policy_resp.json().get("data", {})
        if not data.get("upload_dir"):
            print(f"[S2V] getPolicy no upload_dir: {policy_resp.text[:300]}")
            return ""

        key = f"{data['upload_dir']}/{_uuid.uuid4().hex[:8]}_{p.name}"
        form = {
            "OSSAccessKeyId": data.get("oss_access_key_id", ""),
            "policy": data.get("policy", ""),
            "Signature": data.get("signature", ""),
            "key": key,
            "x-oss-object-acl": data.get("x_oss_object_acl", "private"),
            "x-oss-forbid-overwrite": data.get("x_oss_forbid_overwrite", "true"),
            "success_action_status": "200",
        }
        files = {"file": (p.name, p.read_bytes())}
        up = await client.post(data.get("upload_host", ""), data=form, files=files)
        if up.status_code not in (200, 201):
            print(f"[S2V] upload error: {up.status_code} {up.text[:300]}")
            return ""
        return f"oss://{key}"


def _probe_audio_duration(audio_path: str) -> float:
    """ffprobe 获取音频时长，失败返回 0。"""
    import json as _json
    import subprocess as _sub
    try:
        probe = _sub.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", audio_path],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=10,
        )
        if probe.returncode == 0:
            return float(_json.loads(probe.stdout).get("format", {}).get("duration", 0))
    except Exception:
        pass
    return 0.0


async def generate_s2v_clip(image_url: str, audio_path: str, resolution: str = "720P", progress_callback=None):
    """数字人口播生成（wan2.2-s2v，音频驱动口型同步）。

    输入：定妆照（本地路径或 URL）+ TTS 音频（<20s）
    输出：口型、表情、动作与音频同步的说话视频 URL。

    注意：该接口只支持华北2（北京）地域；输出分辨率仅 480P/720P。
    """
    api_key = await get_setting("video_api_key")
    workspace_id = await get_setting("video_api_secret")
    if not api_key or not workspace_id:
        return {"status": "no_api", "message": "未配置视频生成的百炼 KEY / workspace_id"}
    if not image_url:
        return {"status": "error", "service": "s2v", "message": "缺少定妆照"}
    if not audio_path:
        return {"status": "error", "service": "s2v", "message": "缺少配音音频"}

    # 音频限制：时长 < 20s
    adur = _probe_audio_duration(audio_path)
    if adur > 19.5:
        return {"status": "error", "service": "s2v",
                "message": f"配音时长 {adur:.1f}s 超过 s2v 的 20s 限制，请缩短台词或拆分分镜"}

    base_url = f"https://{workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1"
    # s2v 只有 480P/720P 两档：1080P 请求自动落到 720P
    res = "720P" if str(resolution).upper() in ("720P", "1080P") else "480P"

    async with httpx.AsyncClient(timeout=300.0) as client:
        # Step 1: 上传图片与音频（本地文件 -> oss://）
        img = await _bailian_upload_file(api_key, "wan2.2-s2v", image_url)
        if not img:
            return {"status": "error", "service": "s2v", "message": "定妆照上传失败"}
        aud = await _bailian_upload_file(api_key, "wan2.2-s2v", audio_path)
        if not aud:
            return {"status": "error", "service": "s2v", "message": "音频上传失败"}

        # Step 2: 创建任务
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "X-DashScope-Async": "enable",
            "X-DashScope-OssResourceResolve": "enable",
        }
        create_resp = await client.post(
            f"{base_url}/services/aigc/image2video/video-synthesis",
            headers=headers,
            json={
                "model": "wan2.2-s2v",
                "input": {"image_url": img, "audio_url": aud},
                "parameters": {"resolution": res},
            },
        )
        if create_resp.status_code != 200:
            error_text = create_resp.text[:500]
            print(f"[S2V] create error: {error_text}")
            return {"status": "error", "service": "s2v", "message": error_text}

        task_id = create_resp.json().get("output", {}).get("task_id", "")
        if not task_id:
            print(f"[S2V] no task_id: {create_resp.text[:300]}")
            return {"status": "error", "service": "s2v", "message": "no task_id"}
        print(f"[S2V] task created: {task_id}")

        # Step 3: 轮询（s2v 生成约 5~10 分钟）
        for attempt in range(80):  # max ~20 min with 15s interval
            await asyncio.sleep(15)
            if progress_callback:
                await progress_callback(min(99, int((attempt + 1) / 80 * 100)))
            poll_resp = await client.get(
                f"{base_url}/tasks/{task_id}",
                headers={"Authorization": f"Bearer {api_key}"},
            )
            if poll_resp.status_code != 200:
                continue
            poll_data = poll_resp.json()
            status = poll_data.get("output", {}).get("task_status", "")
            if status == "SUCCEEDED":
                video_url = (poll_data.get("output", {}).get("results") or {}).get("video_url", "")
                print(f"[S2V] done: {video_url[:60]}...")
                return {"status": "done", "url": video_url, "task_id": task_id}
            if status == "FAILED":
                msg = poll_data.get("output", {}).get("message", "unknown error")
                print(f"[S2V] failed: {msg}")
                return {"status": "error", "service": "s2v", "message": msg}
            if attempt % 4 == 0:
                print(f"[S2V] polling... attempt {attempt + 1}, status={status}")

        return {"status": "timeout", "service": "s2v", "task_id": task_id}


async def generate_image(prompt: str, size: str = "9:16", count: int = 1, progress_callback=None):
    """Text-to-image via Alibaba Bailian (wan2.2-t2i series).

    Settings used: image_api_key (or fallback video_api_key),
    image_api_secret (or fallback video_api_secret, used as workspace_id),
    image_model (default wan2.2-t2i-flash).

    Returns: {"status": "done", "urls": [...], "task_id": ...} on success.
    """
    import base64

    api_key = await get_setting("image_api_key") or await get_setting("video_api_key")
    workspace_id = await get_setting("image_api_secret") or await get_setting("video_api_secret")
    if not api_key:
        return {"status": "no_api", "message": "未配置 image_api_key / video_api_key，跳过文生图"}
    if not workspace_id:
        return {"status": "no_api", "message": "未配置 image_api_secret / video_api_secret（workspace_id）"}

    model = await get_setting("image_model") or _T2I_MODEL_DEFAULT
    base_url = f"https://{workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1"

    prompt = prompt + " --no text, words, letters, numbers, subtitles, watermark, UI elements, labels"

    async with httpx.AsyncClient(timeout=300.0) as client:
        create_resp = await client.post(
            f"{base_url}/services/aigc/text2image/image-synthesis",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "X-DashScope-Async": "enable",
            },
            json={
                "model": model,
                "input": {"prompt": prompt},
                "parameters": {
                    "size": _ratio_to_pixels(size),
                    "n": max(1, min(int(count or 1), 4)),
                    "prompt_extend": True,
                },
            },
        )
        if create_resp.status_code != 200:
            return {"status": "error", "service": "wan_t2i", "message": create_resp.text[:500]}

        task_id = create_resp.json().get("output", {}).get("task_id", "")
        if not task_id:
            return {"status": "error", "service": "wan_t2i", "message": "no task_id"}

        for attempt in range(60):  # max ~5 min
            await asyncio.sleep(5)
            if progress_callback:
                await progress_callback(min(99, int((attempt + 1) / 60 * 100)))
            poll = await client.get(
                f"{base_url}/tasks/{task_id}",
                headers={"Authorization": f"Bearer {api_key}"},
            )
            if poll.status_code != 200:
                continue
            data = poll.json()
            status = data.get("output", {}).get("task_status", "")
            if status == "SUCCEEDED":
                results = data.get("output", {}).get("results", [])
                urls = [r.get("url", "") for r in results if r.get("url")]
                return {"status": "done", "urls": urls, "task_id": task_id}
            if status == "FAILED":
                msg = data.get("output", {}).get("message", "unknown error")
                return {"status": "error", "service": "wan_t2i", "message": msg}

        return {"status": "timeout", "service": "wan_t2i", "task_id": task_id}

async def generate_video_clip(prompt: str, duration: str = "5", size: str = "9:16", resolution: str = "1080P", progress_callback=None, image_url: str = ""):
    """Generate a video clip from text prompt, or from image+prompt (image-to-video).

    If image_url is provided (public URL or local file path), the wan handler
    switches to image-to-video (i2v) mode automatically.

    Returns: URL or local file path to the generated video.
    Currently returns placeholder - real API integration requires API keys.
    """
    service = await get_setting("video_service")
    model = await get_setting("video_model") or _video_model_for(service)
    api_key = await get_setting("video_api_key")
    api_secret = await get_setting("video_api_secret")

    if not service or not api_key:
        return {"status": "no_api", "message": f"视频生成服务未配置，跳过: {prompt[:40]}..."}

    # Append negative prompt to prevent text/subtitles in generated video
    prompt = prompt + " --no text, words, letters, numbers, subtitles, watermark, UI elements, labels"

    if service == "wan":
        try:
            return await _wan_generate(prompt, duration, size, resolution, model, api_key, api_secret, progress_callback, image_url)
        except Exception as e:
            print(f"[VideoGen] {service} error: {e}")
            return {"status": "error", "service": service, "message": str(e), "prompt": prompt[:40]}

    handlers = {
        "kling": _kling_generate,
        "jimeng": _jimeng_generate,
        "runway": _runway_generate,
        "cogvideo": _cogvideo_generate,
    }

    handler = handlers.get(service)
    if handler:
        try:
            return await handler(prompt, duration, size, resolution, model, api_key, api_secret, progress_callback)
        except Exception as e:
            print(f"[VideoGen] {service} error: {e}")
            return {"status": "error", "service": service, "message": str(e), "prompt": prompt[:40]}

    return {"status": "unknown_service", "service": service, "message": f"未知服务: {service}"}


async def _kling_generate(prompt: str, duration: str, size: str, resolution: str, model: str, api_key: str, api_secret: str, progress_callback=None):
    """Kling AI video generation.
    Model: configurable via Settings (default: kling-v1)
    API docs: https://api.klingai.com
    Flow: create task -> poll status -> get video URL -> download
    """
    # Use service-specific fallback if no model explicitly set
    kling_model = model or _video_model_for("kling")

    # Step 1: Create task
    async with httpx.AsyncClient(timeout=120.0) as client:
        create_resp = await client.post(
            "https://api.klingai.com/v1/videos/text2video",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model_name": kling_model,
                "prompt": prompt,
                "duration": duration,
                "mode": "std",
                "aspect_ratio": size.replace(":", ":"),
            },
        )
        if create_resp.status_code != 200:
            return {"status": "error", "service": "kling", "message": create_resp.text}

        data = create_resp.json()
        task_id = data.get("data", {}).get("task_id")
        if not task_id:
            return {"status": "error", "service": "kling", "message": "无 task_id"}

        # Step 2: Poll for completion
        for _ in range(30):  # max 5 min
            await asyncio.sleep(10)
            poll = await client.get(
                f"https://api.klingai.com/v1/videos/text2video/{task_id}",
                headers={"Authorization": f"Bearer {api_key}"},
            )
            if poll.status_code != 200:
                continue
            poll_data = poll.json()
            status = poll_data.get("data", {}).get("task_status", "")
            if status == "succeed":
                video_url = poll_data.get("data", {}).get("task_result", {}).get("videos", [{}])[0].get("url", "")
                return {"status": "done", "url": video_url, "task_id": task_id}
            elif status == "failed":
                return {"status": "error", "service": "kling", "message": poll_data.get("data", {}).get("task_status_msg", "")}

        return {"status": "timeout", "service": "kling", "task_id": task_id}


async def _jimeng_generate(prompt: str, duration: str, size: str, resolution: str, model: str, api_key: str, api_secret: str, progress_callback=None):
    """即梦 Jimeng video generation. Placeholder - API docs needed."""
    return {"status": "not_implemented", "service": "jimeng", "message": "即梦 API 接入待实现"}


async def _runway_generate(prompt: str, duration: str, size: str, resolution: str, model: str, api_key: str, api_secret: str, progress_callback=None):
    """Runway Gen-3 video generation. Placeholder."""
    return {"status": "not_implemented", "service": "runway", "message": "Runway API 接入待实现"}


async def _wan_generate(prompt: str, duration: str, size: str, resolution: str, model: str, api_key: str, api_secret: str, progress_callback=None, image_url: str = ""):
    """Wan via Alibaba Bailian API.

    - No image_url: text-to-video (model e.g. wan2.7-t2v, set via video_model)
    - With image_url (public URL or local path): image-to-video (model default
      wan2.2-i2v-flash, set via video_model_i2v)
    Flow: create task -> poll status -> get video URL -> download
    """
    is_i2v = bool(image_url)

    if is_i2v:
        i2v_model = await get_setting("video_model_i2v") or _I2V_MODEL_DEFAULT
        wan_model = i2v_model.lower()
    else:
        wan_model = (model or _video_model_for("wan")).lower()

    # api_secret is used as workspace ID for Bailian endpoint
    workspace_id = api_secret or ""
    if not workspace_id:
        return {"status": "error", "service": "wan", "message": "missing workspace_id (set video_api_secret)"}

    # Build Bailian API base URL
    base_url = f"https://{workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1"

    # Map size to ratio
    ratio_map = {"9:16": "9:16", "16:9": "16:9", "1:1": "1:1"}
    ratio = ratio_map.get(size, "9:16")

    # Map resolution (720P / 1080P)
    res = resolution if resolution in ("720P", "1080P") else "720P"

    # Map duration to supported values, clamp to [5, 15]
    try:
        dur = int(duration)
    except (ValueError, TypeError):
        dur = 5
    if dur > 15:
        print(f"[VideoGen] Wan: duration {duration}s clamped to 15s max")
        dur = 15
    if dur < 5:
        dur = 5

    async with httpx.AsyncClient(timeout=300.0) as client:
        # Step 1: Create video generation task
        task_input = {"prompt": prompt}
        if is_i2v:
            img = _image_to_url(image_url)
            if not img:
                return {"status": "error", "service": "wan", "message": f"图片不可用: {image_url}"}
            task_input["img_url"] = img

        create_body = {
            "model": wan_model,
            "input": task_input,
            "parameters": {
                "resolution": res,
                "ratio": ratio,
                "prompt_extend": True,
                "watermark": True,
                "duration": dur,
            },
        }

        print(f"[VideoGen] Wan create ({'i2v' if is_i2v else 't2v'}): model={wan_model}, res={res}, ratio={ratio}, dur={dur}s")

        create_resp = await client.post(
            f"{base_url}/services/aigc/video-generation/video-synthesis",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "X-DashScope-Async": "enable",
            },
            json=create_body,
        )

        if create_resp.status_code != 200:
            error_text = create_resp.text[:500]
            print(f"[VideoGen] Wan create error: {error_text}")
            return {"status": "error", "service": "wan", "message": error_text}

        create_data = create_resp.json()
        task_id = create_data.get("output", {}).get("task_id", "")

        if not task_id:
            print(f"[VideoGen] Wan: no task_id in response: {create_data}")
            return {"status": "error", "service": "wan", "message": "no task_id"}

        print(f"[VideoGen] Wan task created: {task_id}")

        # Step 2: Poll for completion
        for attempt in range(60):  # max ~10 min with 10s interval
            await asyncio.sleep(10)
            if progress_callback:
                pct = min(99, int((attempt + 1) / 60 * 100))
                await progress_callback(pct)
            poll_resp = await client.get(
                f"{base_url}/tasks/{task_id}",
                headers={"Authorization": f"Bearer {api_key}"},
            )

            if poll_resp.status_code != 200:
                continue

            poll_data = poll_resp.json()
            status = poll_data.get("output", {}).get("task_status", "")

            if status == "SUCCEEDED":
                video_url = poll_data.get("output", {}).get("video_url", "")
                print(f"[VideoGen] Wan done: {video_url[:60]}...")
                return {"status": "done", "url": video_url, "task_id": task_id}
            elif status == "FAILED":
                msg = poll_data.get("output", {}).get("message", "unknown error")
                print(f"[VideoGen] Wan failed: {msg}")
                return {"status": "error", "service": "wan", "message": msg}

            if attempt % 3 == 0:
                print(f"[VideoGen] Wan polling... attempt {attempt+1}, status={status}")

        return {"status": "timeout", "service": "wan", "task_id": task_id}


async def _cogvideo_generate(prompt: str, duration: str, size: str, resolution: str, model: str, api_key: str, api_secret: str, progress_callback=None):
    """CogVideo - open source, can run locally or via API."""
    return {"status": "not_implemented", "service": "cogvideo", "message": "CogVideo 接入待实现"}
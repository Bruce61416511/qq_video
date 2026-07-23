"""
视频生成服务
参考 MoneyPrinterTurbo: app/services/material.py
支持 可灵 Kling / 即梦 Jimeng / Runway / Wan-2.1
"""
import httpx
from ..config import get_setting


async def generate_video_clip(prompt: str, duration: str = "5", size: str = "9:16", resolution: str = "1080P") -> str:
    """Generate a video clip from text prompt.
    
    Returns: URL or local file path to the generated video.
    Currently returns placeholder - real API integration requires API keys.
    """
    service = await get_setting("video_service")
    api_key = await get_setting("video_api_key")
    api_secret = await get_setting("video_api_secret")

    if not service or not api_key:
        return {"status": "no_api", "message": f"视频生成服务未配置，跳过: {prompt[:40]}..."}

    handlers = {
        "kling": _kling_generate,
        "jimeng": _jimeng_generate,
        "runway": _runway_generate,
        "wan": _wan_generate,
        "cogvideo": _cogvideo_generate,
    }

    handler = handlers.get(service)
    if handler:
        try:
            return await handler(prompt, duration, size, resolution, api_key, api_secret)
        except Exception as e:
            print(f"[VideoGen] {service} error: {e}")
            return {"status": "error", "service": service, "message": str(e), "prompt": prompt[:40]}

    return {"status": "unknown_service", "service": service, "message": f"未知服务: {service}"}


async def _kling_generate(prompt: str, duration: str, size: str, resolution: str, api_key: str, api_secret: str):
    """Kling AI video generation.
    API docs: https://api.klingai.com
    Flow: create task -> poll status -> get video URL -> download
    """
    # Step 1: Create task
    async with httpx.AsyncClient(timeout=120.0) as client:
        create_resp = await client.post(
            "https://api.klingai.com/v1/videos/text2video",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model_name": "kling-v1",
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
        import asyncio
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


async def _jimeng_generate(prompt: str, duration: str, size: str, resolution: str, api_key: str, api_secret: str):
    """即梦 Jimeng video generation. Placeholder - API docs needed."""
    return {"status": "not_implemented", "service": "jimeng", "message": "即梦 API 接入待实现"}


async def _runway_generate(prompt: str, duration: str, size: str, resolution: str, api_key: str, api_secret: str):
    """Runway Gen-3 video generation. Placeholder."""
    return {"status": "not_implemented", "service": "runway", "message": "Runway API 接入待实现"}


async def _wan_generate(prompt: str, duration: str, size: str, resolution: str, api_key: str, api_secret: str):
    """Wan-2.1 via Alibaba Bailian (DashScope) API.
    Model: wanx2.1-t2v-plus
    Flow: create task -> poll status -> get video URL -> download
    """
    import asyncio
    
    # Map size to aspect ratio for Wan
    ratio_map = {"9:16": "9:16", "16:9": "16:9", "1:1": "1:1"}
    aspect = ratio_map.get(size, "9:16")
    
    duration_map = {"3": 3, "5": 5, "10": 10, "15": 15, "30": 30}
    dur = duration_map.get(duration, 5)
    if dur > 10:
        dur = 10  # wanx2.1 max ~10s per call; longer shots split upstream
    
    async with httpx.AsyncClient(timeout=300.0) as client:
        # Step 1: Create video generation task
        create_body = {
            "model": "wanx2.1-t2v-plus",
            "input": {
                "prompt": prompt,
                "duration": dur,
            },
            "parameters": {
                "size": "1280*720" if size == "16:9" else ("720*1280" if size == "9:16" else "1024*1024"),
                "prompt_extend": True,
            },
        }
        
        create_resp = await client.post(
            "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "X-DashScope-Async": "enable",
            },
            json=create_body,
        )
        
        if create_resp.status_code != 200:
            error_text = create_resp.text[:300]
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
            
            poll_resp = await client.get(
                f"https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}",
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


async def _cogvideo_generate(prompt: str, duration: str, size: str, resolution: str, api_key: str, api_secret: str):
    """CogVideo - open source, can run locally or via API."""
    return {"status": "not_implemented", "service": "cogvideo", "message": "CogVideo 接入待实现"}
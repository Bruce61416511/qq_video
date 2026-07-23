import asyncio
import os
from pathlib import Path
from datetime import datetime
from playwright.async_api import async_playwright
from .qrcode_service import _cookie_path

BASE_DIR = Path(__file__).resolve().parent.parent.parent
SCREENSHOT_DIR = BASE_DIR / "screenshots"
SCREENSHOT_DIR.mkdir(exist_ok=True)

async def publish_video(
    account_id: int,
    video_path: str,
    title: str,
    tags: str = "",
    publish_date: datetime | None = None,
) -> dict:
    cookie_file = _cookie_path(account_id)
    if not os.path.exists(cookie_file):
        return {"ok": False, "error": "未找到账号登录信息，请先扫码绑定"}

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=False,
            args=["--disable-blink-features=AutomationControlled"],
        )
        context = await browser.new_context(storage_state=cookie_file)
        page = await context.new_page()

        try:
            print("[Publish] 打开发布页...")
            await page.goto(
                "https://channels.weixin.qq.com/platform/post/create",
                wait_until="networkidle",
                timeout=30000,
            )
            await page.screenshot(path=str(SCREENSHOT_DIR / f"step1_page.png"))
            print(f"[Publish] 页面URL: {page.url}")

            # Check if redirected to login
            if "login" in page.url:
                await context.close()
                await browser.close()
                return {"ok": False, "error": "登录已过期，请重新扫码"}

            abs_video_path = os.path.abspath(video_path)
            if not os.path.exists(abs_video_path):
                return {"ok": False, "error": f"视频文件不存在: {abs_video_path}"}

            # Upload video
            print("[Publish] 上传视频...")
            file_input = page.locator('input[type="file"]')
            await file_input.set_input_files(abs_video_path)
            await page.screenshot(path=str(SCREENSHOT_DIR / f"step2_uploaded.png"))
            print("[Publish] 视频已选择，等待处理...")

            # Wait for upload to complete
            try:
                await page.wait_for_selector(".media-status-content", timeout=120000)
                await asyncio.sleep(5)
                print("[Publish] 视频处理完成")
            except Exception as e:
                print(f"[Publish] 等待上传超时: {e}")
            await page.screenshot(path=str(SCREENSHOT_DIR / f"step3_processed.png"))

            # Fill title
            try:
                print("[Publish] 填写标题...")
                title_editor = page.locator("div.input-editor").first
                await title_editor.click()
                await asyncio.sleep(1)
                await page.keyboard.press("Control+KeyA")
                await page.keyboard.type(title)
                await asyncio.sleep(1)
                print(f"[Publish] 标题已填写: {title}")
            except Exception as e:
                print(f"[Publish] 标题填写失败: {e}")
            await page.screenshot(path=str(SCREENSHOT_DIR / f"step4_titled.png"))

            # Fill tags
            if tags:
                try:
                    print("[Publish] 添加标签...")
                    tag_btn = page.locator('div:has-text("添加标签")').first
                    if await tag_btn.count() > 0:
                        await tag_btn.click()
                        await asyncio.sleep(0.5)
                        tag_input = page.locator('input[placeholder*="标签"]').first
                        if await tag_input.count() > 0:
                            await tag_input.fill(tags)
                            await asyncio.sleep(0.5)
                except Exception as e:
                    print(f"[Publish] 标签失败: {e}")

            # Click publish
            await page.screenshot(path=str(SCREENSHOT_DIR / f"step5_before_publish.png"))
            await asyncio.sleep(2)
            try:
                print("[Publish] 点击发表按钮...")
                publish_btn = page.get_by_role("button", name="发表").first
                if await publish_btn.count() == 0:
                    publish_btn = page.locator('button:has-text("发表")').first
                await publish_btn.click()
                print("[Publish] 已点击发表")
            except Exception as e:
                return {"ok": False, "error": f"未找到发布按钮: {e}"}

            # Wait for publish result
            await asyncio.sleep(8)
            await page.screenshot(path=str(SCREENSHOT_DIR / f"step6_after_publish.png"))
            print(f"[Publish] 发布后URL: {page.url}")

            # Check for success/failure indicators
            page_text = await page.inner_text("body")
            if "发表成功" in page_text or "已发表" in page_text:
                print("[Publish] 检测到发表成功")
            elif "失败" in page_text:
                print(f"[Publish] 检测到失败信息: {page_text[:500]}")

            await context.close()
            await browser.close()
            print("[Publish] 发布流程完成")
            return {"ok": True, "message": "发布成功"}

        except Exception as e:
            try:
                await page.screenshot(path=str(SCREENSHOT_DIR / f"step_error.png"))
            except:
                pass
            try:
                await context.close()
                await browser.close()
            except Exception:
                pass
            print(f"[Publish] 异常: {e}")
            return {"ok": False, "error": str(e)}

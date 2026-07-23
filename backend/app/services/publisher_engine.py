import asyncio
import json
import os
from pathlib import Path
from datetime import datetime
from playwright.async_api import async_playwright
from .qrcode_service import _cookie_path

BASE_DIR = Path(__file__).resolve().parent.parent.parent
SCREENSHOT_DIR = BASE_DIR / "screenshots"
SCREENSHOT_DIR.mkdir(exist_ok=True)
VIDEO_PROCESSING_TIMEOUT = 300

async def publish_video(
    account_id: int,
    video_path: str,
    title: str,
    tags: str = "",
    publish_date: datetime | None = None,
) -> dict:
    cookie_file = _cookie_path(account_id)
    if not os.path.exists(cookie_file):
        return {"ok": False, "error": "no cookies, please scan QR first"}

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=False,
            args=["--disable-blink-features=AutomationControlled"],
        )
        context = await browser.new_context(storage_state=cookie_file)
        page = await context.new_page()

        try:
            print("[Publish] opening create page...")
            await page.goto(
                "https://channels.weixin.qq.com/platform/post/create",
                timeout=30000,
            )
            await page.screenshot(path=str(SCREENSHOT_DIR / "step1_page.png"))
            print(f"[Publish] page URL: {page.url}")

            if "/login" in page.url:
                await context.close()
                await browser.close()
                return {"ok": False, "error": "login expired, please re-scan QR"}

            abs_video_path = os.path.abspath(video_path)
            if not os.path.exists(abs_video_path):
                return {"ok": False, "error": f"video file not found: {abs_video_path}"}

            print("[Publish] uploading video...")
            file_input = page.locator('input[type="file"]')
            await file_input.set_input_files(abs_video_path)
            await page.screenshot(path=str(SCREENSHOT_DIR / "step2_uploaded.png"))
            print("[Publish] video selected, waiting...")

            # === wait for video processing ===
            print(f"[Publish] waiting for processing (max {VIDEO_PROCESSING_TIMEOUT}s)...")
            processing_done = False
            had_status = False
            for i in range(VIDEO_PROCESSING_TIMEOUT):
                await asyncio.sleep(1)
                try:
                    st = await page.locator(".media-status-content").first.inner_text(timeout=500)
                    had_status = True
                    if i % 5 == 0 or '\u5931\u8d25' in st or '\u6210\u529f' in st:
                        print(f"[Publish] [{i}s] status: {st[:100]}")
                    if '\u5931\u8d25' in st:
                        await context.close()
                        await browser.close()
                        return {"ok": False, "error": f"processing failed: {st[:200]}"}
                    if '\u6210\u529f' in st or '\u5904\u7406\u5b8c\u6210' in st or "100%" in st:
                        print(f"[Publish] processing done ({i}s)")
                        processing_done = True
                        break
                except:
                    if had_status:
                        try:
                            editor = page.locator("div.input-editor").first
                            if await editor.count() > 0:
                                print(f"[Publish] [{i}s] status gone, editor visible -> done")
                                processing_done = True
                                break
                        except:
                            pass
                    if i % 30 == 0:
                        print(f"[Publish] [{i}s] waiting for status...")

            if not processing_done:
                print(f"[Publish] WARNING timeout, trying to continue...")

            await page.screenshot(path=str(SCREENSHOT_DIR / "step3_processed.png"))
            await asyncio.sleep(3)

            await _fill_title(page, title)
            await page.screenshot(path=str(SCREENSHOT_DIR / "step4_titled.png"))

            if tags:
                try:
                    print("[Publish] adding tags...")
                    tag_btn = page.locator('div:has-text("添加标签")').first
                    if await tag_btn.count() > 0:
                        await tag_btn.click()
                        await asyncio.sleep(0.5)
                        tag_input = page.locator('input[placeholder*="标签"]').first
                        if await tag_input.count() > 0:
                            await tag_input.fill(tags)
                            await asyncio.sleep(0.5)
                except Exception as e:
                    print(f"[Publish] tag error: {e}")

            await page.screenshot(path=str(SCREENSHOT_DIR / "step5_before_publish.png"))
            await asyncio.sleep(2)

            print("[Publish] clicking publish button...")
            publish_btn = page.get_by_role("button", name="发表").first
            if await publish_btn.count() == 0:
                publish_btn = page.locator('button:has-text("发表")').first
            if await publish_btn.count() == 0:
                return {"ok": False, "error": "publish button not found"}
            await publish_btn.click()
            print("[Publish] publish button clicked")

            result = await _wait_publish_result(page, 60)
            await page.screenshot(path=str(SCREENSHOT_DIR / "step6_after_publish.png"))

            await context.close()
            await browser.close()
            print(f"[Publish] done: {result.get('message', result.get('error', ''))}")
            return result

        except Exception as e:
            try:
                await page.screenshot(path=str(SCREENSHOT_DIR / "step_error.png"))
            except:
                pass
            try:
                await context.close()
                await browser.close()
            except Exception:
                pass
            print(f"[Publish] exception: {e}")
            return {"ok": False, "error": str(e)}


async def _fill_title(page, title: str):
    try:
        print("[Publish] filling title...")
        title_editor = page.locator("div.input-editor").first
        await title_editor.click()
        await asyncio.sleep(0.5)
        await page.keyboard.press("Control+KeyA")
        await page.keyboard.press("Backspace")
        await asyncio.sleep(0.3)
        await page.keyboard.type(title)
        await asyncio.sleep(1)
        print(f"[Publish] title filled: {title}")
    except Exception as e:
        print(f"[Publish] title error: {e}")


async def _wait_publish_result(page, timeout: int = 60) -> dict:
    print(f"[Publish] waiting for result (max {timeout}s)...")

    for i in range(timeout):
        await asyncio.sleep(1)

        try:
            url = page.url
            if "/create" not in url:
                print(f"[Publish] [{i}s] OK url changed -> {url}")
                return {"ok": True, "message": "published"}

            success_selectors = [
                'div:has-text("发表成功")',
                'div:has-text("发布成功")',
                'div:has-text("已发表")',
                'div:has-text("审核中")',
                '.weui-desktop-dialog__title:has-text("发表")',
                '[class*="success"]',
                '[class*="toast"]:has-text("成功")',
            ]
            for sel in success_selectors:
                try:
                    el = page.locator(sel).first
                    if await el.count() > 0 and await el.is_visible(timeout=500):
                        text = await el.inner_text(timeout=500)
                        print(f"[Publish] [{i}s] OK success: {text[:80]}")
                        confirm_btn = page.locator('button:has-text("确定"), button:has-text("我知道了"), button:has-text("关闭")').first
                        if await confirm_btn.count() > 0:
                            await confirm_btn.click()
                            await asyncio.sleep(1)
                        return {"ok": True, "message": f"published: {text[:80]}"}
                except:
                    pass

            error_selectors = [
                'div:has-text("发表失败")',
                'div:has-text("发布失败")',
                'div:has-text("失败")',
                '[class*="error"]:has-text("失败")',
                '.weui-desktop-dialog__title:has-text("失败")',
                '.weui-desktop-dialog__title:has-text("错误")',
            ]
            for sel in error_selectors:
                try:
                    el = page.locator(sel).first
                    if await el.count() > 0 and await el.is_visible(timeout=500):
                        text = await el.inner_text(timeout=500)
                        print(f"[Publish] [{i}s] FAIL: {text[:120]}")
                        return {"ok": False, "error": f"publish failed: {text[:200]}"}
                except:
                    pass

        except Exception as e:
            if i % 10 == 0:
                print(f"[Publish] [{i}s] poll error: {e}")

        if i % 10 == 0:
            print(f"[Publish] [{i}s] waiting... URL={url[:80]}")

    print(f"[Publish] WARNING timeout, checking page...")
    try:
        if "/create" in page.url:
            return {"ok": False, "error": "publish timeout, may still be processing"}
        else:
            return {"ok": True, "message": "publish done (timeout but page changed)"}
    except:
        return {"ok": False, "error": "publish timeout, unable to confirm"}
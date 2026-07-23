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
VIDEO_PROCESSING_TIMEOUT = 300  # 5分钟

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
                timeout=30000,
            )
            await page.screenshot(path=str(SCREENSHOT_DIR / "step1_page.png"))
            print(f"[Publish] 页面URL: {page.url}")

            if "/login" in page.url:
                await context.close()
                await browser.close()
                return {"ok": False, "error": "登录已过期，请重新扫码"}

            abs_video_path = os.path.abspath(video_path)
            if not os.path.exists(abs_video_path):
                return {"ok": False, "error": f"视频文件不存在: {abs_video_path}"}

            # Upload video
            print("[Publish] 上传视频文件...")
            file_input = page.locator('input[type="file"]')
            await file_input.set_input_files(abs_video_path)
            await page.screenshot(path=str(SCREENSHOT_DIR / "step2_uploaded.png"))
            print("[Publish] 视频已选择，等待处理...")

            # 等待视频处理完成（最多5分钟，每秒轮询）
            print(f"[Publish] 等待视频处理完成（最长{VIDEO_PROCESSING_TIMEOUT}秒）...")
            processing_done = False
            for i in range(VIDEO_PROCESSING_TIMEOUT):
                await asyncio.sleep(1)
                try:
                    status_el = await page.locator(".media-status-content").first.inner_text(timeout=500)
                    if i % 5 == 0 or "成功" in status_el or "失败" in status_el:
                        print(f"[Publish] [{i}s] 状态: {status_el[:100]}")
                    if "失败" in status_el:
                        await context.close()
                        await browser.close()
                        return {"ok": False, "error": f"视频处理失败: {status_el[:200]}"}
                    if "成功" in status_el or "处理完成" in status_el or "100%" in status_el:
                        print(f"[Publish] 视频处理完成! ({i}s)")
                        processing_done = True
                        break
                except:
                    if i % 30 == 0:
                        print(f"[Publish] [{i}s] 等待处理状态元素出现...")

            if not processing_done:
                print(f"[Publish] WARNING 处理超时，尝试继续...")

            await page.screenshot(path=str(SCREENSHOT_DIR / "step3_processed.png"))
            await asyncio.sleep(3)

            # 填写标题
            await _fill_title(page, title)
            await page.screenshot(path=str(SCREENSHOT_DIR / "step4_titled.png"))

            # 填写标签
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
            await page.screenshot(path=str(SCREENSHOT_DIR / "step5_before_publish.png"))
            await asyncio.sleep(2)

            print("[Publish] 点击发表按钮...")
            publish_btn = page.get_by_role("button", name="发表").first
            if await publish_btn.count() == 0:
                publish_btn = page.locator('button:has-text("发表")').first
            if await publish_btn.count() == 0:
                return {"ok": False, "error": "未找到发布按钮"}
            await publish_btn.click()
            print("[Publish] 已点击发表")

            # 轮询发布结果（最多等60秒）
            result = await _wait_publish_result(page, 60)
            await page.screenshot(path=str(SCREENSHOT_DIR / "step6_after_publish.png"))

            await context.close()
            await browser.close()
            print(f"[Publish] 发布流程完成: {result.get('message', result.get('error', ''))}")
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
            print(f"[Publish] 异常: {e}")
            return {"ok": False, "error": str(e)}


async def _fill_title(page, title: str):
    """填写视频标题"""
    try:
        print("[Publish] 填写标题...")
        title_editor = page.locator("div.input-editor").first
        await title_editor.click()
        await asyncio.sleep(0.5)
        await page.keyboard.press("Control+KeyA")
        await page.keyboard.press("Backspace")
        await asyncio.sleep(0.3)
        await page.keyboard.type(title)
        await asyncio.sleep(1)
        print(f"[Publish] 标题已填写: {title}")
    except Exception as e:
        print(f"[Publish] 标题填写失败: {e}")


async def _wait_publish_result(page, timeout: int = 60) -> dict:
    """
    点完发表后轮询，检测成功或失败
    成功标志：
    - 页面跳转（不在 create 页）
    - 出现成功弹窗/toast
    - 出现"发表成功" / "已发表" / "审核中" 字样
    失败标志：
    - 出现错误弹窗/toast
    - 出现"失败" / "错误" 字样
    """
    print(f"[Publish] 等待发布结果（最长{timeout}秒）...")

    for i in range(timeout):
        await asyncio.sleep(1)

        try:
            # 1. 检查页面URL是否变化（离开创建页=成功）
            url = page.url
            if "/create" not in url:
                print(f"[Publish] [{i}s] OK 页面跳转，发布成功 -> {url}")
                return {"ok": True, "message": "发布成功"}

            # 2. 检查成功提示（弹窗/toast/确认对话框）
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
                        print(f"[Publish] [{i}s] OK 检测到成功提示: {text[:80]}")
                        # 检查有没有确认按钮
                        confirm_btn = page.locator('button:has-text("确定"), button:has-text("我知道了"), button:has-text("关闭")').first
                        if await confirm_btn.count() > 0:
                            await confirm_btn.click()
                            await asyncio.sleep(1)
                        return {"ok": True, "message": f"发布成功: {text[:80]}"}
                except:
                    pass

            # 3. 检查错误提示
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
                        print(f"[Publish] [{i}s] FAIL 检测到错误: {text[:120]}")
                        return {"ok": False, "error": f"发布失败: {text[:200]}"}
                except:
                    pass

        except Exception as e:
            if i % 10 == 0:
                print(f"[Publish] [{i}s] 轮询异常: {e}")

        if i % 10 == 0:
            print(f"[Publish] [{i}s] 等待中... URL={url[:80]}")

    # 超时：检查当前页面状态
    print(f"[Publish] WARNING 超时未检测到明确结果，检查当前页面...")
    try:
        if "/create" in page.url:
            return {"ok": False, "error": "发布超时，可能仍在处理中，请刷新查看"}
        else:
            return {"ok": True, "message": "发布流程完成（超时但页面已跳转）"}
    except:
        return {"ok": False, "error": "发布超时，无法确认结果"}

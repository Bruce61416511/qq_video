import asyncio
import concurrent.futures
import json
import os
from pathlib import Path
from playwright.async_api import async_playwright

BASE_DIR = Path(__file__).resolve().parent.parent.parent
COOKIE_DIR = BASE_DIR / "cookies"
COOKIE_DIR.mkdir(exist_ok=True)
_active_logins = {}

def _cookie_path(aid: int) -> str:
    return str(COOKIE_DIR / f"account_{aid}.json")

async def start_qr_login(account_id: int):
    global _active_logins
    if account_id in _active_logins:
        existing = _active_logins[account_id]
        if existing.get("status") in ("error",):
            # Previous session failed, allow retry
            _active_logins.pop(account_id, None)
        else:
            return {"qr_image": "", "status": "already_running"}

    # Matrix-style: use asyncio.run() in a thread to run the full Playwright flow
    result_holder = {"status": "waiting", "nickname": ""}
    _active_logins[account_id] = result_holder

    def _run_login():
        try:
            _do_sync()
        except Exception as e:
            result_holder["status"] = "error"
            result_holder["error"] = f"Thread error: {e}"
            import traceback
            traceback.print_exc()

    def _do_sync():
        async def _do():
            try:
                async with async_playwright() as pw:
                    browser = await pw.chromium.launch(headless=False)
                    context = await browser.new_context()
                    page = await context.new_page()

                    await page.goto(
                        "https://channels.weixin.qq.com/platform/login-for-iframe?dark_mode=true&host_type=1",
                        wait_until="networkidle"
                    )
                    await page.locator(".qrcode").click()
                    print(f"[QR #{account_id}] Matrix: login page ready")

                    # Poll for scan (Matrix-style with multiple detection methods)
                    num = 0
                    while True:
                        await asyncio.sleep(3)
                        scanned = False
                        try:
                            # Method 1: qr-tip text (new WeChat UI)
                            qr_tip = page.locator(".qr-tip")
                            if await qr_tip.count() > 0:
                                tip_text = await qr_tip.first.inner_text()
                                if "\u5df2\u626b\u7801" in tip_text or "\u786e\u8ba4" in tip_text:
                                    print(f"[QR #{account_id}] Scanned at #{num}, tip: {tip_text}")
                                    scanned = True
                            # Method 2: mask.show class (legacy)
                            if not scanned:
                                mask = page.locator(".mask").first
                                if await mask.count() > 0:
                                    cls = await mask.get_attribute("class") or ""
                                    if "show" in cls:
                                        print(f"[QR #{account_id}] Scanned at #{num}, mask.show")
                                        scanned = True
                            # Method 3: success-img visible
                            if not scanned:
                                success_img = page.locator(".success-img")
                                if await success_img.count() > 0 and await success_img.first.is_visible():
                                    print(f"[QR #{account_id}] Scanned at #{num}, success-img")
                                    scanned = True
                        except:
                            pass
                        if scanned:
                            break
                        num += 1
                        if num > 60:
                            result_holder["status"] = "error"
                            result_holder["error"] = "Scan timeout"
                            print(f"[QR #{account_id}] Timeout: scan not detected")
                            return

                    # Wait for confirm (Matrix: 6s)
                    print(f"[QR #{account_id}] Waiting 6s for confirm...")
                    await asyncio.sleep(6)

                    # Open platform page, get user info, save cookies
                    print(f"[QR #{account_id}] Opening platform page...")
                    platform_page = await context.new_page()
                    try:
                        await platform_page.goto(
                            "https://channels.weixin.qq.com/platform",
                            wait_until="load",
                            timeout=15000
                        )
                    except:
                        pass

                    await asyncio.sleep(3)

                    try:
                        nickname = ""
                        try:
                            nickname = await platform_page.locator("h2.finder-nickname").first.inner_text(timeout=5000)
                        except:
                            pass
                        result_holder["nickname"] = nickname
                        print(f"[QR #{account_id}] Nickname: {nickname}")
                    except:
                        pass

                    cookie_file = _cookie_path(account_id)
                    await context.storage_state(path=cookie_file)
                    await platform_page.close()

                    result_holder["status"] = "success"
                    print(f"[QR #{account_id}] SUCCESS - cookies saved")

            except Exception as e:
                result_holder["status"] = "error"
                result_holder["error"] = str(e)
                import traceback
                traceback.print_exc()
                print(f"[QR #{account_id}] Error: {e}")

        asyncio.run(_do())

    executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    executor.submit(_run_login)

    return {"qr_image": "", "status": "scan_in_browser"}

async def check_login_status(account_id: int):
    s = _active_logins.get(account_id)
    if not s: return {"status": "not_found"}
    if s.get("status") == "success": return {"status": "success"}
    if s.get("status") == "error": return {"status": "error", "message": s.get("error", "")}
    return {"status": "waiting"}

async def finish_login(account_id: int):
    s = _active_logins.pop(account_id, None)
    if not s: return {"ok": False, "error": "Session not found"}
    # Browser already auto-closed by asyncio.run() cleanup in thread
    if s.get("status") == "success":
        return {"ok": True, "cookies": _cookie_path(account_id), "nickname": s.get("nickname", "")}
    return {"ok": False, "error": s.get("error", "Unknown error")}

async def validate_cookies(account_id: int):
    cf = _cookie_path(account_id)
    if not os.path.exists(cf): return False
    try:
        with open(cf, "r") as f:
            data = json.load(f)
        return len(data.get("cookies", [])) > 0
    except:
        return False

async def check_cookies_visible(account_id: int):
    cf = _cookie_path(account_id)
    if not os.path.exists(cf):
        return {"valid": False, "message": "\u65e0\u767b\u5f55\u4fe1\u606f"}
    
    loop = asyncio.get_running_loop()
    result_holder = {}
    
    def _run():
        try:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as pw:
                browser = pw.chromium.launch(headless=False)
                context = browser.new_context(storage_state=cf)
                page = context.new_page()
                page.goto("https://channels.weixin.qq.com/platform", timeout=10000)
                import time
                time.sleep(3)
                url = page.url
                nickname = ""
                if "/login" not in url:
                    try:
                        nickname_el = page.query_selector("h2.finder-nickname")
                        if nickname_el:
                            nickname = nickname_el.inner_text()
                    except:
                        pass
                    context.storage_state(path=cf)
                context.close()
                browser.close()
                valid = "/login" not in url
                result_holder["result"] = {"valid": valid, "nickname": nickname, "message": "\u6709\u6548" if valid else "\u5df2\u8fc7\u671f"}
        except Exception as e:
            result_holder["result"] = {"valid": False, "message": str(e)}
    
    await loop.run_in_executor(None, _run)
    return result_holder.get("result", {"valid": False, "message": "\u68c0\u67e5\u5931\u8d25"})

def pseudo_status(): return {"status": "waiting"}
def pseudo_finish(account_id: int): return {"ok": True, "cookies": f"pseudo_{account_id}"}
async def pseudo_validate(account_id: int): return True

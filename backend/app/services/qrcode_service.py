import asyncio
import json
import os
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

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
            _active_logins.pop(account_id, None)
        else:
            return {"qr_image": "", "status": "already_running"}

    result_holder = {"status": "waiting", "nickname": ""}
    _active_logins[account_id] = result_holder

    def _do():
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(headless=False)
                context = browser.new_context()
                page = context.new_page()

                page.goto(
                    "https://channels.weixin.qq.com/platform/login-for-iframe?dark_mode=true&host_type=1",
                    wait_until="networkidle"
                )
                page.locator(".qrcode").click()
                print(f"[QR #{account_id}] login page ready, waiting for scan...")

                # Wait for page to settle, then capture initial mask state
                time.sleep(3)
                initial_mask_shown = False
                try:
                    mask = page.locator(".mask").first
                    if mask.count() > 0:
                        cls = mask.get_attribute("class") or ""
                        initial_mask_shown = "show" in cls
                except:
                    pass
                print(f"[QR #{account_id}] initial mask.show={initial_mask_shown}, waiting for scan...")

                num = 0
                while True:
                    time.sleep(3)
                    scanned = False
                    try:
                        mask = page.locator(".mask").first
                        if mask.count() > 0:
                            cls = mask.get_attribute("class") or ""
                            if "show" in cls and not initial_mask_shown:
                                print(f"[QR #{account_id}] Scanned at #{num}, mask.show appeared")
                                scanned = True
                            elif "show" in cls:
                                if num % 10 == 0:
                                    print(f"[QR #{account_id}] mask.show was already present, waiting...")
                        if not scanned:
                            success_img = page.locator(".success-img")
                            if success_img.count() > 0 and success_img.first.is_visible():
                                print(f"[QR #{account_id}] Scanned at #{num}, success-img")
                                scanned = True
                    except:
                        pass
                    if scanned:
                        break
                    num += 1
                    if num % 10 == 0:
                        print(f"[QR #{account_id}] waiting... #{num * 3}s")
                    if num > 40:
                        result_holder["status"] = "error"
                        result_holder["error"] = "Scan timeout (120s)"
                        print(f"[QR #{account_id}] Timeout")
                        return

                print(f"[QR #{account_id}] Scan confirmed, waiting 6s...")
                time.sleep(6)

                print(f"[QR #{account_id}] Opening platform page...")
                platform_page = context.new_page()
                logged_in = False
                try:
                    platform_page.goto(
                        "https://channels.weixin.qq.com/platform",
                        wait_until="load",
                        timeout=15000
                    )
                    platform_page.wait_for_url(
                        "https://channels.weixin.qq.com/platform",
                        timeout=10000
                    )
                    logged_in = "/login" not in platform_page.url
                except:
                    pass

                if not logged_in:
                    print(f"[QR #{account_id}] Platform page not reached (still on login), login failed")
                    platform_page.close()
                    browser.close()
                    result_holder["status"] = "error"
                    result_holder["error"] = "Login not completed, platform page not accessible"
                    return

                time.sleep(3)

                nickname = ""
                try:
                    nickname = platform_page.locator("h2.finder-nickname").nth(0).inner_text(timeout=10000)
                except:
                    pass
                result_holder["nickname"] = nickname
                print(f"[QR #{account_id}] Nickname: {nickname}")

                cookie_file = _cookie_path(account_id)
                context.storage_state(path=cookie_file)
                platform_page.close()
                browser.close()

                result_holder["status"] = "success"
                print(f"[QR #{account_id}] SUCCESS")

        except Exception as e:
            result_holder["status"] = "error"
            result_holder["error"] = f"{type(e).__name__}: {str(e)}"
            import traceback
            traceback.print_exc()
            print(f"[QR #{account_id}] Error: {e}")

    loop = asyncio.get_running_loop()
    loop.run_in_executor(None, _do)
    return {"qr_image": "", "status": "scan_in_browser"}

async def check_login_status(account_id: int):
    s = _active_logins.get(account_id)
    if not s:
        return {"status": "not_found"}
    if s.get("status") == "success":
        return {"status": "success"}
    if s.get("status") == "error":
        return {"status": "error", "message": s.get("error", "")}
    return {"status": "waiting"}

async def finish_login(account_id: int):
    s = _active_logins.pop(account_id, None)
    if not s:
        return {"ok": False, "error": "Session not found"}
    if s.get("status") == "success":
        return {"ok": True, "cookies": _cookie_path(account_id), "nickname": s.get("nickname", "")}
    return {"ok": False, "error": s.get("error", "Unknown error")}

async def validate_cookies(account_id: int):
    cf = _cookie_path(account_id)
    if not os.path.exists(cf):
        return False
    try:
        with open(cf, "r") as f:
            data = json.load(f)
        return len(data.get("cookies", [])) > 0
    except:
        return False

async def check_cookies_visible(account_id: int):
    cf = _cookie_path(account_id)
    if not os.path.exists(cf):
        return {"valid": False, "message": "cookie file not found"}

    loop = asyncio.get_running_loop()
    result_holder = {}

    def _run():
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(headless=False)
                context = browser.new_context(storage_state=cf)
                page = context.new_page()

                page.goto("https://channels.weixin.qq.com/platform",
                         wait_until="load", timeout=15000)

                try:
                    page.wait_for_url("**/login**", timeout=8000)
                    valid = False
                except:
                    valid = True

                nickname = ""
                if valid:
                    try:
                        nickname_el = page.query_selector("h2.finder-nickname")
                        if nickname_el:
                            nickname = nickname_el.inner_text()
                    except:
                        pass
                    context.storage_state(path=cf)

                context.close()
                browser.close()
                result_holder["result"] = {
                    "valid": valid,
                    "nickname": nickname,
                    "message": "valid" if valid else "expired"
                }
        except Exception as e:
            result_holder["result"] = {"valid": False, "message": str(e)}

    await loop.run_in_executor(None, _run)
    return result_holder.get("result", {"valid": False, "message": "check failed"})

def pseudo_status():
    return {"status": "waiting"}

def pseudo_finish(account_id: int):
    return {"ok": True, "cookies": f"pseudo_{account_id}"}

async def pseudo_validate(account_id: int):
    return True

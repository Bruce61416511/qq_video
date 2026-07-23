import asyncio
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
        return {"qr_image": "", "status": "already_running"}

    pw = await async_playwright().start()
    browser = await pw.chromium.launch(headless=False)
    context = await browser.new_context()
    page = await context.new_page()

    await page.goto(
        "https://channels.weixin.qq.com/platform/login-for-iframe?dark_mode=true&host_type=1",
        wait_until="networkidle"
    )
    await page.locator(".qrcode").click()
    print(f"[QR #{account_id}] Matrix: login page ready")

    _active_logins[account_id] = {
        "playwright": pw, "browser": browser, "context": context, "page": page,
        "status": "waiting"
    }

    asyncio.create_task(_wait_login(account_id))
    return {"qr_image": "", "status": "scan_in_browser"}

async def _wait_login(account_id: int):
    session = _active_logins.get(account_id)
    if not session: return
    page = session["page"]
    context = session["context"]

    try:
        print(f"[QR #{account_id}] Polling .mask for scan...")
        success_mask = page.locator(".mask").first
        num = 0
        while True:
            await asyncio.sleep(3)
            try:
                cls = await success_mask.get_attribute("class")
                if cls and "show" in cls:
                    print(f"[QR #{account_id}] Scanned at #{num}")
                    break
            except:
                pass
            num += 1
            if num > 13:
                session["status"] = "error"
                session["error"] = "Scan timeout"
                print(f"[QR #{account_id}] Timeout: scan not detected")
                return

        print(f"[QR #{account_id}] Waiting 6s for confirm...")
        await asyncio.sleep(6)

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
            session["nickname"] = nickname
            print(f"[QR #{account_id}] Nickname: {nickname}")
        except:
            pass

        cookie_file = _cookie_path(account_id)
        await context.storage_state(path=cookie_file)
        await platform_page.close()
        session["status"] = "success"
        print(f"[QR #{account_id}] SUCCESS - cookies saved")

    except Exception as e:
        session["status"] = "error"
        session["error"] = str(e)
        print(f"[QR #{account_id}] Error: {e}")

async def check_login_status(account_id: int):
    s = _active_logins.get(account_id)
    if not s: return {"status": "not_found"}
    if s.get("status") == "success": return {"status": "success"}
    if s.get("status") == "error": return {"status": "error", "message": s.get("error", "")}
    return {"status": "waiting"}

async def finish_login(account_id: int):
    s = _active_logins.pop(account_id, None)
    if not s: return {"ok": False, "error": "Session not found"}
    try:
        await s["page"].close()
        await s["context"].close()
        await s["browser"].close()
        await s["playwright"].stop()
    except:
        pass
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
        return {"valid": False, "message": "无登录信息"}
    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=False)
            context = await browser.new_context(storage_state=cf)
            page = await context.new_page()
            await page.goto("https://channels.weixin.qq.com/platform", timeout=10000)
            await asyncio.sleep(3)
            url = page.url
            nickname = ""
            if "/login" not in url:
                try:
                    nickname = await page.locator("h2.finder-nickname").first.inner_text(timeout=3000)
                except:
                    pass
                await context.storage_state(path=cf)
            await context.close()
            await browser.close()
            valid = "/login" not in url
            return {"valid": valid, "nickname": nickname, "message": "有效" if valid else "已过期"}
    except Exception as e:
        return {"valid": False, "message": str(e)}

def pseudo_status(): return {"status": "waiting"}
def pseudo_finish(account_id: int): return {"ok": True, "cookies": f"pseudo_{account_id}"}
async def pseudo_validate(account_id: int): return True

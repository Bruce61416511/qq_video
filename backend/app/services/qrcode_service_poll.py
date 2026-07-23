async def _poll_login(account_id: int):
    session = _active_logins.get(account_id)
    if not session: return
    page = session["page"]
    try:
        for i in range(30):
            await asyncio.sleep(3)
            try:
                cls = await page.locator(".mask").first.get_attribute("class")
                if cls and "show" in cls:
                    session["scanned"] = True
                    print(f"[QR] SCANNED at #{i} - bring window to front and wait...")
                    # Bring browser to front to ensure it's active for WebSocket
                    try: await page.bring_to_front()
                    except: pass
                    break
            except Exception as e:
                pass
        else:
            session["error"] = "Scan not detected"
            return

        # Wait up to 5 minutes for login to complete (cookies to appear)
        for j in range(150):
            await asyncio.sleep(2)
            cookies = await session["context"].cookies()
            url = page.url
            if j % 5 == 0:
                print(f"[QR] +{j*2}s cookies={len(cookies)} url={url[-40:]}")
            if len(cookies) > 5:
                cookie_file = _cookie_path(account_id)
                await session["context"].storage_state(path=cookie_file)
                session["success"] = True
                print(f"[QR] SUCCESS: {len(cookies)} cookies")
                return
            # Check if URL redirected
            if "login" not in url and "channels.weixin.qq.com" in url:
                print(f"[QR] Redirect detected! {url[-40:]}")
                await asyncio.sleep(2)
                cookies = await session["context"].cookies()
                if len(cookies) > 5:
                    cookie_file = _cookie_path(account_id)
                    await session["context"].storage_state(path=cookie_file)
                    session["success"] = True
                    print(f"[QR] SUCCESS after redirect: {len(cookies)} cookies")
                    return
        session["error"] = f"Timeout: {len(await session['context'].cookies())} cookies, url={page.url[-40:]}"
        print(f"[QR] TIMEOUT after 5min: cookies={len(await session['context'].cookies())}")
    except Exception as e:
        session["error"] = str(e)
        print(f"[QR] Error: {e}")

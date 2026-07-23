async def _wait_login(account_id: int):
    session = _active_logins.get(account_id)
    if not session: return
    page = session["page"]
    try:
        print(f"[QR] Waiting for login... start url={page.url[-50:]}")
        for i in range(300):
            await asyncio.sleep(1)
            url = page.url
            cookies = await session["context"].cookies()
            if i % 10 == 0:
                print(f"[QR] +{i}s url={url[-50:]} cookies={len(cookies)}")
            if "login" not in url and "channels.weixin.qq.com" in url:
                print(f"[QR] REDIRECT: {url[-50:]}")
                await asyncio.sleep(2)
                cookies = await session["context"].cookies()
                if len(cookies) > 5:
                    cookie_file = _cookie_path(account_id)
                    await session["context"].storage_state(path=cookie_file)
                    session["success"] = True
                    print(f"[QR] SUCCESS: {len(cookies)} cookies")
                    return
        session["error"] = f"Timeout: url={page.url[-50:]} cookies={len(await session['context'].cookies())}"
        print(f"[QR] Timeout: {session['error']}")
    except Exception as e:
        session["error"] = str(e)
        print(f"[QR] Error: {e}")

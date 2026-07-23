async def start_qr_login(account_id: int):
    global _active_logins
    if account_id in _active_logins:
        return {"qr_image": _pseudo_qr(account_id)}

    try:
        pw = await async_playwright().start()
        browser = await pw.chromium.launch(
            channel="chrome",
            headless=False,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--window-position=-32000,-32000",
                "--window-size=800,600",
            ]
        )
        context = await browser.new_context(
            viewport={"width": 1280, "height": 800},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        )
        page = await context.new_page()

        # Inject stealth script to avoid detection
        await page.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
            Object.defineProperty(navigator, 'plugins', {get: () => [1, 2, 3, 4, 5]});
            Object.defineProperty(navigator, 'languages', {get: () => ['zh-CN', 'zh', 'en']});
            window.chrome = {runtime: {}};
        """)

        await page.goto(
            "https://channels.weixin.qq.com/platform/login-for-iframe?dark_mode=true&host_type=1",
            wait_until="networkidle",
            timeout=30000
        )
        await page.wait_for_selector("img.qrcode", timeout=10000)
        qr_src = await page.locator("img.qrcode").get_attribute("src") or ""
        _active_logins[account_id] = {"playwright": pw, "browser": browser, "context": context, "page": page}
        asyncio.create_task(_poll_login(account_id))
        qr = qr_src if qr_src.startswith("data:image") else _pseudo_qr(account_id)
        return {"qr_image": qr}
    except Exception as e:
        print(f"[QR] start_qr_login error: {e}")
        return {"qr_image": _pseudo_qr(account_id)}

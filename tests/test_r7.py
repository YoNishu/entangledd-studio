import where as _W
import json, time
from playwright.sync_api import sync_playwright
S=f"{_W.OUT}/shots/"
with sync_playwright() as p:
    b=p.chromium.launch(channel="chrome", args=["--autoplay-policy=no-user-gesture-required"])
    ctx=b.new_context(viewport={"width":390,"height":844}, device_scale_factor=2, has_touch=True, is_mobile=True)
    pg=ctx.new_page(); errs=[]
    pg.on("pageerror", lambda e: errs.append(str(e)))
    cdp=ctx.new_cdp_session(pg); cdp.send("WebAuthn.enable")
    cdp.send("WebAuthn.addVirtualAuthenticator", {"options":{"protocol":"ctap2","transport":"internal","hasResidentKey":True,"hasUserVerification":True,"isUserVerified":True,"automaticPresenceSimulation":True}})
    pg.goto(f"{_W.URL}/"); pg.wait_for_timeout(1000)
    pg.fill("#passcode","letmein"); pg.click("#passcode-go"); pg.wait_for_timeout(2000)
    print("today cards:", pg.locator("#suggestions .card").count(), "| week shown:", pg.evaluate("!document.getElementById('week').hidden"))
    rows=pg.locator("#week-days details")
    print("days listed:", rows.count(), "(7 days back, one empty day left out)")
    for i in range(rows.count()): print("  ", rows.nth(i).locator("summary").inner_text().replace("\n"," | "))
    pg.locator("#week").scroll_into_view_if_needed(); pg.wait_for_timeout(200); pg.screenshot(path=S+"90_week.png")
    rows.nth(0).locator("summary").click(); pg.wait_for_timeout(300)
    print("day 1 cards:", rows.nth(0).locator(".card").count(), "| chips:", rows.nth(0).locator(".chip").all_inner_texts()[:3])
    pg.screenshot(path=S+"91_week_open.png")
    rows.nth(0).locator(".card").nth(1).locator("text=Skip").click(); pg.wait_for_timeout(400)
    rows.nth(0).locator(".card").nth(1).locator("text=Use this").click(); pg.wait_for_timeout(500)
    print("create shown:", pg.evaluate("!document.getElementById('view-create').hidden"), "| on canvas:", json.loads(pg.evaluate("localStorage.getItem('entangledd.draft.v1')"))["blocks"][0]["text"][:40])
    pg.click("#nav-today"); pg.wait_for_timeout(1500)
    r0=pg.locator("#week-days details").nth(0)
    print("after skip+use, day 1:", r0.locator("summary").inner_text().replace("\n"," | "), "| still open:", r0.evaluate("e => e.open"), "| amber chips:", r0.locator(".chip.wait").count())
    print("today's five untouched:", pg.locator("#suggestions .card").count())
    # Face ID still enables with the hint present
    pg.click("#settings-open"); pg.wait_for_timeout(500); pg.click("#faceid-toggle"); pg.wait_for_timeout(1500)
    print("face id:", pg.inner_text("#faceid-status")[:20])
    print("errors:", errs); b.close()

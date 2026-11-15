import where as _W
import time
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(channel="chrome", args=["--autoplay-policy=no-user-gesture-required"])
    pg=b.new_context(viewport={"width":390,"height":844}, has_touch=True, is_mobile=True).new_page(); errs=[]
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"{_W.URL}/"); pg.wait_for_timeout(900)
    pg.fill("#passcode","letmein"); pg.click("#passcode-go"); pg.wait_for_timeout(1500)
    pg.click("#nav-create"); pg.wait_for_timeout(300); pg.click("#tab-bg"); pg.click("#stock"); pg.wait_for_timeout(1500)
    pg.locator("#stock-grid button").first.click()
    t=time.time(); ok=False
    while time.time()-t<20:
        if pg.evaluate("document.getElementById('stock-sheet').hidden"): ok=True; break
        pg.wait_for_timeout(300)
    print("video placed on canvas:", ok, "| video options shown:", pg.evaluate("!document.getElementById('video-opts').hidden"), "| errors:", errs)
    # more results, then a photo
    pg.click("#stock"); pg.wait_for_timeout(500); pg.locator("#stock-kind button[data-kind=photo]").click(); pg.wait_for_timeout(1200)
    pg.locator("#stock-grid button").nth(1).click(); pg.wait_for_timeout(2500)
    print("then a photo placed:", pg.evaluate("document.getElementById('stock-sheet').hidden"), "| video options hidden again:", pg.evaluate("document.getElementById('video-opts').hidden"))
    b.close()

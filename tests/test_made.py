import where as _W
import json, time, urllib.request
from playwright.sync_api import sync_playwright
def wait(pg, cond, timeout=90):
    t=time.time()
    while time.time()-t<timeout:
        if pg.evaluate(cond): return True
        pg.wait_for_timeout(500)
    return False
with sync_playwright() as p:
    b=p.chromium.launch(channel="chrome", args=["--autoplay-policy=no-user-gesture-required"])
    pg=b.new_context(viewport={"width":390,"height":844}, has_touch=True, is_mobile=True).new_page(); errs=[]
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"{_W.URL}/"); pg.wait_for_timeout(900)
    pg.fill("#passcode","letmein"); pg.click("#passcode-go"); pg.wait_for_timeout(1500)
    pg.click("#settings-open"); pg.wait_for_timeout(400); pg.fill("#ig-token","SHORT-"+"a"*60); pg.click("#ig-connect button[type=submit]"); pg.wait_for_timeout(900); pg.click("#settings-close")
    pg.click("#nav-create"); pg.wait_for_timeout(300); pg.click("#tab-bg"); pg.click("#stock"); pg.wait_for_timeout(600)
    pg.fill("#stock-q","rainy window"); pg.click("#stock-form button[type=submit]"); pg.wait_for_timeout(1500)
    pg.locator("#stock-grid button").nth(1).click(); wait(pg, "document.getElementById('stock-sheet').hidden", 20)
    pg.evaluate("Studio.setQuote('you are allowed to start again', '')")
    print("on the canvas:", pg.evaluate("JSON.stringify(Studio.madeWith())"))
    pg.click("#tab-save"); pg.click("#make-reel"); print("reel made:", wait(pg, "!document.getElementById('reel-result').hidden"))
    pg.evaluate("document.getElementById('clear-bg').click()")       # change the canvas afterwards: the post must still remember the video
    pg.click("#post-open"); pg.wait_for_timeout(700); pg.click("#post-go"); print("posted:", wait(pg, "document.getElementById('post-status').textContent.startsWith('Posted')", 60))
    pg.click("#post-close"); pg.click("#nav-insights"); pg.wait_for_timeout(2500)
    print("insights hero:", pg.inner_text("#ins-hero").replace("\n"," | ")); print("errors:", errs)
    token=pg.evaluate("Studio.server.token"); b.close()
req=urllib.request.Request(f"{_W.URL}/api/insights?range=all"); req.add_header("Authorization","Bearer "+token)
row=json.load(urllib.request.urlopen(req))["posts"][0]
print("recorded for the post -> background:", row["background"], "| reach", row["reach"], "| watch", row["watch"])

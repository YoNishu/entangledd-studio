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
    b=p.chromium.launch(channel="chrome")
    pg=b.new_context(viewport={"width":390,"height":844}, has_touch=True, is_mobile=True).new_page(); errs=[]
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"{_W.URL}/"); pg.wait_for_timeout(900)
    pg.fill("#passcode","letmein"); pg.click("#passcode-go"); pg.wait_for_timeout(1500)
    pg.click("#settings-open"); pg.wait_for_timeout(400); pg.fill("#ig-token","SHORT-"+"a"*60); pg.click("#ig-connect button[type=submit]"); pg.wait_for_timeout(900); pg.click("#settings-close")
    pg.click("#nav-create"); pg.wait_for_timeout(300); pg.evaluate("Studio.setQuote('no music of its own', '')")
    pg.click("#tab-save"); pg.click("#make-reel"); print("reel made:", wait(pg, "!document.getElementById('reel-result').hidden"))
    pg.click("#post-open"); pg.wait_for_timeout(800)
    pg.click("#music-form button[type=submit]"); pg.wait_for_timeout(1200)
    print("Instagram tracks listed:", pg.locator("#music-list li").count())
    pg.locator("#music-list li button", has_text="Choose").first.click(); pg.wait_for_timeout(300); print("chosen:", pg.inner_text("#music-name"))
    pg.click("#post-go"); print("posted:", wait(pg, "document.getElementById('post-status').textContent.startsWith('Posted')", 60)); print("errors:", errs); b.close()
log=json.load(urllib.request.urlopen(f"{_W.URL}/__graph_log")); c=[e for e in log if e["params"].get("media_type")=="REELS"][-1]["params"]
print("sent to Instagram with its music:", c.get("audio_configuration"))

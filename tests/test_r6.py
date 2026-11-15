import where as _W
import json, time, urllib.request
from playwright.sync_api import sync_playwright
def wait(pg, cond, timeout=90):
    t=time.time()
    while time.time()-t<timeout:
        if pg.evaluate(cond): return True
        pg.wait_for_timeout(700)
    return False
with sync_playwright() as p:
    b=p.chromium.launch(channel="chrome", args=["--autoplay-policy=no-user-gesture-required"])
    ctx=b.new_context(viewport={"width":390,"height":844}, device_scale_factor=2, has_touch=True, is_mobile=True)
    pg=ctx.new_page(); errs=[]
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"{_W.URL}/"); pg.wait_for_timeout(1000)
    pg.fill("#passcode","letmein"); pg.click("#passcode-go"); pg.wait_for_timeout(1500)
    # posting before connecting sends her to Settings
    pg.locator("#suggestions .card", has_text="Seneca").first.locator("text=Use this").click(); pg.wait_for_timeout(300)
    pg.click("#tab-save"); pg.click("#make-reel"); print("reel:", wait(pg, "!document.getElementById('reel-result').hidden"))
    pg.click("#post-open"); pg.wait_for_timeout(800)
    print("settings opened:", pg.evaluate("!document.getElementById('settings').hidden"), "|", pg.inner_text("#ig-status"))
    pg.fill("#ig-token","SHORT-"+"a"*60); pg.click("#ig-connect button[type=submit]"); pg.wait_for_timeout(900)
    print("connected:", pg.inner_text("#ig-status")[:28]); pg.click("#settings-close")
    pg.click("#post-open"); pg.wait_for_timeout(700); pg.click("#post-go")
    print("posted:", wait(pg, "document.getElementById('post-status').textContent.startsWith('Posted')", 60)); pg.click("#post-close")
    pg.click("#nav-today"); pg.wait_for_timeout(1200)
    print("today chip:", pg.locator("#suggestions .card", has_text="Seneca").first.locator(".chip").all_inner_texts())
    pg.click("#nav-posts"); pg.wait_for_timeout(1200); print("posts:", pg.locator("#list-posts .card").count(), "|", pg.inner_text("#posts-note"))
    urllib.request.urlopen(f"{_W.URL}/__graph_delete?id=M1")
    pg.click("#nav-today"); pg.wait_for_timeout(1500)
    print("after delete:", pg.locator("#suggestions .card", has_text="Seneca").first.locator(".chip").all_inner_texts())
    print("errors:", errs); b.close()

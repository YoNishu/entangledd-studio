import where as _W
import json, time, urllib.request
from playwright.sync_api import sync_playwright
S=f"{_W.OUT}/shots/"
def wait(pg, cond, timeout=90):
    t=time.time()
    while time.time()-t<timeout:
        if pg.evaluate(cond): return True
        pg.wait_for_timeout(700)
    return False
with sync_playwright() as p:
    b=p.chromium.launch(channel="chrome", args=["--autoplay-policy=no-user-gesture-required"])
    ctx=b.new_context(viewport={"width":390,"height":844}, device_scale_factor=2, has_touch=True, is_mobile=True, accept_downloads=True)
    ctx.add_init_script("try { localStorage.setItem('studio.postsView', 'list'); } catch (e) {}")   # these checks read the posts as a list (the gallery is checked in test_page_posts.py)
    pg=ctx.new_page(); errs=[]
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"{_W.URL}/"); pg.wait_for_timeout(1000)
    pg.fill("#passcode","letmein"); pg.click("#passcode-go"); pg.wait_for_timeout(1500)
    pg.click("#settings-open"); pg.wait_for_timeout(500); pg.fill("#ig-token","SHORT-"+"a"*60); pg.click("#ig-connect button[type=submit]"); pg.wait_for_timeout(900); pg.click("#settings-close")
    pg.click("#nav-create"); pg.wait_for_timeout(400)
    size=lambda: pg.evaluate("(() => { const c=document.getElementById('canvas'); const r=c.getBoundingClientRect(); return [c.width, c.height, Math.round(r.width), Math.round(r.height), (r.width/r.height).toFixed(3)] })()")
    print("reel shape:", size())
    pg.click("#tab-style"); pg.click('#shape button[data-shape="post"]'); pg.wait_for_timeout(300); pg.click("#tab-style"); pg.wait_for_timeout(300)
    print("post shape:", size(), "(4:5 = 0.800)")
    pg.screenshot(path=S+"110_post_shape.png")
    pg.click("#tab-save"); pg.wait_for_timeout(200)
    print("finish: carousel shown:", pg.evaluate("!document.getElementById('carousel').hidden"), "| reel setup hidden:", pg.evaluate("document.getElementById('reel-setup').hidden"), "| save picture shown:", pg.evaluate("!document.getElementById('save-image').hidden"))
    # three slides with different words
    for n,words in enumerate(["first you break", "then you learn", "then you begin again"]):
        pg.click("#tab-text"); pg.fill("#words", words); pg.click("#tab-save"); pg.click("#slide-add"); pg.wait_for_timeout(300)
    print("tray:", pg.locator("#slide-tray figure").count(), "|", pg.inner_text("#slide-note"))
    pg.locator("#slide-tray figure").nth(1).locator("button").click(); pg.wait_for_timeout(200)
    print("after removing one:", pg.locator("#slide-tray figure").count())
    pg.click("#tab-text"); pg.fill("#words","and again"); pg.click("#tab-save"); pg.click("#slide-add"); pg.wait_for_timeout(300)
    pg.screenshot(path=S+"111_tray.png")
    with pg.expect_download() as d: pg.click("#save-img")
    d.value.save_as(f"{_W.OUT}/post_picture.jpg")
    pg.click("#carousel-post"); pg.wait_for_timeout(700)
    print("sheet:", pg.inner_text("#post-title"), "| music hidden:", pg.evaluate("document.getElementById('post-music').hidden"))
    pg.fill("#post-caption","three steps"); pg.click("#post-go")
    print("posted:", wait(pg, "document.getElementById('post-status').textContent.startsWith('Posted')", 60), "|", pg.inner_text("#post-status"), "| link:", pg.get_attribute("#post-link","href"))
    pg.click("#post-close"); print("tray cleared:", pg.locator("#slide-tray figure").count())
    pg.click("#nav-posts"); pg.wait_for_timeout(1500); print("posts:", pg.locator("#list-posts .card").first.inner_text().replace("\n"," | ")[:200])
    # back to reel shape: the reel flow still works
    pg.click("#nav-create"); pg.click("#tab-style"); pg.click('#shape button[data-shape="reel"]'); pg.wait_for_timeout(300)
    print("reel again:", size()); pg.click("#tab-save"); pg.wait_for_timeout(200)
    print("finish: carousel hidden:", pg.evaluate("document.getElementById('carousel').hidden"), "| reel setup shown:", pg.evaluate("!document.getElementById('reel-setup').hidden"))
    pg.click("#make-reel"); print("reel made:", wait(pg, "!document.getElementById('reel-result').hidden"))
    print("errors:", errs); b.close()
from PIL import Image
print("saved picture:", Image.open(f"{_W.OUT}/post_picture.jpg").size)
log=json.load(urllib.request.urlopen(f"{_W.URL}/__graph_log"))
print("graph calls:", [(e["path"], e["params"].get("media_type") or ("item" if e["params"].get("is_carousel_item") else "")) for e in log if e["path"].endswith("/media") or "publish" in e["path"]])

import where as _W
import sys, time
from playwright.sync_api import sync_playwright
mode=sys.argv[1]
with sync_playwright() as p:
    b=p.chromium.launch(channel="chrome")
    ctx=b.new_context(viewport={"width":390,"height":844}, device_scale_factor=2, has_touch=True, is_mobile=True)
    pg=ctx.new_page(); errs=[]
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"{_W.URL}/"); pg.wait_for_timeout(900)
    pg.fill("#passcode","letmein"); pg.click("#passcode-go"); pg.wait_for_timeout(1500)
    pg.click("#nav-create"); pg.wait_for_timeout(300); pg.click("#tab-bg") if pg.locator("#tab-bg").count() else None
    pg.click("#stock"); pg.wait_for_timeout(1200)
    pg.locator("#stock-kind button[data-kind=photo]").click(); pg.wait_for_timeout(1800)
    n=pg.locator("#stock-grid button").count()
    shown=pg.evaluate("[...document.querySelectorAll('#stock-grid img')].map(i => i.complete && i.naturalWidth > 0)")
    print(f"[{mode}] photo results:", n, "| thumbnails showing:", shown)
    pg.locator("#stock-grid button").first.click()
    t=time.time(); done=False
    while time.time()-t<15:
        if pg.evaluate("document.getElementById('stock-sheet').hidden"): done=True; break
        st=pg.inner_text("#stock-status")
        if st and "Fetching" not in st: print("   stopped on status:", repr(st)); break
        pg.wait_for_timeout(300)
    print(f"[{mode}] photo placed on canvas:", done, "| status:", repr(pg.inner_text("#stock-status")), "| background:", pg.evaluate("document.getElementById('bg-name') ? document.getElementById('bg-name').textContent : ''"))
    if mode=="default": pg.wait_for_timeout(400); pg.screenshot(path=f"{_W.OUT}/shots/130_photo_bg.png")
    print(f"[{mode}] errors:", errs); b.close()

"""The section bar sits at the very bottom when the app is opened from the iPhone Home Screen."""
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import where as _W
import sys
from playwright.sync_api import sync_playwright
fails = []
def check(n, ok, d=""):
    print(("  ok   " if ok else "  FAIL ") + n + ("" if ok else f"  [{d}]")); ok or fails.append(n)
with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome")
    for standalone in (True, False):
        # iOS standalone reports a page 59 px shorter than the 844 px screen (the status bar's height)
        ctx = br.new_context(viewport={"width": 390, "height": 785}, screen={"width": 390, "height": 844}, device_scale_factor=3, has_touch=True, is_mobile=True)
        if standalone: ctx.add_init_script("Object.defineProperty(navigator, 'standalone', { get: () => true })")
        pg = ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(_W.URL + "/"); pg.wait_for_timeout(800)
        pg.fill("#passcode", "letmein"); pg.click("#passcode-go"); pg.wait_for_timeout(1500)
        body_h = pg.evaluate("document.body.getBoundingClientRect().height")
        bar = pg.evaluate("(() => { const r = document.querySelector('.views').getBoundingClientRect(); return [r.top, r.bottom]; })()")
        if standalone:
            check("Home Screen: the page is as tall as the screen", body_h == 844, body_h)
            check("Home Screen: the section bar ends at the bottom of the screen", abs(bar[1] - 844) < 1, bar)
        else:
            check("in Safari: unchanged, the page fits the window", body_h == 785 and abs(bar[1] - 785) < 1, (body_h, bar))
        pg.evaluate("document.querySelector('.views').scrollIntoView()")
        check("no page errors", not errs, errs)
        ctx.close()
    br.close()
print("FAIL" if fails else "PASS"); sys.exit(1 if fails else 0)

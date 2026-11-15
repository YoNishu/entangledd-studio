"""After the keyboard has shrunk a Home Screen app, leaving a field brings the full height back."""
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import where as _W
import sys
from playwright.sync_api import sync_playwright
fails = []
def check(n, ok, d=""):
    print(("  ok   " if ok else "  FAIL ") + n + ("" if ok else f"  [{d}]")); ok or fails.append(n)
with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome")
    ctx = br.new_context(viewport={"width": 390, "height": 844}, screen={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
    ctx.add_init_script("Object.defineProperty(navigator, 'standalone', { get: () => true })")
    pg = ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(_W.URL + "/"); pg.wait_for_timeout(800)
    pg.fill("#passcode", "letmein"); pg.click("#passcode-go"); pg.wait_for_timeout(1500)
    # the keyboard opens and the drawing area shrinks by the status bar (the iOS bug)...
    pg.click("#settings-open"); pg.wait_for_timeout(600)
    field = pg.locator("#settings input:visible, #settings textarea:visible").first; field.focus()
    pg.set_viewport_size({"width": 390, "height": 785}); pg.wait_for_timeout(200)
    # ...and stays short after the keyboard closes; healing hides and shows the page: count that it happened
    pg.evaluate("window.__flips = 0; new MutationObserver(m => m.forEach(r => { if ((r.oldValue || '').includes('none')) window.__flips++; })).observe(document.body, { attributes: true, attributeOldValue: true, attributeFilter: ['style'] })")
    field.blur(); pg.wait_for_timeout(800)
    check("leaving the field made the app measure the screen again", pg.evaluate("window.__flips") >= 1, pg.evaluate("window.__flips"))
    check("the page is shown again afterwards", pg.evaluate("document.body.style.display") == "")
    # nothing happens while typing, or when nothing is short
    pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(200)
    pg.evaluate("window.__flips = 0"); field.focus(); field.blur(); pg.wait_for_timeout(800)
    check("full height: nothing is redone", pg.evaluate("window.__flips") == 0)
    check("no page errors", not errs, errs)
    br.close()
print("FAIL" if fails else "PASS"); sys.exit(1 if fails else 0)

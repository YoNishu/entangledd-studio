import where as _W
import json, time, urllib.request, urllib.parse
from playwright.sync_api import sync_playwright
S=f"{_W.OUT}/shots/"
def wait(pg, cond, timeout=90):
    t=time.time()
    while time.time()-t<timeout:
        if pg.evaluate(cond): return True
        pg.wait_for_timeout(500)
    return False
# A phone's share menu, stood in for: records what was shared instead of opening anything.
STUB = """
window.__shared = [];
navigator.canShare = (d) => !!(d && d.files && d.files.length);
navigator.share = async (d) => { if (window.__cancelShare) { const e = new Error('cancelled'); e.name = 'AbortError'; throw e; } window.__shared.push({ files: d.files.map(f => [f.name, f.type, f.size]), keys: Object.keys(d) }); };
"""
with sync_playwright() as p:
    b=p.chromium.launch(channel="chrome")
    ctx=b.new_context(viewport={"width":390,"height":844}, device_scale_factor=2, has_touch=True, is_mobile=True, permissions=["clipboard-read","clipboard-write"])
    ctx.add_init_script(STUB)
    pg=ctx.new_page(); errs=[]
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"{_W.URL}/"); pg.wait_for_timeout(900)
    pg.fill("#passcode","letmein"); pg.click("#passcode-go"); pg.wait_for_timeout(1500)
    pg.click("#settings-open"); pg.wait_for_timeout(400); pg.fill("#ig-token","SHORT-"+"a"*60); pg.click("#ig-connect button[type=submit]"); pg.wait_for_timeout(900); pg.click("#settings-close")
    pg.click("#nav-create"); pg.wait_for_timeout(300); pg.evaluate("Studio.setQuote('the sea keeps no calendar', '')")
    pg.click("#tab-save"); pg.click("#make-reel"); print("reel made:", wait(pg, "!document.getElementById('reel-result').hidden"))
    print("buttons after a reel:", [t for t in pg.locator("#reel-result button").all_inner_texts()])
    pg.screenshot(path=S+"170_reel_ready.png")
    pg.click("#handoff-open"); pg.wait_for_timeout(500)
    pg.click("#handoff-write"); pg.wait_for_timeout(1000); cap=pg.input_value("#handoff-caption"); print("caption by Nishiii:", repr(cap[:60]))
    pg.screenshot(path=S+"171_handoff_sheet.png")
    pg.evaluate("window.__cancelShare = true"); pg.click("#handoff-go"); pg.wait_for_timeout(600); print("share menu closed without choosing:", pg.inner_text("#handoff-status"))
    pg.evaluate("window.__cancelShare = false"); pg.click("#handoff-go"); pg.wait_for_timeout(1200)
    print("shared:", pg.evaluate("JSON.stringify(window.__shared)"))
    print("clipboard has the caption:", pg.evaluate("navigator.clipboard.readText()") == cap.strip(), "| status:", pg.inner_text("#handoff-status"))
    pg.screenshot(path=S+"172_handoff_done.png"); pg.click("#handoff-close")
    pg.click("#nav-posts"); pg.click("#posts-part-drafts"); pg.wait_for_timeout(2500)      # the Drafts part of Posts
    print("Posts, waiting card:", pg.locator("#list-handoffs .card").first.inner_text().replace("\n"," | ")[:170], "| posted so far:", pg.locator("#list-posts .card").count())
    pg.screenshot(path=S+"173_posts_waiting.png")
    pg.locator("#list-handoffs button", has_text="Look for it now").click(); pg.wait_for_timeout(1200); print("looked too early:", pg.locator("#list-handoffs .card button").first.inner_text())
    # she posts it from Instagram, caption pasted
    urllib.request.urlopen(f"{_W.URL}/__posted_in_instagram?caption=" + urllib.parse.quote(cap))
    pg.wait_for_timeout(3500); pg.locator("#list-handoffs button", has_text="Look for it now").click(); pg.wait_for_timeout(3000)
    print("after posting in Instagram: waiting section hidden:", pg.evaluate("document.getElementById('handoff-wrap').hidden"), "| posted:", pg.locator("#list-posts .card").first.inner_text().replace("\n"," | ")[:200])
    pg.screenshot(path=S+"174_posts_linked.png")
    pg.click("#nav-today"); pg.wait_for_timeout(1500)
    pg.click("#nav-insights"); pg.wait_for_timeout(2500); print("Insights:", pg.inner_text("#ins-hero").replace("\n"," | "))

    # a reel kept for later, finished in Instagram from the waiting list
    pg.click("#nav-create"); pg.wait_for_timeout(300); pg.click("#again"); pg.evaluate("Studio.setQuote('start again', '')")
    pg.click("#make-reel"); print("second reel made:", wait(pg, "!document.getElementById('reel-result').hidden"))
    pg.click("#queue-add"); pg.wait_for_timeout(800); pg.reload(); pg.wait_for_timeout(1500)
    if pg.locator("#passcode").is_visible(): pg.fill("#passcode","letmein"); pg.click("#passcode-go"); pg.wait_for_timeout(1500)
    pg.click("#nav-posts"); pg.click("#posts-part-drafts"); pg.wait_for_timeout(2500)      # the Drafts part of Posts
    pg.locator("#list-queue button", has_text="Add a song in Instagram").click()
    print("from the waiting list: reel fetched, button ready:", wait(pg, "!document.getElementById('handoff-go').disabled", 20))
    pg.fill("#handoff-caption", "a second caption"); pg.click("#handoff-go"); pg.wait_for_timeout(1500)
    print("  shared:", pg.evaluate("window.__shared.length"), "file(s) |", pg.inner_text("#handoff-status")[:70]); pg.click("#handoff-close"); pg.wait_for_timeout(2000)
    print("  Posts now: being finished:", pg.locator("#list-handoffs .card").count(), "| waiting to be posted:", pg.locator("#list-queue .card").count())
    pg.locator("#list-handoffs button", has_text="I didn't post it").click(); pg.wait_for_timeout(800); print("  after 'I didn't post it':", pg.locator("#list-handoffs .card").count(), "being finished | still kept for later:", pg.locator("#list-queue .card").count())
    print("errors:", errs); b.close()

"""Save as draft, at the end of Create: one tap saves the reel this moment (words, photo), says where it is kept,
and it is listed in Posts, Drafts, also while it is still the one open in Create; after closing the app it is
offered again.  Run:  python3 tests/test_save_draft_ui.py"""
import where as _W
from a3lib import *
from playwright.sync_api import sync_playwright

serve()
token = login()
connect(token)
with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome")
    errors = []
    ctx = br.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=2)
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(B + "/"); pg.wait_for_timeout(800)
    pg.fill("#passcode", "letmein"); pg.click("#passcode-go")
    pg.wait_for_selector("#suggestions .card", timeout=20000)
    pg.click("#nav-create"); pg.wait_for_selector("#view-create:not([hidden])", timeout=5000)
    pg.click("#tab-save")
    check("the button is at the end of Create", pg.is_visible("#save-draft"))
    pg.click("#save-draft"); pg.wait_for_timeout(400)
    check("with nothing of her own yet it asks for words first, and saves nothing", "first" in pg.inner_text("#save-draft-note") and not doc("draft"), pg.inner_text("#save-draft-note"))
    pg.click("#tab-text"); mine = "a line saved by hand as a draft"
    pg.fill("#words", mine)
    pg.click("#tab-bg"); pg.set_input_files("#file", f"{_W.MEDIA}/sky.jpg"); pg.wait_for_timeout(300)
    pg.click("#tab-save"); pg.click("#save-draft")          # at once: sooner than the save that happens by itself
    pg.wait_for_function("document.getElementById('save-draft-note').textContent.includes('Saved in Drafts')", timeout=20000)
    d = doc("draft")
    check("one tap saved her words and the photo", bool(d) and any(b.get("text") == mine for b in d["snap"]["blocks"]) and bool((d["snap"].get("bg") or {}).get("file")), d)
    pg.click("#save-draft-note button"); pg.wait_for_timeout(800)
    check("the note leads to Posts, Drafts", pg.is_visible("#posts-drafts") and pg.is_visible("#list-saved .card"))
    check("it is listed there with a count of 1, marked as open in Create, with no Delete", pg.inner_text("#drafts-count").strip() == "1"
          and mine in pg.inner_text("#list-saved .card") and "Open in Create now" in pg.inner_text("#list-saved .card") and pg.is_hidden("#list-saved .card .last"))
    pg.click("#list-saved .card >> text=Continue"); pg.wait_for_timeout(500)
    check("Continue goes back to it as it is", pg.is_visible("#view-create") and pg.input_value("#words") == mine)
    pg.reload(); pg.wait_for_timeout(1500)
    pg.click("#nav-posts"); pg.wait_for_timeout(800)
    if pg.is_hidden("#posts-drafts"): pg.click("#posts-part-drafts")
    check("after closing the app it is still in Drafts", pg.locator("#list-saved .card").count() == 1 and mine in pg.inner_text("#list-saved .card"))
    check("no errors on the page", not errors, errors)
    br.close()
finish()

"""Agent 15: Dhruuu's own path, in the phone-sized browser. Nothing she starts is lost by starting something else.
- Today: "Use this" on quote 1; in Create she changes the words, picks a photo and music; the draft is saved;
- she closes the app (reload) and, in Today, picks quote 2;
- Create says once that the earlier reel is kept in Drafts, in Posts, and has a line "1 more draft is in Posts";
- Posts has two parts, Posted and Drafts; Drafts (with its count) lists quote 1 under "Not finished yet";
- Continue brings back her words, the photo and the music exactly; quote 2 is now in Drafts;
- Delete (after asking) removes it; with nothing left, Drafts says so in plain words; the part used last is
  remembered, and a reel waiting for her tap opens Drafts.
Run:  python3 tests/test_a15_drafts_ui.py"""
import where as _W
import json
from a3lib import *
from playwright.sync_api import sync_playwright

SHOTS = f"{_W.OUT}/shots"
def until(fn, ms=20000):
    for _ in range(ms // 250):
        v = fn()
        if v: return v
        time.sleep(0.25)
    return fn()
def stop_here():
    check("(stopped: the steps after this need what failed above)", False)
    finish()

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

    # ---- quote 1 from Today, changed, with a photo and music ----
    cards = pg.locator("#suggestions .card")
    q1 = cards.nth(0).locator(".q").first.inner_text().strip()
    q2 = cards.nth(1).locator(".q").first.inner_text().strip()
    cards.nth(0).locator("text=Use this").click()
    pg.wait_for_selector("#view-create:not([hidden])", timeout=5000)
    pg.click("#tab-text")
    mine = "my own words for the first one"
    pg.fill("#words", mine); pg.wait_for_timeout(300)
    pg.click("#tab-bg"); pg.set_input_files("#file", f"{_W.MEDIA}/sky.jpg"); pg.wait_for_timeout(1200)
    pg.click("#tab-music"); pg.set_input_files("#tune-file", f"{_W.MEDIA}/tone.m4a"); pg.wait_for_timeout(1200)
    d1 = until(lambda: (lambda x: x if x and (x["snap"].get("bg") or {}).get("file") and (x["snap"].get("music") or {}).get("file")
                        and any(b.get("text") == mine for b in x["snap"]["blocks"]) else None)(doc("draft")))
    check("quote 1 is saved by itself with her words, the photo and the music", bool(d1), doc("draft"))
    if not d1: stop_here()
    snap1 = pg.evaluate("Studio.snapshot()")

    # ---- she closes the app, comes back, picks quote 2 ----
    pg.reload(); pg.wait_for_timeout(1500)
    if pg.is_hidden("#view-today"): pg.click("#nav-today")
    pg.wait_for_selector("#suggestions .card", timeout=20000)
    pg.locator("#suggestions .card", has_text=q2[:20]).first.locator("text=Use this").click()
    pg.wait_for_selector("#view-create:not([hidden])", timeout=5000)
    kept = until(lambda: [x for x in (doc("drafts") or []) if x["id"] == d1["id"]])
    check("quote 1 is set aside on the server when quote 2 begins", bool(kept), doc("drafts"))
    check("quote 2 is now the current draft", until(lambda: (doc("draft") or {}).get("id") not in (None, d1["id"])), doc("draft"))
    if not kept: stop_here()
    pg.wait_for_function("/kept in Drafts, in Posts/.test(document.getElementById('draft-note').textContent)", timeout=10000)
    check("Create says once where the earlier reel is", pg.text_content("#draft-note") == "Your earlier reel is kept in Drafts, in Posts.", pg.text_content("#draft-note"))
    pg.wait_for_selector("#drafts-more:not([hidden])", timeout=5000)
    check("a quiet line says how many more drafts are in Posts", pg.text_content("#drafts-more") == "1 more draft is in Posts", pg.text_content("#drafts-more"))
    pg.screenshot(path=f"{SHOTS}/a15_1_create_note.png")

    # ---- Posts: two parts; Drafts lists quote 1 ----
    pg.click("#drafts-more")
    pg.wait_for_selector("#list-saved article", timeout=10000)
    check("the line goes to Posts, on Drafts", pg.is_visible("#view-posts") and pg.get_attribute("#posts-part-drafts", "aria-pressed") == "true"
          and pg.is_visible("#posts-drafts") and pg.is_hidden("#posts-posted"))
    check("both parts are there, in plain words", pg.inner_text("#posts-part-posted").strip() == "Posted"
          and pg.inner_text("#posts-part-drafts").replace("\n", " ").split()[0] == "Drafts", pg.inner_text("#posts-part-drafts"))
    check("Drafts shows its count", pg.text_content("#drafts-count") == "1" and pg.is_visible("#drafts-count"), pg.text_content("#drafts-count"))
    card = pg.locator("#list-saved article").first
    text = card.inner_text()
    check("quote 1 is under Not finished yet, with her words", pg.is_visible("#saved-wrap") and "Not finished yet" in pg.inner_text("#saved-wrap") and mine in text, text)
    check("the card says when it changed and what is chosen", "Changed " in text and "Photo background" in text and "Music" in text, text)
    check("the card has Continue and Delete", card.get_by_role("button", name="Continue").is_visible() and card.get_by_role("button", name="Delete").is_visible())
    check("no empty-state words while something is there", pg.is_hidden("#drafts-empty"))
    pg.screenshot(path=f"{SHOTS}/a15_2_posts_drafts.png", full_page=True)
    pg.click("#posts-part-posted")
    check("Posted shows the posted list and hides Drafts", pg.is_visible("#posts-posted") and pg.is_hidden("#posts-drafts")
          and pg.get_attribute("#posts-part-posted", "aria-pressed") == "true" and pg.get_attribute("#posts-part-drafts", "aria-pressed") == "false")
    pg.screenshot(path=f"{SHOTS}/a15_3_posts_posted.png", full_page=True)
    pg.click("#posts-part-drafts")
    pg.focus("#posts-part-posted"); pg.keyboard.press("Tab")
    check("the parts can be reached with the keyboard", pg.evaluate("document.activeElement.id") == "posts-part-drafts")

    # ---- Continue: everything back; quote 2 is set aside ----
    q2_id = doc("draft")["id"]
    pg.locator("#list-saved article").first.get_by_role("button", name="Continue").click()
    pg.wait_for_function("Studio.draftFiles().bg && Studio.draftFiles().music && !/Bringing back/.test(document.getElementById('draft-note').textContent)", timeout=20000)
    pg.wait_for_timeout(600)
    back = pg.evaluate("Studio.snapshot()")
    check("Continue opens Create", pg.is_visible("#view-create"))
    check("her words, the photo and the music are back exactly", back == snap1, json.dumps([snap1, back])[:1500])
    check("it goes on as the same draft", pg.evaluate("Studio.draft().id") == d1["id"])
    moved = until(lambda: [x for x in (doc("drafts") or []) if x["id"] == q2_id])
    check("quote 2 is now set aside", bool(moved), doc("drafts"))
    check("and quote 1 is no longer among the set-aside ones", until(lambda: all(x["id"] != d1["id"] for x in (doc("drafts") or []))), doc("drafts"))
    pg.screenshot(path=f"{SHOTS}/a15_4_continued.png")
    pg.click("#nav-posts")
    pg.wait_for_selector("#list-saved article", timeout=10000)
    check("Posts opens on the part used last (Drafts)", pg.get_attribute("#posts-part-drafts", "aria-pressed") == "true")
    pg.wait_for_function("document.querySelectorAll('#list-saved article').length === 1 && document.querySelector('#list-saved article').innerText.includes('Changed')", timeout=10000)
    t2 = pg.inner_text("#list-saved article")
    check("Drafts now lists quote 2", q2.split("\n")[0][:15] in t2 and mine not in t2, [q2, t2])

    # ---- Delete, after asking ----
    pg.locator("#list-saved article").first.get_by_role("button", name="Delete").click()
    pg.wait_for_selector("#confirm:not([hidden])", timeout=5000)
    check("Delete asks first", "Delete this draft?" in pg.text_content("#confirm-title"))
    pg.click("#confirm-yes")
    pg.wait_for_selector("#drafts-empty:not([hidden])", timeout=10000)
    check("with nothing unfinished it says so plainly", pg.text_content("#drafts-empty") == "Nothing unfinished. A reel you start in Create is kept here by itself.")
    check("the count has gone", pg.is_hidden("#drafts-count"))
    check("deleted on the server too", doc("drafts") == [], doc("drafts"))
    pg.screenshot(path=f"{SHOTS}/a15_5_empty.png", full_page=True)

    # ---- the part used last is remembered; a reel waiting for her tap opens Drafts ----
    pg.click("#posts-part-posted"); pg.click("#nav-today"); pg.click("#nav-posts"); pg.wait_for_timeout(500)
    check("back to Posted when that was used last", pg.get_attribute("#posts-part-posted", "aria-pressed") == "true")
    s, j, _ = http("POST", "/api/jobs", {"length": 8, "bgName": "b.jpg", "bgSize": 10}, token)
    http("PUT", f"/api/render/{j['id']}/reel", b"\0" * 2000, "dev-render-secret", {"Content-Type": "video/mp4"})
    s, q, _ = http("POST", "/api/queue", {"jobId": j["id"], "quote": "waiting for her tap"}, token)
    pg.click("#nav-today"); pg.click("#nav-posts")
    pg.wait_for_selector("#list-queue article", timeout=10000)
    check("a reel waiting for her tap opens Drafts", pg.get_attribute("#posts-part-drafts", "aria-pressed") == "true" and pg.is_visible("#list-queue article"), s)
    check("the count includes it", pg.text_content("#drafts-count") == "1", pg.text_content("#drafts-count"))
    pg.screenshot(path=f"{SHOTS}/a15_6_waiting.png", full_page=True)
    check("no page errors", not errors, errors)
    br.close()

finish()

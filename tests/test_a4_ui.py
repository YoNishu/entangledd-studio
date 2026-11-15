"""Agent 4: what she sees of the scorer. One line in the Nishiii section, a thin progress line while learning,
a quiet "Something different" tag on the wildcard once live, and the count back to 0 after Forget everything.
Run: python3 tests/test_a4_ui.py"""
import where as _W
import os
from playwright.sync_api import sync_playwright
from a4lib import *

S = f"{_W.OUT}/shots/"
os.makedirs(S, exist_ok=True)

def open_app(p):
    b = p.chromium.launch(channel="chrome")
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(BASE + "/"); pg.wait_for_timeout(800)
    pg.fill("#passcode", "letmein"); pg.click("#passcode-go"); pg.wait_for_timeout(1200)
    return b, pg, errs

def nishiii(pg):
    pg.click("#nav-nishiii")
    pg.wait_for_selector("#scorer-line", timeout=15000)
    pg.wait_for_timeout(400)

with sync_playwright() as p:
    print("A. learning: 20 picks")
    serve(); put_log(history(20, 1, likes_calm_short, seed=3)); run_job()
    b, pg, errs = open_app(p)
    nishiii(pg)
    check("the line reads 20 of 50", pg.text_content("#scorer-line") == "Learning from your picks: 20 of 50.", pg.text_content("#scorer-line"))
    w = pg.evaluate("document.getElementById('scorer-fill').style.width")
    check("the progress line is 40% full", w == "40%", w)
    whole = pg.evaluate("document.getElementById('scorer-slot').textContent")
    check("nothing else is written there while learning", whole == "Learning from your picks: 20 of 50.", repr(whole))
    pg.locator("#scorer-slot").scroll_into_view_if_needed()
    pg.screenshot(path=S + "a4_learning.png")
    check("no page errors", not errs, str(errs))
    b.close()

    print("B. live: 60 picks with a clear taste")
    serve(); put_log(history(60, 1, likes_calm_short, seed=3)); m = run_job()
    check("live", m["state"] == "live", str(m.get("eval")))
    call("PUT", "/__scorer_pool", pool_calm_short_late())
    b, pg, errs = open_app(p)
    pg.click("#nav-today")
    pg.wait_for_selector("[id^=wild-]", timeout=30000)
    tags = pg.locator("[id^=wild-]")
    check("one quiet wildcard tag on Today", tags.count() == 1 and tags.first.text_content() == "Something different", str(tags.count()))
    check("five cards on Today", pg.locator("#view-today article.card").count() == 5, str(pg.locator("#view-today article.card").count()))
    tags.first.scroll_into_view_if_needed()
    pg.screenshot(path=S + "a4_wildcard.png")
    nishiii(pg)
    line = pg.text_content("#scorer-line")
    check("the line says it is ranking", line.startswith("Now ranking your daily quotes by what you pick. Lately: "), line)
    check("no progress line when live", pg.locator("#scorer-bar").count() == 0)
    whole = pg.evaluate("document.getElementById('scorer-slot').textContent")
    check("nothing else is written there when live", whole == line, repr(whole))
    pg.locator("#scorer-slot").scroll_into_view_if_needed()
    pg.screenshot(path=S + "a4_live.png")

    print("C. Forget everything")
    pg.click("#forget-all"); pg.wait_for_timeout(500)
    pg.click("#confirm-yes")
    pg.wait_for_function("document.getElementById('scorer-line').textContent.includes('0 of 50')", timeout=15000)
    check("after forgetting, the count starts again", pg.text_content("#scorer-line") == "Learning from your picks: 0 of 50.")
    check("the progress line is empty again", pg.evaluate("document.getElementById('scorer-fill').style.width") == "0%")
    pg.locator("#scorer-slot").scroll_into_view_if_needed()
    pg.screenshot(path=S + "a4_forgot.png")
    log, m = doc("scorer/log"), doc("scorer/model")
    check("the stored record is empty", log["rows"] == [] and not log.get("fold") and log.get("since", 0) > 0, str(log)[:200])
    check("the stored model is back to learning from nothing", m["state"] == "learning" and m["picks"] == 0 and m["passes"] == 0, str(m)[:200])
    pg.click("#forget-all"); pg.wait_for_timeout(600)
    note = pg.text_content("#taste-note")
    check("a second Forget everything finds nothing left", note.startswith("There's nothing to forget") and not pg.locator("#confirm-yes").is_visible(), note)
    check("no page errors", not errs, str(errs))
    b.close()
    print("D. Forget the profile leaves the count alone; each pop-up says what it erases")
    import time
    serve(); put_log(history(20, 1, likes_calm_short, seed=3)); run_job()
    doc("taste", {"profile": {"summary": "You like quiet lines.", "loves": ["the sea"], "avoids": [], "voice": [], "look": [], "performs": []}, "notes": [], "updatedAt": int(time.time() * 1000)})
    b, pg, errs = open_app(p)
    nishiii(pg)
    pg.click("#forget-profile"); pg.wait_for_selector("#confirm-yes", state="visible", timeout=10000)
    said = pg.text_content("#confirm-body")
    check("the profile pop-up promises only the profile", "written about your taste" in said and "picked" not in said, said)
    pg.screenshot(path=S + "a4_forget_profile_popup.png")
    pg.click("#confirm-yes")
    pg.wait_for_function("document.getElementById('taste-note').textContent.startsWith('The profile was erased')", timeout=15000)
    pg.wait_for_timeout(1200)
    check("after Forget the profile the count is as it was", pg.text_content("#scorer-line") == "Learning from your picks: 20 of 50.", pg.text_content("#scorer-line"))
    check("and the stored record still holds her picks", sum(1 for r in doc("scorer/log")["rows"] if r["s"] == 1) == 20)
    pg.click("#forget-all"); pg.wait_for_selector("#confirm-yes", state="visible", timeout=10000)
    said = pg.text_content("#confirm-body")
    check("the Forget everything pop-up names the record of picks", "the record of every quote you picked, skipped or reworded" in said, said)
    pg.screenshot(path=S + "a4_forget_all_popup.png")
    pg.click("#confirm-no"); pg.wait_for_timeout(800)
    check("Cancel erases nothing", pg.text_content("#scorer-line") == "Learning from your picks: 20 of 50." and doc("scorer/model")["picks"] == 20)
    check("no page errors", not errs, str(errs))
    b.close()
finish("scorer as she sees it")

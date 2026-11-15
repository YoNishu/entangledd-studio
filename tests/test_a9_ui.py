"""Agent 9: what she sees of the engine. A quiet reason on each of Today's cards; the Nishiii section's line says what
has been learnt and where the lines come from (no count to fifty, no progress bar); Insights' "What works" says what
the engine takes from her numbers; the background search offers words that did well for her. Everything is made up."""
import where as _W
import os, time
from playwright.sync_api import sync_playwright
from a3lib import *

S = f"{_W.OUT}/shots/"
os.makedirs(S, exist_ok=True)
NOW = int(time.time() * 1000)

serve()
T = login()
putdoc("library", {"books": [{"id": "b1", "title": "The Quiet Book", "author": "Ada Writer", "found": {"at": NOW, "lines": [
    {"text": f"A found line {n} about {t}, kept word for word.", "by": "Ada Writer", "theme": t, "tone": "calm", "url": "https://en.wikiquote.org/wiki/Q", "site": "wikiquote.org", "verify": False}
    for n, t in enumerate(["hope", "sea", "time"], 1)]}}], "screen": [], "quotes": [{"id": "q1", "text": "the sea keeps my hope", "author": ""}]})
putdoc("engine/bank", {"v": 1, "asked": {}, "tried": {}, "used": {}, "day": "", "lines": [
    {"text": "A line about courage the web found, checked on two sites.", "by": "Writer One", "work": "Brave Book", "type": "book", "url": "https://www.goodreads.com/q/1", "site": "goodreads.com", "verify": False, "th": "courage", "from": "discover"},
    {"text": "The wound is the place where the Light enters you.", "by": "Rumi", "work": "", "type": "classic", "url": "", "site": "", "verify": True, "th": "healing", "from": "echo"}]})
pub = lambda i, theme, saved, words: {"id": f"p{i}", "state": "published", "kind": "reel", "quote": f"{theme} line {i}", "theme": theme, "tone": "calm", "source": "book",
    "created": NOW - (10 - i) * DAY, "published": NOW - (10 - i) * DAY, "caption": f"#{theme} #quiet", "made": {"bg": "video", "bgFrom": "search", "bgWords": words},
    "metrics": {"reach": 1000, "views": 1500, "saved": saved, "shares": 2, "likes": 40, "comments": 1}}
putdoc("posts", [pub(i, "hope", 60, "misty sea") for i in range(3)] + [pub(i + 3, "love", 2, "city lights") for i in range(3)])
putdoc("taste", {"profile": {"summary": "You like quiet lines.", "loves": ["quiet lines about the sea"], "avoids": [], "voice": [], "look": [], "performs": []}, "notes": [], "updatedAt": NOW})

with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome")
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(B + "/"); pg.wait_for_timeout(800)
    pg.fill("#passcode", "letmein"); pg.click("#passcode-go"); pg.wait_for_timeout(1200)

    # ---- Today: a reason on each card
    pg.click("#nav-today")
    pg.wait_for_selector("#suggestions article.card", timeout=30000)
    pg.wait_for_timeout(500)
    cards = pg.locator("#suggestions article.card")
    whys = pg.locator("#suggestions [id^=why-]")
    print("     reasons:", [whys.nth(i).text_content() for i in range(whys.count())])
    check("five cards on Today", cards.count() == 5, cards.count())
    check("most cards carry a quiet reason", whys.count() >= 3, whys.count())
    stored = {i["id"]: i for i in doc("suggestions/" + time.strftime("%Y-%m-%d", time.gmtime(time.time() + 5.5 * 3600)))}
    same = all(whys.nth(i).text_content() == stored[whys.nth(i).get_attribute("id")[4:]]["why"] for i in range(whys.count()))
    check("each reason on screen is the one stored with that quote", same)
    check("the reason is small and quiet (12px, italic)", whys.count() and whys.first.evaluate("e => getComputedStyle(e).fontSize") == "12px" and whys.first.evaluate("e => getComputedStyle(e).fontStyle") == "italic")
    check("no technical words in the reasons", not any(w in " ".join(whys.nth(i).text_content() for i in range(whys.count())).lower() for w in ["score", "weight", "engine", "api", "null", "undefined"]))
    web_card = pg.locator("#suggestions article.card", has_text="the web found")
    if web_card.count():
        check("a line found on the web is not said to be from her book list", web_card.locator(".src").first.text_content() == "From the book Brave Book", web_card.locator(".src").first.text_content())
    cards.first.scroll_into_view_if_needed()
    pg.screenshot(path=S + "a9_today_reasons.png")

    # ---- Nishiii: what has been learnt, and where the lines come from
    pg.click("#nav-nishiii"); pg.click("#nishiii-part-knows")
    pg.wait_for_selector("#scorer-line", timeout=15000); pg.wait_for_timeout(500)
    line = pg.text_content("#scorer-line"); src = pg.text_content("#engine-sources") if pg.locator("#engine-sources").count() else ""
    print("     line:", line); print("     sources:", src)
    check("the line says what it learns from and what it has learnt", line.startswith("Learning from what you told Nishiii") and "So far:" in line and "50" not in line, line)
    check("no progress bar", pg.locator("#scorer-bar").count() == 0)
    check("where the lines come from, in plain words", "3 found for your books, films and series" in src and "1 from the web" in src and "1 behind posts you follow" in src and "1 of your own" in src, src)
    pg.locator("#scorer-slot").scroll_into_view_if_needed()
    pg.screenshot(path=S + "a9_nishiii_line.png")

    # ---- Insights: what the engine takes from the numbers
    pg.click("#nav-insights")
    pg.wait_for_selector("#works-engine:not([hidden])", timeout=20000); pg.wait_for_timeout(300)
    wl = pg.text_content("#works-engine")
    print("     what works:", wl)
    check("'What works' says what Nishiii now leans on", wl.startswith("Nishiii now leans on this when choosing your quotes:") and "posts about hope do well for you" in wl, wl)
    pg.locator("#works-engine").scroll_into_view_if_needed()
    pg.screenshot(path=S + "a9_insights_works.png")

    # ---- Create: background words that did well for her
    pg.click("#nav-create"); pg.wait_for_timeout(300)
    if pg.locator("#tab-bg").count(): pg.click("#tab-bg")
    pg.click("#stock")
    pg.wait_for_selector("#stock-ideas button", timeout=15000)
    ideas = [x.text_content() for x in pg.locator("#stock-ideas button").all()]
    check("the background search offers the words that did well for her", ideas == ["misty sea"], ideas)
    pg.locator("#stock-ideas button").first.click(); pg.wait_for_timeout(800)
    check("a tap searches for them", pg.input_value("#stock-q") == "misty sea")
    pg.screenshot(path=S + "a9_stock_ideas.png")
    check("no page errors", not errs, errs)
    b.close()
finish()

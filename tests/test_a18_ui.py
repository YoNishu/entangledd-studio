"""Find quotes in the Library, at phone size (390 px): Library -> Find quotes -> one series -> 10 -> the lines appear in
the sheet to read, each with Create with this / Reword / Skip -> close -> they are under "Quotes you found" (folded
after four, "Show all") -> "Create with this" puts the line in Create. The Nishiii section no longer has the ask
block; a row's own "Find quotes" opens the sheet with that work chosen; the number chosen is remembered.
Starts its own fresh server. "The Lantern Years" is a made-up series (server/devparts/askmore.mjs)."""
from a8lib import *
from playwright.sync_api import sync_playwright
import where as _W

S = _W.OUT + "/shots/"
serve()
T = login()
series = add_screen(T, "The Lantern Years", "series")
film = add_screen(T, "The Long Tide", "film")

with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome")
    pg = br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True, is_mobile=True).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"{_W.URL}/"); pg.wait_for_selector("#passcode", timeout=8000)
    pg.fill("#passcode", "letmein"); pg.click("#passcode-go"); pg.wait_for_timeout(1500)

    # ---- the Nishiii section: the ask block is gone, the rest is there
    pg.click("#nav-nishiii"); pg.wait_for_timeout(500)
    nishiii = pg.inner_text("#view-nishiii")
    check("the Nishiii section has no ask block", pg.locator("#ask-open, #asked-list, #asked-note").count() == 0
          and "Ask Nishiii for quotes" not in nishiii and "Ask for quotes" not in nishiii, nishiii[:200])
    check("the chat button and the taste part are still there", pg.locator("#view-nishiii #nishiii-chat").count() == 1 and pg.locator("#view-nishiii #taste-refresh").count() == 1)

    # ---- Library -> Find quotes -> one series -> 10
    pg.click("#nav-library"); pg.wait_for_selector("#find-open", state="visible", timeout=8000)
    top = pg.evaluate("() => { const f = document.getElementById('find-open').getBoundingClientRect(), h = document.querySelector('#view-library > h2').getBoundingClientRect(); return f.top < h.top; }")
    check("Find quotes is at the top of the Library, a primary button with a line under it",
          top and "primary" in pg.get_attribute("#find-open", "class") and "Choose one, or mix a few" in pg.inner_text("#find-top"))
    check("nothing found yet: no empty 'Quotes you found'", pg.locator("#found-wrap").is_hidden())
    pg.click("#find-open"); pg.wait_for_selector("#ask-groups button", timeout=8000)
    check("the sheet is called Find quotes, and offers 5, 10, 15 and 20, 10 chosen", pg.inner_text("#ask-title") == "Find quotes"
          and pg.locator("#ask-count button").all_inner_texts() == ["5", "10", "15", "20"] and pg.get_attribute("#ask-count-10", "aria-pressed") == "true"
          and pg.inner_text("#ask-go") == "Find 10 quotes", pg.locator("#ask-count button").all_inner_texts())
    pg.locator("#ask-groups button", has_text="The Lantern Years").click()
    pg.screenshot(path=S + "a18_01_choose.png")
    pg.click("#ask-go")
    pg.wait_for_function("document.querySelectorAll('#ask-results .card').length >= 5", timeout=30000)
    mid = pg.inner_text("#ask-progress")
    pg.wait_for_function("document.getElementById('ask-progress').textContent.startsWith('Found 10')", timeout=30000)
    pg.screenshot(path=S + "a18_02_found.png")
    cards = pg.locator("#ask-results .card")
    first = cards.first
    check("ten lines appear in the sheet, with a plain progress line on the way", cards.count() == 10 and (mid.startswith("Found 5 of 10") or mid.startswith("Finding") or mid.startswith("Found 10")),
          (cards.count(), mid))
    check("each to read: the quote, who says it, the work and where it was found", first.locator(".q").inner_text().strip() != ""
          and first.locator(".by").count() == 1 and "The Lantern Years" in first.locator(".src").first.inner_text()
          and first.locator("a.src.found").count() == 1, first.inner_text()[:200])
    check("each with Create with this, Reword and Skip", first.locator(".acts button").all_inner_texts() == ["Create with this", "Reword", "Skip"],
          first.locator(".acts button").all_inner_texts())
    check("the choosing part folds away, with Find more and Change what", pg.locator("#ask-choose").is_hidden() and pg.locator("#ask-more").is_visible() and pg.locator("#ask-change").is_visible())
    first.locator("text=Reword").click(); pg.wait_for_timeout(500)
    on_top = pg.evaluate("() => { const r = document.querySelector('#reword .sheet-body').getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + 30); return !!e && !!e.closest('#reword'); }")
    check("Reword opens over the sheet, with the line in it", on_top and pg.inner_text("#reword-original").strip() == first.locator(".q").inner_text().strip())
    pg.click("#reword-close"); pg.wait_for_timeout(300)
    check("and closing it leaves the sheet as it was", pg.locator("#ask-sheet").is_visible() and pg.locator("#ask-results .card").count() == 10)
    texts = [t.strip() for t in pg.locator("#ask-results .card .q").all_inner_texts()]
    skipped = texts[1]
    cards.nth(1).locator("text=Skip").click(); pg.wait_for_timeout(600)
    check("Skip takes it off at once", pg.locator("#ask-results .card").count() == 9)

    # ---- close: nothing lost, all under "Quotes you found"
    pg.click("#ask-close"); pg.wait_for_timeout(600)
    check("closed", pg.locator("#ask-sheet").is_hidden())
    pg.screenshot(path=S + "a18_03_library.png")
    found = pg.locator("#found-list .card")
    check("they are under 'Quotes you found', newest first, folded after four", pg.locator("#found-wrap").is_visible()
          and pg.inner_text("#found-wrap h2") == "Quotes you found" and found.count() == 4 and pg.inner_text("#found-all") == "Show all 9",
          (found.count(), pg.inner_text("#found-all")))
    pg.click("#found-all"); pg.wait_for_timeout(300)
    listed = [t.strip() for t in pg.locator("#found-list .card .q").all_inner_texts()]
    check("Show all shows the nine, the skipped one not among them", len(listed) == 9 and skipped not in listed and set(listed) == set(texts) - {skipped}, len(listed))
    check("each still has the three actions", pg.locator("#found-list .card").first.locator(".acts button").all_inner_texts() == ["Create with this", "Reword", "Skip"])

    # ---- Create with this
    line = listed[0]
    pg.locator("#found-list .card").first.locator("text=Create with this").click(); pg.wait_for_timeout(900)
    words = pg.input_value("#words")
    plain = lambda t: " ".join(t.split())
    check("Create with this puts the line in Create", pg.locator("#view-create").is_visible() and plain(words) == plain(line), (words[:80], line[:80]))
    pg.screenshot(path=S + "a18_04_create.png")

    # ---- a row's own Find quotes; and the number remembered
    pg.click("#nav-library"); pg.wait_for_selector("#find-" + film, timeout=8000)
    check("each book, film and series row has its own Find quotes", pg.locator("#find-" + series).count() == 1 and pg.inner_text("#find-" + film) == "Find quotes")
    pg.click("#find-" + film); pg.wait_for_selector("#ask-groups button", timeout=8000); pg.wait_for_timeout(300)
    chosen = pg.locator("#ask-groups button[aria-pressed=true]").all_inner_texts()
    check("it opens the sheet with that one work chosen", chosen == ["The Long Tide"] and pg.locator("#ask-choose").is_visible(), chosen)
    pg.click("#ask-count-5")
    pg.screenshot(path=S + "a18_05_row.png")
    pg.click("#ask-close")
    pg.reload(); pg.wait_for_timeout(1500)
    if pg.locator("#passcode").is_visible(): pg.fill("#passcode", "letmein"); pg.click("#passcode-go"); pg.wait_for_timeout(1500)
    pg.click("#nav-library"); pg.wait_for_selector("#find-open", state="visible", timeout=8000)
    pg.click("#find-open"); pg.wait_for_timeout(500)
    check("the number chosen is remembered on the phone", pg.get_attribute("#ask-count-5", "aria-pressed") == "true" and pg.inner_text("#ask-go") == "Find 5 quotes")
    check("no errors on the page", not errs, errs)
    br.close()
finish()

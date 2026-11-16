"""Find quotes at phone size (390 px), for a new drama whose lines are on 30 pages of reviews the app may not read
itself ("The Willow Station", made up, server/devparts/extract.mjs): 10 asked; the progress line says what is
happening ("Found 5 of 10. Reading more reviews of ..."), then "Found 10 of 10" with ten cards. A Stop button is
there while it looks. Adding a series in the Library reads its first pages in the background (a look right after
its title is checked)."""
import re
from a8lib import *
from playwright.sync_api import sync_playwright
import where as _W

S = _W.OUT + "/shots/"
serve("WEBSEARCH=unset", "TAVILY=on", "OPEN_SEARCH=off")
T = login()
w = add_screen(T, "The Willow Station", "series")
lib = doc("library"); x = next(i for i in lib["screen"] if i["id"] == w)
x["known"] = {"title": "The Willow Station", "real": "The Willow Station", "original": "柳站", "year": 2026, "kind": "series", "country": "Chinese",
              "characters": ["Su Qing", "Gu Yan"], "cast": ["Mei Lin", "Zhao Feng"]}
putdoc("library", lib)

with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome")
    pg = br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True, is_mobile=True).new_page()
    errs, looks = [], []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("request", lambda r: looks.append(r.url) if r.url.endswith("/look") else None)
    pg.goto(f"{_W.URL}/"); pg.wait_for_selector("#passcode", timeout=8000)
    pg.fill("#passcode", "letmein"); pg.click("#passcode-go"); pg.wait_for_timeout(1500)
    pg.click("#nav-library"); pg.wait_for_selector("#find-open", state="visible", timeout=8000)
    pg.click("#find-open"); pg.wait_for_selector("#ask-groups button", timeout=8000)
    pg.click("#ask-count-10")
    pg.locator("#ask-groups button", has_text="The Willow Station").click()
    pg.click("#ask-go")
    progress = []
    pg.wait_for_function("document.querySelectorAll('#ask-results .card').length >= 1", timeout=60000)
    stop_seen = pg.locator("#ask-stop").is_visible()
    for _ in range(120):
        t = pg.inner_text("#ask-progress")
        if not progress or progress[-1] != t: progress.append(t)
        if t.startswith("Found 10 of 10"): break
        if "Reading more" in t: pg.screenshot(path=S + "a21_01_reading.png")
        pg.wait_for_timeout(250)
    print("  progress lines:", progress)
    pg.screenshot(path=S + "a21_02_found.png")
    cards = pg.locator("#ask-results .card")
    check("a Stop button while it looks", stop_seen)
    # (What it reads next is named only in a round that brought fewer than asked; test_a21_find covers that sentence.)
    # (Sampled four times a second: when the rounds are quicker than that, only the last line is seen.)
    check("the progress line counts up on the way", len(progress) == 1 or any(re.match(r"(Finding|Found [1-9] of) 10", t) for t in progress[:-1]), progress)
    check("it ends 'Found 10 of 10' with ten cards", pg.inner_text("#ask-progress").startswith("Found 10 of 10") and cards.count() == 10, (pg.inner_text("#ask-progress"), cards.count()))
    check("and the Stop button is gone", pg.locator("#ask-stop").is_hidden())
    words = " ".join(cards.all_inner_texts())
    check("no reviewer's remark among the cards", not any(x in words for x in ["SO good", "top-notch", "really just happen", "Quiet Hit"]), words[:300])

    # ---- Stop: she stops it, and the line says so
    pg.evaluate("() => { document.getElementById('ask-more').click(); document.getElementById('ask-stop').click(); }")
    pg.wait_for_function("document.getElementById('ask-progress').textContent.startsWith('Stopped')", timeout=60000)
    check("stopped by her: said so", pg.inner_text("#ask-progress").startswith("Stopped. Found "), pg.inner_text("#ask-progress"))
    pg.screenshot(path=S + "a21_03_stopped.png")
    pg.click("#ask-close"); pg.wait_for_timeout(500)

    # ---- adding a series: its first pages are read in the background
    pg.evaluate("document.querySelector('#add-screen').closest('details').open = true"); pg.wait_for_timeout(300)
    pg.fill("#s-title", "Harbour in March"); pg.select_option("#s-kind", "series")
    pg.locator("#add-screen button[type=submit]").click()
    for _ in range(60):
        if looks: break
        pg.wait_for_timeout(250)
    check("adding a series reads its first pages at once (a look after its title check)", any("/library/screen/" in u for u in looks), looks)
    pg.wait_for_timeout(3000)
    check("no page errors", not errs, errs)
    br.close()
finish()

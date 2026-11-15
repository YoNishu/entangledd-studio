"""The Library at phone size (390 px) after a look-up: a work where nothing was found says where Nishiii looked,
in one sentence, with "Look again"; two entries for one work ("The Late Thaw" and "The late thaw cdrama") offer
to keep one, and only do it on her tap. Every work here is made up."""
from a8lib import *
from playwright.sync_api import sync_playwright
import where as _W, os

SHOTS = f"{_W.OUT}/shots/"
os.makedirs(SHOTS, exist_ok=True)
serve("WEBSEARCH=unset", "GEMINI=on")
T = login()
first = add_screen(T, "The Late Thaw", "series", checked=False)
http("POST", f"/api/library/screen/{first}/title", {}, T)
twin = add_screen(T, "The late thaw cdrama", "series", checked=False)
http("POST", f"/api/library/screen/{twin}/title", {}, T)
none = add_screen(T, "Nobody Knows This Show", "series")
s, said = ask(T, [none], 2)
check("the look found nothing, and said where it looked", s == 502 and "Looked on Wikiquote, IMDb and Google: nothing yet." in said, (s, said))

with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome")
    pg = br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True, is_mobile=True).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"{_W.URL}/"); pg.wait_for_selector("#passcode", timeout=8000)
    pg.fill("#passcode", "letmein"); pg.click("#passcode-go"); pg.wait_for_timeout(1500)
    pg.click("#nav-library"); pg.wait_for_timeout(800)

    look = pg.locator(f"#look-{none}")
    look.wait_for(state="visible", timeout=8000)
    check("the row says where Nishiii looked", look.inner_text() == "Looked on Wikiquote, IMDb and Google: nothing yet.", look.inner_text())
    again = pg.locator(f"#look-again-{none}")
    check("with 'Look again'", again.is_visible() and again.inner_text() == "Look again")
    look.scroll_into_view_if_needed(); pg.screenshot(path=SHOTS + "a11_01_looked.png")

    merge = pg.locator(f"#merge-{twin}")
    check("the second entry for the same work offers to keep one", merge.is_visible() and merge.inner_text() == "Same as “The Late Thaw”? Keep one", merge.inner_text() if merge.count() else "")
    check("the first entry offers nothing of the kind", pg.locator(f"#merge-{first}").count() == 0)
    check("nothing merged before her tap", len(doc("library")["screen"]) == 3)
    merge.scroll_into_view_if_needed(); pg.screenshot(path=SHOTS + "a11_02_same_work.png")
    merge.click()
    pg.wait_for_function(f"() => !document.getElementById('merge-{twin}')", timeout=8000)
    check("after her tap: one entry for the work", [x["title"] for x in doc("library")["screen"]] == ["The Late Thaw", "Nobody Knows This Show"], doc("library")["screen"])

    # "Look again" a moment after a look is asked to wait; later it looks
    pg.locator(f"#look-again-{none}").click(); pg.wait_for_timeout(1200)
    note = pg.locator("#library-note")
    check("tapped at once: asked to wait a minute", note.is_visible() and "a moment ago" in note.inner_text(), note.inner_text())
    age_found(none, 1 / 24)
    calls()
    pg.locator(f"#look-again-{none}").click()
    pg.wait_for_function(f"() => document.getElementById('look-again-{none}') && document.getElementById('look-again-{none}').textContent === 'Look again' && !document.getElementById('look-again-{none}').disabled", timeout=30000)
    asked = [x for x in calls() if x["to"] == "gemini" and x.get("body")]
    check("later it looks again, and the row keeps her sentence", len(asked) == 2 and pg.locator(f"#look-{none}").inner_text().startswith("Looked on"), len(asked))
    pg.locator(f"#look-{none}").scroll_into_view_if_needed(); pg.screenshot(path=SHOTS + "a11_03_looked_again.png")
    check("no errors on the page", not errs, errs)
    br.close()
finish()

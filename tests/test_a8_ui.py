"""Found lines in the app at phone size (390 px): the quote cards say where a line was found, the Library says
how many real lines a work has (with "Not the right one"), and when nothing is found anywhere she gets a plain
message with nothing to do by hand but add lines she loves."""
from a8lib import *
from playwright.sync_api import sync_playwright
import where as _W

serve("WEBSEARCH=unset", "GEMINI=on")
T = login()
film = add_screen(T, "The Long Tide", "film")
book = add_book(T, "Glass Rivers", "Ana Vale")
new = add_book(T, "Twisted Love", "Ana Huang")
quiet = add_book(T, "Nobody Knows This Book", "")
ask(T, [new], 3)        # found through Gemini: one line sure, two to check
ask(T, [book], 2)       # found on Goodreads
ask(T, [film], 2)       # found on Wikiquote

with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome")
    pg = br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True, is_mobile=True).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"{_W.URL}/"); pg.wait_for_selector("#passcode", timeout=8000)
    pg.fill("#passcode", "letmein"); pg.click("#passcode-go"); pg.wait_for_timeout(1500)

    # ---- the cards in the Nishiii section
    pg.click("#nav-nishiii"); pg.wait_for_selector("#asked-list .card", timeout=8000)
    cards = pg.locator("#asked-list .card")
    wiki = cards.filter(has_text="From the film The Long Tide")
    check("a line from Wikiquote says so, as a link to the page", wiki.count() == 2 and wiki.first.locator("a.src.found").inner_text() == "Found on wikiquote.org"
          and wiki.first.locator("a.src.found").get_attribute("href") == "https://en.wikiquote.org/wiki/The_Long_Tide_(film)", wiki.count())
    link = wiki.first.locator("a.src.found")
    check("the link opens in a new tab", link.get_attribute("target") == "_blank" and "noopener" in (link.get_attribute("rel") or ""))
    check("it names who says the line", wiki.first.locator(".by").inner_text() in ("— Mara", "— Captain Ilves"), wiki.first.locator(".by").inner_text())
    check("and asks for no checking", wiki.first.locator(".chip.bad").count() == 0)
    good = cards.filter(has_text="Glass Rivers")
    check("a line from Goodreads says so", good.count() == 2 and good.first.locator("a.src.found").inner_text() == "Found on goodreads.com", good.count())
    web = cards.filter(has_text="Twisted Love")
    sure = web.filter(has_text="first line"); unsure = web.filter(has_text="second line")
    check("a line two sites agree on is shown without a warning", sure.count() == 1 and sure.locator(".chip.bad").count() == 0 and sure.locator("a.src.found").inner_text().startswith("Found on "))
    check("a line found on one site only asks her to check it", unsure.count() == 1 and unsure.locator(".chip.bad").inner_text() == "Check the wording and author before posting")
    box = wiki.first.bounding_box()
    check("the cards fit the screen", box["x"] >= 0 and box["x"] + box["width"] <= 390, box)
    wiki.first.scroll_into_view_if_needed(); pg.wait_for_timeout(300)
    pg.screenshot(path=f"{_W.OUT}/shots/a8_cards.png")

    # ---- nothing anywhere: a plain message in the sheet
    pg.click("#ask-open"); pg.wait_for_selector("#ask-groups button", timeout=8000)
    pg.locator("#ask-groups button", has_text="Nobody Knows This Book").click()
    pg.click("#ask-go")
    pg.wait_for_function("document.getElementById('ask-status').textContent.length > 20", timeout=15000)
    said = pg.inner_text("#ask-status")
    check("nothing found anywhere: she is told plainly", "found no real lines from Nobody Knows This Book" in said and "Library" in said, said)
    check("with nothing to do by hand on Google, and no button for it", not any(x in said.lower() for x in ("google", "screenshot")) and pg.locator("text=Find lines on Google").count() == 0 and pg.locator("text=Read my screenshot").count() == 0, said)
    pg.screenshot(path=f"{_W.OUT}/shots/a8_nothing.png")
    pg.click("#ask-close")

    # ---- the Library says how many lines a work has
    pg.click("#nav-library"); pg.wait_for_selector(f"#found-{film}", timeout=8000)
    n = len(kept(film))
    check("a film shows how many real lines were found, and where", pg.inner_text(f"#found-{film}") == f"{n} real lines found on wikiquote.org.", pg.inner_text(f"#found-{film}"))
    check("a book too", pg.inner_text(f"#found-{book}") == f"{len(kept(book))} real lines found on goodreads.com.", pg.inner_text(f"#found-{book}"))
    check("lines from several sites are counted without naming one", pg.inner_text(f"#found-{new}") == "3 real lines found.", pg.inner_text(f"#found-{new}"))
    check("a work with nothing found shows no such line", pg.locator(f"#found-{quiet}").count() == 0)
    pg.locator(f"#found-{film}").scroll_into_view_if_needed(); pg.wait_for_timeout(300)
    pg.screenshot(path=f"{_W.OUT}/shots/a8_library.png")
    row = pg.locator(f"#found-{film}").locator("xpath=ancestor::li")
    box = row.bounding_box()
    check("the row fits the screen", box["x"] >= 0 and box["x"] + box["width"] <= 390, box)
    pg.click(f"#found-wrong-{film}")
    pg.wait_for_function(f"!document.getElementById('found-{film}')", timeout=8000)
    check("'Not the right one' takes the found lines away", kept(film) == [] and work(film)["found"]["not"] == ["The Long Tide (film)"], work(film)["found"])
    check("the film itself stays in the Library", pg.locator("#list-screen li", has_text="The Long Tide").count() == 1)
    check("no page errors", not errs, errs)
    br.close()
finish()

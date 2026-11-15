"""Looked-up answers in the app at phone size (390 px): "Did you mean ...?" in the Library (one tap, or keep hers),
"Who said this?" in Create naming the page it rests on, and "Check it" on a quote card marked to be checked.
Every person, line and work here is made up."""
from a8lib import *
from playwright.sync_api import sync_playwright
import where as _W, os

SHOTS = f"{_W.OUT}/shots/"
os.makedirs(SHOTS, exist_ok=True)
serve("WEBSEARCH=unset")
T = login()

def shown(pg, sel, timeout=8000):
    pg.wait_for_selector(sel, state="visible", timeout=timeout)
    return pg.locator(sel)
def open_add(pg, form):
    if not pg.is_visible(f"#{form}"): pg.locator(f"details:has(#{form}) > summary").click()

with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome")
    pg = br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True, is_mobile=True).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"{_W.URL}/"); pg.wait_for_selector("#passcode", timeout=8000)
    pg.fill("#passcode", "letmein"); pg.click("#passcode-go"); pg.wait_for_timeout(1500)

    # ---- the Library: a misspelt book
    pg.click("#nav-library"); pg.wait_for_timeout(500)
    open_add(pg, "add-book")
    pg.fill("#b-title", "Glas Rivers"); pg.click("#add-book button[type=submit]")
    pg.wait_for_function("() => !!document.querySelector('[id^=title-fix-]')", timeout=10000)
    fix = pg.locator("[id^=title-fix-]").first
    bid = fix.get_attribute("id").replace("title-fix-", "")
    check("a misspelt title gets one tap to fix it", fix.inner_text() == "Did you mean Glass Rivers (2014), by Ana Vale?", fix.inner_text())
    row = pg.locator("#list-books li", has=fix)
    check("her own spelling stays until she taps", row.locator(".main").inner_text() == "Glas Rivers" and pg.is_visible(f"#title-keep-{bid}"))
    row.scroll_into_view_if_needed(); pg.screenshot(path=SHOTS + "a10_01_did_you_mean.png")
    fix.click()
    pg.wait_for_function(f"() => !document.getElementById('title-fix-{bid}')", timeout=8000)
    row = pg.locator("#list-books li").filter(has_text="Glass Rivers").first
    check("tapped: the proper title, its author and year", row.locator(".main").inner_text() == "Glass Rivers" and row.locator(".sub").first.inner_text() == "Ana Vale · 2014",
          row.inner_text())
    pg.wait_for_timeout(800)
    lib = doc("library")
    check("and its text is looked for again under that title", next(b for b in lib["books"] if b["id"] == bid).get("textChecked"), next(b for b in lib["books"] if b["id"] == bid))
    pg.screenshot(path=SHOTS + "a10_02_fixed.png")

    # ---- a series added as a film; she keeps hers
    open_add(pg, "add-screen")
    pg.fill("#s-title", "Harbour Lights"); pg.select_option("#s-kind", "film"); pg.click("#add-screen button[type=submit]")
    pg.wait_for_function("() => [...document.querySelectorAll('#list-screen [id^=title-fix-]')].length > 0", timeout=10000)
    fix = pg.locator("#list-screen [id^=title-fix-]").first
    sid = fix.get_attribute("id").replace("title-fix-", "")
    check("the other kind is offered by name", fix.inner_text() == "Did you mean the series Harbour Lights (2020)?", fix.inner_text())
    pg.click(f"#title-keep-{sid}")
    pg.wait_for_function(f"() => !document.getElementById('title-offer-{sid}')", timeout=8000)
    row = pg.locator("#list-screen li").filter(has_text="Harbour Lights").first
    check("'Keep mine' keeps her title and kind, and the offer goes", row.locator(".sub").first.inner_text() == "Film" and not pg.is_visible(f"#title-fix-{sid}"), row.inner_text())
    open_add(pg, "add-screen")
    pg.fill("#s-title", "The Long Tide"); pg.select_option("#s-kind", "film"); pg.click("#add-screen button[type=submit]")
    pg.wait_for_function("() => [...document.querySelectorAll('#list-screen li')].some((li) => li.innerText.includes('Film · 2016'))", timeout=10000)
    check("a real film shows its year, with nothing to answer", pg.locator("#list-screen li").filter(has_text="The Long Tide").locator("[id^=title-fix-]").count() == 0)
    pg.screenshot(path=SHOTS + "a10_03_library.png")

    # ---- Create: who said this, looked up
    pg.click("#nav-create"); pg.wait_for_timeout(300)
    if pg.is_visible("#tab-text"): pg.click("#tab-text"); pg.wait_for_timeout(200)
    pg.evaluate("Studio.setQuote('Kindness is the only language the tide understands.', 'Edda Marlowe')"); pg.wait_for_timeout(200)
    pg.click("#check-open")
    pg.wait_for_function("() => document.getElementById('check-open').textContent === 'Who said this?' && !document.getElementById('check-result').hidden", timeout=15000)
    box = pg.locator("#check-result")
    links = box.locator("a.src.found")
    check("a misattribution is shown", "Probably not by Edda Marlowe" in box.inner_text(), box.inner_text())
    check("with the page it rests on, as a link", links.count() >= 1 and links.first.inner_text() == "Found on wikiquote.org"
          and links.first.get_attribute("href").startswith("https://en.wikiquote.org/wiki/Edda_Marlowe#Misattributed") and links.first.get_attribute("target") == "_blank", box.inner_html()[:300])
    check("and no word about memory", box.locator(".check-memory").count() == 0)
    check("the right name is one tap away", box.locator("button", has_text="Credit Pell Arden").count() == 1)
    box.scroll_into_view_if_needed(); pg.screenshot(path=SHOTS + "a10_04_check_web.png")
    pg.evaluate("Studio.setQuote('Every morning the kettle hums a different hymn.', 'Someone')"); pg.click("#check-open")
    pg.wait_for_function("() => document.getElementById('check-open').textContent === 'Who said this?' && !document.getElementById('check-result').hidden", timeout=15000)
    check("nothing found: the answer says it is from memory", box.locator(".check-memory").count() == 1 and box.locator("a.src.found").count() == 0, box.inner_text())
    pg.screenshot(path=SHOTS + "a10_05_check_memory.png")

    # ---- a card marked to be checked
    pg.click("#nav-today"); pg.wait_for_timeout(300)
    if not pg.locator("[id^=verify-]").count():
        btn = pg.locator("button", has_text="Get five quotes")
        if btn.count(): btn.first.click()
    pg.wait_for_function("() => !!document.querySelector('[id^=verify-]')", timeout=15000)
    card = pg.locator(".card", has=pg.locator("[id^=verify-]")).first
    vid = card.locator("[id^=verify-]").get_attribute("id").replace("verify-", "")
    check("a quote marked to be checked has a 'Check it' button", card.locator(".chip.bad").inner_text() == "Check the wording and author before posting" and pg.inner_text(f"#verify-{vid}") == "Check it")
    pg.click(f"#verify-{vid}")
    pg.wait_for_selector(f"#verified-{vid}", timeout=15000)
    check("tapped: the answer sits in the card", pg.locator(f"#verified-{vid} .chip").count() == 1 and pg.locator(f"#verify-{vid}").count() == 0, pg.inner_text(f"#verified-{vid}"))
    pg.locator(f"#verified-{vid}").scroll_into_view_if_needed(); pg.screenshot(path=SHOTS + "a10_06_card_checked.png")
    check("no script errors", not errs, errs)
    br.close()
finish()

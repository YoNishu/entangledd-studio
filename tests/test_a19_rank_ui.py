"""Agent 19: what she sees of Today's order, at 390 and 375 wide. Numerals 1 to 5 in the server's order, as the
card's strongest mark; number 1 marked as Nishiii's first choice; one quiet line on what each place rests on; words
for screen readers; "Five for today, best first."; a skip does not renumber what is on screen, the next load does;
a change in what she likes brings a new order on the next load; "Earlier this week" has no numbers; the Nishiii
section lists the same order with the same numbers; nothing wider than the screen.
Screenshots: <STUDIO_OUT>/shots/a19_*.png
Run: python3 tests/test_a19_rank_ui.py"""
import where as _W
import os, time
from playwright.sync_api import sync_playwright
from a4lib import *

S = f"{_W.OUT}/shots/"
os.makedirs(S, exist_ok=True)
TODAY = day_str(0)
DAY_MS = 24 * 3600 * 1000

def item(tag, text, theme, tone, author, title, **more):
    return {"id": f"id-{tag}", "state": "new", "text": text, "author": author, "theme": theme, "tone": tone,
            "source": {"type": "book", "title": title}, "verify": False, "why": "", "src": "memory", **more}
LONG = ("I have loved the stars too fondly to be fearful of the night, and I have walked the long shore of every year "
        "with my hands open, asking nothing of the tide but that it keep coming back, and it has, and it does, and "
        "I think that is what they mean when they say that the sea remembers everyone who ever waited for it.")
FIVE = [
    item("e", "Work is love made visible, and the hands remember what the heart forgets.", "work", "direct", "Kahlil Gibran", "The Prophet"),
    item("c", "Bide your time, and the slow hours will carry you home.", "time", "plain", "Rumi", "Masnavi"),
    item("a", LONG, "sea", "calm", "Sarah Williams", "The Old Astronomer"),
    item("d", "Bring the light home with you, and leave a little at every door.", "home", "tender", "Mary Oliver", "Upstream", wild=True),
    item("b", "Hope is the thing with feathers that perches in the soul.", "hope", "hopeful", "Emily Dickinson", "Poems"),
]
def post(n, theme, tone, author, saved, likes, days_ago=20):
    at = int(time.time() * 1000) - days_ago * DAY_MS
    return {"id": f"p{n}", "state": "published", "quote": f"Post {n} about {theme}", "theme": theme, "tone": tone, "author": author,
            "source": "book", "created": at, "published": at, "metrics": {"reach": 1000, "saved": saved, "shares": 0, "comments": 0, "likes": likes}}
POSTS = [post(1, "hope", "hopeful", "Emily Dickinson", 60, 200), post(2, "hope", "hopeful", "Emily Dickinson", 55, 180),
         post(3, "hope", "hopeful", "Emily Dickinson", 70, 210), post(4, "work", "direct", "Kahlil Gibran", 1, 10),
         post(5, "work", "direct", "Kahlil Gibran", 2, 12), post(6, "work", "direct", "Kahlil Gibran", 1, 9)]
SEA = {"profile": {"loves": ["lines about the sea"], "avoids": [], "voice": []}, "notes": [], "updatedAt": 1}

def plant():
    doc(f"suggestions/{TODAY}", FIVE); doc("posts", POSTS); doc("taste", SEA)
    yesterday = shift(TODAY, -1)
    doc(f"suggestions/{yesterday}", [{**FIVE[1], "id": "old-1"}, {**FIVE[4], "id": "old-2"}])

def open_app(p, width):
    b = p.chromium.launch(channel="chrome")
    ctx = b.new_context(viewport={"width": width, "height": 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(BASE + "/"); pg.wait_for_timeout(800)
    pg.fill("#passcode", "letmein"); pg.click("#passcode-go")
    pg.wait_for_selector("#suggestions .pick-num", timeout=20000); pg.wait_for_timeout(300)
    return b, pg, errs

def shown(pg):
    """The cards on Today, top to bottom: (numeral, card's quote id, what the place rests on)."""
    return pg.eval_on_selector_all("#suggestions > article.card", """cs => cs.map(c => ({
        n: (c.querySelector('.pick-num') || {}).textContent || '', id: ((c.querySelector('.pick-head') || {}).id || '').replace('rank-', ''),
        rests: (c.querySelector('.pick-rests') || {}).textContent || '', sr: (c.querySelector('.pick-head .vh') || {}).textContent || '',
        first: !!c.querySelector('.pick-first'), cls: c.className }))""")

def api_order(tok):
    return call("GET", "/api/suggestions", token=tok)[1]["items"]

with sync_playwright() as p:
    for width in (390, 375):
        print(f"A. {width} wide: the five in the server's order")
        serve(); tok = login(); plant()
        want = api_order(tok)
        b, pg, errs = open_app(p, width)
        cards = shown(pg)
        print("     shown:", [(c["n"], c["id"], c["rests"]) for c in cards])
        check("numerals 1 to 5, top to bottom", [c["n"] for c in cards] == ["1", "2", "3", "4", "5"], str([c["n"] for c in cards]))
        check("in the order the server ranks them", [c["id"] for c in cards] == [i["id"] for i in want], str([c["id"] for c in cards]))
        check("the sea line (what she told Nishiii) is number 1", cards and cards[0]["id"] == "id-a", str(cards[:1]))
        check("number 1 alone is marked Nishiii's first choice", cards[0]["first"] and "first" in cards[0]["cls"] and not any(c["first"] for c in cards[1:]))
        check("its words: Nishiii's first choice for today", pg.text_content("#suggestions .pick-first") == "Nishiii's first choice for today")
        check("each says in one line what its place rests on", all(c["rests"].startswith("Ranked by ") for c in cards), str([c["rests"] for c in cards]))
        check("screen readers hear 'First of five.' ... 'Fifth of five.'", [c["sr"] for c in cards] == ["First of five.", "Second of five.", "Third of five.", "Fourth of five.", "Fifth of five."], str([c["sr"] for c in cards]))
        check("the numeral itself is hidden from screen readers", pg.eval_on_selector_all("#suggestions .pick-num", "ns => ns.every(n => n.getAttribute('aria-hidden') === 'true')"))
        check("the note says it once: Five for today, best first.", pg.text_content("#today-note") == "Five for today, best first.", pg.text_content("#today-note"))
        big = pg.evaluate("""() => { const n = document.querySelector('#suggestions .card:nth-child(2) .pick-num'), q = document.querySelector('#suggestions .card:nth-child(2) .q');
            return [parseFloat(getComputedStyle(n).fontSize), parseFloat(getComputedStyle(q).fontSize), getComputedStyle(n).fontFamily] }""")
        check("the numeral is the card's largest mark, in the app's serif", big[0] >= 2 * big[1] and "Lora" in big[2], str(big))
        check("the wildcard keeps its 'Something different' tag and takes its place by score",
              pg.locator("#wild-id-d").count() == 1 and pg.text_content("#wild-id-d") == "Something different")
        wide = pg.evaluate("() => [document.documentElement.scrollWidth, ...[...document.querySelectorAll('#suggestions .card')].map(c => c.scrollWidth - c.clientWidth)]")
        check(f"nothing wider than the {width}-wide screen, the long quote included", wide[0] <= width and max(wide[1:]) <= 0, str(wide))
        pg.screenshot(path=S + f"a19_today_{width}.png")
        pg.locator("#suggestions .card").nth(1).scroll_into_view_if_needed(); pg.wait_for_timeout(200)
        pg.screenshot(path=S + f"a19_today_{width}_more.png")

        print(f"B. {width} wide: a skip leaves the numbers as they are; the next load renumbers")
        second = cards[1]["id"]
        pg.locator(f"#rank-{second}").locator("xpath=..").get_by_role("button", name="Skip").click(); pg.wait_for_timeout(600)
        after = shown(pg)
        check("after a skip of number 2: 1, 3, 4, 5 on screen", [c["n"] for c in after] == ["1", "3", "4", "5"], str([c["n"] for c in after]))
        check("and 'First of five.' still", after[0]["sr"] == "First of five.", after[0]["sr"])
        if width == 390:
            pg.click("#nav-nishiii"); pg.wait_for_selector("#scorer-today", timeout=15000); pg.wait_for_timeout(300)
            listed = pg.eval_on_selector_all("#scorer-today li", "ls => ls.map(l => [l.dataset.rank, l.dataset.id])")
            check("the Nishiii section lists the same order with the same numbers as Today", listed == [[c["n"], c["id"]] for c in after], str(listed))
            pg.locator("#scorer-slot").scroll_into_view_if_needed(); pg.wait_for_timeout(200)
            pg.screenshot(path=S + "a19_nishiii_order.png")
        pg.click("#nav-create"); pg.wait_for_timeout(300); pg.click("#nav-today"); pg.wait_for_timeout(1500)
        again = shown(pg)
        check("back on Today (a new load): 1 to 4", [c["n"] for c in again] == ["1", "2", "3", "4"] and second not in [c["id"] for c in again], str([(c["n"], c["id"]) for c in again]))
        check("'First of four.' now", again[0]["sr"] == "First of four.", again[0]["sr"])
        check("the note counts what is left", pg.text_content("#today-note") == "Four for today, best first.", pg.text_content("#today-note"))
        if width == 390:
            pg.click("#nav-nishiii"); pg.wait_for_selector("#scorer-today", timeout=15000); pg.wait_for_timeout(300)
            listed = pg.eval_on_selector_all("#scorer-today li", "ls => ls.map(l => [l.dataset.rank, l.dataset.id, l.dataset.score])")
            api = api_order(tok)
            check("and the Nishiii section follows: the same numbers and the same scores as the server's",
                  listed == [[str(i["rank"]), i["id"], str(i["score"])] for i in api], f"{listed} vs {[(i['rank'], i['id'], i['score']) for i in api]}")
            pg.click("#nav-today"); pg.wait_for_timeout(1200)

        print(f"C. {width} wide: what she likes changes, and the next load brings the new order")
        doc("taste", {**SEA, "notes": [{"text": "More about home please", "at": 2}]})
        before = shown(pg)
        check("nothing moves while she looks", [c["id"] for c in shown(pg)] == [c["id"] for c in before])
        pg.reload(); pg.wait_for_timeout(800)
        if pg.locator("#passcode").is_visible():
            pg.fill("#passcode", "letmein"); pg.click("#passcode-go")
        pg.wait_for_selector("#suggestions .pick-num", timeout=20000); pg.wait_for_timeout(500)
        fresh = shown(pg)
        print("     reloaded:", [(c["n"], c["id"], c["rests"]) for c in fresh])
        check("after a reload the home line (the wildcard) is number 1", fresh and fresh[0]["id"] == "id-d", str([c["id"] for c in fresh]))
        check("numbered 1 to 4 again", [c["n"] for c in fresh] == ["1", "2", "3", "4"], str([c["n"] for c in fresh]))
        check("the same order as the server's", [c["id"] for c in fresh] == [i["id"] for i in api_order(tok)])

        print(f"D. {width} wide: Earlier this week has no numbers")
        pg.wait_for_selector("#week:not([hidden])", timeout=10000)
        pg.locator("#week-days summary").first.click(); pg.wait_for_timeout(300)
        check("yesterday's cards are there", pg.locator("#week-days .card").count() == 2, str(pg.locator("#week-days .card").count()))
        check("with no numerals", pg.locator("#week .pick-num, #week .pick-head").count() == 0)
        pg.locator("#week").scroll_into_view_if_needed(); pg.wait_for_timeout(200)
        pg.screenshot(path=S + f"a19_week_{width}.png")
        check("no page errors", not errs, str(errs))
        b.close()

    print("E. reduced motion: nothing moves")
    serve(); tok = login(); plant()
    b = p.chromium.launch(channel="chrome")
    ctx = b.new_context(viewport={"width": 390, "height": 844}, reduced_motion="reduce", has_touch=True, is_mobile=True)
    pg = ctx.new_page(); pg.goto(BASE + "/"); pg.wait_for_timeout(800)
    pg.fill("#passcode", "letmein"); pg.click("#passcode-go"); pg.wait_for_selector("#suggestions .pick-num", timeout=20000)
    anim = pg.eval_on_selector_all("#suggestions .pick-head, #suggestions .pick-num", "ns => ns.map(n => getComputedStyle(n).animationName + '/' + getComputedStyle(n).transitionDuration)")
    check("no animation or transition on the numbers", all(a in ("none/0s",) for a in anim), str(set(anim)))
    b.close()

finish("Today's order as she sees it")

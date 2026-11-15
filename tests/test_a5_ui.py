"""Little notes from Nishiii: what she sees.
The note under the heading on Today (short, long, with a marker), that nothing moves when it
arrives, one note per visit, a new one after a long while away, and the small editor in Settings.
Screenshots go to $STUDIO_OUT/shots/. Only made-up notes. Starts its own fresh server.
Run: python3 tests/test_a5_ui.py"""
import datetime, json, re
from playwright.sync_api import sync_playwright
from a5lib import ok, finish, serve, raw, call, login, add, B, SHOTS

SHORT = 'We met at the bakery.'
MEDIUM = "You laughed at my terrible joke about the moon, and I knew I wanted to hear that laugh every day."
LONG = ("On our very first long walk by the lake you told me the names of all the birds, and I pretended to remember them, "
        "and later I looked each one up so that the next time I could surprise you; I still mix up two of them, and you "
        "still laugh every single time I do it, my love.")
LONG = (LONG + " " + "x" * 280)[:280].rstrip()
assert len(LONG) == 280, len(LONG)
GREETING = "Hi Dhruuu, what are we posting today? Nishiii"

WATCH = """
window.__bar = [];
document.addEventListener("studio:ready", () => {
  const bar = document.querySelector("header.bar"), head = document.querySelector(".dayhead"), hello = document.getElementById("hello");
  const t0 = performance.now();
  (function tick() {
    window.__bar.push({ t: Math.round(performance.now() - t0), bar: bar.getBoundingClientRect().height,
      head: head.getBoundingClientRect().top, hello: hello.innerText, wait: hello.classList.contains("lovenote-wait") });
    if (performance.now() - t0 < 2600) requestAnimationFrame(tick);
  })();
}, { once: true });
"""

def clear_notes(token):
    for n in call("GET", "/api/lovenotes", token=token)[1]["notes"]:
        call("DELETE", "/api/lovenotes/" + n["id"], token=token)

def only(token, *notes):
    clear_notes(token)
    for text, date in notes: add(token, text, date)

def sign_in(pg):
    pg.goto(B)
    pg.wait_for_selector("#lock:not([hidden])", timeout=20000)
    pg.fill("#passcode", "letmein"); pg.click("#passcode-go")
    pg.wait_for_selector("#view-today:not([hidden])", timeout=20000)

def reopen(pg):
    pg.reload()
    pg.wait_for_selector("#view-today:not([hidden])", timeout=20000)

def note_in(pg, timeout=15000):
    pg.wait_for_selector("#love-note", timeout=timeout)
    pg.wait_for_function("!document.getElementById('hello').classList.contains('lovenote-wait')")
    pg.wait_for_timeout(700)              # let the fade finish before looking or taking a picture

def hello(pg):
    return pg.evaluate("""() => { const h = document.getElementById('hello'), s = getComputedStyle(h), r = h.getBoundingClientRect();
      const sig = h.querySelector('.sig'), sr = sig ? sig.getBoundingClientRect() : null;
      return { text: h.innerText.replace(/\\s+/g, ' ').trim(), cls: h.className, font: s.fontFamily, size: parseFloat(s.fontSize),
        anim: s.animationName, minH: h.style.minHeight, h: r.height, w: r.width, scrollW: h.scrollWidth, clientW: h.clientWidth,
        pageW: document.documentElement.scrollWidth, sigRight: sr ? sr.right : 0, sigText: sig ? sig.textContent : '',
        note: (document.getElementById('love-note') || {}).textContent || '', mark: (document.getElementById('love-note-mark') || {}).textContent || '',
        fontLoaded: document.fonts.check('400 18px "Nothing You Could Do"'), kept: localStorage.getItem('studio.lovenote') }; }""")

def steady(pg, label):
    """From the moment the app is open to well after the note is in: the header and the day heading must not move."""
    pg.wait_for_function("window.__bar.length && window.__bar[window.__bar.length - 1].t > 2400", timeout=15000)
    log = [s for s in pg.evaluate("window.__bar") if s["head"] > 0]
    bars = [s["bar"] for s in log]; heads = [s["head"] for s in log]
    waited = [s for s in log if s["wait"]]
    ok(len(waited) >= 3 and all(s["hello"].strip() == "" for s in waited), f"{label}: while the note is on its way its space is kept, empty", len(waited))
    ok(any(not s["wait"] and s["hello"].strip() for s in log), f"{label}: then the note is there")
    ok(max(bars) - min(bars) < 0.5 and max(heads) - min(heads) < 0.5, f"{label}: nothing moves when it arrives",
       f"header {min(bars):.1f}..{max(bars):.1f}, day heading {min(heads):.1f}..{max(heads):.1f}")
    ok(not any("Hi Dhruuu" in s["hello"] for s in log), f"{label}: the ordinary greeting never flashes first")

def slow_next(pg, ms=700):
    def handler(route):
        pg.wait_for_timeout(ms); route.continue_()
    pg.route("**/api/lovenotes/next*", handler)

serve()
T = login()

with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome")

    for width in (390, 375):
        print(f"--- {width} px wide")
        ctx = browser.new_context(viewport={"width": width, "height": 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
        ctx.add_init_script(WATCH)
        pg = ctx.new_page()
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.on("console", lambda m: errors.append(m.text) if m.type == "error" and "401" not in m.text else None)

        # no notes: the greeting, exactly as before
        clear_notes(T)
        sign_in(pg); pg.wait_for_timeout(900)
        h = hello(pg)
        ok(h["text"] == GREETING and "lovenote" not in h["cls"] and h["minH"] == "" and h["kept"] is None, "no notes: the greeting is exactly as it was", h)
        plain_h = h["h"]

        # the first note ever
        only(T, (SHORT, None))
        reopen(pg); note_in(pg)
        h = hello(pg)
        ok(h["note"] == SHORT and h["sigText"] == "Nishiii" and h["mark"] == "", "a short note is on the line, signed Nishiii", h["text"])
        ok(h["font"].startswith('"Nothing You Could Do"') and h["fontLoaded"], "in the handwriting face, which has loaded", h["font"])
        ok("len-s" in h["cls"] and h["size"] == 20, "a short note is written larger", (h["cls"], h["size"]))
        kept = json.loads(h["kept"])
        ok(set(kept) == {"w", "h", "days"} and kept["w"] == width and isinstance(kept["h"], (int, float)) and kept["h"] > 0 and not re.search(r"[a-zA-Z]{3,}", json.dumps(kept).replace('"days"', "")),
           "the phone keeps only numbers for next time, never the words", kept)
        ok(abs(kept["h"] - h["h"]) < 0.5, "and that number is exactly how tall this note stands (it is the only note, so it comes next too)", (kept["h"], h["h"]))
        pg.screenshot(path=f"{SHOTS}a5_note_short_{width}.png", clip={"x": 0, "y": 0, "width": width, "height": 300})

        # the next opening: its space is already waiting
        slow_next(pg)
        reopen(pg); note_in(pg)
        steady(pg, "short note")
        ok(hello(pg)["anim"] == "lovenote-in", "it arrives with one gentle fade")

        # a medium and a long note
        only(T, (MEDIUM, None))
        reopen(pg); note_in(pg)
        h = hello(pg)
        ok(h["note"] == MEDIUM and "len-m" in h["cls"] and h["size"] == 18, "a medium note at the middle size", (h["cls"], h["size"]))
        pg.screenshot(path=f"{SHOTS}a5_note_medium_{width}.png", clip={"x": 0, "y": 0, "width": width, "height": 330})
        only(T, (LONG, None))
        reopen(pg); note_in(pg)             # (this opening still had the medium note's space; the next one has the long note's)
        reopen(pg); note_in(pg)
        steady(pg, "280-character note")
        h = hello(pg)
        ok(h["note"] == LONG and "len-xl" in h["cls"] and h["size"] == 15.5, "the longest note is written smaller", (h["cls"], h["size"]))
        ok(h["scrollW"] <= h["clientW"] + 1 and h["pageW"] <= width and h["sigRight"] <= width - 10, "it wraps cleanly: nothing runs off the side, the signature included", (h["scrollW"], h["clientW"], h["pageW"], h["sigRight"]))
        bar = pg.evaluate("document.querySelector('header.bar').getBoundingClientRect().height")
        ok(bar < 300, f"even the longest note leaves most of the screen to Today (header {bar:.0f} px of 844)")
        pg.screenshot(path=f"{SHOTS}a5_note_long_{width}.png", clip={"x": 0, "y": 0, "width": width, "height": 420})

        # a note's own day
        today = pg.evaluate("(() => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); })()")
        last_year = str(int(today[:4]) - 1) + today[4:]
        if today[5:] == "02-29": last_year = str(int(today[:4]) - 4) + today[4:]
        only(T, (MEDIUM, last_year), (SHORT, None))
        reopen(pg); note_in(pg)
        h = hello(pg)
        years = int(today[:4]) - int(last_year[:4])
        ok(h["note"] == MEDIUM and h["mark"] == ("1 year ago today" if years == 1 else f"{years} years ago today"), "on a note's own day it is the one shown, with its marker", (h["note"][:30], h["mark"]))
        ok(json.loads(h["kept"])["days"].get(today, 0) > 0, "and the phone knows how much space a later opening today will need", h["kept"])
        pg.screenshot(path=f"{SHOTS}a5_note_marker_{width}.png", clip={"x": 0, "y": 0, "width": width, "height": 330})
        reopen(pg); note_in(pg)
        steady(pg, "note with a marker")

        ok(errors == [], "no errors in the page", errors[:3])
        pg.unroute("**/api/lovenotes/next*")
        ctx.close()

    # ---------------- one note per visit; a new one after a long while away ----------------
    print("--- one note per visit")
    only(T, ("first of three", None), ("second of three", None), ("third of three", None))
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
    pg = ctx.new_page()
    asked = []
    pg.on("request", lambda r: asked.append(r.url) if "/api/lovenotes" in r.url else None)
    sign_in(pg); note_in(pg)
    first = hello(pg)["note"]
    pg.click("#nav-create"); pg.wait_for_timeout(200)
    ok(pg.evaluate("document.getElementById('hello').hidden"), "the line shows only on Today")
    pg.click("#nav-today"); pg.wait_for_timeout(300)
    pg.evaluate("document.dispatchEvent(new CustomEvent('studio:ready'))")      # what an unlock after a short lock looks like
    pg.wait_for_timeout(500)
    AWAY = """(minutes) => { const real = Date.now.bind(Date); let hidden = true;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      document.dispatchEvent(new Event('visibilitychange'));
      const jump = minutes * 60 * 1000; Date.now = () => real() + jump;
      hidden = false; document.dispatchEvent(new Event('visibilitychange')); }"""
    pg.evaluate(AWAY, 4)
    pg.wait_for_timeout(600)
    ok(hello(pg)["note"] == first and len([u for u in asked if "/next" in u]) == 1,
       "moving between sections, unlocking again, or four minutes away: the same note, and the server is asked only once", (hello(pg)["note"], len(asked)))
    expected_next = pg.evaluate("(async () => 0)()")   # placeholder so the next line reads clearly
    then = call("GET", "/__doc?name=lovenotes")[1]
    lined_up = [n["text"] for n in then["notes"] if n["id"] == then["upNext"]][0]
    bar_before = pg.evaluate("document.querySelector('header.bar').getBoundingClientRect().height")
    pg.evaluate(AWAY, 31)
    pg.wait_for_function(f"(document.getElementById('love-note') || {{}}).textContent === {json.dumps(lined_up)}", timeout=10000)
    pg.wait_for_timeout(600)
    h = hello(pg)
    ok(h["note"] == lined_up and h["note"] != first and len([u for u in asked if "/next" in u]) == 2, "back after 31 minutes: that counts as opening the app again, so the next note is there", h["note"])
    ok(abs(pg.evaluate("document.querySelector('header.bar').getBoundingClientRect().height") - bar_before) < 0.5, "(same length, so the header is as tall as before)")
    ok(not [u for u in asked if u.rstrip("/").endswith("/api/lovenotes")], "the full list of notes was never fetched just by using the app", asked)
    ctx.close()

    # ---------------- arriving while another section is showing; a failed fetch; notes all removed ----------------
    print("--- edge cases")
    only(T, (MEDIUM, None))
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
    pg = ctx.new_page()
    sign_in(pg); note_in(pg)
    slow_next(pg, 900)
    pg.reload(); pg.wait_for_selector("#view-today:not([hidden])")
    pg.click("#nav-create")
    pg.wait_for_timeout(1700)
    ok(pg.evaluate("document.getElementById('hello').hidden"), "(she moved to Create before the note arrived)")
    pg.click("#nav-today"); pg.wait_for_timeout(100)
    h = hello(pg)
    ok(h["note"] == MEDIUM and "lovenote-wait" not in h["cls"] and h["h"] > 40, "the note is waiting for her when she comes back to Today", h["cls"])
    pg.unroute("**/api/lovenotes/next*")

    pg.route("**/api/lovenotes/next*", lambda route: route.fulfill(status=500, content_type="application/json", body='{"error":"x"}'))
    pg.reload(); pg.wait_for_selector("#view-today:not([hidden])"); pg.wait_for_timeout(1200)
    h = hello(pg)
    ok(h["text"] == GREETING and h["minH"] == "" and "lovenote" not in h["cls"], "if the note can't be fetched, the ordinary greeting is shown (no blank, no error)", h["text"])
    pg.unroute("**/api/lovenotes/next*")
    pg.evaluate("document.dispatchEvent(new CustomEvent('studio:ready'))"); note_in(pg)
    ok(hello(pg)["note"] == MEDIUM, "and it is tried again at the next unlock")

    clear_notes(T)
    pg.reload(); pg.wait_for_selector("#view-today:not([hidden])"); pg.wait_for_timeout(1200)
    h = hello(pg)
    ok(h["text"] == GREETING and h["minH"] == "" and h["kept"] is None, "when every note has been removed, the greeting is back and the kept space is forgotten", h)
    ctx.close()

    # ---------------- reduced motion ----------------
    only(T, (MEDIUM, None))
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, reduced_motion="reduce")
    pg = ctx.new_page()
    sign_in(pg); pg.wait_for_selector("#love-note"); pg.wait_for_timeout(300)
    ok(hello(pg)["anim"] == "none", "with reduced motion asked for, there is no fade")
    ctx.close()

    # ---------------- the editor in Settings ----------------
    for width in (390, 375):
        print(f"--- the editor in Settings, {width} px")
        clear_notes(T)
        ctx = browser.new_context(viewport={"width": width, "height": 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
        pg = ctx.new_page()
        asked = []
        pg.on("request", lambda r: asked.append(r.method + " " + r.url.split("/api/")[1]) if "/api/lovenotes" in r.url else None)
        sign_in(pg); pg.wait_for_timeout(600)
        pg.click("#settings-open"); pg.wait_for_selector("#lovenotes-edit")
        ok(not pg.evaluate("document.getElementById('lovenotes-edit').open") and pg.inner_text("#lovenotes-summary").startswith("Little notes from Nishiii"),
           "in Settings the notes sit behind one quiet line, closed")
        ok(not [a for a in asked if a == "GET lovenotes"], "and are not even fetched until someone opens it", asked)
        pg.click("#lovenotes-summary"); pg.wait_for_selector("#lovenotes-none:not([hidden])")
        ok("No notes yet" in pg.inner_text("#lovenotes-none"), "empty: it says so and offers to add the first")
        pg.fill("#lovenotes-text", "A note added from Settings."); pg.fill("#lovenotes-date", "2021-12-25")
        pg.click("#lovenotes-save"); pg.wait_for_selector("#lovenotes-list li")
        row = pg.inner_text("#lovenotes-list li")
        ok("A note added from Settings." in row and "2021" in row and "December" in row and pg.inner_text("#lovenotes-status") == "Added.", "a note with a date can be added", row)
        ok(pg.input_value("#lovenotes-text") == "" and pg.input_value("#lovenotes-date") == "", "the form is cleared for the next one")
        pg.click("#settings-close"); pg.wait_for_selector("#love-note")
        ok(hello(pg)["note"] == "A note added from Settings.", "the very first note shows on Today straight away, without reopening the app")

        pg.click("#settings-open"); pg.wait_for_timeout(200)
        ok(not pg.evaluate("document.getElementById('lovenotes-edit').open") and pg.locator("#lovenotes-list li").count() == 0, "opening Settings again finds the notes folded away")
        pg.click("#lovenotes-summary"); pg.wait_for_selector("#lovenotes-list li")
        pg.click("#lovenotes-list li button:has-text('Edit')")
        ok(pg.input_value("#lovenotes-text") == "A note added from Settings." and pg.input_value("#lovenotes-date") == "2021-12-25" and pg.inner_text("#lovenotes-save") == "Save note" and pg.is_visible("#lovenotes-cancel"),
           "Edit puts the note in the form")
        pg.fill("#lovenotes-text", "A note changed in Settings."); pg.fill("#lovenotes-date", "")
        pg.click("#lovenotes-save"); pg.wait_for_function("document.getElementById('lovenotes-status').textContent === 'Saved.'")
        row = pg.inner_text("#lovenotes-list li")
        ok("A note changed in Settings." in row and "2021" not in row, "the change is saved and its date taken off", row)
        ok(hello(pg)["note"] == "A note changed in Settings.", "and the note on Today is corrected too")
        pg.fill("#lovenotes-text", "A note changed in Settings."); pg.click("#lovenotes-save")
        pg.wait_for_function("document.getElementById('lovenotes-status').className === 'oops'")
        ok("already there" in pg.inner_text("#lovenotes-status"), "the same words twice: a plain message, nothing added", pg.inner_text("#lovenotes-status"))
        pg.fill("#lovenotes-text", SHORT); pg.click("#lovenotes-save")
        pg.wait_for_function("document.querySelectorAll('#lovenotes-list li').length === 2")
        pg.fill("#lovenotes-text", LONG); pg.fill("#lovenotes-date", "2020-03-03"); pg.click("#lovenotes-save")
        pg.wait_for_function("document.querySelectorAll('#lovenotes-list li').length === 3")
        pg.evaluate("document.getElementById('lovenotes-edit').scrollIntoView({ block: 'start' })"); pg.wait_for_timeout(200)
        over = pg.evaluate("(() => { const b = document.querySelector('#settings .sheet-body'); return b.scrollWidth - b.clientWidth; })()")
        ok(over <= 0, "the open editor fits the sheet with nothing running off the side", over)
        pg.screenshot(path=f"{SHOTS}a5_editor_{width}.png")
        pg.click("#lovenotes-list li:nth-child(2) button:has-text('Remove')"); pg.wait_for_selector("#confirm:not([hidden])")
        ok(pg.inner_text("#confirm-title") == "Remove this note?" and pg.inner_text("#confirm-body") == SHORT and pg.inner_text("#confirm-yes") == "Remove", "Remove asks first, showing the note")
        pg.click("#confirm-no"); pg.wait_for_timeout(200)
        ok(pg.locator("#lovenotes-list li").count() == 3, "Cancel keeps it")
        pg.click("#lovenotes-list li:nth-child(2) button:has-text('Remove')"); pg.wait_for_selector("#confirm:not([hidden])")
        pg.click("#confirm-yes"); pg.wait_for_function("document.querySelectorAll('#lovenotes-list li').length === 2")
        ok(SHORT not in pg.inner_text("#lovenotes-list") and pg.inner_text("#lovenotes-status") == "Removed.", "and Remove removes it")
        stored = [n["text"] for n in call("GET", "/api/lovenotes", token=T)[1]["notes"]]
        ok(stored == ["A note changed in Settings.", LONG], "the server holds exactly what the editor shows", stored)
        ctx.close()

    browser.close()

finish("test_a5_ui")

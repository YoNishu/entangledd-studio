"""Little notes from Nishiii: two things on screen the main interface test does not reach.
1. What the editor says about a sealed delivery: that notes arrived, or in plain words that one
   could not be opened.
2. A note is always shown as plain words: text that looks like markup or code is never run.
Only made-up notes. Starts its own fresh server. Screenshots go to $STUDIO_OUT/shots/.
Run: python3 tests/test_a5_ui_more.py"""
import where as _W
import json, subprocess
from playwright.sync_api import sync_playwright
from a5lib import ok, finish, serve, raw, call, login, add, B, SHOTS

NOTES = {"v": 1, "mode": "add", "notes": [
    {"text": "We met at the bakery on 3 March 2020.", "date": "2020-03-03"},
    {"text": "You still owe me a rematch at carrom."},
    {"text": "The yellow scooter was the best idea we ever had."}]}
SLY = '<img src=x onerror="window.__ran=1"><b>bold</b> & "quoted" <script>window.__ran=2</script>'

def seal_raw(key, plain):
    out = subprocess.run(["node", f"{_W.HERE}/seal_raw.mjs", key, plain], capture_output=True, text=True)
    assert out.returncode == 0, out.stderr
    return out.stdout.strip()

def deploy(*boxes):
    status, _ = raw("PUT", "/__notes_sealed", list(boxes))
    assert status == 204, status

def sign_in(pg):
    pg.goto(B)
    pg.wait_for_selector("#lock:not([hidden])", timeout=20000)
    pg.fill("#passcode", "letmein"); pg.click("#passcode-go")
    pg.wait_for_selector("#view-today:not([hidden])", timeout=20000)

def open_editor(pg):
    pg.click("#settings-open"); pg.wait_for_selector("#lovenotes-edit")
    pg.click("#lovenotes-summary"); pg.wait_for_selector("#lovenotes-list li")
    pg.wait_for_timeout(200)

serve()
T = login()
K = call("GET", "/api/seal-key")[1]
good = seal_raw(K["key"], json.dumps(NOTES))
i = len(good) // 2
tampered = good[:i] + ("A" if good[i] != "A" else "B") + good[i + 1:]

with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome")
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" and "401" not in m.text else None)

    # ---------------- a delivery that arrived ----------------
    print("--- what the editor says about deliveries")
    deploy(good)
    sign_in(pg); pg.wait_for_selector("#love-note", timeout=15000)
    shown = pg.inner_text("#love-note")
    ok(shown in [n["text"] for n in NOTES["notes"]], "the first opening after a delivery already shows one of its notes on Today", shown)
    open_editor(pg)
    line = pg.inner_text("#lovenotes-delivery")
    ok(pg.is_visible("#lovenotes-delivery") and line.startswith("3 notes from Nishiii arrived on ") and line.endswith("."), "the editor says the notes arrived, and when", line)
    ok(pg.locator("#lovenotes-list li").count() == 3, "and lists the three of them")
    pg.evaluate("document.getElementById('lovenotes-edit').scrollIntoView({ block: 'start' })"); pg.wait_for_timeout(200)
    pg.screenshot(path=f"{SHOTS}a5_editor_delivery_390.png")
    pg.click("#settings-close")

    # ---------------- one that could not be opened ----------------
    deploy(good, tampered)
    open_editor(pg)
    line = pg.inner_text("#lovenotes-delivery")
    ok("couldn't be opened" in line and "sealed for a different key" in line, "a delivery that can't be opened is reported in plain words", line)
    ok(not any(w in line.lower() for w in ["hash", "aes", "gcm", "decrypt", "exception", "error:"]), "(no technical words in it)", line)
    ok(pg.locator("#lovenotes-list li").count() == 3, "and the notes already there are untouched")
    over = pg.evaluate("(() => { const b = document.querySelector('#settings .sheet-body'); return b.scrollWidth - b.clientWidth; })()")
    ok(over <= 0, "the longer line still fits the sheet", over)
    # The parts of the open editor stand apart from each other (they once ran together: a grid gap
    # does not reach inside an opened <details>).
    gaps = pg.evaluate("""(() => {
      const box = (id) => document.getElementById(id).getBoundingClientRect();
      return { lines: box('lovenotes-delivery').top - box('lovenotes-status').bottom,
               list: box('lovenotes-list').top - box('lovenotes-delivery').bottom,
               form: box('lovenotes-form').top - box('lovenotes-list').bottom }; })()""")
    ok(all(8 <= g <= 16 for g in gaps.values()), "the status lines, the list and the form each stand a little apart", gaps)
    pg.evaluate("document.getElementById('lovenotes-edit').scrollIntoView({ block: 'start' })"); pg.wait_for_timeout(200)
    pg.screenshot(path=f"{SHOTS}a5_editor_delivery_failed_390.png")
    pg.click("#settings-close")

    # ---------------- a note is only ever words ----------------
    print("--- a note is shown as plain words")
    for n in call("GET", "/api/lovenotes", token=T)[1]["notes"]:
        call("DELETE", "/api/lovenotes/" + n["id"], token=T)
    add(T, SLY)
    pg.reload(); pg.wait_for_selector("#view-today:not([hidden])", timeout=20000)
    pg.wait_for_selector("#love-note", timeout=15000); pg.wait_for_timeout(700)
    ok(pg.evaluate("document.getElementById('love-note').textContent") == SLY, "on Today the note reads exactly as it was written")
    ok(pg.evaluate("document.querySelectorAll('#hello img, #hello b, #hello script').length") == 0, "nothing in it became a picture, bold text or code")
    open_editor(pg)
    ok(pg.evaluate("document.querySelector('#lovenotes-list li .main').textContent") == SLY, "the editor lists it as plain words too")
    pg.click("#lovenotes-list li button:has-text('Edit')")
    ok(pg.input_value("#lovenotes-text") == SLY, "Edit puts the same words in the form")
    pg.click("#lovenotes-list li button:has-text('Remove')"); pg.wait_for_selector("#confirm:not([hidden])")
    ok(pg.evaluate("document.getElementById('confirm-body').textContent") == SLY, "and so does the question before removing it")
    ok(pg.evaluate("document.querySelectorAll('#settings-lovenotes img, #settings-lovenotes script, #confirm img, #confirm script').length") == 0, "no picture or code was made anywhere")
    pg.click("#confirm-no"); pg.wait_for_timeout(300)
    ok(pg.evaluate("window.__ran === undefined"), "and nothing from the note ever ran")
    ok(errors == [], "no errors in the page", errors[:3])
    ctx.close(); browser.close()

finish("test_a5_ui_more")

"""The chat with Nishiii lives in the Nishiii tab: no Chat button beside Settings, Chat is the tab's first part, the
message box stays in view above the section bar and above the keyboard, the conversation is kept, and with chat
switched off the tab says so plainly and opens on What Nishiii knows. Phone sizes 390x844 and 375x667, by touch."""
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import where as _W
import json, subprocess
from playwright.sync_api import sync_playwright
SHOTS = os.environ.get("A20_SHOTS") or os.path.join(_W.OUT, "shots")
os.makedirs(SHOTS, exist_ok=True)
fails = []
def check(n, ok, d=""):
    print(("  ok   " if ok else "  FAIL ") + n + ("" if ok else f"  [{d}]")); ok or fails.append(n)

def fresh():   # every phone size starts from empty storage
    subprocess.run(["bash", os.path.join(_W.HERE, "serve")], capture_output=True, check=True)

BOX = """() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect();
  return { top: b.top, bottom: b.bottom, h: b.height, shown: !!e.offsetParent || getComputedStyle(e).position === 'fixed' }; };
  const sc = document.getElementById('chat-scroll'), last = document.querySelector('#chat-log > :last-child');
  return { form: r('#chat-form'), input: r('#chat-input'), bar: r('.views'), head: r('header.bar'), parts: r('#nishiii-parts'),
    scroll: r('#chat-scroll'), last: last ? (() => { const b = last.getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; })() : null,
    atEnd: sc ? sc.scrollHeight - sc.clientHeight - sc.scrollTop < 3 : false, vh: window.visualViewport ? window.visualViewport.height : innerHeight,
    y: window.scrollY, part: document.getElementById('view-nishiii').dataset.part }; }"""

def in_view(b, name, keyboard=False):
    """The box is on screen, under the header, above the section bar (or, with the keyboard, above the keyboard)."""
    check(f"{name}: the message box is on screen", b["form"] and b["form"]["shown"] and b["form"]["top"] >= 0 and b["form"]["bottom"] <= b["vh"] + 0.5, b["form"])
    check(f"{name}: the page itself is not pushed up", b["y"] == 0 and b["head"]["top"] >= 0, (b["y"], b["head"]))
    check(f"{name}: the parts switch is in view, under the header", b["parts"]["top"] >= b["head"]["bottom"] - 0.5 and b["parts"]["bottom"] <= b["form"]["top"], (b["parts"], b["head"]))
    if not keyboard:
        check(f"{name}: the box sits just above the section bar", b["bar"]["shown"] and 0 <= b["bar"]["top"] - b["form"]["bottom"] < 2 and abs(b["bar"]["bottom"] - b["vh"]) < 1, (b["form"], b["bar"], b["vh"]))
    if b["last"]:
        check(f"{name}: the newest message is in view, above the box", b["last"]["bottom"] <= b["form"]["top"] + 0.5 and b["last"]["bottom"] > b["scroll"]["top"], (b["last"], b["form"]))

def sign_in(pg):
    pg.goto(_W.URL + "/"); pg.wait_for_timeout(900)
    if pg.locator("#passcode").is_visible():
        pg.fill("#passcode", "letmein"); pg.click("#passcode-go")
    pg.wait_for_timeout(1500)

def say(pg, text, enter=False):
    n = pg.locator("#chat-log p").count()
    pg.fill("#chat-input", text)
    if enter: pg.press("#chat-input", "Enter")
    else: pg.tap("#chat-send")
    pg.wait_for_function(f"document.querySelectorAll('#chat-log p').length >= {n + 2} && !document.getElementById('chat-send').disabled", timeout=8000)
    pg.wait_for_timeout(150)

with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome")
    for W, H in ((390, 844), (375, 667)):
        fresh()
        tag = f"{W}x{H}"
        ctx = br.new_context(viewport={"width": W, "height": H}, screen={"width": W, "height": H}, device_scale_factor=2, has_touch=True, is_mobile=True)
        ctx.add_init_script("Object.defineProperty(navigator, 'standalone', { get: () => true })")   # opened from the Home Screen
        pg = ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        sign_in(pg)
        # the header: Settings alone
        head = pg.evaluate("[...document.querySelectorAll('.top-actions button')].filter((b) => !b.hidden).map((b) => b.id)")
        check(f"{tag}: the header has no Chat button, only Settings", head == ["settings-open"] and not pg.locator("#chat-open").count(), head)
        check(f"{tag}: the old chat sheet and the Nishiii tab's chat button are gone", not pg.locator("#chat").count() and not pg.locator("#nishiii-chat").count())
        # Nishiii opens on Chat
        pg.tap("#nav-nishiii"); pg.wait_for_timeout(700)
        b = pg.evaluate(BOX)
        check(f"{tag}: Nishiii opens on Chat", b["part"] == "chat" and pg.get_attribute("#nishiii-part-chat", "aria-pressed") == "true", b["part"])
        check(f"{tag}: the intro and the starter chips show while the chat is empty", pg.locator("#chat-intro").is_visible() and pg.locator("#chat-chips").is_visible() and not pg.locator("#chat-new").is_visible())
        check(f"{tag}: taste and notes are not shown in Chat", not pg.locator("#taste-note").is_visible() and not pg.locator("#add-note").is_visible())
        in_view(b, f"{tag} empty chat")
        pg.screenshot(path=f"{SHOTS}/a20_{tag}_1_empty.png")
        # a message: it appears, the log scrolls to it, the box stays put
        say(pg, "hello")
        mine = pg.locator("#chat-log p.me").last.inner_text(); hers = pg.locator("#chat-log p.her").last.inner_text()
        check(f"{tag}: the message and Nishiii's answer appear", mine == "hello" and "I can fetch quotes" in hers, (mine, hers))
        check(f"{tag}: the chips go once she has written; Start a new chat is offered; the intro stays", not pg.locator("#chat-chips").is_visible() and pg.locator("#chat-new").is_visible() and pg.locator("#chat-intro").is_visible())
        for t in ("find quotes from Interstellar", "how did my posts do?", "what's on today?", "hello again"):
            say(pg, t)
        b = pg.evaluate(BOX)
        check(f"{tag}: a long chat scrolls inside, to the newest", b["atEnd"] and pg.evaluate("document.getElementById('chat-scroll').scrollHeight > document.getElementById('chat-scroll').clientHeight"), b)
        in_view(b, f"{tag} long chat")
        pg.screenshot(path=f"{SHOTS}/a20_{tag}_2_chat.png")
        # the keyboard, emulated as in test_keyboard_band.py: first the short drawing area, then a real keyboard's height
        pg.locator("#chat-input").focus(); pg.wait_for_timeout(100)
        for short, what in ((H - 59, "band"), (H - 336 if H > 700 else H - 260, "keyboard")):
            pg.set_viewport_size({"width": W, "height": short}); pg.wait_for_timeout(350)
            b = pg.evaluate(BOX)
            in_view(b, f"{tag} {what} open", keyboard=True)
            check(f"{tag} {what} open: the box sits at the bottom of what is left", abs(b["form"]["bottom"] - short) < 1.5, (b["form"], short))
        say(pg, "hello while typing", enter=True)
        b = pg.evaluate(BOX)
        check(f"{tag} keyboard open: the box keeps the focus", pg.evaluate("document.activeElement.id") == "chat-input")
        in_view(b, f"{tag} keyboard open, after sending", keyboard=True)
        pg.screenshot(path=f"{SHOTS}/a20_{tag}_3_keyboard.png")
        # the keyboard goes: the full app again, the section bar at the bottom
        pg.set_viewport_size({"width": W, "height": H}); pg.locator("#chat-input").blur(); pg.wait_for_timeout(900)
        b = pg.evaluate(BOX)
        check(f"{tag}: after the keyboard, the app is its full height again", not pg.evaluate("document.documentElement.classList.contains('chat-kb')") and pg.evaluate("document.body.getBoundingClientRect().height") == H)
        in_view(b, f"{tag} keyboard closed")
        # What Nishiii knows
        n_before = pg.locator("#chat-log > *").count()
        pg.tap("#nishiii-part-knows"); pg.wait_for_timeout(400)
        check(f"{tag}: What Nishiii knows shows her taste and the notes", pg.locator("#taste-refresh").is_visible() and pg.locator("#add-note").is_visible() and pg.locator("#forget-profile").count() == 1)
        check(f"{tag}: and not the chat", not pg.locator("#chat-form").is_visible() and not pg.locator("#chat-log").is_visible())
        pg.screenshot(path=f"{SHOTS}/a20_{tag}_4_knows.png")
        pg.tap("#nishiii-part-chat"); pg.wait_for_timeout(300)
        check(f"{tag}: back on Chat, the conversation is there, at the newest", pg.locator("#chat-log > *").count() == n_before and pg.evaluate(BOX)["atEnd"])
        # Nishiii puts a quote in Create; Open Create goes there; coming back keeps the conversation
        say(pg, "use the first one")
        check(f"{tag}: Nishiii offers Open Create", pg.locator("#chat-log .act").last.is_visible())
        n_before = pg.locator("#chat-log > *").count()
        pg.locator("#chat-log .act").last.tap(); pg.wait_for_timeout(500)
        check(f"{tag}: Open Create goes to Create", pg.evaluate("!document.getElementById('view-create').hidden"))
        pg.tap("#nav-nishiii"); pg.wait_for_timeout(500)
        b = pg.evaluate(BOX)
        check(f"{tag}: coming back to Nishiii shows the same conversation, at the newest", b["part"] == "chat" and pg.locator("#chat-log > *").count() == n_before and b["atEnd"], (b["part"], b["atEnd"]))
        # Nishiii opens a section herself (the answer is a stand-in)
        pg.route("**/api/chat", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"reply": "Here is your Library.", "actions": [{"type": "open", "section": "library"}]})))
        pg.locator("#chat-input").focus(); pg.wait_for_timeout(100)
        say(pg, "open my library")
        pg.unroute("**/api/chat")
        check(f"{tag}: when Nishiii opens a section the app goes there, and the keyboard goes away", pg.evaluate("!document.getElementById('view-library').hidden") and pg.evaluate("document.activeElement.id") != "chat-input"
              and not pg.evaluate("document.documentElement.classList.contains('chat-kb')"))
        pg.tap("#nav-nishiii"); pg.wait_for_timeout(400)
        check(f"{tag}: and her answer is there on coming back", pg.locator("#chat-log p.her").last.inner_text() == "Here is your Library.")
        # kept across a restart, on this phone only, until she starts a new chat
        kept = pg.evaluate("JSON.parse(localStorage.getItem('studio.chat.v1') || '[]')")
        check(f"{tag}: the conversation is kept on the phone, without the 'Thinking' lines", len(kept) >= 10 and all(m["content"] != "Thinking…" for m in kept) and kept[-1]["content"] == "Here is your Library.", len(kept))
        pg.close(); pg = ctx.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
        sign_in(pg); pg.tap("#nav-nishiii"); pg.wait_for_timeout(600)
        texts = pg.eval_on_selector_all("#chat-log p", "ps => ps.map((p) => p.textContent)")
        check(f"{tag}: after closing and opening the app, the last conversation is back", texts == [m["content"] for m in kept] and pg.evaluate(BOX)["atEnd"], (len(texts), len(kept)))
        in_view(pg.evaluate(BOX), f"{tag} after a restart")
        pg.tap("#chat-new"); pg.wait_for_timeout(300)
        check(f"{tag}: Start a new chat empties it, here and on the phone", not pg.locator("#chat-log > *").count() and pg.locator("#chat-chips").is_visible()
              and pg.evaluate("localStorage.getItem('studio.chat.v1')") is None and not pg.locator("#chat-new").is_visible())
        check(f"{tag}: no page errors", not errs, errs)
        ctx.close()

    # chat switched off: the tab opens on What Nishiii knows, and Chat says so plainly
    fresh()
    ctx = br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
    def no_ai(route):
        r = route.fetch(); body = r.text()
        try:
            d = json.loads(body)
            if isinstance(d, dict):
                for k in (d, d.get("status") if isinstance(d.get("status"), dict) else None):
                    if k and "ai" in k: k["ai"] = False
                body = json.dumps(d)
        except ValueError: pass
        route.fulfill(response=r, body=body)
    ctx.route("**/api/**", no_ai)
    pg = ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    sign_in(pg)
    check("chat off: the app knows", pg.evaluate("window.Studio.server.ai") is False)
    pg.tap("#nav-nishiii"); pg.wait_for_timeout(600)
    check("chat off: Nishiii opens on What Nishiii knows", pg.evaluate("document.getElementById('view-nishiii').dataset.part") == "knows" and pg.locator("#add-note").is_visible())
    pg.tap("#nishiii-part-chat"); pg.wait_for_timeout(300)
    check("chat off: Chat says so plainly, with no box and no chips", pg.locator("#chat-off").is_visible() and "isn't switched on" in pg.inner_text("#chat-off")
          and not pg.locator("#chat-form").is_visible() and not pg.locator("#chat-chips").is_visible() and not pg.locator("#chat-intro").is_visible())
    pg.screenshot(path=f"{SHOTS}/a20_chat_off.png")
    check("chat off: no page errors", not errs, errs)
    br.close()
print("FAIL" if fails else "PASS"); sys.exit(1 if fails else 0)

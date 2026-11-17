"""Her case of 17 Nov 2026, on her iPhone. She went to Drafts and carried on with a reel: it kept saying it was
bringing back the background and music and never did; she could only change the words; choosing a background
and music again did not stay; the reel came out without them. Then "Use this" on a quote in Today got tangled
with that draft.

What was wrong: the words waited for the files, and the files could wait for ever (an iPhone does not say
"loadeddata" for a video it was not just asked for by a tap; a large video over a phone connection came in one
piece or not at all). While it waited the composer saved nothing, and whatever arrived late landed on what she
had begun meanwhile.

Now: her words are back at once; the files come piece by piece (a dropped piece is asked for again) with how far
they are; one she chooses herself meanwhile stays; nothing arrives in a new piece of work; a draft never loses
its files by being opened; a reel is not made while they are still coming.
Run:  python3 tests/test_draft_back.py"""
import where as _W
from a3lib import *
from playwright.sync_api import sync_playwright

# An iPhone, as far as this goes: a video she has just chosen by a tap says "loadeddata"; one that the app opens by
# itself (a draft's, fetched a while after her tap) says only "loadedmetadata". noTap is set once she has chosen hers.
IPHONE = """(() => { const add = HTMLMediaElement.prototype.addEventListener;
  HTMLMediaElement.prototype.addEventListener = function (type, ...rest) {
    const quiet = window.__mute || (sessionStorage.getItem('noTap') ? ['loadeddata', 'canplay'] : []);
    if (this.tagName === 'VIDEO' && this.id !== 'result' && quiet.includes(type)) return;
    return add.call(this, type, ...rest); }; })();"""
def until(fn, ms=20000):
    for _ in range(ms // 200):
        v = fn()
        if v: return v
        time.sleep(0.2)
    return fn()
def files_set(**kw): http("GET", "/__files_set?" + "&".join(f"{k}={v}" for k, v in kw.items()))
names = lambda d: bool(d) and bool((d["snap"].get("bg") or {}).get("file")) and bool((d["snap"].get("music") or {}).get("file"))
aside = lambda i: next((x for x in (doc("drafts") or []) if x["id"] == i), None)

serve()
token = login()
connect(token)
with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome")
    errors = []
    ctx = br.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=2)
    ctx.add_init_script(IPHONE)
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    def sign_in():
        pg.goto(B + "/"); pg.wait_for_timeout(800)
        if pg.is_visible("#passcode"): pg.fill("#passcode", "letmein"); pg.click("#passcode-go")
        pg.wait_for_selector("#suggestions .card", timeout=20000)
    def carry_on(words):
        pg.click("#nav-posts"); pg.wait_for_timeout(600)
        if pg.is_hidden("#posts-drafts"): pg.click("#posts-part-drafts")
        pg.locator("#list-saved .card", has_text=words[:18]).first.locator("text=Continue").click()
    state = lambda: pg.evaluate("(() => { const s = Studio.snapshot(); return { words: Studio.quoteOnly(), bg: s.bg && s.bg.kind, bgName: s.bg && s.bg.name, music: !!s.music, start: s.music && s.music.start, length: s.length, note: document.getElementById('draft-note').textContent, id: Studio.draft().id }; })()")

    sign_in()
    cards = pg.locator("#suggestions .card")
    q2 = cards.nth(1).locator(".q").first.inner_text().strip()
    q3 = cards.nth(2).locator(".q").first.inner_text().strip()
    cards.nth(0).locator("text=Use this").click()
    pg.wait_for_selector("#view-create:not([hidden])", timeout=5000)
    mine = "the reel she made and came back to"
    pg.click("#tab-text"); pg.fill("#words", mine)
    pg.click("#tab-bg"); pg.set_input_files("#file", f"{_W.MEDIA}/sea.mp4")
    check("a video she chooses herself opens", until(lambda: state()["bg"] == "video", 8000), state())
    pg.evaluate("sessionStorage.setItem('noTap', '1')")
    slide = lambda i, v: pg.evaluate("([i, v]) => { const e = document.getElementById(i); e.value = v; e.dispatchEvent(new Event('input')); }", [i, v])
    slide("len", 7)
    pg.click("#tab-music"); pg.set_input_files("#tune-file", f"{_W.MEDIA}/steps.mp3")
    until(lambda: state()["music"], 8000)
    slide("tune-start", 3)
    pg.click("#tab-save"); pg.click("#save-draft")
    pg.wait_for_function("document.getElementById('save-draft-note').textContent.includes('Saved in Drafts')", timeout=30000)
    d1 = doc("draft")
    check("the draft is saved with her video and music", names(d1), d1)
    before = state()

    # ---- the files can be asked for in pieces
    fid = d1["snap"]["bg"]["file"]
    import urllib.request
    def piece(q):
        req = urllib.request.Request(B + f"/api/drafts/files/{fid}{q}", headers={"Authorization": "Bearer " + token})
        try:
            with urllib.request.urlopen(req) as r: return r.status, r.read(), r.headers.get("X-File-Size")
        except urllib.error.HTTPError as e: return e.code, b"", None
    whole = open(f"{_W.MEDIA}/sea.mp4", "rb").read()
    s, body, size = piece("?from=1000&len=5000")
    check("a piece of a kept file is given as asked, with the whole file's size", s == 200 and body == whole[1000:6000] and size == str(len(whole)), (s, len(body), size))
    s, body, size = piece(f"?from={len(whole) - 10}&len=5000")
    check("the last piece ends where the file ends", s == 200 and body == whole[-10:], (s, len(body)))
    check("a piece past the end, or a senseless one, is refused", piece(f"?from={len(whole)}&len=10")[0] == 416 and piece("?from=-1&len=10")[0] == 400)

    # ---- she closes the app, begins quote 2, then carries on with the first: slowly, as on a phone
    pg.reload(); pg.wait_for_timeout(1200)
    if pg.is_hidden("#view-today"): pg.click("#nav-today")
    pg.wait_for_selector("#suggestions .card", timeout=20000)
    pg.locator("#suggestions .card", has_text=q2[:20]).first.locator("text=Use this").click()
    until(lambda: aside(d1["id"]))
    check("quote 1 is in Drafts with its files named", names(aside(d1["id"])), doc("drafts"))
    files_set(slow=4000)
    carry_on(mine)
    pg.wait_for_selector("#view-create:not([hidden])", timeout=5000); pg.wait_for_timeout(400)
    st = state()
    check("her words are back at once, before any file has arrived", st["words"] == mine and st["id"] == d1["id"] and not st["bg"] and not st["music"], st)
    check("Create says the background and music are on their way", st["note"].startswith("Bringing back your background and music"), st["note"])
    pg.click("#tab-save"); pg.click("#make-reel"); pg.wait_for_timeout(300)
    check("a reel is not made while they are still coming: it says so", "still coming back" in pg.inner_text("#done") and pg.is_hidden("#reel-progress"), pg.inner_text("#done"))
    pg.evaluate("window.dispatchEvent(new Event('pagehide'))")          # she leaves the app meanwhile: it is saved at once
    check("what is saved meanwhile still names both files", until(lambda: (doc("draft") or {}).get("id") == d1["id"], 3000) and names(doc("draft")), doc("draft"))
    check("(the files had not arrived yet)", not state()["bg"] and not state()["music"], state())
    ok = until(lambda: state()["bg"] == "video" and state()["music"], 15000)
    st = state()
    check("the video and the music come back (the phone never said loadeddata)", bool(ok), st)
    check("exactly as they were: the length, where the music starts, the names", st["length"] == before["length"] == 7 and st["start"] == before["start"] == 3 and st["bgName"] == before["bgName"], (st, before))
    check("and the line goes away", until(lambda: state()["note"] == "", 4000), state()["note"])
    pg.wait_for_timeout(3000)
    check("the draft still names both files after it is saved again", names(doc("draft")), doc("draft"))
    def write(t):
        if pg.is_hidden("#words"): pg.click("#tab-text")
        pg.fill("#words", t)
    write(mine + " again")
    check("and what she changes now is saved", until(lambda: any(b.get("text") == mine + " again" for b in (doc("draft") or {"snap": {"blocks": []}})["snap"]["blocks"]), 8000))
    mine = mine + " again"

    # ---- bug 2: while a draft is still coming back she picks a quote in Today
    pg.click("#nav-today"); pg.locator("#suggestions .card", has_text=q2[:20]).first.locator("text=Use this").click()
    until(lambda: aside(d1["id"]))
    pg.evaluate("location.reload()"); pg.wait_for_timeout(1500)          # (a fresh app: nothing brought back is remembered)
    files_set(slow=2500)
    carry_on(mine); pg.wait_for_timeout(500)
    check("(the draft is coming back)", state()["note"].startswith("Bringing back"), state())
    pg.click("#nav-today"); pg.locator("#suggestions .card", has_text=q3[:20]).first.locator("text=Use this").click()
    pg.wait_for_selector("#view-create:not([hidden])", timeout=5000)
    new_id = state()["id"]
    pg.wait_for_timeout(5000)                    # the draft's files arrive now
    st = state()
    check("the quote from Today is what is in Create, and stays", st["words"] == q3 and st["id"] == new_id != d1["id"], st)
    check("nothing of the draft arrived in it: no background, no music", not st["bg"] and not st["music"], st)
    check("no line about the draft's files is left", "Bringing back" not in st["note"] and "come through" not in st["note"], st["note"])
    check("the draft she left is in Drafts, with its words and both files named", names(aside(d1["id"])) and any(b.get("text") == mine for b in aside(d1["id"])["snap"]["blocks"]), aside(d1["id"]))
    files_set(slow=0)
    pg.click("#tab-bg"); pg.set_input_files("#file", f"{_W.MEDIA}/sky.jpg")
    check("a background chosen now stays", until(lambda: state()["bg"] == "image", 6000) and (pg.wait_for_timeout(1500) or state()["bg"] == "image"), state())
    pg.click("#tab-save"); pg.click("#make-reel")
    made = until(lambda: pg.is_visible("#reel-result") or (pg.is_visible("#done") and pg.inner_text("#done")), 150000)
    check("and the reel is made the normal way", pg.is_visible("#reel-result"), made)

    # ---- one she chooses herself while the draft's own is still coming: hers stays
    pg.evaluate("location.reload()"); pg.wait_for_timeout(1500)
    files_set(slow=2500)
    carry_on(mine); pg.wait_for_timeout(400)
    pg.click("#tab-bg"); pg.set_input_files("#file", f"{_W.MEDIA}/bright.jpg")
    until(lambda: state()["bg"] == "image", 5000)
    until(lambda: state()["music"], 15000); pg.wait_for_timeout(3500)
    st = state()
    check("her own choice stays; the draft's music still comes", st["bg"] == "image" and st["bgName"] == "bright.jpg" and st["music"], st)
    check("and that is what is saved", ((doc("draft") or {}).get("snap", {}).get("bg") or {}).get("name") == "bright.jpg" and doc("draft")["id"] == d1["id"], doc("draft"))
    files_set(slow=0)

    # ---- the connection drops for a piece or two: asked for again, nothing said
    pg.click("#nav-today"); pg.locator("#suggestions .card", has_text=q2[:20]).first.locator("text=Use this").click()
    until(lambda: aside(d1["id"]))
    pg.evaluate("location.reload()"); pg.wait_for_timeout(1500)
    files_set(fail=2)
    carry_on(mine)
    check("two dropped pieces: both files still arrive", until(lambda: state()["bg"] == "image" and state()["music"], 20000), state())

    # ---- the connection is gone: said plainly, nothing lost, and it can be tried again
    pg.click("#nav-today"); pg.locator("#suggestions .card", has_text=q2[:20]).first.locator("text=Use this").click()
    until(lambda: aside(d1["id"]))
    pg.evaluate("location.reload()"); pg.wait_for_timeout(1500)
    files_set(down=1)
    carry_on(mine)
    check("with no connection it says so, with a way to try again", until(lambda: "didn't come through" in state()["note"], 30000) and pg.is_visible("#draft-again"), state()["note"])
    check("her words are there all the same", state()["words"] == mine)
    pg.wait_for_timeout(3000)
    check("the draft keeps naming its files: nothing is lost", names(doc("draft")) and doc("draft")["id"] == d1["id"], doc("draft"))
    pg.click("#tab-save"); pg.click("#make-reel"); pg.wait_for_timeout(300)
    check("a reel is not made without them: it says what to do", "Try again" in pg.inner_text("#done"), pg.inner_text("#done"))
    files_set(down=0)
    pg.click("#draft-again")
    check("Try again brings them", until(lambda: state()["bg"] == "image" and state()["music"] and state()["note"] == "", 20000), state())

    # ---- a file that never opens at all: given up after a while, and the composer goes on working
    pg.click("#nav-today"); pg.locator("#suggestions .card", has_text=q2[:20]).first.locator("text=Use this").click()
    until(lambda: aside(d1["id"]))
    lib = doc("drafts"); x = next(i for i in lib if i["id"] == d1["id"]); x["snap"]["bg"] = d1["snap"]["bg"]; putdoc("drafts", lib)   # the video again
    pg.evaluate("location.reload()"); pg.wait_for_timeout(1500)
    pg.evaluate("window.__mute = ['loadeddata', 'canplay', 'loadedmetadata', 'error']")
    carry_on(mine)
    check("the music comes; the video that never opens is given up, and said", until(lambda: "didn't come through" in state()["note"], 30000) and state()["music"], state())
    check("she can also go on without it", pg.is_visible("#draft-without"))
    pg.click("#draft-without"); pg.wait_for_timeout(300)
    check("then the line goes, and a reel may be made", state()["note"] == "" and pg.evaluate("Studio.filesComing()") == "", state())
    write(mine + " still")
    check("the composer still saves what she does", until(lambda: any(b.get("text") == mine + " still" for b in (doc("draft") or {"snap": {"blocks": []}})["snap"]["blocks"]), 8000), doc("draft"))
    check("and the draft is saved without the video from then on, with the music", until(lambda: (lambda d: d and not d["snap"].get("bg") and (d["snap"].get("music") or {}).get("file"))(doc("draft")), 6000), doc("draft"))
    check("no errors on the page", not errors, errors)
    br.close()
finish()

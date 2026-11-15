"""Agent 14: work in progress is kept by itself, and can be carried on from another phone.
In the phone-sized browser, three phones (separate browser sessions, nothing shared but the server):
- phone A: a video background and music; the draft is saved by itself; the reel uses the kept video (not sent twice);
  the reel is put in Post later;
- phone B: "Carry on where you left off" with the first words; everything comes back; made again unchanged it gets the
  same render inputs as phone A's reel; it says the new one is a new reel (the first is waiting to be posted);
- phone A: the waiting card has Edit;
- phone C: the music file was cleaned: it opens with what is left and says the music is missing; a picture post
  (4:5, photo) is kept and comes back after closing the app.
Run:  python3 tests/test_a14_draft.py"""
import where as _W
import json, urllib.request
from a3lib import *
from playwright.sync_api import sync_playwright

SHOTS = f"{_W.OUT}/shots"
RS = "dev-render-secret"
def raw(path):
    req = urllib.request.Request(B + path, headers={"Authorization": "Bearer " + RS})
    with urllib.request.urlopen(req, timeout=60) as r: return r.read()
def inputs(job):
    j = json.loads(raw(f"/api/render/{job}/job"))
    return ({k: j.get(k) for k in ("length", "keepAudio", "fade", "bgExt", "bgKey", "music")},
            raw(f"/api/render/{job}/bg"), raw(f"/api/render/{job}/overlay"), raw(f"/api/render/{job}/music"))
def keys(prefix): return http("GET", "/__keys?prefix=" + prefix)[1] or []
def until(fn, ms=20000):
    for _ in range(ms // 250):
        v = fn()
        if v: return v
        time.sleep(0.25)
    return fn()

serve()
token = login()
connect(token)

def phone(br, errors):
    ctx = br.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=2)
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(B + "/"); pg.wait_for_timeout(800)
    pg.fill("#passcode", "letmein"); pg.click("#passcode-go"); pg.wait_for_timeout(1500)
    pg.click("#nav-create"); pg.wait_for_timeout(500)
    return pg
def make(pg):
    pg.click("#tab-save") if pg.is_hidden("#pane-save") else None
    pg.click("#make-reel")
    pg.wait_for_function("!document.getElementById('reel-result').hidden || !document.getElementById('done').hidden", timeout=300000)
    check("the reel was made", pg.is_visible("#reel-result"), pg.text_content("#done"))
    return pg.evaluate("Studio.currentReel().id")

with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome")
    errors = []

    # ---- phone A ----
    a = phone(br, errors)
    a.click("#tab-bg"); a.set_input_files("#file", f"{_W.MEDIA}/sea.mp4"); a.wait_for_timeout(1500)
    a.evaluate("Studio.setQuote('slow down,\\nthe tide knows the way', 'Anon')")
    a.click("#tab-music"); a.set_input_files("#tune-file", f"{_W.MEDIA}/tone.m4a"); a.wait_for_timeout(1200)
    d = until(lambda: (lambda x: x if x and x["snap"]["bg"] and x["snap"]["bg"].get("file") and x["snap"]["music"] and x["snap"]["music"].get("file") else None)(doc("draft")))
    check("phone A: the draft is saved by itself with the video and the music", bool(d), doc("draft"))
    check("phone A: the video is kept as she chose it", d and d["snap"]["bg"]["kind"] == "video" and d["snap"]["bg"]["name"] == "sea.mp4")
    snap_a = a.evaluate("Studio.snapshot()")
    job_a = make(a)
    in_a = inputs(job_a)
    check("the reel uses the kept video: it was not sent twice", (in_a[0].get("bgKey") or "").startswith("drafts/") and f"jobs/{job_a}/bg" not in keys(f"jobs/{job_a}/"), in_a[0])
    check("the renderer gets exactly her video", in_a[1] == open(f"{_W.MEDIA}/sea.mp4", "rb").read())
    a.click("#queue-add"); a.wait_for_timeout(800)
    check("phone A: put in Post later", any(q["jobId"] == job_a for q in (doc("queue") or [])), doc("queue"))

    # ---- phone B: carry on ----
    b = phone(br, errors)
    b.wait_for_selector("#draft-carry:not([hidden])", timeout=10000)
    check("phone B: Carry on where you left off, with the first words", "Carry on where you left off" in b.text_content("#draft-carry")
          and "slow down" in b.text_content("#draft-carry"), b.text_content("#draft-carry"))
    b.screenshot(path=f"{SHOTS}/a14_draft_1_carry_on.png")
    b.click("#draft-carry")
    b.wait_for_function("Studio.draftFiles().bg && Studio.draftFiles().music", timeout=20000)
    b.wait_for_timeout(800)
    snap_b = b.evaluate("Studio.snapshot()")
    check("phone B: everything is back exactly", snap_b == snap_a, json.dumps([snap_a, snap_b])[:1200])
    check("phone B: the line has gone", b.is_hidden("#draft-carry"))
    job_b = make(b)
    in_b = inputs(job_b)
    check("made again on another phone: the same text layer", in_a[2] == in_b[2] and len(in_a[2]) > 1000)
    check("made again on another phone: the same background", in_a[1] == in_b[1])
    check("made again on another phone: the same music", in_a[3] == in_b[3] and len(in_a[3]) > 100)
    check("made again on another phone: the same settings", in_a[0] == in_b[0], [in_a[0], in_b[0]])
    check("phone B: says plainly it is a new reel", "new reel" in (b.text_content("#draft-note") or ""), b.text_content("#draft-note"))
    made = until(lambda: (lambda m: m if m and len(m) == 2 else None)(doc("made")))
    check("both reels are kept (the waiting one is never lost)", made and sorted(x["jobId"] for x in made) == sorted([job_a, job_b]), doc("made"))
    b.screenshot(path=f"{SHOTS}/a14_draft_2_new_reel.png")

    # ---- phone A: Edit on the waiting card ----
    a.click("#nav-posts")
    a.wait_for_selector("#list-queue article", timeout=15000)
    edit = a.locator("#list-queue article").first.get_by_role("button", name="Edit")
    edit.wait_for(state="visible", timeout=10000)
    a.screenshot(path=f"{SHOTS}/a14_draft_3_queue_edit.png", full_page=True)
    check("the made-only reel is listed under Made, not posted, the waiting one only once", a.locator("#list-made article").count() == 1)
    edit.click()
    a.wait_for_function("Studio.draftFiles().bg && !/Bringing back/.test(document.getElementById('draft-note').textContent)", timeout=20000)
    check("Edit on a waiting reel says the waiting one stays", "waiting to be posted stays" in (a.text_content("#draft-note") or ""), a.text_content("#draft-note"))

    # ---- phone C: a file was cleaned ----
    music_file = doc("draft")["snap"]["music"]["file"]
    http("DELETE", f"/__drafts_del?key=drafts/{music_file}")
    c = phone(br, errors)
    c.wait_for_selector("#draft-carry:not([hidden])", timeout=10000)
    c.click("#draft-carry")
    c.wait_for_function("Studio.draftFiles().bg && !/Bringing back/.test(document.getElementById('draft-note').textContent)", timeout=20000)
    check("phone C: opens with what is left", c.evaluate("Studio.snapshot().blocks[0].text").startswith("slow down") and c.evaluate("!Studio.draftFiles().music"))
    check("phone C: says the music is missing", "music is no longer kept" in (c.text_content("#draft-note") or ""), c.text_content("#draft-note"))
    c.screenshot(path=f"{SHOTS}/a14_draft_4_missing.png")

    # ---- phone C: a picture post comes back after closing the app ----
    c.click("#tab-style"); c.locator("#shape [data-shape='post']").click()
    c.click("#tab-bg"); c.set_input_files("#file", f"{_W.MEDIA}/sky.jpg"); c.wait_for_timeout(800)
    c.evaluate("Studio.setWords('a picture for the feed')")
    until(lambda: (lambda x: x if x and x["snap"]["shape"] == "post" and (x["snap"]["bg"] or {}).get("name") == "sky.jpg" and x["snap"]["bg"].get("file") else None)(doc("draft")))
    snap_c = c.evaluate("Studio.snapshot()")
    c.reload(); c.wait_for_timeout(2500)
    if c.is_hidden("#view-create"):
        check("opening on another section downloads nothing yet", c.evaluate("!Studio.draftFiles().bg"))
        c.click("#nav-create")
    c.wait_for_function("Studio.draftFiles().bg && Studio.draftFiles().bg.name === 'sky.jpg'", timeout=20000)
    c.wait_for_timeout(500)
    check("a picture post (4:5) comes back after closing the app, with its photo", c.evaluate("Studio.snapshot()") == snap_c, c.evaluate("Studio.snapshot()"))
    check("no carry-on line for this phone's own draft", c.is_hidden("#draft-carry"))
    c.screenshot(path=f"{SHOTS}/a14_draft_5_picture_back.png")
    check("no page errors", not errors, errors)
    br.close()

finish()

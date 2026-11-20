"""Agent 14: a reel she made can be opened again and changed.
In the phone-sized browser: make a reel (photo, words, every kind of style setting, music with a start and volume),
close the app (reload), find it under "Made, not posted" in Posts, Edit, see every setting, the background and the
music back exactly; make it again unchanged (same text layer and same render inputs), change the words, make it again
(it replaces the old one, whose files go), post it from the card (stand-in Instagram), and see "Make a version of this".
Run:  python3 tests/test_a14_edit.py"""
import where as _W
import json, urllib.request
from a3lib import *
from playwright.sync_api import sync_playwright

SHOTS = f"{_W.OUT}/shots"

def raw(path, bearer):
    req = urllib.request.Request(B + path, headers={"Authorization": "Bearer " + bearer})
    try:
        with urllib.request.urlopen(req, timeout=60) as r: return r.status, r.read()
    except urllib.error.HTTPError as e: return e.code, e.read()
def inputs(job):
    """What the renderer is given for a reel: its settings and the bytes of its three files."""
    s, j = raw(f"/api/render/{job}/job", "dev-render-secret")
    j = json.loads(j)
    same = {k: j.get(k) for k in ("length", "keepAudio", "fade", "bgExt")}
    same["music"] = {k: v for k, v in (j.get("music") or {}).items()}
    return same, raw(f"/api/render/{job}/bg", "dev-render-secret")[1], raw(f"/api/render/{job}/overlay", "dev-render-secret")[1], raw(f"/api/render/{job}/music", "dev-render-secret")[1]
def keys(prefix): return [o["key"] if isinstance(o, dict) else o for o in (http("GET", "/__keys?prefix=" + prefix)[1] or [])]

serve()
token = login()
connect(token)

def setv(pg, sel, value, ev="input"):
    pg.evaluate(f"([s, v]) => {{ const e = document.querySelector(s); e.value = v; e.dispatchEvent(new Event('{ev}', {{ bubbles: true }})); }}", [sel, value])
def wait_made(pg, timeout=300000):
    pg.wait_for_function("!document.getElementById('reel-result').hidden || !document.getElementById('done').hidden", timeout=timeout)
    check("the reel was made", pg.is_visible("#reel-result"), pg.text_content("#done"))
    return pg.evaluate("Studio.currentReel() && Studio.currentReel().id")
def until(fn, ms=15000):
    for _ in range(ms // 250):
        v = fn()
        if v: return v
        time.sleep(0.25)
    return fn()

with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome")
    ctx = br.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=2)
    ctx.add_init_script("try { localStorage.setItem('studio.postsView', 'list'); } catch (e) {}")   # these checks read the posts as a list (the gallery is checked in test_page_posts.py)
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(B + "/"); pg.wait_for_timeout(800)
    pg.fill("#passcode", "letmein"); pg.click("#passcode-go"); pg.wait_for_timeout(1500)
    pg.click("#nav-create"); pg.wait_for_timeout(300)

    # ---- make something with every kind of setting ----
    pg.click("#tab-bg"); pg.set_input_files("#file", f"{_W.MEDIA}/sky.jpg"); pg.wait_for_timeout(800)
    pg.evaluate("Studio.setQuote('the sea keeps no calendar,\\nand neither should you', 'Mary Oliver')")
    pg.click("#tab-text"); pg.wait_for_timeout(200)
    pg.select_option("#font", "poppins-italic")
    setv(pg, "#size", "58"); setv(pg, "#width", "72")
    pg.click("#swatches button[data-hex='#BFE6DA']")
    pg.click("#align button[data-align='left']")
    pg.check("#lower"); pg.uncheck("#shadow")
    pg.click("#add"); pg.fill("#words", "with love")
    pg.click("#tab-music"); pg.set_input_files("#tune-file", f"{_W.MEDIA}/steps.mp3"); pg.wait_for_timeout(1200)
    setv(pg, "#tune-start", "2"); setv(pg, "#tune-vol", "45")
    pg.click("#tab-save"); setv(pg, "#len", "9"); pg.check("#fade")
    snap_a = pg.evaluate("Studio.snapshot()")
    check("the composer holds the settings that were set", snap_a["length"] == 9 and snap_a["fade"] and not snap_a["shadow"]
          and snap_a["music"]["start"] == 2 and abs(snap_a["music"]["volume"] - 0.45) < 1e-9 and len(snap_a["blocks"]) == 3, snap_a)

    # ---- the draft is kept on the server by itself, files once ----
    d = until(lambda: (lambda x: x if x and x["snap"]["bg"].get("file") and x["snap"]["music"].get("file") else None)(doc("draft")))
    check("the draft is saved by itself, with its background and music files", bool(d), doc("draft"))
    check("two files kept under drafts/ (background, music)", len(keys("drafts/")) == 2, keys("drafts/"))
    check("the draft keeps where the words came from and the words", d and d["snap"]["blocks"][0]["text"].startswith("the sea keeps"))

    # ---- make the reel ----
    pg.click("#make-reel")
    job_a = wait_made(pg)
    pg.screenshot(path=f"{SHOTS}/a14_edit_1_made.png")
    made = until(lambda: doc("made"))
    check("the reel is kept under Made, not posted", made and len(made) == 1 and made[0]["jobId"] == job_a, made)
    check("its small picture is kept", until(lambda: f"jobs/{job_a}/thumb.jpg" in keys(f"jobs/{job_a}/")), keys(f"jobs/{job_a}/"))
    in_a = inputs(job_a)
    check("the music was not sent twice: the reel uses the kept file", in_a[0]["music"].get("key", "").startswith("drafts/")
          and f"jobs/{job_a}/music" not in keys(f"jobs/{job_a}/"), in_a[0])
    check("the result has Edit and Start a new one", pg.is_visible("#edit-reel") and pg.is_visible("#again"))

    # ---- close the app and come back: Posts, Made, not posted ----
    pg.reload(); pg.wait_for_timeout(2500)
    pg.click("#nav-posts"); pg.click("#posts-part-drafts")      # Made, not posted is in the Drafts part of Posts
    pg.wait_for_selector("#list-made article", timeout=15000)
    card = pg.locator("#list-made article").first
    check("Made, not posted shows the reel with its first words and when it was made",
          "the sea keeps" in card.text_content() and "Made " in card.text_content(), card.text_content())
    check("the card has Post, Edit, Share and Delete", all(card.get_by_role("button", name=n).count() for n in ["Post", "Edit", "Share to Instagram", "Delete"]))
    pg.wait_for_timeout(600)
    pg.screenshot(path=f"{SHOTS}/a14_edit_2_posts.png")
    card.get_by_role("button", name="Edit").click()
    pg.wait_for_function("Studio.draftFiles().bg && Studio.draftFiles().music", timeout=20000)
    pg.wait_for_timeout(600)
    snap_b = pg.evaluate("Studio.snapshot()")
    check("Edit puts back every setting, the background and the music exactly", snap_b == snap_a, json.dumps([snap_a, snap_b])[:1500])
    check("Edit opens on the Text tab", pg.is_visible("#pane-text"))
    check("Edit says making it again replaces it", "replaces" in (pg.text_content("#draft-note") or ""), pg.text_content("#draft-note"))
    check("the music player knows its start and volume", pg.evaluate("Studio.musicState()")["start"] == 2)
    pg.screenshot(path=f"{SHOTS}/a14_edit_3_reopened.png")

    # ---- made again without a change: the same text layer and the same render inputs ----
    pg.click("#tab-save"); pg.click("#make-reel")
    job_b = wait_made(pg)
    in_b = inputs(job_b)
    check("unchanged: the same text layer, byte for byte", in_a[2] == in_b[2] and len(in_a[2]) > 1000)
    check("unchanged: the same background picture, byte for byte", in_a[1] == in_b[1] and len(in_a[1]) > 1000)
    check("unchanged: the same music, byte for byte", in_a[3] == in_b[3] and len(in_a[3]) > 1000)
    check("unchanged: the same reel settings", in_a[0] == in_b[0], [in_a[0], in_b[0]])
    made = until(lambda: (lambda m: m if m and m[0]["jobId"] == job_b else None)(doc("made")))
    check("making it again replaces it (still one, now the new reel)", made and len(made) == 1, doc("made"))
    check("the old reel's files are gone", until(lambda: not keys(f"jobs/{job_a}/")), keys(f"jobs/{job_a}/"))

    # ---- change the words and make it again ----
    pg.click("#edit-reel")
    pg.evaluate("Studio.setWords('the tide comes back for you')")
    pg.click("#tab-save"); pg.click("#make-reel")
    job_c = wait_made(pg)
    made = until(lambda: (lambda m: m if m and m[0]["jobId"] == job_c else None)(doc("made")))
    check("the changed reel replaces it", made and len(made) == 1 and made[0]["snap"]["blocks"][0]["text"] == "the tide comes back for you", doc("made"))

    # ---- post it from the card ----
    pg.click("#nav-posts"); pg.click("#posts-part-drafts")      # Made, not posted is in the Drafts part of Posts
    pg.wait_for_selector("#list-made article", timeout=15000)
    pg.locator("#list-made article").first.get_by_role("button", name="Post").click()
    pg.wait_for_selector("#post-sheet:not([hidden])", timeout=10000)
    pg.fill("#post-caption", "for the tide")
    pg.click("#post-go")
    pg.wait_for_function("/Posted to Instagram/.test(document.getElementById('post-status').textContent)", timeout=60000)
    check("posting waited for her tap and went through", "Posted to Instagram" in pg.text_content("#post-status"))
    posts = doc("posts") or []
    check("the post is the changed reel", any(x.get("jobId") == job_c and x.get("state") == "published" for x in posts), posts)
    pg.click("#post-close") if pg.is_visible("#post-close") else None
    pg.click("#nav-today"); pg.click("#nav-posts"); pg.click("#posts-part-posted")
    pg.wait_for_function("document.getElementById('made-wrap').hidden && document.querySelector('#list-posts article')", timeout=15000)
    check("once posted it leaves Made, not posted", pg.is_hidden("#made-wrap"))
    ver = pg.locator("#list-posts article").first.get_by_role("button", name="Make a version of this")
    ver.wait_for(state="visible", timeout=10000)
    check("a posted reel offers Make a version of this", ver.is_visible())
    pg.screenshot(path=f"{SHOTS}/a14_edit_4_posted.png", full_page=True)
    ver.click()
    pg.wait_for_function("Studio.draftFiles().bg && !/Bringing back/.test(document.getElementById('draft-note').textContent)", timeout=20000)
    check("a version of a posted reel says it makes a new reel", "new reel" in (pg.text_content("#draft-note") or ""), pg.text_content("#draft-note"))
    check("no page errors", not errors, errors)
    br.close()

finish()

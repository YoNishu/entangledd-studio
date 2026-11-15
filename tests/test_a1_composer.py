"""The composer draws only when something changed (or a video is playing), never while it can't be seen, and
what it saves is the same, byte for byte, as before the change: the picture, and the text layer sent for a reel.
Also: the wait for a finished reel asks often and the reel is fetched once for preview, saving and handing over.
Compares the code as it was at the start (served on the next port from $STUDIO_OUT/base) with the code now (its own port).
Asserts; exits non-zero on failure."""
import where as _W
import hashlib, json, os, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright

S = f"{_W.OUT}/shots/"
NEW, OLD = f"{_W.URL}", f"{_W.URL2}"
fails = []
def check(name, ok, detail=""):
    print(("ok   " if ok else "FAIL ") + name + (("  | " + str(detail)) if detail != "" else ""))
    if not ok: fails.append(name)

subprocess.run([f"{_W.HERE}/serve"], check=True, stdout=subprocess.DEVNULL)
subprocess.run(f"fuser -k {_W.PORT2}/tcp >/dev/null 2>&1; cd {_W.OUT}/base && (env PORT={_W.PORT2} DEV_MEDIA={_W.MEDIA} nohup node server/dev.mjs > {_W.OUT}/base.log 2>&1 &); sleep 1.5", shell=True)

INIT = """
window.__draws = 0;
const realFill = CanvasRenderingContext2D.prototype.fillRect;
CanvasRenderingContext2D.prototype.fillRect = function (x, y, w, h) {
  if (this.canvas.id === "canvas" && x === 0 && y === 0 && w === this.canvas.width) window.__draws++;   // one per full redraw
  return realFill.apply(this, arguments);
};
// the text layer as it is sent for a reel: its checksum is kept, so two versions of the app can be compared
const realFetch = window.fetch;
window.fetch = function (url, opts) {
  if (opts && opts.method === "PUT" && String(url).split("?")[0].endsWith("/overlay") && opts.body instanceof Blob) {
    window.__overlay = opts.body.arrayBuffer().then((buf) => crypto.subtle.digest("SHA-256", buf))
      .then((d) => opts.body.size + ":" + [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join(""));
  }
  return realFetch.apply(this, arguments);
};
window.__shares = [];
navigator.canShare = () => true;
navigator.share = (d) => { window.__shares.push({ at: Math.round(performance.now()), size: d.files[0].size, type: d.files[0].type }); return Promise.resolve(); };
"""
HASH = """async (kind) => {
  const hex = async (blob) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (kind === "picture") return hex(await Studio.pictureBlob());
  const c = document.getElementById("canvas");
  return hex(await new Promise((r) => c.toBlob(r, "image/png")));
}"""
QUOTE = "The sea keeps no calendar — and neither should you."

def draws_in(pg, ms):
    pg.evaluate("window.__draws = 0"); pg.wait_for_timeout(ms); return pg.evaluate("window.__draws")

def run(p, base, new):
    tag = "now" if new else "before"
    b = p.chromium.launch(channel="chrome", args=["--autoplay-policy=no-user-gesture-required"])
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
    ctx.add_init_script(INIT)
    pg = ctx.new_page(); errs = []; reqs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("request", lambda r: reqs.append((time.time(), r.method, r.url)))
    pg.goto(base + "/"); pg.wait_for_selector("#lock:not([hidden])", timeout=8000)
    pg.fill("#passcode", "letmein"); pg.click("#passcode-go"); pg.wait_for_function("document.getElementById('lock').hidden", timeout=8000)
    pg.click("#nav-create"); pg.wait_for_timeout(300); pg.click("#tab-text"); pg.wait_for_timeout(200)
    pg.evaluate("(q) => Studio.setQuote(q, 'Dhruuu')", QUOTE)
    pg.evaluate("document.fonts.ready"); pg.wait_for_timeout(2500)
    out = {}
    # ---- idle on Create
    out["idle"] = draws_in(pg, 1000)
    out["picture"] = pg.evaluate(HASH, "picture")
    out["canvas"] = pg.evaluate(HASH, "canvas")
    if new:
        check("still picture, nothing changing: no redraws", out["idle"] <= 1, out["idle"])
        # ---- a change shows at once
        pg.evaluate("Studio.replaceSelectedText('Every day with you')"); pg.wait_for_timeout(250)
        changed = pg.evaluate(HASH, "canvas")
        check("a change to the words is drawn straight away", changed != out["canvas"])
        check("and then it rests again", draws_in(pg, 800) <= 1)
        pg.evaluate("(q) => Studio.setQuote(q, 'Dhruuu')", QUOTE); pg.wait_for_timeout(300)
        check("back to the same words: the same picture as before", pg.evaluate(HASH, "canvas") == out["canvas"] and pg.evaluate(HASH, "picture") == out["picture"])
        pg.screenshot(path=S + "a1_composer_still.png")
        # ---- other section, hidden app
        pg.click("#nav-today"); pg.wait_for_timeout(300)
        check("another section showing: no redraws", draws_in(pg, 800) == 0)
        pg.click("#nav-create"); pg.wait_for_timeout(400)
        check("back on Create: the picture is there again", pg.evaluate(HASH, "canvas") == out["canvas"])
        pg.evaluate("Object.defineProperty(document, 'hidden', { get: () => true, configurable: true })")
        check("app in the background: no redraws", draws_in(pg, 800) == 0)
        pg.evaluate("delete document.hidden"); pg.wait_for_timeout(300)
        check("back in front: the picture is there again", pg.evaluate(HASH, "canvas") == out["canvas"])
    # ---- photo background
    pg.click("#tab-bg"); pg.set_input_files("#file", f"{_W.MEDIA}/sky.jpg"); pg.wait_for_timeout(1200)
    out["photo_idle"] = draws_in(pg, 1000)
    out["photo_picture"] = pg.evaluate(HASH, "picture")
    if new:
        check("photo behind the words, nothing changing: no redraws", out["photo_idle"] <= 1, out["photo_idle"])
        pg.screenshot(path=S + "a1_composer_photo.png")
    # ---- a reel from it: the text layer that is sent, the waiting, and one fetch of the result
    pg.click("#tab-save"); pg.wait_for_timeout(300)
    t0 = time.time(); pg.click("#make-reel")
    pg.wait_for_function("!document.getElementById('reel-result').hidden || (!document.getElementById('done').hidden && document.getElementById('reel-progress').hidden)", timeout=180000)
    out["reel_s"] = round(time.time() - t0, 1)
    check(f"[{tag}] a reel is made", pg.evaluate("!document.getElementById('reel-result').hidden"), pg.inner_text("#done"))
    out["overlay"] = pg.evaluate("window.__overlay || ''")
    polls = [t for t, m, u in reqs if m == "GET" and "/api/jobs/" in u and not u.endswith("/reel")]
    out["poll_gaps"] = [round(b - a, 1) for a, b in zip(polls, polls[1:])]
    out["polls"] = len(polls)
    if new:
        pg.wait_for_timeout(500)
        check("the result plays from the reel that was fetched (no second download)", pg.evaluate("document.getElementById('result').src.startsWith('blob:')"))
        pg.click("#save-reel"); pg.wait_for_timeout(300)
        shares = pg.evaluate("window.__shares")
        size = pg.evaluate("Studio.currentReel().blob.size")
        check("Save: the share menu gets the same reel, as an MP4 video", len(shares) == 1 and shares[0]["size"] == size and shares[0]["type"] == "video/mp4", shares)
        pg.click("#handoff-open"); pg.wait_for_timeout(300)
        check("Share to Instagram: the button is ready at once", pg.evaluate("!document.getElementById('handoff-go').disabled"))
        pg.click("#handoff-go"); pg.wait_for_timeout(600)
        shares = pg.evaluate("window.__shares")
        check("Share to Instagram: the same reel again", len(shares) == 2 and shares[1]["size"] == size, shares)
        fetched = [u for t, m, u in reqs if m == "GET" and u.endswith("/reel")]
        check("the finished reel was fetched exactly once for preview, saving and sharing", len(fetched) == 1, fetched)
        pg.screenshot(path=S + "a1_reel_result.png")
        pg.evaluate("document.getElementById('handoff-sheet').hidden = true")
    # ---- video background: playing means drawing
    pg.click("#again") if pg.evaluate("!document.getElementById('reel-result').hidden") else None
    pg.click("#tab-bg"); pg.set_input_files("#file", f"{_W.MEDIA}/sea.mp4"); pg.wait_for_timeout(2500)
    out["video_playing"] = draws_in(pg, 1000)
    if new:
        a = pg.evaluate(HASH, "canvas"); pg.wait_for_timeout(400); c = pg.evaluate(HASH, "canvas")
        check("video behind the words: it keeps being drawn while it plays", out["video_playing"] >= 20 and a != c, out["video_playing"])
        pg.evaluate("document.querySelector('#stage canvas') && 0")
        pg.screenshot(path=S + "a1_composer_video.png")
        pg.evaluate("Studio.signOut()"); pg.wait_for_timeout(300)
        check("lock showing: no redraws, even with a video playing", draws_in(pg, 800) == 0)
    out["errors"] = errs
    b.close()
    return out

with sync_playwright() as p:
    old = run(p, OLD, False)
    new = run(p, NEW, True)
print("before:", json.dumps({k: v for k, v in old.items() if k not in ("picture", "canvas", "photo_picture", "overlay")}))
print("now   :", json.dumps({k: v for k, v in new.items() if k not in ("picture", "canvas", "photo_picture", "overlay")}))
check("no script errors", not old["errors"] and not new["errors"], (old["errors"], new["errors"]))
check("before the change the still picture was redrawn all the time (the thing being fixed)", old["idle"] >= 30, old["idle"])
check("saved picture (plain background): byte for byte the same as before", old["picture"] == new["picture"] and len(new["picture"]) == 64, (old["picture"][:12], new["picture"][:12]))
check("what shows on the canvas: the same pixels as before", old["canvas"] == new["canvas"])
check("saved picture (photo background): byte for byte the same as before", old["photo_picture"] == new["photo_picture"], (old["photo_picture"][:12], new["photo_picture"][:12]))
check("the text layer sent for a reel: byte for byte the same as before", old["overlay"] == new["overlay"] and int((new["overlay"] or "0:").split(":")[0]) > 5000, (old["overlay"][:20], new["overlay"][:20]))
check("waiting for the reel: asked every 4 s before", old["poll_gaps"] and min(old["poll_gaps"]) >= 3.8, old["poll_gaps"])
check("waiting for the reel: now never slower than every 3 s, and every 1.5 s once it may be ready",
      new["poll_gaps"] == [] or (max(new["poll_gaps"]) <= 3.4 and all(g <= 1.9 for g in new["poll_gaps"][3:])), new["poll_gaps"])
json.dump({"before": old, "now": new}, open(f"{_W.OUT}/composer_numbers.json", "w"))
subprocess.run(f"fuser -k {_W.PORT2}/tcp >/dev/null 2>&1; {_W.HERE}/stop", shell=True, stdout=subprocess.DEVNULL)
print("FAIL: " + ", ".join(fails) if fails else "PASS")
sys.exit(1 if fails else 0)

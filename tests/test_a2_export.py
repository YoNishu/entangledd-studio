"""Agent 2: the redesign must not change what the composer makes.
Makes the same picture (reel shape and post shape) and the same reel text layer in the app as it was before
(commit d576d40, served from a scratch copy on the next port) and as it is now (its own port), and compares them byte for byte.
Run:  tests/serve && python3 tests/test_a2_export.py"""
import where as _W
import base64, hashlib, os, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright

WT = f"{_W.ROOT}"
OLD_DIR, OLD_PORT, NEW_PORT = f"{_W.OUT}/base", _W.PORT2, _W.PORT
fails = []

def check(name, ok, detail=""):
    print(("ok   " if ok else "FAIL ") + name + (("  -> " + str(detail)) if detail and not ok else ""))
    if not ok:
        fails.append(name)

# the app as it was, in a scratch folder of its own
if not os.path.exists(OLD_DIR + "/server/dev.mjs"):
    os.makedirs(OLD_DIR, exist_ok=True)
    tar = subprocess.run(["git", "-C", WT, "archive", "d576d40"], capture_output=True, check=True).stdout
    subprocess.run(["tar", "-x", "-C", OLD_DIR], input=tar, check=True)
old = subprocess.Popen(["node", "server/dev.mjs"], cwd=OLD_DIR, env={**os.environ, "PORT": str(OLD_PORT), "DEV_MEDIA": f"{_W.MEDIA}"},
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def up(port):
    for _ in range(40):
        try:
            urllib.request.urlopen(f"http://localhost:{port}/api/status").read()
            return True
        except Exception:
            time.sleep(0.25)
    return False

# keeps a copy of the text layer the app sends for a reel (a transparent PNG)
KEEP = """const send = window.fetch; window.__overlay = '';
window.fetch = async function (u, o) {
  if (String(u).endsWith('/overlay') && o && o.body) {
    const a = new Uint8Array(await new Response(o.body).arrayBuffer());
    let s = ''; for (let i = 0; i < a.length; i += 8192) s += String.fromCharCode.apply(null, a.subarray(i, i + 8192));
    window.__overlay = btoa(s);
  }
  return send.apply(this, arguments);
};"""
PICTURE = """async () => { const b = await Studio.pictureBlob(); const a = new Uint8Array(await b.arrayBuffer());
  let s = ''; for (let i = 0; i < a.length; i += 8192) s += String.fromCharCode.apply(null, a.subarray(i, i + 8192)); return btoa(s); }"""

def make(pg, port):
    out = {}
    pg.goto(f"http://localhost:{port}/"); pg.wait_for_timeout(1000)
    pg.fill("#passcode", "letmein"); pg.click("#passcode-go"); pg.wait_for_timeout(1500)
    pg.click("#nav-create"); pg.wait_for_timeout(300)
    if pg.evaluate("document.getElementById('pane-bg').hidden"):
        pg.click("#tab-bg")
    pg.set_input_files("#file", f"{_W.MEDIA}/sky.jpg"); pg.wait_for_timeout(900)
    pg.evaluate("Studio.setQuote('the sea keeps no calendar,\\nand neither should you', 'Mary Oliver')")
    pg.evaluate("document.fonts.ready"); pg.wait_for_timeout(800)
    out["picture, reel shape"] = base64.b64decode(pg.evaluate(PICTURE))
    pg.click("#tab-style"); pg.locator("#shape [data-shape='post']").click(); pg.wait_for_timeout(500)
    out["picture, post shape"] = base64.b64decode(pg.evaluate(PICTURE))
    pg.locator("#shape [data-shape='reel']").click(); pg.wait_for_timeout(400)
    if pg.evaluate("document.getElementById('pane-save').hidden"):
        pg.click("#tab-save")
    pg.click("#make-reel")
    for _ in range(120):
        if pg.evaluate("!!window.__overlay"):
            break
        pg.wait_for_timeout(500)
    out["reel text layer"] = base64.b64decode(pg.evaluate("window.__overlay || ''"))
    return out

try:
    check("the scratch copy of the old app started", up(OLD_PORT))
    check("this branch's server is running", up(NEW_PORT))
    with sync_playwright() as p:
        b = p.chromium.launch(channel="chrome")
        made = {}
        for label, port in (("before", OLD_PORT), ("now", NEW_PORT)):
            ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
            ctx.add_init_script(KEEP)
            made[label] = make(ctx.new_page(), port)
            ctx.close()
        b.close()
    for what in made["before"]:
        a, z = made["before"][what], made["now"][what]
        same = a == z
        check(f"{what}: identical to before ({len(z)} bytes, sha1 {hashlib.sha1(z).hexdigest()[:10]})", same and len(z) > 10000,
              f"before {len(a)} bytes {hashlib.sha1(a).hexdigest()[:10]}, now {len(z)} bytes")
        os.makedirs(f"{_W.OUT}/shots", exist_ok=True)
        open(f"{_W.OUT}/shots/a2_export_" + what.replace(", ", "_").replace(" ", "_") + (".png" if "layer" in what else ".jpg"), "wb").write(z)
finally:
    old.terminate()
    try:
        old.wait(timeout=5)
    except Exception:
        old.kill()

print("\n" + ("PASS" if not fails else "FAIL: " + "; ".join(fails)))
sys.exit(1 if fails else 0)

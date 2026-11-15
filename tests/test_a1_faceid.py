"""Unlocking: Face ID asks by itself, the challenge needs no storage, nothing can be replayed, and opening
when already signed in does not wait for the server's status. Asserts; exits non-zero on failure."""
import where as _W
import base64, json, subprocess, sys, time, urllib.request, urllib.error
from playwright.sync_api import sync_playwright

BASE = f"{_W.URL}"
S = f"{_W.OUT}/shots/"
fails = []
def check(name, ok, detail=""):
    print(("ok   " if ok else "FAIL ") + name + (("  | " + str(detail)) if detail != "" else ""))
    if not ok: fails.append(name)
def call(path, data=None, method=None, token=None):
    req = urllib.request.Request(BASE + path, data=(json.dumps(data).encode() if data is not None else None), method=method or ("POST" if data is not None else "GET"))
    req.add_header("Content-Type", "application/json")
    if token: req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")
b64u = lambda b: base64.urlsafe_b64encode(b).decode().rstrip("=")
def ops(reset=True):
    with urllib.request.urlopen(BASE + "/__ops" + ("?reset=1" if reset else "")) as r: return json.loads(r.read())

subprocess.run([f"{_W.HERE}/serve", "R2_DELAY=30"], check=True, stdout=subprocess.DEVNULL)

INIT = """
window.__ready = 0; document.addEventListener("studio:ready", () => { window.__ready++; });
window.__gets = [];
if (navigator.credentials && navigator.credentials.get) {
  const realGet = navigator.credentials.get.bind(navigator.credentials);
  navigator.credentials.get = (o) => {
    window.__gets.push(Math.round(performance.now()));
    const n = +(localStorage.getItem("__refuse") || 0);
    if (n > 0) { localStorage.setItem("__refuse", String(n - 1)); return Promise.reject(new DOMException("refused", "NotAllowedError")); }
    // An iPhone can leave a try that came without a tap hanging: nothing on screen, no answer, until it is given up.
    if (localStorage.getItem("__hang")) {
      localStorage.removeItem("__hang");
      return new Promise((_, no) => { if (o.signal) o.signal.addEventListener("abort", () => { window.__gaveUp = (window.__gaveUp || 0) + 1; no(new DOMException("given up", "AbortError")); }); });
    }
    return realGet(o);
  };
}
"""
with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", args=["--autoplay-policy=no-user-gesture-required"])
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
    ctx.add_init_script(INIT)
    pg = ctx.new_page(); errs = []; reqs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("request", lambda r: reqs.append(r))
    cdp = ctx.new_cdp_session(pg); cdp.send("WebAuthn.enable")
    auth = cdp.send("WebAuthn.addVirtualAuthenticator", {"options": {"protocol": "ctap2", "transport": "internal", "hasResidentKey": True,
        "hasUserVerification": True, "isUserVerified": True, "automaticPresenceSimulation": True}})["authenticatorId"]
    locked = lambda: pg.evaluate("!document.getElementById('lock').hidden")
    api = lambda kind: [r for r in reqs if "/api/" + kind in r.url]

    # ---- 1. first open: passcode, and the sign-in answer carries the status
    pg.goto(BASE + "/"); pg.wait_for_selector("#lock:not([hidden])", timeout=5000)
    check("first open shows the lock", locked())
    check("no Face ID button before it is switched on", pg.evaluate("document.getElementById('faceid-unlock').hidden"))
    pg.fill("#passcode", "letmein"); pg.click("#passcode-go")
    pg.wait_for_selector("#suggestions .card", timeout=8000)
    check("passcode opens the app", not locked())
    check("ready told once", pg.evaluate("window.__ready") == 1, pg.evaluate("window.__ready"))
    st, out = call("/api/login", {"passcode": "letmein"})
    check("sign-in answer carries the status", st == 200 and out.get("status", {}).get("signedIn") is True and "reels" in out["status"], out.get("status"))
    token = out["token"]

    # ---- 2. opening when already signed in does not wait for /api/status
    urllib.request.urlopen(BASE + "/__slow?path=/api/status&ms=1600").read()
    reqs.clear(); t0 = time.time(); pg.reload()
    pg.wait_for_selector("#suggestions .card", timeout=6000); took = time.time() - t0
    check("today's quotes appear before the status answer (held 1.6 s)", took < 1.4, f"{took:.2f} s")
    pg.wait_for_timeout(2000)
    check("ready still told once after the status arrives", pg.evaluate("window.__ready") == 1, pg.evaluate("window.__ready"))
    check("still unlocked", not locked())
    urllib.request.urlopen(BASE + "/__slow?path=/api/status&ms=0").read()

    # ---- 3. switch the Face ID lock on
    pg.click("#settings-open"); pg.wait_for_timeout(500); pg.click("#faceid-toggle"); pg.wait_for_timeout(1500)
    check("lock switched on", bool(pg.evaluate("localStorage.getItem('entangledd.faceid.v1')")) and not pg.evaluate("localStorage.getItem('entangledd.token.v1')"))

    # ---- 4. open: Face ID asks by itself, one challenge, no storage for it
    ops(); reqs.clear(); t0 = time.time(); pg.reload()
    pg.wait_for_function("document.getElementById('lock').hidden && window.__ready >= 1", timeout=8000); took = time.time() - t0
    pg.wait_for_selector("#suggestions .card", timeout=8000)
    check("unlocks by itself, no tap", not locked(), f"{took:.2f} s")
    check("Face ID asked exactly once", pg.evaluate("window.__gets.length") == 1, pg.evaluate("window.__gets"))
    check("exactly one challenge and one sign-in request", len(api("passkey/challenge")) == 1 and len(api("passkey/login")) == 1,
          [len(api("passkey/challenge")), len(api("passkey/login"))])
    check("ready told once", pg.evaluate("window.__ready") == 1, pg.evaluate("window.__ready"))
    done = ops()
    auth_ops = [(o["op"], o["key"].split("-")[0].split("/")[-1] if o["key"].startswith("auth/") else o["key"]) for o in done if o["key"].startswith(("auth/", "secret/")) or "passkeys" in o["key"]]
    check("unlock touches storage three times (saved keys, used-check, used-mark), and never the seal's key while the server is warm",
          sorted(auth_ops) == [("get", "data/passkeys.json"), ("head", "used"), ("put", "used")], auth_ops)
    login_req = api("passkey/login")[0]; login_body = json.loads(login_req.post_data)
    check("token is not kept on the phone with the lock on", not pg.evaluate("localStorage.getItem('entangledd.token.v1')"))
    pg.screenshot(path=S + "a1_unlocked.png")

    # ---- 5. the same sign-in cannot be sent twice
    st, out = call("/api/passkey/login", login_body)
    check("a replayed Face ID sign-in is refused", st == 400 and "expired" in out.get("error", ""), (st, out))

    # ---- 6. a refused or cancelled automatic prompt: quiet, the button is there, no loop
    pg.evaluate("localStorage.setItem('__refuse', '2')")
    reqs.clear(); pg.reload(); pg.wait_for_timeout(2500)
    check("refused automatic prompt: still locked", locked())
    check("refused automatic prompt: no error shown", pg.evaluate("document.getElementById('lock-error').hidden"))
    check("refused automatic prompt: asked once, not in a loop", pg.evaluate("window.__gets.length") == 1, pg.evaluate("window.__gets"))
    check("the Face ID button is showing", pg.evaluate("!document.getElementById('faceid-unlock').hidden"))
    pg.screenshot(path=S + "a1_lock_after_refusal.png")
    check("after a refused try the next challenge is fetched ahead of the tap", len(api("passkey/challenge")) == 2, len(api("passkey/challenge")))
    # The server answers challenges slowly from here on: a tap must not have to wait for one.
    urllib.request.urlopen(BASE + "/__slow?path=/api/passkey/challenge&ms=1500").read()
    tapped = pg.evaluate("performance.now()")
    pg.click("#faceid-unlock"); pg.wait_for_timeout(700)
    gets = pg.evaluate("window.__gets")
    check("a tap goes to Face ID at once, without waiting for the server", len(gets) == 2 and gets[1] - tapped < 500, (tapped, gets))
    check("a tapped try that is cancelled says so", "cancelled" in pg.inner_text("#lock-error"), pg.inner_text("#lock-error"))
    urllib.request.urlopen(BASE + "/__slow?path=/api/passkey/challenge&ms=0").read()
    pg.wait_for_timeout(1500)
    check("and the next challenge is fetched ahead again", len(api("passkey/challenge")) == 3, len(api("passkey/challenge")))
    pg.click("#faceid-unlock"); pg.wait_for_function("document.getElementById('lock').hidden", timeout=6000)
    check("the next tap unlocks, with the challenge fetched ahead", not locked() and len(api("passkey/challenge")) == 3, len(api("passkey/challenge")))

    # ---- 6b. the app's own try is left hanging by the phone (no prompt, no answer): the button still works
    pg.evaluate("localStorage.setItem('__hang', '1')")
    reqs.clear(); pg.reload(); pg.wait_for_timeout(2500)
    check("hanging automatic try: still locked, nothing said", locked() and pg.evaluate("document.getElementById('lock-error').hidden"))
    check("hanging automatic try: asked once", pg.evaluate("window.__gets.length") == 1, pg.evaluate("window.__gets"))
    pg.evaluate("document.dispatchEvent(new Event('visibilitychange'))"); pg.wait_for_timeout(300)
    check("hanging automatic try: the app does not start another of its own on top", pg.evaluate("window.__gets.length") == 1, pg.evaluate("window.__gets"))
    pg.click("#faceid-unlock"); pg.wait_for_function("document.getElementById('lock').hidden", timeout=6000)
    pg.wait_for_selector("#suggestions .card", timeout=8000)
    check("hanging automatic try: a tap gives it up and unlocks with a fresh one", not locked() and pg.evaluate("window.__gets.length") == 2 and pg.evaluate("window.__gaveUp") == 1,
          (pg.evaluate("window.__gets"), pg.evaluate("window.__gaveUp")))
    check("hanging automatic try: ready told once, no error left showing", pg.evaluate("window.__ready") == 1 and pg.evaluate("document.getElementById('lock-error').hidden"), pg.evaluate("window.__ready"))

    # ---- 7. the device can't verify her (Face ID fails): quiet when the app asked by itself, said when she tapped
    cdp.send("WebAuthn.setUserVerified", {"authenticatorId": auth, "isUserVerified": False})
    pg.reload(); pg.wait_for_timeout(2500)
    check("unverified: still locked", locked())
    pg.click("#faceid-unlock"); pg.wait_for_timeout(1500)
    check("unverified: a tapped try explains itself", not pg.evaluate("document.getElementById('lock-error').hidden") and len(pg.inner_text("#lock-error")) > 10, pg.inner_text("#lock-error"))
    cdp.send("WebAuthn.setUserVerified", {"authenticatorId": auth, "isUserVerified": True})
    pg.fill("#passcode", "letmein"); pg.click("#passcode-go"); pg.wait_for_function("document.getElementById('lock').hidden", timeout=6000)
    check("passcode still works with the lock on, and is not kept on the phone", not locked() and not pg.evaluate("localStorage.getItem('entangledd.token.v1')"))

    # ---- 8. back after more than five minutes away: locked again, and Face ID asks by itself
    before = pg.evaluate("[window.__gets.length, window.__ready]")
    pg.evaluate("""() => { let hidden = true; const real = Date.now.bind(Date); let add = 0; Date.now = () => real() + add;
        Object.defineProperty(document, "hidden", { get: () => hidden, configurable: true });
        document.dispatchEvent(new Event("visibilitychange")); add = 6 * 60 * 1000; hidden = false;
        document.dispatchEvent(new Event("visibilitychange")); }""")
    pg.wait_for_function("document.getElementById('lock').hidden", timeout=6000); pg.wait_for_timeout(600)
    after = pg.evaluate("[window.__gets.length, window.__ready]")
    check("away 6 minutes: asked again by itself and unlocked", after[0] == before[0] + 1 and after[1] == before[1] + 1 and not locked(), (before, after))
    pg.evaluate("""() => { let hidden = true; Object.defineProperty(document, "hidden", { get: () => hidden, configurable: true });
        document.dispatchEvent(new Event("visibilitychange")); hidden = false; document.dispatchEvent(new Event("visibilitychange")); }""")
    pg.wait_for_timeout(500)
    check("a short trip away (to Instagram and back) does not ask again", pg.evaluate("window.__gets.length") == after[0] and not locked())
    key_id = pg.evaluate("localStorage.getItem('entangledd.faceid.v1')")
    call("/api/passkey/" + key_id, method="DELETE", token=token)
    pg.reload(); pg.wait_for_timeout(2500)
    check("key removed on the server: stays locked and says why, even though the app asked by itself",
          locked() and "recognised" in pg.inner_text("#lock-error"), pg.inner_text("#lock-error"))
    pg.screenshot(path=S + "a1_lock_refused_by_server.png")
    check("no script errors", not errs, errs)
    b.close()

# ---- 9. challenges straight at the server
origin = BASE
def client(ch, typ="webauthn.get", org=None):
    return b64u(json.dumps({"type": typ, "challenge": ch, "origin": org or origin}).encode())
body = lambda cd: {"credentialId": "nobody", "authenticatorData": b64u(b"\0" * 37), "clientDataJSON": cd, "signature": b64u(b"\0" * 8)}
ops()
st, ch = call("/api/passkey/challenge", {})
check("handing out a challenge uses no storage", st == 200 and ops() == [], ops(False))
c = ch["challenge"]
bad = ("A" if c[0] != "A" else "B") + c[1:]            # the first character: every bit of it counts (the last one carries two spare bits)
st, out = call("/api/passkey/login", body(client(bad)));               check("a tampered challenge is refused", st == 401 and "wasn't valid" in out["error"], (st, out))
st, out = call("/api/passkey/login", body(client(b64u(b"x" * 38))));  check("a made-up challenge is refused", st == 401, (st, out))
st, out = call("/api/passkey/login", body(client(c, org="https://evil.example"))); check("another site's origin is refused", st == 401, (st, out))
st, out = call("/api/passkey/login", body(client(c, typ="webauthn.create")));      check("the wrong kind of reply is refused", st == 401, (st, out))
st, out = call("/api/passkey/login", body("not-json"));                check("an unreadable reply is refused", st == 400, (st, out))
st, out = call("/api/passkey/login", body(client(c)));                 check("an unknown device is refused", st == 401 and "recognised" in out["error"], (st, out))
# (Agent 6) A reply that names no saved device writes nothing, so it doesn't spend its challenge either:
# nobody can make the server write to storage just by asking. A reply from a saved device does spend it.
ops()
st, out = call("/api/passkey/login", body(client(c)));                 check("an unknown device's reply writes nothing to storage", st == 401 and "recognised" in out["error"] and not [o for o in ops() if o["op"] == "put"], (st, out))
def save_device(name):
    req = urllib.request.Request(BASE + "/__doc?name=passkeys", data=json.dumps([{"id": name, "publicKey": "A" * 120, "label": "iPhone", "added": 1}]).encode(), method="PUT")
    urllib.request.urlopen(req).read()
known = lambda cd: {**body(cd), "credentialId": "a-saved-device"}
save_device("a-saved-device")
st, out = call("/api/passkey/login", known(client(c)));                check("a saved device with a signature that doesn't fit is refused", st == 401 and "couldn't be confirmed" in out["error"], (st, out))
st, out = call("/api/passkey/login", known(client(c)));                check("and that challenge is now spent", st == 400 and "expired" in out["error"], (st, out))
st, ch2 = call("/api/passkey/challenge", {})
urllib.request.urlopen(BASE + "/__clock?add=360000").read()
st, out = call("/api/passkey/login", body(client(ch2["challenge"])));  check("a challenge older than five minutes is refused", st == 400 and "expired" in out["error"], (st, out))

# ---- 10. the seal: made with the server's own random key, never with anything that follows from the passcode
import hashlib, hmac, threading
def forged(key):
    head = b"\x07" * 16 + int((time.time() + 100000) * 1000).to_bytes(6, "big")
    return b64u(head + hmac.new(key, head, hashlib.sha256).digest()[:16])
session = hmac.new(b"letmein", b"entangledd-session-v1", hashlib.sha256).hexdigest().encode()
for name, key in (("the passcode", b"letmein"), ("the earlier passcode-based key", b"passkey-challenge-v1:letmein"), ("the sign-in token", session), ("an empty key", b"")):
    st, out = call("/api/passkey/login", body(client(forged(key))))
    check("a challenge sealed with " + name + " is refused", st == 401 and "wasn't valid" in out["error"], (st, out))
with urllib.request.urlopen(BASE + "/__keys?prefix=secret/") as r: kept = json.loads(r.read())
check("the server keeps exactly one seal key of its own", kept == ["secret/challenge-seal"], kept)
st, out = call("/api/secret/challenge-seal");                         check("no address hands the seal key out", st in (401, 404), (st, out))
# a server that has not looked at its key for over an hour (as after a cold start) reads it once, and writes nothing
urllib.request.urlopen(BASE + "/__clock?add=3700000").read(); ops()
st, ch3 = call("/api/passkey/challenge", {}); cold = [(o["op"], o["key"]) for o in ops()]
check("after a cold start a challenge costs one read and no write", st == 200 and cold == [("get", "secret/challenge-seal")], cold)
st, ch4 = call("/api/passkey/challenge", {})
check("and the next one costs nothing again", st == 200 and ops() == [], ops(False))
st, out = call("/api/passkey/login", body(client(ch3["challenge"])))
check("a challenge made after the cold start passes the seal check", st == 401 and "recognised" in out["error"], (st, out))

# ---- 11. the very first two requests ever, at the same moment: both get challenges sealed with the same key
subprocess.run([f"{_W.HERE}/serve", "R2_DELAY=60"], check=True, stdout=subprocess.DEVNULL)
got = []
ts = [threading.Thread(target=lambda: got.append(call("/api/passkey/challenge", {}))) for _ in range(4)]
[t.start() for t in ts]; [t.join() for t in ts]
check("four first-ever challenges at once are all handed out", len(got) == 4 and all(g[0] == 200 for g in got), [g[0] for g in got])
res = [call("/api/passkey/login", body(client(g[1]["challenge"]))) for g in got if g[0] == 200]
check("and every one of them passes the seal check afterwards", all(st == 401 and "recognised" in out["error"] for st, out in res), res)

# ---- 12. the same reply sent four times in the same instant: only one of them gets past the one-time check
st, ch4 = call("/api/passkey/challenge", {})
same = []
save_device("a-saved-device")
ts = [threading.Thread(target=lambda: same.append(call("/api/passkey/login", known(client(ch4["challenge"]))))) for _ in range(4)]
[t.start() for t in ts]; [t.join() for t in ts]
past = [r for r in same if r[0] == 401 and "couldn't be confirmed" in r[1]["error"]]
spent = [r for r in same if r[0] == 400 and "expired" in r[1]["error"]]
check("four copies of one reply at the same instant: exactly one gets past the one-time check", len(past) == 1 and len(spent) == 3, same)

subprocess.run([f"{_W.HERE}/stop"], stdout=subprocess.DEVNULL)
print("FAIL: " + ", ".join(fails) if fails else "PASS")
sys.exit(1 if fails else 0)

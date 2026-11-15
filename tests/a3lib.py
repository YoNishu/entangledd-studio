"""Shared helpers for Agent 3's checks (health section). Every test starts a fresh local server."""
import where as _W
import json, subprocess, sys, time, urllib.request, urllib.error, urllib.parse

PORT = _W.PORT
B = f"http://localhost:{PORT}"
DAY = 24 * 60 * 60 * 1000
SECRETS = ["LONG-user-token", "PAGE-token", "dev-token", "dev-key", "dev-secret", "dev-render-secret", "letmein", "ov-secret", "ov-token"]

fails = []
def check(name, ok, detail=""):
    print(("  ok   " if ok else "  FAIL ") + name + (f"   [{detail}]" if detail and not ok else ""))
    if not ok: fails.append(name)
    return ok
def finish():
    print()
    if fails:
        print(f"FAIL ({len(fails)}): " + "; ".join(fails)); sys.exit(1)
    print("PASS"); sys.exit(0)

def serve(*settings):
    out = subprocess.run([f"{_W.HERE}/serve", *settings], capture_output=True, text=True).stdout
    if "DID NOT START" in out: print(out); sys.exit(2)

def http(method, path, body=None, token=None, headers=None, raw=False):
    """Returns (status, parsed JSON or text, headers)."""
    data = None
    h = dict(headers or {})
    if body is not None:
        data = body if isinstance(body, (bytes, bytearray)) else json.dumps(body).encode()
        h.setdefault("Content-Type", "application/json")
    if token: h["Authorization"] = "Bearer " + token
    req = urllib.request.Request(B + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=60) as r: status, text, hd = r.status, r.read().decode(), dict(r.headers)
    except urllib.error.HTTPError as e: status, text, hd = e.code, e.read().decode(), dict(e.headers)
    if raw: return status, text, hd
    try: return status, json.loads(text) if text else None, hd
    except ValueError: return status, text, hd

def login():
    s, b, _ = http("POST", "/api/login", {"passcode": "letmein"})
    assert s == 200, b
    return b["token"]
def connect(token):
    s, b, _ = http("POST", "/api/instagram/connect", {"token": "SHORT-" + "0123456789" * 6}, token)
    assert s == 200 and b["connected"], b
    return b

def hset(**kw):
    return http("GET", "/__health_set?" + urllib.parse.urlencode({k: ("null" if v is None else v) for k, v in kw.items()}))[1]
def hlog(): return http("GET", "/__health_log")[1]
def glog(): return http("GET", "/__graph_log")[1]
def doc(name):
    s, b, _ = http("GET", "/__doc?name=" + urllib.parse.quote(name))
    return b if s == 200 else None
def putdoc(name, obj): http("PUT", "/__doc?name=" + urllib.parse.quote(name), obj)
def deldoc(name): http("DELETE", "/__doc?name=" + urllib.parse.quote(name))
def cron(which=None): http("GET", "/__cron" + ("?cron=" + urllib.parse.quote(which) if which else ""))

def tick_job(name):
    """Runs the five-minute timer until the named job has had its turn (one job runs per tick)."""
    for _ in range(8):
        before = (doc("jobstamps") or {}).get(name, 0)
        cron()
        if (doc("jobstamps") or {}).get(name, 0) != before: return True
    return False
def make_due(*names):
    stamps = doc("jobstamps") or {}
    for n in names: stamps[n] = 0
    putdoc("jobstamps", stamps)

def check_now(token):
    """A check through POST /api/checkup, stepping around its once-a-minute limit the way time would."""
    rec = doc("health")
    if rec: rec["asOf"] -= 120000; putdoc("health", rec)
    s, b, _ = http("POST", "/api/checkup", token=token)
    assert s == 200, (s, b)
    return {i["id"]: i for i in b["items"]}, b

def no_secrets(text):
    return [s for s in SECRETS if s in text]
now_ms = lambda: int(time.time() * 1000)

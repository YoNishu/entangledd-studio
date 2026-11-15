"""Shared helpers for Agent 5's tests (little notes from Nishiii)."""
import where as _W
import json, subprocess, sys, urllib.error, urllib.request

PORT = _W.PORT
B = f"http://localhost:{PORT}"
SHOTS = f"{_W.OUT}/shots/"
REPO = f"{_W.ROOT}"

_results = []

def ok(cond, label, detail=""):
    _results.append(bool(cond))
    print(("  ok   " if cond else "  FAIL ") + label + (f"  [{detail}]" if detail and not cond else ""))
    return bool(cond)

def finish(name):
    bad = _results.count(False)
    print(f"{name}: {len(_results) - bad} checks passed, {bad} failed")
    print("PASS" if not bad else "FAIL")
    sys.exit(0 if not bad else 1)

def serve(*settings):
    """Fresh server, fresh empty storage, the code as it is now."""
    out = subprocess.run([f"{_W.HERE}/serve", *settings], capture_output=True, text=True)
    if out.returncode != 0 or "DID NOT START" in out.stdout:
        print(out.stdout, out.stderr); print("FAIL"); sys.exit(1)

def raw(method, path, data=None, token=None, body=None):
    """→ (status, text). data is sent as JSON; body as it is."""
    payload = body if body is not None else (json.dumps(data).encode() if data is not None else None)
    headers = {"Content-Type": "application/json"}
    if token: headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(B + path, method=method, data=payload, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

def call(method, path, data=None, token=None):
    """→ (status, parsed JSON or None)."""
    status, text = raw(method, path, data, token)
    try: return status, json.loads(text) if text else None
    except ValueError: return status, None

def login():
    return call("POST", "/api/login", {"passcode": "letmein"})[1]["token"]

def add(token, text, date=None):
    status, out = call("POST", "/api/lovenotes", {"text": text, **({"date": date} if date else {})}, token)
    assert status == 200, (status, out)
    return out["note"]["id"]

def day(d):
    """Makes the pretend server believe it is noon in India on that day ("" = the real time)."""
    raw("GET", "/__notes_day" + (f"?day={d}" if d else ""))

def nxt(token, today=None):
    status, out = call("GET", "/api/lovenotes/next" + (f"?today={today}" if today is not None else ""), token=token)
    return status, out

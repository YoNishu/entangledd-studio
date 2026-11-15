"""Helpers for Agent 6's checks (upkeep, probes, the ceiling on Claude). Built on a3lib; every test starts a fresh server."""
import datetime, urllib.parse, uuid
from a3lib import *

HOUR = 60 * 60 * 1000

def put_raw(key, data=b"x", hours=0):
    """Stores a file under any key, as if it had been saved that many hours ago."""
    http("PUT", f"/__upkeep_put?key={urllib.parse.quote(key)}&hours={hours}", data if isinstance(data, (bytes, bytearray)) else data.encode())
def get_raw(key):
    s, b, _ = http("GET", "/__upkeep_get?key=" + urllib.parse.quote(key), raw=True)
    return b if s == 200 else None
def age(prefix, hours): return http("GET", f"/__upkeep_age?prefix={urllib.parse.quote(prefix)}&hours={hours}")[1]
def keys(prefix=""): return http("GET", "/__keys?prefix=" + urllib.parse.quote(prefix))[1]
def ops(reset=False): return http("GET", "/__health_ops" + ("?reset=1" if reset else ""))[1]

def india_day(offset=0):
    """Today's date in India (or so many days away from it), as YYYY-MM-DD."""
    now = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=5, minutes=30) + datetime.timedelta(days=offset)
    return now.strftime("%Y-%m-%d")
def set_day(day=None):
    """Makes the pretend server believe it is noon in India on that day (None: back to the real time)."""
    return http("GET", "/__notes_day" + (f"?day={day}" if day else ""))[1]

def settle():
    """Runs the five-minute timer until every timed job has had its first turn."""
    for _ in range(20):
        before = doc("jobstamps") or {}
        cron()
        if (doc("jobstamps") or {}) == before: return
    raise AssertionError("the timed jobs never settled")
def run_only(name):
    """One tick of the timer in which only the named job is due. Returns what that tick cost (storage and outside calls)."""
    stamps = doc("jobstamps") or {}
    assert name in stamps, f"no timed job called {name} has run yet: {sorted(stamps)}"
    now = http("GET", "/__upkeep_now")[1]["now"]          # the server's own idea of the time (a test may have moved it)
    stamps = {k: now for k in stamps}
    stamps[name] = 0
    putdoc("jobstamps", stamps)
    ops(reset=True)
    cron()
    cost = ops()
    assert (doc("jobstamps") or {}).get(name, 0) > 0, f"{name} did not run"
    return cost
def part_now(token, part):
    """One group of probes through POST /api/checkup?part=..., stepping around the once-a-minute limit the way time would."""
    rec = doc("health")
    if rec and rec.get("probed", {}).get(part):
        rec["probed"][part] -= 120000; putdoc("health", rec)
    s, b, _ = http("POST", "/api/checkup?part=" + part, token=token)
    assert s == 200, (s, b)
    return {i["id"]: i for i in b["items"]}, b
def new_id(): return str(uuid.uuid4())

def fetch(method, path, token=None, headers=None, body=None):
    """Like http(), for answers that are not text: returns (status, bytes, headers with lower-case names)."""
    h = dict(headers or {})
    if token: h["Authorization"] = "Bearer " + token
    req = urllib.request.Request(B + path, data=body, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=60) as r: return r.status, r.read(), {k.lower(): v for k, v in r.headers.items()}
    except urllib.error.HTTPError as e: return e.code, e.read(), {k.lower(): v for k, v in e.headers.items()}

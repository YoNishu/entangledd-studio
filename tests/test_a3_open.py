"""The open address /api/health: tells little, leaks nothing, never calls outside; and the signed-in checkup's limits.
Run: python3 tests/test_a3_open.py   (starts its own fresh servers on port its own port)"""
import where as _W
import subprocess
from a3lib import *

print("Before any check has run")
serve()
s, b, h = http("GET", "/api/health")
check("answers without sign-in", s == 200)
check("says plainly that nothing has been checked, and flags it", b["needsAttention"] is True and b["asOf"] is None and b["items"] == [] and "No check has run yet" in b["message"], b)
s, _, _ = http("GET", "/api/checkup"); check("the full record needs sign-in (GET)", s == 401, s)
s, _, _ = http("POST", "/api/checkup"); check("checking now needs sign-in (POST)", s == 401, s)
s, _, _ = http("POST", "/api/health"); check("the open address is read-only", s == 404, s)
s, _, _ = http("GET", "/api/health/extra"); check("no hidden corners under it", s == 404, s)

print("All is well")
t = login(); connect(t)
tick_job("instagram-renew"); tick_job("health-check")
s, b, h = http("GET", "/api/health")
check("needsAttention is false and the message says so", b["needsAttention"] is False and b["message"] == "Everything is working.", b)
check("only the agreed top-level fields", sorted(b) == ["ageHours", "app", "asOf", "counts", "items", "message", "needsAttention", "notes"], sorted(b))
check("per line only id, state, daysLeft, checked", all(sorted(i) == ["checked", "daysLeft", "id", "state"] for i in b["items"]) and len(b["items"]) == 17, b["items"][:1])      # seven lines of keys, ten probes (Agent 6)
check("a short public cache life", "max-age=300" in (h.get("cache-control") or h.get("Cache-Control") or ""), h)
check("the full record for the same moment has seven titled lines", len(http("GET", "/api/checkup", token=t)[1]["items"]) == 7)

print("It never calls an outside service")
n_health, n_graph = len(hlog()), len(glog())
for _ in range(25): http("GET", "/api/health")
check("25 reads later: not one outside call", len(hlog()) == n_health and len(glog()) == n_graph, (len(hlog()) - n_health, len(glog()) - n_graph))

print("Several things wrong at once: says so, still leaks nothing")
hset(githubEnds=9, pixabay="400", userDays=12, exchange="refuse", claudeAsk="credit")
ig = doc("instagram"); ig["userTokenExpires"] = now_ms() + 12 * DAY; putdoc("instagram", ig)
notes = {"reel": {"okAt": now_ms() - DAY, "failAt": now_ms() - 60000, "startedAt": now_ms() - 90000, "fails": 3,
                  "why": "ffmpeg exploded reading /tmp/job-17890/bg.mp4 for theentangledd"}}
putdoc("healthnotes", notes)
http("POST", "/api/check", {"text": "the sea keeps no calendar", "author": ""}, t)       # a real question, refused for lack of credit
items, full = check_now(t)
s, b, _ = http("GET", "/api/health")
raw = http("GET", "/api/health", raw=True)[1]
states = {i["id"]: i["state"] for i in b["items"]}
check("needsAttention is true", b["needsAttention"] is True, b)
check("the states are right", states["github"] == "soon" and states["backgrounds"] == "attention" and states["instagram"] == "soon"
      and states["reels"] == "attention" and states["nishiii"] == "attention", states)
check("day counts are given where they exist", {i["id"]: i["daysLeft"] for i in b["items"]}["github"] in (8, 9), b["items"])
check("the message counts and names them in plain words", b["message"].startswith("5 things need attention.") and "Reel maker's key: the key that starts reels runs out in" in b["message"]
      and "out of credit" in b["message"], b["message"])
private = ["theentangledd", "Entangledd\"", "17890", "local/dev", "ffmpeg", "/tmp/", "@", "111", "developers.facebook.com", "Cloudflare", "Session has expired", "Nishith", "Dhruuu"]
found = [p for p in private if p in raw] + no_secrets(raw)
check("no names, ids, addresses, steps, raw errors or keys in the open answer", not found, found)
check("the signed-in record does carry the detail and the steps", "ffmpeg exploded" in items["reels"]["line"] and len(items["github"]["fix"]) == 3)
check("the open answer stays small", len(raw) < 3500, len(raw))      # seventeen lines now

print("A record gone stale means the timers stopped")
rec = doc("health"); rec["asOf"] -= 3 * DAY; putdoc("health", rec)
s, b, _ = http("GET", "/api/health")
check("flagged, with how long ago", b["needsAttention"] is True and "timers may have stopped" in b["message"] and 70 <= b["ageHours"] <= 74, b)
check("three days old is called 3 days", "last ran 3 days ago" in b["message"], b["message"])
rec = doc("health"); rec["asOf"] += 3 * DAY - 40 * 3600 * 1000; putdoc("health", rec)
s, b, _ = http("GET", "/api/health")
check("forty hours old is flagged and called 40 hours, not 2 days", b["needsAttention"] is True and "last ran 40 hours ago" in b["message"], b["message"])
rec = doc("health"); rec["asOf"] += 40 * 3600 * 1000 - 30 * 3600 * 1000; putdoc("health", rec)
s, b, _ = http("GET", "/api/health")
check("thirty hours old is not called stale", "last ran" not in b["message"], b["message"])
rec = doc("health"); rec["asOf"] -= 3 * DAY - 30 * 3600 * 1000; putdoc("health", rec)
hset(githubEnds="", pixabay="ok", userDays=None, exchange="extend", claudeAsk="")
deldoc("healthnotes"); ig = doc("instagram"); ig["userTokenExpires"] = now_ms() + 60 * DAY; putdoc("instagram", ig)
check_now(t)
rec = doc("health"); rec["asOf"] -= 3 * DAY; putdoc("health", rec)
s, b, _ = http("GET", "/api/health")
check("stale but nothing else wrong: still flagged", b["needsAttention"] is True and "last known state" in b["message"], b)
rec["asOf"] = now_ms() - 30 * 3600000; putdoc("health", rec)
check("30 hours old is still fine (the check is daily)", http("GET", "/api/health")[1]["needsAttention"] is False)

print("Checking now is limited to once a minute")
deldoc("health")
s1, b1, _ = http("POST", "/api/checkup", token=t)
calls = len(hlog())
s2, b2, _ = http("POST", "/api/checkup", token=t)
check("first check runs", s1 == 200 and len(b1["items"]) == 7)
check("second within the minute is turned away, in plain words", s2 == 429 and b2["error"] == "Checked a moment ago. Try again in a minute.", (s2, b2))
check("and it made no outside call", len(hlog()) == calls)

print("One whole check stays within its allowance")
deldoc("health"); before = len(hlog()); http("POST", "/api/checkup", token=t)
outside = len(hlog()) - before
check(f"outside calls in one check: {outside} (allowance: about 20 with storage, which is 7 to 9 more)", outside <= 8, outside)

http("GET", "/__health_reset")
subprocess.run([f"{_W.HERE}/stop"], capture_output=True)
finish()

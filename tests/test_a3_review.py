"""What a reviewer would try against the health section:
  - whatever Meta answers to a renewal, a working sign-in is never lost, and keeps working;
  - no key or token in any answer, in the stored records, or in the server's log, even when a service repeats one back;
  - records that are damaged or the wrong shape can't trip the open address or stop the checks for good;
  - timers that never start are raised;
  - the open address answers odd requests without spending anything.
Run: python3 tests/test_a3_review.py   (starts its own fresh servers on its own port)"""
import where as _W
import json, subprocess
from a3lib import *

USER, PAGE = "LONG-user-token-0123456789", "PAGE-token-0123456789"
LOG = f"{_W.OUT}/dev.log"
KEYS = ["LONG-user-token", "PAGE-token", "dev-token", "dev-key", "dev-secret", "dev-render-secret", "ov-secret", "ov-token", "MALFORMED-"]
def log_text(): return open(LOG).read()
def keys_in(text): return [k for k in KEYS if k in text]
def ops(reset=False): return http("GET", "/__health_ops" + ("?reset=1" if reset else ""))[1]
def fresh(*settings, **mode):
    serve(*settings); t = login(); connect(t)
    if mode: hset(**mode)
    return t
def set_ig(**changes):
    ig = doc("instagram"); ig.update(changes); putdoc("instagram", ig)
def put_raw(name, text): http("PUT", "/__doc?name=" + name, text.encode())

print("A. Whatever Meta answers to a renewal, the working sign-in stays and keeps working")
logs = ""
for how, want in [("refuse", "Meta no longer accepts the current sign-in."), ("same", "Meta gave the same end date as before."),
                  ("invalid", "Meta's new sign-in didn't pass Meta's own check."), ("busy", "Instagram said: An unknown error occurred"),
                  ("empty", "Meta sent nothing back."), ("echo", "Instagram said: Invalid parameter: fb_exchange_token [hidden] was not accepted"),
                  ("person", "Meta's new sign-in is for a different person."), ("fewer", "Meta's new sign-in has fewer permissions than the current one."),
                  ("sooner", "Meta's new sign-in would end sooner than the current one.")]:
    t = fresh(userDays=20, exchange=how); set_ig(userTokenExpires=now_ms() + 20 * DAY)
    ran = tick_job("instagram-renew"); ig = doc("instagram")
    asked = sum(1 for c in hlog() if c["path"].endswith("/oauth/access_token")) == 2          # once to connect, once to renew
    s, music, _ = http("GET", "/api/instagram/audio?q=", token=t)
    s2, posts, _ = http("GET", "/api/posts", token=t)
    items, full = check_now(t); line = items["instagram"]["line"]
    ok = (ran and asked and ig["userToken"] == USER and ig["pageToken"] == PAGE and not ig.get("renewedAt") and ig.get("renewNote") == want
          and s == 200 and len(music["items"]) == 3 and s2 == 200
          and items["instagram"]["state"] == "soon" and f"The app tried to renew it itself: {want}" in line and len(items["instagram"]["fix"]) == 3)
    check(f"{how}: old sign-in kept and still working; the reason is noted and shown", ok, (ig["userToken"][:20], ig.get("renewNote"), s, s2, items["instagram"]["state"], line))
    blob = json.dumps(full) + http("GET", "/api/health", raw=True)[1] + json.dumps(doc("health")) + json.dumps(ig.get("renewNote"))
    check(f"{how}: no key in the note, the record or either answer", not keys_in(blob), keys_in(blob))
    logs += log_text()
check("and through all nine, nothing key-shaped reached the server's log", not keys_in(logs), keys_in(logs))
check("(the log did record Meta's refusals, cleaned)", "Graph error 400 100" in logs and "fb_exchange_token [hidden] was not accepted" in logs, logs[-400:])

print("B. A service that repeats a key back: it reaches no answer and no log")
t = fresh()
pasted = "MALFORMED-" + "Ab3dE6gH9" * 8
s, b, _ = http("POST", "/api/instagram/connect", {"token": pasted}, t)
check("a wrongly pasted token: plain words, and the token is not sent back", s == 400 and b["error"].startswith("Meta didn't accept that token.") and pasted[:20] not in json.dumps(b), (s, b))
check("the connection she had is untouched", doc("instagram")["userToken"] == USER and doc("instagram")["pageToken"] == PAGE)
hset(graphEcho="yes")
s, b, _ = http("GET", "/api/instagram/audio?q=tide", token=t)
check("Meta repeating the sign-in in a refusal: passed on with the token cut out", s == 502 and b["error"] == "Instagram said: Unsupported get request with access token [hidden]", (s, b))
hset(graphEcho="", github="busy", pixabay="busy", graphBusy="yes", claudeKey="401", exchange="echo", userDays=20); set_ig(userTokenExpires=now_ms() + 20 * DAY)
items, full = check_now(t)                                             # a check and a renewal in which nearly everything goes wrong
http("POST", "/api/check", {"text": "the sea keeps no calendar", "author": ""}, t)
putdoc("healthnotes", {}); http("POST", "/api/render/00000000-0000-4000-8000-000000000000/status", {"state": "failed", "error": "x"}, "dev-render-secret")
log = log_text()
check("the log has the failures", "Graph error" in log and "couldn't run" in log, log[-300:])
check("and not one key, token or pasted value", not keys_in(log) and "Ab3dE6gH9" not in log, keys_in(log))
answers = "".join(http("GET", p, token=t, raw=True)[1] for p in ["/api/checkup", "/api/health", "/api/instagram", "/api/status"])
check("nor do the answers", not keys_in(answers) and "Ab3dE6gH9" not in answers, keys_in(answers))
stored = json.dumps(doc("health")) + json.dumps(doc("healthnotes")) + json.dumps({k: v for k, v in doc("instagram").items() if k not in ("userToken", "pageToken")})
check("nor the stored records (the connection itself keeps its two tokens, as it must)", not keys_in(stored), keys_in(stored))

print("C. A reel that fails with a key in its error: the note is cleaned")
t = fresh()
putdoc("healthnotes", {"reel": {"startedAt": now_ms() - 60000}})
bg = open(f"{_W.MEDIA}/sky.jpg", "rb").read()
s, j, _ = http("POST", "/api/jobs", {"length": 6, "bgSize": len(bg), "bgName": "sky.jpg"}, t)
s, b, _ = http("POST", f"/api/render/{j['id']}/status", {"state": "failed", "error": "curl: (22) 401 for Authorization: Bearer dev-render-secret at https://x.example/api/render/abc?sig=0123456789abcdef0123456789abcdef"}, "dev-render-secret")
note = (doc("healthnotes") or {}).get("reel", {})
check("the failure was noted", s == 200 and note.get("fails") == 1, (s, b, note))
check("without the secret or the signed link", "dev-render-secret" not in note.get("why", "x") and "0123456789abcdef0123" not in note["why"] and "[hidden]" in note["why"], note.get("why"))
items, full = check_now(t)
check("and so is what Settings shows", "dev-render-secret" not in json.dumps(full) and "curl: (22) 401" in items["reels"]["line"], items["reels"]["line"])

print("D. Records that are damaged or the wrong shape")
t = fresh()
for label, raw in [("not JSON at all", "{not json"), ("a list", "[]"), ("a number", "7"), ("the wrong fields", '{"asOf": "yesterday", "items": "none"}')]:
    put_raw("health", raw)
    s, b, _ = http("GET", "/api/health")
    s2, b2, _ = http("GET", "/api/checkup", token=t)
    check(f"{label}: the open address still answers, flagged as never checked", s == 200 and b["needsAttention"] is True and b["items"] == [] and "No check has run yet" in b["message"], (s, b))
    check(f"{label}: so does Settings", s2 == 200 and b2 == {"asOf": 0, "items": [], "summary": "Not checked yet."}, (s2, b2))
put_raw("health", "{not json")
check("the daily check still has its turn", tick_job("health-check"))
rec = doc("health")
check("and writes a whole new record over the damage", isinstance(rec, dict) and len(rec.get("items", [])) == 7 and all(i["state"] in ("ok", "unknown") for i in rec["items"]), rec)
odd = {"asOf": now_ms(), "seenScopes": "nope", "missedMornings": "x", "items": [None, 7, "text",
       {"id": "evil", "state": "attention", "title": "<b>x</b>", "brief": "token " + USER, "line": "x"},
       {"id": "github", "state": "weird", "checked": "soon", "daysLeft": "many", "title": "t", "line": "l"},
       {"id": "music", "state": "soon", "checked": now_ms(), "daysLeft": 4, "title": "Mine", "brief": "", "line": "l"}]}
putdoc("health", odd)
s, b, _ = http("GET", "/api/health"); raw = http("GET", "/api/health", raw=True)[1]
# (Agent 6: the open address now always lists every line it should have; one the record has nothing usable for is "unknown".)
known = {i["id"]: i for i in b["items"]}
check("odd entries: the open address answers, with only the lines it knows", s == 200 and len(b["items"]) == 18 and "evil" not in known
      and [k for k, v in known.items() if v["state"] != "unknown"] == ["music"], (s, b))
check("a state it doesn't know is shown as unknown; odd dates and counts as nothing", known["github"] == {"id": "github", "state": "unknown", "daysLeft": None, "checked": None}, known["github"])
check("titles come from the app, never from the record", b["message"] == "1 thing needs attention. Free music: needs attention soon." and "Mine" not in raw and "evil" not in raw and not keys_in(raw), b["message"])
s, b, _ = http("GET", "/api/checkup", token=t)
check("Settings shows the same two, without failing", s == 200 and [i["id"] for i in b["items"]] == ["github", "music"], (s, b))
odd["asOf"] -= 120000; putdoc("health", odd)
s, b, _ = http("POST", "/api/checkup", token=t)
check("Check now works on top of it and puts everything right", s == 200 and len(b["items"]) == 7 and b["summary"] == "Everything is working.", (s, b))
check("the list of permissions seen starts again as a list", isinstance(doc("health")["seenScopes"], list) and "instagram_content_publish" in doc("health")["seenScopes"], doc("health").get("seenScopes"))
put_raw("healthnotes", '"oops')
s, b, _ = http("POST", "/api/check", {"text": "the sea keeps no calendar", "author": ""}, t)
check("damaged notes don't get in Nishiii's way", s == 200, (s, b))
hset(claudeAsk="credit"); http("POST", "/api/check", {"text": "again", "author": ""}, t)
check("and the next thing worth noting is written over them", (doc("healthnotes") or {}).get("claude", {}).get("kind") == "credit", doc("healthnotes"))
put_raw("healthnotes", "[1, 2]"); hset(claudeAsk="")
items, _ = check_now(t)
check("notes of the wrong shape: the check runs as if there were none", items["nishiii"]["state"] == "ok" and items["reels"]["state"] == "ok", (items["nishiii"], items["reels"]))

print("E. Timers that never start")
serve(); t = login()
items, _ = check_now(t)
check("first look: not an alarm, they start within five minutes", items["timers"]["state"] == "unknown", items["timers"])
check("the open address does not flag that line", http("GET", "/api/health")[1]["needsAttention"] is False)
rec = doc("health")
for i in rec["items"]:
    if i["id"] == "timers": i["unknownSince"] = now_ms() - 2 * 3600000
putdoc("health", rec)
items, _ = check_now(t)
check("still nothing two hours on: raised, with the steps", items["timers"]["state"] == "attention" and "haven't run at all" in items["timers"]["line"] and len(items["timers"]["fix"]) == 2, items["timers"])
b = http("GET", "/api/health")[1]
check("and the open address says so", b["needsAttention"] is True and "Daily routines: the app's timers have never run" in b["message"], b)
items, _ = check_now(t)
check("it stays raised on the next look (it doesn't forget since when)", items["timers"]["state"] == "attention", items["timers"])
cron()
items, _ = check_now(t)
check("once a timer has run, the line is fine again", items["timers"]["state"] == "ok", items["timers"])

print("F. The open address and odd requests")
t = fresh(); tick_job("health-check")
want = http("GET", "/api/health")[1]
for label, method, path, headers in [("a made-up sign-in", "GET", "/api/health", {"Authorization": "Bearer nonsense"}), ("a query string", "GET", "/api/health?check=now&refresh=1", None),
                                     ("a trailing slash", "GET", "/api/health/", None)]:
    ops(reset=True); s, b, _ = http(method, path, headers=headers); o = ops()
    check(f"{label}: the same answer, for two reads and nothing else", s == 200 and b == want and sorted(o["what"]) == ["get data/health.json", "get data/lookups.json"], (s, o["what"]))
for method, path in [("POST", "/api/health"), ("PUT", "/api/health"), ("DELETE", "/api/health"), ("GET", "/api/health/check"), ("GET", "/api/health/../checkup"), ("POST", "/api/health/checkup")]:
    ops(reset=True); s, b, _ = http(method, path, body={} if method in ("POST", "PUT") else None); o = ops()
    check(f"{method} {path}: turned away, nothing read, nothing called", s in (401, 404) and o["storage"] == 0 and o["outside"] == 0 and "items" not in json.dumps(b), (s, o["what"]))
check("the record was not changed by any of it", http("GET", "/api/health")[1] == want)

http("GET", "/__health_reset")
subprocess.run([f"{_W.HERE}/stop"], capture_output=True)
finish()

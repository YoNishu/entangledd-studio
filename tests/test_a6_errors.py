"""A short record of problems: the last 30 things that went wrong, with nothing private in it, written at most
once a minute, and counted in the health record."""
import where as _W
import json
from a6lib import *

serve()
T = login()
PRIVATE = "hello private words 55123"

def errors(): return (doc("errors") or {"list": []})["list"]
def rewind():                                                   # as if the last write was two minutes ago
    d = doc("errors"); d["writtenAt"] -= 120000; putdoc("errors", d)

s, b, _ = http("GET", "/api/library", token=T)
check("a healthy request leaves no record", s == 200 and doc("errors") is None)
s, b, _ = http("POST", "/api/library/quotes", {"text": ""}, T)
check("her own slip (nothing typed) is not a problem of the app", s == 400 and doc("errors") is None, s)

# The library document becomes unreadable: the server's error quotes what it found there.
put_raw("data/library.json", PRIVATE)
s, b, _ = http("GET", "/api/library", token=T)
check("a broken document gives the plain 'our side' answer", s == 500 and "our side" in b["error"], (s, b))
got = errors()
check("the problem is written down at once", len(got) == 1, got)
check("with the path", got and got[0]["where"] == "GET /api/library", got)
check("with a short description", got and "SyntaxError" in got[0]["what"] and len(got[0]["what"]) <= 140, got)
check("and none of the document's own words", PRIVATE not in json.dumps(got) and "private" not in json.dumps(got) and "55123" not in json.dumps(got), got)

for _ in range(3): http("GET", "/api/library", token=T)
check("more problems in the same minute are not written yet", len(errors()) == 1, len(errors()))
rewind()
http("POST", "/api/library/quotes?x=" + PRIVATE.replace(" ", "+"), {"text": "a line"}, T)
got = errors()
check("the next write, a minute later, brings the waiting ones along", len(got) == 5, len(got))
check("a path never carries what came after the question mark", got[-1]["where"] == "POST /api/library/quotes", got[-1])
http("DELETE", "/__doc?name=library")

# Ids are taken out of paths.
put_raw("data/posts.json", "not json at all"); connect(T); rewind()
pid = new_id()
s, b, _ = http("GET", f"/api/posts/{pid}/comments/17900000000000001", token=T)
got = errors()
check("ids in a path are replaced", s == 500 and got[-1]["where"] == "GET /api/posts/:id/comments/:id" and pid not in json.dumps(got), got[-1])
http("DELETE", "/__doc?name=posts")

# An outside service failing is recorded too, in the app's own words.
hset(pixabay="busy"); rewind()
s, b, _ = http("GET", "/api/stock?kind=photo&q=fog", token=T)
got = errors()
check("an outside service that fails is on record", s == 502 and got[-1]["where"] == "GET /api/stock" and "Pixabay" in got[-1]["what"], (s, got[-1]))
hset(pixabay="ok")

# A key-shaped string in an error never reaches the record.
hset(graphEcho="yes"); rewind()
s, b, _ = http("GET", "/api/instagram/audio?q=x", token=T)
got = errors()
check("an outside service's words that repeat a key are cut", s == 502 and not no_secrets(json.dumps(got)) and "[hidden]" in got[-1]["what"], got[-1])
hset(graphEcho="")

# A timed job that fails.
settle(); put_raw("data/backupstate.json", "{{{"); rewind()
run_only("upkeep-backup")
got = errors()
check("a timed job that fails is on record by name", got[-1]["where"] == "timed job upkeep-backup", got[-1])
http("DELETE", "/__doc?name=backupstate")

# The morning pass.
put_raw("data/history.json", "{{{"); rewind()
cron("30 0 * * *")
got = errors()
check("a step of the morning pass that fails is on record", any(e["where"].startswith("the morning's") for e in got[-3:]), got[-3:])
http("DELETE", "/__doc?name=history")

# From the app on her phone.
s, b, _ = http("POST", "/api/oops", {"what": "x", "where": "y"})
check("reporting from the app needs sign-in", s == 401, s)
rewind()
s, b, _ = http("POST", "/api/oops", {"what": 'TypeError: undefined is not an object (evaluating "' + PRIVATE + '")', "where": f"{_W.URL}/studio.js:1204"}, T)
got = errors()
check("a script failure on her phone is on record", s == 200 and got[-1]["where"] == "in the app, studio.js:1204" and "TypeError" in got[-1]["what"], got[-1])
check("without the words it quoted", PRIVATE not in json.dumps(got), got[-1])

# Only the last 30 are kept.
now = now_ms()
putdoc("errors", {"list": [{"at": now - 1000 * i, "where": f"GET /api/old{i}", "what": "x"} for i in range(40, 0, -1)], "writtenAt": now - 120000})
http("POST", "/api/oops", {"what": "one more", "where": "app.js:1"}, T)
got = errors()
check("only the last 30 are kept", len(got) == 30 and got[-1]["what"] == "one more" and got[0]["where"] == "GET /api/old29", (len(got), got[0]))

# The health record counts them.
items, full = part_now(T, "page")
check("thirty problems in a day are flagged", items["errors"]["state"] == "soon" and "30 problems in the last day" in items["errors"]["line"], items["errors"])
check("signed in, the latest one can be read", "app.js:1" in items["errors"]["line"] and "one more" in items["errors"]["line"], items["errors"]["line"])
s, pub, _ = http("GET", "/api/health")
check("the open record gives the count", pub["counts"]["problemsLastDay"] == 30 and pub["needsAttention"] and "Problems noticed: 30 problems in the last day" in pub["message"], pub)
check("but never the problems themselves", "one more" not in json.dumps(pub) and "app.js" not in json.dumps(pub) and "/api/old" not in json.dumps(pub))
putdoc("errors", {"list": [{"at": now - 1000, "where": "GET /api/library", "what": "x"}, {"at": now - 30 * 3600 * 1000, "where": "GET /api/old", "what": "y"}], "writtenAt": now})
items, _ = part_now(T, "page")
check("a few are counted without an alarm, and only the last day's", items["errors"]["state"] == "ok" and items["errors"]["line"].startswith("1 problem in the last day"), items["errors"])
putdoc("errors", {"list": [], "writtenAt": 0})
items, _ = part_now(T, "page")
check("none reads as none", items["errors"]["line"] == "None in the last day.", items["errors"])
check("no key ever reached the log through all this", not no_secrets(open(f"{_W.OUT}/dev.log").read().replace("passcode: letmein", "")))
finish()

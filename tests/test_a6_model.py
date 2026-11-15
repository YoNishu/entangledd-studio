"""No new version of the app when a Claude model is retired: the app moves to the newest Sonnet by itself,
remembers the choice, and says so in the health record."""
import where as _W
import json
from a6lib import *

ASK = {"text": "No man ever steps in the same river twice.", "author": ""}
def use(): return doc("claudeuse") or {}
def calls(kind): return [x for x in hlog() if x["service"] == "anthropic" and x["method"] == kind]

# ---- the model goes while she is using the app
serve()
T = login()
check("before anything happens, the built-in model answers", http("POST", "/api/check", ASK, T)[0] == 200 and not use().get("model"))
hset(modelGone="yes")
before = len(calls("POST"))
s, b, _ = http("POST", "/api/check", ASK, T)
check("the question that meets the retired model is still answered", s == 200 and b["verdict"] == "found", (s, b))
m = use().get("model") or {}
check("the app chose the newest Sonnet on Anthropic's list", m.get("id") == "claude-sonnet-6" and m.get("was") == "claude-sonnet-5-5", m)
check("not an Opus or a Haiku, though one of them is newer", m.get("name") == "Claude Sonnet 6", m)
lookups = [x for x in calls("GET") if x["path"] == "/v1/models"]
check("it read the list once", len(lookups) == 1, lookups)
check("that question went to Anthropic twice: refused, then answered", len(calls("POST")) - before == 2)
before = len(calls("POST"))
s, b, _ = http("POST", "/api/check", ASK, T)
check("the next question goes straight to the new model", s == 200 and len(calls("POST")) - before == 1 and len([x for x in calls("GET") if x["path"] == "/v1/models"]) == 1)
check("nothing was written down as a problem", doc("errors") is None, doc("errors"))
s, b, _ = http("GET", "/api/suggestions", token=T)
check("Today's suggestions come from the new model too", s == 200 and len(b["items"]) == 5, s)

items, full = check_now(T)
line = items["nishiii"]["line"]
check("the health record says so, without an alarm", items["nishiii"]["state"] == "ok" and "moved Nishiii to Claude Sonnet 6 by itself" in line, items["nishiii"])
s, pub, _ = http("GET", "/api/health")
check("the open record notes it in fixed words", not pub["needsAttention"] and len(pub["notes"]) == 1 and pub["notes"][0].startswith("Nishiii moved to a newer Claude model by itself on "), pub)
check("the daily check asked about the model now in use", any(x["path"] == "/v1/models/claude-sonnet-6" for x in calls("GET")), [x["path"] for x in calls("GET")])

# ---- the daily check finds the model gone before she does
serve()
T = login()
hset(model="404", modelGone="yes")
items, _ = check_now(T)
check("the check itself moves the app on", (use().get("model") or {}).get("id") == "claude-sonnet-6", use())
check("and reports Nishiii as working, moved", items["nishiii"]["state"] == "ok" and "by itself" in items["nishiii"]["line"], items["nishiii"])
check("she never saw a failure: the first real question just works", http("POST", "/api/check", ASK, T)[0] == 200)

# ---- the lookup says "gone" but the model still answers: nothing is changed
serve()
T = login()
hset(model="404")
items, _ = check_now(T)
check("a model that still answers is kept, whatever the lookup says", items["nishiii"]["state"] == "ok" and not use().get("model"), (items["nishiii"], use()))

# ---- nothing to move to
serve()
T = login()
hset(modelGone="yes", modelList="none")
s, b, _ = http("POST", "/api/check", ASK, T)
check("with no other Sonnet on the list, she is told plainly", s == 502 and "retired" in b["error"], (s, b))
check("and nothing is remembered", not use().get("model"), use())
hset(model="retired")
items, _ = check_now(T)
check("the health record raises it", items["nishiii"]["state"] == "attention" and "couldn't move" in items["nishiii"]["line"], items["nishiii"])
s, pub, _ = http("GET", "/api/health")
check("in the open record too", pub["needsAttention"] and "Nishiii: the Claude model Nishiii runs on has been retired" in pub["message"], pub["message"])
hset(modelList="ok")
check("once a Sonnet is on the list again, the next question moves on", http("POST", "/api/check", ASK, T)[0] == 200 and use()["model"]["id"] == "claude-sonnet-6")
hset(model="active")
items, _ = check_now(T)
check("and the alarm clears by itself", items["nishiii"]["state"] == "ok", items["nishiii"])

# ---- the list can't be read just then
serve()
T = login()
hset(modelGone="yes", modelList="busy")
s, b, _ = http("POST", "/api/check", ASK, T)
check("if the list can't be read, this question fails plainly", s == 502, (s, b))
hset(modelList="ok")
check("and the next one moves on", http("POST", "/api/check", ASK, T)[0] == 200 and use()["model"]["id"] == "claude-sonnet-6")

# ---- the newer model doesn't know the app's optional setting
serve()
T = login()
hset(modelGone="yes", newModelPlain="yes")
before = len(calls("POST"))
s, b, _ = http("POST", "/api/check", ASK, T)
check("a newer model that refuses the optional setting is asked again without it", s == 200, (s, b))
check("that took three tries, once", len(calls("POST")) - before == 3, len(calls("POST")) - before)
check("the app remembers to leave the setting out", use()["model"].get("plain") is True, use())
before = len(calls("POST"))
check("from then on one try is enough", http("POST", "/api/check", ASK, T)[0] == 200 and len(calls("POST")) - before == 1)

# ---- a retirement announced ahead of time needs nobody
serve()
T = login()
hset(model="deprecated", modelDays=10)
items, _ = check_now(T)
check("a retirement ten days away is no alarm any more", items["nishiii"]["state"] == "ok" and "will move to the newest one by itself" in items["nishiii"]["line"], items["nishiii"])
s, pub, _ = http("GET", "/api/health")
check("the open record stays calm", not pub["needsAttention"], pub["message"])
check("no key reached the log", not no_secrets(open(f"{_W.OUT}/dev.log").read().replace("passcode: letmein", "")))
finish()

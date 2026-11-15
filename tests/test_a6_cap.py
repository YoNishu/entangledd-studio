"""A ceiling on Claude spending: every question is counted per India day; past the limit Nishiii rests until midnight."""
import json
from a6lib import *

ASK = {"text": "No man ever steps in the same river twice.", "author": ""}
def use(): return doc("claudeuse") or {}

# ---- the default limit
serve()
T = login()
s, b, _ = http("POST", "/api/check", ASK, T)
check("a question is answered", s == 200 and b["verdict"], (s, b))
check("and counted for today", use().get("n") == 1 and use().get("day") == india_day(), use())
ops(reset=True)
http("POST", "/api/check", ASK, T)
cost = [w for w in ops()["what"] if "claudeuse" in w]
check("counting a question costs one write and no read", cost == ["put data/claudeuse.json"], cost)
s, b, _ = http("POST", "/api/chat", {"messages": [{"role": "user", "content": "how did my posts do?"}]}, T)
check("a chat turn that uses a tool counts each question it puts to Claude", s == 200 and use()["n"] == 4, use())
items, _ = check_now(T)
check("the health record gives the day's count and the limit", "4 so far today; the limit is 400 a day" in items["nishiii"]["line"], items["nishiii"]["line"])
s, pub, _ = http("GET", "/api/health")
check("the open record gives the limit and yesterday's count, and no alarm", pub["counts"]["questionsDailyLimit"] == 400 and pub["counts"]["questionsYesterday"] == 0 and items["nishiii"]["state"] == "ok", pub["counts"])

# ---- a small limit, set in Cloudflare
serve("CLAUDE_DAILY_CAP=5")
T = login()
for i in range(5):
    s, b, _ = http("POST", "/api/check", ASK, T)
    check(f"question {i + 1} of 5 is answered", s == 200, (s, b))
log_before = len([x for x in hlog() if x["service"] == "anthropic"])
s, b, _ = http("POST", "/api/check", ASK, T)
check("the sixth is refused kindly", s == 429 and "resting until tomorrow" in b["error"] and "Nishiii" in b["error"], (s, b))
check("and never reaches Anthropic", len([x for x in hlog() if x["service"] == "anthropic"]) == log_before)
s, b, _ = http("GET", "/api/suggestions", token=T)
check("Today says the same instead of spending more", s == 429 and "resting until tomorrow" in b["error"], (s, b))
s, b, _ = http("POST", "/api/chat", {"messages": [{"role": "user", "content": "hello"}]}, T)
check("so does the chat", s == 429, (s, b))
check("the rest of the app still works", http("GET", "/api/library", token=T)[0] == 200 and http("GET", "/api/looks", token=T)[0] == 200)
check("the count stops at the limit", use()["n"] == 5 and use()["capDay"] == india_day(), use())
check("a rest is not written down as a problem of the app", doc("errors") is None, doc("errors"))
items, _ = check_now(T)
check("the health record flags that the limit was reached", items["nishiii"]["state"] == "soon" and "limit of 5 questions today" in items["nishiii"]["line"], items["nishiii"])
check("with what to do about it", any("CLAUDE_DAILY_CAP" in step for step in items["nishiii"].get("fix", [])), items["nishiii"].get("fix"))
s, pub, _ = http("GET", "/api/health")
check("and so does the open record", pub["needsAttention"] and "Nishiii: Nishiii reached the day's limit of 5 questions" in pub["message"], pub["message"])

# ---- the next day
set_day(india_day(1))
s, b, _ = http("POST", "/api/check", ASK, T)
check("after midnight Nishiii answers again", s == 200, (s, b))
u = use()
check("the count starts again, and yesterday's is remembered", u["n"] == 1 and u["prev"] == {"day": india_day(), "n": 5} and u["day"] == india_day(1), u)
items, _ = check_now(T)
check("yesterday's rest is still reported that day", items["nishiii"]["state"] == "soon" and "yesterday" in items["nishiii"]["line"], items["nishiii"]["line"])
set_day(india_day(2))
items, _ = check_now(T)
check("and cleared the day after", items["nishiii"]["state"] == "ok" and "1 questions yesterday" in items["nishiii"]["line"], items["nishiii"]["line"])
s, pub, _ = http("GET", "/api/health")
check("the open record carries yesterday's count", pub["counts"]["questionsYesterday"] == 1 and pub["counts"]["questionsDailyLimit"] == 5, pub["counts"])
set_day()

# ---- a setting that isn't a number falls back to the default
serve("CLAUDE_DAILY_CAP=lots")
T = login()
http("POST", "/api/check", ASK, T)
items, _ = check_now(T)
check("a setting that isn't a number means the default of 400", "the limit is 400 a day" in items["nishiii"]["line"], items["nishiii"]["line"])
# An unreadable count never stops Nishiii.
put_raw("data/claudeuse.json", "{{{")
serve_ok = http("POST", "/api/check", ASK, T)[0]
finish_note = use()
check("a count that can't be read starts again instead of stopping Nishiii", serve_ok == 200, serve_ok)
finish()

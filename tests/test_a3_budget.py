"""What each timed run and each request of the health section costs: storage operations and outside calls, counted together.
Cloudflare's free plan allows 50 per run; the aim for a health job is about 20, and the open address may cost one read and nothing else.
Run: python3 tests/test_a3_budget.py   (starts its own fresh servers on its own port)"""
import where as _W
import subprocess
from a3lib import *

JOBS = ["instagram-renew", "health-check"]
def ops(reset=False): return http("GET", "/__health_ops" + ("?reset=1" if reset else ""))[1]
def cost(o): return o["storage"] + o["outside"]
def run_job(name):
    """One five-minute tick in which only the named job is due. Returns what the whole tick spent."""
    putdoc("jobstamps", {n: (0 if n == name else now_ms()) for n in JOBS})
    ops(reset=True); cron(); o = ops()
    assert (doc("jobstamps") or {}).get(name, 0) > 0, "the job did not run"
    return o
def spent(method, path, token=None, body=None):
    ops(reset=True); s, b, _ = http(method, path, body, token); return s, b, ops()
def show(o): return f"{o['storage']} storage + {o['outside']} outside: " + ", ".join(o["what"])
def set_ig(**changes):
    ig = doc("instagram"); ig.update(changes); putdoc("instagram", ig)
TICK = 3          # the five-minute tick's own reads (posts waiting, reels handed to Instagram, the daily reminders), before any job

print("An ordinary day")
serve(); t = login(); connect(t)
o = run_job("health-check")
check(f"the daily check: {cost(o)} in all, {cost(o) - TICK} of them the job's (aim: about 20)", cost(o) <= 17, show(o))      # two reads more: whether Instagram has paused the app; and: the day's count of questions (Agent 6)
check("it wrote exactly two things: the timer's stamp and the record", sorted(w for w in o["what"] if w.startswith("put")) == ["put data/health.json", "put data/jobstamps.json"], show(o))
o = run_job("instagram-renew")
check(f"the renewal job when nothing is due: {cost(o)} in all, not one call to Meta", cost(o) <= 6 and o["outside"] == 0, show(o))
s, b, o = spent("POST", "/api/checkup", t)
check("(a check made a moment ago turns Check now away, for one read)", s == 429 and cost(o) == 1, (s, show(o)))
rec = doc("health"); rec["asOf"] -= 120000; putdoc("health", rec)
s, b, o = spent("POST", "/api/checkup", t)
check(f"Check now: {cost(o)}", s == 200 and cost(o) <= 15, show(o))

print("The open address")
s, b, o = spent("GET", "/api/health")
check("three reads (the record, how the last look-up went, how Instagram serves the last reels), nothing else, no outside call", s == 200 and sorted(o["what"]) == ["get data/health.json", "get data/lookups.json", "get data/served.json"], show(o))
s, b, o = spent("GET", "/api/checkup", t)
check("the signed-in record: one read too", s == 200 and o["what"] == ["get data/health.json"], show(o))
ops(reset=True)
for _ in range(40): http("GET", "/api/health")
o = ops()
check("40 reads in a row: 120 storage reads, still not one outside call or write", o["storage"] == 120 and o["outside"] == 0 and all(w in ("get data/health.json", "get data/lookups.json", "get data/served.json") for w in o["what"]), (o["storage"], o["outside"]))

print("What real use adds")
ops(reset=True); s, b, _ = http("POST", "/api/check", {"text": "the sea keeps no calendar", "author": ""}, t); first = ops()
ops(reset=True); s2, b2, _ = http("POST", "/api/check", {"text": "the sea keeps no calendar", "author": ""}, t); second = ops()
notes = lambda o: [w for w in o["what"] if "healthnotes" in w]
check("a good answer from Nishiii never writes a note", s == 200 and s2 == 200 and not [w for w in notes(first) + notes(second) if w.startswith("put")], (notes(first), notes(second)))
check("and after the first look it doesn't even read one", len(notes(first)) <= 1 and notes(second) == [], (notes(first), notes(second)))
ops(reset=True); cron("30 0 * * *"); o = ops()
check("the 6 am pass is left as it was: at most one read of the notes, no write", len(notes(o)) <= 1 and not [w for w in notes(o) if w.startswith("put")] and "put data/health.json" not in o["what"], notes(o))

print("The heaviest renewal: the sign-in and the Page token, both made again")
serve(); t = login(); connect(t)
hset(dataDays=10, newDataDays=90, exchange="extend"); set_ig(dataAccessUntil=now_ms() + 10 * DAY)
o = run_job("instagram-renew")
ig = doc("instagram")
check("it did renew both", ig["userToken"].startswith("LONG-user-token-R") and ig["pageToken"].startswith("PAGE-token-R"), (ig["userToken"][:20], ig["pageToken"][:14]))
check(f"cost: {cost(o)} in all, {cost(o) - TICK} of them the job's", cost(o) <= 14, show(o))
check("six calls to Meta, one save of the connection", o["outside"] == 6 and o["what"].count("put data/instagram.json") == 1, show(o))

print("A refused renewal")
serve(); t = login(); connect(t)
hset(userDays=20, exchange="refuse"); set_ig(userTokenExpires=now_ms() + 20 * DAY)
o = run_job("instagram-renew")
check(f"cost: {cost(o)} in all (one call to Meta, one note saved)", cost(o) <= 9 and o["outside"] == 1 and o["what"].count("put data/instagram.json") == 1, show(o))

print("The worst day there can be: everything that can need mending, at once")
serve("OV_KEYS=1"); t = login(); connect(t)
run_job("health-check")                                               # yesterday's record exists
hset(claudeAsk="credit"); http("POST", "/api/check", {"text": "the sea keeps no calendar", "author": ""}, t)
check("(a real question was refused for lack of credit, and noted)", (doc("healthnotes") or {}).get("claude", {}).get("kind") == "credit", doc("healthnotes"))
hset(claudeAsk="", pageValid="no", dataDays=50)                         # credit topped up; Meta dropped the Page token; a date to bring up to date
o = run_job("health-check")
ig = doc("instagram"); rec = {i["id"]: i for i in doc("health")["items"]}
check("the Page token was mended and the date brought up to date, in one save", ig["pageToken"].startswith("PAGE-token-R") and ig.get("dataAccessUntil", 0) > now_ms() and o["what"].count("put data/instagram.json") == 1, show(o))
check("the credit note was cleared, in one save", "claude" not in (doc("healthnotes") or {}) and o["what"].count("put data/healthnotes.json") == 1, show(o))
check("and every line ends up fine", all(rec[i]["state"] == "ok" for i in ["instagram", "github", "nishiii", "backgrounds", "music"]), {k: v["state"] for k, v in rec.items()})
check(f"cost: {cost(o)} in all, {cost(o) - TICK} of them the job's (limit 50; aim about 20)", cost(o) - TICK <= 23, show(o))      # the small real question is now counted too (Agent 6)

print("Check now on that same worst day, with a renewal due as well")
serve("OV_KEYS=1"); t = login(); connect(t)
run_job("health-check")
hset(claudeAsk="credit"); http("POST", "/api/check", {"text": "the sea keeps no calendar", "author": ""}, t)
hset(claudeAsk="", pageValid="no", dataDays=50, userDays=20, exchange="extend"); set_ig(userTokenExpires=now_ms() + 20 * DAY)
rec = doc("health"); rec["asOf"] -= 120000; putdoc("health", rec)
s, b, o = spent("POST", "/api/checkup", t)
check("it renewed and mended", s == 200 and doc("instagram")["userToken"].startswith("LONG-user-token-R") and doc("instagram")["pageToken"].startswith("PAGE-token-R"), s)
check(f"cost: {cost(o)} (limit 50)", cost(o) <= 30, show(o))

http("GET", "/__health_reset")
subprocess.run([f"{_W.HERE}/stop"], capture_output=True)
finish()

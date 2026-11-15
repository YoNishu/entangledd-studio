"""Agent 16: Posts and Insights show current numbers (server side, stand-in Instagram).
- the stand-in's numbers go up; opening Insights or Posts brings them in by the rules: a post under 3 days old
  once its numbers are 5 minutes old, 3 to 30 days after an hour; followers after 10 minutes;
- Refresh (force=1) asks again for everything at once, in Insights and in Posts;
- each opening stays inside the free plan's 50 outside calls (Instagram and storage counted together);
- Instagram not answering, and Meta pausing the app: said as such, with when the numbers are from;
- after a refresh, a reel gets post.served = { kbps, at } (no address kept) and /api/health a line of numbers only.
Run:  python3 tests/test_a16_fresh.py"""
import re
import where as _W
from a3lib import *

fails = []
def check(name, ok, more=""):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  " + str(more)[:300]))
    if not ok: fails.append(name)
MIN = 60 * 1000

serve()
T = login(); connect(T)
http("GET", "/__seed_posts")              # ten posts, 1 to 13 days old (M1 newest), numbers fresh now
def ig(**kw): return http("GET", "/__ig?" + "&".join(f"{k}={v}" for k, v in kw.items()))[1]
def clock(ms): http("GET", f"/__clock?add={ms}")
def insights(force=False):
    s, b, _ = http("GET", "/api/insights?range=all" + ("&force=1" if force else ""), None, T); assert s == 200, b; return b
def posts(force=False):
    s, b, _ = http("GET", "/api/posts" + ("?force=1" if force else ""), None, T); assert s == 200, b; return b
def reach_of(d, n):          # reach of the seeded post n (mediaId Mn), from an Insights answer
    return {r["quote"]: r["reach"] for r in d["posts"]}.get(f"Seeded quote {n} about " + ["love", "self", "love", "growth", "self", "growth", "self", "love", "growth", "love"][n - 1])
def doc(name): return http("GET", f"/__doc?name={name}")[1]
def opening_cost(fn):
    ig(reset=1); http("GET", "/__ops?reset=1")
    out = fn()
    return out, ig()["calls"] + len(http("GET", "/__ops")[1])

insights()                                # the first opening keeps today's follower count
st = ig(bump=7)
check("the stand-in's numbers can change", st.get("bump") == 7, st)
d = insights()
check("numbers just fetched are not asked for again", reach_of(d, 1) == 5200, reach_of(d, 1))
check("Insights says when its numbers are from", isinstance(d.get("updatedAt"), (int, float)) and d["instagram"] == {"ok": True, "paused": False}, {k: d.get(k) for k in ("updatedAt", "instagram")})
followers0 = d["followers"]["now"]

clock(6 * MIN)
d = insights()
check("a post under 3 days old is asked again after 5 minutes", reach_of(d, 1) == 1207 and reach_of(d, 2) == 2407, (reach_of(d, 1), reach_of(d, 2)))
# (Post 4, four days old at any hour; post 3 is "3 days ago at 8 pm", which is under 3 days until 8 pm.)
check("a 3 to 30 day old post is not asked again before an hour", reach_of(d, 4) == 1500, reach_of(d, 4))
check("followers are asked again after 10 minutes, not before", d["followers"]["now"] == followers0, d["followers"])
clock(5 * MIN)
d = insights()
check("followers after 10 minutes", d["followers"]["now"] == followers0 + 7, (followers0, d["followers"]))
clock(50 * MIN)
d, cost = opening_cost(insights)
check("after an hour every post up to 30 days old is asked again", all(reach_of(d, n) == 1200 * n + 7 for n in range(3, 11)), [reach_of(d, n) for n in range(1, 11)])
check("Insights: nothing left behind", d["behind"] == 0, d["behind"])
check(f"an opening of Insights stays under 50 outside calls ({cost})", cost < 50, cost)

ig(bump=20)
d, cost = opening_cost(lambda: insights(force=True))
check("Refresh in Insights asks again for everything", all(reach_of(d, n) == 1200 * n + 20 for n in range(1, 11)), [reach_of(d, n) for n in range(1, 11)])
check(f"a Refresh of Insights stays under 50 outside calls ({cost})", cost < 50, cost)
ig(bump=30)
p, cost = opening_cost(lambda: posts(force=True))
m1 = next(x for x in p["posts"] if x["quote"].startswith("Seeded quote 1 "))
check("Refresh in Posts brings each card's new numbers", m1["metrics"]["reach"] == 1230, m1["metrics"])
check("Posts says when the list was checked", isinstance(p.get("checkedAt"), (int, float)) and p["instagram"]["ok"], {k: p.get(k) for k in ("checkedAt", "instagram")})
check(f"a Refresh of Posts stays under 50 outside calls ({cost})", cost < 50, cost)
ig(bump=31); clock(6 * MIN)
p = posts()
m1 = next(x for x in p["posts"] if x["quote"].startswith("Seeded quote 1 "))
check("opening Posts brings a young post's new numbers after 5 minutes", m1["metrics"]["reach"] == 1231, m1["metrics"])

# Instagram not answering, then Meta pausing the app.
before = insights()["updatedAt"]
clock(2 * MIN); ig(mode="down")
d = insights(force=True)
check("Instagram not answering is said, with when the numbers are from", d["instagram"] == {"ok": False, "paused": False} and d["updatedAt"] and d["updatedAt"] <= before + 1000,
      {k: d.get(k) for k in ("instagram", "updatedAt")})
check("and the numbers already kept are still shown", reach_of(d, 1) == 1231, reach_of(d, 1))
p = posts(force=True)
check("Posts says so too", p["instagram"] == {"ok": False, "paused": False} and p["checkedAt"] and len(p["posts"]) == 10, {k: p.get(k) for k in ("instagram", "checkedAt")})
ig(mode="paused")
d = insights(force=True)
check("Meta pausing the app is said as such", d["instagram"] == {"ok": False, "paused": True}, d["instagram"])
ig(mode="ok"); http("DELETE", "/__doc?name=igblock"); clock(3 * 3600 * 1000)

# What Instagram serves for a reel: measured once after a refresh, kept as numbers only.
ps = doc("posts")
newest = next(x for x in ps if x["mediaId"] == "M1")
newest["made"] = {"seconds": 8}; newest.pop("served", None); newest.pop("servedTries", None); newest["insightsAt"] = 0
http("PUT", "/__doc?name=posts", ps)
ig(size=6000000)
insights()
ps = doc("posts")
newest = next(x for x in ps if x["mediaId"] == "M1")
check("a reel gets post.served = { kbps, at } after a refresh", (newest.get("served") or {}).get("kbps") == 6000 and newest["served"].get("at"), newest.get("served"))
check("the served address is not kept", "__served" not in json.dumps(ps), "")
s, h, _ = http("GET", "/api/health")
check("the open health record has the served line, numbers only", s == 200 and re.fullmatch(r"app 6000 kbps \d{1,2}-[a-z]{3}", h.get("served", "")), h.get("served"))
insights(force=True)
check("measured once per post", next(x for x in doc("posts") if x["mediaId"] == "M1").get("servedTries") == 1, [x.get("servedTries") for x in doc("posts")])

print("PASS" if not fails else f"FAIL ({len(fails)}): " + "; ".join(fails))
sys.exit(1 if fails else 0)

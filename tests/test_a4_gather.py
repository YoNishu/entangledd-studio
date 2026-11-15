"""Agent 4: the scorer gathers its record from the app's own lists, without repeats; forgetting clears it;
a broken stored model never breaks the day's quotes.
Run: python3 tests/test_a4_gather.py"""
import uuid
from a4lib import *

def item(tag, state="new", **extra):
    q = quote(tag, "calm", 7, "sea", "Author " + tag)
    return {"id": str(uuid.uuid4()), "state": state, **q, **extra}

# ---------- A. gathering from the lists ----------
print("A. gathering from the day lists, the asked-for list, the record of choices and the posts")
serve(); tok = login()
y, old = day_str(1), day_str(10)
yesterday = [item("Y1", "used"), item("Y2"), item("Y3"), item("Y4"), item("Y5")]
doc(f"suggestions/{y}", yesterday)
doc(f"suggestions/{day_str(2)}", [item("Z1"), item("Z2"), item("Z3"), item("Z4"), item("Z5")])   # no pick: no decision
doc(f"suggestions/{old}", [item("O1"), item("O2", "used"), item("O3"), item("O4"), item("O5")])  # older than a week
st, today = call("GET", "/api/suggestions", token=tok)
ids = [i["id"] for i in today["items"]]
check("today's five came", st == 200 and len(ids) == 5, str(st))
call("POST", f"/api/suggestions/{ids[0]}/feedback", {"action": "used"}, token=tok)
call("POST", f"/api/suggestions/{ids[1]}/feedback", {"action": "rejected"}, token=tok)
s = call("GET", "/api/scorer", token=tok)[1]
m = doc("scorer/model")
# today: 1 pick, 1 skip (day still open, the other three say nothing yet); yesterday: 1 pick, 4 passes
check("the quick look counts today's and yesterday's picks", s["picks"] == 2 and m["passes"] == 5, f"{s} passes={m.get('passes')}")
log = doc("scorer/log")
n1 = len(log["rows"])
check("one row per suggestion shown (5 today, 5 yesterday, 5 on the day without a pick)", n1 == 15, str(n1))
m = run_job()
log = doc("scorer/log")
check("the timed job also reads days older than a week", m["picks"] == 3 and len(log["rows"]) == 20, f"picks={m['picks']} rows={len(log['rows'])}")
m = run_job()
log = doc("scorer/log")
check("running again adds no repeats", m["picks"] == 3 and len(log["rows"]) == 20 and len({r["i"] for r in log["rows"]}) == 20)
check("the older days are read only once", log.get("back") == "done", str(log.get("back")))
# a post made from a suggestion that was never marked used still counts as a pick (and its day now has 4 passes)
day2 = doc(f"suggestions/{day_str(2)}")
posts = [{"id": "p1", "state": "published", "suggestionId": day2[2]["id"], "quote": day2[2]["text"], "theme": "sea", "tone": "calm",
          "source": "classic", "created": noon_ms(day_str(2)) + 3600000, "published": noon_ms(day_str(2)) + 7200000}]
doc("posts", posts)
m = run_job()
check("a post made from a suggestion counts as a pick", m["picks"] == 4 and m["passes"] == 13, f"{m['picks']} {m['passes']}")
m = run_job(); m = run_job()
check("and it is still a pick after later runs (the list itself never said 'used')", m["picks"] == 4 and m["passes"] == 13, f"{m['picks']} {m['passes']}")

# ---------- B. forgetting ----------
print("B. Forget the profile, then Forget everything")
st, _ = call("DELETE", "/api/taste?scope=profile", token=tok)
s = call("GET", "/api/scorer", token=tok)[1]
check("forgetting the profile leaves the picks counted", st == 200 and s["picks"] == 4, f"{st} {s}")
st, _ = call("DELETE", "/api/taste?scope=all", token=tok)
check("forget everything answers", st == 200, str(st))
check("the model is gone", doc("scorer/model") is None or doc("scorer/model") == {} or "v" not in (doc("scorer/model") or {}), str(doc("scorer/model"))[:80])
s = call("GET", "/api/scorer", token=tok)[1]
check("the count starts again from nothing", s["picks"] == 0 and s["line"] == "Learning from your picks: none yet.", str(s))
m = run_job()
check("old lists are not gathered again after forgetting", m["picks"] == 0 and len(doc("scorer/log")["rows"]) == 0, f"{m['picks']} {len(doc('scorer/log')['rows'])}")

# ---------- C. a broken stored model ----------
print("C. a broken stored model")
for label, bad in [("not JSON", b"{oops"), ("live but nonsense inside", json.dumps({"v": 1, "state": "live", "at": 1, "base": [1, 1], "feat": {"theme": 5, "tone": {"calm": "x"}}, "aud": 7}).encode()),
                   ("live with wrong shapes", json.dumps({"v": 1, "state": "live", "at": 1, "base": ["a"], "feat": None}).encode())]:
    serve(); tok = login()
    doc("scorer/model", raw=bad)
    st, today = call("GET", "/api/suggestions", token=tok)
    check(f"{label}: the day's five quotes still come", st == 200 and len(today["items"]) == 5, f"{st} {str(today)[:120]}")
    st, s = call("GET", "/api/scorer", token=tok)
    check(f"{label}: the status still answers", st == 200 and "line" in s, f"{st} {s}")
# a broken record: rebuilt from scratch, nothing breaks
serve(); tok = login()
doc("scorer/log", raw=b"[1,2")
st, s = call("GET", "/api/scorer", token=tok)
check("a broken record: the status still answers", st == 200 and s["picks"] == 0, f"{st} {s}")
# ---------- D. Forget everything is offered whenever the scorer has counted something ----------
print("D. Forget everything knows about the scorer's record")
serve(); tok = login()
t = call("GET", "/api/taste", token=tok)[1]
check("a fresh app has nothing to forget", t["canForget"] == {"profile": False, "all": False}, str(t["canForget"]))
put_log(history(20, 1, likes_calm_short, seed=3)); run_job()
t = call("GET", "/api/taste", token=tok)[1]
check("with only the scorer's count (no profile, notes or record of choices), Forget everything is offered",
      t["canForget"] == {"profile": False, "all": True}, str(t["canForget"]))
st, t = call("DELETE", "/api/taste?scope=all", token=tok)
check("after forgetting there is nothing left to forget", st == 200 and t["canForget"]["all"] is False, f"{st} {t.get('canForget')}")
check("the moment of forgetting is kept, apart from the record", (doc("scorer/forgot") or {}).get("at", 0) > 0, str(doc("scorer/forgot")))
s = call("GET", "/api/scorer", token=tok)[1]
check("the line says none yet", s["line"] == "Learning from your picks: none yet.", s["line"])
m = run_job()
check("and the next timed run finds nothing from before", m["picks"] == 0 and m["passes"] == 0 and len(doc("scorer/log")["rows"]) == 0, f"{m['picks']} {m['passes']}")
# a record written back after the forgetting (a count that was under way) is not believed
put_log(history(20, 1, likes_calm_short, seed=3))
m = run_job()
check("a record older than the forgetting is void", m["picks"] == 0 and len(doc("scorer/log")["rows"]) == 0, f"{m['picks']} rows {len(doc('scorer/log')['rows'])}")
# what she does afterwards counts again
st, today = call("GET", "/api/suggestions", token=tok)
call("POST", f"/api/suggestions/{today['items'][0]['id']}/feedback", {"action": "used"}, token=tok)
s = call("GET", "/api/scorer", token=tok)[1]
check("a pick made after forgetting is counted", s["picks"] == 1 and s["line"].startswith("Learning from your picks: 1 so far"), str(s))
finish("scorer gathers, forgets, and survives broken documents")

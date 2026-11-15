"""Agent 4: the scorer learns silently, goes live by itself, ranks, keeps a wildcard and variety, and steps back.
Run: python3 tests/test_a4_learn.py   (restarts the server on its own port for every case)"""
import random
from a4lib import *

def pool_calm_short_late():
    """Ten candidates in 'Claude's order': the four she would like (calm and short) come 6th to 9th."""
    return [
        quote("Q1", "direct", 30, "work", "Author One"), quote("Q2", "wry", 30, "change", "Author Two"),
        quote("Q3", "direct", 18, "loss", "Author Three"), quote("Q4", "plain", 30, "time", "Author Four"),
        quote("Q5", "tender", 18, "home", "Author Five"), quote("Q6", "calm", 7, "sea", "Author Six"),
        quote("Q7", "calm", 7, "hope", "Author Seven"), quote("Q8", "calm", 7, "love", "Author Eight"),
        quote("Q9", "calm", 7, "self", "Author Nine"), quote("Q10", "hopeful", 18, "courage", "Author Ten"),
    ]
tags = lambda items: [i["text"].split()[0] for i in items]

# ---------- A. nothing yet ----------
print("A. a fresh app")
serve(); tok = login()
st, s = call("GET", "/api/scorer", token=tok)
check("status answers, with no count to fifty", st == 200 and s["state"] == "learning" and s["picks"] == 0 and "need" not in s and "progress" not in s, str(s))
check("the line says nothing is learnt yet", s["line"] == "Learning from your picks: none yet.", s["line"])
check("signed out is refused", call("GET", "/api/scorer")[0] == 401)
check("other methods are not found", call("POST", "/api/scorer", {}, token=tok)[0] == 404)

# ---------- B. 20 picks: no gate any more (Nishith's rule): the engine leans on them from the first pick ----------
print("B. 20 picks with a clear taste: already counted, not yet proven")
serve(); tok = login()
put_log(history(20, 1, likes_calm_short, seed=3))
m = run_job()
check("20 picks counted", m["picks"] == 20, str(m["picks"]))
check("not live", m["state"] == "learning")
s = call("GET", "/api/scorer", token=tok)[1]
check("the line says how many so far, with no count to fifty", s["line"].startswith("Learning from your picks: 20 so far") and "of 50" not in s["line"], str(s))
call("PUT", "/__scorer_pool", pool_calm_short_late())
st, today = call("GET", "/api/suggestions", token=tok)
calls = call("GET", "/__scorer_calls")[1]
check("one request to Claude, for ten (nothing else in the pool yet)", calls == [{"want": 10, "count": 10, "maxTokens": 3500}], str(calls))
early = set(tags([i for i in today["items"] if not i.get("wild")]))
check("twenty picks already lift the calm, short ones she likes (at least three of four kept)", len(early & {"Q6", "Q7", "Q8", "Q9"}) >= 3, str(tags(today["items"])))
check("one wildcard, and every quote with its reason", sum(1 for i in today["items"] if i.get("wild")) == 1 and all("why" in i for i in today["items"]))

# ---------- C. 60 picks with a clear taste: live, ranking, wildcard ----------
print("C. 60 picks with a clear taste: goes live by itself")
serve(); tok = login()
put_log(history(60, 1, likes_calm_short, seed=3))
m = run_job()
check("60 picks counted", m["picks"] == 60, str(m["picks"]))
check("live", m["state"] == "live", str(m["eval"]))
check("it proved itself on her own days", m["eval"]["days"] >= 20 and m["eval"]["mean"] >= 0.56 and m["eval"]["z"] >= 2, str(m["eval"]))
s = call("GET", "/api/scorer", token=tok)[1]
check("the line says what it learned", s["line"].startswith("Learning from your picks: 60 so far. Lately: ") and "calm" in s["line"] and "short" in s["line"], s["line"])
print("     line:", s["line"], "| tested days:", m["eval"])
call("PUT", "/__scorer_pool", pool_calm_short_late())
st, today = call("GET", "/api/suggestions", token=tok)
calls = call("GET", "/__scorer_calls")[1]
got = tags(today["items"])
check("Claude was asked for ten", calls == [{"want": 10, "count": 10, "maxTokens": 3500}], str(calls))
check("five quotes came back", len(got) == 5, str(got))
kept = tags([i for i in today["items"] if not i.get("wild")])
check("the four calm, short ones were all kept", set(kept) == {"Q6", "Q7", "Q8", "Q9"}, str(got))
wild = [i for i in today["items"] if i.get("wild")]
check("exactly one wildcard", len(wild) == 1, str(got))
# Shown in a random order (server/engine.js), so her habit of taking the first card can't flatter the ranking.
# (so no check on the order here)
check("the wildcard is something different", wild and wild[0]["tone"] != "calm", str(wild))
stored = doc(f"suggestions/{day_str(0)}")
check("the stored day list has those five, the wildcard marked", len(stored) == 5 and sum(1 for i in stored if i.get("wild")) == 1)
again = call("GET", "/api/suggestions", token=tok)[1]
check("opening Today again asks nothing more", len(call("GET", "/__scorer_calls")[1]) == 1 and tags(again["items"]) == got)

# asked-for quotes are ranked the same way
call("DELETE", "/__scorer_calls")
st, asked = call("POST", "/api/asked", {"about": "the sea", "count": 4}, token=tok)
calls = call("GET", "/__scorer_calls")[1]
check("an asked-for batch asks Claude for three more than wanted", st == 200 and calls == [{"want": 7, "count": 7, "maxTokens": 4000}], str(calls))
check("four quotes come back, ranked by the engine (no wildcard when she asked for something)", len(asked["items"]) == 4 and not any(i.get("wild") for i in asked["items"]) and all("why" in i for i in asked["items"]), str(tags(asked["items"])))

# ---------- D. 60 picks made at random: stays off ----------
print("D. 60 random picks: never proven")
off = 0
for seed in range(1, 9):
    serve(); tok = login()
    put_log(history(60, 1, at_random, seed=100 + seed))
    m = run_job()
    off += m["state"] == "learning"
    if seed == 1:
        s = call("GET", "/api/scorer", token=tok)[1]
        check("the line says there is no clear pattern", s["line"] == "Learning from your picks: 60 so far, no clear pattern yet.", s["line"])
        call("PUT", "/__scorer_pool", pool_calm_short_late())
        today = call("GET", "/api/suggestions", token=tok)[1]
        check("the day's five still come", len(today["items"]) == 5)
check("random picks are never proven (8 of 8 made-up histories)", off == 8, f"{off} of 8")

# ---------- E. live, then her taste reverses ----------
print("E. live, then her taste turns around")
serve(); tok = login()
old = history(150, 91, likes_calm_short, seed=5, tag="o")
put_log(old)
m = run_job()
check("live on the first taste", m["state"] == "live", str(m["eval"]))
put_log(old + history(90, 1, likes_direct_long, seed=6, tag="n"))
m = run_job()
turn = [quote("T1", "calm", 7, "sea", "Author One"), quote("T2", "calm", 7, "hope", "Author Two"), quote("T3", "calm", 7, "love", "Author Three"),
        quote("T4", "direct", 30, "work", "Author Four"), quote("T5", "direct", 30, "time", "Author Five"), quote("T6", "direct", 30, "loss", "Author Six"),
        quote("T7", "wry", 18, "home", "Author Seven"), quote("T8", "plain", 18, "self", "Author Eight"), quote("T9", "tender", 18, "change", "Author Nine"),
        quote("T10", "hopeful", 18, "courage", "Author Ten")]
call("PUT", "/__scorer_pool", turn)
today = call("GET", "/api/suggestions", token=tok)[1]
got = tags(today["items"])
kept = set(tags([i for i in today["items"] if not i.get("wild")]))
NEW, OLD = {"T4", "T5", "T6"}, {"T1", "T2", "T3"}
print("     after the turn:", m["state"], "now choosing", got, "| tested days:", m["eval"])
check("after ninety days of the new taste it ranks by the new one", NEW <= kept, str(got))

# day by day through the change, the way the timed job would see it: how long does it go on ranking by the old taste?
# (Each step shows it the old days and the first "into" days of the new taste, moved in time so the last one is yesterday.)
serve(); tok = login()
put_log(old); run_job()
turned = history(90, 1, likes_direct_long, seed=6, tag="n")
wrong, ended = 0, "still on the old taste after 45 days"
for into in range(1, 46):
    by = 90 - into
    seen = old + [r for r in turned if r["g"] <= day_str(91 - into)]
    put_log([dict(r, g=shift(r["g"], by), t=r["t"] + by * 86400000) for r in seen])
    m = run_job()
    doc(f"suggestions/{day_str(0)}", delete=True)
    call("PUT", "/__scorer_pool", turn)
    kept_now = set(tags([i for i in call("GET", "/api/suggestions", token=tok)[1]["items"] if not i.get("wild")]))
    if not OLD <= kept_now:
        ended = f"no longer keeping the old favourites on day {into}"; break
    wrong += 1
print(f"     day by day after the turn: {wrong} days still ranking by the old taste, then: {ended}")
check("it lets go of the old taste within five weeks of the change", wrong <= 35, f"{wrong}: {ended}")

# ---------- G. after stepping back it has to prove itself again ----------
print("G. after stepping back, what it got right before no longer counts")
serve(); tok = login()
put_log(history(90, 1, likes_calm_short, seed=3))
m = run_job()
check("live, and it has never stepped back", m["state"] == "live" and m.get("back") == 0, f"{m['state']} {m.get('back')}")
now_ms = int(time.time() * 1000)
def stepped_back(days_ago):
    stored = doc("scorer/model")
    stored.update({"state": "learning", "back": now_ms - days_ago * 86400000})
    doc("scorer/model", stored)
    return run_job()
m = stepped_back(0)
check("just stepped back: the same fine record does not switch it on again", m["state"] == "learning" and m["eval"]["days"] == 0 and m["back"] == now_ms, f"{m['state']} {m['eval']} {m.get('back')}")
s = call("GET", "/api/scorer", token=tok)[1]
check("the line says it is still learning", s["line"].startswith("Learning from your picks: 90 so far.") and s["state"] == "learning", s["line"])
m = stepped_back(10)
check("ten days later: not enough to go on yet", m["state"] == "learning" and 8 <= m["eval"]["days"] <= 10, f"{m['state']} {m['eval']}")
m = stepped_back(40)
check("forty good days later: live again, on those days alone", m["state"] == "live" and 30 <= m["eval"]["days"] <= 40, f"{m['state']} {m['eval']}")
check("and the moment it stepped back is remembered", m["back"] == now_ms - 40 * 86400000, str(m.get("back")))

# ---------- F. variety ----------
print("F. variety: never more than two on one theme or by one author")
serve(); tok = login()
put_log(history(60, 1, likes_calm_short, seed=3)); run_job()
same_theme = [quote(f"S{i}", "calm", 7, "sea", f"Sea Author {i}") for i in range(1, 6)] + [
    quote("S6", "direct", 30, "work", "Author Six"), quote("S7", "wry", 18, "change", "Author Seven"), quote("S8", "plain", 18, "time", "Author Eight"),
    quote("S9", "tender", 18, "home", "Author Nine"), quote("S10", "hopeful", 18, "courage", "Author Ten")]
call("PUT", "/__scorer_pool", same_theme)
today = call("GET", "/api/suggestions", token=tok)[1]
themes = [i["theme"] for i in today["items"]]
check("five best share a theme: only two of them are kept", len(themes) == 5 and themes.count("sea") == 2, str(themes))

serve(); tok = login()
put_log(history(60, 1, likes_calm_short, seed=3)); run_job()
same_author = [quote(f"R{i}", "calm", 7, t, "Rumi") for i, t in zip(range(1, 6), ["sea", "hope", "love", "self", "home"])] + [
    quote("R6", "direct", 30, "work", "Author Six"), quote("R7", "wry", 18, "change", "Author Seven"), quote("R8", "plain", 18, "time", "Author Eight"),
    quote("R9", "tender", 18, "loss", "Author Nine"), quote("R10", "hopeful", 18, "courage", "Author Ten")]
call("PUT", "/__scorer_pool", same_author)
today = call("GET", "/api/suggestions", token=tok)[1]
authors = [i["author"] for i in today["items"]]
check("five best share an author: only two of them are kept", len(authors) == 5 and authors.count("Rumi") == 2, str(authors))

serve(); tok = login()
put_log(history(60, 1, likes_calm_short, seed=3)); run_job()
call("PUT", "/__scorer_pool", [quote(f"B{i}", "calm", 7, "sea", "One Book Author", "book", "The Only Book") for i in range(1, 11)])
today = call("GET", "/api/suggestions", token=tok)[1]
check("when every candidate is alike, five still come back", len(today["items"]) == 5, str(tags(today["items"])))

finish("scorer learning, going live, ranking, variety and stepping back")

"""Her case of 16 Nov, 1:29 am: she asked for 10 quotes from a new drama and got 2, because the app could read only
one page that holds its lines (its own fetch of MyDramaList is refused; Tavily's search sent the text of one page).
Now pages the app may not read itself are read through Tavily's Extract, and every round reads more of the work's
pages (its next review pages, the results not read yet, one more question) until all is read.
"The Willow Station" is a made-up 2026 Chinese drama of the stand-in (server/devparts/extract.mjs): 30 pages of
reviews on the pretend MyDramaList, refused to the app's own fetch (403), read by the pretend Extract; 40 real lines,
reviewers' remarks in quotation marks, a cited headline, repeats across pages."""
import json, time
from a8lib import *

ROUND = 5
def xlog(reset=True): return http("GET", "/__extract_log" + ("?reset=1" if reset else ""))[1]
def ops(reset=False):
    o = http("GET", "/__health_ops" + ("?reset=1" if reset else ""))[1]
    c = http("GET", "/__askmore_calls" + ("?reset=1" if reset else ""))[1]
    return {"storage": o["storage"], "outside": c["n"], "what": c["what"]}
def found(items): return [i for i in items if i.get("src") != "memory"]
def ask_round(T, w, n):
    """One round as the phone asks it: (new quotes, said, left, reading, calls spent)."""
    ops(reset=True)
    s, b, _ = http("POST", "/api/asked", {"sources": [w], "count": n}, T)
    o = ops()
    assert s == 200, (s, b)
    fresh = [next(i for i in b["items"] if i["id"] == f) for f in b.get("fresh") or []]
    return fresh, b.get("said") or "", b.get("left"), b.get("reading") or "", o["storage"] + o["outside"]
def find(T, w, want, rounds=24):
    """As the Find quotes sheet does: rounds of five until she has the number, or nothing is left."""
    got, saids, readings, costs, empty = [], [], [], [], 0
    for _ in range(rounds):
        fresh, said, left, reading, cost = ask_round(T, w, min(ROUND, want - len(got)))
        got += fresh; saids.append(said); readings.append(reading); costs.append(cost)
        empty = 0 if fresh else empty + 1
        if len(got) >= want or (not fresh and not left) or empty >= 6: break
    return got, saids, readings, costs

REMARK_WORDS = ["SO good", "really just happen", "top-notch", "one more episode", "how original", "happy for once", "Quiet Hit"]
def bad(t): return any(x.lower() in t.lower() for x in REMARK_WORDS)

serve("WEBSEARCH=unset", "TAVILY=on", "OPEN_SEARCH=off")
T = login()
w = add_screen(T, "The Willow Station", "series")
lib = doc("library"); x = next(i for i in lib["screen"] if i["id"] == w)
x["known"] = {"title": "The Willow Station", "real": "The Willow Station", "original": "柳站", "year": 2026, "kind": "series", "country": "Chinese",
              "characters": ["Su Qing", "Gu Yan"], "cast": ["Mei Lin", "Zhao Feng"]}
putdoc("library", lib)
xlog()

# ---- 1. ten, a round at a time
a, saids, readings, costs = find(T, w, 10)
log1 = xlog()
ta = texts(a)
print("  first ask:", len(a), "in", len(costs), "rounds; calls per round", costs)
check("she asks 10 from the new drama and has 10", len(a) == 10, (len(a), saids))
check("none of them a reviewer's own remark or a headline", not [t for t in ta if bad(t)], [t for t in ta if bad(t)])
check("none twice", len(set(ta)) == len(ta), ta)
ext = [e for e in log1 if "urls" in e]
pages = [u for e in ext for u in e["urls"]]
check("the review pages are read through Extract: page 1, then 2 to 6, ...", any(u.endswith("/reviews") for u in pages) and all(f"/reviews?page={n}" in " ".join(pages) for n in range(2, 7)), pages)
check("one Extract call for several pages (never more than 20 a call)", any(len(e["urls"]) >= 5 for e in ext) and all(len(e["urls"]) <= 20 for e in ext), [len(e["urls"]) for e in ext])
check("Extract is asked as its reference says (basic, at most 20 addresses)", all(e["body"].get("extract_depth") == "basic" and e["body"].get("format") in ("markdown", "text") for e in ext), [e["body"] for e in ext][:1])
own = [e["own"] for e in log1 if "own" in e]
check("the app's own fetch of the site that refused it is not tried again", len(own) <= 1, own)
check("each round stays under 50 outside calls (storage included)", max(costs) < 50, costs)
check("a short round says what is happening", any("Reading more reviews of The Willow Station" in r for r in readings) or len(costs) <= 2, readings)
check("and never the 'every line' sentence while pages are left", not any("every line" in s for s in saids), saids)

# ---- 2. ten again at once: ten new ones
b, saids2, _, costs2 = find(T, w, 10)
tb = texts(b)
check("ten again at once: ten new ones", len(b) == 10 and not set(ta) & set(tb), (len(b), set(ta) & set(tb), saids2))
check("still none a remark or a headline", not [t for t in tb if bad(t)], [t for t in tb if bad(t)])

# ---- 3. on until every page is read, then the plain honest sentence
allgot, last_said, rounds = ta + tb, "", 0
for _ in range(10):
    c, s3, _, k = find(T, w, 10)
    allgot += texts(found(c)); rounds += len(k); last_said = s3[-1]
    if len(c) < 10: break
check("in the end every page is read, and she is told so plainly", "That's every line I could find from The Willow Station for now." in last_said, last_said)
check("nothing twice over all of it", len(set(allgot)) == len(allgot), len(allgot) - len(set(allgot)))
check("nothing a reviewer said about the drama, over all of it", not [t for t in allgot if bad(t)], [t for t in allgot if bad(t)])
f = (work(w).get("found") or {})
mdl = (f.get("more") or {}).get("mdl") or {}
print("  lines in all:", len(allgot), "kept on the work:", len(f.get("lines") or []), "reviews read up to page", mdl.get("next", 0) - 1, "of", mdl.get("last"), "done" if mdl.get("done") else "")
check("the reviews were read on to the end of what they hold", mdl.get("done") and mdl.get("last") == 30, mdl)
check("the real lines found, all 40 of them (the blog's three are among the reviews' too)", len(allgot) == 40, len(allgot))
n = len(http("GET", "/__extract_log")[1])
_, s4, _, _ = find(T, w, 10)
check("asked again after that: the same sentence, and nothing more is read", "every line" in (s4[-1] or "") and len([e for e in http("GET", "/__extract_log")[1] if "urls" in e]) == len([e for e in http("GET", "/__extract_log")[1][:n] if "urls" in e]), s4)

# ---- 4. nothing personal in any request to Tavily
sent = json.dumps(xlog(reset=False)) + json.dumps(http("GET", "/__open_log")[1])
check("nothing personal goes to Tavily", "letmein" not in sent and "Dhruuu" not in sent and "theentangledd" not in sent)

# ---- 5. Extract's allowance used up (432): she is told which service, plainly, and nothing loops
def another(title):
    wid = add_screen(T, title, "series")
    lib = doc("library"); x = next(i for i in lib["screen"] if i["id"] == wid)
    x["known"] = next(i for i in lib["screen"] if i["id"] == w)["known"] | {"title": title}; putdoc("library", lib)
    return wid
http("GET", "/__extract_set?mode=used")
w2 = another("The Willow Station cdrama")
xlog()
c, s5, _, k5 = find(T, w2, 10)
calls5 = [e for e in xlog() if "urls" in e]
print("  with the allowance used up:", len(c), "lines,", len(k5), "rounds, said:", s5[-1])
check("with Tavily's allowance used up, she is told so, naming it", "Tavily" in s5[-1] and "used up" in s5[-1] and "tomorrow" in s5[-1], s5)
check("and never the 'every line' sentence then", "every line" not in s5[-1], s5)
check("nothing loops: Extract was asked once, and the rounds stopped", len(calls5) == 1 and calls5[0]["status"] == 432 and len(k5) <= 2, ([e["status"] for e in calls5], len(k5)))
c, s6, _, _ = find(T, w2, 10)
check("asked again: Extract is not asked again today", not [e for e in xlog() if "urls" in e] and "used up" in s6[-1], s6)
items, _ = part_now(T, "services")
line = items["lookups"]["line"]
check("the health record says Tavily's page reader rests until tomorrow", "Tavily's page reader:" in line and "resting until" in line, line[:500])

# ---- 6. the daily cap holds
http("GET", "/__extract_set?mode=ok")
rec = doc("lookups") or {}
day = (rec.get("open") or {})
print("  pages read through Extract today:", day.get("extract"))
check("the day's count of pages read through Extract is kept, and within its cap", 0 < day.get("extract", 0) <= 150, day)
day["extract"] = 150; rec["open"] = day; rec["sites"].pop("extract", None); putdoc("lookups", rec)
w3 = another("The Willow Station (2026)")
xlog()
c, s7, _, _ = find(T, w3, 10)
check("at the day's cap, Extract is not asked", not [e for e in xlog() if "urls" in e])
check("and she is told the day's pages are read", "as many pages as I may today" in s7[-1], s7)
items, _ = part_now(T, "services")
line = items["lookups"]["line"]
check("the health record names Tavily's page reader and today's count", "Tavily's page reader: 150 of 150 pages read today" in line, line[:500])
finish()

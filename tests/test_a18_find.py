"""Find quotes (POST /api/asked), what the Library's sheet asks for: ten from one series, then ten again at once,
share no line, not even one a word or two different; fewer only with the plain reason; a skipped line never comes
back; a mix of a book and a film brings lines from both; a request is at most ten (the phone asks in rounds) and
each round stays inside the free plan's 50 outside calls (storage included); the kept list is tidied by age.
Starts its own fresh servers. "The Lantern Years" is a made-up series (server/devparts/askmore.mjs)."""
import time
from a8lib import *

EVERY = "That's every line I could find from The Lantern Years for now. I'll keep looking."
def ops(reset=False):
    """Storage operations (counted by the health stand-in) and calls to every pretend outside service (askmore.mjs)."""
    o = http("GET", "/__health_ops" + ("?reset=1" if reset else ""))[1]
    c = http("GET", "/__askmore_calls" + ("?reset=1" if reset else ""))[1]
    return {"storage": o["storage"], "outside": c["n"], "what": c["what"]}
def words(t): return [w for w in "".join(c if c.isalnum() else " " for c in t.lower()).split()]
def near(a, b):
    """Two lines with at most two words different (as a bag), as the app counts them."""
    x, y = words(a), words(b)
    if x == y: return True
    most = 0 if min(len(x), len(y)) < 4 else 1 if min(len(x), len(y)) < 6 else 2
    if not most or abs(len(x) - len(y)) > most: return False
    from collections import Counter
    cx, cy = Counter(x), Counter(y)
    return sum((cy - cx).values()) <= most and sum((cx - cy).values()) <= most
def find(T, ids, count, about=None):
    """One request as the sheet makes it. Returns (status, the new quotes, what was said, outside calls spent)."""
    ops(reset=True)
    s, b, _ = http("POST", "/api/asked", {"sources": ids, "count": count, "about": about}, T)
    spent = ops()
    if s != 200: return s, [], (b or {}).get("error", "") if isinstance(b, dict) else str(b), spent
    fresh = [next(i for i in b["items"] if i["id"] == f) for f in b.get("fresh") or [] if any(i["id"] == f for i in b["items"])]
    return s, fresh, b.get("said"), spent
def cost(o): return o["storage"] + o["outside"]

serve()
T = login()
w = add_screen(T, "The Lantern Years", "series")

# ---- 1. ten, then ten again at once
s1, a, said1, o1 = find(T, [w], 10)
s2, b, said2, o2 = find(T, [w], 10)
ta, tb = texts(a), texts(b)
check("ten from the series", s1 == 200 and len(a) == 10 and not said1, (s1, len(a), said1))
check("ten again at once: ten new ones", s2 == 200 and len(b) == 10, (s2, len(b), said2))
check("no line twice", not set(ta) & set(tb), set(ta) & set(tb))
check("and none a word or two away from one already shown", not [(x, y) for x in ta for y in tb if near(x, y)])
check("each knows its work", all(i.get("workId") == w for i in a + b), [i.get("workId") for i in a + b][:3])
spent = doc("asked-shown") or {}
check("what was shown is noted under the work", len(((spent.get("works") or {}).get(w) or {}).get("t", [])) == 20, list((spent.get("works") or {}).keys()))

# ---- 2. a skipped line never returns; a near-duplicate of a shown line is not offered
skipped = a[0]
s, r, _ = http("POST", f"/api/asked/{skipped['id']}/feedback", {"action": "rejected"}, T)
check("skipped", s == 200, r)
lib = doc("library")
twin = tb[0].rstrip(".") + " tonight."                 # one word more than a line she was shown
for x in lib["screen"]:
    if x["id"] == w: x["found"]["lines"].append({"text": twin, "by": "Edith", "url": "https://en.wikiquote.org/wiki/The_Lantern_Years", "site": "wikiquote.org"})
putdoc("library", lib)
later, saids, rounds = [], [], []
for _ in range(6):
    s, got, said, o = find(T, [w], 10)
    rounds.append((s, len(got), said, cost(o)))
    later += texts(got)
    if said: saids.append((len(got), said))
    if s != 200 or not got: break
check("the skipped line never comes back", skipped["text"] not in later)
check("nor the line a word away from one shown", twin not in later, twin)
allt = ta + tb + later
check("over every ask, no line twice and no two near the same", len(allt) == len(set(allt)) and not [(x, y) for i, x in enumerate(allt) for y in allt[i + 1:] if near(x, y)], len(allt))
short = [r for r in rounds if r[0] == 200 and r[1] < 10]
check("fewer than asked only with the plain reason", short and all(r[2] == EVERY for r in short), rounds)
check("and at the end, nothing more, said plainly (not an error)", rounds[-1][0] == 200 and rounds[-1][1] == 0 and rounds[-1][2] == EVERY, rounds[-1])
check("every line on the page was found in the end", len(set(allt)) >= 36, len(set(allt)))
print("   rounds of ten after the first two:", [r[:2] for r in rounds])

# ---- 3. a request is at most ten; the phone's rounds of five for twenty, each inside the free plan's 50
s, big, _, ob = find(T, [add_screen(T, "Harbour Lights", "series")], 20)
check("a request for twenty brings at most ten (the phone asks again)", s == 200 and len(big) <= 10, (s, len(big)))

serve("GEMINI=on", "OPENAI=on")          # every place to look switched on: the costliest looks
T = login()
w = add_screen(T, "The Lantern Years", "series")
got, costs = [], []
for _ in range(4):
    s, fresh, said, o = find(T, [w], 5)
    costs.append((cost(o), o["storage"], o["outside"]))
    got += fresh
    if s != 200 or said or not fresh: break
check("twenty in four rounds of five", len(got) == 20 and len(set(texts(got))) == 20, (len(got), costs))
check("each round inside the free plan's 50 outside calls, storage included", max(c[0] for c in costs) <= 45, costs)
print("   twenty in rounds of five, calls per round (all, storage, outside):", costs)
# the costliest single request: four works never looked up, all at once
ids = [add_book(T, "The Long Tide", "Jonas Reed"), add_screen(T, "Small Hours", "film"), add_screen(T, "Harbour Lights", "series"), add_book(T, "Glass Rivers", "Ana Vale")]
s, fresh, said, o = find(T, ids, 10)
check(f"four works never looked up, in one request: {cost(o)} calls (aim: under 50)", s == 200 and cost(o) <= 48, (s, o))

# ---- 4. a mix of a book and a film brings lines from both
serve()
T = login()
book, film = add_book(T, "The Long Tide", "Jonas Reed"), add_screen(T, "Small Hours", "film")
s, mix, said, _ = find(T, [book, film], 5)
kinds = {i["source"]["type"] for i in mix}
check("a mix of a book and a film: lines from both", s == 200 and {"book", "film"} <= kinds, (s, [(i["source"]["type"], i["text"][:30]) for i in mix], said))
check("each marked with its own work", {i.get("workId") for i in mix} == {book, film}, [i.get("workId") for i in mix])

# ---- 5. the kept list is tidied: older than 30 days, or used more than a week ago
old = doc("asked")
now = int(time.time() * 1000)
old[0]["askedAt"] = now - 31 * DAY
old[1]["state"], old[1]["usedAt"] = "used", now - 8 * DAY
gone = {old[0]["id"], old[1]["id"]}
putdoc("asked", old)
s, b, _ = http("GET", "/api/asked", token=T)
check("the list leaves out a quote older than 30 days and one used more than a week ago", s == 200 and not gone & {i["id"] for i in b["items"]}, s)
finish()

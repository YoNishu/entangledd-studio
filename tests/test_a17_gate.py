"""Agent 17: a quote is something said IN the work, never something said ABOUT it, end to end on the stand-in server.
1. A made-up 2025 series, "Bright Bloom", whose results are a Wikipedia-like page (episode list, reception, a list of
   references with a cited headline), the same page as plain text (as a search service sends pages), and a fan
   blog. Claude picks nothing from the pages (the path the True Beauty headline took), so the app's own reader
   takes the candidates: nothing from the references, the episode list, the reception, a review or the tagline is
   kept or offered; the real lines are. The judge is asked once, with only the work's title and the lines.
   The trail, /api/lookups and the open health line count what the gate refused, and why; no line in the open one.
2. Nishiii cannot be asked: only lines with proof in the page's own structure would stay; here none has it.
3. The one-off clean-up (timed job "lines-gate"): planted "about" lines go from the Library, the engine's bank, the
   asked list and the unused suggestions of today and the week; the real lines stay, marked; each run is cheap;
   a second pass asks nothing again. Every work and line here is made up."""
import json, time
from a8lib import *
from a6lib import ops, india_day

SECRET = "PRIVATE-NOTE-only-hers"
def judged(reset=True): return [e for e in http("GET", "/__said_log" + ("?reset=1" if reset else ""))[1] if e.get("to") == "judge"]
def texts(wid): return [l["text"] for l in kept(wid)]
def known(wid):
    """As the title check leaves a work it identified: its year, country, cast and characters."""
    lib = doc("library")
    for x in lib["screen"]:
        if x["id"] == wid:
            x["known"] = {"title": "Bright Bloom", "real": "Bright Bloom", "year": 2025, "country": "South Korean", "kind": "series",
                          "cast": ["Park Eun-bin", "Kim Do-yoon"], "characters": ["Han Yeo-reum", "Seo Ji-an"]}
    putdoc("library", lib)
ABOUT_WORDS = ("hailed", "Viewers cannot", "shop opened again", "flowers only open", "quiet triumph", "fans will treasure", "Every flower opens", "Seoul Daily")

# ---- 1. the look-up, with Claude picking nothing
serve("OPEN_SEARCH=on", "CLAUDE_PICKS=none")
T = login()
putdoc("taste", {"profile": {"summary": "PRIVATE-SUMMARY", "loves": ["PRIVATE-LOVES"], "avoids": [], "voice": [], "saidTo": "you"}, "notes": [{"id": "n1", "text": SECRET, "at": 1}], "updatedAt": 1})
w = add_screen(T, "Bright Bloom", "series")
known(w)
judged()
s, got = ask(T, [w], 4)
lines = texts(w)
check("the look-up keeps the real lines", s == 200 and "I water the flowers you left, every single morning." in lines and "Some roots hold on longest in the coldest ground." in lines
      and "Maybe we were never late, maybe the spring came early." in lines, (s, lines))
check("with the speakers the blog names", {l["text"]: l.get("by") for l in kept(w)}.get("I water the flowers you left, every single morning.") == "Han Yeo-reum", kept(w))
check("nothing from the references, the episode list, the reception, a review or the tagline is kept", not any(a in t for t in lines for a in ABOUT_WORDS), lines)
offered = [i["text"] for i in got] if s == 200 else []
check("or offered to her", offered and not any(a in t for t in offered for a in ABOUT_WORDS) and not any(t.startswith("From the series") for t in offered), offered)
check("every kept line is marked judged", all(l.get("is") in ("said", "narration") for l in kept(w)), kept(w))
q = judged()
check("the judge was asked once for the whole look-up", len(q) == 1 and len(q[0]["lines"]) >= 3, q)
check("with only the work's public title and kind and the lines, nothing of hers", q and q[0]["work"].startswith("Work: the ") and "Bright Bloom" in q[0]["work"]
      and not any(x in q[0]["all"] for x in (SECRET, "PRIVATE-", "Dhruuu")), q and q[0]["all"])
trail = (work(w).get("found") or {}).get("trail") or {}
gate = trail.get("gate") or {}
check("the trail counts what the gate refused, and why", gate.get("how") == "claude" and gate.get("refused", {}).get("a citation", 0) >= 1
      and gate.get("refused", {}).get("judged about the work", 0) == 1 and gate.get("refused", {}).get("a tagline", 0) == 1 and gate.get("kept") == len(lines), gate)
s2, look, _ = http("GET", "/api/lookups", token=T)
last = (look or {}).get("trails", [{}])[0]
check("/api/lookups shows it too, in counts and words", s2 == 200 and (last.get("gate") or {}).get("refused") == gate.get("refused") and "gate: " in last.get("text", "") and "refused" in last.get("text", ""), last)
s3, h, _ = http("GET", "/api/health")
said = ((h or {}).get("lastLookup") or {}).get("said", "")
check("the open health line counts the gate's refusals", "gate: " in said and "a citation" in said and "judged by Nishiii" in said, said)
check("with no line and no title in it", not any(x in json.dumps(h) for x in ("Bright", "flowers", "hailed", "roots")), said)

# ---- 2. Nishiii cannot be asked: no line without proof in the page's own structure
serve("OPEN_SEARCH=on", "CLAUDE_PICKS=none", "SAID=down")
T = login()
w = add_screen(T, "Bright Bloom", "series")
known(w)
s, got = ask(T, [w], 4)
g2 = ((work(w).get("found") or {}).get("trail") or {}).get("gate") or {}
check("the judge down: only lines a character of the work is named for stay", sorted(texts(w)) == sorted(t for t, _ in [("I water the flowers you left, every single morning.", 0), ("Some roots hold on longest in the coldest ground.", 0)])
      and all(l.get("is") == "structure" for l in kept(w)), kept(w))
check("the rest are marked out and counted", g2.get("how") == "structure" and g2.get("refused", {}).get("no proof without nishiii", 0) == 2, g2)

# ---- 3. the one-off clean-up of what was kept before the gate
serve()
T = login()
w = add_screen(T, "Bright Bloom", "series")
now = int(time.time() * 1000)
REAL = [("I water the flowers you left, every single morning.", "Han Yeo-reum"), ("Some roots hold on longest in the coldest ground.", "Seo Ji-an")]
ABOUT = [("K-dramas based on webtoons hailed by TV viewers", ""), ("From the series Bright Bloom", ""), ("A gentle story that fans will treasure for years.", "")]
lib = doc("library")
for x in lib["screen"]:
    if x["id"] == w:
        x["found"] = {"at": now, "v": 5, "added": 5, "lines": [{"text": t, "by": b, "url": "https://example.org/bloom", "site": "example.org", "verify": True, "theme": "", "tone": ""} for t, b in REAL + ABOUT]}
putdoc("library", lib)
bank = {"v": 1, "lines": [{"text": "We are not late; we are only on our way.", "by": "Teo Brandt", "work": "Northbound", "type": "book", "from": "discover", "at": now},
                          {"text": "This book broke me in the best way, five stars.", "by": "", "work": "Northbound", "type": "book", "from": "discover", "at": now},
                          {"text": "Critics hailed it as the novel of the decade.", "by": "Someone", "work": "Northbound", "type": "book", "from": "discover", "at": now}],
        "asked": {}, "tried": {}, "day": "", "used": {}}
putdoc("engine/bank", bank)
item = lambda i, t, a, title, state="new": {"id": i, "state": state, "text": t, "author": a, "source": {"type": "series", "title": title}, "theme": "", "tone": "", "verify": True}
putdoc("asked", [item("a1", REAL[0][0], REAL[0][1], "Bright Bloom"), item("a2", "Viewers cannot stop talking about the ending of the flower shop drama", "", "Bright Bloom")])
putdoc(f"suggestions/{india_day()}", [item("s1", REAL[1][0], REAL[1][1], "Bright Bloom"), item("s2", "From the series Bright Bloom", "", "Bright Bloom"),
                                      item("s3", "The 25 Best K-Dramas on Viki", "", "Bright Bloom", "used")])
putdoc(f"suggestions/{india_day(-2)}", [item("d1", "A gentle story that fans will treasure for years.", "", "Bright Bloom"), item("d2", "Some roots hold on longest in the coldest ground.", "Seo Ji-an", "Bright Bloom")])
NAMES = ["instagram-renew", "health-check", "scorer", "lovenotes-deliveries", "upkeep-clean", "upkeep-backup", "upkeep-drafts", "health-services", "health-page",
         "engine-tags", "engine-found", "engine-discover", "engine-echo"]
judged()
costs, runs = [], 0
for runs in range(1, 16):
    t = http("GET", "/__upkeep_now")[1]["now"]
    putdoc("jobstamps", {**{n: t for n in NAMES}, "lines-gate": 0})
    ops(reset=True)
    cron()
    c = ops(); costs.append(c["storage"] + c["outside"])
    if (doc("linegate") or {}).get("done"): break
mark = doc("linegate") or {}
check("the clean-up finishes, one store or one day a run", mark.get("done") is True and runs <= 13, (runs, mark))
check("each run is cheap: under twenty calls, the timer's own included", max(costs) <= 20, costs)
left = texts(w)
check("the Library keeps the real lines, marked judged", left == [t for t, _ in REAL] and all(l.get("is") for l in kept(w)), kept(w))
check("and drops the headline, the label and the review", not any(t in left for t, _ in ABOUT), left)
b = doc("engine/bank")
check("the engine's bank keeps the real line and drops the review and the critics' words", [l["text"] for l in b["lines"]] == ["We are not late; we are only on our way."] and b["lines"][0].get("is"), b["lines"])
check("the asked list keeps the real line only", [i["id"] for i in doc("asked")] == ["a1"], doc("asked"))
check("today's suggestions: the real line stays, the label goes, one she used is left alone", [i["id"] for i in doc(f"suggestions/{india_day()}")] == ["s1", "s3"], doc(f"suggestions/{india_day()}"))
check("an earlier day of the week is cleaned too", [i["id"] for i in doc(f"suggestions/{india_day(-2)}")] == ["d2"], doc(f"suggestions/{india_day(-2)}"))
check("the clean-up's counts are kept", mark.get("dropped") == 8 and sum(mark.get("refused", {}).values()) == 8 and mark.get("refused", {}).get("judged about the work") == 2, mark)
s, look, _ = http("GET", "/api/lookups", token=T)
check("and shown on /api/lookups", (look.get("cleanup") or {}).get("done") is True and look["cleanup"]["dropped"] == 8, look.get("cleanup"))
n = len(judged())
check("the judge was asked a few times in all, one batch per store", 1 <= n <= 6, n)
putdoc("linegate", {**mark, "done": False, "phase": 0, "day": 0})       # as if it ran again: nothing is judged twice
for _ in range(13):
    t = http("GET", "/__upkeep_now")[1]["now"]
    putdoc("jobstamps", {**{n: t for n in NAMES}, "lines-gate": 0})
    cron()
    if (doc("linegate") or {}).get("done"): break
check("a second pass asks the judge nothing: every line is marked", judged() == [] and texts(w) == [t for t, _ in REAL], texts(w))
finish()

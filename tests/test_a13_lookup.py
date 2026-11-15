"""Agent 13: quotes from a new series, end to end on the stand-in server, built from the shapes of the real pages
seen on the live run (tests/live): a lower-case title of a new Chinese series, never checked; Wikipedia has two
works of that name (the new one with no short description yet, only its opening words and cast list); MyDramaList's
search finds it by title and year and its reviews quote the lines inline ("Jiang Yu: ..."). With Nishiii switched
off, the app's own extractor picks the lines. The open health record shows how the last look went, coarsely, with
no title and no line. Every work here is made up."""
import json, time
from a8lib import *

def olog(reset=True): return http("GET", "/__open_log" + ("?reset=1" if reset else ""))[1]
def steps(wid): return ((work(wid).get("found") or {}).get("trail") or {}).get("steps", [])

REVIEWS = ("Story 9.0 Acting/Cast 9.0 Music 8.0 Rewatch Value 8.0 This review may contain spoilers Slow, gentle and true.. Oh my heart.. Significant Quotes "
           "Jiang Yu: You don’t have to hurry to arrive where you belong. Lin Qing: I kept every letter, even the ones I never sent. 💗The Harvest💗 "
           "\"Some things only grow when no one is watching them. That is why I waited.\"")

# ---- 1. Nishiii switched off: the series is identified, then MyDramaList's reviews give the lines
serve("CLAUDE=off")
T = login()
w = add_screen(T, "the quiet orchard", "series", checked=False)
olog()
s, got = ask(T, [w], 3)
x = work(w)
k = x.get("known") or {}
check("the work is identified first, as the 2026 Chinese series (not the 2011 one)", k.get("real") == "The Quiet Orchard" and k.get("year") == 2026 and k.get("country") == "Chinese" and k.get("kind") == "series", k)
check("with its original and romanised titles, its cast, characters and network", k.get("original") == "静果园" and "Jing Guo Yuan" in (k.get("aka") or [])
      and "Wen Lu" in (k.get("cast") or []) and (k.get("characters") or [])[:2] == ["Jiang Yu", "Lin Qing"] and k.get("network") == "Youku", k)
title_step = next((st for st in steps(w) if st.get("where") == "title"), {})
check("the trail says which of the two works was chosen", "most recent of 2" in (title_step.get("why") or ""), title_step)
lines = {l["text"]: l for l in kept(w)}
check("three real lines kept, read on MyDramaList's reviews", s == 200 and len(lines) == 3 and all(l["site"] == "mydramalist.com" and l["url"].endswith("/7702-jing-guo-yuan/reviews") for l in lines.values()), (s, kept(w)))
check("with the speaker the page gives", (lines.get("You don't have to hurry to arrive where you belong.") or {}).get("by") == "Jiang Yu" and (lines.get("I kept every letter, even the ones I never sent.") or {}).get("by") == "Lin Qing", lines)
check("each marked to check: one page only", all(l["verify"] is True for l in lines.values()), lines)
check("a line the page credits to someone else (a famous author) stays out", not any("Tolstoy" in t or "plans and projects" in t for t in lines), list(lines))
check("nothing from a script on the page", not any("Not a line" in t for t in lines), list(lines))
check("every kept line is on the page word for word", all(t.replace("’", "'") in REVIEWS.replace("’", "'") for t in lines), list(lines))
check("the suggestions she gets are those lines", s == 200 and got and all(i["text"] in lines for i in got), got)
log = olog()
mdl = [e for e in log if e["to"] == "mdl"]
check("MyDramaList asked twice: its search, with the proper title only, then the reviews", [e["path"] for e in mdl] == ["/search", "/7702-jing-guo-yuan/reviews"] and mdl[0]["query"] == {"q": "The Quiet Orchard"}, mdl)
check("as the app, saying who asks", all(e["agent"].startswith("DsStudio/1.0") for e in mdl), mdl)

# ---- 2. The open health record: the last look, coarsely
s, h, _ = http("GET", "/api/health")
last = (h or {}).get("lastLookup") or {}
check("/api/health, with no sign-in, says how the last look went", s == 200 and last.get("identified") is True and last.get("kind") == "series" and last.get("year") == 2026 and last.get("kept") == 3, last)
check("in words: each step and its counts", "work identified: yes (series, 2026)" in last.get("said", "") and "mydramalist: found (3)" in last.get("said", "") and "lines kept: 3" in last.get("said", ""), last)
blob = json.dumps(h, ensure_ascii=False).lower()
check("no title and no line in it", "orchard" not in blob and "letter" not in blob and "hurry" not in blob and "jiang" not in blob, last)

# ---- 3. An older Library item: checked hours ago without a result, a look that found nothing, a "Did you mean" waiting
serve("CLAUDE=off")
T = login()
w = add_screen(T, "the quiet orchard", "series")
lib = doc("library")
for i in lib["screen"]:
    if i["id"] == w:
        i["titleChecked"] = int(time.time() * 1000) - 3 * 3600 * 1000
        i["maybe"] = {"title": "The Quiet Orchards", "kind": "series", "year": 2009}
        i["found"] = {"at": int(time.time() * 1000) - 3 * 3600 * 1000, "lines": [], "tries": 1, "added": 0}
putdoc("library", lib)
s, got = ask(T, [w], 3)
x = work(w)
check("the title is checked again at the look, and the work identified", (x.get("known") or {}).get("year") == 2026, x.get("known"))
check("the offer that is no longer needed goes", not x.get("maybe"), x.get("maybe"))
check("and the lines are found", len(kept(w)) == 3, kept(w))

# ---- 4. Nishiii on: Claude picks first; whatever it picks is kept only when it is on the page
serve()
T = login()
w = add_screen(T, "The Quiet Orchard", "series", checked=False)
s, got = ask(T, [w], 3)
texts = [l["text"] for l in kept(w)]
check("with Nishiii, only lines that are on the page are kept, the made-up one never", s == 200 and texts and all(t.replace("’", "'") in REVIEWS.replace("’", "'") or "pacing" in t for t in texts)
      and "The Quiet Orchard (2026) Reviews" not in texts
      and not any("on no page at all" in t for t in texts), texts)

# ---- 5. Claude answers, but picks nothing, or only a line that is on no page: the app's own reader takes over
for picks in ("none", "offpage"):
    serve(f"CLAUDE_PICKS={picks}")
    T = login()
    w = add_screen(T, "The Quiet Orchard", "series", checked=False)
    olog()
    s, got = ask(T, [w], 3)
    asked = [e for e in olog() if e["to"] == "claude"]
    texts = [l["text"] for l in kept(w)]
    check(f"Claude asked first ({picks}), then the lines come from the page itself", s == 200 and asked and "I kept every letter, even the ones I never sent." in texts
          and not any("made up whole" in t for t in texts), (s, len(asked), texts))

finish()

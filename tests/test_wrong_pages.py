"""What the real service showed on 16 Nov 2026: through Tavily's Extract, some review pages of a drama came back as a
short other page (a news item), the app took them as read, and after three such "pages with nothing" it stopped
reading the reviews for good: 15 lines found where there were more. Now a page that does not name the work's own
address is not taken as read: it is asked for again in a later round (more thoroughly), and it is no sign that the
reviews are over. Also from that run: a reviewer's aside inside a quoted line ("(ICK!)") is not part of the line.
"The Willow Station" is the stand-in's made-up drama (server/devparts/extract.mjs): 30 review pages, 40 real lines."""
import json
from a8lib import *

def xlog(reset=True): return http("GET", "/__extract_log" + ("?reset=1" if reset else ""))[1]

serve("WEBSEARCH=unset", "TAVILY=on", "OPEN_SEARCH=off")
T = login()
http("GET", "/__extract_set?mode=wrong")                   # review pages 2, 4 and 9 come back wrong the first time
w = add_screen(T, "The Willow Station", "series")
got, left = [], True
for _ in range(30):
    s, b, _ = http("POST", "/api/asked", {"sources": [w], "count": 5}, T)
    assert s == 200, (s, b)
    fresh = [i for i in b["items"] if i["id"] in (b.get("fresh") or []) and i.get("src") != "memory"]
    got += fresh
    left = b.get("left")
    if not fresh and not left: break
lib = doc("library"); work = next(i for i in lib["screen"] if i["id"] == w)
mdl = work["found"]["more"]["mdl"]
ext = [e for e in xlog() if "urls" in e]
asked = [u for e in ext for u in e["urls"]]
again = [e for e in ext if e["body"].get("extract_depth") == "advanced"]
check("the pages that came back wrong were asked for again", all(sum(1 for u in asked if u.endswith(f"reviews?page={n}")) >= 2 for n in (2, 4, 9)), [u for u in asked if u.endswith(("page=2", "page=4", "page=9"))])
check("the second time more thoroughly, and only those pages", len(again) >= 1 and all(u.endswith(("page=2", "page=4", "page=9")) for e in again for u in e["urls"]), [e["urls"] for e in again])
check("a wrong page is no sign that the reviews are over: all 30 pages are read", mdl.get("done") and mdl["next"] == 31 and not mdl.get("bad"), mdl)
check("so every real line is found, the ones on those pages too: all 40", len(work["found"]["lines"]) == 40, len(work["found"]["lines"]))
check("nothing from the wrong page is offered as a line", not any("relief" in l["text"] or "Hundred Days" in l["text"] for l in work["found"]["lines"]))
finish()

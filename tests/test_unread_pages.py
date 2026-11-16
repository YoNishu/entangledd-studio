"""Her case of 16 Nov, 7:30 am: the pages of a work could not be read (the reader's day was almost used up, and the
one page asked for failed), and the app said "That's every line I could find". It was not: pages were left. Now a
round in which no page could be read says so and keeps the list; and a reading list made under the old rules
(closed too soon) starts afresh. Run: python3 tests/test_unread_pages.py"""
from a8lib import *

serve("WEBSEARCH=unset", "TAVILY=on", "OPEN_SEARCH=off")
T = login()
w = add_screen(T, "The Willow Station", "series")
s, b, _ = http("POST", "/api/asked", {"sources": [w], "count": 5}, T)
check("a first round finds lines", s == 200 and len(b.get("fresh") or []) >= 3, (s, b.get("said")))

# The reader fails on every page from now on (the stand-in answers that it cannot be asked: status 500).
http("GET", "/__extract_set?mode=down")
s, b, _ = http("POST", "/api/asked", {"sources": [w], "count": 5}, T)
said = (b.get("said") or "") if isinstance(b, dict) else str(b)
check("no page could be read: she is not told that every line was found", s == 200 and "every line" not in said, (s, said))
check("she is told the pages would not open, and that there is more", "wouldn't open" in said or "tomorrow" in said or "resting" in said, said)
mdl = next(i for i in doc("library")["screen"] if i["id"] == w)["found"]["more"]["mdl"]
check("the reading list is kept as it was: not closed", not mdl.get("done"), mdl)

# A list closed under the old rules (an older version of the look-up): it starts afresh.
http("GET", "/__extract_set?mode=")
lib = doc("library"); x = next(i for i in lib["screen"] if i["id"] == w)
x["found"]["v"] = 7; x["found"]["more"]["mdl"].update({"done": True, "quiet": 3, "next": 31}); x["found"]["more"]["pages"] = []; x["found"].pop("wait", None)
putdoc("library", lib)
got = 0
for _ in range(8):
    s, b, _ = http("POST", "/api/asked", {"sources": [w], "count": 5}, T)
    got += len(b.get("fresh") or []) if s == 200 else 0
    if got >= 10: break
mdl = next(i for i in doc("library")["screen"] if i["id"] == w)["found"]["more"]["mdl"]
check("a list closed under the old rules starts afresh and gives new lines again", got >= 10 and not mdl.get("done") and 3 < mdl.get("next", 0) < 31, (got, mdl))
finish()

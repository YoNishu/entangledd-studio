"""Her case of 16 Nov: for a new drama the search (Tavily) answered a plain question with sign-in sites and the
drama's Wikipedia page only, so no line was found. Now the sites where lines are written down are asked for first,
by name, and Wikipedia is not read for lines (its page has a plot and a list of sources, never the lines).
"Harbour in March" is a made-up 2026 Chinese drama of the stand-in."""
import json
from a8lib import *

def olog(reset=True): return http("GET", "/__open_log" + ("?reset=1" if reset else ""))[1]

serve("WEBSEARCH=unset", "TAVILY=on", "OPEN_SEARCH=off")
T = login()
w = add_screen(T, "Harbour in March", "series")
lib = doc("library"); x = next(i for i in lib["screen"] if i["id"] == w)
x["known"] = {"title": "Harbour in March", "real": "Harbour in March", "original": "三月的港", "year": 2026, "kind": "series", "country": "Chinese", "characters": ["Xu Wan", "Han Zhou"], "cast": ["Lin Qiao", "Shen Mo"]}
putdoc("library", lib)
olog()
s, got = ask(T, [w], 3)
tv = [x for x in olog() if x["to"] == "tavily"]
texts = [l["text"] for l in kept(w)]
check("the first question names the sites where lines are written down", len(tv) >= 1 and "mydramalist.com" in (tv[0]["body"].get("include_domains") or []) and "Harbour in March" in tv[0]["body"]["query"], tv[0]["body"] if tv else None)
check("at most two questions to Tavily; the plain one leaves out the sites the app cannot read lines from", len(tv) <= 2 and all("wikipedia.org" in (t["body"].get("exclude_domains") or []) for t in tv[1:]), [t["body"] for t in tv])
check("real lines are found and kept, from the reviews page", s == 200 and "You can leave a harbour, but it keeps your place." in texts and "I waited for the tide so long that I forgot I could swim." in texts, (s, got, texts))
check("each with who says it", {l["text"]: l.get("by") for l in kept(w)}.get("You can leave a harbour, but it keeps your place.") == "Xu Wan", kept(w))
check("a source's title and a reviewer's own words are not among them", not any("second wind" in t or "spring line-up" in t or "pacing" in t or "8/10" in t for t in texts), texts)
check("she is shown lines, not the message that nothing was found", s == 200 and isinstance(got, list) and len(got) >= 2 and all(i["source"].get("site") == "mydramalist.com" for i in got if i.get("src") != "memory"), got)
check("nothing personal goes to Tavily", "letmein" not in json.dumps(tv) and "Dhruuu" not in json.dumps(tv))
finish()

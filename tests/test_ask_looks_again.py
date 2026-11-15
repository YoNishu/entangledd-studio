"""Her own request always looks a work up, whatever earlier looks recorded: after several looks that found
nothing (when the app would wait 30 days by itself), asking for quotes from that work looks again and finds them."""
import time
from a8lib import *

serve("CLAUDE=off")
T = login()
w = add_screen(T, "the quiet orchard", "series", checked=False)
# as it was left by the older ways of looking: five tries, nothing found, ten minutes ago, no version
lib = doc("library")
for x in lib["screen"]:
    if x["id"] == w:
        x["found"] = {"at": int(time.time() * 1000) - 10 * 60 * 1000, "added": 0, "lines": [], "tries": 5,
                      "trail": {"at": 0, "said": "Looked on Wikiquote: nothing yet.", "steps": []}}
putdoc("library", lib)
s, got = ask(T, [w], 3)
check("asked again after five empty looks: it looks, and finds the lines", s == 200 and len(kept(w)) >= 3 and got and len(got) >= 1, (s, got))
check("the look is stamped with the current way of looking", (work(w).get("found") or {}).get("v") is not None, work(w).get("found"))
pub = http("GET", "/api/health")[1]
check("the open record shows that last look", bool(pub.get("lastLookup")) and pub["lastLookup"].get("kept", 0) >= 3, pub.get("lastLookup"))
finish()

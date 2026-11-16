"""Nishiii quotes from memory only what Nishiii can know: never a work newer than 2024 (what came back would be
invented, not remembered); for an older work memory fills in when the web gives nothing.
Run: python3 tests/test_memory_rule.py"""
from a8lib import *

serve("WEBSEARCH=unset", "OPEN_SEARCH=off", "QUOTE_SITES=off")
T = login()
def with_year(title, year):
    w = add_screen(T, title, "series")
    lib = doc("library"); x = next(i for i in lib["screen"] if i["id"] == w)
    x["known"] = {"title": title, "real": title, "year": year, "kind": "series", "country": "", "characters": [], "cast": []}
    putdoc("library", lib)
    return w
new = with_year("Nobody Knows This One Yet", 2026)
s, b, _ = http("POST", "/api/asked", {"sources": [new], "count": 5}, T)
items = b.get("items") or [] if isinstance(b, dict) else []
check("a 2026 work with nothing on the web: no line from memory is offered", not [i for i in items if i.get("workId") == new], (s, b))
check("she is told plainly that none was found", s in (200, 502) and ("found no real lines" in str(b) or "every line" in str(b)), (s, b))
old = with_year("Glass Rivers", 2019)
s, b, _ = http("POST", "/api/asked", {"sources": [old], "count": 5}, T)
mine = [i for i in (b.get("items") or []) if i.get("workId") == old]
check("a 2019 work with nothing on the web: Nishiii's memory fills in, marked to check", s == 200 and len(mine) >= 3 and all(i.get("verify") for i in mine), (s, b))
finish()

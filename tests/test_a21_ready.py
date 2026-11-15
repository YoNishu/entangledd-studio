"""Lines ready before she asks (Agent 21). When she adds a book, film or series, the phone has its first pages read
at once (POST /api/library/<kind>/<id>/look, right after the title check), so her first ask for 10 is answered at
once, with nothing more to read for it. The timed look (engine-found) reads one more round for a work with fewer
than 20 lines she has not been shown. A made-up book's further Goodreads quotes pages are read the same way.
"The Willow Station" and "Lanterns for the Tide" are made up (server/devparts/extract.mjs)."""
from a8lib import *
from a6lib import settle, run_only

def xlog(reset=True): return http("GET", "/__extract_log" + ("?reset=1" if reset else ""))[1]
def calls(reset=False): return http("GET", "/__askmore_calls" + ("?reset=1" if reset else ""))[1]

serve("WEBSEARCH=unset", "TAVILY=on", "OPEN_SEARCH=off")
T = login()
w = add_screen(T, "The Willow Station", "series")
lib = doc("library"); x = next(i for i in lib["screen"] if i["id"] == w)
x["known"] = {"title": "The Willow Station", "real": "The Willow Station", "original": "柳站", "year": 2026, "kind": "series", "country": "Chinese",
              "characters": ["Su Qing", "Gu Yan"], "cast": ["Mei Lin", "Zhao Feng"]}
putdoc("library", lib)
xlog()

# ---- 1. added: its first pages are read at once
def ops(reset=False):
    o = http("GET", "/__health_ops" + ("?reset=1" if reset else ""))[1]
    return o["storage"] + calls(reset)["n"]
ops(reset=True)
s, b, _ = http("POST", f"/api/library/screen/{w}/look", {}, T)
cost = ops()
print("  outside calls of that look (storage included):", cost)
check("that look stays under 50 outside calls", cost < 50, cost)
read = [u for e in xlog() if "urls" in e for u in e["urls"]]
n0 = len(kept(w))
print("  lines ready after adding it:", n0, "; pages read through Extract:", len(read))
check("the look after adding it answers", s == 200, (s, str(b)[:200]))
check("it reads its first pages: the reviews page 1 and the next ones", any(u.endswith("/reviews") for u in read) and any("?page=2" in u for u in read), read)
check("at least ten real lines are ready", n0 >= 10, n0)

# ---- 2. her first ask for 10 is answered at once
calls(reset=True); xlog()
s, got = ask(T, [w], 10)
spent = [c for c in calls()["what"] if c.split("/")[0] in ("__tavily", "__mdl")]
check("her first ask for 10: ten lines", s == 200 and len(got) == 10, (s, got if isinstance(got, str) else len(got)))
check("answered from what was ready: nothing more read for it", not spent, spent)
check("all from the drama's pages, none from memory", isinstance(got, list) and all(i.get("src") != "memory" for i in got), got[:2] if isinstance(got, list) else got)

# ---- 3. the timed look reads one more round for a work running low (fewer than 20 unseen lines)
settle()
before = len(kept(w))
xlog()
run_only("engine-found")
after = len(kept(w))
print("  the timed look: kept lines", before, "->", after)
check("the timed look reads more of a work with fewer than 20 lines she has not seen", after > before and any("?page=" in u for e in xlog() if "urls" in e for u in e["urls"]), (before, after))

# ---- 4. a book: its further Goodreads quotes pages, round by round
bk = add_book(T, "Lanterns for the Tide", "Mara Ellison")
xlog()
s, b, _ = http("POST", f"/api/library/books/{bk}/look", {}, T)
gr = [e["own"] for e in xlog() if "own" in e]
f = work(bk).get("found") or {}
print("  the book: kept", len(f.get("lines") or []), "quotes pages", (f.get("more") or {}).get("gr"))
check("the book's first quotes page is read, and its list of pages known", ((f.get("more") or {}).get("gr") or {}).get("last") == 4 and len(f.get("lines") or []) >= 6, f.get("more"))
allb = []
for _ in range(6):
    s, got = ask(T, [bk], 5)
    if s != 200 or not got: break
    allb += texts([i for i in got if i.get("src") != "memory"])
print("  the book's lines over the rounds:", len(allb))
check("its further quotes pages (2 to 4) are read too", all(any(f"page={n}" in u for u in gr) for n in (2, 3, 4)), gr)
check("her asks bring the lines of all four quotes pages, none twice", len(set(allb)) == 24 and len(allb) == 24, len(allb))
finish()

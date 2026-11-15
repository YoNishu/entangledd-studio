"""A work added to the Library is checked on the web (server/verify.js): a title close to a real one is offered
("Did you mean ...?"), never put in her place without her tap; a real title is kept with its author or creator,
year and kind; a title found nowhere stays as she typed it. What is learnt helps the lookups pick the right page
(findlines.js). Every work here is made up."""
from a8lib import *

def verify_log(reset=True): return http("GET", "/__verify_log" + ("?reset=1" if reset else ""))[1]
def title(T, kind, wid, body=None):
    s, b, _ = http("POST", f"/api/library/{kind}/{wid}/title", body or {}, T)
    return s, b
def item(lib, kind, wid): return next(x for x in lib[kind] if x["id"] == wid)

serve("WEBSEARCH=unset")
T = login()

# ---- a misspelt book: offered, not changed
glas = add_book(T, "Glas Rivers")
verify_log()
s, lib = title(T, "books", glas)
x = item(lib, "books", glas)
check("a title close to a real one is offered", s == 200 and (x.get("maybe") or {}).get("title") == "Glass Rivers" and x["maybe"]["year"] == 2014 and x["maybe"]["by"] == "Ana Vale", x)
check("and her title is left as she typed it", x["title"] == "Glas Rivers" and not x.get("author") and not x.get("known") and x.get("titleChecked"), x)
log = verify_log()
check("Open Library was asked first, then Wikipedia", [l["to"] for l in log] == ["openlibrary", "wikipedia"] and log[0]["query"]["title"] == "Glas Rivers", log)
check("nothing but the title went out", all(set(l["query"]) <= {"title", "fields", "limit", "author", "action", "generator", "gsrsearch", "gsrnamespace", "gsrlimit",
      "gsrenablerewrites", "prop", "redirects", "format", "formatversion"} for l in log) and "Glas Rivers" in log[1]["query"]["gsrsearch"], log)
s, lib = title(T, "books", glas, {"accept": True})
x = item(lib, "books", glas)
check("one tap takes the proper title, with its author and year", s == 200 and x["title"] == "Glass Rivers" and x["author"] == "Ana Vale" and x["known"]["year"] == 2014 and not x.get("maybe"), x)

# ---- a real title: kept, with what the web knows
tide = add_screen(T, "The Long Tide", "film")
s, lib = title(T, "screen", tide)
x = item(lib, "screen", tide)
check("a real film keeps her title, and learns its year and director", s == 200 and x["title"] == "The Long Tide" and not x.get("maybe")
      and x["known"]["year"] == 2016 and x["known"]["by"] == "Odile Marchetti" and x["known"]["kind"] == "film", x)
salt = add_book(T, "The Salt Road")
s, lib = title(T, "books", salt)
x = item(lib, "books", salt)
check("a real book found on Open Library is kept as known, without asking her", s == 200 and x["known"]["site"] == "openlibrary.org" and x["known"]["page"].startswith("https://openlibrary.org/works/OL400")
      and not x.get("maybe") and not x.get("author"), x)

# ---- the wrong kind: offered as the other kind
harbour = add_screen(T, "Harbour Lights", "film")
s, lib = title(T, "screen", harbour)
x = item(lib, "screen", harbour)
check("a series added as a film is offered as the series", s == 200 and x["maybe"]["kind"] == "series" and x["maybe"]["title"] == "Harbour Lights" and x["kind"] == "film", x)
s, lib = title(T, "screen", harbour, {"accept": True})
check("accepted, it becomes a series", item(lib, "screen", harbour)["kind"] == "series", item(lib, "screen", harbour))

# ---- "Keep mine"
harbor = add_screen(T, "Harbor Lights Again", "series")
s, lib = title(T, "screen", harbor)
check("a title nothing is close to gets no offer", s == 200 and not item(lib, "screen", harbor).get("maybe"), item(lib, "screen", harbor))
lights = add_screen(T, "Harbor Lights", "series")
s, lib = title(T, "screen", lights)
check("a near miss is offered", (item(lib, "screen", lights).get("maybe") or {}).get("title") == "Harbour Lights", item(lib, "screen", lights))
s, b, _ = http("POST", f"/api/library/screen/{lights}/title", {"accept": True}, T)
check("a correction that would repeat a work already on the list is turned away", s == 409 and "already" in b["error"], (s, b))
s, lib = title(T, "screen", lights, {"keep": True})
x = item(lib, "screen", lights)
check("'Keep mine' keeps her title and drops the offer", s == 200 and x["title"] == "Harbor Lights" and not x.get("maybe") and x.get("titleKept"), x)

# ---- found nowhere
none = add_book(T, "Nothing Online At All", "Someone Unknown")
s, lib = title(T, "books", none)
x = item(lib, "books", none)
check("a title found nowhere stays as she typed it", s == 200 and x["title"] == "Nothing Online At All" and x["author"] == "Someone Unknown" and not x.get("known") and not x.get("maybe"), x)
check("without a key no search helper is asked", not to(calls(), "gemini") and not to(calls(), "openai"))
verify_set = lambda **kw: http("GET", "/__verify_set?" + urllib.parse.urlencode(kw))[1]
verify_set(mode="down")
down = add_book(T, "Winter Orchard")
s, lib = title(T, "books", down)
check("with the free places down, her title is kept and nothing breaks", s == 200 and item(lib, "books", down)["title"] == "Winter Orchard" and item(lib, "books", down).get("titleChecked")
      and doc("lookups")["sites"]["openlibrary"].get("failed"), item(lib, "books", down))
verify_set(mode="ok")
s, b, _ = http("POST", "/api/library/books/nope/title", {}, T)
check("a work no longer on the list is not found", s == 404, (s, b))

# ---- what was learnt picks the right page later
lib = doc("library")
lib["screen"].append({"id": "remake-1", "added": 1, "title": "Quiet Harbour", "kind": "film", "known": {"title": "Quiet Harbour", "year": 2012, "kind": "film", "by": "", "page": "", "site": "wikipedia.org"}})
lib["screen"].append({"id": "old-1", "added": 2, "title": "Quiet Harbour", "kind": "film"})
putdoc("library", lib)
calls()
s, got = ask(T, ["remake-1"], 1)
imdb = [c["path"] for c in to(calls(), "imdb")]
check("a known year picks the right one of two same-named films", s == 200 and "/title/tt7000003/quotes/" in imdb and "/title/tt7000001/quotes/" not in imdb, imdb)
s, got = ask(T, ["old-1"], 1)
imdb = [c["path"] for c in to(calls(), "imdb")]
check("without one, the first is taken as before", "/title/tt7000001/quotes/" in imdb, imdb)
lib = doc("library")
x = next(b for b in lib["books"] if b["id"] == salt)
x["found"] = {"at": 0, "lines": []}
putdoc("library", lib)
lines_set(wikiquote="down"); calls()
s, got = ask(T, [salt], 2)
gr = [c["path"] for c in to(calls(), "goodreads")]
check("a book's author learnt from the web picks its Goodreads page", "/work/quotes/5550001" in gr and "/work/quotes/5550002" not in gr, gr)

# ---- the search helpers, only when the free places found nothing
serve("WEBSEARCH=unset", "GEMINI=on")
T = login()
glass = add_book(T, "Glass Rivers"); calls()
title(T, "books", glass)
check("a title the free places know never uses a search", not to(calls(), "gemini"))
ledger = add_book(T, "Wintr Ledger")
s, lib = title(T, "books", ledger)
g = to(calls(), "gemini")
x = item(lib, "books", ledger)
check("a title the free places don't know is searched with Gemini", len(g) == 1 and '"Wintr Ledger"' in g[0]["body"]["contents"][0]["parts"][0]["text"], g)
check("and its answer is offered, not applied", s == 200 and x["title"] == "Wintr Ledger" and x["maybe"]["title"] == "The Winter Ledger" and x["maybe"]["year"] == 2017
      and x["maybe"]["page"] == "https://en.wikipedia.org/wiki/The_Winter_Ledger", x)
nobody = add_book(T, "Nobody Knows This Title")
s, lib = title(T, "books", nobody)
check("a search that finds nothing keeps her title", s == 200 and not item(lib, "books", nobody).get("maybe") and item(lib, "books", nobody)["title"] == "Nobody Knows This Title")
check("both searches counted against the day's limit", doc("lookups")["gemini"]["calls"] == 2, doc("lookups")["gemini"])
finish()

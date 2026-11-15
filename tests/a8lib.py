"""Helpers for the checks of where real lines are found (Wikiquote, Goodreads, IMDb, Gemini, OpenAI).
Built on a6lib; every test starts a fresh server. Every work named in these tests is made up."""
import time
from a6lib import *

def mark_checked(wid):
    """As the Library does at once for a title she adds: its title is checked (here: as if nothing was found), so
    a look-up does not check it again first. Tests of the check before a look pass checked=False."""
    lib = doc("library")
    for x in lib["books"] + lib["screen"]:
        if x["id"] == wid: x["titleChecked"] = int(time.time() * 1000)
    putdoc("library", lib)
def add_book(T, title, author="", checked=True):
    s, b, _ = http("POST", "/api/library/books", {"title": title, "author": author}, T)
    assert s == 200, (s, b)
    wid = b["books"][-1]["id"]
    if checked: mark_checked(wid)
    return wid
def add_screen(T, title, kind, checked=True):
    s, b, _ = http("POST", "/api/library/screen", {"title": title, "kind": kind}, T)
    assert s == 200, (s, b)
    wid = b["screen"][-1]["id"]
    if checked: mark_checked(wid)
    return wid
def ask(T, ids, count=5, about=None):
    """Asks for quotes from those Library items. Returns (status, the new quotes or the error text)."""
    before = {i["id"] for i in (http("GET", "/api/asked", token=T)[1] or {}).get("items", [])}
    s, b, _ = http("POST", "/api/asked", {"sources": ids, "count": count, "about": about}, T)
    if s != 200: return s, (b or {}).get("error", "") if isinstance(b, dict) else str(b)
    return s, [i for i in b["items"] if i["id"] not in before]
def calls(reset=True):
    """What the pretend Wikiquote, Goodreads, IMDb, Gemini and OpenAI were asked since the last look."""
    return http("GET", "/__lines_log" + ("?reset=1" if reset else ""))[1]
def to(log, who): return [x for x in log if x["to"] == who]
def lines_set(**kw): return http("GET", "/__lines_set?" + urllib.parse.urlencode(kw))[1]
def work(wid):
    """A book, film or series as the Library holds it."""
    lib = doc("library")
    return next(x for x in lib["books"] + lib["screen"] if x["id"] == wid)
def kept(wid): return (work(wid).get("found") or {}).get("lines", [])
def age_found(wid, days):
    """Makes the lines kept for a work look as if they were found that many days ago."""
    lib = doc("library")
    for x in lib["books"] + lib["screen"]:
        if x["id"] == wid:
            x["found"]["at"] -= int(days * DAY)
            if x["found"].get("first"): x["found"]["first"] -= int(days * DAY)      # when the work was first looked up (what "after 30 days" goes by)
    putdoc("library", lib)
def texts(items): return [i["text"] for i in items]

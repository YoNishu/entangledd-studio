"""Real lines from Wikiquote: the right page for the work, only words that are on that page, the speaker kept,
what is found kept on the work in the Library and used again, and looked up afresh after 30 days."""
from a8lib import *

AGENT = "DsStudio/"
serve("WEBSEARCH=unset")
T = login()

# ---- a film: the film's page, never the novel of the same name
film = add_screen(T, "The Long Tide", "film")
calls()
s, got = ask(T, [film], 3)
log = calls()
check("a film on Wikiquote gives its real lines", s == 200 and len(got) == 3, (s, got))
check("each is marked as found on Wikiquote, with the film's page", all(i["source"].get("site") == "wikiquote.org" and i["source"].get("url") == "https://en.wikiquote.org/wiki/The_Long_Tide_(film)" for i in got), [i["source"] for i in got])
check("and needs no checking", all(i["verify"] is False and i["source"]["type"] == "film" for i in got))
check("the speaker is kept", all(i["author"] in ("Mara", "Captain Ilves") for i in got), [i["author"] for i in got])
check("one search and one page were asked of Wikiquote", [x["query"].get("list") or x["query"].get("prop") for x in to(log, "wikiquote")] == ["search", "extracts|categories"], log)
check("with a User-Agent that says who is asking", all(x["agent"].startswith(AGENT) for x in log), [x["agent"] for x in log])
check("nothing else was asked (Wikiquote gave enough)", len(log) == 2, [x["to"] for x in log])
found = kept(film)
words = " | ".join(l["text"] for l in found)
check("the lines are kept on the film in the Library", 5 <= len(found) <= 30 and work(film)["found"]["page"] == "The Long Tide (film)", len(found))
check("a line that is not on the page is dropped", "on no page at all" not in words, words)
check("nothing from the novel of the same name", "river did not hurry" not in words and "tide table" not in words, words)
check("nothing from the cast, the taglines, what critics said or the links", not any(x in words for x in ("Lena Dvorak", "Some shores wait", "patient film", "Internet Movie Database", "Evening Courier")), words)
check("the page's opening description is not a line", "is a 2016 drama film" not in words, words)
check("stage directions are left out", "[" not in words and any(l["text"].startswith("Nobody teaches you how to return") for l in found), words)
check("lines of dialogue carry who says them", any(l["text"] == "Then it stays on for us." and l["by"] == "Captain Ilves" for l in found), [(l["text"], l["by"]) for l in found])

# ---- kept lines are used again without looking anything up
calls()
s, more = ask(T, [film], 3)
log = calls()
check("a second request is answered from the kept lines", s == 200 and len(more) == 3 and all(i["source"].get("site") == "wikiquote.org" for i in more), (s, more))
check("with different lines", not set(texts(more)) & set(texts(got)), texts(more))
check("and nothing is looked up again", log == [], log)

# ---- when the kept lines run short: one more look, then no more today
s, third = ask(T, [film], 3)
log = calls()
check("running short, Wikiquote is looked at once more", len(to(log, "wikiquote")) == 2, [x["to"] for x in log])
check("what is left of the kept lines is used, and memory fills the rest", s == 200 and any(i["source"].get("site") == "wikiquote.org" for i in third) and any("A line from The Long Tide" in i["text"] for i in third), texts(third))
s, fourth = ask(T, [film], 3)
check("after a look that found nothing new, nothing is looked up again that day", s == 200 and calls() == [], (s, fourth))
age_found(film, 2)
ask(T, [film], 3)
check("the next day it looks again", len(to(calls(), "wikiquote")) == 2)

# ---- after 30 days the kept lines are refreshed even when there are enough
series = add_screen(T, "Harbour Lights", "series")
calls()
s, got = ask(T, [series], 2)
log = calls()
found = kept(series)
check("a long series page gives lines with their speakers", s == 200 and len(got) == 2 and all(i["author"] in ("Ines", "Tobias", "Old Marit", "Jonah") for i in got), (s, got))
check("at most twelve lines are taken from one page", 2 <= len(found) <= 12, len(found))
check("every kept line carries where it came from", all(l["url"].endswith("Harbour_Lights_(TV_series)") and l["site"] == "wikiquote.org" for l in found))
ask(T, [series], 2)
check("enough kept lines: no lookup", calls() == [])
age_found(series, 31)
ask(T, [series], 2)
check("after 30 days: looked up afresh", len(to(calls(), "wikiquote")) == 2)
check("the kept list never grows past 30", len(kept(series)) <= 30, len(kept(series)))

# ---- the same name, another kind of work: never used
other = add_screen(T, "The Long Tide", "series")
calls()
s, got = ask(T, [other], 3)
log = calls()
check("a series with the name of a film and a novel does not get their lines", kept(other) == [] and (s != 200 or not any(i["source"].get("site") == "wikiquote.org" for i in got)), got)
check("its Wikiquote search is made, but no page is read", [x["query"].get("list") or x["query"].get("prop") for x in to(log, "wikiquote")] == ["search"], log)

# ---- a book: its own page when the author is hers, never another author's book of that name
novel = add_book(T, "The Long Tide", "Jonas Reed")
s, got = ask(T, [novel], 2)
check("a book with its own page gives lines from that page", s == 200 and all(i["source"].get("url", "").endswith("The_Long_Tide_(novel)") and i["author"] == "Jonas Reed" for i in got) and len(got) == 2, (s, got))
serve("WEBSEARCH=unset")
T = login()
wrong = add_book(T, "The Long Tide", "Clara Mills")
s, got = ask(T, [wrong], 2)
check("a book of the same name by someone else does not get those lines", s == 200 and not any(i["source"].get("site") for i in got) and kept(wrong) == [], texts(got) if s == 200 else got)

# ---- a page without a note in brackets must say itself what it is
small = add_screen(T, "Small Hours", "film")
s, got = ask(T, [small], 2)
check("a film whose page has no '(film)' is recognised by the page's opening words", s == 200 and all(i["source"].get("url", "").endswith("/Small_Hours") and i["author"] == "Noor" for i in got) and len(got) == 2, (s, got))
show = add_screen(T, "Small Hours", "series")
s, got = ask(T, [show], 2)
check("the same page is not used for a series of that name", s == 200 and kept(show) == [], texts(got) if s == 200 else got)

# ---- her own lines saved from that title come first
http("POST", "/api/library/quotes", {"text": "A line I copied out of the film myself, late one night.", "author": "", "from": "Small Hours"}, T)
s, got = ask(T, [small], 1)
check("a line she saved from that title is used before anything found", s == 200 and got[0]["text"].startswith("A line I copied out") and got[0]["source"]["type"] == "own", (s, got))

# ---- "Not the right one" in the Library
s, lib, _ = http("POST", f"/api/library/screen/{small}/found", {"forget": True}, T)
f = work(small)["found"]
check("'Not the right one' drops the kept lines and remembers the page", s == 200 and f["lines"] == [] and f["not"] == ["Small Hours"], f)
calls()
s, got = ask(T, [small], 2)
check("that page is never read for it again", [x["query"].get("list") or x["query"].get("prop") for x in to(calls(), "wikiquote")] == ["search"] and kept(small) == [], kept(small))

# ---- the daily five may use kept lines, word for word
film = add_screen(T, "The Long Tide", "film")
ask(T, [film], 2)
keptTexts = {l["text"] for l in kept(film)}
s, today, _ = http("GET", "/api/suggestions", token=T)
mine = [i for i in today["items"] if i["text"] in keptTexts]
check("today's five include a line found earlier", s == 200 and len(mine) == 1, texts(today["items"]) if s == 200 else today)
if mine: check("it carries its page and speaker, and needs no checking", mine[0]["source"].get("site") == "wikiquote.org" and mine[0]["verify"] is False and mine[0]["author"] in ("Mara", "Captain Ilves") and mine[0]["source"]["title"] == "The Long Tide", mine[0])

# ---- Wikiquote itself cannot be reached: nothing breaks, it is noted, and it is left alone until tomorrow
serve("WEBSEARCH=unset", "WIKIQUOTE=down")
T = login()
film = add_screen(T, "The Long Tide", "film")
s, got = ask(T, [film], 2)
rec = doc("lookups")
check("with Wikiquote down the request is still answered", s == 200 and len(got) == 2, (s, got))
check("and that is noted for the health record", rec["sites"]["wikiquote"].get("why") == "answered 503" and rec["sites"]["wikiquote"].get("blocked") is True, rec)
second = add_screen(T, "Small Hours", "film")
calls()
ask(T, [second], 2)
check("it is not asked again that day", to(calls(), "wikiquote") == [])
finish()

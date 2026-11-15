"""Quotes on request from particular works: Nishiii may look their lines up on the web.
Starts a fresh server for each case. Prints PASS or FAIL."""
import where as _W
import sys
sys.path.insert(0, f"{_W.HERE}")
from a3lib import check, finish, serve, http, login

def setup():
    T = login()
    s, b, _ = http("POST", "/api/library/screen", {"title": "The Early Spring", "kind": "series"}, T)
    series = b["screen"][-1]["id"]
    s, b, _ = http("POST", "/api/library/books", {"title": "Twisted Love", "author": "Ana Huang"}, T)
    book = b["books"][-1]["id"]
    return T, series, book

def ask(T, ids, count=4, about=None):
    return http("POST", "/api/asked", {"sources": ids, "count": count, "about": about}, T)

# 1. web search on: lines come back with the page they were found on
serve()
T, series, book = setup()
s, b, _ = ask(T, [series, book])
items = (b or {}).get("items", []) if s == 200 else []
check("asking for a series and a modern book works", s == 200 and len(items) >= 4, (s, b))
web = [i for i in items if "found on the web" in i["text"]]
check("the lines came from the web search", len(web) == 4, [i["text"] for i in items])
check("each keeps the page it was found on", all(i["source"].get("url", "").startswith("https://www.goodreads.com/") for i in web))
check("both works are covered", {i["source"]["title"] for i in web} == {"The Early Spring", "Twisted Love"})
check("lines found on only one page are marked to check", any(i["verify"] for i in web) and not all(i["verify"] for i in web))
_, log, _ = http("GET", "/__websearch_log")
check("the request carried the search tool, a limit and the search rules", log and log[-1]["maxUses"] == 4 and log[-1]["system"], log)

# 2. nothing on the web: a clear message that says it looked
s, b, _ = http("POST", "/api/library/screen", {"title": "Nothing Online Show", "kind": "series"}, T)
quiet = b["screen"][-1]["id"]
s, b, _ = ask(T, [quiet])
check("nothing found: a 502 with a message that it looked on the web", s == 502 and "looked on the web" in (b or {}).get("error", ""), (s, b))

# 3. no works named (a subject only): no web search, as before
before = len(http("GET", "/__websearch_log")[1])
s, b, _ = ask(T, [], about="hope")
check("a subject alone still works", s == 200 and len(b["items"]) >= 1, (s, b))
check("and is not looked up on the web", len(http("GET", "/__websearch_log")[1]) == before)

# 4. web search switched off for the account: answered from memory, as before
serve("WEBSEARCH=off")
T, series, book = setup()
s, b, _ = ask(T, [series])
check("search off: still answered (from memory)", s == 200 and len(b["items"]) >= 1 and "found on the web" not in b["items"][0]["text"], (s, b))

# 4b. the paid search is not switched on (the default for the real app): never searched, answered from memory
serve("WEBSEARCH=unset")
T, series, book = setup()
s, b, _ = ask(T, [series, book])
check("search not switched on: answered from memory", s == 200 and len(b["items"]) >= 1 and all("found on the web" not in i["text"] for i in b["items"]), (s, b))
check("and no search was asked for", http("GET", "/__websearch_log")[1] == [])

# 5. a long search that pauses: the app hands it back and gets the answer
serve("WEBSEARCH=pause")
T, series, book = setup()
s, b, _ = ask(T, [series, book])
_, log, _ = http("GET", "/__websearch_log")
check("a paused search is continued", s == 200 and len(b["items"]) == 4 and any(l["continuing"] for l in log), (s, log))

# 6. the quote card shows where it was found
serve()
T, series, book = setup()
ask(T, [series])
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome")
    pg = br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True, is_mobile=True).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"{_W.URL}/"); pg.wait_for_timeout(1200)
    pg.fill("#passcode", "letmein"); pg.click("#passcode-go"); pg.wait_for_timeout(1500)
    pg.click("#nav-library"); pg.wait_for_timeout(1500)      # "Quotes you found" in the Library
    links = pg.locator("#found-list a.src.found")
    n = links.count()
    check("cards show a 'Found on' link", n >= 1 and links.first.inner_text().startswith("Found on goodreads.com"), n)
    if n: check("the link opens the page in a new tab", links.first.get_attribute("target") == "_blank" and "noopener" in (links.first.get_attribute("rel") or ""))
    if n: links.first.scroll_into_view_if_needed(); pg.wait_for_timeout(300); pg.screenshot(path=f"{_W.OUT}/shots/web_quotes_card.png")
    check("no page errors", not errs, errs)
    br.close()
finish()

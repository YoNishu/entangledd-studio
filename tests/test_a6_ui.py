"""Settings, "Check everything", with the probes; and a script that fails on her phone reaching the record of problems.
Run: python3 tests/test_a6_ui.py   (starts its own fresh server; screenshots in $STUDIO_OUT/shots)"""
import where as _W
import os, time
from playwright.sync_api import sync_playwright
from a6lib import *

S = f"{_W.OUT}/shots/"; os.makedirs(S, exist_ok=True)
def wait_text(pg, sel, part, ms=20000):
    try: pg.wait_for_function("([s, p]) => (document.querySelector(s)?.textContent || '').includes(p)", arg=[sel, part], timeout=ms); return True
    except Exception: return False
def rewind():
    rec = doc("health")
    if rec:
        rec["asOf"] -= 120000
        for k in rec.get("probed", {}): rec["probed"][k] -= 120000
        putdoc("health", rec)

NO_COMMENTS = "instagram_basic,instagram_content_publish,instagram_manage_insights,pages_show_list,pages_read_engagement"
ALL_SCOPES = NO_COMMENTS + ",instagram_manage_comments"
serve(); T = login(); connect(T); http("GET", "/__seed_posts"); settle()

with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome")
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
    pg = ctx.new_page(); errs = []; asked = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("request", lambda r: asked.append(r.method + " " + r.url.split("/api/")[1]) if "/api/checkup" in r.url or "/api/oops" in r.url else None)
    pg.goto(B + "/"); pg.wait_for_selector("#passcode", timeout=8000)
    pg.fill("#passcode", "letmein"); pg.click("#passcode-go"); pg.wait_for_timeout(1200)
    pg.click("#settings-open"); pg.wait_for_selector("#health-title", timeout=8000)

    print("Everything fine")
    check("one calm line", wait_text(pg, "#health-summary", "Everything is working."), pg.inner_text("#health-summary"))
    check("all seventeen checks are tucked away", pg.inner_text("#health-rest-label") == "See all 17 checks", pg.inner_text("#health-rest-label"))

    print("Check now looks at everything, in three small requests")
    # The comments permission as if it had never been given: the record forgets having seen it.
    rec = doc("health"); rec["seenScopes"] = NO_COMMENTS.split(","); putdoc("health", rec)
    rewind(); hset(gutendex="notext", scopes=NO_COMMENTS)
    asked.clear()
    pg.locator("#health-check").scroll_into_view_if_needed(); pg.click("#health-check")
    check("it reports two things", wait_text(pg, "#health-summary", "2 things need Nishith."), pg.inner_text("#health-summary"))
    pg.wait_for_function("document.getElementById('health-check').textContent === 'Check now'", timeout=20000)
    check("three requests: the keys, the services, her page", asked == ["POST checkup", "POST checkup?part=services", "POST checkup?part=page"], asked)
    need = pg.locator("#health-attention > li")
    ids = [need.nth(i).get_attribute("id") for i in range(need.count())]
    check("the two lines that need him are shown in the open", ids == ["health-item-books", "health-item-comments"], ids)
    check("each says what is off, in plain words", "from memory" in need.nth(0).inner_text() and "comments" in need.nth(1).inner_text().lower(), [need.nth(i).inner_text()[:80] for i in range(need.count())])
    check("the comments line offers Connect again, with an id of its own", pg.locator("#health-reconnect-comments").count() == 1 and pg.locator("#health-reconnect").count() == 0)
    pg.click("#health-fix-comments summary"); pg.wait_for_timeout(200)
    check("its steps name the permission to tick", "instagram_manage_comments" in pg.inner_text("#health-fix-comments"), pg.inner_text("#health-fix-comments")[:200])
    check("nothing runs off the side", pg.evaluate("(() => { const b = document.querySelector('#settings .sheet-body'); return b.scrollWidth <= b.clientWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1; })()"))
    pg.locator("#health-attention").scroll_into_view_if_needed(); pg.screenshot(path=S + "a6_health_two_things.png")
    pg.click("#health-reconnect-comments"); pg.wait_for_timeout(400)
    check("Connect again brings up the token box", pg.is_visible("#ig-token"))
    hset(gutendex="ok", scopes=ALL_SCOPES)
    rewind(); pg.locator("#health-check").scroll_into_view_if_needed(); pg.click("#health-check")
    check("fixed, it is calm again", wait_text(pg, "#health-summary", "Everything is working."), pg.inner_text("#health-summary"))
    pg.wait_for_function("document.getElementById('health-check').textContent === 'Check now'", timeout=20000)
    pg.click("#health-rest-label"); pg.wait_for_timeout(300)
    rows = pg.locator("#health-rest-list > li")
    titles = [rows.nth(i).locator(".main").inner_text() for i in range(rows.count())]
    check("the ten new lines have plain titles", titles[7:] == ["Book texts", "Music search", "Photos from the search", "Reel maker's self-test", "Your posts on Instagram",
          "Post numbers", "Comments", "Backups", "Tidying up", "Problems noticed"], titles)
    pg.locator("#health-item-backup").scroll_into_view_if_needed(); pg.screenshot(path=S + "a6_health_probes.png")
    check("the page raised no script errors", errs == [], errs)

    print("A script that fails on her phone")
    asked.clear()
    pg.evaluate("setTimeout(() => { const secret = 'a private line 9931'; null.missing(secret); }, 0)")
    pg.wait_for_timeout(800)
    pg.evaluate("void Promise.reject(new TypeError('second failure \"with her words 9931\"'))")
    pg.evaluate("void Promise.reject(new Error('Nishiii is busy right now. Try again in a minute.'))")      # a message for her: not a fault
    pg.evaluate("void Promise.reject(new TypeError('Failed to fetch'))")                                    # being offline: not a fault
    for i in range(6): pg.evaluate(f"setTimeout(() => {{ undefinedThing{i}(); }}, 0)")
    pg.wait_for_timeout(1500)
    check("the app tells the server, three times a visit at most", asked == ["POST oops"] * 3, asked)
    rec = (doc("errors") or {"list": []})
    d = doc("errors"); d["writtenAt"] -= 120000; putdoc("errors", d)
    http("POST", "/api/oops", {"what": "flush", "where": "x.js:1"}, T)
    got = doc("errors")["list"]
    mine = [e for e in got if e["where"].startswith("in the app") and e["what"] != "flush"]
    check("the failures are on record, by file and line", len(mine) == 3 and "TypeError" in mine[0]["what"] and mine[1]["where"] == "in the app, a promise", mine)
    said = " ".join(e["where"] + " " + e["what"] for e in got)
    check("without any words the script was handling", "9931" not in said and "private" not in said and "her words" not in said, mine)
    check("a message meant for her, or being offline, is not reported", not any("busy" in e["what"] or "Failed to fetch" in e["what"] for e in got), got)
    b.close()
finish()

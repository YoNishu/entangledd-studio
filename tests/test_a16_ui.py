"""Agent 16: the "Updated" line and Refresh in Posts and Insights, in the phone-sized browser.
- Posts: "Checked with Instagram just now." above the list; each card keeps its numbers; no week card in Posts;
  Refresh shows it is busy, then brings the stand-in's new numbers onto the card, the page not moving;
- Insights: "Numbers updated just now."; Refresh brings the new reach; the week at a glance shows for 7 days;
- Instagram not answering / Meta pausing the app: said plainly, with when the numbers are from, the numbers kept;
- no service worker or cache gives an old copy of /api/posts or /api/insights (no-store).
Run:  python3 tests/test_a16_ui.py"""
import re, subprocess, sys, urllib.request
import where as _W
from playwright.sync_api import sync_playwright

S = f"{_W.OUT}/shots/"
fails = []
def check(name, ok, more=""):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  " + str(more)[:300]))
    if not ok: fails.append(name)
def hook(path): urllib.request.urlopen(_W.URL + path).read()

out = subprocess.run([f"{_W.HERE}/serve"], capture_output=True, text=True).stdout
if "DID NOT START" in out: print(out); print("FAIL"); sys.exit(1)
hook("/__seed_posts")
with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome")
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
    ctx.add_init_script("try { localStorage.setItem('studio.postsView', 'list'); } catch (e) {}")   # these checks read the posts as a list (the gallery is checked in test_page_posts.py)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"{_W.URL}/"); pg.wait_for_timeout(1000)
    pg.fill("#passcode", "letmein"); pg.click("#passcode-go"); pg.wait_for_timeout(1500)
    pg.click("#settings-open"); pg.wait_for_timeout(500); pg.fill("#ig-token", "SHORT-" + "a" * 60); pg.click("#ig-connect button[type=submit]"); pg.wait_for_timeout(900); pg.click("#settings-close")

    # ---- Posts
    pg.click("#nav-posts"); pg.wait_for_timeout(2500); pg.click("#posts-part-posted"); pg.wait_for_timeout(300)
    check("Posts says when the list was checked", pg.inner_text("#posts-fresh") == "Checked with Instagram just now.", pg.inner_text("#posts-fresh"))
    check("Refresh is there", pg.is_visible("#posts-refresh") and pg.inner_text("#posts-refresh") == "Refresh")
    check("no week card in Posts", pg.locator("#view-posts .week").count() == 0)
    first = pg.locator("#list-posts .card").first
    check("each posted card keeps its numbers", first.locator("dl.nums dd").count() == 6, first.inner_text())
    pg.screenshot(path=S + "a16_posts_fresh.png")
    hook("/__ig?bump=40")
    pg.evaluate("window.scrollTo(0, 400)"); y0 = pg.evaluate("window.scrollY")
    pg.route("**/api/posts?force=1", lambda r: (pg.wait_for_timeout(700), r.continue_()))
    pg.click("#posts-refresh")
    pg.wait_for_timeout(150)
    check("Refresh shows it is busy", pg.get_attribute("#posts-refresh", "aria-busy") == "true" and pg.inner_text("#posts-refresh") == "Refreshing…", pg.inner_text("#posts-refresh"))
    pg.wait_for_timeout(2500)
    card = pg.locator("#list-posts .card", has_text="Seeded quote 1 ").first.inner_text()
    check("Refresh brings the new numbers onto the card", "1.2K" in card or "1,240" in card or "1240" in card, card.replace("\n", " | "))
    check("the page did not move", abs(pg.evaluate("window.scrollY") - y0) < 2, (y0, pg.evaluate("window.scrollY")))
    check("Refresh is ready again", pg.inner_text("#posts-refresh") == "Refresh" and pg.get_attribute("#posts-refresh", "aria-busy") is None)

    # ---- Insights
    pg.click("#nav-insights"); pg.wait_for_timeout(2500)
    check("Insights says when its numbers are from", pg.inner_text("#ins-fresh") == "Numbers updated just now.", pg.inner_text("#ins-fresh"))
    hook("/__ig?bump=900")
    pg.click("#ins-refresh"); pg.wait_for_timeout(2500)
    hero = pg.inner_text("#ins-hero")
    check("Refresh in Insights brings the new reach", re.search(r"\b75(K|,000)", hero), hero.replace("\n", " | "))    # 1200*55 + 900*10
    pg.screenshot(path=S + "a16_insights_fresh.png")
    pg.locator("#ins-range button[data-range='7']").click(); pg.wait_for_timeout(2500)
    week = pg.inner_text("#ins-week") if pg.is_visible("#ins-week") else ""
    check("the week at a glance is in Insights for 7 days", "This week against last" in week and "Reach" in week and "Went furthest" in week, week.replace("\n", " | "))
    pg.screenshot(path=S + "a16_insights_week.png")
    pg.locator("#ins-range button[data-range='all']").click(); pg.wait_for_timeout(2000)
    check("and not for other periods", not pg.is_visible("#ins-week"))

    # ---- Instagram not answering, Meta pausing the app
    hook("/__ig?mode=down"); hook("/__clock?add=180000")
    pg.click("#ins-refresh"); pg.wait_for_timeout(2500)
    line = pg.inner_text("#ins-fresh")
    check("Insights says plainly when Instagram isn't answering", re.fullmatch(r"Instagram isn't answering right now\. These are the numbers from \d{1,2}:\d\d [ap]m\.", line), line)
    check("and keeps the numbers shown", re.search(r"\b75(K|,000)", pg.inner_text("#ins-hero")))
    pg.screenshot(path=S + "a16_insights_down.png")
    pg.click("#nav-posts"); pg.wait_for_timeout(2500)
    line = pg.inner_text("#posts-fresh")
    check("Posts says so too", line.startswith("Instagram isn't answering right now. These are your posts and numbers from "), line)
    check("and keeps the cards", pg.locator("#list-posts .card").count() == 10)
    hook("/__ig?mode=paused")
    pg.click("#posts-refresh"); pg.wait_for_timeout(2500)
    line = pg.inner_text("#posts-fresh")
    check("Meta pausing the app is said as such", line.startswith("Meta has paused the app's access to Instagram for now. These are your posts and numbers from "), line)
    pg.screenshot(path=S + "a16_posts_paused.png")

    # ---- no old copies
    sw = open(f"{_W.ROOT}/web/sw.js").read()
    check("no service worker keeps copies of answers", "fetch" not in sw and "caches" not in sw, "sw.js handles fetch")
    check("no errors on the page", not errs, errs)
    b.close()
for path in ("/api/posts", "/api/insights"):
    req = urllib.request.Request(_W.URL + path)
    try: urllib.request.urlopen(req)
    except urllib.error.HTTPError as e: cc = e.headers.get("Cache-Control")
    else: cc = None
    check(f"{path} is never kept by a browser (no-store)", cc == "no-store", cc)
print("PASS" if not fails else f"FAIL ({len(fails)}): " + "; ".join(fails))
sys.exit(1 if fails else 0)

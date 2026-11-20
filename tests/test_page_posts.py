"""Her case of 20 Nov 2026: in Posts and Insights the numbers of the posts already there changed, but posts she had
made since never appeared. The app only knew posts made through it (or a reel of its own it could match by its
words); everything else on her page was left out.

Now every post on her Instagram page is in Posts and Insights: one made in Instagram itself comes in as it is (its
caption, its numbers, no quote of the app's, nothing assumed about which reel it was). Posts is a gallery, one
picture per post with its main numbers on it, as in the phone's photos; a tap opens the post's card.
Run:  python3 tests/test_page_posts.py"""
import where as _W
from a3lib import *
import urllib.parse, urllib.request

def posted(caption, ago, kind="REELS"): http("GET", "/__posted_in_instagram?caption=" + urllib.parse.quote(caption) + f"&ago={ago}&type={kind}")
def picture(token, pid):
    req = urllib.request.Request(B + f"/api/posts/{pid}/picture", headers={"Authorization": "Bearer " + token})
    try:
        with urllib.request.urlopen(req) as r: return r.status, r.read(), r.headers.get("Content-Type")
    except urllib.error.HTTPError as e: return e.code, b"", ""

serve()
T = login(); connect(T)
job = "22222222-2222-4222-8222-222222222222"
now = now_ms()
# A reel made in the app, still waiting; its words are in none of what she posts below.
putdoc("queue", [{"id": "q1", "jobId": job, "created": now - 7200000, "quote": "The quieter you become, the more you are able to hear.", "author": "Rumi", "theme": "stillness", "tone": "calm", "source": "book", "suggestionId": "", "keptUntil": now + 86400000}])
posted("monday mood, nothing more #mood", 5400)                 # a reel
posted("the sea this morning", 3600, "FEED")                    # a photo
posted("four pictures from the weekend", 1800, "ALBUM")         # a carousel
s, b, _ = http("GET", "/api/posts", None, T)
ps = b.get("posts") or []
check("the three posts she made in Instagram are in Posts", s == 200 and len(ps) == 3 and all(p["outside"] and p["state"] == "published" for p in ps), (s, b))
check("newest first, each as what it is", [p["kind"] for p in ps] == ["carousel", "photo", "reel"], [p["kind"] for p in ps])
check("with its own caption, and no quote of the app's (nothing is assumed)", [p["caption"] for p in ps] == ["four pictures from the weekend", "the sea this morning", "monday mood, nothing more #mood"] and not any(p["quote"] for p in ps), ps)
check("their numbers come with them, at the same opening", all(p["metrics"] and p["metrics"].get("reach") for p in ps), [p["metrics"] for p in ps])
check("the reel waiting in the app is still waiting: it was not taken for any of them", len(doc("queue")) == 1 and not any(p.get("jobId") for p in doc("posts")), doc("queue"))
s, b2, _ = http("GET", "/api/posts", None, T)
check("looking again adds nothing twice", len(b2["posts"]) == 3 and len(doc("posts")) == 3, len(doc("posts")))
s, ins, _ = http("GET", "/api/insights?range=all", None, T)
check("Insights counts them too", s == 200 and ins["totals"]["posts"] == 3 and ins["totals"]["reach"] > 0, ins.get("totals"))

# ---- each post's picture, for the gallery
reel, photo, album = ps[2], ps[1], ps[0]
bright, sky = open(f"{_W.MEDIA}/bright.jpg", "rb").read(), open(f"{_W.MEDIA}/sky.jpg", "rb").read()
s1, body1, type1 = picture(T, reel["id"])
check("a reel's picture is Instagram's cover of it", s1 == 200 and body1 == bright and type1 == "image/jpeg", (s1, len(body1), type1))
check("a photo's picture is the photo", picture(T, photo["id"])[1] == sky)
check("a carousel's picture is its first one", picture(T, album["id"])[1] == sky)
asked = len(glog())
check("a picture is fetched from Instagram once, then kept", picture(T, reel["id"])[1] == bright and len(glog()) == asked, (asked, len(glog())))
check("signed out, no picture", http("GET", f"/api/posts/{reel['id']}/picture")[0] == 401)

# ---- Remove takes it off the list for good, though it is still on Instagram
s, _, _ = http("DELETE", "/api/posts/" + photo["id"], None, T)
s, b, _ = http("GET", "/api/posts", None, T)
check("a removed post stays removed: it is not brought back from her page", s == 200 and [p["caption"] for p in b["posts"]] == ["four pictures from the weekend", "monday mood, nothing more #mood"], [p["caption"] for p in b["posts"]])
s, ins, _ = http("GET", "/api/insights?range=all", None, T)
check("and Insights no longer counts it", ins["totals"]["posts"] == 2, ins.get("totals"))

# ---- a reel posted from here that Instagram is still processing: a new post on the page may be that very reel
posts = doc("posts")
posts.append({"id": "33333333-3333-4333-8333-333333333333", "jobId": job, "state": "processing", "containerId": "C999", "tokenKind": "page", "error": None, "caption": "x", "quote": "A", "created": now_ms() - 300000, "published": None, "permalink": ""})
putdoc("posts", posts)
posted("something new while one is processing", 60)
http("GET", "/api/insights?range=all", None, T)
check("while a reel from the app is being processed, a newer post on the page is not added as a stranger", not any(p.get("caption", "").startswith("something new") for p in doc("posts")), [p.get("caption") for p in doc("posts")])
posts = [p for p in doc("posts") if p["state"] != "processing"]; putdoc("posts", posts)
http("GET", "/api/insights?range=all", None, T)
check("once nothing is being processed, it comes in", any(p.get("caption", "").startswith("something new") for p in doc("posts")), [p.get("caption") for p in doc("posts")])

# ---- the same Instagram post twice in the list (two look-ups at once): one stays, the app's own
posts = doc("posts")
twin = next(p for p in posts if p.get("caption", "").startswith("monday mood"))
posts.append({**twin, "id": "44444444-4444-4444-8444-444444444444", "outside": False, "quote": "The quieter you become, the more you are able to hear.", "jobId": job})
putdoc("posts", posts)
http("GET", "/api/posts", None, T)
same = [p for p in doc("posts") if p.get("mediaId") == twin["mediaId"]]
check("a post listed twice is listed once again, and the one the app knows more about stays", len(same) == 1 and same[0]["quote"].startswith("The quieter"), same)

# ---- a wording match still links a waiting reel to its post, as before
serve()
T = login(); connect(T)
putdoc("queue", [{"id": "q1", "jobId": job, "created": now_ms() - 7200000, "quote": "The quieter you become, the more you are able to hear.", "author": "Rumi", "theme": "stillness", "tone": "calm", "source": "book", "suggestionId": "", "keptUntil": now_ms() + 86400000}])
posted("The quieter you become, the more you are able to hear. #rumi", 600)
posted("unrelated words entirely", 300)
s, b, _ = http("GET", "/api/posts", None, T)
by = {p["caption"][:9]: p for p in b["posts"]}
check("the reel with her quote's words is the app's reel, with its quote", by["The quiet"]["quote"].startswith("The quieter") and not by["The quiet"]["outside"], by.get("The quiet"))
check("the other one is simply a post from Instagram", by["unrelated"]["outside"] and not by["unrelated"]["quote"], by.get("unrelated"))
check("and the waiting list is empty", doc("queue") == [])

# ---------- on the phone ----------
from playwright.sync_api import sync_playwright
posted("a second photo", 100, "FEED")
with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome")
    errors = []
    ctx = br.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=2)
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(B + "/"); pg.wait_for_timeout(800)
    if pg.is_visible("#passcode"): pg.fill("#passcode", "letmein"); pg.click("#passcode-go")
    pg.wait_for_selector("#suggestions .card", timeout=20000)
    pg.click("#nav-posts")
    pg.wait_for_selector("#grid-posts .tile", timeout=15000)
    pg.wait_for_function("document.querySelectorAll('#grid-posts .tile img.in').length === 3", timeout=15000)
    tiles = pg.locator("#grid-posts .tile")
    check("Posts opens as a gallery: one tile per post, three across", tiles.count() == 3 and pg.is_hidden("#list-posts") and len({round(tiles.nth(i).bounding_box()["y"]) for i in range(3)}) == 1, tiles.count())
    box = tiles.nth(0).bounding_box()
    check("a tile is a picture in Instagram's 4:5 shape, big enough to tap", abs(box["height"] / box["width"] - 1.25) < 0.03 and box["width"] >= 100, box)
    reel_tile = pg.locator('#grid-posts .tile[aria-label^="The quieter"]').first
    check("a reel's tile carries its views and likes", reel_tile.locator(".nums-on span").count() == 2 and reel_tile.locator(".ic-heart").inner_text().strip() != "", reel_tile.inner_text())
    check("a photo's tile carries how many it reached", pg.locator("#grid-posts .tile .ic-insights").count() >= 1)
    check("nothing runs off the side of the phone", pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))
    reel_tile.click()
    pg.wait_for_selector("#postcard-sheet:not([hidden]) .card", timeout=3000)
    card = pg.inner_text("#postcard-card")
    check("a tap opens the post's card: its words, where it was posted, all its numbers", "The quieter you become" in card and "Reach" in card and "Saves" in card and "Shares" in card, card)
    pg.click("#postcard-close")
    pg.locator('#grid-posts .tile[aria-label^="unrelated"]').first.click()
    pg.wait_for_selector("#postcard-sheet:not([hidden]) .card", timeout=3000)
    card = pg.inner_text("#postcard-card")
    check("a post made in Instagram says so, with its caption", "posted from Instagram" in card, card)
    pg.click("#postcard-card >> text=Remove")
    pg.wait_for_function("document.getElementById('postcard-sheet').hidden && document.querySelectorAll('#grid-posts .tile').length === 2", timeout=8000)
    check("Remove in the card takes the tile away and closes the card", tiles.count() == 2)
    pg.click("#posts-view-list")
    check("List shows the same posts as cards", pg.locator("#list-posts .card").count() == 2 and pg.is_hidden("#grid-posts"))
    # A fresh app: the posts are there at once (as this phone last saw them), before Instagram has answered.
    held = []
    pg.route("**/api/posts", lambda r: held.append(r))               # Instagram's answer is held back
    pg.reload(); pg.wait_for_selector("#suggestions .card", timeout=20000)
    pg.click("#nav-posts"); pg.wait_for_timeout(700)
    check("opening Posts again shows them at once, in the view she chose, before Instagram has answered", pg.locator("#list-posts .card").count() == 2 and len(held) >= 1, (pg.locator("#list-posts .card").count(), len(held)))
    for r in held:
        try: r.continue_()
        except Exception: pass
    pg.unroute("**/api/posts")
    pg.click("#posts-view-grid"); pg.wait_for_selector("#grid-posts .tile", timeout=3000)

    # ---- the lag: a background video plays only while Create is on screen
    pg.click("#nav-today"); pg.locator("#suggestions .card").first.locator("text=Use this").click()
    pg.wait_for_selector("#view-create:not([hidden])", timeout=5000)
    pg.click("#tab-bg"); pg.set_input_files("#file", f"{_W.MEDIA}/sea.mp4")
    pg.wait_for_function("Studio.bgPlaying()", timeout=8000)
    pg.click("#nav-posts"); pg.wait_for_timeout(400)
    check("the background video stops when she leaves Create", pg.evaluate("Studio.bgPlaying()") is False)
    pg.click("#posts-fresh"); pg.wait_for_timeout(300)
    check("and a tap elsewhere in the app does not start it", pg.evaluate("Studio.bgPlaying()") is False)
    pg.click("#nav-create")
    check("back in Create it plays again", pg.wait_for_function("Studio.bgPlaying()", timeout=4000) is not None)
    check("no errors on the page", not errors, errors)
    br.close()
finish()

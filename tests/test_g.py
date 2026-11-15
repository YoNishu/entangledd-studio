import where as _W
import json, time, urllib.request
from playwright.sync_api import sync_playwright
S=f"{_W.OUT}/shots/"
def wait(pg, cond, timeout=90):
    t=time.time()
    while time.time()-t<timeout:
        if pg.evaluate(cond): return True
        pg.wait_for_timeout(600)
    return False
with sync_playwright() as p:
    b=p.chromium.launch(channel="chrome", args=["--autoplay-policy=no-user-gesture-required"])
    ctx=b.new_context(viewport={"width":390,"height":844}, device_scale_factor=2, has_touch=True, is_mobile=True, accept_downloads=True)
    ctx.add_init_script("document.addEventListener('DOMContentLoaded', () => document.querySelectorAll('details.more').forEach((d) => { d.open = true; }))")   # the Add forms now sit in rows that open on a tap; open them all for this walk
    pg=ctx.new_page(); errs=[]
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append("console: "+m.text) if m.type=="error" and "401" not in m.text else None)
    pg.goto(f"{_W.URL}/"); pg.wait_for_timeout(1000)
    pg.fill("#passcode","letmein"); pg.click("#passcode-go"); pg.wait_for_timeout(1500)
    pg.click("#settings-open"); pg.wait_for_timeout(500); pg.fill("#ig-token","SHORT-"+"a"*60); pg.click("#ig-connect button[type=submit]"); pg.wait_for_timeout(900); pg.click("#settings-close")

    # --- Library: books with and without free text, highlights import
    pg.click("#nav-library"); pg.wait_for_timeout(600)
    pg.fill("#b-title","Walden"); pg.fill("#b-author","Henry David Thoreau"); pg.click("#add-book button[type=submit]"); pg.wait_for_timeout(1500)
    pg.fill("#b-title","Atomic Habits"); pg.fill("#b-author","James Clear"); pg.click("#add-book button[type=submit]"); pg.wait_for_timeout(1500)
    print("books:", [x.replace("\n"," | ") for x in pg.locator("#list-books li").all_inner_texts()])
    pg.set_input_files("#import", f"{_W.MEDIA}/clippings.txt"); pg.wait_for_timeout(500)
    print("confirm:", pg.inner_text("#confirm-title"), "|", pg.inner_text("#confirm-body"))
    pg.click("#confirm-yes"); pg.wait_for_timeout(900)
    print("import note:", pg.inner_text("#library-note")); print("own quotes:", [x.replace("\n"," | ")[:95] for x in pg.locator("#list-quotes li").all_inner_texts()])
    pg.set_input_files("#import", f"{_W.MEDIA}/clippings.txt"); pg.wait_for_timeout(400); pg.click("#confirm-yes"); pg.wait_for_timeout(800)
    print("import again:", pg.inner_text("#library-note"))
    pg.locator("#list-books").scroll_into_view_if_needed(); pg.screenshot(path=S+"120_library_books.png")

    # --- Ask for quotes from the book with text
    pg.click("#nav-nishiii"); pg.wait_for_timeout(500); pg.click("#ask-open"); pg.wait_for_timeout(600)
    pg.locator("#ask-groups button", has_text="Walden").click(); pg.click("#ask-go")
    wait(pg, "document.getElementById('ask-sheet').hidden", 30); pg.wait_for_timeout(500)
    cards=pg.locator("#asked-list .card").all_inner_texts()
    print("asked cards:", len(cards), "| first:", cards[0].replace("\n"," | ")[:170])
    pg.screenshot(path=S+"121_asked_fromtext.png")

    # --- Create: check who said this
    pg.click("#nav-create"); pg.wait_for_timeout(300); pg.click("#tab-text"); pg.wait_for_timeout(200)
    pg.evaluate("Studio.setQuote('Insanity is doing the same thing over and over.', 'Albert Einstein')"); pg.wait_for_timeout(200)
    pg.click("#check-open"); wait(pg, "document.getElementById('check-open').textContent==='Who said this?' && !document.getElementById('check-result').hidden", 15)
    print("check 1:", pg.inner_text("#check-result").replace("\n"," | ")[:260])
    pg.locator("#check-result").scroll_into_view_if_needed(); pg.screenshot(path=S+"122_check.png")
    pg.locator("#check-result button", has_text="Take the name off").click(); pg.wait_for_timeout(200)
    print("  after: author =", repr(pg.evaluate("Studio.author()")), "| blocks:", pg.evaluate("Studio.quoteText()"))
    pg.evaluate("Studio.setQuote('No man ever steps in the same river twice.', '')"); pg.click("#check-open"); pg.wait_for_timeout(900)
    print("check 2:", pg.inner_text("#check-result").replace("\n"," | ")[:150])
    pg.locator("#check-result button", has_text="Credit Heraclitus").click(); pg.wait_for_timeout(200)
    print("  after: author =", pg.evaluate("Studio.author()"), "| blocks:", pg.evaluate("Studio.quoteText()").replace("\n"," / "))

    # --- Fonts and saved looks
    pg.wait_for_timeout(1200)
    print("fonts in list:", pg.locator("#font option").count(), "| extra fonts loaded:", pg.evaluate("['Crimson Pro','Libre Baskerville','Italiana','Poiret One','Nothing You Could Do','DM Mono','Young Serif'].map(f => document.fonts.check('40px \"'+f+'\"'))"))
    pg.evaluate("document.querySelector('#stage canvas').dispatchEvent(new Event('x'))")
    pg.select_option("#font","hand"); pg.fill("#size") if False else None
    pg.evaluate("(() => { const s=document.getElementById('size'); s.value=58; s.dispatchEvent(new Event('input')); })()")
    pg.wait_for_timeout(400); pg.screenshot(path=S+"123_font_hand.png")
    pg.click("#tab-style"); pg.wait_for_timeout(200)
    pg.fill("#look-name","Evening hand"); pg.click("#look-form button[type=submit]"); pg.wait_for_timeout(600)
    print("looks:", pg.locator("#looks li").all_inner_texts(), "|", pg.inner_text("#look-note"))
    look_before=pg.evaluate("JSON.stringify(Studio.currentLook())")
    pg.locator("#styles button").first.click(); pg.wait_for_timeout(200)
    pg.evaluate("Studio.setQuote('A different line entirely', 'Someone Else')")
    print("  changed away:", pg.evaluate("JSON.stringify(Studio.currentLook())")!=look_before)
    pg.locator("#looks .apply").first.click(); pg.wait_for_timeout(300)
    after=json.loads(pg.evaluate("JSON.stringify(Studio.currentLook())")); before=json.loads(look_before)
    print("  look back on:", [ (x["font"],x["size"],x["role"]) for x in after["blocks"]], "| same as saved:", after==before, "| words kept:", pg.evaluate("Studio.quoteText()").replace("\n"," / "), "|", pg.inner_text("#look-note"))
    pg.locator("#looks-wrap").scroll_into_view_if_needed(); pg.screenshot(path=S+"124_looks.png")

    # --- Make a reel, keep it for later, post it from the waiting list
    pg.click("#tab-save"); pg.wait_for_timeout(200); pg.click("#make-reel")
    print("reel made:", wait(pg, "!document.getElementById('reel-result').hidden"))
    pg.click("#queue-add"); pg.wait_for_timeout(700); print("queue button:", pg.inner_text("#queue-add"))
    urllib.request.urlopen(f"{_W.URL}/__seed_posts")
    pg.click("#nav-posts"); pg.wait_for_timeout(2500)
    pg.click("#posts-part-posted"); pg.wait_for_timeout(300)      # Posts has two parts: Posted, and Drafts (not yet on Instagram)
    print("updated line:", pg.inner_text("#posts-fresh"), "| first card:", pg.locator("#list-posts .card").first.inner_text().replace("\n"," | ")[:200])   # the week card is in Insights now
    print("waiting:", pg.locator("#list-queue .card").count(), "|", pg.inner_text("#queue-note"), "|", pg.locator("#list-queue .card").first.inner_text().replace("\n"," | ")[:150])
    pg.screenshot(path=S+"125_posts_week.png"); pg.click("#posts-part-drafts"); pg.locator("#queue-wrap").scroll_into_view_if_needed(); pg.screenshot(path=S+"126_posts_queue.png")
    n_before=pg.locator("#list-posts .card").count()
    pg.locator("#list-queue .card .btn.primary").first.click(); pg.wait_for_timeout(700)
    print("post sheet:", pg.inner_text("#post-title")); pg.click("#post-write"); pg.wait_for_timeout(900); print("  caption:", pg.input_value("#post-caption")[:60].replace("\n"," "))
    pg.click("#post-go"); print("  posted:", wait(pg, "document.getElementById('post-status').textContent.startsWith('Posted')", 60), "|", pg.inner_text("#post-status"))
    pg.click("#post-close"); pg.wait_for_timeout(2500)
    print("after posting: waiting shown:", pg.evaluate("!document.getElementById('queue-wrap').hidden"), "| posts:", n_before, "->", pg.locator("#list-posts .card").count(), "| top:", pg.locator("#list-posts .card").first.inner_text().replace("\n"," | ")[:110])

    # --- Comments
    pg.click("#posts-part-posted"); pg.wait_for_timeout(300)
    pg.locator("#list-posts .card .links button", has_text="Comments").first.click(); pg.wait_for_timeout(900)
    print("comments:", pg.locator("#comments-list .comment").count(), "|", pg.inner_text("#comments-note"))
    c=pg.locator("#comments-list .comment")
    c.nth(0).locator("button", has_text="Draft").click(); pg.wait_for_timeout(700); print("  draft 1:", c.nth(0).locator("textarea").input_value(), "|", c.nth(0).locator("[role=status]").inner_text())
    c.nth(1).locator("button", has_text="Draft").click(); pg.wait_for_timeout(700); print("  draft spam:", repr(c.nth(1).locator("textarea").input_value()), "|", c.nth(1).locator("[role=status]").inner_text())
    print("  existing reply shown:", c.nth(2).locator(".theirs").inner_text())
    pg.screenshot(path=S+"127_comments.png")
    c.nth(1).locator("button", has_text="Send reply").click(); pg.wait_for_timeout(300); print("  empty send:", c.nth(1).locator("[role=status]").inner_text())
    c.nth(0).locator("button", has_text="Send reply").click(); pg.wait_for_timeout(800); print("  sent:", c.nth(0).inner_text().replace("\n"," | "))
    pg.click("#comments-close")
    print("errors:", errs); b.close()
log=json.load(urllib.request.urlopen(f"{_W.URL}/__graph_log"))
print("graph:", [(e["method"], e["path"], e["params"].get("message","")) for e in log if "comments" in e["path"] or "replies" in e["path"]])

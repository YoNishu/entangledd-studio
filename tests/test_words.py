import where as _W
import re, urllib.request
from playwright.sync_api import sync_playwright
S=f"{_W.OUT}/shots/"
BAD=re.compile(r"\b(she|she's|herself|the user|footage|the server|claude|anthropic|cloudflare)\b|\bher\b", re.I)
seen={}
def scan(pg, where):
    text=pg.evaluate("document.body.innerText")
    hits=sorted({l.strip()[:110] for l in text.split("\n") if BAD.search(l)})
    seen[where]=hits
with sync_playwright() as p:
    b=p.chromium.launch(channel="chrome")
    pg=b.new_context(viewport={"width":390,"height":844}, device_scale_factor=2, has_touch=True, is_mobile=True).new_page(); errs=[]
    pg.on("pageerror", lambda e: errs.append(str(e)))
    urllib.request.urlopen(f"{_W.URL}/__seed_old_taste"); urllib.request.urlopen(f"{_W.URL}/__seed_posts"); urllib.request.urlopen(f"{_W.URL}/__seed_history")
    pg.goto(f"{_W.URL}/"); pg.wait_for_timeout(900); scan(pg,"lock")
    pg.fill("#passcode","letmein"); pg.click("#passcode-go"); pg.wait_for_timeout(2500); scan(pg,"today"); pg.screenshot(path=S+"140_today.png")
    pg.click("#nav-library"); pg.wait_for_timeout(700); scan(pg,"library"); pg.screenshot(path=S+"141_library.png", full_page=False)
    pg.click("#nav-posts"); pg.wait_for_timeout(2500); scan(pg,"posts")
    pg.click("#nav-nishiii"); pg.click("#nishiii-part-knows"); pg.wait_for_timeout(2500); scan(pg,"nishiii")
    pg.locator("#taste-card").scroll_into_view_if_needed(); pg.wait_for_timeout(200); pg.screenshot(path=S+"142_taste.png")
    print("taste card:", pg.inner_text("#taste-card").replace("\n"," | ")[:330])
    pg.click("#ask-open"); pg.wait_for_timeout(500); scan(pg,"ask sheet"); pg.click("#ask-close")
    pg.click("#nishiii-part-chat"); pg.wait_for_timeout(400); scan(pg,"chat"); pg.screenshot(path=S+"143_chat.png"); pg.click("#nishiii-part-knows")
    pg.click("#settings-open"); pg.wait_for_timeout(600); scan(pg,"settings"); pg.click("#settings-close")
    pg.click("#nav-create"); pg.wait_for_timeout(300)
    for tab in ["bg","text","style","save"]:
        pg.click("#tab-"+tab); pg.wait_for_timeout(250); scan(pg,"create/"+tab)
        if tab=="bg": pg.screenshot(path=S+"144_create_bg.png")
    pg.click("#tab-bg"); pg.click("#stock"); pg.wait_for_timeout(1500); scan(pg,"background search"); print("search sheet title:", pg.inner_text("#stock-title"), "| button:", pg.inner_text("#stock"), "| credit:", pg.inner_text("#stock-credit"))
    pg.screenshot(path=S+"145_search.png")
    print("errors:", errs); b.close()
for k,v in seen.items():
    if v: print("LEFTOVER in", k, "->", v)
print("screens scanned:", len(seen), "| with leftovers:", sum(1 for v in seen.values() if v))

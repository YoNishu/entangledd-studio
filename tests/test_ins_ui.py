import where as _W
import sys, json, urllib.request
from playwright.sync_api import sync_playwright
S=f"{_W.OUT}/shots/"; width=int(sys.argv[1]) if len(sys.argv)>1 else 390
with sync_playwright() as p:
    b=p.chromium.launch(channel="chrome")
    ctx=b.new_context(viewport={"width":width,"height":844}, device_scale_factor=2, has_touch=True, is_mobile=True, accept_downloads=True)
    pg=ctx.new_page(); errs=[]
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append("console: "+m.text) if m.type=="error" and "401" not in m.text else None)
    pg.goto(f"{_W.URL}/"); pg.wait_for_timeout(900)
    pg.fill("#passcode","letmein"); pg.click("#passcode-go"); pg.wait_for_timeout(1500)
    pg.click("#settings-open"); pg.wait_for_timeout(400); pg.fill("#ig-token","SHORT-"+"a"*60); pg.click("#ig-connect button[type=submit]"); pg.wait_for_timeout(900); pg.click("#settings-close")
    # empty state first
    pg.click("#nav-insights"); pg.wait_for_timeout(1500); print("empty:", pg.inner_text("#ins-note"), "| body hidden:", pg.evaluate("document.getElementById('ins-body').hidden"))
    urllib.request.urlopen(f"{_W.URL}/__seed_insights")
    pg.click("#nav-today"); pg.click("#nav-insights"); pg.wait_for_timeout(2500)
    nav=pg.evaluate("[...document.querySelectorAll('.views button')].map(b => [b.textContent, Math.round(b.getBoundingClientRect().width), b.scrollWidth > b.clientWidth])")
    print("nav:", nav, "| nav overflows:", pg.evaluate("document.querySelector('.views').scrollWidth > document.querySelector('.views').clientWidth"))
    print("hero:", pg.inner_text("#ins-hero").replace("\n"," | "))
    print("tiles:", [t.replace("\n"," / ") for t in pg.locator("#ins-tiles .tile").all_inner_texts()])
    for cid in ["ins-trend","ins-top","ins-times","ins-works","ins-know","ins-followers","ins-reach","ins-audience","ins-rhythm"]:
        print(f"{cid}:", pg.inner_text("#"+cid).replace("\n"," | ")[:260])
    print("page wider than screen:", pg.evaluate("document.documentElement.scrollWidth > window.innerWidth"), "| any card overflows:", pg.evaluate("[...document.querySelectorAll('#ins-body .card, #ins-body .tile')].some(c => c.scrollWidth > c.clientWidth + 1)"))
    pg.screenshot(path=S+f"150_ins_top_{width}.png")
    shots=[("ins-trend","151"),("ins-times","152"),("ins-works","153"),("ins-followers","154"),("ins-audience","155"),("ins-rhythm","156")]
    for cid,n in shots:
        pg.locator("#"+cid).scroll_into_view_if_needed(); pg.wait_for_timeout(150); pg.evaluate(f"document.getElementById('{cid}').scrollIntoView({{block:'start'}})"); pg.wait_for_timeout(150); pg.screenshot(path=S+f"{n}_{cid}_{width}.png")
    # interactions
    pg.evaluate("document.getElementById('ins-trend').scrollIntoView({block:'center'})"); pg.wait_for_timeout(200)
    pg.locator("#ins-trend .hit").nth(13).dispatch_event("pointerdown"); pg.wait_for_timeout(200)
    print("bar tooltip:", pg.inner_text("#ins-trend .tip").replace("\n"," | "))
    pg.locator("#ins-top .chips button", has_text="Saves").click(); pg.wait_for_timeout(200); print("best by saves:", pg.locator("#ins-top .rank li").first.inner_text().replace("\n"," | ")[:120])
    pg.locator("#ins-works .chips button", has_text="Background").first.click(); pg.wait_for_timeout(200); print("works/background:", [x.replace("\n"," | ")[:70] for x in pg.locator("#ins-works .rank li").all_inner_texts()])
    pg.evaluate("document.getElementById('ins-works').scrollIntoView({block:'start'})"); pg.wait_for_timeout(150); pg.screenshot(path=S+f"157_works_bg_{width}.png")
    pg.locator("#ins-times .heat-cell:not(.none)").first.dispatch_event("pointerdown"); pg.wait_for_timeout(150); print("heat tooltip:", pg.inner_text("#ins-times .tip").replace("\n"," | "))
    # ranges
    for r in ["7","30","90"]:
        pg.locator(f"#ins-range button[data-range='{r}']").click(); pg.wait_for_timeout(1500)
        print(f"range {r}: hero", pg.inner_text("#ins-hero").replace("\n"," | ")[:150], "| page card:", pg.inner_text("#ins-reach").replace("\n"," | ")[:140])
    pg.locator("#ins-range button[data-range='30']").click(); pg.wait_for_timeout(1500)
    pg.evaluate("document.getElementById('ins-reach').scrollIntoView({block:'start'})"); pg.wait_for_timeout(150); pg.screenshot(path=S+f"158_page_{width}.png")
    with pg.expect_download(timeout=8000) as dl: pg.click("#ins-download")
    path=dl.value.path(); text=open(path, encoding="utf-8-sig").read().splitlines()
    print("csv:", dl.value.suggested_filename, "| rows:", len(text)-1, "|", text[0][:120]); print("   ", text[1][:170])
    # posts card links here
    # the week at a glance lives in Insights now (7 days), not on top of Posts
    pg.click("#nav-posts"); pg.wait_for_timeout(2500); print("week card in Posts:", pg.locator("#view-posts .week").count(), "| posts fresh line:", pg.inner_text("#posts-fresh"))
    pg.click("#nav-insights"); pg.wait_for_timeout(1500); pg.locator("#ins-range button[data-range='7']").click(); pg.wait_for_timeout(2000)
    print("week card in Insights (7 days):", pg.inner_text("#ins-week").replace("\n"," | ")[:300], "| fresh:", pg.inner_text("#ins-fresh"))
    print("errors:", errs); b.close()

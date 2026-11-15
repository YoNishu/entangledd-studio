import where as _W
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(channel="chrome")
    pg=b.new_context(viewport={"width":390,"height":844}, has_touch=True, is_mobile=True).new_page()
    pg.goto(f"{_W.URL}/"); pg.wait_for_timeout(900)
    pg.fill("#passcode","letmein"); pg.click("#passcode-go"); pg.wait_for_timeout(1500)
    pg.click("#nav-create"); pg.wait_for_timeout(300)
    pg.click("#tab-bg"); pg.wait_for_timeout(200); pg.click("#stock"); pg.wait_for_timeout(200)            # the video search starts and is slow
    pg.locator("#stock-kind button[data-kind=photo]").click()  # switch to photos before it answers
    pg.wait_for_timeout(700); early=pg.evaluate("[...document.querySelectorAll('#stock-grid img')].map(i => i.alt.split(' ')[0])")
    pg.wait_for_timeout(2500); late=pg.evaluate("[...document.querySelectorAll('#stock-grid img')].map(i => i.alt.split(' ')[0])")
    print("under Photos, before the slow video answer:", early, "| after it arrived:", late, "| status:", repr(pg.inner_text("#stock-status")))
    b.close()

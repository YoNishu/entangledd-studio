import where as _W
import time
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(channel="chrome")
    pg=b.new_context(viewport={"width":390,"height":844}, has_touch=True, is_mobile=True).new_page()
    pg.goto(f"{_W.URL}/"); pg.wait_for_timeout(900)
    pg.fill("#passcode","letmein"); pg.click("#passcode-go"); pg.wait_for_timeout(1500)
    pg.click("#nav-create"); pg.wait_for_timeout(300); pg.evaluate("Studio.setQuote('start again', '')")
    pg.click("#tab-music"); pg.set_input_files("#tune-file", f"{_W.MEDIA}/silent.mp4"); pg.wait_for_timeout(1200)
    print("silent video chosen as music:", pg.evaluate("JSON.stringify(Studio.musicState())"), "|", repr(pg.inner_text("#tune-say")))
    pg.click("#tab-save"); pg.click("#make-reel")
    t=time.time()
    while time.time()-t<60 and pg.evaluate("document.getElementById('done').hidden && document.getElementById('reel-result').hidden"): pg.wait_for_timeout(500)
    print("result:", "reel made" if not pg.evaluate("document.getElementById('reel-result').hidden") else pg.inner_text("#done"))
    b.close()

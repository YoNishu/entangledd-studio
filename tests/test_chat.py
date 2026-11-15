import where as _W
import json
from playwright.sync_api import sync_playwright
S=f"{_W.OUT}/shots/"
with sync_playwright() as p:
    b=p.chromium.launch(channel="chrome")
    ctx=b.new_context(viewport={"width":390,"height":844}, device_scale_factor=2, has_touch=True, is_mobile=True)
    pg=ctx.new_page(); errs=[]
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"{_W.URL}/"); pg.wait_for_timeout(1000)
    pg.fill("#passcode","letmein"); pg.click("#passcode-go"); pg.wait_for_timeout(1800)
    pg.screenshot(path=S+"100_header.png", clip={"x":0,"y":0,"width":390,"height":140})
    pg.click("#nav-nishiii"); pg.wait_for_timeout(300)   # the chat is the Nishiii tab's first part
    def say(t, wait=1500):
        pg.fill("#chat-input", t); pg.click("#chat-send"); pg.wait_for_timeout(wait)
        return pg.locator("#chat-log p").last.inner_text().replace("\n"," / ")
    print("1:", say("find quotes from Interstellar"))
    print("2:", say("use the first one"), "| Open Create button:", pg.locator("#chat-log .act").count())
    print("   canvas:", [x["text"] for x in json.loads(pg.evaluate("localStorage.getItem('entangledd.draft.v1')"))["blocks"]])
    print("3:", say("how did my posts do?"))
    print("4:", say("never suggest hustle quotes"))
    print("5:", say("what's on today?")[:120])
    print("6:", say("hello"))
    pg.screenshot(path=S+"101_chat.png")
    pg.locator("#chat-log .act").first.click(); pg.wait_for_timeout(400)
    print("create open:", pg.evaluate("!document.getElementById('view-create').hidden"), "| Nishiii hidden:", pg.evaluate("document.getElementById('view-nishiii').hidden"))
    pg.click("#nav-nishiii"); pg.click("#nishiii-part-knows"); pg.wait_for_timeout(1000)
    print("asked list:", pg.locator("#asked-list .card").count(), "| notes:", pg.inner_text("#list-notes").replace("\n"," "))
    pg.click("#nav-library"); pg.wait_for_timeout(800); print("library films:", pg.inner_text("#list-screen").replace("\n"," "))
    print("errors:", errs); b.close()

import where as _W
import json, time
from playwright.sync_api import sync_playwright
S=f"{_W.OUT}/shots/"
with sync_playwright() as p:
    b=p.chromium.launch(channel="chrome", args=["--autoplay-policy=no-user-gesture-required"])
    ctx=b.new_context(viewport={"width":390,"height":844}, device_scale_factor=2, has_touch=True, is_mobile=True)
    ctx.add_init_script("document.addEventListener('DOMContentLoaded', () => document.querySelectorAll('details.more').forEach((d) => { d.open = true; }))")   # the Add forms now sit in rows that open on a tap; open them all for this walk
    pg=ctx.new_page(); errs=[]
    pg.on("pageerror", lambda e: errs.append(str(e)))
    cdp=ctx.new_cdp_session(pg); cdp.send("WebAuthn.enable")
    auth=cdp.send("WebAuthn.addVirtualAuthenticator", {"options":{"protocol":"ctap2","transport":"internal","hasResidentKey":True,"hasUserVerification":True,"isUserVerified":True,"automaticPresenceSimulation":True}})["authenticatorId"]
    pg.goto(f"{_W.URL}/"); pg.wait_for_timeout(1000)
    print("lock: faceid button hidden:", pg.evaluate("document.getElementById('faceid-unlock').hidden"))
    pg.fill("#passcode","letmein"); pg.click("#passcode-go"); pg.wait_for_timeout(1500)
    # ---- ask for quotes
    pg.click("#nav-nishiii"); pg.wait_for_timeout(400)   # "Ask for quotes" lives in the Nishiii section
    pg.click("#ask-open"); pg.wait_for_timeout(600)
    print("ask empty:", pg.inner_text("#ask-groups")[:60])
    pg.fill("#ask-new","Meditations"); pg.select_option("#ask-new-kind","book"); pg.click("#ask-add button[type=submit]"); pg.wait_for_timeout(500)
    pg.fill("#ask-new","Interstellar"); pg.select_option("#ask-new-kind","film"); pg.click("#ask-add button[type=submit]"); pg.wait_for_timeout(500)
    pg.fill("#ask-new","Dark"); pg.select_option("#ask-new-kind","series"); pg.click("#ask-add button[type=submit]"); pg.wait_for_timeout(500)
    print("groups:", pg.inner_text("#ask-groups").replace("\n"," | "), "| selected:", pg.locator("#ask-groups button[aria-pressed=true]").count())
    pg.locator("#ask-groups button", has_text="Dark").click()   # deselect the series
    pg.fill("#ask-about","time"); pg.screenshot(path=S+"70_ask.png")
    pg.click("#ask-go"); pg.wait_for_timeout(1500)
    print("sheet closed:", pg.evaluate("document.getElementById('ask-sheet').hidden"))
    cards=pg.locator("#asked-list .card")
    for i in range(3): print("  card", i, "|", cards.nth(i).inner_text().replace("\n"," | ")[:150])
    print("asked chips:", pg.locator("#asked-list .chip.info").count(), "of", cards.count(), "cards")
    pg.screenshot(path=S+"71_today_asked.png")
    # ---- author on/off
    pg.locator("#asked-list .card", has_text="Interstellar").first.locator("text=Use this").click(); pg.wait_for_timeout(400)
    pg.click("#tab-text"); pg.wait_for_timeout(200)
    blocks=lambda: [x["text"] for x in json.loads(pg.evaluate("localStorage.getItem('entangledd.draft.v1')"))["blocks"]]
    print("author row visible:", pg.evaluate("!document.getElementById('author-row').hidden"), "| blocks:", blocks())
    pg.uncheck("#show-author"); pg.wait_for_timeout(200); print("author off:", blocks())
    pg.check("#show-author"); pg.wait_for_timeout(200); print("author on :", blocks())
    pg.uncheck("#show-author"); pg.click("#tab-text"); pg.wait_for_timeout(300); pg.screenshot(path=S+"72_no_author.png")
    # ---- library shows the film and series
    pg.click("#nav-library"); pg.wait_for_timeout(700); print("screen list:", pg.inner_text("#list-screen").replace("\n"," | "))
    # ---- nothing to forget
    pg.click("#nav-nishiii"); pg.wait_for_timeout(600)
    pg.click("#forget-profile"); pg.wait_for_timeout(300)
    print("forget profile, none:", pg.inner_text("#taste-note"), "| dialog shown:", pg.evaluate("!document.getElementById('confirm').hidden"))
    # (picks exist now, so "forget everything" does have something)
    pg.click("#forget-all"); pg.wait_for_timeout(300); print("forget all dialog shown:", pg.evaluate("!document.getElementById('confirm').hidden")); pg.click("#confirm-yes"); pg.wait_for_timeout(700)
    pg.click("#forget-all"); pg.wait_for_timeout(300); print("forget all, none:", pg.inner_text("#taste-note"), "| dialog shown:", pg.evaluate("!document.getElementById('confirm').hidden"))
    # ---- posts without a connection
    pg.click("#nav-posts"); pg.wait_for_timeout(900); print("posts note:", pg.inner_text("#posts-note"))
    # ---- settings + Face ID
    pg.click("#settings-open"); pg.wait_for_timeout(700)
    print("faceid:", pg.inner_text("#faceid-status")[:60], "| button:", pg.inner_text("#faceid-toggle"))
    pg.screenshot(path=S+"73_settings.png")
    pg.click("#faceid-toggle"); pg.wait_for_timeout(1500)
    print("after enable:", pg.inner_text("#faceid-status")[:50], "| token kept on device:", bool(pg.evaluate("localStorage.getItem('entangledd.token.v1')")), "| lock flag:", bool(pg.evaluate("localStorage.getItem('entangledd.faceid.v1')")))
    # With the lock on, the app now asks for Face ID by itself when it opens: no tap.
    pg.reload(); pg.wait_for_timeout(1500)
    print("after reload: unlocked by itself, no tap:", pg.evaluate("document.getElementById('lock').hidden"), "| today cards:", pg.locator("#suggestions .card").count())
    # a failed verification: the device says the person was not verified. The app's own try stays quiet; the button is the way to try again.
    cdp.send("WebAuthn.setUserVerified", {"authenticatorId":auth,"isUserVerified":False})
    pg.reload(); pg.wait_for_timeout(1500)
    print("unverified, asked by itself: still locked:", pg.evaluate("!document.getElementById('lock').hidden"), "| faceid button:", pg.evaluate("!document.getElementById('faceid-unlock').hidden"), "| error shown:", pg.evaluate("!document.getElementById('lock-error').hidden"))
    pg.screenshot(path=S+"74_lock_faceid.png")
    pg.click("#faceid-unlock"); pg.wait_for_timeout(1500)
    print("unverified attempt after a tap: still locked:", pg.evaluate("!document.getElementById('lock').hidden"), "|", pg.inner_text("#lock-error"))
    cdp.send("WebAuthn.setUserVerified", {"authenticatorId":auth,"isUserVerified":True})
    # passcode fallback
    pg.fill("#passcode","letmein"); pg.click("#passcode-go"); pg.wait_for_timeout(1200)
    print("passcode fallback:", pg.evaluate("document.getElementById('lock').hidden"), "| token kept on device:", bool(pg.evaluate("localStorage.getItem('entangledd.token.v1')")))
    # turn off, then sign out
    pg.click("#settings-open"); pg.wait_for_timeout(600); pg.click("#faceid-toggle"); pg.wait_for_timeout(900)
    print("after disable:", pg.inner_text("#faceid-status")[:30], "| token kept:", bool(pg.evaluate("localStorage.getItem('entangledd.token.v1')")))
    pg.click("#sign-out"); pg.wait_for_timeout(300); pg.click("#confirm-yes"); pg.wait_for_timeout(500)
    print("signed out: locked:", pg.evaluate("!document.getElementById('lock').hidden"), "| token kept:", bool(pg.evaluate("localStorage.getItem('entangledd.token.v1')")), "| faceid button hidden:", pg.evaluate("document.getElementById('faceid-unlock').hidden"))
    print("errors:", errs); b.close()

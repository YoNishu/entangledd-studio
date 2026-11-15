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
    pg.goto(f"{_W.URL}/"); pg.wait_for_timeout(1000)
    pg.fill("#passcode","letmein"); pg.click("#passcode-go"); pg.wait_for_timeout(1500)
    print("today:", pg.inner_text("#today-weekday"), "|", pg.inner_text("#today-date"), "| cards:", pg.locator("#suggestions .card").count(), "|", pg.inner_text("#today-note"))
    print("ask button in Today:", pg.locator("#view-today #ask-open").count(), "| more button:", pg.locator("#more").count())
    pg.screenshot(path=S+"80_today.png")
    pg.locator("#suggestions .card").first.locator("text=Skip").click(); pg.wait_for_timeout(300)
    pg.click("#nav-create"); pg.click("#nav-today"); pg.wait_for_timeout(900)
    print("after skip + reopen:", pg.locator("#suggestions .card").count())
    # Library: Find quotes
    pg.click("#nav-library"); pg.wait_for_timeout(700)
    pg.click("#find-open"); pg.wait_for_timeout(500)
    pg.fill("#ask-new","Interstellar"); pg.select_option("#ask-new-kind","film"); pg.click("#ask-add button[type=submit]"); pg.wait_for_timeout(500)
    pg.click("#ask-go"); pg.wait_for_timeout(2500); pg.click("#ask-close"); pg.wait_for_timeout(500)
    print("found list:", pg.locator("#found-list .card").count(), "|", pg.locator("#found-list .card").first.inner_text().replace("\n"," | ")[:150])
    pg.screenshot(path=S+"81_nishiii_asked.png")
    pg.click("#find-open"); pg.wait_for_timeout(400); pg.fill("#ask-about","the sea"); pg.locator("#ask-groups button", has_text="Interstellar").click(); pg.click("#ask-go"); pg.wait_for_timeout(2500); pg.click("#ask-close"); pg.wait_for_timeout(500)
    print("found list after 2nd ask:", pg.locator("#found-list .card").count(), "| newest first:", pg.locator("#found-list .card .chip.info").first.inner_text())
    pg.locator("#found-list .card").first.locator("text=Skip").click(); pg.wait_for_timeout(300)
    pg.locator("#found-list .card").first.locator("text=Create with this").click(); pg.wait_for_timeout(400)
    print("create shown:", pg.evaluate("!document.getElementById('view-create').hidden"))
    pg.click("#nav-library"); pg.wait_for_timeout(800)
    print("found after skip+use:", pg.locator("#found-list .card").count(), "| amber chips:", pg.locator("#found-list .chip.wait").count())
    pg.click("#nav-today"); pg.wait_for_timeout(900)
    print("today still:", pg.locator("#suggestions .card").count(), "| asked chips in Today:", pg.locator("#suggestions .chip.info").count())
    print("errors:", errs); b.close()

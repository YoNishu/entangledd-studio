""""Check everything" in Settings, as she and Nishith see it on an iPhone-sized screen.
Run: python3 tests/test_a3_ui.py   (starts its own fresh server on its own port; screenshots in $STUDIO_OUT/shots)"""
import where as _W
import os, subprocess
from playwright.sync_api import sync_playwright
from a3lib import *

S = f"{_W.OUT}/shots/"; os.makedirs(S, exist_ok=True)
def age():                      # lets "Check now" run again without waiting a real minute
    rec = doc("health")
    if rec: rec["asOf"] -= 120000; putdoc("health", rec)
def fits(pg): return pg.evaluate("(() => { const b = document.querySelector('#settings .sheet-body'); return b.scrollWidth <= b.clientWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1; })()")
def wait_text(pg, sel, part, ms=15000):
    try: pg.wait_for_function("([s, p]) => (document.querySelector(s)?.textContent || '').includes(p)", arg=[sel, part], timeout=ms); return True
    except Exception: return False
def open_settings(pg):
    pg.click("#settings-open"); pg.wait_for_selector("#health-title", timeout=8000)

serve(); t = login(); connect(t)
tick_job("instagram-renew"); tick_job("health-check")            # as on a normal day: the timers have run

with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome")
    for width in (390, 375):
        ctx = b.new_context(viewport={"width": width, "height": 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
        pg = ctx.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: errs.append("console: " + m.text) if m.type == "error" and "401" not in m.text and "429" not in m.text else None)
        pg.goto(B + "/"); pg.wait_for_selector("#passcode", timeout=8000)
        pg.fill("#passcode", "letmein"); pg.click("#passcode-go"); pg.wait_for_timeout(1200)

        print(f"All is well ({width} px wide)")
        hset(githubEnds="", pixabay="ok", pageValid="yes", userValid="yes"); age(); http("POST", "/api/checkup", token=t)
        # (Agent 6: the record now has ten more lines, from the probes of the outside services and the housekeeping.)
        for part in ("services", "page"):
            rec = doc("health"); rec.setdefault("probed", {})[part] = 0; putdoc("health", rec); http("POST", "/api/checkup?part=" + part, token=t)
        open_settings(pg)
        check("one calm line", wait_text(pg, "#health-summary", "Everything is working. Checked today at"), pg.inner_text("#health-summary"))
        check("no list of problems", pg.is_hidden("#health-attention"))
        check("the seven checks are tucked away, closed", pg.is_visible("#health-rest") and pg.inner_text("#health-rest-label") == "See all 18 checks"
              and not pg.evaluate("document.getElementById('health-rest').open"), pg.inner_text("#health-rest-label"))
        check("a Check now button", pg.inner_text("#health-check") == "Check now" and pg.is_enabled("#health-check"))
        check("it sits between the Instagram part and This device", pg.evaluate("""(() => { const y = (s) => document.querySelector(s).getBoundingClientRect().top;
            return y('#ig-status') < y('#health-title') && y('#health-title') < y('#sign-out'); })()"""))
        pg.locator("#health-title").scroll_into_view_if_needed(); pg.screenshot(path=f"{S}health_all_well_{width}.png")
        pg.click("#health-rest-label"); pg.wait_for_timeout(200)
        rows = pg.locator("#health-rest-list > li")
        check("opened: seven lines, each with a title, a sentence and a label", rows.count() == 18 and all(
            rows.nth(i).locator(".main").inner_text() and rows.nth(i).locator(".sub").inner_text() and rows.nth(i).locator(".chip").inner_text() for i in range(18)))
        labels = [rows.nth(i).locator(".chip").inner_text() for i in range(18)]
        check("all labelled Working", labels[:7] == ["Working"] * 7 and set(labels[7:]) <= {"Working", "Not set up", "Not checked yet"} and labels[7:10] == ["Working"] * 3, labels)
        check("nothing runs off the side", fits(pg))
        pg.locator("#health-rest").scroll_into_view_if_needed(); pg.screenshot(path=f"{S}health_all_seven_{width}.png")

        print(f"Two things need Nishith ({width} px wide)")
        hset(githubEnds=9, pixabay="400"); age()
        pg.locator("#health-check").scroll_into_view_if_needed(); pg.click("#health-check")
        check("the line says how many", wait_text(pg, "#health-summary", "2 things need Nishith."), pg.inner_text("#health-summary"))
        need = pg.locator("#health-attention > li")
        check("exactly those two are shown, in the open", pg.is_visible("#health-attention") and need.count() == 2 and
              [need.nth(i).get_attribute("id") for i in range(2)] == ["health-item-github", "health-item-backgrounds"], need.count())
        chips = [need.nth(i).locator(".chip").inner_text() for i in range(2)]
        check("labels: days left, and Needs Nishith", chips[0] in ("8 days left", "9 days left") and chips[1] == "Needs Nishith", chips)
        check("label colours: amber and coral", "wait" in need.nth(0).locator(".chip").get_attribute("class") and "bad" in need.nth(1).locator(".chip").get_attribute("class"))
        check("the steps are closed until asked for", not pg.evaluate("document.getElementById('health-fix-github').open") and pg.locator("#health-fix-github .steps li").first.is_hidden())
        pg.locator("#health-title").scroll_into_view_if_needed(); pg.screenshot(path=f"{S}health_two_closed_{width}.png")
        pg.click("#health-fix-github summary"); pg.wait_for_timeout(200)
        steps = pg.locator("#health-fix-github .steps li")
        check("tapping shows three numbered steps", steps.count() == 3 and steps.first.is_visible() and "No expiration" in steps.nth(1).inner_text(), steps.count())
        check("the rest is tucked under 'What is working (15)'", pg.inner_text("#health-rest-label") == "What is working (15)", pg.inner_text("#health-rest-label"))
        check("nothing runs off the side", fits(pg))
        pg.locator("#health-title").scroll_into_view_if_needed(); pg.screenshot(path=f"{S}health_two_things_{width}.png")
        pg.click("#health-check")
        check("a second tap within the minute is answered in plain words", wait_text(pg, "#health-summary", "Checked a moment ago. Try again in a minute."), pg.inner_text("#health-summary"))
        check("the button is ready again", pg.inner_text("#health-check") == "Check now" and pg.is_enabled("#health-check"))

        if width == 390:
            print("Instagram needs connecting again: one tap brings up the token box, without disconnecting")
            hset(githubEnds="", pixabay="ok", pageValid="no", userValid="no"); age()
            pg.click("#health-check")
            check("the line says so", wait_text(pg, "#health-summary", "1 thing needs Nishith."), pg.inner_text("#health-summary"))
            check("the token box is hidden while connected", pg.is_hidden("#ig-connect") and pg.is_visible("#ig-disconnect"))
            check("Connect again is offered on the Instagram line", pg.is_visible("#health-item-instagram #health-reconnect"))
            pg.locator("#health-item-instagram").scroll_into_view_if_needed(); pg.screenshot(path=f"{S}health_instagram_{width}.png")
            pg.click("#health-reconnect"); pg.wait_for_timeout(700)
            check("the token box appears, ready to type in", pg.is_visible("#ig-connect") and pg.evaluate("document.activeElement.id") == "ig-token")
            check("nothing was disconnected", doc("instagram") is not None and pg.is_visible("#ig-disconnect"))
            hset(pageValid="yes", userValid="yes")
            pg.fill("#ig-token", "SHORT-" + "a" * 60); pg.click("#ig-connect button[type=submit]")
            check("a new token connects and the box goes away again", wait_text(pg, "#ig-status", "Connected as @theentangledd") and pg.is_hidden("#ig-connect"), pg.inner_text("#ig-status"))
            check("the Instagram line in Settings speaks of self-renewal", "the app will try to renew it by itself" in pg.inner_text("#ig-status"), pg.inner_text("#ig-status"))
            ig = doc("instagram"); ig["renewedAt"] = now_ms() - DAY; putdoc("instagram", ig)
            pg.click("#settings-close"); open_settings(pg)
            check("and, once it has happened, says the app renews it", wait_text(pg, "#ig-status", "The app renews the sign-in by itself"), pg.inner_text("#ig-status"))
            age(); pg.click("#health-check")
            check("all well again after reconnecting", wait_text(pg, "#health-summary", "Everything is working."), pg.inner_text("#health-summary"))

            print("First ever look, nothing on record: it checks by itself")
            deldoc("health")
            pg.click("#settings-close"); open_settings(pg)
            check("the summary fills in without a tap", wait_text(pg, "#health-summary", "Checked today at"), pg.inner_text("#health-summary"))
            check("opening Settings twice does not build the section twice", pg.locator("#health-title").count() == 1 and pg.locator("#health-check").count() == 1)

            print("A record gone quiet for over a day (the timers may have stopped): Settings looks again by itself")
            rec = doc("health"); rec["asOf"] -= 20 * 3600000; putdoc("health", rec); was = rec["asOf"]
            pg.click("#settings-close"); open_settings(pg); pg.wait_for_timeout(1500)
            check("20 hours old is normal: shown as it is, no new check", doc("health")["asOf"] == was and pg.inner_text("#health-check") == "Check now")
            rec = doc("health"); rec["asOf"] -= 7 * 3600000; putdoc("health", rec)
            pg.click("#settings-close"); open_settings(pg)
            check("27 hours old: checked again without a tap", wait_text(pg, "#health-summary", "Checked today at") and now_ms() - doc("health")["asOf"] < 60000, pg.inner_text("#health-summary"))

            print("Signed out: the section asks nothing and shows nothing private")
            pg.click("#sign-out"); pg.click("#confirm-yes"); pg.wait_for_timeout(600)
            check("the lock is back", pg.is_visible("#lock"))
            check("the health section is gone from view", pg.is_hidden("#settings"))
        check("no script errors", not errs, errs[:3])
        ctx.close()
    b.close()

http("GET", "/__health_reset")
subprocess.run([f"{_W.HERE}/stop"], capture_output=True)
finish()

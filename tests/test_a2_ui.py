"""Agent 2: the new name, the heading, the tab bar, the top gap and the tidy-up, checked for real.
Run:  tests/serve && python3 tests/test_a2_ui.py
Every check asserts; the script ends with PASS or FAIL and a non-zero exit on failure."""
import where as _W
import json, re, subprocess, sys, urllib.request
from playwright.sync_api import sync_playwright

BASE = f"{_W.URL}"
WT = f"{_W.ROOT}"
SHOTS = f"{_W.OUT}/shots/"
fails = []

def check(name, ok, detail=""):
    print(("ok   " if ok else "FAIL ") + name + (("  -> " + str(detail)) if detail and not ok else ""))
    if not ok:
        fails.append(name)

def get(path):
    return urllib.request.urlopen(BASE + path).read().decode("utf-8")

VIEWS = ["today", "create", "library", "posts", "insights", "nishiii"]
OPEN = "document.querySelectorAll('details').forEach((d) => { d.open = true; })"

# ---------- files as served ----------
html = get("/")
css = get("/app.css")
manifest = json.loads(get("/manifest.webmanifest"))
check("page title is D's Studio", "<title>D's Studio</title>" in html)
check("home-screen title is D's Studio", 'name="apple-mobile-web-app-title" content="D\'s Studio"' in html)
check("manifest name and short name", manifest["name"] == "D's Studio" and manifest["short_name"] == "D's Studio", manifest)
sizes = sorted((i["sizes"], i.get("purpose", "")) for i in manifest["icons"])
check("manifest lists 180, 192, 512 and a maskable icon", ("192x192", "") in sizes and ("512x512", "") in sizes and ("512x512", "maskable") in sizes and ("180x180", "") in sizes, sizes)
for name, size in [("icon-180.png", 180), ("icon-192.png", 192), ("icon-512.png", 512), ("icon-maskable-512.png", 512)]:
    raw = urllib.request.urlopen(BASE + "/" + name).read()
    w, h = int.from_bytes(raw[16:20], "big"), int.from_bytes(raw[20:24], "big")
    check(f"{name} is a {size} px square PNG", raw[:8] == b"\x89PNG\r\n\x1a\n" and (w, h) == (size, size), (w, h))
check("the old name is nowhere in the page", "Entangledd Studio" not in html)
for f in ["app.js", "studio.js", "insights.js"]:
    body = get("/" + f)
    shown = [m for m in re.findall(r'"[^"\n]*Entangledd Studio[^"\n]*"', body)]
    check(f"no quoted 'Entangledd Studio' left in {f}", not shown, shown[:2])
worker = open(WT + "/server/worker.js").read()
check("Nishiii is told the app is D's Studio (both prompts)", worker.count("inside D's Studio") == 2 and "inside Entangledd Studio" not in worker)
check("the user-agent the outside services see is unchanged", worker.count("EntangleddStudio/1.0") == 3)
check("storage keys are unchanged", '"entangledd.token.v1"' in get("/app.js") and '"entangledd.draft.v1"' in get("/app.js"))

# every id the page had before is still there
before = subprocess.run(["git", "-C", WT, "show", "d576d40:web/index.html"], capture_output=True, text=True, check=True).stdout
ids_before = set(re.findall(r'\bid="([^"]+)"', before))
ids_now = set(re.findall(r'\bid="([^"]+)"', html))
# Ids taken away on purpose since: the chat sheet and its header button (the chat is a part of the Nishiii tab now).
GONE = {"chat", "chat-close", "chat-open", "chat-title"}
check("every element id from before still exists, but for those taken away on purpose", ids_before - ids_now <= GONE, sorted(ids_before - ids_now - GONE))
all_ids = re.findall(r'\bid="([^"]+)"', html)
check("no element id is used twice", len(all_ids) == len(set(all_ids)), sorted({i for i in all_ids if all_ids.count(i) > 1}))
sym = re.search(r'<symbol id="wm" viewBox="([^"]+)"', html)
check("the wordmark's drawing starts at 0 0, so it needs no offsets", bool(sym) and sym.group(1).startswith("0 0 ") and html.count('<use href="#wm"/>') == 2, sym and sym.group(1))

# the stylesheet's promises
check("no backdrop-filter anywhere", "backdrop-filter" not in css)
bad = []
for decl in re.findall(r"transition:\s*([^;}]+)", css):
    if decl.strip().startswith("none"):
        continue
    for part in decl.split(","):
        words = part.split()
        prop, secs = words[0], [float(x[:-1]) for x in words if re.fullmatch(r"[\d.]+s", x)]
        if prop not in ("transform", "opacity") or not secs or max(secs) > 0.2:
            bad.append(part.strip())
check("transitions only on transform or opacity, 200 ms at most", not bad, bad)
check("the wordmark has no filter, shadow or blur", not re.search(r"\.wordmark[^{]*\{[^}]*(filter|shadow|blur)", css) and not re.search(r"\.wm-heart[^{]*\{[^}]*(filter|shadow|blur)", css))
m = re.search(r"--top-gap:\s*(\d+)px", css)
check("--top-gap is 8 to 12 px", bool(m) and 8 <= int(m.group(1)) <= 12, m and m.group(0))
TOP_GAP = int(m.group(1)) if m else 0
check("chart colours and their surface are untouched", "#2A9D8A" in css and re.search(r"--tide:\s*#16303C", css) is not None and "#D9773F" in get("/insights.js"))
# (The slots were filled when the add-on sections were merged: their styles now sit under three headings, last in the file.)
heads = re.findall(r"^/\* ---- ([a-z ]+)", css[css.find("/* ==== Add-on sections"):], re.M)
check("the three add-on sections keep their styles at the end of the stylesheet, each under its own heading",
      "/* ==== Add-on sections" in css and [h.split(":")[0].strip().split(" ")[0] for h in heads] == ["health", "scorer", "little"], heads)
check("reduced motion is respected", "prefers-reduced-motion: reduce" in css)

with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome")

    def page(width, **extra):
        ctx = b.new_context(viewport={"width": width, "height": 844}, device_scale_factor=2, has_touch=True, is_mobile=True, **extra)
        pg = ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" and "401" not in m.text else None)
        pg.goto(BASE + "/")
        pg.wait_for_timeout(1000)
        return ctx, pg, errs

    # ---------- the lock ----------
    ctx, pg, errs = page(390)
    check("lock screen is showing", pg.locator("#lock").is_visible())
    lock_mark = pg.evaluate("""() => { const s = document.querySelector('#lock .wordmark svg'); const r = s.getBoundingClientRect();
      const h = s.querySelector('.wm-heart'); const cs = getComputedStyle(s);
      return { label: s.getAttribute('aria-label'), w: r.width, h: r.height, heart: getComputedStyle(h).fill, filter: cs.filter, use: !!s.querySelector('use') }; }""")
    check("lock: the wordmark is vector and says D's Studio", lock_mark["label"] == "D's Studio" and lock_mark["use"], lock_mark)
    check("lock: the wordmark is large (over 300 px wide)", lock_mark["w"] > 300 and lock_mark["h"] > 44, lock_mark)
    check("lock: the heart is rose and nothing softens the mark", lock_mark["heart"] == "rgb(242, 167, 181)" and lock_mark["filter"] == "none", lock_mark)
    check("lock: made for Dhruuu, by Nishiii", "Made for Dhruuu, by Nishiii" in pg.inner_text("#lock").replace("\n", " "))
    hand = pg.evaluate("getComputedStyle(document.querySelector('.tagline')).fontFamily")
    check("lock: the dedication is in his hand", "Nothing You Could Do" in hand, hand)
    pg.screenshot(path=SHOTS + "a2_lock.png")
    pg.fill("#passcode", "letmein"); pg.click("#passcode-go"); pg.wait_for_timeout(1500)
    check("the passcode opens the studio", pg.evaluate("document.getElementById('lock').hidden"))

    # ---------- heading and top gap ----------
    pad = pg.evaluate("parseFloat(getComputedStyle(document.body).paddingTop)")
    check("the app starts lower by exactly the top gap", abs(pad - TOP_GAP) < 0.01, pad)
    head = pg.evaluate("""() => { const s = document.querySelector('#wordmark svg'); const r = s.getBoundingClientRect();
      return { label: s.getAttribute('aria-label'), top: r.top, w: r.width, tag: document.getElementById('wordmark').tagName }; }""")
    check("heading: an h1 with the vector wordmark", head["tag"] == "H1" and head["label"] == "D's Studio", head)
    check("heading sits below the gap", head["top"] >= TOP_GAP, head)
    check("the words 'Entangledd Studio' are not on screen", "Entangledd Studio" not in pg.inner_text("body"))

    # ---------- the six sections ----------
    bar = pg.evaluate("""() => { const n = document.querySelector('nav.views').getBoundingClientRect();
      return { bottom: n.bottom, top: n.top, vh: innerHeight, tabs: [...document.querySelectorAll('nav.views button')].map((x) => { const r = x.getBoundingClientRect();
        return { id: x.id, w: r.width, h: r.height, label: x.textContent.trim(), mask: getComputedStyle(x, '::before').webkitMaskImage || getComputedStyle(x, '::before').maskImage }; }) }; }""")
    check("tab bar sits at the bottom of the screen", abs(bar["bottom"] - bar["vh"]) < 1 and bar["top"] > bar["vh"] - 110, bar["bottom"])
    check("six tabs with the ids nav-today … nav-nishiii", [t["id"] for t in bar["tabs"]] == ["nav-" + v for v in VIEWS])
    check("each tab is at least 44 px each way", all(t["w"] >= 44 and t["h"] >= 44 for t in bar["tabs"]), [(t["w"], t["h"]) for t in bar["tabs"]])
    check("each tab has an icon and a word", all(t["mask"].startswith("url(") and t["label"] for t in bar["tabs"]), [t["mask"][:20] for t in bar["tabs"]])
    for v in VIEWS:
        pg.click("#nav-" + v); pg.wait_for_timeout(350)
        state = pg.evaluate("""(v) => ({ shown: !document.getElementById('view-' + v).hidden,
          pressed: [...document.querySelectorAll('nav.views button')].filter((x) => x.getAttribute('aria-pressed') === 'true').map((x) => x.id),
          hello: !document.getElementById('hello').hidden,
          wide: document.documentElement.scrollWidth > innerWidth }) """, v)
        check(f"{v}: shown, and only its tab is pressed", state["shown"] and state["pressed"] == ["nav-" + v], state)
        check(f"{v}: the note line shows only on Today", state["hello"] == (v == "today"), state["hello"])
        check(f"{v}: nothing spills sideways", not state["wide"])
    pg.click("#nav-today"); pg.wait_for_timeout(600)
    today_w = pg.evaluate("document.querySelector('#wordmark svg').getBoundingClientRect().width")
    pg.click("#nav-create"); pg.wait_for_timeout(300)
    create_w = pg.evaluate("document.querySelector('#wordmark svg').getBoundingClientRect().width")
    check("the name is one size on every screen, and large", abs(today_w - create_w) < 0.5 and today_w >= 200, (today_w, create_w))
    heart = pg.evaluate("""() => { const h = document.querySelector('#wordmark .wm-heart'); const r = h.getBoundingClientRect(); const s = document.querySelector('#wordmark svg').getBoundingClientRect();
      return { fill: getComputedStyle(h).fill, filter: getComputedStyle(h).filter, top: r.top - s.top, left: (r.left - s.left) / s.width, w: r.width }; }""")
    check("the heart is rose, unfiltered, and sits up where the apostrophe goes", heart["fill"] == "rgb(242, 167, 181)" and heart["filter"] == "none" and heart["top"] < 2 and 0.1 < heart["left"] < 0.2 and heart["w"] >= 10, heart)
    chat = pg.evaluate("[...document.querySelectorAll('.top-actions button')].filter((b) => !b.hidden).map((b) => b.id)")
    check("the header has Settings alone (the chat lives in the Nishiii tab)", chat == ["settings-open"], chat)
    pg.click("#nav-nishiii"); pg.wait_for_timeout(300)
    check("Nishiii: the chat is the tab's first part", pg.evaluate("document.getElementById('view-nishiii').dataset.part") == "chat" and pg.locator("#chat-form").is_visible())
    pg.click("#nav-create"); pg.wait_for_timeout(300)
    filled = pg.evaluate("[...document.querySelectorAll('#view-create .btn.primary')].map((b) => b.id || b.textContent.trim())")
    check("Create: the tall choice buttons are equals (none filled)", pg.evaluate("document.querySelectorAll('.btn.tall.primary').length") == 0, filled)

    # ---------- the note's home ----------
    pg.click("#nav-today"); pg.wait_for_timeout(300)
    note = pg.evaluate("""() => { const h = document.getElementById('hello'); const cs = getComputedStyle(h); const sig = h.querySelector('.sig');
      return { font: cs.fontFamily, min: parseFloat(cs.minHeight), sig: getComputedStyle(sig).color, text: h.textContent }; }""")
    check("Today: the line under the name is in his hand, signed in rose", "Nothing You Could Do" in note["font"] and note["sig"] == "rgb(242, 167, 181)" and "Nishiii" in note["text"], note)
    check("Today: room for two lines is kept for the note", note["min"] >= 50, note["min"])
    home = pg.evaluate("""() => { const h = document.getElementById('hello'), page = document.getElementById('view-today'), bar = document.querySelector('header.bar');
      return { first: page.firstElementChild === h, gap: h.getBoundingClientRect().top - bar.getBoundingClientRect().bottom, barH: bar.getBoundingClientRect().height }; }""")
    check("Today: the note is the first thing on the page, right under the name", home["first"] and 0 <= home["gap"] <= 12, home)
    pg.click("#nav-create"); pg.wait_for_timeout(250)
    create_bar = pg.evaluate("document.querySelector('header.bar').getBoundingClientRect().height")
    pg.click("#nav-today"); pg.wait_for_timeout(300)
    check("the heading is the same height on Today as elsewhere (only the name stays put)", abs(home["barH"] - create_bar) < 0.5 and create_bar <= 60, (home["barH"], create_bar))
    before_top = pg.evaluate("document.querySelector('#view-today .dayhead').getBoundingClientRect().top")
    pg.evaluate("""() => { const h = document.getElementById('hello'); const sig = h.querySelector('.sig'); h.textContent = '';
      const s = document.createElement('span'); s.className = 'lovenote-text'; s.textContent = 'You make ordinary days feel like chapters worth reading.';
      h.classList.add('lovenote'); h.append(s, sig); }""")
    after_top = pg.evaluate("document.querySelector('#view-today .dayhead').getBoundingClientRect().top")
    check("Today: a two-line note arriving moves nothing", abs(after_top - before_top) < 0.5, (before_top, after_top))
    pg.screenshot(path=SHOTS + "a2_today.png")

    # ---------- tap targets ----------
    def small(view, sel, least):
        return pg.evaluate("""([sel, least]) => [...document.querySelectorAll(sel)].filter((x) => x.getClientRects().length && !x.disabled)
          .map((x) => { const r = x.getBoundingClientRect(); return { t: (x.textContent || x.id || x.className).trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) }; })
          .filter((x) => x.h < least || x.w < least)""", [sel, least])
    FULL = ".btn, .iconbtn, .chatbtn, nav.views button, .tabs button, .list button, .links button, .links a, summary, .check, select, textarea, input[type=text], input[type=search], input[type=password]"
    PART = ".chips button, .picks button, .seg button, .swatches button"      # drawn 36 to 38 px tall, with an unseen margin that makes the place to tap 44
    for v in VIEWS:
        pg.click("#nav-" + v); pg.wait_for_timeout(500)
        pg.evaluate(OPEN)
        if v == "insights":
            hit = pg.evaluate("""() => { const b = document.querySelector('#ins-range button'); const a = getComputedStyle(b, '::after'); const r = b.getBoundingClientRect();
              return r.height - parseFloat(a.top) - parseFloat(a.bottom); }""")
            check("a segment's place to tap is 44 px tall", hit >= 44, hit)
        if v == "create":
            for tab in ["bg", "text", "style", "music", "save"]:
                if pg.evaluate(f"document.getElementById('pane-{tab}').hidden"):
                    pg.click("#tab-" + tab)
                pg.wait_for_timeout(150)
                s1, s2 = small(v, f"#pane-{tab} :is({FULL}), .tabs button", 44), small(v, f"#pane-{tab} :is({PART})", 36)
                check(f"create/{tab}: tap targets are big enough", not s1 and not s2, (s1 + s2)[:4])
        else:
            s1, s2 = small(v, f"#view-{v} :is({FULL}), .bar :is({FULL})", 44), small(v, f"#view-{v} :is({PART})", 36)
            check(f"{v}: tap targets are big enough", not s1 and not s2, (s1 + s2)[:4])

    # ---------- Library: the forms open on a tap and still work ----------
    pg.reload(); pg.wait_for_timeout(1500)
    pg.click("#nav-library"); pg.wait_for_timeout(500)
    check("Library: the add forms start closed", not pg.locator("#q-text").is_visible() and not pg.locator("#b-title").is_visible())
    pg.locator("#view-library summary", has_text="Add a quote").click(); pg.wait_for_timeout(250)
    check("Library: 'Add a quote' opens its form", pg.locator("#q-text").is_visible())
    pg.fill("#q-text", "Be a lamp, or a lifeboat, or a ladder."); pg.fill("#q-author", "Rumi")
    pg.click("#add-quote button[type=submit]"); pg.wait_for_timeout(800)
    check("Library: the saved quote is listed", "Be a lamp" in pg.inner_text("#list-quotes"))
    check("Library: scan and import are still there", pg.locator("#scan").count() == 1 and pg.locator("#import").count() == 1 and pg.locator("#scan-label").is_visible())
    pg.screenshot(path=SHOTS + "a2_library.png")

    # ---------- sheets: below the gap, and closing ----------
    pg.click("#settings-open"); pg.wait_for_timeout(400)
    sheet = pg.evaluate("""() => { const s = document.querySelector('#settings .sheet-body'); const cs = getComputedStyle(s);
      return { max: parseFloat(cs.maxHeight), vh: innerHeight, top: s.getBoundingClientRect().top, close: document.getElementById('settings-close').getBoundingClientRect().width }; }""")
    check("a sheet can never reach the status bar", abs(sheet["max"] - (sheet["vh"] - TOP_GAP)) < 1 and sheet["top"] >= TOP_GAP, sheet)
    check("the close button is a 44 px target with a name", sheet["close"] >= 44 and pg.get_attribute("#settings-close", "aria-label") == "Close", sheet)
    pg.evaluate("document.querySelector('#settings .sheet-body').scrollTop = 0")
    pg.screenshot(path=SHOTS + "a2_settings.png")
    pg.click("#settings-close"); pg.wait_for_timeout(200)
    check("the sheet closes", pg.evaluate("document.getElementById('settings').hidden"))
    check("homes for the add-on sections exist and take no room while empty", pg.evaluate("""() => ['settings-lovenotes', 'settings-health', 'scorer-slot'].every((id) => {
      const e = document.getElementById(id); return e && (e.children.length > 0 || getComputedStyle(e).display === 'none'); })"""))
    check("no script errors on the way", not errs, errs[:3])
    ctx.close()

    # ---------- other widths ----------
    for width in (375, 430):
        ctx, pg, errs = page(width)
        pg.fill("#passcode", "letmein"); pg.click("#passcode-go"); pg.wait_for_timeout(1500)
        wide = []
        for v in VIEWS:
            pg.click("#nav-" + v); pg.wait_for_timeout(350)
            pg.evaluate(OPEN)
            over = pg.evaluate("""(v) => { const page = document.getElementById('view-' + v); const out = [];
              if (document.documentElement.scrollWidth > innerWidth) out.push('page');
              page.querySelectorAll('*').forEach((e) => { const r = e.getBoundingClientRect();
                if (r.width && (r.right > innerWidth + 0.5 || r.left < -0.5) && !e.closest('.chips.pick, .tray, svg, canvas')) out.push(e.tagName + '.' + e.className); });
              return out.slice(0, 4); }""", v)
            if over:
                wide.append((v, over))
        check(f"{width} px wide: nothing is cut off or spills sideways", not wide, wide)
        labels = pg.evaluate("[...document.querySelectorAll('nav.views button')].every((x) => x.scrollWidth <= x.clientWidth + 1)")
        check(f"{width} px wide: every tab label fits", labels)
        ctx.close()

    # ---------- less motion ----------
    ctx, pg, errs = page(390, reduced_motion="reduce")
    anim = pg.evaluate("getComputedStyle(document.querySelector('#lock .wm-heart')).animationName")
    check("with reduced motion the heart keeps still", anim == "none", anim)
    ctx.close()
    ctx, pg, errs = page(390)
    anim = pg.evaluate("getComputedStyle(document.querySelector('#lock .wm-heart')).animationName")
    check("otherwise the heart beats when the app opens", anim == "beat", anim)
    ctx.close()
    b.close()

print("\n" + ("PASS" if not fails else "FAIL: " + "; ".join(fails)))
sys.exit(1 if fails else 0)

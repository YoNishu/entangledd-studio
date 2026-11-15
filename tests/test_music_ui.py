import where as _W
import json, sys, time, urllib.request
sys.path.insert(0, f"{_W.MEDIA}")
from pitch import peaks
from playwright.sync_api import sync_playwright
S=f"{_W.OUT}/shots/"
def wait(pg, cond, timeout=90):
    t=time.time()
    while time.time()-t<timeout:
        if pg.evaluate(cond): return True
        pg.wait_for_timeout(500)
    return False
def save_reel(pg, path):
    data=pg.evaluate("(async () => { const b = Studio.currentReel().blob; const a = new Uint8Array(await b.arrayBuffer()); let s=''; for (let i=0;i<a.length;i+=8192) s+=String.fromCharCode.apply(null,a.subarray(i,i+8192)); return btoa(s); })()")
    import base64; open(path,"wb").write(base64.b64decode(data))
with sync_playwright() as p:
    b=p.chromium.launch(channel="chrome", args=["--autoplay-policy=no-user-gesture-required"])
    pg=b.new_context(viewport={"width":390,"height":844}, device_scale_factor=2, has_touch=True, is_mobile=True).new_page(); errs=[]
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append("console: "+m.text) if m.type=="error" and "401" not in m.text else None)
    pg.goto(f"{_W.URL}/"); pg.wait_for_timeout(900)
    pg.fill("#passcode","letmein"); pg.click("#passcode-go"); pg.wait_for_timeout(1500)
    pg.click("#settings-open"); pg.wait_for_timeout(400); pg.fill("#ig-token","SHORT-"+"a"*60); pg.click("#ig-connect button[type=submit]"); pg.wait_for_timeout(900); pg.click("#settings-close")
    pg.click("#nav-create"); pg.wait_for_timeout(300)
    pg.evaluate("Studio.setQuote('the sea keeps no calendar', '')")
    print("tabs:", pg.evaluate("[...document.querySelectorAll('.tabs button')].map(b => [b.textContent, Math.round(b.getBoundingClientRect().width), b.scrollWidth > b.clientWidth])"))
    pg.click("#tab-music"); pg.wait_for_timeout(300)
    print("empty state:", pg.inner_text("#tune-state")[:70], "| options hidden:", pg.evaluate("document.getElementById('tune-opts').hidden"))
    pg.screenshot(path=S+"160_music_empty.png")

    # --- 1. a free track, with credit
    pg.click("#tune-search"); pg.wait_for_timeout(1500)
    rows=pg.locator("#tune-list li")
    print("search rows:", [r.replace("\n"," | ") for r in rows.all_inner_texts()])
    pg.screenshot(path=S+"161_music_search.png")
    rows.nth(0).locator("button", has_text="Listen").click(); pg.wait_for_timeout(900)
    print("listening:", rows.nth(0).locator("button").first.inner_text(), "| playing:", pg.evaluate("!document.querySelector('audio') || true"))
    rows.nth(0).locator("button", has_text="Use this").click(); print("track chosen, sheet closed:", wait(pg, "document.getElementById('tune-sheet').hidden", 15))
    print("music pane:", pg.inner_text("#tune-name"), "|", pg.inner_text("#tune-licence"), "| tab:", pg.inner_text("#tab-music"), "| start:", pg.inner_text("#tune-start-out"), "| max", pg.get_attribute("#tune-start","max"))
    pg.evaluate("(() => { const s=document.getElementById('tune-start'); s.value=12; s.dispatchEvent(new Event('input')); const v=document.getElementById('tune-vol'); v.value=50; v.dispatchEvent(new Event('input')); })()")
    print("after sliders:", pg.inner_text("#tune-start-out"), "|", pg.inner_text("#tune-vol-out"))
    pg.click("#tune-play"); pg.wait_for_timeout(700)
    print("preview:", pg.inner_text("#tune-play"), "| at", pg.evaluate("Math.round(Studio.musicState().time)"), "s, volume", pg.evaluate("Studio.musicState().volume")); pg.click("#tune-play")
    pg.screenshot(path=S+"162_music_set.png")
    pg.click("#tab-save"); pg.wait_for_timeout(200); pg.click("#make-reel"); print("reel made:", wait(pg, "!document.getElementById('reel-result').hidden"), "|", pg.inner_text("#done") if not pg.evaluate("document.getElementById('done').hidden") else "")
    save_reel(pg, f"{_W.OUT}/ui_library.mp4"); print("  sound in the reel (expect 600, started 12 s in):", peaks(f"{_W.OUT}/ui_library.mp4", 2))
    pg.click("#post-open"); pg.wait_for_timeout(800)
    print("post sheet: Instagram music hidden:", pg.evaluate("document.getElementById('post-music').hidden"), "|", pg.inner_text("#post-own-music"))
    print("  caption prefilled:", repr(pg.input_value("#post-caption")), "| note shown:", pg.evaluate("!document.getElementById('post-credit-note').hidden"))
    pg.click("#post-write"); pg.wait_for_timeout(900); cap=pg.input_value("#post-caption"); print("  after Nishiii's caption, credit kept:", cap.strip().endswith("from Jamendo)"), "|", cap[-70:].replace("\n"," / "))
    pg.fill("#post-caption","just my own words"); pg.screenshot(path=S+"163_music_post.png")
    pg.click("#post-go"); print("  posted:", wait(pg, "document.getElementById('post-status').textContent.startsWith('Posted')", 60)); pg.click("#post-close")

    # --- 2. her own file (an m4a), kept clip sound, from the start
    pg.click("#again"); pg.click("#tab-music"); pg.wait_for_timeout(200)
    pg.set_input_files("#tune-file", f"{_W.MEDIA}/tone.m4a"); pg.wait_for_timeout(900)
    print("own file:", pg.inner_text("#tune-name"), "|", pg.inner_text("#tune-licence"), "|", pg.inner_text("#tune-start-out"))
    pg.click("#tab-save"); pg.click("#make-reel"); print("reel made:", wait(pg, "!document.getElementById('reel-result').hidden"))
    save_reel(pg, f"{_W.OUT}/ui_own.mp4"); print("  sound in the reel (expect 500):", peaks(f"{_W.OUT}/ui_own.mp4", 2))
    pg.click("#post-open"); pg.wait_for_timeout(800); print("post sheet:", pg.inner_text("#post-own-music")[:60], "| caption empty:", pg.input_value("#post-caption")=="", "| credit note hidden:", pg.evaluate("document.getElementById('post-credit-note').hidden")); pg.click("#post-close")

    # --- 3. bad files, removing, and a reel without music
    pg.click("#again"); pg.click("#tab-music")
    pg.set_input_files("#tune-file", f"{_W.MEDIA}/sky.jpg"); pg.wait_for_timeout(600); print("a picture as music:", pg.inner_text("#tune-say"))
    pg.set_input_files("#tune-file", f"{_W.MEDIA}/book.txt"); pg.wait_for_timeout(600); print("a text file as music:", pg.inner_text("#tune-say"))
    print("  music still the earlier one:", pg.inner_text("#tune-name"))
    pg.click("#tune-clear"); pg.wait_for_timeout(200); print("removed:", pg.evaluate("document.getElementById('tune-opts').hidden"), "| tab:", pg.inner_text("#tab-music"))
    pg.click("#tab-save"); pg.click("#make-reel"); print("reel made:", wait(pg, "!document.getElementById('reel-result').hidden"))
    save_reel(pg, f"{_W.OUT}/ui_none.mp4"); print("  sound in the reel (expect none):", peaks(f"{_W.OUT}/ui_none.mp4", 2))
    pg.click("#post-open"); pg.wait_for_timeout(800); print("post sheet: Instagram music offered again:", pg.evaluate("!document.getElementById('post-music').hidden"), "| own-music note hidden:", pg.evaluate("document.getElementById('post-own-music').hidden")); pg.click("#post-close")
    token=pg.evaluate("Studio.server.token"); print("errors:", errs); b.close()
req=urllib.request.Request(f"{_W.URL}/api/posts"); req.add_header("Authorization","Bearer "+token)
post=json.load(urllib.request.urlopen(req))["posts"][0]; print("posted caption on the server:", repr(post["caption"]))
log=json.load(urllib.request.urlopen(f"{_W.URL}/__graph_log")); c=[e for e in log if e["params"].get("media_type")=="REELS"][-1]["params"]
print("sent to Instagram: caption ends with credit:", c["caption"].endswith("from Jamendo)"), "| audio_configuration sent:", "audio_configuration" in c)
req=urllib.request.Request(f"{_W.URL}/api/insights?range=all"); req.add_header("Authorization","Bearer "+token)
print("insights row music:", json.load(urllib.request.urlopen(req))["posts"][0]["music"])

import where as _W
import json, sys, time, urllib.request, base64
sys.path.insert(0, f"{_W.MEDIA}")
from pitch import peaks
from playwright.sync_api import sync_playwright
mode = sys.argv[1]
def wait(pg, cond, timeout=90):
    t=time.time()
    while time.time()-t<timeout:
        if pg.evaluate(cond): return True
        pg.wait_for_timeout(500)
    return False
def save_reel(pg, path):
    data=pg.evaluate("(async () => { const a = new Uint8Array(await Studio.currentReel().blob.arrayBuffer()); let s=''; for (let i=0;i<a.length;i+=8192) s+=String.fromCharCode.apply(null,a.subarray(i,i+8192)); return btoa(s); })()")
    open(path,"wb").write(base64.b64decode(data))
with sync_playwright() as p:
    b=p.chromium.launch(channel="chrome", args=["--autoplay-policy=no-user-gesture-required"])
    pg=b.new_context(viewport={"width":390,"height":844}, has_touch=True, is_mobile=True).new_page(); errs=[]
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"{_W.URL}/"); pg.wait_for_timeout(900)
    pg.fill("#passcode","letmein"); pg.click("#passcode-go"); pg.wait_for_timeout(1500)
    pg.click("#nav-create"); pg.wait_for_timeout(300); pg.evaluate("Studio.setQuote('start again', '')")
    if mode == "limited":
        pg.click("#tab-music"); pg.click("#tune-search"); pg.wait_for_timeout(1500)
        print("when the library says wait:", pg.inner_text("#tune-status")); print("errors:", errs); b.close(); sys.exit()
    pg.click("#settings-open"); pg.wait_for_timeout(400); pg.fill("#ig-token","SHORT-"+"a"*60); pg.click("#ig-connect button[type=submit]"); pg.wait_for_timeout(900); pg.click("#settings-close")
    # a video with its own sound as the background (sound kept), and a video file as the music
    pg.click("#tab-bg"); pg.set_input_files("#file", f"{_W.MEDIA}/songclip.mp4"); pg.wait_for_timeout(1200)
    pg.evaluate("(() => { const m=document.getElementById('mute'); m.checked=false; m.dispatchEvent(new Event('change')); })()")
    pg.click("#tab-music"); pg.set_input_files("#tune-file", f"{_W.MEDIA}/big.mp4"); pg.wait_for_timeout(1500)
    print("a silent video as music:", repr(pg.inner_text("#tune-say")), "| accepted:", pg.evaluate("!!Studio.musicState()"))
    pg.set_input_files("#tune-file", f"{_W.MEDIA}/tone.m4a"); pg.wait_for_timeout(900)
    pg.click("#tab-save"); pg.click("#make-reel"); ok=wait(pg, "!document.getElementById('reel-result').hidden || !document.getElementById('done').hidden")
    print("clip sound kept + own music -> made:", not pg.evaluate("document.getElementById('reel-result').hidden"), "|", pg.inner_text("#done") if not pg.evaluate("document.getElementById('done').hidden") else "")
    save_reel(pg, f"{_W.OUT}/ui_mix.mp4"); print("  sound in the reel (expect 500 and 700):", peaks(f"{_W.OUT}/ui_mix.mp4", 2))
    # a free track with credit, kept for later, then posted from the waiting list
    pg.click("#again"); pg.click("#tab-music"); pg.click("#tune-search"); pg.wait_for_timeout(1500)
    pg.locator("#tune-list li").nth(0).locator("button", has_text="Use this").click(); wait(pg, "document.getElementById('tune-sheet').hidden", 15)
    pg.click("#tab-save"); pg.click("#make-reel"); print("free track -> made:", wait(pg, "!document.getElementById('reel-result').hidden"))
    pg.click("#queue-add"); pg.wait_for_timeout(800); print("kept for later:", pg.inner_text("#queue-add")[:40])
    pg.reload(); pg.wait_for_timeout(1500)                                   # a fresh start, as on another day
    if pg.locator("#passcode").is_visible(): pg.fill("#passcode","letmein"); pg.click("#passcode-go"); pg.wait_for_timeout(1500)
    pg.click("#nav-posts"); pg.wait_for_timeout(2500)
    pg.locator("#list-queue .card .btn.primary").first.click(); pg.wait_for_timeout(900)
    print("from the waiting list: Instagram music hidden:", pg.evaluate("document.getElementById('post-music').hidden"), "| caption:", repr(pg.input_value("#post-caption"))[:60], "|", pg.inner_text("#post-own-music")[:55])
    pg.fill("#post-caption", "credit removed on purpose"); pg.dispatch_event("#post-caption", "change"); print("  after editing the credit out, it is back:", "from Jamendo)" in pg.input_value("#post-caption"))
    pg.click("#post-go"); print("  posted:", wait(pg, "document.getElementById('post-status').textContent.startsWith('Posted')", 60))
    print("errors:", errs); b.close()
log=json.load(urllib.request.urlopen(f"{_W.URL}/__graph_log")); c=[e for e in log if e["params"].get("media_type")=="REELS"][-1]["params"]
print("sent to Instagram:", repr(c["caption"])[:110], "| audio_configuration:", "audio_configuration" in c)

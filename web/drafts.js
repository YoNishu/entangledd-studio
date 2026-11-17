/* Drafts: everything she makes in Create is kept by itself, and can be opened again and changed at any stage,
   also after a reel was made.
   - While she works, the whole composer (web/app.js snapshot()) is saved on the server a few seconds after a
     change; a background or music file is sent once and then named by its id.
   - When a reel is made, what it was made from goes with it (PUT /api/drafts/keep/<job>), and the server keeps
     it under "Made, not posted" in Posts the moment the reel is ready.
   - Edit (on that list, on the waiting and hand-over cards, and on the finished reel) puts everything back exactly:
     her words and settings at once, the background and the music as they arrive from the server, piece by piece
     (see "brought back to this phone" below). Nothing waits for a file, and a file never lands on other work.
   - Starting something new never loses the earlier piece: what is still waiting to be saved is sent first, and the
     server sets the earlier draft aside. Those are listed in Posts, Drafts ("Not finished yet"), with Continue.
     Hiding or closing the app sends what is waiting to be saved at once.
   - Posts has two parts, Posted and Drafts (everything not yet on Instagram); this file switches between them.
   Server side: server/drafts.js. Starts when the app is open and unlocked ("studio:ready"). */
(() => {
  "use strict";
  const S = window.Studio, K = window.StudioKit;
  const { el, getJson, send, friendly, day, confirmDialog } = K;
  const $ = (id) => document.getElementById(id);
  const SAVE_AFTER_MS = 2500, DAY = 24 * 60 * 60 * 1000;

  // ---------- files: each one sent once ----------
  const sending = new WeakMap();     // File -> promise of its id on the server
  const stored = new WeakMap();      // File -> its id, once it is there
  const listeners = new WeakMap();   // File -> who wants to hear how far the sending is
  const TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/heic": "heic", "image/heif": "heif", "image/webp": "webp", "image/gif": "gif",
    "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a",
    "audio/x-m4a": "m4a", "audio/aac": "aac", "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg", "audio/flac": "flac" };
  const nameFor = (file) => (/\.[a-z0-9]{2,5}$/i.test(file.name || "") ? file.name : `file.${TYPES[file.type] || "bin"}`);
  // The kind of a file by its name's ending (an iPhone plays a video only when its kind is said).
  const KINDS = { ...Object.fromEntries(Object.entries(TYPES).reverse().map(([type, ext]) => [ext, type])), jpeg: "image/jpeg", m4v: "video/mp4" };
  const kindFor = (name) => KINDS[((String(name || "").match(/\.([a-z0-9]{2,5})$/i) || [])[1] || "").toLowerCase()] || "";
  async function upload(file) {
    const tell = (pct) => { const f = listeners.get(file); if (f) f(pct); };
    const start = await send("drafts/files", "POST", { size: file.size, name: nameFor(file) });
    const total = Math.max(1, Math.ceil(file.size / start.partSize)), parts = [];
    for (let i = 0; i < total; i++) {
      const chunk = file.slice(i * start.partSize, (i + 1) * start.partSize);
      parts.push(await getJson(`drafts/files/${start.fileId}/${i + 1}?uploadId=${encodeURIComponent(start.uploadId)}`, { method: "PUT", body: chunk }));
      tell(Math.round(((i + 1) / total) * 100));
    }
    await send(`drafts/files/${start.fileId}/complete`, "POST", { uploadId: start.uploadId, parts });
    stored.set(file, start.fileId);
    return start.fileId;
  }
  function storeFile(file, onProgress) {
    if (!file) return Promise.resolve("");
    if (onProgress) listeners.set(file, onProgress);
    if (!sending.has(file)) {
      const p = upload(file);
      p.catch(() => { if (sending.get(file) === p) sending.delete(file); });     // tried again next time
      sending.set(file, p);
    }
    return sending.get(file);
  }
  const known = (file, id) => { stored.set(file, id); sending.set(file, Promise.resolve(id)); };

  // ---------- the draft: the composer plus where the quote came from and the caption ----------
  let caption = "";
  function complete(snap, files) {
    if (snap.bg) snap.bg.file = (files.bg && stored.get(files.bg)) || "";
    if (snap.music) snap.music.file = (files.music && stored.get(files.music)) || "";
    snap.origin = K.origin();
    snap.caption = caption;
    return snap;
  }
  const quoteOf = (snap) => (snap.blocks || []).map((b) => String(b.text || "").trim()).filter(Boolean).join("\n");
  const firstWords = (snap) => { const t = quoteOf({ blocks: (snap.blocks || []).filter((b) => b.role !== "author") }).replace(/\s+/g, " "); return t.length > 60 ? t.slice(0, 58).trim() + "…" : t; };
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : S.draft().id);

  let ready = false, timer = null, unsaved = false, chain = Promise.resolve();
  function soon() {
    hideCarry();
    unsaved = true;
    clearTimeout(timer);
    timer = setTimeout(save, SAVE_AFTER_MS);
  }
  // What a save would send now, taken at once (before anything else can change the composer); null when nothing.
  function capture() {
    if (!ready || !S.server.on || S.isBlank()) return null;  // a blank composer never overwrites a draft
    const files = S.draftFiles(), d = S.draft();
    // words: false when the words are still a style's sample; what follows keeps the same background and music.
    return { files, body: { id: d.id, of: d.of, words: !S.isBlank(true), snap: stillNamed(complete(S.snapshot(), files)) } };
  }
  // While a draft's background or music is on its way back to this phone (open(), below), the composer has none
  // yet: what is saved meanwhile keeps naming the kept file, so the draft never loses it. Not once she has chosen
  // or removed one herself.
  function stillNamed(snap) {
    for (const k of ["bg", "music"]) if (!snap[k] && coming(k)) snap[k] = pending.snap[k];
    return snap;
  }
  // Saves are sent one after another, each with the composer as it was when it was asked for. A file still on its
  // way does not hold up the saves after it.
  function save() {
    clearTimeout(timer); timer = null; unsaved = false;
    const c = capture();
    if (!c) return chain;
    const waits = [c.files.bg, c.files.music].filter((f) => f && !stored.has(f)).map((f) => storeFile(f));
    const sent = chain.then(() => send("drafts/current", "PUT", c.body)).then((r) => { if (r && r.aside) setAsideNow(); return true; },
      () => { unsaved = true; return false; });                // offline or signed out: the next change tries again
    chain = sent;
    if (waits.length) sent.then((ok) => ok && Promise.allSettled(waits)).then((rs) => { if (rs && rs.some((r) => r.status === "fulfilled")) named(c); });
    return chain;
  }
  // A file that has arrived is named at once: in the next save, or, when she has begun something else meanwhile,
  // in the draft that was set aside (never making it current again).
  function named(c) {
    if (S.draft().id === c.body.id) { clearTimeout(timer); timer = setTimeout(save, 200); return; }
    const snap = c.body.snap;
    if (snap.bg) snap.bg.file = (c.files.bg && stored.get(c.files.bg)) || "";
    if (snap.music) snap.music.file = (c.files.music && stored.get(c.files.music)) || "";
    chain = chain.then(() => send("drafts/current", "PUT", { ...c.body, setAside: true })).catch(() => {});
  }
  // Sends what is still waiting to be saved, at once. Called before a new piece of work begins (app.js newDraft)
  // and before another draft or reel is opened here.
  function flush() { return timer || unsaved ? save() : chain; }
  // Only a style's sample words: the new piece keeps the background and music, so there is nothing to send.
  // A draft still being brought back is saved as it is (its files stay named) and then left: nothing of it may
  // arrive in the new piece. (It did: a quote from Today was overwritten by the draft. Her case, 17 Nov 2026.)
  S.beforeNew = () => { const sent = S.isBlank(true) ? chain : flush(); cancelOpen(); note(""); return sent; };
  // Hiding or closing the app: the request is made so that it is still sent as the page goes.
  function flushOnHide() {
    if (!(timer || unsaved)) return;
    const c = capture();
    clearTimeout(timer); timer = null; unsaved = false;
    if (!c) return;
    const body = JSON.stringify(c.body);
    fetch("/api/drafts/current", { method: "PUT", keepalive: body.length < 60000, body,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + S.server.token } }).catch(() => { unsaved = true; });
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushOnHide(); });
  window.addEventListener("pagehide", flushOnHide);
  document.addEventListener("studio:changed", soon);
  ["post-caption", "handoff-caption"].forEach((id) => $(id).addEventListener("input", () => { caption = $(id).value; soon(); }));

  // ---------- putting a draft or a made reel back ----------
  const slot = $("draft-slot");
  const carry = el("button", { type: "button", className: "draftline", id: "draft-carry", hidden: true });
  const say = el("p", { className: "note", id: "draft-note", role: "status", hidden: true });
  const more = el("button", { type: "button", className: "draftline", id: "drafts-more", hidden: true });
  more.addEventListener("click", () => goToDrafts());
  slot.append(carry, more, say);
  // One quiet line in Create when drafts are set aside: they are in Posts, Drafts.
  function showMore() {
    const n = data && data.drafts ? data.drafts.filter((d) => d.id !== S.draft().id).length : 0;
    more.textContent = n === 1 ? "1 more draft is in Posts" : `${n} more drafts are in Posts`;
    more.hidden = !n;
  }
  // The earlier piece of work was set aside by the server as she began this one.
  function setAsideNow() {
    if (say.hidden || !say.textContent) note("Your earlier reel is kept in Drafts, in Posts.");
    refresh();
  }
  function note(msg) { say.textContent = msg || ""; say.hidden = !msg; }
  function hideCarry() { carry.hidden = true; }
  let offered = null;
  function offer(cur) {
    offered = cur;
    carry.replaceChildren("Carry on where you left off ", el("span", { textContent: `“${firstWords(cur.snap)}”` }));
    carry.hidden = false;
  }
  carry.addEventListener("click", () => { if (offered) open(offered.snap, { draftId: offered.id, of: offered.of }); });

  // ---------- a draft's background and music, brought back to this phone ----------
  // Piece by piece (GET drafts/files/<id>?from=&len=): a dropped connection costs one piece, which is asked for
  // again, and she sees how far it is. A file brought back once is kept for the next time (the last few).
  const PIECE = 2 * 1024 * 1024, PIECE_TRIES = 4, PIECE_WAIT_MS = 60000, KEEP_FILES = 4;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const brought = new Map();          // file id -> File
  async function bring(f, signal, tell) {
    if (brought.has(f.file)) return brought.get(f.file);
    const parts = [];
    let got = 0, total = Infinity;
    while (got < total) {
      let piece = null, last = null;
      for (let t = 0; t < PIECE_TRIES && !piece; t++) {
        if (signal.aborted) throw new Error("left");
        const ctl = new AbortController(), stop = () => ctl.abort(), timer = setTimeout(stop, PIECE_WAIT_MS);
        signal.addEventListener("abort", stop);
        try {
          const res = await S.api(`drafts/files/${f.file}?from=${got}&len=${PIECE}`, { signal: ctl.signal });
          const size = Number(res.headers.get("X-File-Size")), blob = await res.blob();
          if (!(size > 0) || !blob.size) throw new Error("empty");
          total = size; piece = blob;
        } catch (e) {
          if (e.status === 404 || e.status === 401 || signal.aborted) throw e;      // gone, signed out, or left
          last = e;
          await sleep(700 * (t + 1));
        } finally { clearTimeout(timer); signal.removeEventListener("abort", stop); }
      }
      if (!piece) throw last;
      parts.push(piece); got += piece.size;
      tell(Math.min(1, got / total));
    }
    const name = f.name || nameFor({ name: "", type: f.type });
    const file = new File(parts, name, { type: f.type || kindFor(name) });
    known(file, f.file);
    brought.set(f.file, file);
    while (brought.size > KEEP_FILES) brought.delete(brought.keys().next().value);
    return file;
  }

  // The piece being brought back: { id, snap, ticket, bg, music } with bg and music one of
  //   "coming" (being fetched), "failed" (the connection; it can be tried again), or "" (here, gone, or never there).
  let opening = 0, pending = null, leave = null;
  const NAMES = { bg: "background", music: "music" };
  // Is this file of the open piece still to come (and has she left that part of the composer alone)?
  const coming = (k) => !!pending && !!pending[k] && pending.id === S.draft().id && S.asks()[k] === pending.ticket[k];
  function cancelOpen() {
    opening++;
    if (leave) leave.abort();
    leave = null; pending = null;
  }
  const both = (ks) => ks.map((k) => NAMES[k]).join(" and ");
  // What Create says while files come back, and after.
  function tellComing(pct, words) {
    const on = ["bg", "music"].filter((k) => pending && pending[k] === "coming" && coming(k));
    const failed = ["bg", "music"].filter((k) => pending && pending[k] === "failed" && coming(k));
    const gone = pending ? pending.gone : [];
    const lost = gone.length === 2 ? "The background and the music are no longer kept. Choose them again."
      : gone[0] === "bg" ? "The background is no longer kept. Choose it again in Background."
      : gone[0] === "music" ? "The music is no longer kept. Choose it again in Music." : "";
    if (on.length) { note(`Bringing back your ${both(on)}…${pct > 0 ? ` ${Math.round(pct * 100)}%` : ""}`); return; }
    if (failed.length) {
      note(`Your ${both(failed)} didn't come through. Check your connection.`);
      const again = el("button", { type: "button", className: "draftline", id: "draft-again", textContent: "Try again" });
      again.addEventListener("click", () => { if (pending) fetchInto(pending, opening, failed, words); });
      // Never a dead end: she can also go on without, and the draft is saved that way from then on.
      const without = el("button", { type: "button", className: "draftline", id: "draft-without", textContent: failed.length > 1 ? "Carry on without them" : "Carry on without it" });
      without.addEventListener("click", () => { if (!pending) return; for (const k of failed) pending[k] = ""; tellComing(0, words); soon(); });
      say.append(" ", again, " ", without);
      return;
    }
    note([lost, words].filter(Boolean).join(" "));
  }
  // Fetches the named files of the piece p and puts each into the composer as it arrives.
  async function fetchInto(p, mine, kinds, words) {
    const signal = leave.signal, far = {};
    const show = () => { if (mine === opening) tellComing(kinds.reduce((t, k) => t + (far[k] || 0), 0) / kinds.length, words); };
    for (const k of kinds) { p[k] = "coming"; far[k] = 0; }
    show();
    await Promise.all(kinds.map(async (k) => {
      let file = null, why = "";
      try { file = await bring(p.snap[k], signal, (part) => { far[k] = part; show(); }); }
      catch (e) { why = e.status === 404 ? "gone" : "failed"; }
      if (mine !== opening) return;
      far[k] = 1;
      if (!file) {
        if (why === "gone") { p[k] = ""; p.gone.push(k); if (p.id === S.draft().id) soon(); }     // saved without it from now on
        else p[k] = "failed";
        show();
        return;
      }
      if (!coming(k)) { p[k] = ""; show(); return; }            // she chose or removed one herself meanwhile: hers stays
      const failed = await S.attach(p.ticket, p.snap, { [k]: file });
      if (mine !== opening) return;
      p[k] = failed.length ? "failed" : "";
      show();
    }));
  }
  async function open(snap, ids, words) {
    flush();                                       // the piece open now is saved first, and so set aside
    cancelOpen();
    const mine = opening;
    leave = new AbortController();
    hideCarry();
    K.setOrigin(snap.origin);
    caption = snap.caption || "";
    $("post-caption").value = caption;
    // Her words and settings are back at once; the background and the music follow as they arrive.
    const ticket = S.restore(snap, ids);
    const kinds = ["bg", "music"].filter((k) => snap[k] && snap[k].file);
    pending = { id: ticket.id, snap, ticket, bg: "", music: "", gone: ["bg", "music"].filter((k) => snap[k] && !snap[k].file) };
    if (kinds.length) await fetchInto(pending, mine, kinds, words);
    else tellComing(0, words);
  }
  // Asked by the composer before a reel is made: never without a background or music that is still on its way.
  S.filesComing = () => {
    const on = ["bg", "music"].filter((k) => coming(k) && pending[k] === "coming"), failed = ["bg", "music"].filter((k) => coming(k) && pending[k] === "failed");
    return on.length ? `Your ${both(on)} ${on.length > 1 ? "are" : "is"} still coming back. Give it a moment, then create the reel.`
      : failed.length ? `Your ${both(failed)} didn't come through. Tap "Try again" at the top, or choose ${failed.length > 1 ? "them" : "it"} again.` : "";
  };

  // Edit on a made reel: everything as it was, on the Text tab. If her draft already goes on from this reel, that is
  // what opens (it is newer). Making it again replaces it in Posts, unless it is waiting elsewhere or was posted.
  async function edit(m) {
    const cur = data && data.current;
    const goesOn = cur && cur.of === m.id && cur.updated > m.made;
    K.show("create");
    S.openOn("text");
    const words = m.where === "posted" ? "This makes a new reel. The posted one stays as it is."
      : m.where === "queue" ? "Creating it again makes a new reel. The one waiting to be posted stays as it is."
      : m.where === "handoff" ? "Creating it again makes a new reel. The one handed to Instagram stays as it is."
      : "Creating it again replaces the one in Posts.";
    await open(goesOn ? cur.snap : JSON.parse(JSON.stringify(m.snap)), { draftId: goesOn ? cur.id : newId(), of: m.id }, words);
  }

  // Called by the composer once a reel's files are sent and before it is started.
  async function keepJob(jobId, snap, files, made) {
    complete(snap, files);
    const d = S.draft(), origin = K.origin();
    const r = await send("drafts/keep/" + jobId, "PUT", { draftId: d.id, of: d.of, snap, about: { quote: quoteOf(snap), ...origin, made } });
    S.setDraft({ of: r.entryId });
    note(r.newVersion ? (r.wasWhere === "posted" ? "This is a new reel. The posted one stays as it is." : "This is a new reel. The earlier one stays as it is.") : "");
    data = null;
    S.thumbBlob().then((b) => S.api("drafts/thumb/" + jobId, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: b })).catch(() => {});
  }
  S.storeFile = storeFile;
  S.keepJob = keepJob;

  // ---------- Posts: Made, not posted; Edit on the other cards ----------
  let data = null, asking = null;
  function fetchData() {
    asking = getJson("drafts").then((r) => (data = r), () => null);
    return asking;
  }
  const byJob = (jobId) => data && data.made.find((m) => m.jobId === jobId);
  // What the post and hand-over sheets need to know about a reel kept here (the same as for one waiting to post).
  const waitingOf = (m) => ({ jobId: m.jobId, ...(m.about || {}), quote: (m.about && m.about.quote) || quoteOf(m.snap), made: (m.about && m.about.made) || null });

  const thumbs = new Map();          // job id -> promise of an address for its small picture
  function thumbOf(jobId) {
    if (!thumbs.has(jobId)) thumbs.set(jobId, S.api("drafts/thumb/" + jobId).then((r) => r.blob()).then((b) => URL.createObjectURL(b)).catch(() => ""));
    return thumbs.get(jobId);
  }
  function madeCard(m) {
    const img = el("img", { className: "made-thumb", alt: "" });
    thumbOf(m.jobId).then((src) => { if (src) img.src = src; else img.hidden = true; });
    const left = m.keptUntil - Date.now();
    const when = `Made ${day(m.made)}.${left <= 7 * DAY ? ` Kept until ${day(m.keptUntil)}.` : ""}`;
    const post = el("button", { type: "button", className: "btn soft ic ic-send", textContent: "Post", hidden: !S.server.instagram });
    post.addEventListener("click", async () => {
      await K.openPost("reel", waitingOf(m));
      if (!$("post-caption").value && m.snap.caption) $("post-caption").value = m.snap.caption;
    });
    const change = el("button", { type: "button", className: "btn ic ic-create", textContent: "Edit" });
    change.addEventListener("click", () => edit(m));
    const share = el("button", { type: "button", className: "btn ic ic-insta", textContent: "Share" });
    share.setAttribute("aria-label", "Share to Instagram");
    share.addEventListener("click", () => K.openHandoff(waitingOf(m)));
    const drop = el("button", { type: "button", className: "last", textContent: "Delete" });
    drop.addEventListener("click", async () => {
      if (!(await confirmDialog({ title: "Delete this reel?", body: "It goes from the app for good. Anything already on Instagram stays.", yes: "Delete" }))) return;
      try { data = await send("drafts/made/" + m.id, "DELETE"); render(); } catch (e) { $("made-note").textContent = friendly(e); }
    });
    return el("article", { className: "card made", id: "made-" + m.id },
      el("div", { className: "made-top" }, img, el("div", {}, el("p", { className: "q", textContent: firstWords(m.snap) || "A reel" }), el("p", { className: "src", textContent: when }))),
      el("div", { className: "acts" }, post, change, share), el("div", { className: "links" }, drop));
  }
  // A draft set aside: its first words, when it was last changed, what is already chosen; Continue and Delete.
  function savedCard(d) {
    const chosen = [d.snap.bg && (d.snap.bg.kind === "video" ? "Video background" : "Photo background"),
      d.snap.music && (d.snap.music.title ? `Music: ${d.snap.music.title}` : "Music")].filter(Boolean).join(" · ");
    // The one open in Create right now is listed too (it is saved all the same): Continue only goes back to it.
    const openNow = d.id === S.draft().id, isCurrent = !!(data.current && data.current.id === d.id);
    const go = el("button", { type: "button", className: "btn soft ic ic-create", textContent: "Continue" });
    go.addEventListener("click", () => {
      K.show("create");
      S.openOn("text");
      if (!openNow) open(JSON.parse(JSON.stringify(d.snap)), { draftId: d.id, of: d.of });
    });
    const drop = el("button", { type: "button", className: "last", textContent: "Delete", hidden: openNow });
    drop.addEventListener("click", async () => {
      if (!(await confirmDialog({ title: "Delete this draft?", body: "It goes from the app for good.", yes: "Delete" }))) return;
      try {
        if (isCurrent) { await send("drafts/current", "DELETE"); await refresh(); }
        else { data = await send("drafts/saved/" + d.id, "DELETE"); render(); }
      } catch (e) { $("saved-note").textContent = friendly(e); }
    });
    return el("article", { className: "card made" + (openNow ? " open-now" : ""), id: "saved-" + d.id },
      el("p", { className: "q", textContent: firstWords(d.snap) || "A reel" }),
      el("p", { className: "src", textContent: openNow ? "Open in Create now." : `Changed ${day(d.updated)}.` }),
      chosen ? el("p", { className: "src", textContent: chosen }) : null,
      el("div", { className: "acts" }, go), el("div", { className: "links" }, drop));
  }
  function render() {
    if (!data) return;
    const cur = data.current && data.current.words !== false && firstWords(data.current.snap) ? data.current : null;
    const saved = (cur ? [cur] : []).concat((data.drafts || []).filter((d) => !cur || d.id !== cur.id));
    $("saved-wrap").hidden = !saved.length;
    $("list-saved").replaceChildren(...saved.map(savedCard));
    $("saved-note").textContent = `Up to ${data.limits.drafts} are kept, each for ${data.limits.draftDays} days after you last changed it.`;
    const list = data.made.filter((m) => m.where === "made");
    $("made-wrap").hidden = !list.length;
    $("list-made").replaceChildren(...list.map(madeCard));
    $("made-note").textContent = `Up to ${data.limits.made} are kept, each for ${data.limits.madeDays} days. Edit one to change it.`;
    showMore();
    recount();
  }
  async function refresh() { await fetchData(); render(); }

  // ---------- "Save as draft", at the end of Create: saved this moment, and shown where it is kept ----------
  const keepBtn = $("save-draft"), keepNote = $("save-draft-note");
  keepBtn.addEventListener("click", async () => {
    const tell = (msg, link) => {
      keepNote.replaceChildren(msg);
      if (link) { const b = el("button", { type: "button", className: "draftline", textContent: "See your drafts" }); b.addEventListener("click", () => goToDrafts()); keepNote.append(" ", b); }
      keepNote.hidden = false;
    };
    if (S.isBlank()) return tell("Add your words or a background first, then save.");
    if (!S.server.on) return tell("Sign in to keep drafts.");
    keepBtn.disabled = true;
    tell("Saving…");
    try {
      const c = capture();
      const waits = c ? [c.files.bg, c.files.music].filter((f) => f && !stored.has(f)).map((f) => storeFile(f)) : [];
      const ok = await save();
      if (!ok) throw new Error("not saved");
      if (waits.length) { tell("Saving your background and music…"); await Promise.allSettled(waits); await save(); }
      await refresh();
      tell("Saved in Drafts, in Posts. You can close the app and carry on later.", true);
    } catch (e) { tell("That didn't save. Check your connection and try again."); }
    keepBtn.disabled = false;
  });
  document.addEventListener("studio:changed", () => { keepNote.hidden = true; });

  // ---------- Posts in two parts: Posted, and Drafts (everything not yet on Instagram) ----------
  const PART_KEY = "studio.postsPart.v1";
  const parts = { posted: $("posts-part-posted"), drafts: $("posts-part-drafts") };
  let chose = false, sent = false;           // she tapped a part since Posts opened; Create sent her to Drafts
  function showPart(name) {
    for (const [k, b] of Object.entries(parts)) b.setAttribute("aria-pressed", String(k === name));
    $("posts-drafts").hidden = name !== "drafts";
    $("posts-posted").hidden = name !== "posted";
  }
  for (const [k, b] of Object.entries(parts)) b.addEventListener("click", () => {
    chose = true; showPart(k);
    try { localStorage.setItem(PART_KEY, k); } catch (e) { /* not remembered on this phone */ }
  });
  // How many things are not yet on Instagram (the cards in Drafts); the posted heading is not needed with the parts.
  function recount() {
    const n = ["list-saved", "list-made", "list-queue", "list-handoffs"].reduce((t, id) => t + ($(id).closest(".group").hidden ? 0 : $(id).children.length), 0);
    $("drafts-count").textContent = n ? String(n) : "";
    $("drafts-count").hidden = !n;
    $("drafts-empty").hidden = !!n;
    $("posted-head").hidden = true;
    // A reel waiting for her tap opens Drafts, unless she has chosen a part herself.
    if (!chose && !$("view-posts").hidden && !$("queue-wrap").hidden) showPart("drafts");
  }
  function goToDrafts() { sent = true; K.show("posts"); }
  document.addEventListener("studio:view", (e) => {
    if (e.detail === "create") showMore();
    if (e.detail !== "posts") return;
    chose = false;
    let last = "";
    try { last = localStorage.getItem(PART_KEY) || ""; } catch (err) { /* nothing remembered */ }
    showPart(sent || !$("queue-wrap").hidden ? "drafts" : last === "drafts" ? "drafts" : "posted");
    sent = false;
  });

  // Edit on a card that studio.js draws (waiting to be posted, being finished in Instagram): shown once this reel
  // is known to have been kept here.
  function editButton(jobId) {
    const b = el("button", { type: "button", className: "btn ic ic-create", textContent: "Edit", hidden: true });
    b.addEventListener("click", () => { const m = byJob(jobId); if (m) edit(m); });
    (asking || fetchData()).then(() => { b.hidden = !byJob(jobId); });
    return b;
  }
  // "Make a version of this" on a posted reel, for as long as what it was made from is kept.
  function versionButton(postId) {
    const b = el("button", { type: "button", className: "ic ic-create", textContent: "Make a version of this", hidden: true });
    const find = () => data && data.made.find((m) => m.postId === postId && m.keptUntil > Date.now());
    b.addEventListener("click", () => { const m = find(); if (m) edit(m); });
    (asking || fetchData()).then(() => { b.hidden = !find(); });
    return b;
  }
  window.StudioDrafts = { refresh, editButton, versionButton, recount };

  // ---------- on opening: finish bringing back this phone's draft, or offer the one saved on another ----------
  document.addEventListener("studio:ready", async () => {
    if (ready) return;
    ready = true;
    const got = await fetchData(), cur = got && got.current, mine = S.draft();
    showMore();
    if (!cur) return;
    if (cur.id === mine.id) {
      // The same piece of work: the server has the files; the newer of the two has the words and settings.
      // Fetched only once she is in Create, so opening the app for Today never downloads a video.
      const back = () => {
        if (opening || S.draft().id !== cur.id) return;          // she has opened something else meanwhile
        if (mine.updated > cur.updated) open({ ...complete(S.snapshot(), S.draftFiles()), bg: cur.snap.bg, music: cur.snap.music, origin: cur.snap.origin, caption: cur.snap.caption }, { draftId: cur.id, of: mine.of });
        else open(cur.snap, { draftId: cur.id, of: cur.of });
      };
      if (!$("view-create").hidden) back();
      else document.addEventListener("studio:view", function when(e) {
        if (e.detail !== "create") return;
        document.removeEventListener("studio:view", when);
        setTimeout(back, 0);                                    // after an Edit that brought her here has begun
      });
    } else if (S.isBlank() || cur.updated > mine.updated) offer(cur);
  });
})();

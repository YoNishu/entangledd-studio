/* Drafts: everything she makes in Create is kept by itself, and can be opened again and changed at any stage,
   also after a reel was made.
   - While she works, the whole composer (web/app.js snapshot()) is saved on the server a few seconds after a
     change; a background or music file is sent once and then named by its id.
   - When a reel is made, what it was made from goes with it (PUT /api/drafts/keep/<job>), and the server keeps
     it under "Made, not posted" in Posts the moment the reel is ready.
   - Edit (on that list, on the waiting and hand-over cards, and on the finished reel) puts everything back exactly.
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

  let ready = false, timer = null, saving = false, again = false;
  function soon() {
    hideCarry();
    clearTimeout(timer);
    timer = setTimeout(save, SAVE_AFTER_MS);
  }
  async function save() {
    if (!ready || !S.server.on || S.isBlank()) return;      // a blank composer never overwrites a draft
    if (saving) { again = true; return; }
    saving = true;
    let sent = false;
    try {
      const files = S.draftFiles(), d = S.draft();
      const waits = [files.bg, files.music].filter((f) => f && !stored.has(f)).map((f) => storeFile(f));
      await send("drafts/current", "PUT", { id: d.id, of: d.of, snap: complete(S.snapshot(), files) });
      // A file still on its way is named in the next save, as soon as it is there.
      if (waits.length) sent = (await Promise.allSettled(waits)).some((r) => r.status === "fulfilled");
    } catch (e) { /* offline or signed out: the next change tries again */ }
    finally {
      saving = false;
      if (again || sent) { again = false; timer = setTimeout(save, 200); }
    }
  }
  document.addEventListener("studio:changed", soon);
  ["post-caption", "handoff-caption"].forEach((id) => $(id).addEventListener("input", () => { caption = $(id).value; soon(); }));

  // ---------- putting a draft or a made reel back ----------
  const slot = $("draft-slot");
  const carry = el("button", { type: "button", className: "draftline", id: "draft-carry", hidden: true });
  const say = el("p", { className: "note", id: "draft-note", role: "status", hidden: true });
  slot.append(carry, say);
  function note(msg) { say.textContent = msg || ""; say.hidden = !msg; }
  function hideCarry() { carry.hidden = true; }
  let offered = null;
  function offer(cur) {
    offered = cur;
    carry.replaceChildren("Carry on where you left off ", el("span", { textContent: `“${firstWords(cur.snap)}”` }));
    carry.hidden = false;
  }
  carry.addEventListener("click", () => { if (offered) open(offered.snap, { draftId: offered.id, of: offered.of }); });

  async function fetchFile(f) {
    if (!f || !f.file) return null;
    try {
      const blob = await (await S.api("drafts/files/" + f.file)).blob();
      const file = new File([blob], f.name || nameFor({ name: "", type: f.type }), { type: f.type || blob.type });
      known(file, f.file);
      return file;
    } catch (e) { return null; }
  }
  let opening = 0;
  async function open(snap, ids, words) {
    const mine = ++opening;
    hideCarry();
    note(snap.bg || snap.music ? "Bringing back your background and music…" : "");
    const [bg, music] = await Promise.all([fetchFile(snap.bg), fetchFile(snap.music)]);
    if (mine !== opening) return;
    K.setOrigin(snap.origin);
    caption = snap.caption || "";
    $("post-caption").value = caption;
    const missing = await S.restore(snap, { bg, music }, ids);
    const lost = missing.length === 2 ? "The background and the music are no longer kept. Choose them again."
      : missing[0] === "background" ? "The background is no longer kept. Choose it again in Background."
      : missing[0] === "music" ? "The music is no longer kept. Choose it again in Music." : "";
    note([lost, words].filter(Boolean).join(" "));
  }

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
  function render() {
    if (!data) return;
    const list = data.made.filter((m) => m.where === "made");
    $("made-wrap").hidden = !list.length;
    $("list-made").replaceChildren(...list.map(madeCard));
    $("made-note").textContent = `Up to ${data.limits.made} are kept, each for ${data.limits.madeDays} days. Edit one to change it.`;
    $("posted-head").hidden = $("made-wrap").hidden && $("queue-wrap").hidden && $("handoff-wrap").hidden;
  }
  async function refresh() { await fetchData(); render(); }

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
  window.StudioDrafts = { refresh, editButton, versionButton };

  // ---------- on opening: finish bringing back this phone's draft, or offer the one saved on another ----------
  document.addEventListener("studio:ready", async () => {
    if (ready) return;
    ready = true;
    const got = await fetchData(), cur = got && got.current, mine = S.draft();
    if (!cur) return;
    if (cur.id === mine.id) {
      // The same piece of work: the server has the files; the newer of the two has the words and settings.
      if (mine.updated > cur.updated) open({ ...complete(S.snapshot(), S.draftFiles()), bg: cur.snap.bg, music: cur.snap.music, origin: cur.snap.origin, caption: cur.snap.caption }, { draftId: cur.id, of: mine.of });
      else open(cur.snap, { draftId: cur.id, of: cur.of });
    } else if (S.isBlank() || cur.updated > mine.updated) offer(cur);
  });
})();

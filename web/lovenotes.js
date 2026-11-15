/* D's Studio: a little note from Nishiii.
   Starts when the app is open and unlocked ("studio:ready"). Shared helpers: window.StudioKit and window.Studio.
   Other signals: "studio:view" (detail = the section now showing) and "studio:settings" (Settings just opened).

   Each time she opens the app, the line under the heading on Today (#hello) becomes one note in
   Nishiii's hand. It stays the same for the whole visit. "Opening" means loading the app, or
   coming back to it after half an hour or more away (a home-screen app is often kept alive in the
   background, so loading alone could show the same note for days).

   Nothing moves when the note arrives: the server names the note for the next opening one visit
   ahead, this file measures how tall it will stand, and only that number is kept on the phone
   (never the words). On the next opening the space is already waiting. */
(() => {
  "use strict";
  const K = window.StudioKit, S = window.Studio;
  const hello = document.getElementById("hello");
  if (!K || !S || !hello) return;
  const { el } = K;

  // ---------- the note under the heading ----------
  const FACE = '400 18px "Nothing You Could Do"';
  const AWAY_MS = 30 * 60 * 1000;
  const KEEP = "studio.lovenote";          // { w, h, days }: heights in px at this screen width. Numbers only.
  const BANDS = ["len-s", "len-m", "len-l", "len-xl"];
  const band = (text) => { const n = [...text].length; return n <= 60 ? "len-s" : n <= 130 ? "len-m" : n <= 200 ? "len-l" : "len-xl"; };
  const greeting = [...hello.childNodes].map((n) => n.cloneNode(true));   // what the line says when there are no notes
  const signature = hello.querySelector(".sig");

  let shown = null;      // the note for this visit: { id, text, marker, then, soon }
  let ahead = null;      // space measured for the next opening: { w, h, days: { "YYYY-MM-DD": h } }
  let due = true;        // has this opening still to get its note?
  let busy = false;
  let unpainted = null;  // a note that arrived while another section was showing: { fresh }

  const pad = (n) => String(n).padStart(2, "0");
  const phoneDay = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const visible = () => hello.getClientRects().length > 0;
  const boxHeight = () => hello.getBoundingClientRect().height;

  const kept = {
    read() {
      try { const k = JSON.parse(localStorage.getItem(KEEP) || "null"); return k && k.w === window.innerWidth ? k : null; }
      catch (e) { return null; }
    },
    write(k) { try { localStorage.setItem(KEEP, JSON.stringify(k)); } catch (e) { /* no storage: the space just isn't kept ahead */ } },
    clear() { try { localStorage.removeItem(KEEP); } catch (e) { /* nothing to clear */ } },
  };
  const spaceFor = (k, day) => (k ? (k.days && k.days[day]) || k.h || 0 : 0);

  const fontReady = () => Promise.race([
    document.fonts && document.fonts.load ? document.fonts.load(FACE).catch(() => {}) : Promise.resolve(),
    new Promise((done) => setTimeout(done, 1500)),      // a slow font never holds the note back for long
  ]);

  // Keeps the note's space, empty, until its words are ready.
  function hold(height) {
    hello.replaceChildren();
    hello.classList.remove("lovenote-in", ...BANDS);
    hello.classList.add("lovenote", "lovenote-wait");
    hello.style.minHeight = height + "px";
  }
  // Back to the ordinary greeting.
  function greet() {
    hello.classList.remove("lovenote", "lovenote-wait", "lovenote-in", ...BANDS);
    hello.style.minHeight = "";
    hello.replaceChildren(...greeting.map((n) => n.cloneNode(true)));
  }
  function write(note) {
    hello.classList.remove(...BANDS);
    hello.classList.add(band(note.text));
    hello.replaceChildren(...[
      note.marker ? el("span", { className: "lovenote-mark", id: "love-note-mark", textContent: note.marker }) : null,
      el("span", { className: "lovenote-text", id: "love-note", textContent: note.text }),
      signature ? signature.cloneNode(true) : el("span", { className: "sig", textContent: "Nishiii" }),
    ].filter(Boolean));
  }

  // Puts this visit's note on the line. Before that, out of sight and in the same breath, it tries
  // the notes that could come next in the line's own place to learn how tall each will stand.
  function paint(fresh) {
    if (!shown) return;
    if (!visible()) { unpainted = { fresh: fresh || !!(unpainted && unpainted.fresh) }; return; }   // done when Today shows
    unpainted = null;
    hello.classList.remove("lovenote-wait", "lovenote-in");
    hello.classList.add("lovenote");
    hello.style.minHeight = "";
    ahead = { w: window.innerWidth, h: 0, days: {} };
    if (shown.then) { write({ text: shown.then, marker: "" }); ahead.h = boxHeight(); }
    for (const s of shown.soon || []) { write(s); ahead.days[s.day] = boxHeight(); }
    if (ahead.h) kept.write(ahead); else kept.clear();
    write(shown);
    hello.style.minHeight = boxHeight() + "px";
    if (fresh) { void hello.offsetWidth; hello.classList.add("lovenote-in"); }
  }

  async function openNote() {
    if (busy) return;
    busy = true; due = false;
    try {
      const note = await K.getJson("lovenotes/next?today=" + phoneDay());
      await fontReady();
      if (!note || !note.text) { shown = null; ahead = null; unpainted = null; kept.clear(); greet(); return; }
      shown = note;
      paint(true);
    } catch (e) {
      due = true;                                   // tried again at the next unlock or return
      if (shown) paint(false); else greet();
    } finally { busy = false; }
  }

  // The space is kept from the first moment, before anything is asked of the server.
  const before = kept.read();
  if (spaceFor(before, phoneDay()) > 0) hold(spaceFor(before, phoneDay()));
  fontReady();

  document.addEventListener("studio:ready", () => { if (due) openNote(); });
  document.addEventListener("studio:view", (e) => { if (e.detail === "today" && unpainted) paint(unpainted.fresh); });

  // Back after a good while: that is a new opening, so a new note.
  let awayAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { awayAt = Date.now(); return; }
    if (!awayAt || Date.now() - awayAt < AWAY_MS || due) return;
    due = true;
    const space = shown ? spaceFor(ahead, phoneDay()) : 0;
    if (space > 0) hold(space);
    if (!S.server.locked) openNote();              // if the lock came down, the note waits for the unlock
  });

  // The screen was turned or resized: the note's lines fall differently, so set it again.
  let lastWidth = window.innerWidth, resizing = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizing);
    resizing = setTimeout(() => {
      if (window.innerWidth === lastWidth) return;
      lastWidth = window.innerWidth;
      if (shown && !hello.classList.contains("lovenote-wait")) paint(false);
    }, 150);
  });

  // ---------- the small editor in Settings ----------
  const slot = document.getElementById("settings-lovenotes");
  const $ = (id) => document.getElementById(id);
  const longDay = (date) => new Date(date + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
  let editing = "";       // id of the note in the form, or "" when adding

  function say(message, bad) {
    $("lovenotes-status").textContent = message;
    $("lovenotes-status").className = bad ? "oops" : "note";
  }
  function fillForm(note) {
    editing = note ? note.id : "";
    $("lovenotes-text").value = note ? note.text : "";
    $("lovenotes-date").value = note ? note.date : "";
    $("lovenotes-save").textContent = note ? "Save note" : "Add note";
    $("lovenotes-cancel").hidden = !note;
  }
  function deliveryLine(results) {
    const last = results[results.length - 1];
    if (!last) return "";
    if (!last.ok) return last.why;
    const when = K.day(last.at);
    return last.added
      ? `${last.added} ${last.added === 1 ? "note" : "notes"} from Nishiii arrived on ${when}.`
      : `A delivery arrived on ${when} with nothing new in it.`;
  }
  function list(data) {
    $("lovenotes-list").replaceChildren(...data.notes.map((n) => el("li", { id: "lovenote-" + n.id },
      el("div", {},
        el("p", { className: "main", textContent: n.text }),
        n.date ? el("p", { className: "sub", textContent: longDay(n.date) }) : null),
      el("div", { className: "lovenotes-acts" },
        el("button", { type: "button", textContent: "Edit", onclick: () => { fillForm(n); $("lovenotes-text").focus(); } }),
        el("button", { type: "button", textContent: "Remove", onclick: () => remove(n) })))));
    $("lovenotes-none").hidden = data.notes.length > 0;
    const line = deliveryLine(data.deliveries || []);
    $("lovenotes-delivery").textContent = line;
    $("lovenotes-delivery").hidden = !line;
    $("lovenotes-text").maxLength = data.maxLength;
  }
  async function refresh() {
    try { list(await K.getJson("lovenotes")); say("One of these greets you on Today each time you open the app."); }
    catch (e) { say(K.friendly(e), true); }
  }
  async function remove(note) {
    const yes = await K.confirmDialog({ title: "Remove this note?", body: note.text, yes: "Remove" });
    if (!yes) return;
    try {
      list(await K.send("lovenotes/" + note.id, "DELETE"));
      if (editing === note.id) fillForm(null);
      say("Removed.");
    } catch (e) { say(K.friendly(e), true); }
  }
  async function saveNote(e) {
    e.preventDefault();
    const data = { text: $("lovenotes-text").value, date: $("lovenotes-date").value };
    $("lovenotes-save").disabled = true;
    try {
      const out = editing ? await K.send("lovenotes/" + editing, "PUT", data) : await K.send("lovenotes", "POST", data);
      list(out);
      say(editing ? "Saved." : "Added.");
      if (shown && shown.id === out.note.id) { shown.text = out.note.text; paint(false); }   // the note on screen was the one corrected
      fillForm(null);
      if (!shown && !busy) { due = true; openNote(); }                                       // the very first note shows straight away
    } catch (err) { say(K.friendly(err), true); }
    finally { $("lovenotes-save").disabled = false; }
  }

  // The notes are a surprise: she meets them one at a time, so Settings never lists them. Nishith edits them by
  // opening the app's address with #notes at the end (in a browser, not from the Home Screen icon).
  const mayEdit = () => location.hash === "#notes";
  function build() {
    if (!slot || $("lovenotes-edit") || !mayEdit()) return;
    const text = el("textarea", { id: "lovenotes-text", rows: 3, required: true, maxLength: 280 });
    const date = el("input", { id: "lovenotes-date", type: "date" });
    const form = el("form", { className: "add", id: "lovenotes-form" },
      el("label", { className: "stack" }, el("span", { textContent: "Note" }), text),
      el("label", { className: "stack" }, el("span", { textContent: "The day it is about, if it has one" }), date),
      el("button", { className: "btn primary", type: "submit", id: "lovenotes-save", textContent: "Add note" }),
      el("button", { className: "btn quiet", type: "button", id: "lovenotes-cancel", textContent: "Cancel", hidden: true }));
    const box = el("details", { className: "lovenotes-edit", id: "lovenotes-edit" },
      el("summary", { id: "lovenotes-summary", textContent: "Little notes from Nishiii" }),
      el("p", { className: "note", id: "lovenotes-status" }),
      el("p", { className: "note", id: "lovenotes-delivery", hidden: true }),
      el("ul", { className: "list", id: "lovenotes-list" }),
      el("p", { className: "note", id: "lovenotes-none", textContent: "No notes yet. Add the first one below.", hidden: true }),
      form);
    box.querySelector("#lovenotes-status").setAttribute("role", "status");
    slot.replaceChildren(box);
    form.addEventListener("submit", saveNote);
    $("lovenotes-cancel").addEventListener("click", () => fillForm(null));
    box.addEventListener("toggle", () => { if (box.open) refresh(); });      // the notes are fetched only when someone opens this
  }
  // Every time Settings opens, the notes are folded away again, so nobody comes upon all of them by accident.
  document.addEventListener("studio:settings", () => {
    build();
    if (!$("lovenotes-edit")) return;
    $("lovenotes-edit").open = false;
    $("lovenotes-list").replaceChildren();
    fillForm(null);
  });
})();

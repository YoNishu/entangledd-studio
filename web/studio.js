/* Entangledd Studio: everything around the composer.
   Today's quotes, the Library, rewording with Nishiii, free footage, posting, post history and
   Nishiii's picture of her taste. The composer itself lives in app.js and exposes what this file
   needs as window.Studio. */
(() => {
  "use strict";
  const S = window.Studio;
  const $ = (id) => document.getElementById(id);
  // On an iPhone a button only shows its pressed look while some touch listener exists, so here is one.
  document.addEventListener("touchstart", () => {}, { passive: true });
  const el = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...kids.filter((k) => k != null));
    return n;
  };
  const getJson = async (path, opts) => (await S.api(path, opts)).json();
  const send = (path, method, data) => getJson(path, {
    method, headers: { "Content-Type": "application/json" }, body: data ? JSON.stringify(data) : undefined,
  });
  const friendly = (e) => (e.message === "Failed to fetch" ? "You seem to be offline. Check your internet and try again." : e.message);
  const day = (ms) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const compact = (n) => new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n || 0);

  // A small coloured label for the state of something. The words carry the meaning; the colour helps at a glance.
  //   ok = done and live, wait = started but unfinished, info = in progress, gone = no longer there, bad = needs attention
  const chip = (kind, text) => el("p", { className: "chip " + kind, textContent: text });

  // A proper yes/no pop-up for things that can't be undone. Resolves true only if she confirms.
  function confirmDialog({ title, body, yes }) {
    return new Promise((resolve) => {
      $("confirm-title").textContent = title;
      $("confirm-body").textContent = body;
      $("confirm-yes").textContent = yes;
      $("confirm").hidden = false;
      $("confirm-no").focus();
      const done = (answer) => {
        $("confirm").hidden = true;
        $("confirm-yes").removeEventListener("click", onYes);
        $("confirm-no").removeEventListener("click", onNo);
        $("confirm").removeEventListener("click", onBackdrop);
        document.removeEventListener("keydown", onKey);
        resolve(answer);
      };
      const onYes = () => done(true), onNo = () => done(false);
      const onBackdrop = (e) => { if (e.target === $("confirm")) done(false); };
      const onKey = (e) => { if (e.key === "Escape") done(false); };
      $("confirm-yes").addEventListener("click", onYes);
      $("confirm-no").addEventListener("click", onNo);
      $("confirm").addEventListener("click", onBackdrop);
      document.addEventListener("keydown", onKey);
    });
  }

  // Shrinks a photo on the phone before it is sent to be read.
  function shrink(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1568 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = el("canvas", { width: Math.round(img.naturalWidth * k), height: Math.round(img.naturalHeight * k) });
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", 0.82).split(",")[1]);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That picture couldn't be opened.")); };
      img.src = url;
    });
  }

  // What the Insights file (insights.js) borrows from here.
  window.StudioKit = { el, getJson, send, friendly, compact, day, chip, confirmDialog };

  // ---------- moving between the six sections ----------
  const VIEWS = ["today", "create", "library", "posts", "insights", "nishiii"];
  let current = "create";
  function show(view) {
    current = view;
    for (const v of VIEWS) {
      $("view-" + v).hidden = v !== view;
      $("nav-" + v).setAttribute("aria-pressed", String(v === view));
    }
    $("hello").hidden = view !== "today";
    if (view === "today") loadToday();
    if (view === "library") loadLibrary();
    if (view === "posts") loadPosts();
    if (view === "insights") window.Insights.load();
    if (view === "nishiii") loadTaste();
    document.dispatchEvent(new CustomEvent("studio:view", { detail: view }));
  }
  VIEWS.forEach((v) => $("nav-" + v).addEventListener("click", () => show(v)));

  // ---------- Today ----------
  let todayLoaded = false, todayBusy = false, todayData = null;
  let onCanvas = { author: "", theme: "", tone: "", source: "", suggestionId: "" };   // where the quote now on the canvas came from
  const sourceLine = (s) => {
    if (s.type === "own") return s.title ? `Your own collection: ${s.title}` : "Your own collection";
    if (s.type === "book") return s.elsewhere ? `From the book ${s.title}` : `From your book list: ${s.title}`;   // elsewhere: found on the web, not one of hers
    if (s.type === "film") return `From the film ${s.title}`;
    if (s.type === "series") return `From the series ${s.title}`;
    return s.title ? `Well-known line, from ${s.title}` : "Well-known line";
  };

  // Where Nishiii found a line, as a link to that page (only for quotes looked up on Wikiquote, a quote site or the web).
  function foundLink(source) {
    let u;
    try { u = new URL(source && source.url); } catch (e) { return null; }
    if (u.protocol !== "https:") return null;
    return el("a", { className: "src found", href: u.href, target: "_blank", rel: "noopener noreferrer",
      textContent: "Found on " + (source.site || u.hostname.replace(/^www\./, "")) });
  }

  // The pages a check of "who said this" rests on (server/verify.js), or a plain word that it is from memory.
  function checkedOn(r) {
    const links = (r.sources || []).map(foundLink).filter(Boolean);
    if (r.basis === "web" && links.length) return links;
    return [el("p", { className: "note check-memory", textContent: "Nothing about this line was found on the web, so this is from Nishiii's memory. Look it up before posting if it matters." })];
  }
  // "Check it" on a quote marked to be checked: looks the line up and shows the answer in the card.
  function checkButton(item) {
    const btn = el("button", { className: "btn quiet", type: "button", id: "verify-" + item.id, textContent: "Check it" });
    btn.addEventListener("click", async () => {
      btn.disabled = true; btn.textContent = "Checking…";
      try {
        const r = await send("check", "POST", { text: item.text, author: item.author || "" });
        const words = { matches: ["ok", "The author and the wording look right"], different_author: ["bad", item.author ? `Probably not by ${item.author}` : "The author looks wrong"],
          altered_wording: ["wait", "The wording differs from the original"], found: ["info", r.author ? `Probably by ${r.author}` : "No confirmed author"], unsure: ["gone", "Not settled either way"] };
        const [kind, text] = words[r.verdict] || words.unsure;
        const out = el("div", { className: "verified", id: "verified-" + item.id }, chip(kind, text),
          r.verdict === "different_author" && r.author && r.author.toLowerCase() !== "unknown" ? el("p", { className: "src", textContent: `Credit ${r.author} instead.` }) : null,
          r.note ? el("p", { textContent: r.note }) : null, ...checkedOn(r));
        btn.replaceWith(out);
      } catch (e) {
        btn.disabled = false; btn.textContent = "Check it";
        if (!btn.nextElementSibling || !btn.nextElementSibling.classList.contains("flag")) btn.after(el("p", { className: "flag", textContent: friendly(e) }));
      }
    });
    return btn;
  }

  // What actually happened to a suggestion, so "used" is never mistaken for "posted".
  function fateLine(item) {
    if (item.posted === "posted") return chip("ok", "Posted to Instagram");
    if (item.posted === "deleted") return chip("gone", "Posted earlier, then deleted. Free to use again");
    if (item.state === "used") return chip("wait", "Opened in Create, not posted");
    return null;
  }

  // base is "suggestions" (Today's five) or "asked" (quotes she found with "Find quotes" in the Library).
  // date is set for a quote from an earlier day, so the server knows which day's list it belongs to.
  function card(item, base = "suggestions", date = "") {
    const use = el("button", { className: "btn soft ic ic-create", textContent: base === "asked" ? "Create with this" : "Use this" });
    const reword = el("button", { className: "btn ic ic-sparkle", textContent: "Reword" });
    const skip = el("button", { className: "btn quiet", textContent: "Skip" });
    const node = el("article", { className: "card" },
      el("p", { className: "q", textContent: item.text }),
      item.author ? el("p", { className: "by", textContent: "— " + item.author }) : null,
      el("p", { className: "src", textContent: sourceLine(item.source) }),
      foundLink(item.source),
      item.why ? el("p", { className: "why", id: "why-" + item.id, textContent: item.why }) : null,   // why it was suggested (server/engine.js)
      item.askedFor ? chip("info", `From: ${item.askedFor}`) : null,
      item.wild ? Object.assign(chip("info", "Something different"), { id: "wild-" + item.id }) : null,   // the scorer's wildcard (server/scorer.js)
      item.fromText ? chip("ok", "Copied word for word from the book's text")
        : item.verify ? chip("bad", "Check the wording and author before posting") : null,
      !item.fromText && item.verify && S.server.ai ? checkButton(item) : null,
      fateLine(item),
      el("div", { className: "acts" }, use, reword, skip));

    const mark = (action) => {
      item.state = action;
      const data = base === "asked" ? askedData : todayData;
      if (action === "rejected" && data) data.items = data.items.filter((i) => i.id !== item.id);
      return send(`${base}/${item.id}/feedback`, "POST", { action, date: date || undefined }).catch(() => {});
    };
    use.addEventListener("click", () => {
      mark("used");
      if (base === "asked") closeAsk();
      onCanvas = { author: item.author, theme: item.theme, tone: item.tone, source: item.source.type, suggestionId: item.id };
      S.setQuote(item.text, item.author);
      show("create");
    });
    reword.addEventListener("click", () => openReword({
      quote: item.text, author: item.author,
      apply: (quote, altered) => {
        mark("used");
        if (base === "asked") closeAsk();
        onCanvas = { author: altered ? "" : item.author, theme: item.theme, tone: item.tone, source: item.source.type, suggestionId: item.id };
        S.setQuote(quote, altered ? "" : item.author); show("create");
      },
    }));
    skip.addEventListener("click", () => {
      mark("rejected"); node.remove();
      if (base === "suggestions" && !date && !$("suggestions").children.length) $("today-note").textContent = "That's all five for today. Want more? Find quotes in the Library.";
      if (base === "asked" && askedData) renderAsked(askedData);
    });
    return node;
  }

  // A quote's place in today's order (rank 1..n, best first, from the server's live score): the card's strongest
  // mark, a large numeral; number 1 is Nishiii's first choice; one quiet line says what the place rests on. The
  // numbers are the ones of the last load: a skip or a use leaves them as they are, the next load brings the new order.
  const COUNT = ["", "one", "two", "three", "four", "five"];
  const PLACE = ["First", "Second", "Third", "Fourth", "Fifth"];
  function rankHead(item, of) {
    const first = item.rank === 1, rests = (item.rests || []).join(" and ");
    const num = el("span", { className: "pick-num", textContent: String(item.rank) });
    num.setAttribute("aria-hidden", "true");
    return el("div", { className: "pick-head" + (first ? " first" : ""), id: "rank-" + item.id },
      num,
      el("div", { className: "pick-what" },
        el("span", { className: "vh", textContent: `${PLACE[item.rank - 1] || "Number " + item.rank} of ${COUNT[of] || of}.` }),
        first ? el("p", { className: "pick-first", textContent: "Nishiii's first choice for today" }) : null,
        rests ? el("p", { className: "pick-rests", textContent: "Ranked by " + rests }) : null));
  }
  function rankedCard(item, of) {
    const node = card(item);
    if (item.rank) { node.prepend(rankHead(item, of)); node.classList.add("ranked"); if (item.rank === 1) node.classList.add("first"); }
    return node;
  }

  function renderToday(data) {
    todayData = data;
    if (!data.of) data.of = data.items.length;      // how many there were at this load: "First of five" stays true after a skip
    const d = new Date(data.date + "T12:00:00");
    $("today-weekday").textContent = d.toLocaleDateString(undefined, { weekday: "long" });
    $("today-date").textContent = d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
    $("suggestions").replaceChildren(...data.items.map((i) => rankedCard(i, data.of)));
    const n = data.items.length, word = COUNT[n] ? COUNT[n][0].toUpperCase() + COUNT[n].slice(1) : String(n);
    $("today-note").textContent = !n ? "That's all five for today. Want more? Find quotes in the Library."
      : n === 1 ? "One for today." : `${word} for today, best first.`;
  }
  // What Today shows now, in its order and with its numbers: the scorer's line in the Nishiii section lists the same.
  window.StudioKit.today = () => (todayData ? todayData.items.filter((i) => i.rank) : []);

  async function loadToday(force) {
    if (!S.server.ai) {
      $("today-note").textContent = "Daily quotes aren't switched on yet. You can still write your own words in Create.";
      return;
    }
    if (todayBusy) return;
    if (todayLoaded && !force) renderToday(todayData);   // show what we have at once, then refresh quietly
    todayBusy = true;
    if (!todayLoaded) $("today-note").textContent = "Nishiii is choosing today's quotes. This can take half a minute…";
    try { renderToday(await getJson("suggestions")); todayLoaded = true; }
    catch (e) { $("today-note").textContent = friendly(e); }
    finally { todayBusy = false; }
    loadWeek();
  }

  // The previous seven days, one folded row each. Their quotes can still be used, reworded or skipped.
  const openDays = new Set();
  async function loadWeek() {
    let days;
    try { days = (await getJson("suggestions/history")).days; } catch (e) { return; }   // Today still works without it
    $("week").hidden = !days.length;
    $("week-days").replaceChildren(...days.map((d) => {
      const when = new Date(d.date + "T12:00:00");
      const posted = d.items.filter((i) => i.posted === "posted").length;
      const tally = `${d.items.length} ${d.items.length === 1 ? "quote" : "quotes"}${posted ? `, ${posted} posted` : ""}`;
      const row = el("details", {},
        el("summary", {},
          el("span", { className: "when", textContent: when.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }) }),
          el("span", { className: "tally", textContent: tally })),
        el("div", { className: "cards" }, ...d.items.map((i) => card(i, "suggestions", d.date))));
      row.open = openDays.has(d.date);
      row.addEventListener("toggle", () => { if (row.open) openDays.add(d.date); else openDays.delete(d.date); });
      return row;
    }));
  }

  // ---------- Library: "Quotes you found", kept apart from Today, newest first ----------
  let askedData = null, foundAll = false;
  const FOUND_FIRST = 4;           // the list is folded after these, with "Show all"
  function foundNote(msg) { $("found-note").textContent = msg; $("found-note").hidden = !msg; }
  function renderAsked(data) {
    askedData = data;
    const items = data.items;
    $("found-wrap").hidden = !items.length;
    $("found-list").replaceChildren(...(foundAll ? items : items.slice(0, FOUND_FIRST)).map((i) => card(i, "asked")));
    $("found-all").hidden = foundAll || items.length <= FOUND_FIRST;
    $("found-all").textContent = `Show all ${items.length}`;
    foundNote("");
  }
  async function loadAsked() {
    if (!S.server.ai) return;
    try { renderAsked(await getJson("asked")); } catch (e) { $("found-wrap").hidden = false; foundNote(friendly(e)); }
  }
  $("found-all").addEventListener("click", () => { foundAll = true; if (askedData) renderAsked(askedData); });

  // ---------- the "Find quotes" sheet: choose, find, read, choose one ----------
  const COUNTS = [5, 10, 15, 20], ROUND = 5;     // found five at a time, so they show as they come and each request stays small
  const COUNT_KEY = "ds-find-count";
  const asking = { picked: new Set(), lib: null, insp: null, count: 10, busy: false };
  try { const n = Number(localStorage.getItem(COUNT_KEY)); if (COUNTS.includes(n)) asking.count = n; } catch (e) { /* private mode: the default */ }
  function pickButton(id, label) {
    const b = el("button", { type: "button", textContent: label });
    b.setAttribute("aria-pressed", String(asking.picked.has(id)));
    b.addEventListener("click", () => {
      if (asking.picked.has(id)) asking.picked.delete(id); else asking.picked.add(id);
      b.setAttribute("aria-pressed", String(asking.picked.has(id)));
    });
    return b;
  }
  function renderCount() {
    $("ask-count").replaceChildren(...COUNTS.map((n) => {
      const b = el("button", { type: "button", id: "ask-count-" + n, textContent: String(n) });
      b.setAttribute("aria-pressed", String(n === asking.count));
      b.addEventListener("click", () => {
        asking.count = n;
        try { localStorage.setItem(COUNT_KEY, String(n)); } catch (e) { /* not remembered, still used */ }
        renderCount();
      });
      return b;
    }));
    $("ask-go").textContent = `Find ${asking.count} quotes`;
  }
  function renderAsk() {
    const lib = asking.lib, insp = asking.insp;
    const group = (name, buttons) => (buttons.length ? el("div", {}, el("h3", { textContent: name }), el("div", { className: "picks" }, ...buttons)) : null);
    const screen = lib.screen || [];
    const groups = [
      group("Books", lib.books.map((x) => pickButton(x.id, x.title))),
      group("Films", screen.filter((x) => x.kind === "film").map((x) => pickButton(x.id, x.title))),
      group("Series", screen.filter((x) => x.kind === "series").map((x) => pickButton(x.id, x.title))),
      group("In the spirit of a page you love", insp.filter((x) => x.handle || x.quote).map((x) => pickButton(x.id, x.handle ? "@" + x.handle : (x.quote || "").slice(0, 28) + "…"))),
      group("Yours", lib.quotes.length ? [pickButton("own", "Your own saved lines")] : []),
    ].filter(Boolean);
    $("ask-groups").replaceChildren(...(groups.length ? groups
      : [el("p", { className: "empty", textContent: "Nothing saved yet. Add a book, film or series below, or just say what the quotes should be about." })]));
  }
  // The choosing part, or (once quotes are coming) "Find more" and "Change what".
  function choosing(on) {
    $("ask-choose").hidden = !on; $("ask-go").hidden = !on; $("ask-after").hidden = on;
  }
  // Opens the sheet; "only" is a book, film or series to have chosen alone (its own "Find quotes" in the Library).
  async function openAsk(only) {
    if (only) asking.picked = new Set([only]);
    $("ask-status").textContent = ""; $("ask-progress").textContent = "";
    $("ask-results").replaceChildren();
    choosing(true); renderCount();
    $("ask-sheet").hidden = false;
    $("ask-sheet").querySelector(".sheet-body").scrollTo({ top: 0 });
    try {
      [asking.lib, asking.insp] = await Promise.all([getJson("library"), getJson("inspirations").then((d) => d.items)]);
      renderAsk();
    } catch (e) { $("ask-status").textContent = friendly(e); }
  }
  // Closing loses nothing: every quote found (and not skipped) is already kept, and shown in the Library.
  function closeAsk() {
    if ($("ask-sheet").hidden) return;
    $("ask-sheet").hidden = true;
    if (askedData) renderAsked(askedData); else loadAsked();
  }
  // Finds the chosen number, a round at a time; each round's quotes go on top as they come. Stops early, saying
  // why, when nothing new is left.
  async function findQuotes() {
    if (asking.busy) return;
    const sources = [...asking.picked], about = $("ask-about").value, want = asking.count;
    asking.busy = true;
    $("ask-go").disabled = true; $("ask-more").disabled = true;
    $("ask-status").textContent = "";
    $("ask-progress").textContent = `Finding ${want} quotes…`;
    let got = 0, said = "";
    try {
      for (let round = 0; got < want && round < 8; round++) {
        const data = await send("asked", "POST", { sources, about, count: Math.min(ROUND, want - got) });
        askedData = data;
        const fresh = (data.fresh || []).map((id) => data.items.find((i) => i.id === id)).filter(Boolean);
        if (fresh.length) choosing(false);
        $("ask-results").prepend(...fresh.map((i) => card(i, "asked")));
        got += fresh.length;
        if (data.said) { said = data.said; break; }
        if (!fresh.length) break;
        if (got < want) $("ask-progress").textContent = `Found ${got} of ${want}…`;
      }
      $("ask-progress").textContent = said ? (got ? `Found ${got}. ${said}` : said)
        : got >= want ? `Found ${got} quotes. They stay in your Library too.` : `Found ${got} of ${want}. That's all Nishiii could find just now.`;
    } catch (e) {
      $("ask-progress").textContent = got ? `Found ${got} of ${want}.` : "";
      $("ask-status").textContent = friendly(e);
    } finally {
      asking.busy = false;
      $("ask-go").disabled = false; $("ask-more").disabled = false;
      if ($("ask-sheet").hidden && askedData) renderAsked(askedData);
    }
  }
  $("find-open").addEventListener("click", () => openAsk());
  $("ask-close").addEventListener("click", closeAsk);
  $("ask-sheet").addEventListener("click", (e) => { if (e.target === $("ask-sheet")) closeAsk(); });
  $("ask-add").addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = $("ask-new").value.trim(), kind = $("ask-new-kind").value;
    try {
      const before = new Set([...(asking.lib ? asking.lib.books : []), ...((asking.lib && asking.lib.screen) || [])].map((x) => x.id));
      asking.lib = kind === "book" ? await send("library/books", "POST", { title }) : await send("library/screen", "POST", { title, kind });
      // Select what was just added, so one more tap gets quotes from it.
      [...asking.lib.books, ...(asking.lib.screen || [])].filter((x) => !before.has(x.id)).forEach((x) => asking.picked.add(x.id));
      $("ask-new").value = ""; $("ask-status").textContent = "";
      renderAsk();
      if (!$("view-library").hidden) renderLibrary(asking.lib);
    } catch (err) { $("ask-status").textContent = friendly(err); }
  });
  $("ask-go").addEventListener("click", findQuotes);
  $("ask-more").addEventListener("click", findQuotes);
  $("ask-change").addEventListener("click", () => { choosing(true); $("ask-sheet").querySelector(".sheet-body").scrollTo({ top: 0, behavior: "smooth" }); });

  // ---------- Library: her quotes and books ----------
  function note(msg) { $("library-note").textContent = msg; $("library-note").hidden = !msg; if (msg) $("library-note").scrollIntoView({ block: "nearest" }); }

  function renderLibrary(lib) {
    const rowOf = (kind, item, main, sub, ...extra) => {
      const remove = el("button", { textContent: "Remove" });
      remove.setAttribute("aria-label", `Remove ${main.slice(0, 40)}`);
      remove.addEventListener("click", async () => {
        try { renderLibrary(await send(`library/${kind}/${item.id}`, "DELETE")); } catch (e) { note(friendly(e)); }
      });
      const find = (kind === "books" || kind === "screen") && S.server.ai
        ? el("button", { type: "button", className: "btn small soft ic ic-sparkle find-row", id: "find-" + item.id, textContent: "Find quotes" }) : null;
      if (find) find.addEventListener("click", () => openAsk(item.id));
      return el("li", {}, el("div", {}, el("p", { className: "main", textContent: main }), sub ? el("p", { className: "sub", textContent: sub }) : null, ...extra, find), remove);
    };
    // Real lines found for a book, film or series (on Wikiquote, a quote site or the web), kept for next time.
    const foundRow = (kind, x) => {
      const n = x.found && x.found.lines ? x.found.lines.length : 0;
      if (!n) return null;
      const site = [...new Set(x.found.lines.map((l) => l.site).filter(Boolean))];
      const wrong = el("button", { type: "button", id: "found-wrong-" + x.id, textContent: "Not the right one" });
      wrong.addEventListener("click", async () => {
        try { renderLibrary(await send(`library/${kind}/${x.id}/found`, "POST", { forget: true })); } catch (e) { note(friendly(e)); }
      });
      return [el("p", { className: "sub", id: "found-" + x.id, textContent: `${n} real ${n === 1 ? "line" : "lines"} found${site.length === 1 ? " on " + site[0] : ""}.` }), wrong];
    };
    // "Did you mean ...?" when the title she typed is close to a real one found on the web (server/verify.js).
    const titleRow = (kind, x) => {
      const m = x.maybe;
      if (!m || !m.title) return [];
      const kindWord = kind === "screen" && m.kind !== x.kind ? (m.kind === "series" ? "the series " : "the film ") : "";
      const fix = el("button", { type: "button", className: "btn soft", id: "title-fix-" + x.id,
        textContent: `Did you mean ${kindWord}${m.title}${m.year ? ` (${m.year})` : ""}${m.by && kind === "books" && !x.author ? `, by ${m.by}` : ""}?` });
      const keep = el("button", { type: "button", className: "btn quiet", id: "title-keep-" + x.id, textContent: "Keep mine" });
      const answer = (accept) => async () => {
        try {
          const lib = await send(`library/${kind}/${x.id}/title`, "POST", accept ? { accept: true } : { keep: true });
          renderLibrary(lib);
          if (accept && kind === "books") findText(x.id);     // the book's text is looked for again under its proper title
        } catch (e) { note(friendly(e)); }
      };
      fix.addEventListener("click", answer(true));
      keep.addEventListener("click", answer(false));
      return [el("div", { className: "acts", id: "title-offer-" + x.id }, fix, keep)];
    };
    const year = (x) => (x.known && x.known.year ? ` · ${x.known.year}` : "");
    // After a look that found nothing: where Nishiii looked, in one sentence, and "Look again".
    const lookRow = (kind, x) => {
      const f = x.found;
      if (!f || !f.at || (f.lines && f.lines.length)) return [];
      const again = el("button", { type: "button", className: "btn quiet", id: "look-again-" + x.id, textContent: "Look again" });
      again.addEventListener("click", async () => {
        again.disabled = true; again.textContent = "Looking…";
        try { renderLibrary(await send(`library/${kind}/${x.id}/look`, "POST", {})); }
        catch (e) { note(friendly(e)); again.disabled = false; again.textContent = "Look again"; }
      });
      return [el("p", { className: "sub", id: "look-" + x.id, textContent: (f.trail && f.trail.said) || "Nishiii looked: nothing yet." }), again];
    };
    // Two entries for one work ("The early spring" and "The early spring cdrama"): offered to fold into one, never done alone.
    const core = (t) => String(t || "").toLowerCase().replace(/\s*\((\d{4}|tv series|series|film|novel|book|drama)\)\s*$/, "").replace(/[^a-z0-9]+/g, " ").trim()
      .replace(/^(the|a|an) /, "").replace(/\s+(c|k|j|thai|chinese|korean|japanese|taiwanese)?\s?(drama|dramas|tv series|tv show|series|show|web series|film|movie|novel|book)$/, "").replace(/\s+(19|20)\d\d$/, "").trim();
    const mergeRow = (kind, x, list) => {
      const twin = list.find((y) => y !== x && (kind === "books" || y.kind === x.kind) && core(y.title) && core(y.title) === core(x.title));
      if (!twin || list.indexOf(twin) > list.indexOf(x)) return [];          // offered on the later of the two
      const join = el("button", { type: "button", className: "btn soft", id: "merge-" + x.id, textContent: `Same as “${twin.title}”? Keep one` });
      join.addEventListener("click", async () => {
        try { renderLibrary(await send(`library/${kind}/${x.id}/merge`, "POST", { into: twin.id })); } catch (e) { note(friendly(e)); }
      });
      return [join];
    };
    const bookRow = (b) => {
      const found = foundRow("books", b), offer = titleRow("books", b), by = (b.author || (b.known && b.known.by) || "") + year(b);
      const more = [...lookRow("books", b), ...mergeRow("books", b, lib.books)];
      const row = (kind, item, main, sub, ...extra) => rowOf(kind, item, main, sub, ...extra, ...more);
      if (offer.length) return row("books", b, b.title, by, ...offer);
      if (found && !b.textUrl) return row("books", b, b.title, by, ...found);
      if (b.textUrl) {
        const wrong = el("button", { type: "button", textContent: "Not the right book" });
        wrong.addEventListener("click", async () => {
          try { renderLibrary(await send(`library/books/${b.id}/text`, "POST", { forget: true })); } catch (e) { note(friendly(e)); }
        });
        return row("books", b, b.title, by, chip("ok", "Quoted word for word"),
          el("p", { className: "sub", textContent: `Matched to "${b.textTitle}"${b.textAuthor ? ` by ${b.textAuthor}` : ""}.` }), wrong);
      }
      if (b.textChecked) return row("books", b, b.title, by, el("p", { className: "sub", textContent: (b.textNote || "").startsWith("Set aside") ? "Nishiii looks for its real lines when you ask." : "Not free to read online. Nishiii looks for its real lines when you ask." }));
      const find = el("button", { type: "button", textContent: "Look for its full text" });
      find.addEventListener("click", () => findText(b.id, find));
      return row("books", b, b.title, by, find);
    };
    const fill = (id, rows, empty) => $(id).replaceChildren(...(rows.length ? rows : [el("li", {}, el("p", { className: "empty", textContent: empty }))]));
    const row = rowOf;
    fill("list-quotes", lib.quotes.slice().reverse().map((q) => row("quotes", q, q.text, [q.author, q.from].filter(Boolean).join(", "))), "No quotes saved yet.");
    fill("list-books", lib.books.map(bookRow), "No books yet.");
    fill("list-screen", (lib.screen || []).map((x) => row("screen", x, x.title, (x.kind === "series" ? "Series" : "Film") + year(x), ...titleRow("screen", x), ...(foundRow("screen", x) || []),
      ...lookRow("screen", x), ...mergeRow("screen", x, lib.screen || []))), "No films or series yet.");
    checkTitles(lib);
  }

  // Each title in the Library is checked on the web once, one at a time, newest first, at most two per visit
  // (the ones she adds are checked at once). The row updates when the answer is in.
  let titleBusy = false, titleTries = 0, titleRun = Promise.resolve(), textBusy = 0;
  async function checkTitle(kind, id) {
    titleBusy = true;
    try { renderLibrary(await send(`library/${kind}/${id}/title`, "POST", {})); return true; }
    catch (e) { return false; }
    finally { titleBusy = false; }
  }
  function checkTitles(lib) {
    if (titleBusy || textBusy || titleTries >= 2 || !S.server.on) return;
    const todo = [...lib.books.map((x) => ["books", x]), ...(lib.screen || []).map((x) => ["screen", x])].filter(([, x]) => !x.titleChecked).sort((a, b) => (b[1].added || 0) - (a[1].added || 0))[0];
    if (!todo) return;
    titleTries += 1;
    titleRun = checkTitle(todo[0], todo[1].id);
  }

  // Looks the book up among books that are free to read. Old classics usually are; modern books are not.
  async function findText(id, button) {
    if (button) { button.disabled = true; button.textContent = "Looking…"; }
    textBusy += 1;
    let lib = null;
    try { lib = await send(`library/books/${id}/text`, "POST", {}); }
    catch (e) { if (button) { button.disabled = false; button.textContent = "Look for its full text"; note(friendly(e)); } }
    finally { textBusy -= 1; }
    if (lib) renderLibrary(lib);
  }

  async function loadLibrary() {
    $("find-top").hidden = !S.server.ai;
    if (!S.server.on) { note("Your Library isn't available right now."); return; }
    loadAsked();
    try { renderLibrary(await getJson("library")); note(""); } catch (e) { note(friendly(e)); }
    try { renderInspirations(await getJson("inspirations")); } catch (e) { inspNote(friendly(e)); }
  }

  function addForm(formId, kind, read, clear) {
    $(formId).addEventListener("submit", async (e) => {
      e.preventDefault();
      try { renderLibrary(await send(`library/${kind}`, "POST", read())); clear(); note(""); }
      catch (err) { note(friendly(err)); }
    });
  }
  addForm("add-quote", "quotes", () => ({ text: $("q-text").value, author: $("q-author").value, from: $("q-from").value }),
    () => { $("q-text").value = ""; });
  $("add-book").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const lib = await send("library/books", "POST", { title: $("b-title").value, author: $("b-author").value });
      titleTries = 0;
      renderLibrary(lib);
      $("b-title").value = ""; $("b-author").value = ""; note("");
      const added = lib.books[lib.books.length - 1];
      // In the background, one after the other: the title is checked on the web, then the book's text is looked for.
      if (added && !added.textChecked) titleRun.then(() => findText(added.id));
    } catch (err) { note(friendly(err)); }
  });

  addForm("add-screen", "screen", () => { titleTries = 0; return { title: $("s-title").value, kind: $("s-kind").value }; }, () => { $("s-title").value = ""; });

  // Scan: let Claude read a photographed page, then she picks which lines to keep.
  $("scan").addEventListener("change", async () => {
    const file = $("scan").files[0];
    $("scan").value = "";
    if (!file) return;
    if (!S.server.ai) { note("Scanning isn't switched on yet."); return; }
    $("scan-results").replaceChildren(el("p", { className: "note", textContent: "Reading the page…" }));
    try {
      const { passages } = await send("scan", "POST", { image: await shrink(file) });
      if (!passages.length) { $("scan-results").replaceChildren(el("p", { className: "note", textContent: "No readable text was found. Try a sharper, closer photo." })); return; }
      $("scan-results").replaceChildren(...passages.map((text) => {
        const save = el("button", { className: "btn", textContent: "Save this one" });
        const node = el("article", { className: "card" }, el("p", { className: "q", textContent: text }),
          el("p", { className: "flag", textContent: "Read from your photo. Check it against the page." }), save);
        save.addEventListener("click", async () => {
          try {
            renderLibrary(await send("library/quotes", "POST", { text, author: $("q-author").value, from: $("q-from").value }));
            node.remove(); note("");
          } catch (e) { note(friendly(e)); }
        });
        return node;
      }));
    } catch (e) { $("scan-results").replaceChildren(el("p", { className: "flag", textContent: friendly(e) })); }
  });

  // Import: highlights exported from an e-reader, or any text file of quotes.
  const flipName = (a) => { const m = /^([^,]+),\s*([^,]+)$/.exec(a); return m ? `${m[2]} ${m[1]}` : a; };
  function parseHighlights(text, isHtml) {
    const out = [];
    if (isHtml) {
      // The notebook the Kindle app emails: a heading says "Highlight" or "Note", the next block holds the words.
      const doc = new DOMParser().parseFromString(text, "text/html");
      const pick = (sel) => ((doc.querySelector(sel) || {}).textContent || "").trim();
      const from = pick(".bookTitle") || pick("title"), author = flipName(pick(".authors"));
      const blocks = [...doc.querySelectorAll(".noteText")];
      for (const n of blocks) {
        const head = n.previousElementSibling;
        if (head && /note/i.test(head.textContent) && !/highlight/i.test(head.textContent)) continue;     // her own notes, not quotes
        out.push({ text: n.textContent.trim(), from, author });
      }
      if (!blocks.length) for (const para of (doc.body ? doc.body.innerText || doc.body.textContent : "").split(/\n\s*\n/)) out.push({ text: para.trim(), from: "", author: "" });
    } else if (/^==========\s*$/m.test(text)) {
      // A Kindle's "My Clippings.txt": title line, a line about where it was marked, a blank line, then the words.
      for (const entry of text.split(/^==========\s*$/m)) {
        const ls = entry.replace(/\ufeff/g, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        if (ls.length < 3 || /bookmark/i.test(ls[1]) || /your note/i.test(ls[1])) continue;
        const m = /^(.*?)\s*\(([^()]+)\)$/.exec(ls[0]);
        out.push({ text: ls.slice(2).join(" "), from: m ? m[1] : ls[0], author: m ? flipName(m[2]) : "" });
      }
    } else {
      const paras = text.split(/\r?\n\s*\r?\n/).map((x) => x.trim()).filter(Boolean);
      for (const para of paras.length > 1 ? paras : text.split(/\r?\n/)) out.push({ text: para.replace(/\s+/g, " ").trim(), from: "", author: "" });
    }
    const seen = new Set();
    return out.filter((q) => q.text.length >= 12 && q.text.length <= 500 && !seen.has(q.text.toLowerCase()) && seen.add(q.text.toLowerCase()));
  }
  $("import").addEventListener("change", async () => {
    const file = $("import").files[0];
    $("import").value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { note("That file is too large to be a highlights file. It should be under 5 MB."); return; }
    try {
      const found = parseHighlights(await file.text(), /\.html?$/i.test(file.name) || file.type === "text/html");
      if (!found.length) { note("No highlights were found in that file. It should be a Kindle highlights file, or text with one quote per paragraph."); return; }
      const books = [...new Set(found.map((q) => q.from).filter(Boolean))];
      const ok = await confirmDialog({ title: `Add ${found.length} highlight${found.length === 1 ? "" : "s"}?`,
        body: `${books.length ? `From ${books.slice(0, 3).join(", ")}${books.length > 3 ? ` and ${books.length - 3} more` : ""}. ` : ""}They go into your own quotes. Any you already saved are left out.${found.length > 600 ? " Only the first 600 are added in one go." : ""}`,
        yes: "Add them" });
      if (!ok) return;
      const lib = await send("library/import", "POST", { items: found.slice(0, 600) });
      renderLibrary(lib);
      note(lib.added ? `Added ${lib.added} highlight${lib.added === 1 ? "" : "s"} to your own quotes.${lib.added < Math.min(found.length, 600) ? " The rest were already saved, or your list is full at 500." : ""}`
        : "Nothing new was added: those were already saved, or your list is full at 500.");
    } catch (e) { note(friendly(e)); }
  });

  // ---------- Library: reels and pages she loves ----------
  function inspNote(msg) { $("inspiration-note").textContent = msg; $("inspiration-note").hidden = !msg; }

  function inspirationCard(item) {
    const title = item.kind === "account" ? `@${item.handle}${item.followers ? `, ${compact(item.followers)} followers` : ""}`
      : item.kind === "reel" ? `Reel${item.handle ? ` from @${item.handle}` : ""}` : `Screenshot${item.handle ? ` from @${item.handle}` : ""}`;
    const kids = [el("p", { className: "tag", textContent: title })];
    if (item.quote) kids.push(el("p", { className: "q", textContent: item.quote }));
    if (item.author) kids.push(el("p", { className: "by", textContent: "— " + item.author }));
    if (item.caption) kids.push(el("p", { className: "cap", textContent: "Caption: " + item.caption }));
    if (item.style) kids.push(el("p", { className: "cap", textContent: "Look: " + item.style }));
    if (item.metrics) kids.push(el("p", { className: "src", textContent: [`${compact(item.metrics.likes)} likes`, `${compact(item.metrics.comments)} comments`, item.metrics.views ? `${compact(item.metrics.views)} views` : ""].filter(Boolean).join(", ") }));
    if (item.top.length) {
      kids.push(el("h3", { textContent: "Posts that did best" }));
      kids.push(el("ul", {}, ...item.top.map((t) => el("li", { textContent: `${t.quote || t.caption || "No text"} (${compact(t.likes)} likes${t.views ? `, ${compact(t.views)} views` : ""})` }))));
    }
    if (item.status) kids.push(el("p", { className: "src", textContent: item.status }));

    const links = el("div", { className: "links" });
    if (item.url) links.append(el("a", { href: item.url, target: "_blank", rel: "noopener", className: "ic ic-open", textContent: "Open" }));
    if (item.kind !== "screenshot") {
      const again = el("button", { type: "button", textContent: "Read again" });
      again.addEventListener("click", async () => {
        again.disabled = true; again.textContent = "Reading…";
        try { renderInspirations(await send(`inspirations/${item.id}/refresh`, "POST")); inspNote(""); } catch (e) { inspNote(friendly(e)); again.disabled = false; again.textContent = "Read again"; }
      });
      links.append(again);
    }
    if (item.kind === "reel" && !item.quote) {
      const pick = el("input", { type: "file", accept: "image/*", hidden: true });
      const add = el("button", { type: "button", textContent: "Add its screenshot" });
      add.addEventListener("click", () => pick.click());
      pick.addEventListener("change", () => { if (pick.files[0]) addScreenshot(pick.files[0], item.id); });
      links.append(add, pick);
    }
    const remove = el("button", { type: "button", className: "last", textContent: "Remove" });
    remove.addEventListener("click", async () => {
      try { renderInspirations(await send(`inspirations/${item.id}`, "DELETE")); } catch (e) { inspNote(friendly(e)); }
    });
    links.append(remove);
    kids.push(links);
    return el("article", { className: "card" }, ...kids);
  }
  function renderInspirations(data) {
    $("list-inspirations").replaceChildren(...(data.items.length ? data.items.map(inspirationCard)
      : [el("p", { className: "empty", textContent: "Nothing here yet. Add a reel you wish you'd made." })]));
  }
  async function addScreenshot(file, forId) {
    if (!S.server.ai) { inspNote("Reading screenshots isn't switched on yet."); return; }
    inspNote("Reading the screenshot…");
    try { renderInspirations(await send("inspirations", "POST", { image: await shrink(file), forId })); inspNote(""); }
    catch (e) { inspNote(friendly(e)); }
  }
  $("add-inspiration").addEventListener("submit", async (e) => {
    e.preventDefault();
    inspNote("Looking it up on Instagram…");
    try { renderInspirations(await send("inspirations", "POST", { input: $("i-input").value })); $("i-input").value = ""; inspNote(""); }
    catch (err) { inspNote(friendly(err)); }
  });
  $("i-shot").addEventListener("change", () => {
    const file = $("i-shot").files[0];
    $("i-shot").value = "";
    if (file) addScreenshot(file);
  });

  // ---------- Reword with Nishiii ----------
  let session = null;   // { original, author, quote, altered, messages, apply }
  function openReword({ quote, author, apply }) {
    session = { original: quote, author: author || "", quote, altered: false, messages: [], apply };
    $("reword-original").textContent = quote;
    $("reword-new").hidden = true;
    $("reword-quote").textContent = "";
    $("reword-flag").hidden = true;
    $("reword-log").replaceChildren();
    $("reword-input").value = "";
    $("reword-use").textContent = "Keep the original";
    $("reword").hidden = false;
    $("reword-input").focus();
  }
  const closeReword = () => { $("reword").hidden = true; session = null; };
  $("reword-close").addEventListener("click", closeReword);
  $("reword").addEventListener("click", (e) => { if (e.target === $("reword")) closeReword(); });

  async function ask(text) {
    if (!session || !text.trim()) return;
    const mine = session;
    mine.messages.push({ role: "user", content: text.trim() });
    $("reword-log").append(el("p", { className: "me", textContent: text.trim() }));
    $("reword-input").value = "";
    $("reword-send").disabled = true;
    const waiting = el("p", { className: "her", textContent: "Thinking…" });
    $("reword-log").append(waiting);
    waiting.scrollIntoView({ block: "nearest" });
    try {
      const r = await send("edit", "POST", { quote: mine.original, author: mine.author, messages: mine.messages });
      if (session !== mine) return;          // she closed the sheet while waiting
      mine.messages.push({ role: "assistant", content: `${r.reply}\n\n${r.quote}` });
      mine.quote = r.quote; mine.altered = r.altered;
      waiting.textContent = r.reply;
      $("reword-quote").textContent = r.quote;
      $("reword-new").hidden = false;
      $("reword-use").textContent = "Use the reworded version";
      $("reword-flag").hidden = !(r.altered && mine.author);
    } catch (e) {
      mine.messages.pop();
      waiting.className = "err"; waiting.textContent = friendly(e);
    } finally { $("reword-send").disabled = false; }
  }
  $("reword-form").addEventListener("submit", (e) => { e.preventDefault(); ask($("reword-input").value); });
  $("reword-chips").addEventListener("click", (e) => { if (e.target.tagName === "BUTTON") ask(e.target.textContent); });
  $("reword-use").addEventListener("click", () => {
    if (!session) return;
    const { apply, quote, altered } = session;
    closeReword();
    apply(quote, altered);
  });
  $("reword-open").addEventListener("click", () => {
    const text = S.selectedText().trim();
    if (!text) return;
    openReword({ quote: text, author: "", apply: (quote) => S.replaceSelectedText(quote) });
  });

  // ---------- Check who said this ----------
  $("check-open").addEventListener("click", async () => {
    const box = $("check-result"), btn = $("check-open");
    const quote = S.quoteOnly(), given = S.author();
    box.hidden = false;
    if (!quote) { box.replaceChildren(el("p", { className: "note", textContent: "Put a quote on the canvas first." })); return; }
    btn.disabled = true; btn.textContent = "Checking…";
    try {
      const r = await send("check", "POST", { text: quote, author: given });
      const known = r.author && r.author.toLowerCase() !== "unknown";
      const verdicts = {
        matches: ["ok", "The author and the wording look right"],
        different_author: ["bad", given ? `Probably not by ${given}` : "The author looks wrong"],
        altered_wording: ["wait", "The wording differs from the original"],
        found: ["info", known ? `Probably by ${r.author}` : "No confirmed author"],
        unsure: ["gone", "Nishiii doesn't recognise this line"],
      };
      const [kind, words] = verdicts[r.verdict] || verdicts.unsure;
      const kids = [chip(kind, words)];
      if (r.note) kids.push(el("p", { textContent: r.note }));
      if (r.work) kids.push(el("p", { className: "src", textContent: `From: ${r.work}` }));
      const act = (label, fn) => { const b = el("button", { className: "btn", type: "button", textContent: label }); b.addEventListener("click", () => { fn(); box.hidden = true; }); kids.push(b); };
      if (["different_author", "found"].includes(r.verdict) && known && r.author !== given) act(`Credit ${r.author}`, () => { S.setAuthor(r.author); onCanvas.author = r.author; });
      if (r.verdict === "different_author" && !known && given) act("Take the name off", () => { S.setAuthor(""); onCanvas.author = ""; });
      if (r.verdict === "altered_wording" && r.wording) { kids.push(el("p", { className: "q", textContent: r.wording })); act("Use the original wording", () => S.setWords(r.wording)); }
      kids.push(...checkedOn(r));
      box.replaceChildren(...kids);
    } catch (e) { box.replaceChildren(el("p", { className: "flag", textContent: friendly(e) })); }
    finally { btn.disabled = false; btn.textContent = "Who said this?"; }
  });

  // ---------- Saved looks ----------
  function renderLooks(looks) {
    $("looks").replaceChildren(...(looks.length ? looks.map((look) => {
      const apply = el("button", { className: "apply", type: "button", textContent: look.name });
      apply.setAttribute("aria-label", `Use the look ${look.name}`);
      apply.addEventListener("click", () => { $("look-note").textContent = S.applyLook(look) ? `The words are now in "${look.name}".` : "Write some words on the canvas first."; });
      const remove = el("button", { type: "button", textContent: "Remove" });
      remove.setAttribute("aria-label", `Remove the look ${look.name}`);
      remove.addEventListener("click", async () => {
        try { renderLooks((await send("looks/" + look.id, "DELETE")).looks); } catch (e) { $("look-note").textContent = friendly(e); }
      });
      return el("li", {}, el("div", {}, apply, el("p", { className: "sub", textContent: look.shape === "post" ? "Post shape (4:5)" : "Reel shape (9:16)" })), remove);
    }) : [el("li", {}, el("p", { className: "empty", textContent: "None saved yet." }))]));
  }
  async function loadLooks() {
    $("looks-wrap").hidden = !S.server.on;
    if (!S.server.on) return;
    try { renderLooks((await getJson("looks")).looks); } catch (e) { $("look-note").textContent = friendly(e); }
  }
  $("look-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      renderLooks((await send("looks", "POST", { name: $("look-name").value, ...S.currentLook() })).looks);
      $("look-note").textContent = `Saved "${$("look-name").value.trim()}". Saving another look under the same name replaces it.`;
      $("look-name").value = "";
    } catch (err) { $("look-note").textContent = friendly(err); }
  });

  // ---------- Free music search ----------
  const TUNE_IDEAS = ["calm piano", "ambient", "acoustic guitar", "soft strings", "lo-fi", "cinematic", "rain", "hopeful"];
  const tune = { q: "calm piano", page: 1 };
  const tunePlayer = new Audio();          // one tunePlayer for listening to tracks in the list
  let listening = null, tuneNo = 0;
  const tuneStatus = (msg) => { $("tune-status").textContent = msg; };
  const mmss = (s) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "");
  function stopListening() {
    tunePlayer.pause();
    if (listening) listening.textContent = "Listen";
    listening = null;
  }
  tunePlayer.addEventListener("ended", stopListening);
  function tuneRow(item) {
    const hear = el("button", { type: "button", textContent: "Listen" });
    hear.setAttribute("aria-label", `Listen to ${item.title}`);
    hear.addEventListener("click", async () => {
      if (listening === hear) { stopListening(); return; }
      stopListening();
      tunePlayer.src = item.file;
      try { await tunePlayer.play(); listening = hear; hear.textContent = "Stop"; }
      catch (e) { tuneStatus("That one couldn't be played here. Try another."); }
    });
    const use = el("button", { type: "button", textContent: "Use this" });
    use.setAttribute("aria-label", `Use ${item.title}`);
    use.addEventListener("click", async () => {
      stopListening();
      use.disabled = true; tuneStatus("Fetching the track…");
      try {
        const blob = await (await S.api("music/file?url=" + encodeURIComponent(item.file))).blob();
        await S.loadMusic(new File([blob], `track-${item.id}.${item.ext}`, { type: blob.type || "audio/mpeg" }),
          { from: "library", title: item.title, artist: item.artist, licence: item.licence, credit: item.credit });
        $("tune-sheet").hidden = true;
        tuneStatus("");
      } catch (e) { tuneStatus(friendly(e)); }
      finally { use.disabled = false; }
    });
    return el("li", {}, el("div", {}, el("p", { className: "main", textContent: item.title }),
      el("p", { className: "sub", textContent: [item.artist ? `by ${item.artist}` : "", mmss(item.seconds)].filter(Boolean).join(", ") }),
      chip(item.needsCredit ? "info" : "ok", item.needsCredit ? "Credit added to your caption" : "No credit needed")),
      el("div", { className: "pair-col" }, hear, use));
  }
  async function searchTunes(append) {
    const mine = ++tuneNo;
    tuneStatus("Searching…");
    try {
      const data = await getJson(`music?page=${tune.page}&q=${encodeURIComponent(tune.q)}`);
      if (mine !== tuneNo) return;
      const rows = data.items.map(tuneRow);
      if (append) $("tune-list").append(...rows); else $("tune-list").replaceChildren(...rows);
      $("tune-more").hidden = !data.more;
      tuneStatus(data.items.length || append ? "" : "Nothing found for that. Try other words, like a mood or an instrument.");
    } catch (e) { if (mine === tuneNo) tuneStatus(friendly(e)); }
  }
  function newTuneSearch(q) {
    stopListening();
    tune.q = (q || $("tune-q").value).trim() || "calm piano"; tune.page = 1;
    $("tune-q").value = tune.q;
    $("tune-list").replaceChildren();
    searchTunes(false);
  }
  $("tune-ideas").replaceChildren(...TUNE_IDEAS.map((idea) => {
    const b = el("button", { type: "button", textContent: idea });
    b.addEventListener("click", () => newTuneSearch(idea));
    return b;
  }));
  $("tune-search").addEventListener("click", () => {
    $("tune-sheet").hidden = false;
    if (!$("tune-list").children.length) newTuneSearch();
  });
  const closeTunes = () => { stopListening(); $("tune-sheet").hidden = true; };
  $("tune-close").addEventListener("click", closeTunes);
  $("tune-sheet").addEventListener("click", (e) => { if (e.target === $("tune-sheet")) closeTunes(); });
  $("tune-form").addEventListener("submit", (e) => { e.preventDefault(); newTuneSearch(); });
  $("tune-more").addEventListener("click", () => { tune.page += 1; searchTunes(true); });

  // ---------- Background search: free photos and videos ----------
  const stock = { kind: "video", q: "", page: 1 };
  const status = (msg) => { $("stock-status").textContent = msg; };

  // Fetches the chosen photo or video. The server tries each of its addresses; if every one is refused there,
  // the phone asks the library directly, which libraries that turn servers away usually allow.
  async function fetchFromLibrary(item) {
    const all = item.files && item.files.length ? item.files : [item.file];
    try {
      return await (await S.api("stock/file?url=" + encodeURIComponent(all[0]) + all.slice(1).map((u) => "&alt=" + encodeURIComponent(u)).join(""))).blob();
    } catch (first) {
      if (item.kind === "video") throw first;
      for (const u of all) {
        try {
          const res = await fetch(u, { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer" });
          if (res.ok && (res.headers.get("Content-Type") || "").startsWith("image/")) return await res.blob();
        } catch (e) { /* try the next address */ }
      }
      throw first;
    }
  }

  function thumb(item) {
    const picture = el("img", { src: item.thumb, alt: `${item.kind === "video" ? "Video" : "Photo"} by ${item.credit || "a contributor"}`, loading: "lazy" });
    // If one address for the small picture fails to load, the next is tried.
    const spare = (item.thumbs || []).slice(1);
    picture.addEventListener("error", () => { if (spare.length) picture.src = spare.shift(); });
    const b = el("button", { type: "button" }, picture,
      el("span", { textContent: [item.seconds ? item.seconds + " s" : "", item.credit].filter(Boolean).join(", ") }));
    b.addEventListener("click", async () => {
      if (b.getAttribute("aria-busy") === "true") return;
      b.setAttribute("aria-busy", "true");
      // Picks are numbered too: tapping another one, or starting a new search, drops the one still on its way.
      const mine = ++pickNo;
      fetching = true;
      status(item.kind === "video" ? "Fetching the video. Large clips take a little while…" : "Fetching the photo…");
      try {
        const blob = await fetchFromLibrary(item);
        if (mine !== pickNo) return;
        const video = item.kind === "video";
        await S.loadBackground(new File([blob], `stock-${item.id}.${video ? "mp4" : "jpg"}`, { type: video ? "video/mp4" : "image/jpeg" }), { from: "search", words: stock.q, credit: item.credit || "" });
        $("stock-sheet").hidden = true;
        status("");
      } catch (e) { if (mine === pickNo) status(friendly(e)); }
      finally { b.removeAttribute("aria-busy"); if (mine === pickNo) fetching = false; }
    });
    return b;
  }

  let searchNo = 0, pickNo = 0, fetching = false;
  async function search(append) {
    if (!append) { pickNo += 1; fetching = false; }
    // Each search is numbered, so a slow answer to an earlier search (videos, say, after switching to photos)
    // can't replace the results of the one on screen.
    const mine = ++searchNo;
    if (!fetching) status("Searching…");
    try {
      const data = await getJson(`stock?kind=${stock.kind}&page=${stock.page}&q=${encodeURIComponent(stock.q)}`);
      if (mine !== searchNo) return;
      const nodes = data.items.map(thumb);
      if (append) $("stock-grid").append(...nodes); else $("stock-grid").replaceChildren(...nodes);
      $("stock-more").hidden = !data.more;
      if (data.provider) {
        $("stock-provider").textContent = data.provider.name; $("stock-provider").href = data.provider.url;
        $("stock-credit").hidden = false;
      }
      if (!fetching) status(data.items.length || append ? "" : "Nothing found. Try different words.");
    } catch (e) { if (mine === searchNo && !fetching) status(friendly(e)); }
  }
  const newSearch = () => { stock.q = $("stock-q").value.trim(); stock.page = 1; search(false); };
  $("stock").addEventListener("click", () => { $("stock-sheet").hidden = false; if (!$("stock-grid").children.length) newSearch(); stockIdeas(); });
  // Background words that did well on her own posts (server/engine.js): a tap searches for them.
  let ideasShown = false;
  function stockIdeas() {
    if (ideasShown) return;
    ideasShown = true;
    getJson("engine").then((e) => {
      const words = (e && e.bgWords) || [];
      if (!words.length || $("stock-ideas")) return;
      const row = el("div", { className: "chips pick", id: "stock-ideas" }, el("span", { className: "note", textContent: "Did well for you:" }),
        ...words.map((w) => { const b = el("button", { type: "button", textContent: w }); b.addEventListener("click", () => { $("stock-q").value = w; newSearch(); }); return b; }));
      $("stock-form").after(row);
    }).catch(() => { ideasShown = false; });
  }
  $("stock-close").addEventListener("click", () => { $("stock-sheet").hidden = true; });
  $("stock-sheet").addEventListener("click", (e) => { if (e.target === $("stock-sheet")) $("stock-sheet").hidden = true; });
  $("stock-form").addEventListener("submit", (e) => { e.preventDefault(); newSearch(); });
  $("stock-more").addEventListener("click", () => { stock.page += 1; search(true); });
  $("stock-kind").addEventListener("click", (e) => {
    const kind = e.target.dataset.kind;
    if (!kind || kind === stock.kind) return;
    stock.kind = kind;
    $("stock-kind").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.kind === kind)));
    newSearch();
  });

  // ---------- Posts: history, results, and the Instagram connection ----------
  let ig = null;

  function renderIg() {
    const on = !!(ig && ig.connected);
    $("ig-connect").hidden = on;
    $("ig-disconnect").hidden = !on;
    if (!S.server.instagram) { $("ig-status").textContent = "Posting isn't set up yet. (Setup: the Meta app's ID and secret are missing.)"; $("ig-connect").hidden = true; return; }
    $("ig-status").textContent = on
      ? `Connected as @${ig.username}${ig.page ? ` through the Facebook Page "${ig.page}"` : ""}. ${
        ig.musicUntil > Date.now() + 5 * 365 * 86400000 ? "The sign-in has no end date."
        : ig.musicUntil < Date.now() ? "Instagram's music search has stopped until Instagram is connected again; posting keeps working."
        : ig.renewedAt ? `The app renews the sign-in by itself; music search is good until ${day(ig.musicUntil)}.`
        : `Music search is good until ${day(ig.musicUntil)}, and the app will try to renew it by itself before then. Posting keeps working either way.`}`
      : "Not connected yet.";
  }

  function postCard(p) {
    const label = { processing: ["info", "Being processed by Instagram"], published: ["ok", "Posted"], failed: ["bad", "Didn't post"] };
    const [kind, words] = label[p.state] || ["gone", p.state];
    const kids = [el("p", { className: "q", textContent: p.quote || p.caption || "Reel" }), chip(kind, words)];
    kids.push(el("p", { className: "src", textContent: `${p.kind === "carousel" ? `Carousel of ${p.slides}` : "Reel"}, ${day(p.published || p.created)}${p.via === "instagram" ? ", finished in Instagram" : p.music ? `, music: ${p.music.title || p.music}` : ""}` }));
    if (p.error) kids.push(el("p", { className: "flag", textContent: p.error }));
    const m = p.metrics;
    if (m && Object.keys(m).length) {
      const names = [["reach", "Reach"], ["views", "Views"], ["likes", "Likes"], ["comments", "Comments"], ["saved", "Saves"], ["shares", "Shares"]];
      kids.push(el("dl", { className: "nums" }, ...names.filter(([k]) => m[k] != null).map(([k, name]) => el("div", {}, el("dt", { textContent: name }), el("dd", { textContent: compact(m[k]) })))));
    } else if (p.unlinked) kids.push(el("p", { className: "src", textContent: "You posted this in Instagram. Its link and numbers appear once the app can see it there." }));
    else if (p.state === "published") kids.push(el("p", { className: "src", textContent: "Numbers appear a little while after posting." }));
    const links = el("div", { className: "links" });
    if (p.permalink) links.append(el("a", { href: p.permalink, target: "_blank", rel: "noopener", className: "ic ic-insta", textContent: "Open" }));
    if (p.state === "published") {
      const talk = el("button", { type: "button", className: "ic ic-chat", textContent: "Comments" });
      talk.addEventListener("click", () => openComments(p));
      links.append(talk);
    }
    if (drafts()) links.append(drafts().versionButton(p.id));
    const remove = el("button", { type: "button", className: "last", textContent: "Remove" });
    remove.addEventListener("click", async () => {
      try { await send("posts/" + p.id, "DELETE"); loadPosts(); } catch (e) { $("posts-note").textContent = friendly(e); }
    });
    links.append(remove);
    kids.push(links);
    return el("article", { className: "card" }, ...kids);
  }

  // Reels made earlier and kept to post later.
  // "I posted it in Instagram": she posted this reel from the Instagram app herself. It moves to Posted at once;
  // the app links the real reel (and its numbers) when it can next see the page.
  function postedByHand(path, id) {
    const b = el("button", { className: "btn quiet ic ic-check", type: "button", id, textContent: "I posted it in Instagram" });
    b.addEventListener("click", async () => {
      b.disabled = true;
      try { await send(path + "/posted", "POST", {}); $("posts-note").textContent = "Moved to Posted."; loadPosts(); }
      catch (e) { b.disabled = false; $("posts-note").textContent = friendly(e); }
    });
    return b;
  }
  let igSees = true;      // can the app see the Instagram page right now? (the server says, with the lists)
  function queueCard(q) {
    const go = el("button", { className: "btn primary ic ic-send", type: "button", textContent: "Post this now" });
    go.addEventListener("click", () => openPost("reel", q));
    const drop = el("button", { className: "btn quiet", type: "button", textContent: "Remove" });
    drop.addEventListener("click", async () => {
      try { renderQueue((await send("queue/" + q.id, "DELETE")).queue); } catch (e) { $("posts-note").textContent = friendly(e); }
    });
    const song = el("button", { className: "btn ic ic-music", type: "button", textContent: "Add a song in Instagram" });
    song.addEventListener("click", () => openHandoff(q));
    return el("article", { className: "card" }, el("p", { className: "q", textContent: q.quote || "A reel" }), chip("wait", "Waiting for your tap"),
      el("p", { className: "src", textContent: `Kept until ${day(q.keptUntil)}. After that you'd need to create it again.` }),
      // When the app can see the Instagram page, a reel posted there is found by itself (as Posts opens, and hourly).
      el("p", { className: "src", id: "auto-" + q.id, textContent: igSees ? "Posted it from Instagram yourself? It moves to Posted by itself." : "Instagram isn't answering the app right now, so it can't see what you post there." }),
      el("div", { className: "acts tall" }, go, song, ...(drafts() ? [drafts().editButton(q.jobId)] : []), igSees ? null : postedByHand("queue/" + q.id, "posted-queue-" + q.id), drop));
  }
  const showPostedHead = () => { if (drafts()) drafts().recount(); };      // the count on Drafts (web/drafts.js)
  function renderQueue(queue) {
    $("queue-wrap").hidden = !queue.length;
    $("list-queue").replaceChildren(...queue.map(queueCard));
    showPostedHead();
  }

  // ---------- Finishing a reel in Instagram itself (for its full song library) ----------
  // The reel is handed to the Instagram app through the phone's share menu. The app notes what was handed over,
  // and the server looks for the new reel on the page and links it up, so Posts and Insights still follow it.
  let handing = null;      // { jobId, blob (or null while it is being fetched), about: {...} }
  const handStatus = (msg) => { $("handoff-status").textContent = msg; };
  function handoffCard(h) {
    const look = el("button", { className: "btn ic ic-search", type: "button", textContent: "Look for it now" });
    look.addEventListener("click", async () => {
      look.disabled = true; look.textContent = "Looking…";
      try {
        const r = await send("handoffs/check", "POST", {});
        if (r.linked) loadPosts();
        else { look.textContent = "Not on Instagram yet"; setTimeout(() => { look.disabled = false; look.textContent = "Look for it now"; }, 4000); }
      } catch (e) { look.disabled = false; look.textContent = "Look for it now"; $("posts-note").textContent = friendly(e); }
    });
    const drop = el("button", { className: "btn quiet", type: "button", textContent: "I didn't post it" });
    drop.addEventListener("click", async () => {
      try { renderHandoffs((await send("handoffs/" + h.id, "DELETE")).handoffs); } catch (e) { $("posts-note").textContent = friendly(e); }
    });
    return el("article", { className: "card" }, el("p", { className: "q", textContent: h.quote || "A reel" }), chip("info", "Waiting for you to post it in Instagram"),
      el("p", { className: "src", textContent: `The app keeps looking for it until ${day(h.until)}.` }),
      el("div", { className: "acts tall" }, igSees ? look : null, ...(drafts() ? [drafts().editButton(h.jobId)] : []), igSees ? null : postedByHand("handoffs/" + h.id, "posted-handoff-" + h.id), drop));
  }
  function renderHandoffs(list) {
    $("handoff-wrap").hidden = !list.length;
    $("list-handoffs").replaceChildren(...list.map(handoffCard));
    showPostedHead();
  }
  // A finished reel is fetched once. The one just made is already here (the composer has it); one from the
  // waiting list is fetched the first time it is wanted and kept (the last two), so opening the sheet again is instant.
  const fetchedReels = new Map();        // job id -> promise of the reel
  function reelBlob(jobId) {
    const made = S.currentReel();
    if (made && made.id === jobId && made.blob) return Promise.resolve(made.blob);
    if (!fetchedReels.has(jobId)) {
      const fetching = S.api(`jobs/${jobId}/reel`).then((r) => r.blob());
      fetching.catch(() => { if (fetchedReels.get(jobId) === fetching) fetchedReels.delete(jobId); });   // a failed fetch is tried again next time
      fetchedReels.set(jobId, fetching);
      if (fetchedReels.size > 2) fetchedReels.delete(fetchedReels.keys().next().value);
    }
    return fetchedReels.get(jobId);
  }
  async function openHandoff(fromQueue) {
    const reel = fromQueue ? null : S.currentReel();
    if (!fromQueue && !reel) return;
    const made = fromQueue ? fromQueue.made : reel.made;
    handing = fromQueue
      ? { jobId: fromQueue.jobId, blob: null, about: { quote: fromQueue.quote, author: fromQueue.author, theme: fromQueue.theme, tone: fromQueue.tone, source: fromQueue.source, suggestionId: fromQueue.suggestionId, made } }
      : { jobId: reel.id, blob: reel.blob, about: { quote: S.quoteText(), ...onCanvas, made } };
    // A free track that asks for credit keeps its credit line in the caption here too.
    const credit = (made && made.musicCredit) || "";
    $("handoff-caption").value = credit;
    $("handoff-write").hidden = !S.server.ai;
    $("handoff-copy").hidden = true;
    $("handoff-go").disabled = !handing.blob;
    handStatus(handing.blob ? "" : "Fetching the reel…");
    $("handoff-sheet").hidden = false;
    if (!handing.blob) {
      // A reel from the waiting list is fetched first, so that the tap on the button below can open the share menu at once.
      const mine = handing;
      try {
        const blob = await reelBlob(mine.jobId);
        if (handing !== mine) return;
        mine.blob = blob; $("handoff-go").disabled = false; handStatus("");
      } catch (e) { if (handing === mine) handStatus(friendly(e)); }
    }
  }
  $("handoff-open").addEventListener("click", () => openHandoff(null));
  const closeHandoff = () => { $("handoff-sheet").hidden = true; };
  $("handoff-close").addEventListener("click", closeHandoff);
  $("handoff-sheet").addEventListener("click", (e) => { if (e.target === $("handoff-sheet")) closeHandoff(); });
  $("handoff-write").addEventListener("click", async () => {
    const btn = $("handoff-write");
    btn.disabled = true; btn.textContent = "Writing…";
    try {
      const r = await send("caption", "POST", { quote: handing.about.quote, author: handing.about.author });
      const credit = (handing.about.made && handing.about.made.musicCredit) || "";
      $("handoff-caption").value = [r.caption, r.hashtags.join(" "), credit].filter(Boolean).join("\n\n");
    } catch (e) { handStatus(friendly(e)); }
    finally { btn.disabled = false; btn.textContent = "Write a caption with Nishiii"; }
  });
  const copyCaption = () => {
    const text = $("handoff-caption").value.trim();
    if (!text || !navigator.clipboard) return Promise.resolve(false);
    return navigator.clipboard.writeText(text).then(() => true, () => false);
  };
  $("handoff-copy").addEventListener("click", async () => { handStatus((await copyCaption()) ? "Caption copied." : "The caption couldn't be copied. Press and hold the text above to copy it."); });
  $("handoff-go").addEventListener("click", async () => {
    if (!handing || !handing.blob) return;
    const mine = handing, caption = $("handoff-caption").value.trim();
    const file = new File([mine.blob], "ds-studio-reel.mp4", { type: "video/mp4" });
    const copying = copyCaption();          // started first, and not waited for, so the share menu still opens on this tap
    let shared = false;
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); shared = true; }
      catch (e) { if (e.name === "AbortError") { handStatus("Nothing was shared. Tap the button to try again."); return; } }
    }
    if (!shared) {
      // No share menu here (a computer, or an older phone): save the reel instead, to pick from inside Instagram.
      const a = el("a", { href: URL.createObjectURL(file), download: file.name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }
    const copied = await copying;
    $("handoff-copy").hidden = !caption;
    try {
      await send("handoffs", "POST", { jobId: mine.jobId, caption, ...mine.about });
      const found = S.server.instagram ? "Once it's posted there, it appears in Posts by itself within a few minutes." : "Connect Instagram in Settings so the app can find the post afterwards.";
      handStatus(`${shared ? "Handed over." : "The reel was saved to this device. Open Instagram, start a new reel and pick it."} ${caption ? (copied ? "Your caption is copied, ready to paste. " : "Copy your caption with the button above. ") : ""}${found}`);
      if (!$("view-posts").hidden) loadPosts();
    } catch (e) { handStatus(friendly(e)); }
  });
  function resetQueueButton() { $("queue-add").disabled = false; $("queue-add").textContent = "Post later"; }
  $("queue-add").addEventListener("click", async () => {
    const reel = S.currentReel();
    if (!reel) return;
    const btn = $("queue-add");
    btn.disabled = true;
    try {
      await send("queue", "POST", { jobId: reel.id, quote: S.quoteText(), ...onCanvas, made: reel.made });
      btn.textContent = "Kept in Posts";
    } catch (e) { btn.disabled = false; btn.textContent = friendly(e); }
  });
  $("make-reel").addEventListener("click", resetQueueButton);
  $("again").addEventListener("click", resetQueueButton);

  // Comments on one post: read them, let Nishiii draft a reply, and send it only when she taps.
  $("comments-close").addEventListener("click", () => { $("comments-sheet").hidden = true; });
  $("comments-sheet").addEventListener("click", (e) => { if (e.target === $("comments-sheet")) $("comments-sheet").hidden = true; });
  function commentCard(post, c) {
    const box = el("textarea", { rows: 2, placeholder: "Your reply" });
    box.setAttribute("aria-label", `Reply to ${c.username}`);
    const draft = el("button", { className: "btn", type: "button", textContent: "Draft with Nishiii" });
    const sendIt = el("button", { className: "btn soft", type: "button", textContent: "Send reply" });
    const state = el("p", { className: "who" });
    state.setAttribute("role", "status");
    draft.hidden = !S.server.ai;
    draft.addEventListener("click", async () => {
      draft.disabled = true; draft.textContent = "Writing…";
      try {
        const { reply } = await send(`posts/${post.id}/comments/${c.id}/draft`, "POST", { text: c.text, username: c.username });
        if (reply) { box.value = reply; state.textContent = "A draft. Change anything, then send."; }
        else state.textContent = "Nishiii thinks this one doesn't need a reply.";
      } catch (e) { state.textContent = friendly(e); }
      finally { draft.disabled = false; draft.textContent = "Draft with Nishiii"; }
    });
    sendIt.addEventListener("click", async () => {
      if (!box.value.trim()) { state.textContent = "Write the reply first."; return; }
      sendIt.disabled = true;
      try {
        await send(`posts/${post.id}/comments/${c.id}/reply`, "POST", { message: box.value });
        state.textContent = "Replied on Instagram.";
        box.before(el("p", { className: "theirs", textContent: `You: ${box.value.trim()}` }));
        box.remove(); draft.remove(); sendIt.remove();
      } catch (e) { sendIt.disabled = false; state.textContent = friendly(e); }
    });
    return el("div", { className: "comment" },
      el("p", { className: "who", textContent: `@${c.username || "someone"}${c.likes ? `, ${c.likes} like${c.likes === 1 ? "" : "s"}` : ""}` }),
      el("p", { textContent: c.text }),
      ...c.replies.map((r) => el("p", { className: "theirs", textContent: `${r.mine ? "You" : "@" + r.username}: ${r.text}` })),
      box, state, el("div", { className: "pair" }, draft, sendIt));
  }
  async function openComments(post) {
    $("comments-list").replaceChildren();
    $("comments-note").textContent = "Fetching comments from Instagram…";
    $("comments-sheet").hidden = false;
    try {
      const { comments } = await getJson(`posts/${post.id}/comments`);
      $("comments-list").replaceChildren(...comments.map((c) => commentCard(post, c)));
      $("comments-note").textContent = comments.length ? "Nothing is sent until you tap Send reply." : "No comments on this post yet.";
    } catch (e) { $("comments-note").textContent = friendly(e); }
  }

  async function loadIg() {
    if (!S.server.instagram) { ig = null; return ig; }
    try { ig = await getJson("instagram"); } catch (e) { ig = null; $("ig-status").textContent = friendly(e); }
    return ig;
  }
  // "Checked with Instagram 12 minutes ago": when the list and its numbers were last brought up to date.
  const agoText = (ms) => {
    const mins = Math.floor((Date.now() - ms) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
    const hours = Math.floor(mins / 60);
    return hours < 24 ? `${hours} hour${hours === 1 ? "" : "s"} ago` : `on ${day(ms)}`;
  };
  const clockText = (ms) => {
    const t = new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase();
    return new Date(ms).toDateString() === new Date().toDateString() ? t : `${day(ms)}, ${t}`;
  };
  let postsFresh = null, postsLoading = 0;
  function showPostsFresh() {
    const f = postsFresh, line = $("posts-fresh");
    $("posts-fresh-row").hidden = !f;
    if (!f) return;
    if (f.instagram && !f.instagram.ok) {
      const from = f.checkedAt ? ` These are your posts and numbers from ${clockText(f.checkedAt)}.` : "";
      line.textContent = (f.instagram.paused ? "Meta has paused the app's access to Instagram for now." : "Instagram isn't answering right now.") + from;
    } else line.textContent = `Checked with Instagram ${agoText(f.checkedAt)}.`;
  }
  setInterval(() => { if (!$("view-posts").hidden) showPostsFresh(); }, 30000);
  // force: her Refresh, which asks Instagram again for every card's numbers. quiet: no "Checking…" line,
  // the cards already shown stay until the new ones are ready (and the page does not move).
  async function loadPosts(force = false, quiet = false, round = 0) {
    if (drafts()) drafts().refresh();             // Made, not posted (web/drafts.js), whether or not Instagram is set up
    if (!S.server.instagram) { $("posts-note").textContent = "Posting to Instagram isn't set up yet."; $("list-posts").replaceChildren(); $("posts-fresh-row").hidden = true; return; }
    const mine = ++postsLoading, btn = $("posts-refresh");
    await loadIg();
    if (!quiet && !$("list-posts").children.length) $("posts-note").textContent = "Checking Instagram for the latest…";
    btn.disabled = true; btn.setAttribute("aria-busy", "true"); btn.textContent = "Refreshing…";
    try {
      const r = await getJson("posts" + (force ? "?force=1" : ""), { cache: "no-store" });
      if (mine !== postsLoading) return;
      const y = window.scrollY;
      $("list-posts").replaceChildren(...r.posts.map(postCard));
      window.scrollTo(0, y);
      postsFresh = { checkedAt: r.checkedAt, instagram: r.instagram };
      showPostsFresh();
      getJson("queue").then((q) => { igSees = q.sees !== false; renderQueue(q.queue); }).catch(() => {});
      getJson("handoffs").then((h) => { igSees = h.sees !== false; renderHandoffs(h.handoffs); }).catch(() => {});
      $("posts-note").textContent = !(ig && ig.connected) ? "Instagram isn't connected. Connect it in Settings, at the top right."
        : r.posts.length ? "Posts you delete on Instagram leave this list too." : "Nothing posted from the app yet.";
      // More cards were due than one asking brings in: ask again, quietly.
      if (r.behind > 0 && round < 3) setTimeout(() => { if (!$("view-posts").hidden) loadPosts(false, true, round + 1); }, 400);
    } catch (e) { if (mine === postsLoading) $("posts-note").textContent = friendly(e); }
    finally { if (mine === postsLoading) { btn.disabled = false; btn.removeAttribute("aria-busy"); btn.textContent = "Refresh"; } }
  }
  $("posts-refresh").addEventListener("click", () => loadPosts(true));

  // ---------- Settings: Face ID lock, Instagram connection, signing out ----------
  function renderFaceId(msg) {
    const f = S.faceId, btn = $("faceid-toggle");
    btn.hidden = !f.supported() || !S.server.on;
    btn.textContent = f.on() ? "Turn the lock off on this device" : `Lock the app with ${f.name}`;
    $("faceid-status").textContent = msg || (!f.supported() ? "Face ID isn't available in this browser."
      : f.on() ? `On. You'll be asked for ${f.name} each time you open the app, and again after five minutes away. The passcode still works too.`
      : `Off. This device stays signed in after the passcode. Turn this on to be asked for ${f.name} every time.`);
  }
  $("faceid-toggle").addEventListener("click", async () => {
    const btn = $("faceid-toggle");
    btn.disabled = true;
    try {
      if (S.faceId.on()) { await S.faceId.disable(); renderFaceId(); }
      else { await S.faceId.enable(); renderFaceId(); }
    } catch (e) { renderFaceId(e.name === "NotAllowedError" ? "That was cancelled, so nothing changed." : friendly(e)); }
    finally { btn.disabled = false; }
  });
  async function openSettings(message) {
    $("settings").hidden = false;
    document.dispatchEvent(new CustomEvent("studio:settings"));
    renderFaceId();
    await loadIg();
    renderIg();
    if (message) { $("ig-status").textContent = message; $("ig-status").scrollIntoView({ block: "center" }); }
  }
  $("settings-open").addEventListener("click", () => openSettings());
  $("settings-close").addEventListener("click", () => { $("settings").hidden = true; });
  $("settings").addEventListener("click", (e) => { if (e.target === $("settings")) $("settings").hidden = true; });
  $("sign-out").addEventListener("click", async () => {
    if (!(await confirmDialog({ title: "Sign out on this device?", yes: "Sign out",
      body: "You'll need the passcode the next time you open the app here. Nothing is deleted." }))) return;
    $("settings").hidden = true;
    S.signOut();
  });

  $("ig-connect").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("ig-status").textContent = "Connecting…";
    try { ig = await send("instagram/connect", "POST", { token: $("ig-token").value.trim() }); $("ig-token").value = ""; renderIg(); }
    catch (err) { $("ig-status").textContent = friendly(err); }
  });
  $("ig-disconnect").addEventListener("click", async () => {
    if (!(await confirmDialog({ title: "Disconnect Instagram?", yes: "Disconnect",
      body: "You won't be able to post, see your numbers or search music until Instagram is connected again here. Nothing on Instagram is deleted." }))) return;
    try { ig = await send("instagram", "DELETE"); renderIg(); } catch (err) { $("ig-status").textContent = friendly(err); }
  });

  // ---------- Nishiii: what has been learned about Dhruuu's taste ----------
  let canForget = { profile: false, all: false };
  function renderTaste(t) {
    canForget = t.canForget || canForget;
    const p = t.profile;
    $("taste-card").hidden = !p;
    if (p) {
      $("taste-summary").textContent = p.summary;
      const groups = [["What you're drawn to", p.loves], ["What you pass over", p.avoids], ["Wording you like", p.voice], ["The look you like", p.look], ["What has worked on your page", p.performs]];
      $("taste-lists").replaceChildren(...groups.filter(([, list]) => list && list.length).flatMap(([name, list]) =>
        [el("h3", { textContent: name }), el("ul", {}, ...list.map((x) => el("li", { textContent: x })))]));
      $("taste-note").textContent = `Last updated ${day(t.updatedAt)}, from ${t.evidence} things you've picked, skipped, reworded, saved, posted or added. It updates itself every morning.`;
    } else {
      $("taste-note").textContent = t.evidence
        ? `Nothing written yet. There are ${t.evidence} things to learn from so far: tap Update now.`
        : "Nothing to learn from yet. This fills in as you pick and skip quotes, reword them, post, and add to the Library.";
    }
    $("list-notes").replaceChildren(...(t.notes.length ? t.notes.map((n) => {
      const remove = el("button", { textContent: "Remove" });
      remove.addEventListener("click", async () => { try { renderTaste(await send("taste/notes/" + n.id, "DELETE")); } catch (e) { $("taste-note").textContent = friendly(e); } });
      return el("li", {}, el("p", { className: "main", textContent: n.text }), remove);
    }) : [el("li", {}, el("p", { className: "empty", textContent: "No notes yet." }))]));
  }
  async function loadTaste() {
    if (!S.server.ai) { $("taste-note").textContent = "This isn't switched on yet."; return; }
    try { renderTaste(await getJson("taste")); } catch (e) { $("taste-note").textContent = friendly(e); }
  }
  $("taste-refresh").addEventListener("click", async () => {
    const btn = $("taste-refresh");
    btn.disabled = true; btn.textContent = "Thinking it over…";
    try { renderTaste(await send("taste/refresh", "POST")); } catch (e) { $("taste-note").textContent = friendly(e); }
    finally { btn.disabled = false; btn.textContent = "Update now"; }
  });
  // Forgetting can't be undone, so each asks first in a pop-up.
  async function forget(scope, ask, done) {
    if (!canForget[scope]) {
      $("taste-note").textContent = scope === "profile" ? "There's no profile to forget yet." : "There's nothing to forget: no profile, no notes and no record of picks.";
      $("taste-note").scrollIntoView({ block: "center" });
      return;
    }
    if (!(await confirmDialog(ask))) return;
    try {
      renderTaste(await send("taste?scope=" + scope, "DELETE")); $("taste-note").textContent = done;
      document.dispatchEvent(new CustomEvent("studio:forgot", { detail: scope }));   // "profile" or "all" was just erased
    } catch (e) { $("taste-note").textContent = friendly(e); }
  }
  $("forget-profile").addEventListener("click", () => forget("profile", {
    title: "Forget the profile?",
    body: "What Nishiii has written about your taste will be erased. It gets written again from your activity at the next update. Your notes stay.",
    yes: "Forget the profile",
  }, "The profile was erased. It will be written again from your activity at the next update."));
  $("forget-all").addEventListener("click", () => forget("all", {
    title: "Forget everything?",
    body: "This erases the profile, your notes, and the record of every quote you picked, skipped or reworded. It can't be undone. Your Library, the reels you added and your posts are not touched.",
    yes: "Forget everything",
  }, "Everything Nishiii had learned was erased, along with your notes and the record of picks, skips and rewording."));

  $("add-note").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { renderTaste(await send("taste/notes", "POST", { text: $("note-text").value })); $("note-text").value = ""; }
    catch (err) { $("taste-note").textContent = friendly(err); }
  });

  // ---------- Carousel: pictures collected one at a time, posted together ----------
  const slides = [];      // { blob, url }
  function renderSlides() {
    $("slide-tray").replaceChildren(...slides.map((sl, i) => {
      const remove = el("button", { type: "button", textContent: "×" });
      remove.setAttribute("aria-label", `Remove picture ${i + 1}`);
      remove.addEventListener("click", () => { URL.revokeObjectURL(sl.url); slides.splice(i, 1); renderSlides(); });
      return el("figure", {}, el("img", { src: sl.url, alt: `Carousel picture ${i + 1}` }), el("figcaption", { textContent: String(i + 1) }), remove);
    }));
    $("carousel-post").hidden = slides.length < 2 || !S.server.instagram;
    $("carousel-clear").hidden = !slides.length;
    $("slide-add").disabled = slides.length >= 10;
    $("slide-note").textContent = !slides.length ? "A carousel is one post people swipe through, with 2 to 10 pictures. Add this one, change the words or background, then add the next."
      : slides.length === 1 ? "1 picture added. Change the words or background and add at least one more."
      : `${slides.length} pictures added${slides.length >= 10 ? ", which is the most a carousel can hold" : ""}.`;
  }
  $("slide-add").addEventListener("click", async () => {
    const blob = await S.pictureBlob();
    if (!slides.length) carouselMade = S.madeWith();      // the first picture stands for the carousel in Insights
    slides.push({ blob, url: URL.createObjectURL(blob) });
    renderSlides();
  });
  $("carousel-clear").addEventListener("click", () => { slides.forEach((sl) => URL.revokeObjectURL(sl.url)); slides.length = 0; renderSlides(); });
  $("carousel-post").addEventListener("click", () => openPost("carousel"));

  // ---------- Post to Instagram ----------
  let music = null, posting = false, player = null, postMode = "reel";
  let waiting = null;      // set when posting a reel from the waiting list instead of the one just made
  let carouselMade = null; // what the carousel's first picture was made with
  let postCredit = "";     // the credit line a library track asks for, if the reel being posted has one
  let shownCredit = "";    // the credit line currently sitting in the caption box
  function keepCredit() {
    $("post-credit-note").hidden = !postCredit;
    const box = $("post-caption");
    // A credit left over from a different track is taken out before this reel's own is added.
    if (shownCredit && shownCredit !== postCredit) box.value = box.value.replace(shownCredit, "").trim();
    if (postCredit && !box.value.includes(postCredit)) box.value = [box.value.trim(), postCredit].filter(Boolean).join("\n\n");
    shownCredit = postCredit;
  }
  const postStatus = (msg) => { $("post-status").textContent = msg; };
  function chooseMusic(item) {
    music = item;
    $("music-chosen").hidden = !item;
    if (item) $("music-name").textContent = `Chosen: ${item.title}${item.artist ? ` by ${item.artist}` : ""}`;
  }
  function musicRow(item) {
    const pick = el("button", { type: "button", textContent: "Choose" });
    pick.addEventListener("click", () => chooseMusic(item));
    const kids = [pick];
    if (item.preview) {
      const listen = el("button", { type: "button", textContent: "Listen" });
      listen.addEventListener("click", () => {
        if (player) { player.pause(); const same = player.src === item.preview; player = null; if (same) return; }
        player = new Audio(item.preview); player.play().catch(() => {});
      });
      kids.unshift(listen);
    }
    const mins = `${Math.floor(item.seconds / 60)}:${String(item.seconds % 60).padStart(2, "0")}`;
    return el("li", {}, el("div", {}, el("p", { className: "main", textContent: item.title }),
      el("p", { className: "sub", textContent: [item.artist, mins].filter(Boolean).join(", ") })), el("div", {}, ...kids));
  }
  async function searchMusic() {
    $("music-note").textContent = "Searching…";
    try {
      const { items } = await getJson("instagram/audio?q=" + encodeURIComponent($("music-q").value.trim()));
      $("music-list").replaceChildren(...items.map(musicRow));
      $("music-note").textContent = items.length
        ? "Instagram adds the music when the reel is posted, so you can't hear it on the reel here."
        : "No music found for that. Try other words.";
    } catch (e) { $("music-note").textContent = friendly(e); }
  }
  $("music-form").addEventListener("submit", (e) => { e.preventDefault(); searchMusic(); });
  $("music-clear").addEventListener("click", () => chooseMusic(null));
  $("mvol").addEventListener("input", () => { $("mvol-out").textContent = $("mvol").value; });
  $("vvol").addEventListener("input", () => { $("vvol-out").textContent = $("vvol").value; });

  const closePost = () => { if (player) { player.pause(); player = null; } $("post-sheet").hidden = true; };
  $("post-close").addEventListener("click", closePost);
  $("post-sheet").addEventListener("click", (e) => { if (e.target === $("post-sheet") && !posting) closePost(); });

  async function openPost(mode, fromQueue) {
    if (mode === "reel" && !fromQueue && !S.currentReel()) return;
    if ((fromQueue || null) !== waiting) $("post-caption").value = "";
    waiting = fromQueue || null;
    await loadIg();
    if (!ig || !ig.connected) { openSettings("Connect Instagram here first, then go back to Create to post."); return; }
    postMode = mode;
    chooseMusic(null);
    $("music-list").replaceChildren();
    $("post-title").textContent = mode === "carousel" ? `Post a carousel of ${slides.length}` : "Post to Instagram";
    // A reel that already has music in it doesn't get Instagram's music as well, and a track that asks for
    // credit gets its credit line at the end of the caption.
    const made = mode === "carousel" ? null : waiting ? waiting.made : S.currentReel() && S.currentReel().made;
    const own = !!(made && made.music);
    postCredit = (own && made.musicCredit) || "";
    $("post-own-music").hidden = !own;
    if (own) $("post-own-music").textContent = `This reel already has music in it${made.musicTitle ? `: ${made.musicTitle}` : ""}. Instagram's music is left off so the two don't play over each other.`;
    $("post-music").hidden = mode === "carousel" || own;      // Instagram's music can only be attached to reels here
    keepCredit();
    $("post-form").hidden = false; $("post-link").hidden = true; postStatus("");
    $("post-write").hidden = !S.server.ai;
    $("post-sheet").hidden = false;
  }
  $("post-open").addEventListener("click", () => openPost("reel"));
  $("post-caption").addEventListener("change", keepCredit);      // if the credit line gets edited out, it comes back

  $("post-write").addEventListener("click", async () => {
    const btn = $("post-write");
    btn.disabled = true; btn.textContent = "Writing…";
    try {
      const r = await send("caption", "POST", waiting ? { quote: waiting.quote, author: waiting.author } : { quote: S.quoteText(), author: onCanvas.author });
      $("post-caption").value = [r.caption, r.hashtags.join(" ")].filter(Boolean).join("\n\n");
      keepCredit();
    } catch (e) { postStatus(friendly(e)); }
    finally { btn.disabled = false; btn.textContent = "Write a caption with Nishiii"; }
  });

  $("post-go").addEventListener("click", async () => {
    const reel = waiting ? { id: waiting.jobId } : S.currentReel();
    if (posting || (postMode === "reel" && !reel) || (postMode === "carousel" && slides.length < 2)) return;
    posting = true; $("post-go").disabled = true;
    const sent = waiting ? { author: waiting.author, theme: waiting.theme, tone: waiting.tone, source: waiting.source, suggestionId: waiting.suggestionId } : onCanvas;
    try {
      const about = { caption: $("post-caption").value, quote: waiting ? waiting.quote : S.quoteText(), ...sent,
        made: waiting ? waiting.made : postMode === "carousel" ? carouselMade : reel && reel.made };
      let post;
      if (postMode === "carousel") {
        const ids = [];
        for (let i = 0; i < slides.length; i++) {
          postStatus(`Sending picture ${i + 1} of ${slides.length}…`);
          ids.push((await getJson("slides", { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: slides[i].blob })).id);
        }
        postStatus("Sending the carousel to Instagram…");
        post = await send("posts", "POST", { ...about, slides: ids });
      } else {
        postStatus("Sending the reel to Instagram…");
        post = await send("posts", "POST", { ...about, jobId: reel.id,
          audio: music ? { id: music.id, title: music.title, musicVolume: +$("mvol").value, videoVolume: +$("vvol").value } : null });
      }
      $("post-form").hidden = true;
      postStatus("Instagram is processing it. This usually takes under a minute. You can close the app; it will still post.");
      // Asked every three seconds at first (most reels are through within half a minute), then less often.
      const handedAt = Date.now();
      while (post.state === "processing") {
        const waited = Date.now() - handedAt;
        await new Promise((r) => setTimeout(r, waited < 45000 ? 3000 : waited < 180000 ? 5000 : 10000));
        post = await getJson("posts/" + post.id);
      }
      if (post.state === "failed") throw new Error(post.error || "Instagram didn't accept it.");
      postStatus("Posted to Instagram.");
      $("post-caption").value = ""; shownCredit = "";       // the next post starts with an empty caption
      const from = [...(todayData ? todayData.items : []), ...(askedData ? askedData.items : [])].find((i) => i.id === sent.suggestionId);
      if (waiting) { waiting = null; if (!$("view-posts").hidden) loadPosts(); }
      if (from) from.posted = "posted";
      if (postMode === "carousel") { slides.forEach((sl) => URL.revokeObjectURL(sl.url)); slides.length = 0; renderSlides(); }
      if (post.permalink) { $("post-link").href = post.permalink; $("post-link").hidden = false; }
    } catch (e) { $("post-form").hidden = false; postStatus(friendly(e)); }
    finally { posting = false; $("post-go").disabled = false; }
  });

  // ---------- Chat with Nishiii, in the Nishiii tab: she can fetch quotes, fill Create, and report on posts ----------
  // The tab has two parts, Chat (first) and What Nishiii knows. The conversation is kept on this phone only
  // (CHAT_KEY), so it is still there after the app was closed, until she starts a new chat.
  const CHAT_KEY = "studio.chat.v1", CHAT_KEEP = 40;
  const talk = [];        // the conversation so far, as plain {role, content}
  let chatBusy = false, chatPart = "chat", chatAt = 0, atNewest = true;
  const chatScroll = $("chat-scroll");
  const toNewest = () => { chatScroll.scrollTop = chatScroll.scrollHeight; atNewest = true; };
  chatScroll.addEventListener("scroll", () => {
    if (!chatScroll.offsetParent) return;                     // hidden: the place it had is kept
    chatAt = chatScroll.scrollTop;
    atNewest = chatScroll.scrollHeight - chatScroll.clientHeight - chatScroll.scrollTop < 24;
  }, { passive: true });
  function keepChat() {
    try {
      if (talk.length) localStorage.setItem(CHAT_KEY, JSON.stringify(talk.slice(-CHAT_KEEP)));
      else localStorage.removeItem(CHAT_KEY);
    } catch (e) { /* not kept on this phone: it still lasts while the app is open */ }
  }
  function chatEmpty() {
    const empty = !$("chat-log").children.length;
    $("chat-chips").hidden = !empty || !S.server.ai;
    $("chat-new").hidden = empty || !S.server.ai;
  }
  function chatLine(cls, text) {
    const p = el("p", { className: cls, textContent: text });
    $("chat-log").append(p);
    chatEmpty(); toNewest();
    return p;
  }
  function nishiiiPart(name) {
    chatPart = name;
    $("view-nishiii").dataset.part = name;
    $("nishiii-part-chat").setAttribute("aria-pressed", String(name === "chat"));
    $("nishiii-part-knows").setAttribute("aria-pressed", String(name === "knows"));
    if (name === "chat") { if (atNewest) toNewest(); else chatScroll.scrollTop = chatAt; }   // where it was
  }
  $("nishiii-part-chat").addEventListener("click", () => nishiiiPart("chat"));
  $("nishiii-part-knows").addEventListener("click", () => nishiiiPart("knows"));
  document.addEventListener("studio:view", (e) => { if (e.detail === "nishiii") nishiiiPart(S.server.ai ? chatPart : "knows"); });
  // Going somewhere else in the app from the chat: the keyboard goes away first.
  function leaveChat(view) { if (document.activeElement === $("chat-input")) $("chat-input").blur(); show(view); }
  // Things Nishiii did in the app while answering.
  function applyChatActions(actions) {
    for (const a of actions) {
      if (a.type === "use") {
        onCanvas = { author: a.author || "", theme: "", tone: "", source: "chat", suggestionId: "" };
        S.setQuote(a.text, a.author || "");
        const go = el("button", { className: "btn act ic ic-create", type: "button", textContent: "Open Create" });
        go.addEventListener("click", () => leaveChat("create"));
        $("chat-log").append(go); toNewest();
      } else if (a.type === "open" && VIEWS.includes(a.section)) {
        leaveChat(a.section);
      } else if (a.type === "refresh") {
        if (a.what === "asked") {
          // Quotes Nishiii found in the chat are kept under "Quotes you found" in the Library.
          if (current === "library") loadAsked();
          const go = el("button", { className: "btn act ic ic-quote", type: "button", textContent: "See them in the Library" });
          go.addEventListener("click", () => leaveChat("library"));
          $("chat-log").append(go);
        }
        if (a.what === "taste" && current === "nishiii") loadTaste();
        if (a.what === "library" && current === "library") loadLibrary();
      }
    }
  }
  async function sayToNishiii(text) {
    const mine = text.trim();
    if (!mine || chatBusy) return;
    chatBusy = true; $("chat-send").disabled = true;
    $("chat-input").value = "";
    talk.push({ role: "user", content: mine });
    chatLine("me", mine);
    const waiting = chatLine("her", "Thinking…");
    try {
      const r = await send("chat", "POST", { messages: talk });
      talk.push({ role: "assistant", content: r.reply });
      waiting.textContent = r.reply;
      keepChat();
      applyChatActions(r.actions || []);
    } catch (e) {
      talk.pop();
      waiting.className = "err"; waiting.textContent = friendly(e);
    } finally { chatBusy = false; $("chat-send").disabled = false; if (atNewest) toNewest(); }
  }
  function newChat() {
    talk.length = 0; keepChat();
    $("chat-log").replaceChildren(); chatEmpty();
    chatScroll.scrollTop = 0; atNewest = true;
  }
  $("chat-form").addEventListener("submit", (e) => { e.preventDefault(); sayToNishiii($("chat-input").value); });
  $("chat-chips").addEventListener("click", (e) => { if (e.target.tagName === "BUTTON") sayToNishiii(e.target.textContent); });
  $("chat-new").addEventListener("click", async () => {
    if (chatBusy || !(await confirmDialog({ title: "Start a new chat?", yes: "Start a new chat",
      body: "This conversation is cleared from this phone. What Nishiii knows about you stays." }))) return;
    newChat();
  });
  document.addEventListener("studio:forgot", (e) => { if (e.detail === "all" && !chatBusy) newChat(); });
  function startChat() {
    const on = !!S.server.ai;
    $("chat-off").hidden = on;
    $("chat-intro").hidden = !on; $("chat-form").hidden = !on;
    let kept = [];
    try { kept = JSON.parse(localStorage.getItem(CHAT_KEY) || "[]"); } catch (e) { kept = []; }
    if (on && Array.isArray(kept)) for (const m of kept) {
      if (!m || typeof m.content !== "string" || !m.content) continue;
      talk.push({ role: m.role === "assistant" ? "assistant" : "user", content: m.content });
      chatLine(m.role === "assistant" ? "her" : "me", m.content);
    }
    chatEmpty();
    if (!on) nishiiiPart("knows");
  }

  // While she types to Nishiii with the keyboard open, the app fits the part of the screen the keyboard leaves,
  // so the message box sits just above the keyboard and the header stays in place (the section bar is under the
  // keyboard anyway). Everything else keeps the full height (see --app-h and heal() in index.html).
  function fitChat() {
    const vv = window.visualViewport, root = document.documentElement;
    const full = Math.max(window.innerHeight, parseFloat(root.style.getPropertyValue("--app-h")) || 0);
    const short = !!vv && document.activeElement === $("chat-input") && vv.height < full - 1;
    root.classList.toggle("chat-kb", short);
    if (short) {
      root.style.setProperty("--chat-h", Math.round(vv.height) + "px");
      if (window.scrollY || window.scrollX) window.scrollTo(0, 0);
      const down = Math.max(0, Math.round(vv.offsetTop));       // iOS may still have the view moved down: follow it
      root.style.setProperty("--chat-top", down + "px");
      root.classList.toggle("chat-down", down > 0);
    } else { root.classList.remove("chat-down"); root.style.removeProperty("--chat-h"); root.style.removeProperty("--chat-top"); }
    if (atNewest) toNewest();
  }
  if (window.visualViewport) { window.visualViewport.addEventListener("resize", fitChat); window.visualViewport.addEventListener("scroll", fitChat); }
  window.addEventListener("resize", fitChat);
  $("chat-input").addEventListener("focus", () => { fitChat(); setTimeout(fitChat, 300); });
  $("chat-input").addEventListener("blur", () => setTimeout(fitChat, 0));

  // For web/drafts.js: post or hand over a reel kept in Posts, and where the quote on the canvas came from.
  Object.assign(window.StudioKit, { openPost, openHandoff, show,
    origin: () => ({ ...onCanvas }), setOrigin: (o) => { onCanvas = { author: "", theme: "", tone: "", source: "", suggestionId: "", ...(o || {}) }; } });
  const drafts = () => window.StudioDrafts;      // web/drafts.js, loaded after this file

  // ---------- start: once the composer knows what the server offers ----------
  let started = false;
  document.addEventListener("studio:ready", () => {
    if (started) { if (current === "today") loadToday(true); return; }
    started = true;
    startChat();
    loadLooks();
    show(S.server.ai ? "today" : "create");
  });
})();

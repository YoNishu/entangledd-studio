/* Entangledd Studio: everything around the composer.
   Today's quotes, the Library, rewording with Nishiii, free footage, posting, post history and
   Nishiii's picture of her taste. The composer itself lives in app.js and exposes what this file
   needs as window.Studio. */
(() => {
  "use strict";
  const S = window.Studio;
  const $ = (id) => document.getElementById(id);
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
  window.StudioKit = { el, getJson, friendly, compact, day };

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
  }
  VIEWS.forEach((v) => $("nav-" + v).addEventListener("click", () => show(v)));

  // ---------- Today ----------
  let todayLoaded = false, todayBusy = false, todayData = null;
  let onCanvas = { author: "", theme: "", tone: "", source: "", suggestionId: "" };   // where the quote now on the canvas came from
  const sourceLine = (s) => {
    if (s.type === "own") return s.title ? `Your own collection: ${s.title}` : "Your own collection";
    if (s.type === "book") return `From your book list: ${s.title}`;
    if (s.type === "film") return `From the film ${s.title}`;
    if (s.type === "series") return `From the series ${s.title}`;
    return s.title ? `Well-known line, from ${s.title}` : "Well-known line";
  };

  // What actually happened to a suggestion, so "used" is never mistaken for "posted".
  function fateLine(item) {
    if (item.posted === "posted") return chip("ok", "Posted to Instagram");
    if (item.posted === "deleted") return chip("gone", "Posted earlier, then deleted. Free to use again");
    if (item.state === "used") return chip("wait", "Opened in Create, not posted");
    return null;
  }

  // base is "suggestions" (Today's five) or "asked" (quotes she asked Nishiii for).
  // date is set for a quote from an earlier day, so the server knows which day's list it belongs to.
  function card(item, base = "suggestions", date = "") {
    const use = el("button", { className: "btn primary", textContent: "Use this" });
    const reword = el("button", { className: "btn", textContent: "Reword" });
    const skip = el("button", { className: "btn quiet", textContent: "Skip" });
    const node = el("article", { className: "card" },
      el("p", { className: "q", textContent: item.text }),
      item.author ? el("p", { className: "by", textContent: "— " + item.author }) : null,
      el("p", { className: "src", textContent: sourceLine(item.source) }),
      item.askedFor ? chip("info", `From: ${item.askedFor}`) : null,
      item.fromText ? chip("ok", "Copied word for word from the book's text")
        : item.verify ? chip("bad", "Check the wording and author before posting") : null,
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
      onCanvas = { author: item.author, theme: item.theme, tone: item.tone, source: item.source.type, suggestionId: item.id };
      S.setQuote(item.text, item.author);
      show("create");
    });
    reword.addEventListener("click", () => openReword({
      quote: item.text, author: item.author,
      apply: (quote, altered) => {
        mark("used");
        onCanvas = { author: altered ? "" : item.author, theme: item.theme, tone: item.tone, source: item.source.type, suggestionId: item.id };
        S.setQuote(quote, altered ? "" : item.author); show("create");
      },
    }));
    skip.addEventListener("click", () => {
      mark("rejected"); node.remove();
      if (base === "suggestions" && !date && !$("suggestions").children.length) $("today-note").textContent = "That's all five for today. Want more? Ask in the Nishiii section.";
      if (base === "asked" && !$("asked-list").children.length) askedNote("Nothing here now. Ask for more whenever you like.");
    });
    return node;
  }

  function renderToday(data) {
    todayData = data;
    const d = new Date(data.date + "T12:00:00");
    $("today-weekday").textContent = d.toLocaleDateString(undefined, { weekday: "long" });
    $("today-date").textContent = d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
    $("suggestions").replaceChildren(...data.items.map((i) => card(i)));
    $("today-note").textContent = data.items.length ? "Five quotes Nishiii chose for you today." : "That's all five for today. Want more? Ask in the Nishiii section.";
  }

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

  // ---------- Nishiii: quotes she asks for, kept apart from Today ----------
  let askedData = null;
  function askedNote(msg) { $("asked-note").textContent = msg; $("asked-note").hidden = !msg; }
  function renderAsked(data) {
    askedData = data;
    $("asked-list").replaceChildren(...data.items.map((i) => card(i, "asked")));
    askedNote("");
  }
  async function loadAsked() {
    if (!S.server.ai) return;
    try { renderAsked(await getJson("asked")); } catch (e) { askedNote(friendly(e)); }
  }

  // ---------- the sheet for choosing what to ask about ----------
  const asking = { picked: new Set(), lib: null, insp: null };
  function pickButton(id, label) {
    const b = el("button", { type: "button", textContent: label });
    b.setAttribute("aria-pressed", String(asking.picked.has(id)));
    b.addEventListener("click", () => {
      if (asking.picked.has(id)) asking.picked.delete(id); else asking.picked.add(id);
      b.setAttribute("aria-pressed", String(asking.picked.has(id)));
    });
    return b;
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
  $("ask-open").addEventListener("click", async () => {
    $("ask-status").textContent = "";
    $("ask-sheet").hidden = false;
    try {
      [asking.lib, asking.insp] = await Promise.all([getJson("library"), getJson("inspirations").then((d) => d.items)]);
      renderAsk();
    } catch (e) { $("ask-status").textContent = friendly(e); }
  });
  $("ask-close").addEventListener("click", () => { $("ask-sheet").hidden = true; });
  $("ask-sheet").addEventListener("click", (e) => { if (e.target === $("ask-sheet")) $("ask-sheet").hidden = true; });
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
    } catch (err) { $("ask-status").textContent = friendly(err); }
  });
  $("ask-go").addEventListener("click", async () => {
    const btn = $("ask-go");
    btn.disabled = true; btn.textContent = "Finding quotes…";
    $("ask-status").textContent = "";
    try {
      renderAsked(await send("asked", "POST", { sources: [...asking.picked], about: $("ask-about").value, count: 5 }));
      $("ask-sheet").hidden = true;
      $("view-nishiii").scrollTo({ top: 0 });
    } catch (e) { $("ask-status").textContent = friendly(e); }
    finally { btn.disabled = false; btn.textContent = "Get five quotes"; }
  });

  // ---------- Library: her quotes and books ----------
  function note(msg) { $("library-note").textContent = msg; $("library-note").hidden = !msg; if (msg) $("library-note").scrollIntoView({ block: "nearest" }); }

  function renderLibrary(lib) {
    const row = (kind, item, main, sub, ...extra) => {
      const remove = el("button", { textContent: "Remove" });
      remove.setAttribute("aria-label", `Remove ${main.slice(0, 40)}`);
      remove.addEventListener("click", async () => {
        try { renderLibrary(await send(`library/${kind}/${item.id}`, "DELETE")); } catch (e) { note(friendly(e)); }
      });
      return el("li", {}, el("div", {}, el("p", { className: "main", textContent: main }), sub ? el("p", { className: "sub", textContent: sub }) : null, ...extra), remove);
    };
    const bookRow = (b) => {
      if (b.textUrl) {
        const wrong = el("button", { type: "button", textContent: "Not the right book" });
        wrong.addEventListener("click", async () => {
          try { renderLibrary(await send(`library/books/${b.id}/text`, "POST", { forget: true })); } catch (e) { note(friendly(e)); }
        });
        return row("books", b, b.title, b.author, chip("ok", "Quotes are copied from the book's own text"),
          el("p", { className: "sub", textContent: `Matched to "${b.textTitle}"${b.textAuthor ? ` by ${b.textAuthor}` : ""}.` }), wrong);
      }
      if (b.textChecked) return row("books", b, b.title, b.author, el("p", { className: "sub", textContent: (b.textNote || "").startsWith("Set aside") ? "Quotes come from Nishiii's memory." : "Not free to read online, so quotes come from Nishiii's memory." }));
      const find = el("button", { type: "button", textContent: "Look for its full text" });
      find.addEventListener("click", () => findText(b.id, find));
      return row("books", b, b.title, b.author, find);
    };
    const fill = (id, rows, empty) => $(id).replaceChildren(...(rows.length ? rows : [el("li", {}, el("p", { className: "empty", textContent: empty }))]));
    fill("list-quotes", lib.quotes.slice().reverse().map((q) => row("quotes", q, q.text, [q.author, q.from].filter(Boolean).join(", "))), "No quotes saved yet.");
    fill("list-books", lib.books.map(bookRow), "No books yet.");
    fill("list-screen", (lib.screen || []).map((x) => row("screen", x, x.title, x.kind === "series" ? "Series" : "Film")), "No films or series yet.");
  }

  // Looks the book up among books that are free to read. Old classics usually are; modern books are not.
  async function findText(id, button) {
    if (button) { button.disabled = true; button.textContent = "Looking…"; }
    try { renderLibrary(await send(`library/books/${id}/text`, "POST", {})); }
    catch (e) { if (button) { button.disabled = false; button.textContent = "Look for its full text"; note(friendly(e)); } }
  }

  async function loadLibrary() {
    if (!S.server.on) { note("Your Library isn't available right now."); return; }
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
      renderLibrary(lib);
      $("b-title").value = ""; $("b-author").value = ""; note("");
      const added = lib.books[lib.books.length - 1];
      if (added && !added.textChecked) findText(added.id);     // in the background; the row updates when the answer is in
    } catch (err) { note(friendly(err)); }
  });

  addForm("add-screen", "screen", () => ({ title: $("s-title").value, kind: $("s-kind").value }), () => { $("s-title").value = ""; });

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
    if (item.url) links.append(el("a", { href: item.url, target: "_blank", rel: "noopener", textContent: "Open" }));
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
    const remove = el("button", { type: "button", textContent: "Remove" });
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
      kids.push(el("p", { className: "note", textContent: "This is from Nishiii's memory, not a lookup. Treat it as a strong hint, and look the quote up before posting if it matters." }));
      box.replaceChildren(...kids);
    } catch (e) { box.replaceChildren(el("p", { className: "flag", textContent: friendly(e) })); }
    finally { btn.disabled = false; btn.textContent = "Check who said this"; }
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
        await S.loadBackground(new File([blob], `stock-${item.id}.${video ? "mp4" : "jpg"}`, { type: video ? "video/mp4" : "image/jpeg" }), { from: "search", words: stock.q });
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
  $("stock").addEventListener("click", () => { $("stock-sheet").hidden = false; if (!$("stock-grid").children.length) newSearch(); });
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
      ? `Connected as @${ig.username}${ig.page ? ` through the Facebook Page "${ig.page}"` : ""}. Music search works until ${day(ig.musicUntil)}. After that, connect again here; posting keeps working either way.`
      : "Not connected yet.";
  }

  function postCard(p) {
    const label = { processing: ["info", "Being processed by Instagram"], published: ["ok", "Posted"], failed: ["bad", "Didn't post"] };
    const [kind, words] = label[p.state] || ["gone", p.state];
    const kids = [el("p", { className: "q", textContent: p.quote || p.caption || "Reel" }), chip(kind, words)];
    kids.push(el("p", { className: "src", textContent: `${p.kind === "carousel" ? `Carousel of ${p.slides}` : "Reel"}, ${day(p.published || p.created)}${p.music ? `, music: ${p.music}` : ""}` }));
    if (p.error) kids.push(el("p", { className: "flag", textContent: p.error }));
    const m = p.metrics;
    if (m && Object.keys(m).length) {
      const names = [["reach", "Reach"], ["views", "Views"], ["likes", "Likes"], ["comments", "Comments"], ["saved", "Saves"], ["shares", "Shares"]];
      kids.push(el("dl", { className: "nums" }, ...names.filter(([k]) => m[k] != null).map(([k, name]) => el("div", {}, el("dt", { textContent: name }), el("dd", { textContent: compact(m[k]) })))));
    } else if (p.state === "published") kids.push(el("p", { className: "src", textContent: "Numbers appear a little while after posting." }));
    const links = el("div", { className: "links" });
    if (p.permalink) links.append(el("a", { href: p.permalink, target: "_blank", rel: "noopener", textContent: "Open on Instagram" }));
    if (p.state === "published") {
      const talk = el("button", { type: "button", textContent: "Comments" });
      talk.addEventListener("click", () => openComments(p));
      links.append(talk);
    }
    const remove = el("button", { type: "button", textContent: "Remove from this list" });
    remove.addEventListener("click", async () => {
      try { await send("posts/" + p.id, "DELETE"); loadPosts(); } catch (e) { $("posts-note").textContent = friendly(e); }
    });
    links.append(remove);
    kids.push(links);
    return el("article", { className: "card" }, ...kids);
  }

  // The week at a glance, on top of Posts.
  function renderWeek(w) {
    const card = $("week-card");
    card.hidden = !(w.thisWeek.posts || w.lastWeek.posts);
    if (card.hidden) return;
    const cell = (name, key) => el("div", {}, el("dt", { textContent: name }), el("dd", { textContent: compact(w.thisWeek[key]) }),
      el("small", { textContent: w.lastWeek.posts ? `${compact(w.lastWeek[key])} the week before` : "" }));
    const kids = [el("h2", { textContent: "Your last 7 days" }),
      el("dl", { className: "nums" }, cell("Posts", "posts"), cell("Reach", "reach"), cell("Likes", "likes"), cell("Saves", "saved"), cell("Shares", "shares"), cell("Comments", "comments"))];
    if (w.note) kids.push(el("p", { className: "q", textContent: w.note }));
    if (w.best) kids.push(el("p", { className: "src", textContent: `Went furthest: "${(w.best.quote || "a post").replace(/\s+/g, " ").slice(0, 70)}", reaching ${compact((w.best.metrics || {}).reach || (w.best.metrics || {}).views)}.` }));
    if (w.times.length) kids.push(el("p", { className: "src", textContent: `Best time so far: ${w.times[0].name.toLowerCase()}, about ${compact(w.times[0].reach)} reach a post across ${w.times[0].posts} posts. Next is ${w.times[1].name.toLowerCase()} at ${compact(w.times[1].reach)}.` }));
    else if (w.measured < 6) kids.push(el("p", { className: "src", textContent: `Best times to post show up here after six posts have numbers. So far: ${w.measured}.` }));
    if (w.themes.length) kids.push(el("p", { className: "src", textContent: `Themes that travel furthest: ${w.themes.map((t) => `${t.name} (${compact(t.reach)})`).join(", ")}.` }));
    const more = el("button", { className: "btn quiet", type: "button", textContent: "See everything in Insights" });
    more.addEventListener("click", () => show("insights"));
    kids.push(more);
    card.replaceChildren(...kids);
    $("queue-note").textContent = w.times.length ? `Nothing here posts by itself: each one waits for your tap. Your posts have done best in the ${w.times[0].name.toLowerCase()} so far.` : "Nothing here posts by itself: each one waits for your tap. Finished reels are kept for a week.";
  }

  // Reels made earlier and kept to post later.
  function queueCard(q) {
    const go = el("button", { className: "btn primary", type: "button", textContent: "Post this now" });
    go.addEventListener("click", () => openPost("reel", q));
    const drop = el("button", { className: "btn quiet", type: "button", textContent: "Remove" });
    drop.addEventListener("click", async () => {
      try { renderQueue((await send("queue/" + q.id, "DELETE")).queue); } catch (e) { $("posts-note").textContent = friendly(e); }
    });
    return el("article", { className: "card" }, el("p", { className: "q", textContent: q.quote || "A reel" }), chip("wait", "Made, not posted"),
      el("p", { className: "src", textContent: `Kept until ${day(q.keptUntil)}. After that you'd need to create it again.` }), el("div", { className: "acts" }, go, drop));
  }
  function renderQueue(queue) {
    $("queue-wrap").hidden = !queue.length;
    $("list-queue").replaceChildren(...queue.map(queueCard));
  }
  function resetQueueButton() { $("queue-add").disabled = false; $("queue-add").textContent = "Keep it to post later"; }
  $("queue-add").addEventListener("click", async () => {
    const reel = S.currentReel();
    if (!reel) return;
    const btn = $("queue-add");
    btn.disabled = true;
    try {
      await send("queue", "POST", { jobId: reel.id, quote: S.quoteText(), ...onCanvas, made: reel.made });
      btn.textContent = "Kept. Find it in Posts, under Waiting to be posted.";
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
    const draft = el("button", { className: "btn", type: "button", textContent: "Draft a reply with Nishiii" });
    const sendIt = el("button", { className: "btn primary", type: "button", textContent: "Send reply" });
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
      finally { draft.disabled = false; draft.textContent = "Draft a reply with Nishiii"; }
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
  async function loadPosts() {
    if (!S.server.instagram) { $("posts-note").textContent = "Posting to Instagram isn't set up yet."; $("list-posts").replaceChildren(); return; }
    await loadIg();
    $("posts-note").textContent = "Checking Instagram for the latest numbers…";
    try {
      const { posts } = await getJson("posts");
      $("list-posts").replaceChildren(...posts.map(postCard));
      // After the list, so the week's numbers include what was just refreshed from Instagram.
      getJson("report").then(renderWeek).catch(() => { $("week-card").hidden = true; });
      getJson("queue").then((r) => renderQueue(r.queue)).catch(() => {});
      $("posts-note").textContent = !(ig && ig.connected) ? "Instagram isn't connected. Connect it in Settings, at the top right."
        : posts.length ? "If you delete a post on Instagram, it disappears from here the next time you open Posts." : "Nothing posted from the app yet.";
    } catch (e) { $("posts-note").textContent = friendly(e); }
  }

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
    $("ask-open").hidden = !S.server.ai;
    loadAsked();
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
    try { renderTaste(await send("taste?scope=" + scope, "DELETE")); $("taste-note").textContent = done; }
    catch (e) { $("taste-note").textContent = friendly(e); }
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
    $("post-music").hidden = mode === "carousel";      // Instagram's music can only be attached to reels here
    $("post-form").hidden = false; $("post-link").hidden = true; postStatus("");
    $("post-write").hidden = !S.server.ai;
    $("post-sheet").hidden = false;
  }
  $("post-open").addEventListener("click", () => openPost("reel"));

  $("post-write").addEventListener("click", async () => {
    const btn = $("post-write");
    btn.disabled = true; btn.textContent = "Writing…";
    try {
      const r = await send("caption", "POST", waiting ? { quote: waiting.quote, author: waiting.author } : { quote: S.quoteText(), author: onCanvas.author });
      $("post-caption").value = [r.caption, r.hashtags.join(" ")].filter(Boolean).join("\n\n");
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
      while (post.state === "processing") {
        await new Promise((r) => setTimeout(r, 5000));
        post = await getJson("posts/" + post.id);
      }
      if (post.state === "failed") throw new Error(post.error || "Instagram didn't accept it.");
      postStatus("Posted to Instagram.");
      const from = [...(todayData ? todayData.items : []), ...(askedData ? askedData.items : [])].find((i) => i.id === sent.suggestionId);
      if (waiting) { waiting = null; if (!$("view-posts").hidden) loadPosts(); }
      if (from) from.posted = "posted";
      if (postMode === "carousel") { slides.forEach((sl) => URL.revokeObjectURL(sl.url)); slides.length = 0; renderSlides(); }
      if (post.permalink) { $("post-link").href = post.permalink; $("post-link").hidden = false; }
    } catch (e) { $("post-form").hidden = false; postStatus(friendly(e)); }
    finally { posting = false; $("post-go").disabled = false; }
  });

  // ---------- Chat with Nishiii: she can fetch quotes, fill Create, and report on posts ----------
  const talk = [];        // the conversation so far, as plain {role, content}
  let chatBusy = false;
  function chatLine(cls, text) {
    const p = el("p", { className: cls, textContent: text });
    $("chat-log").append(p);
    p.scrollIntoView({ block: "nearest" });
    return p;
  }
  // Things Nishiii did in the app while answering.
  function applyChatActions(actions) {
    for (const a of actions) {
      if (a.type === "use") {
        onCanvas = { author: a.author || "", theme: "", tone: "", source: "chat", suggestionId: "" };
        S.setQuote(a.text, a.author || "");
        const go = el("button", { className: "btn act", type: "button", textContent: "Open Create" });
        go.addEventListener("click", () => { $("chat").hidden = true; show("create"); });
        $("chat-log").append(go);
      } else if (a.type === "open" && VIEWS.includes(a.section)) {
        $("chat").hidden = true; show(a.section);
      } else if (a.type === "refresh") {
        if (a.what === "asked" && current === "nishiii") loadAsked();
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
    $("chat-intro").hidden = true; $("chat-chips").hidden = true;
    talk.push({ role: "user", content: mine });
    chatLine("me", mine);
    const waiting = chatLine("her", "Thinking…");
    try {
      const r = await send("chat", "POST", { messages: talk });
      talk.push({ role: "assistant", content: r.reply });
      waiting.textContent = r.reply;
      applyChatActions(r.actions || []);
    } catch (e) {
      talk.pop();
      waiting.className = "err"; waiting.textContent = friendly(e);
    } finally { chatBusy = false; $("chat-send").disabled = false; }
  }
  $("chat-open").addEventListener("click", () => { $("chat").hidden = false; $("chat-input").focus(); });
  $("chat-close").addEventListener("click", () => { $("chat").hidden = true; });
  $("chat").addEventListener("click", (e) => { if (e.target === $("chat")) $("chat").hidden = true; });
  $("chat-form").addEventListener("submit", (e) => { e.preventDefault(); sayToNishiii($("chat-input").value); });
  $("chat-chips").addEventListener("click", (e) => { if (e.target.tagName === "BUTTON") sayToNishiii(e.target.textContent); });

  // ---------- start: once the composer knows what the server offers ----------
  let started = false;
  document.addEventListener("studio:ready", () => {
    if (started) { if (current === "today") loadToday(true); return; }
    started = true;
    $("chat-open").hidden = !S.server.ai;
    loadLooks();
    show(S.server.ai ? "today" : "create");
  });
})();

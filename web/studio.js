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
  const friendly = (e) => (e.message === "Failed to fetch" ? "No connection. Check the internet and try again." : e.message);
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

  // ---------- moving between the five sections ----------
  const VIEWS = ["today", "create", "library", "posts", "nishiii"];
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
  function card(item, base = "suggestions") {
    const use = el("button", { className: "btn primary", textContent: "Use this" });
    const reword = el("button", { className: "btn", textContent: "Reword" });
    const skip = el("button", { className: "btn quiet", textContent: "Skip" });
    const node = el("article", { className: "card" },
      el("p", { className: "q", textContent: item.text }),
      item.author ? el("p", { className: "by", textContent: "— " + item.author }) : null,
      el("p", { className: "src", textContent: sourceLine(item.source) }),
      item.askedFor ? chip("info", `From: ${item.askedFor}`) : null,
      item.verify ? chip("bad", "Check the wording and author before posting") : null,
      fateLine(item),
      el("div", { className: "acts" }, use, reword, skip));

    const mark = (action) => {
      item.state = action;
      const data = base === "asked" ? askedData : todayData;
      if (action === "rejected" && data) data.items = data.items.filter((i) => i.id !== item.id);
      return send(`${base}/${item.id}/feedback`, "POST", { action }).catch(() => {});
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
      if (base === "suggestions" && !$("suggestions").children.length) $("today-note").textContent = "That's all five for today. For more, ask Nishiii in the Nishiii section.";
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
    $("today-note").textContent = data.items.length ? "Five quotes Nishiii chose for you today." : "That's all five for today. For more, ask Nishiii in the Nishiii section.";
  }

  async function loadToday(force) {
    if (!S.server.ai) {
      $("today-note").textContent = "Daily quotes switch on once Nishiii is connected on the server. You can still write your own text in Create.";
      return;
    }
    if (todayBusy) return;
    if (todayLoaded && !force) renderToday(todayData);   // show what we have at once, then refresh quietly
    todayBusy = true;
    if (!todayLoaded) $("today-note").textContent = "Nishiii is choosing today's quotes. This can take half a minute…";
    try { renderToday(await getJson("suggestions")); todayLoaded = true; }
    catch (e) { $("today-note").textContent = friendly(e); }
    finally { todayBusy = false; }
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
    finally { btn.disabled = false; btn.textContent = "Get 5 quotes"; }
  });

  // ---------- Library: her quotes and books ----------
  function note(msg) { $("library-note").textContent = msg; $("library-note").hidden = !msg; if (msg) $("library-note").scrollIntoView({ block: "nearest" }); }

  function renderLibrary(lib) {
    const row = (kind, item, main, sub) => {
      const remove = el("button", { textContent: "Remove" });
      remove.setAttribute("aria-label", `Remove ${main.slice(0, 40)}`);
      remove.addEventListener("click", async () => {
        try { renderLibrary(await send(`library/${kind}/${item.id}`, "DELETE")); } catch (e) { note(friendly(e)); }
      });
      return el("li", {}, el("div", {}, el("p", { className: "main", textContent: main }), sub ? el("p", { className: "sub", textContent: sub }) : null), remove);
    };
    const fill = (id, rows, empty) => $(id).replaceChildren(...(rows.length ? rows : [el("li", {}, el("p", { className: "empty", textContent: empty }))]));
    fill("list-quotes", lib.quotes.slice().reverse().map((q) => row("quotes", q, q.text, [q.author, q.from].filter(Boolean).join(", "))), "No quotes saved yet.");
    fill("list-books", lib.books.map((b) => row("books", b, b.title, b.author)), "No books yet.");
    fill("list-screen", (lib.screen || []).map((x) => row("screen", x, x.title, x.kind === "series" ? "Series" : "Film")), "No films or series yet.");
  }

  async function loadLibrary() {
    if (!S.server.on) { note("The library needs the app's server, which this copy isn't connected to."); return; }
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
  addForm("add-book", "books", () => ({ title: $("b-title").value, author: $("b-author").value }),
    () => { $("b-title").value = ""; $("b-author").value = ""; });

  addForm("add-screen", "screen", () => ({ title: $("s-title").value, kind: $("s-kind").value }), () => { $("s-title").value = ""; });

  // Scan: let Claude read a photographed page, then she picks which lines to keep.
  $("scan").addEventListener("change", async () => {
    const file = $("scan").files[0];
    $("scan").value = "";
    if (!file) return;
    if (!S.server.ai) { note("Scanning switches on once Nishiii is connected on the server."); return; }
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
    if (!S.server.ai) { inspNote("Reading screenshots switches on once Nishiii is connected on the server."); return; }
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

  // ---------- Free footage ----------
  const stock = { kind: "video", q: "", page: 1 };
  const status = (msg) => { $("stock-status").textContent = msg; };

  function thumb(item) {
    const b = el("button", { type: "button" },
      el("img", { src: item.thumb, alt: `${item.kind === "video" ? "Video" : "Photo"} by ${item.credit || "a contributor"}`, loading: "lazy" }),
      el("span", { textContent: [item.seconds ? item.seconds + " s" : "", item.credit].filter(Boolean).join(", ") }));
    b.addEventListener("click", async () => {
      if (b.getAttribute("aria-busy") === "true") return;
      b.setAttribute("aria-busy", "true");
      status(item.kind === "video" ? "Fetching the video. Large clips take a little while…" : "Fetching the photo…");
      try {
        const blob = await (await S.api("stock/file?url=" + encodeURIComponent(item.file))).blob();
        const video = item.kind === "video";
        await S.loadBackground(new File([blob], `stock-${item.id}.${video ? "mp4" : "jpg"}`, { type: video ? "video/mp4" : "image/jpeg" }));
        $("stock-sheet").hidden = true;
        status("");
      } catch (e) { status(friendly(e)); }
      finally { b.removeAttribute("aria-busy"); }
    });
    return b;
  }

  async function search(append) {
    status("Searching…");
    try {
      const data = await getJson(`stock?kind=${stock.kind}&page=${stock.page}&q=${encodeURIComponent(stock.q)}`);
      const nodes = data.items.map(thumb);
      if (append) $("stock-grid").append(...nodes); else $("stock-grid").replaceChildren(...nodes);
      $("stock-more").hidden = !data.more;
      if (data.provider) {
        $("stock-provider").textContent = data.provider.name; $("stock-provider").href = data.provider.url;
        $("stock-credit").hidden = false;
      }
      status(data.items.length || append ? "" : "Nothing found. Try different words.");
    } catch (e) { status(friendly(e)); }
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
    if (!S.server.instagram) { $("ig-status").textContent = "Posting switches on once the Meta app's ID and secret are added on the server."; $("ig-connect").hidden = true; return; }
    $("ig-status").textContent = on
      ? `Connected as @${ig.username}${ig.page ? ` through the Facebook Page "${ig.page}"` : ""}. Music search works until ${day(ig.musicUntil)}; after that, connect again. Posting keeps working.`
      : "Not connected yet.";
  }

  function postCard(p) {
    const label = { processing: ["info", "Being processed by Instagram"], published: ["ok", "Posted"], failed: ["bad", "Didn't post"] };
    const [kind, words] = label[p.state] || ["gone", p.state];
    const kids = [el("p", { className: "q", textContent: p.quote || p.caption || "Reel" }), chip(kind, words)];
    kids.push(el("p", { className: "src", textContent: `${day(p.published || p.created)}${p.music ? `, music: ${p.music}` : ""}` }));
    if (p.error) kids.push(el("p", { className: "flag", textContent: p.error }));
    const m = p.metrics;
    if (m && Object.keys(m).length) {
      const names = [["reach", "Reach"], ["views", "Views"], ["likes", "Likes"], ["comments", "Comments"], ["saved", "Saves"], ["shares", "Shares"]];
      kids.push(el("dl", { className: "nums" }, ...names.filter(([k]) => m[k] != null).map(([k, name]) => el("div", {}, el("dt", { textContent: name }), el("dd", { textContent: compact(m[k]) })))));
    } else if (p.state === "published") kids.push(el("p", { className: "src", textContent: "Numbers appear a little while after posting." }));
    const links = el("div", { className: "links" });
    if (p.permalink) links.append(el("a", { href: p.permalink, target: "_blank", rel: "noopener", textContent: "Open on Instagram" }));
    const remove = el("button", { type: "button", textContent: "Remove from this list" });
    remove.addEventListener("click", async () => {
      try { await send("posts/" + p.id, "DELETE"); loadPosts(); } catch (e) { $("posts-note").textContent = friendly(e); }
    });
    links.append(remove);
    kids.push(links);
    return el("article", { className: "card" }, ...kids);
  }

  async function loadIg() {
    if (!S.server.instagram) { ig = null; return ig; }
    try { ig = await getJson("instagram"); } catch (e) { ig = null; $("ig-status").textContent = friendly(e); }
    return ig;
  }
  async function loadPosts() {
    if (!S.server.instagram) { $("posts-note").textContent = "Posting switches on once Instagram is set up on the server."; $("list-posts").replaceChildren(); return; }
    await loadIg();
    $("posts-note").textContent = "Checking Instagram for the latest numbers…";
    try {
      const { posts } = await getJson("posts");
      $("list-posts").replaceChildren(...posts.map(postCard));
      $("posts-note").textContent = !(ig && ig.connected) ? "Instagram isn't connected. Connect it in Settings, at the top right."
        : posts.length ? "Posts you delete on Instagram disappear from here the next time this opens." : "Nothing posted from the app yet.";
    } catch (e) { $("posts-note").textContent = friendly(e); }
  }

  // ---------- Settings: Face ID lock, Instagram connection, signing out ----------
  function renderFaceId(msg) {
    const f = S.faceId, btn = $("faceid-toggle");
    btn.hidden = !f.supported() || !S.server.on;
    btn.textContent = f.on() ? "Turn the lock off on this device" : `Lock the app with ${f.name}`;
    $("faceid-status").textContent = msg || (!f.supported() ? "This browser can't use Face ID for websites."
      : f.on() ? `On. The app asks for ${f.name} each time it is opened, and again after five minutes away. The passcode still works as a fallback.`
      : `Off. The passcode was asked once and this device stays signed in. Turn this on to ask for ${f.name} every time.`);
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
      body: "The app will ask for the passcode the next time it is opened here. Nothing is deleted." }))) return;
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
      body: "The app will stop being able to post, read numbers or search music until you paste a new token here. Nothing on Instagram is deleted." }))) return;
    try { ig = await send("instagram", "DELETE"); renderIg(); } catch (err) { $("ig-status").textContent = friendly(err); }
  });

  // ---------- Nishiii: her picture of what Dhruuu likes ----------
  let canForget = { profile: false, all: false };
  function renderTaste(t) {
    canForget = t.canForget || canForget;
    const p = t.profile;
    $("taste-card").hidden = !p;
    if (p) {
      $("taste-summary").textContent = p.summary;
      const groups = [["Drawn to", p.loves], ["Passes over", p.avoids], ["Wording", p.voice], ["Look", p.look], ["What has worked on your page", p.performs]];
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
    if (!S.server.ai) { $("taste-note").textContent = "This switches on once Nishiii is connected on the server."; return; }
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

  // ---------- Post to Instagram ----------
  let music = null, posting = false, player = null;
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
        ? "Music is added by Instagram when the reel is posted, so it can't be previewed on the reel here."
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

  $("post-open").addEventListener("click", async () => {
    if (!S.currentReel()) return;
    await loadIg();
    if (!ig || !ig.connected) { openSettings("Connect Instagram here first, then go back to Create to post the reel."); return; }
    chooseMusic(null);
    $("music-list").replaceChildren();
    $("post-form").hidden = false; $("post-link").hidden = true; postStatus("");
    $("post-write").hidden = !S.server.ai;
    $("post-sheet").hidden = false;
  });

  $("post-write").addEventListener("click", async () => {
    const btn = $("post-write");
    btn.disabled = true; btn.textContent = "Writing…";
    try {
      const r = await send("caption", "POST", { quote: S.quoteText(), author: onCanvas.author });
      $("post-caption").value = [r.caption, r.hashtags.join(" ")].filter(Boolean).join("\n\n");
    } catch (e) { postStatus(friendly(e)); }
    finally { btn.disabled = false; btn.textContent = "Write a caption with Nishiii"; }
  });

  $("post-go").addEventListener("click", async () => {
    const reel = S.currentReel();
    if (!reel || posting) return;
    posting = true; $("post-go").disabled = true;
    postStatus("Sending the reel to Instagram…");
    try {
      let post = await send("posts", "POST", {
        jobId: reel.id, caption: $("post-caption").value, quote: S.quoteText(), ...onCanvas,
        audio: music ? { id: music.id, title: music.title, musicVolume: +$("mvol").value, videoVolume: +$("vvol").value } : null,
      });
      $("post-form").hidden = true;
      postStatus("Instagram is processing the video. This usually takes under a minute. You can close the app; it will still post.");
      while (post.state === "processing") {
        await new Promise((r) => setTimeout(r, 5000));
        post = await getJson("posts/" + post.id);
      }
      if (post.state === "failed") throw new Error(post.error || "Instagram didn't accept the reel.");
      postStatus("Posted to Instagram.");
      const from = [...(todayData ? todayData.items : []), ...(askedData ? askedData.items : [])].find((i) => i.id === onCanvas.suggestionId);
      if (from) from.posted = "posted";
      if (post.permalink) { $("post-link").href = post.permalink; $("post-link").hidden = false; }
    } catch (e) { $("post-form").hidden = false; postStatus(friendly(e)); }
    finally { posting = false; $("post-go").disabled = false; }
  });

  // ---------- start: once the composer knows what the server offers ----------
  let started = false;
  document.addEventListener("studio:ready", () => {
    if (started) { if (current === "today") loadToday(true); return; }
    started = true;
    show(S.server.ai ? "today" : "create");
  });
})();

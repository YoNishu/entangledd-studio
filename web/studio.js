/* Entangledd Studio: Today's quotes, the Library, rewording with Nishiii, and free footage.
   The composer itself lives in app.js and exposes what this file needs as window.Studio. */
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

  // ---------- moving between Today, Create and Library ----------
  const VIEWS = ["today", "create", "library"];
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
  }
  VIEWS.forEach((v) => $("nav-" + v).addEventListener("click", () => show(v)));

  // ---------- Today ----------
  let todayLoaded = false, todayBusy = false, todayData = null;
  const sourceLine = (s) => {
    if (s.type === "own") return s.title ? `Your own collection: ${s.title}` : "Your own collection";
    if (s.type === "book") return `From your book list: ${s.title}`;
    return s.title ? `Well-known line, from ${s.title}` : "Well-known line";
  };

  function card(item) {
    const use = el("button", { className: "btn primary", textContent: "Use this" });
    const reword = el("button", { className: "btn", textContent: "Reword" });
    const skip = el("button", { className: "btn quiet", textContent: "Skip" });
    const usedNote = item.state === "used" ? el("p", { className: "used", textContent: "Already used today" }) : null;
    const node = el("article", { className: "card" },
      el("p", { className: "q", textContent: item.text }),
      item.author ? el("p", { className: "by", textContent: "— " + item.author }) : null,
      el("p", { className: "src", textContent: sourceLine(item.source) }),
      item.verify ? el("p", { className: "flag", textContent: "Check the wording and author before posting" }) : null,
      usedNote,
      el("div", { className: "acts" }, use, reword, skip));

    const mark = (action) => {
      item.state = action;
      if (action === "rejected" && todayData) todayData.items = todayData.items.filter((i) => i.id !== item.id);
      return send(`suggestions/${item.id}/feedback`, "POST", { action }).catch(() => {});
    };
    use.addEventListener("click", () => {
      mark("used");
      S.setQuote(item.text, item.author);
      show("create");
    });
    reword.addEventListener("click", () => openReword({
      quote: item.text, author: item.author,
      apply: (quote, altered) => { mark("used"); S.setQuote(quote, altered ? "" : item.author); show("create"); },
    }));
    skip.addEventListener("click", () => { mark("rejected"); node.remove(); if (!$("suggestions").children.length) $("today-note").textContent = "Nothing left for today. Ask for more below."; });
    return node;
  }

  function renderToday(data) {
    todayData = data;
    $("suggestions").replaceChildren(...data.items.map(card));
    $("today-note").textContent = data.items.length ? "" : "No quotes yet for today. Ask for some below.";
    $("more").hidden = false;
  }

  async function loadToday(force) {
    if (!S.server.ai) {
      $("today-note").textContent = "Daily quotes switch on once Nishiii is connected on the server. You can still write your own text in Create.";
      return;
    }
    if (todayBusy) return;
    if (todayLoaded && !force) { renderToday(todayData); return; }
    todayBusy = true;
    if (!todayLoaded) $("today-note").textContent = "Nishiii is choosing today's quotes. This can take half a minute…";
    try { renderToday(await getJson("suggestions")); todayLoaded = true; }
    catch (e) { $("today-note").textContent = friendly(e); }
    finally { todayBusy = false; }
  }

  $("more").addEventListener("click", async () => {
    const btn = $("more");
    btn.disabled = true; btn.textContent = "Choosing more…";
    try { renderToday(await send("suggestions/more", "POST")); }
    catch (e) { $("today-note").textContent = friendly(e); }
    finally { btn.disabled = false; btn.textContent = "Suggest more"; }
  });

  // ---------- Library ----------
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
    fill("list-quotes", lib.quotes.slice().reverse().map((q) => row("quotes", q, q.text, [q.author, q.from].filter(Boolean).join(" · "))), "No quotes saved yet.");
    fill("list-books", lib.books.map((b) => row("books", b, b.title, b.author)), "No books yet.");
    fill("list-accounts", lib.accounts.map((a) => row("accounts", a, "@" + a.handle, "")), "No accounts yet.");
  }

  async function loadLibrary() {
    if (!S.server.on) { note("The library needs the app's server, which this copy isn't connected to."); return; }
    try { renderLibrary(await getJson("library")); note(""); } catch (e) { note(friendly(e)); }
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
  addForm("add-account", "accounts", () => ({ handle: $("a-handle").value }), () => { $("a-handle").value = ""; });

  // Scan: shrink the photo on the phone, let Claude read it, then she picks which lines to keep.
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
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That photo couldn't be opened.")); };
      img.src = url;
    });
  }
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

  // ---------- Reword with Nishiii ----------
  let session = null;   // { original, author, quote, altered, messages, apply }
  function openReword({ quote, author, apply }) {
    session = { original: quote, author: author || "", quote, altered: false, messages: [], apply };
    $("reword-quote").textContent = quote;
    $("reword-flag").hidden = true;
    $("reword-log").replaceChildren();
    $("reword-input").value = "";
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
      el("img", { src: item.thumb, alt: `${item.kind === "video" ? "Video" : "Photo"} by ${item.credit || "a Pexels creator"}`, loading: "lazy" }),
      el("span", { textContent: (item.seconds ? item.seconds + " s · " : "") + (item.credit || "Pexels") }));
    b.addEventListener("click", async () => {
      if (b.getAttribute("aria-busy") === "true") return;
      b.setAttribute("aria-busy", "true");
      status(item.kind === "video" ? "Fetching the video. Large clips take a little while…" : "Fetching the photo…");
      try {
        const blob = await (await S.api("stock/file?url=" + encodeURIComponent(item.file))).blob();
        const video = item.kind === "video";
        await S.loadBackground(new File([blob], `pexels-${item.id}.${video ? "mp4" : "jpg"}`, { type: video ? "video/mp4" : "image/jpeg" }));
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

  // ---------- start: once the composer knows what the server offers ----------
  let started = false;
  document.addEventListener("studio:ready", () => {
    if (started) { if (current === "today") loadToday(true); return; }
    started = true;
    show(S.server.ai ? "today" : "create");
  });
})();

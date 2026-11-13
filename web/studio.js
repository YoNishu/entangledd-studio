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
    return s.title ? `Well-known line, from ${s.title}` : "Well-known line";
  };

  // What actually happened to a suggestion, so "used" is never mistaken for "posted".
  function fateLine(item) {
    if (item.posted === "posted") return el("p", { className: "used", textContent: "Posted to Instagram" });
    if (item.posted === "deleted") return el("p", { className: "src", textContent: "Posted earlier, then deleted on Instagram. Free to use again." });
    if (item.state === "used") return el("p", { className: "src", textContent: "Opened in Create, not posted" });
    return null;
  }

  function card(item) {
    const use = el("button", { className: "btn primary", textContent: "Use this" });
    const reword = el("button", { className: "btn", textContent: "Reword" });
    const skip = el("button", { className: "btn quiet", textContent: "Skip" });
    const node = el("article", { className: "card" },
      el("p", { className: "q", textContent: item.text }),
      item.author ? el("p", { className: "by", textContent: "— " + item.author }) : null,
      el("p", { className: "src", textContent: sourceLine(item.source) }),
      item.verify ? el("p", { className: "flag", textContent: "Check the wording and author before posting" }) : null,
      fateLine(item),
      el("div", { className: "acts" }, use, reword, skip));

    const mark = (action) => {
      item.state = action;
      if (action === "rejected" && todayData) todayData.items = todayData.items.filter((i) => i.id !== item.id);
      return send(`suggestions/${item.id}/feedback`, "POST", { action }).catch(() => {});
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
      if (!$("suggestions").children.length) $("today-note").textContent = "Nothing left for today. Ask for more below.";
    });
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
    if (todayLoaded && !force) renderToday(todayData);   // show what we have at once, then refresh quietly
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
    const label = { processing: "Being processed by Instagram", published: "Posted", failed: "Didn't post" };
    const kids = [el("p", { className: "q", textContent: p.quote || p.caption || "Reel" })];
    kids.push(el("p", { className: p.state === "failed" ? "flag" : "used",
      textContent: `${label[p.state] || p.state}, ${day(p.published || p.created)}${p.music ? `, music: ${p.music}` : ""}${p.error ? `. ${p.error}` : ""}` }));
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
    await loadIg();
    renderIg();
    if (!S.server.instagram) { $("posts-note").textContent = ""; $("list-posts").replaceChildren(); return; }
    $("posts-note").textContent = "Checking Instagram for the latest numbers…";
    try {
      const { posts } = await getJson("posts");
      $("list-posts").replaceChildren(...posts.map(postCard));
      $("posts-note").textContent = posts.length ? "Posts you delete on Instagram disappear from here the next time this opens." : "Nothing posted from the app yet.";
    } catch (e) { $("posts-note").textContent = friendly(e); }
  }
  $("ig-connect").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("ig-status").textContent = "Connecting…";
    try { ig = await send("instagram/connect", "POST", { token: $("ig-token").value.trim() }); $("ig-token").value = ""; renderIg(); }
    catch (err) { $("ig-status").textContent = friendly(err); }
  });
  $("ig-disconnect").addEventListener("click", async () => {
    try { ig = await send("instagram", "DELETE"); renderIg(); } catch (err) { $("ig-status").textContent = friendly(err); }
  });

  // ---------- Nishiii: her picture of what Dhruuu likes ----------
  function renderTaste(t) {
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
    if (!S.server.ai) { $("taste-note").textContent = "This switches on once Nishiii is connected on the server."; return; }
    try { renderTaste(await getJson("taste")); } catch (e) { $("taste-note").textContent = friendly(e); }
  }
  $("taste-refresh").addEventListener("click", async () => {
    const btn = $("taste-refresh");
    btn.disabled = true; btn.textContent = "Thinking it over…";
    try { renderTaste(await send("taste/refresh", "POST")); } catch (e) { $("taste-note").textContent = friendly(e); }
    finally { btn.disabled = false; btn.textContent = "Update now"; }
  });
  // Forgetting asks for a second tap, since it can't be undone.
  function forgetButton(id, scope, label, done) {
    const btn = $(id);
    let armed = null;
    const reset = () => { clearTimeout(armed); armed = null; btn.textContent = label; };
    btn.addEventListener("click", async () => {
      if (!armed) { btn.textContent = "Tap again to confirm"; armed = setTimeout(reset, 5000); return; }
      reset();
      try { renderTaste(await send("taste?scope=" + scope, "DELETE")); $("taste-note").textContent = done; }
      catch (e) { $("taste-note").textContent = friendly(e); }
    });
  }
  forgetButton("forget-profile", "profile", "Forget the profile", "The profile was erased. It will be written again from your activity at the next update.");
  forgetButton("forget-all", "all", "Forget everything and start fresh", "Everything Nishiii had learned was erased, along with your notes and the record of picks, skips and rewording.");

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
    if (!ig || !ig.connected) { show("posts"); $("ig-status").textContent = "Connect Instagram here first, then go back to Create to post the reel."; $("ig-status").scrollIntoView({ block: "center" }); return; }
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
      const from = todayData && todayData.items.find((i) => i.id === onCanvas.suggestionId);
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

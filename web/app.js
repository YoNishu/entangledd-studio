/* Entangledd Studio composer.
   Everything is drawn on one 1080x1920 canvas, so what she sees is what gets saved. */
(() => {
  "use strict";
  const W = 1080;
  let H = 1920;     // 1920 for a reel (9:16), 1350 for a post or carousel picture (4:5)
  const $ = (id) => document.getElementById(id);
  const canvas = $("canvas");
  const ctx = canvas.getContext("2d");

  const FONTS = [
    { id: "lora", label: "Lora", css: (s) => `500 ${s}px "Lora"` },
    { id: "lora-italic", label: "Lora italic", css: (s) => `italic 500 ${s}px "Lora"` },
    { id: "poppins-light", label: "Poppins light", css: (s) => `300 ${s}px "Poppins"` },
    { id: "poppins", label: "Poppins", css: (s) => `400 ${s}px "Poppins"` },
    { id: "poppins-light-italic", label: "Poppins light italic", css: (s) => `italic 300 ${s}px "Poppins"` },
    { id: "poppins-italic", label: "Poppins italic", css: (s) => `italic 400 ${s}px "Poppins"` },
    // Fetched in the background after the app opens, so they don't slow the first screen.
    { id: "crimson", label: "Crimson, a book serif", extra: true, css: (s) => `400 ${s}px "Crimson Pro"` },
    { id: "crimson-italic", label: "Crimson italic", extra: true, css: (s) => `italic 400 ${s}px "Crimson Pro"` },
    { id: "baskerville", label: "Baskerville, classic", extra: true, css: (s) => `400 ${s}px "Libre Baskerville"` },
    { id: "young", label: "Young Serif, bold and warm", extra: true, css: (s) => `400 ${s}px "Young Serif"` },
    { id: "italiana", label: "Italiana, fine and tall", extra: true, css: (s) => `400 ${s}px "Italiana"` },
    { id: "poiret", label: "Poiret, thin and round", extra: true, css: (s) => `400 ${s}px "Poiret One"` },
    { id: "hand", label: "Handwritten", extra: true, css: (s) => `400 ${s}px "Nothing You Could Do"` },
    { id: "typewriter", label: "Typewriter", extra: true, css: (s) => `400 ${s}px "DM Mono"` },
  ];
  const COLOURS = [
    { name: "Cream", hex: "#F3E9D2" },
    { name: "White", hex: "#FFFFFF" },
    { name: "Sea glass", hex: "#BFE6DA" },
    { name: "Ink", hex: "#14202A" },
  ];
  // Each style is a starting point; every value stays editable afterwards.
  const STYLES = {
    sea: {
      label: "Sea", hint: "Cream serif",
      block: { font: "lora", size: 44, colour: "#F3E9D2", align: "center", width: 0.56, lh: 1.2, lower: false },
      place: () => ({ x: 0.5, y: 0.5 }), split: false,
      preview: { font: '500 14px "Lora"', colour: "#F3E9D2", bg: "linear-gradient(160deg,#0f2c38,#1d4a57)", text: "the sea keeps\nno calendar" },
    },
    horizon: {
      label: "Horizon", hint: "Small, lowercase",
      block: { font: "lora", size: 28, colour: "#FFFFFF", align: "center", width: 0.66, lh: 1.32, lower: true },
      place: () => ({ x: 0.5, y: 0.52 }), split: false,
      preview: { font: '400 10.5px "Lora"', colour: "#FFFFFF", bg: "linear-gradient(180deg,#6a7fa0,#d9a26b 70%,#3c4a3a)", text: "right where you\nare meant to be" },
    },
    whisper: {
      label: "Whisper", hint: "Italic, staggered",
      block: { font: "poppins-light-italic", size: 27, colour: "#FFFFFF", align: "left", width: 0.6, lh: 1.3, lower: true },
      place: (i) => ({ x: 0.36 + 0.07 * i, y: 0.66 + 0.03 * i }), split: true,
      preview: { font: 'italic 300 9px "Poppins"', colour: "#FFFFFF", bg: "linear-gradient(180deg,#4a63ad,#6f86c4)", text: "what did you learn?\n   that it was enough" },
    },
  };

  const state = {
    bg: null,            // { kind: "image" | "video", el, url, name }
    blocks: [],
    selected: null,      // block id
    shadow: true,
    fade: false,
    mute: true,
    music: null,         // { file, url, el, ext, duration, start, volume, from: "own" | "library", title, artist, licence, credit }
    length: 8,
    style: "sea",
    author: "",          // the author of the quote on the canvas, if it came with one
    shape: "reel",       // "reel" (9:16) or "post" (4:5, for single pictures and carousels)
    draftId: "",         // this piece of work, kept as a draft on the server (web/drafts.js)
    of: "",              // the made reel it is an edit of, if any: making it again replaces that one
  };
  let nextId = 1;

  function newBlock(text, styleKey, index) {
    const s = STYLES[styleKey];
    return { id: nextId++, text, ...s.block, ...s.place(index || 0) };
  }

  // ---------- drawing ----------
  function fontOf(b) {
    return (FONTS.find((f) => f.id === b.font) || FONTS[0]).css(b.size);
  }

  function layout(c, b) {
    c.font = fontOf(b);
    const maxW = b.width * W;
    const text = b.lower ? b.text.toLowerCase() : b.text;
    const lines = [];
    for (const para of text.split("\n")) {
      const words = para.split(/\s+/).filter(Boolean);
      if (!words.length) { lines.push(""); continue; }
      let line = words[0];
      for (const word of words.slice(1)) {
        if (c.measureText(line + " " + word).width <= maxW) line += " " + word;
        else { lines.push(line); line = word; }
      }
      lines.push(line);
    }
    const lh = b.size * b.lh;
    const w = Math.max(1, ...lines.map((l) => c.measureText(l).width));
    const h = lines.length * lh;
    return { lines, lh, w, h, left: b.x * W - w / 2, top: b.y * H - h / 2 };
  }

  function drawBackground(c) {
    c.fillStyle = "#0b1a22";
    c.fillRect(0, 0, W, H);
    if (!state.bg) {
      const g = c.createLinearGradient(0, 0, W * 0.4, H);
      g.addColorStop(0, "#10303d"); g.addColorStop(0.6, "#1b4654"); g.addColorStop(1, "#0c1f29");
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      return;
    }
    const el = state.bg.el;
    const sw = el.videoWidth || el.naturalWidth, sh = el.videoHeight || el.naturalHeight;
    if (!sw || !sh) return;
    const scale = Math.max(W / sw, H / sh);
    const dw = sw * scale, dh = sh * scale;
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = "high";   // a big photo shrunk smoothly, not jagged
    c.drawImage(el, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }

  function drawText(c) {
    for (const b of state.blocks) {
      if (!b.text.trim()) continue;
      const L = layout(c, b);
      c.save();
      c.fillStyle = b.colour;
      c.textBaseline = "middle";
      c.textAlign = b.align;
      if (state.shadow) {
        c.shadowColor = "rgba(0,0,0,0.55)";
        c.shadowBlur = b.size * 0.4;
        c.shadowOffsetY = b.size * 0.06;
      }
      const x = b.align === "left" ? L.left : b.align === "right" ? L.left + L.w : b.x * W;
      L.lines.forEach((line, i) => c.fillText(line, x, L.top + L.lh * (i + 0.5)));
      c.restore();
    }
  }

  function drawSelection(c) {
    const b = state.blocks.find((x) => x.id === state.selected);
    if (!b) return;
    const L = layout(c, b), pad = 18;
    c.save();
    c.strokeStyle = "rgba(127,200,178,0.95)";
    c.lineWidth = 3;
    c.setLineDash([14, 10]);
    c.strokeRect(L.left - pad, L.top - pad, L.w + pad * 2, L.h + pad * 2);
    c.restore();
  }

  function render() {
    drawBackground(ctx);
    if (textReady) drawText(ctx);            // never flash the words in a stand-in typeface while the real one loads
    if (panelOpen() || dragging) drawSelection(ctx);
  }

  // The picture is redrawn only when something on it has changed (or a video is playing), and never while it
  // can't be seen. Drawing a full-size canvas sixty times a second for nothing drains the battery and makes
  // the other sections feel heavy.
  let textReady = false, fontsSeen = 0, lastDrawn = "", settleUntil = 0;
  const redraw = () => { lastDrawn = ""; };
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", () => { fontsSeen++; });
  const onScreen = () => !document.hidden && !$("view-create").hidden && $("lock").hidden;
  function pictureKey() {
    const bg = state.bg, el = bg && bg.el;
    return JSON.stringify([state.blocks, state.selected, state.shadow, W, H, panelOpen(), dragging, textReady, fontsSeen,
      bg ? [bg.url, el.videoWidth || el.naturalWidth || 0, el.readyState || 0, el.currentTime || 0] : 0]);
  }
  // A background video plays only while Create is on screen. Left playing behind Today, Posts or Insights it kept
  // the phone decoding video the whole time, which made everything else lag (20 Nov 2026).
  let wokeAt = 0;
  function keepVideoInStep(on, now) {
    const bg = state.bg;
    if (!bg || bg.kind !== "video") return;
    if (!on) { if (!bg.el.paused) bg.el.pause(); return; }
    if (bg.el.paused && now - wokeAt > 1000) { wokeAt = now; bg.el.play().catch(() => {}); }      // (a phone may refuse until her next tap)
  }
  function loop() {
    const on = onScreen();
    keepVideoInStep(on, performance.now());
    if (on) {
      const bg = state.bg, playing = !!bg && bg.kind === "video" && !bg.el.paused && !bg.el.ended;
      const key = pictureKey(), now = performance.now();
      // A video's picture can arrive a moment after the video says it has one (a paused clip, a first frame):
      // with a video behind the words, keep drawing for half a second after anything changed.
      if (key !== lastDrawn && bg && bg.kind === "video") settleUntil = now + 500;
      if (playing || key !== lastDrawn || now < settleUntil) { render(); lastDrawn = key; }
    } else redraw();                         // start afresh when it comes back into view
    requestAnimationFrame(loop);
  }
  // Words are only ever saved in their real typeface: wait for any font that is still on its way.
  const fontsFor = () => Promise.all(state.blocks.filter((b) => b.text.trim())
    .map((b) => document.fonts.load(fontOf(b), "Entangledd").catch(() => {})));

  // Off-screen copies for saving: the full picture, or the text alone on transparency.
  function compose(textOnly) {
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const cx = c.getContext("2d");
    if (!textOnly) drawBackground(cx);
    drawText(cx);
    return c;
  }

  // ---------- contrast check ----------
  const probe = document.createElement("canvas");
  probe.width = 54; probe.height = 96;
  const pctx = probe.getContext("2d", { willReadFrequently: true });
  const lum = (r, g, b) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  let contrastFor = "";
  function checkContrast() {
    if (!onScreen()) return;                 // nothing to warn about while the picture can't be seen
    // A still picture that has not changed since the last look needs no second look (reading the picture back
    // from the screen is slow on a phone). A video is looked at each time: its picture moves.
    const k = pictureKey();
    if (k === contrastFor && !(state.bg && state.bg.kind === "video")) return;
    contrastFor = k;
    const warn = $("warn");
    let worst = null;
    try {
      pctx.save(); pctx.scale(probe.width / W, probe.height / H); drawBackground(pctx); pctx.restore();
      for (const b of state.blocks) {
        if (!b.text.trim()) continue;
        const L = layout(ctx, b), k = probe.width / W;
        const x = Math.max(0, Math.floor(L.left * k)), y = Math.max(0, Math.floor(L.top * k));
        const w = Math.max(1, Math.min(probe.width - x, Math.ceil(L.w * k)));
        const h = Math.max(1, Math.min(probe.height - y, Math.ceil(L.h * k)));
        if (x >= probe.width || y >= probe.height) continue;
        const d = pctx.getImageData(x, y, w, h).data;
        let r = 0, g = 0, bl = 0, n = d.length / 4;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; bl += d[i + 2]; }
        const bgL = lum(r / n, g / n, bl / n);
        const hex = b.colour.replace("#", "");
        const tL = lum(parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16));
        const ratio = (Math.max(bgL, tL) + 0.05) / (Math.min(bgL, tL) + 0.05);
        if (ratio < (state.shadow ? 2 : 3) && (!worst || ratio < worst.ratio)) worst = { ratio, b };
      }
    } catch (e) { worst = null; }
    if (worst) {
      const words = worst.b.text.trim().split(/\s+/).slice(0, 3).join(" ");
      warn.textContent = `“${words}…” is hard to read here. Move it, change its colour${state.shadow ? "" : ", or turn on the shadow"}.`;
      warn.hidden = false;
    } else warn.hidden = true;
  }

  // ---------- shape and on-screen size ----------
  // Fits the canvas into the room it has, keeping its proportions, whichever shape is chosen.
  function fitCanvas() {
    const stage = $("stage"), room = { w: stage.clientWidth - 24, h: stage.clientHeight - 16 };
    if (room.w <= 0 || room.h <= 0) return;
    const k = Math.min(room.w / W, room.h / H);
    canvas.style.width = Math.floor(W * k) + "px";
    canvas.style.height = Math.floor(H * k) + "px";
  }
  function setShape(shape) {
    state.shape = shape === "post" ? "post" : "reel";
    H = state.shape === "post" ? 1350 : 1920;
    canvas.height = H;                       // (this also wipes the canvas)
    redraw();
    probe.height = Math.round(probe.width * H / W);
    document.querySelectorAll("#shape button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.shape === state.shape)));
    fitCanvas();
    syncBackgroundPane();
  }
  document.querySelectorAll("#shape button").forEach((b) => b.addEventListener("click", () => { setShape(b.dataset.shape); saveDraft(); }));
  if (window.ResizeObserver) new ResizeObserver(fitCanvas).observe($("stage"));
  window.addEventListener("resize", fitCanvas);

  // ---------- touch: drag to move, pinch to resize ----------
  const pointers = new Map();
  let dragging = false, dragOffset = null, pinchStart = null;
  function toCanvas(e) {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  }
  function hit(p) {
    for (let i = state.blocks.length - 1; i >= 0; i--) {
      const b = state.blocks[i], L = layout(ctx, b), pad = 40;
      if (p.x >= L.left - pad && p.x <= L.left + L.w + pad && p.y >= L.top - pad && p.y <= L.top + L.h + pad) return b;
    }
    return null;
  }
  const selectedBlock = () => state.blocks.find((b) => b.id === state.selected) || null;

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, toCanvas(e));
    if (pointers.size === 1) {
      const p = toCanvas(e), b = hit(p);
      if (b) {
        select(b.id);
        dragging = true;
        dragOffset = { x: p.x - b.x * W, y: p.y - b.y * H };
      }
    } else if (pointers.size === 2 && selectedBlock()) {
      const [a, c] = [...pointers.values()];
      pinchStart = { dist: Math.hypot(a.x - c.x, a.y - c.y), size: selectedBlock().size };
      dragOffset = null;
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, toCanvas(e));
    const b = selectedBlock();
    if (!b) return;
    if (pointers.size === 2 && pinchStart) {
      const [a, c] = [...pointers.values()];
      const d = Math.hypot(a.x - c.x, a.y - c.y);
      b.size = Math.round(Math.min(120, Math.max(16, pinchStart.size * (d / pinchStart.dist))));
      syncTextPane();
    } else if (pointers.size === 1 && dragging && dragOffset) {
      const p = toCanvas(e);
      b.x = Math.min(0.97, Math.max(0.03, (p.x - dragOffset.x) / W));
      b.y = Math.min(0.97, Math.max(0.03, (p.y - dragOffset.y) / H));
    }
  });
  const release = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (pointers.size === 0) { dragging = false; dragOffset = null; saveDraft(); }
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);

  // ---------- panel ----------
  const tabs = ["bg", "text", "style", "music", "save"];
  let openTab = null;
  const panelOpen = () => openTab !== null;
  function showTab(name) {
    const wide = window.matchMedia("(min-width: 900px)").matches;
    openTab = openTab === name && !wide ? null : name;   // on a phone, tapping the open tab closes it
    if (openTab !== "music") stopTune();
    for (const t of tabs) {
      $("tab-" + t).setAttribute("aria-selected", String(t === openTab));
      $("pane-" + t).hidden = t !== openTab;
    }
  }
  tabs.forEach((t) => $("tab-" + t).addEventListener("click", () => showTab(t)));

  function select(id) {
    state.selected = id;
    syncTextPane();
  }

  function syncTextPane() {
    $("author-row").hidden = !state.author;
    $("show-author").checked = state.blocks.some((x) => x.role === "author");
    const b = selectedBlock();
    const off = !b;
    for (const id of ["words", "size", "width", "font", "lower", "remove"]) $(id).disabled = off;
    if (!b) { $("words").value = ""; return; }
    if (document.activeElement !== $("words")) $("words").value = b.text;
    $("size").value = b.size; $("size-out").textContent = b.size;
    $("width").value = Math.round(b.width * 100); $("width-out").textContent = Math.round(b.width * 100) + "%";
    $("font").value = b.font;
    $("lower").checked = b.lower;
    $("shadow").checked = state.shadow;
    document.querySelectorAll("#swatches button").forEach((s) =>
      s.setAttribute("aria-pressed", String(s.dataset.hex.toLowerCase() === b.colour.toLowerCase())));
    document.querySelectorAll("#align button").forEach((a) =>
      a.setAttribute("aria-pressed", String(a.dataset.align === b.align)));
  }

  function edit(fn) {
    const b = selectedBlock();
    if (!b) return;
    fn(b);
    syncTextPane();
    saveDraft();
  }

  FONTS.forEach((f) => $("font").add(new Option(f.label, f.id)));
  COLOURS.forEach((c) => {
    const s = document.createElement("button");
    s.type = "button"; s.dataset.hex = c.hex; s.style.setProperty("--c", c.hex);
    s.setAttribute("aria-label", c.name); s.setAttribute("aria-pressed", "false");
    s.addEventListener("click", () => edit((b) => { b.colour = c.hex; }));
    $("swatches").append(s);
  });
  const custom = document.createElement("input");
  custom.type = "color"; custom.setAttribute("aria-label", "Pick any colour"); custom.value = "#ffffff";
  custom.addEventListener("input", () => edit((b) => { b.colour = custom.value.toUpperCase(); }));
  $("swatches").append(custom);

  $("words").addEventListener("input", () => edit((b) => { b.text = $("words").value; }));
  $("size").addEventListener("input", () => edit((b) => { b.size = +$("size").value; }));
  $("width").addEventListener("input", () => edit((b) => { b.width = +$("width").value / 100; }));
  $("font").addEventListener("change", () => edit((b) => { b.font = $("font").value; }));
  $("lower").addEventListener("change", () => edit((b) => { b.lower = $("lower").checked; }));
  $("shadow").addEventListener("change", () => { state.shadow = $("shadow").checked; saveDraft(); });
  document.querySelectorAll("#align button").forEach((a) =>
    a.addEventListener("click", () => edit((b) => { b.align = a.dataset.align; })));

  $("add").addEventListener("click", () => {
    const from = selectedBlock();
    const b = newBlock("new line", state.style, state.blocks.length);
    if (from) Object.assign(b, { font: from.font, size: from.size, colour: from.colour, align: from.align,
      width: from.width, lh: from.lh, lower: from.lower, x: Math.min(0.9, from.x + 0.05), y: Math.min(0.94, from.y + 0.06) });
    state.blocks.push(b);
    select(b.id);
    $("words").focus(); $("words").select();
    saveDraft();
  });
  $("remove").addEventListener("click", () => {
    state.blocks = state.blocks.filter((b) => b.id !== state.selected);
    select(state.blocks.length ? state.blocks[state.blocks.length - 1].id : null);
    saveDraft();
  });

  // ---------- styles ----------
  function applyStyle(key) {
    const s = STYLES[key];
    state.style = key;
    const text = state.blocks.map((b) => b.text).join("\n").trim() || s.preview.text.replace(/\n\s+/g, "\n");
    const parts = s.split ? text.split("\n").map((t) => t.trim()).filter(Boolean) : [text];
    state.blocks = parts.map((t, i) => newBlock(t, key, i));
    select(state.blocks[0].id);
    document.querySelectorAll("#styles button").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.style === key)));
    saveDraft();
  }
  // Puts a chosen quote on the canvas in the current style, with the author as a smaller line below.
  function setQuote(text, author) {
    const s = STYLES[state.style];
    const parts = s.split ? text.split("\n").map((t) => t.trim()).filter(Boolean) : [text.trim()];
    state.blocks = parts.map((t, i) => newBlock(t, state.style, i));
    state.author = author || "";
    if (author) addAuthorLine();
    select(state.blocks[0].id);
    saveDraft();
  }
  // The author's name is its own small line under the quote, so it can be moved, restyled or left off.
  function addAuthorLine() {
    const quoteLines = state.blocks.filter((b) => b.role !== "author");
    const last = quoteLines[quoteLines.length - 1];
    if (!last || !state.author) return;
    const L = layout(ctx, last);
    const by = newBlock("— " + state.author, state.style, state.blocks.length);
    by.role = "author";
    by.size = Math.max(16, Math.round(last.size * 0.72));
    by.x = last.x;
    by.y = Math.min(0.95, last.y + (L.h / 2 + by.size * 2.4) / H);
    state.blocks.push(by);
  }
  // Changes or removes the credited author without touching how the quote is styled.
  function setAuthor(name) {
    state.author = name || "";
    state.blocks = state.blocks.filter((b) => b.role !== "author");
    if (state.author) addAuthorLine();
    if (!selectedBlock()) select(state.blocks.length ? state.blocks[0].id : null);
    syncTextPane();
    saveDraft();
  }
  // Replaces the quote's words. A quote in one piece keeps its styling; a staggered one is laid out again.
  function setWords(text) {
    const quote = state.blocks.filter((b) => b.role !== "author");
    if (quote.length !== 1) { setQuote(text, state.author); return; }
    quote[0].text = text;
    select(quote[0].id);
    saveDraft();
  }

  // ---------- saved looks: the styling of everything on the canvas, without the words ----------
  const LOOK_KEYS = ["font", "size", "colour", "align", "width", "lh", "lower", "x", "y"];
  const currentLook = () => ({ shape: state.shape, shadow: state.shadow,
    blocks: state.blocks.map((b) => ({ ...Object.fromEntries(LOOK_KEYS.map((k) => [k, b[k]])), role: b.role || "" })) });
  function applyLook(look) {
    if (!look || !Array.isArray(look.blocks) || !look.blocks.length || !state.blocks.length) return false;
    if ((look.shape === "post" ? "post" : "reel") !== state.shape) setShape(look.shape);
    state.shadow = look.shadow !== false;
    const wear = (b, k) => { for (const key of LOOK_KEYS) if (k[key] != null && (key !== "font" || FONTS.some((f) => f.id === k.font))) b[key] = k[key]; };
    const forQuote = look.blocks.filter((k) => k.role !== "author"), forAuthor = look.blocks.find((k) => k.role === "author");
    let n = 0;
    for (const b of state.blocks) {
      if (b.role === "author") continue;
      const k = forQuote[Math.min(n, forQuote.length - 1)] || look.blocks[0];
      wear(b, k);
      if (n >= forQuote.length && forQuote.length) b.y = Math.min(0.94, k.y + 0.06 * (n - forQuote.length + 1));   // more lines than the look had
      n += 1;
    }
    const by = state.blocks.find((b) => b.role === "author");
    if (by && forAuthor) wear(by, forAuthor);
    else if (by) { state.blocks = state.blocks.filter((b) => b !== by); addAuthorLine(); }
    document.querySelectorAll("#styles button").forEach((b) => b.setAttribute("aria-pressed", "false"));
    if (!selectedBlock()) select(state.blocks[0].id);
    syncTextPane();
    saveDraft();
    return true;
  }

  $("show-author").addEventListener("change", () => {
    state.blocks = state.blocks.filter((b) => b.role !== "author");
    if ($("show-author").checked) addAuthorLine();
    if (!selectedBlock()) select(state.blocks.length ? state.blocks[0].id : null);
    syncTextPane();
    saveDraft();
  });

  Object.entries(STYLES).forEach(([key, s]) => {
    const b = document.createElement("button");
    b.type = "button"; b.dataset.style = key; b.setAttribute("aria-pressed", "false");
    const sw = document.createElement("span");
    sw.className = "swatch"; sw.style.background = s.preview.bg; sw.style.font = s.preview.font;
    sw.style.color = s.preview.colour; sw.style.whiteSpace = "pre"; sw.style.textAlign = s.block.align;
    sw.textContent = s.preview.text;
    const name = document.createElement("span"); name.textContent = s.label;
    const hint = document.createElement("small"); hint.textContent = s.hint;
    name.append(hint);
    b.append(sw, name);
    b.addEventListener("click", () => applyStyle(key));
    $("styles").append(b);
  });

  // ---------- background ----------
  function clearBackground() {
    if (state.bg) {
      if (state.bg.kind === "video") state.bg.el.pause();
      URL.revokeObjectURL(state.bg.url);
    }
    state.bg = null;
    syncBackgroundPane();
  }
  function syncBackgroundPane() {
    const video = !!state.bg && state.bg.kind === "video";
    $("clear-bg").hidden = !state.bg;
    $("video-opts").hidden = !video;
    $("save-image").hidden = video && state.shape === "reel";
    $("carousel").hidden = state.shape !== "post";
    $("reel-setup").hidden = state.shape === "post" || $("pane-save").classList.contains("busy");
    $("len-out").textContent = state.length + " s";
    $("len").value = state.length;
    $("done").hidden = true;
  }
  // "info" says where the file came from: { from: "search", words } for one picked from the photo and video search.
  // Only the background asked for last takes effect (bgAsk), and a file that never opens is given up after
  // MEDIA_WAIT_MS: a load that hung once left the whole composer waiting (her case, 17 Nov 2026).
  // opts (for a draft's own background coming back, see attach): { still } says whether it is still wanted;
  // { keepLength } leaves the reel's length as the draft has it.
  const MEDIA_WAIT_MS = 20000;
  const staleError = () => Object.assign(new Error("Something else was chosen meanwhile."), { stale: true });
  let bgAsk = 0;
  function loadBackground(file, info, opts = {}) {
    const origin = { from: (info && info.from) || "own", words: (info && info.words) || "", credit: (info && info.credit) || "" };
    const mine = ++bgAsk;
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const isVideo = file.type.startsWith("video/") || /\.(mov|mp4|m4v|webm)$/i.test(file.name);
      let over = false, v = null;
      const wanted = () => mine === bgAsk && (!opts.still || opts.still());
      const fail = (err) => {
        if (over) return;
        over = true; clearTimeout(timer);
        if (v) { v.pause(); v.removeAttribute("src"); v.load(); }
        URL.revokeObjectURL(url);
        reject(err && err.stale ? err : new Error(`This ${isVideo ? "video" : "photo"} couldn't be opened. Try a different file.`));
      };
      const timer = setTimeout(fail, MEDIA_WAIT_MS);
      const use = (el, kind) => {
        if (over) return;
        if (!wanted()) { fail(staleError()); return; }
        over = true; clearTimeout(timer);
        clearBackground();
        state.bg = { kind, el, url, name: file.name, file, ...origin };
        if (kind === "video") {
          if (!opts.keepLength && isFinite(el.duration)) state.length = Math.round(Math.min(30, Math.max(5, el.duration)));
          el.play().catch(() => {});
        }
        syncBackgroundPane();
        saveDraft();
        resolve();
      };
      if (isVideo) {
        v = document.createElement("video");
        v.muted = true; v.loop = true; v.playsInline = true; v.preload = "auto";
        v.setAttribute("playsinline", ""); v.setAttribute("muted", "");
        // An iPhone says "loadeddata" only for a video that is playing, and plays one only when it likes (not at all
        // in Low Power Mode until she taps): the video's size and length ("loadedmetadata") are enough to begin.
        for (const name of ["loadedmetadata", "loadeddata", "canplay"]) v.addEventListener(name, () => use(v, "video"), { once: true });
        v.addEventListener("error", () => fail(), { once: true });
        v.src = url; v.load();
        v.play().catch(() => {});
      } else {
        const img = new Image();
        img.onload = () => use(img, "image");
        img.onerror = () => fail();
        img.src = url;
      }
    });
  }
  // A background video that the phone paused (the app was away, Low Power Mode) plays again at her next tap.
  // (Only while Create is on screen: elsewhere it stays paused, see keepVideoInStep.)
  const wakeBackground = () => { const b = state.bg; if (b && b.kind === "video" && b.el.paused && onScreen()) b.el.play().catch(() => {}); };
  document.addEventListener("pointerdown", wakeBackground, { passive: true });
  $("file").addEventListener("change", () => {
    const file = $("file").files[0];
    $("file").value = "";
    if (file) loadBackground(file).catch((e) => { if (!e.stale) say(e.message); });
  });
  $("clear-bg").addEventListener("click", () => { bgAsk++; clearBackground(); saveDraft(); });

  // ---------- music that becomes part of the reel: your own file, or a track from the free library ----------
  const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const TUNE_TYPES = { "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac", "audio/wav": "wav", "audio/x-wav": "wav",
    "video/mp4": "mp4", "video/quicktime": "mov" };
  let tuneTimer = null;
  function stopTune() {
    clearTimeout(tuneTimer);
    if (state.music && state.music.el) state.music.el.pause();
    if ($("tune-play")) $("tune-play").textContent = "Play from the start point";
  }
  function clearMusic() {
    stopTune();
    if (state.music) URL.revokeObjectURL(state.music.url);
    state.music = null;
    syncMusicPane();
  }
  function syncMusicPane() {
    const m = state.music;
    $("tune-opts").hidden = !m;
    $("tune-clear").hidden = !m;
    $("tune-file-label").textContent = !m ? "Your own music" : m.from === "own" ? "A different file" : "Your own instead";
    $("tab-music").textContent = m ? "Music ♪" : "Music";
    $("tune-state").hidden = !!m;
    if (!m) return;
    $("tune-name").textContent = m.artist ? `${m.title} by ${m.artist}` : m.title;
    $("tune-licence").textContent = m.from === "library"
      ? (m.credit ? `Free to use with credit (${m.licence}). The credit is added to your caption when you post.` : `Free to use, no credit needed (${m.licence}).`)
      : "Your own file.";
    // The start point can't be so late that the music runs out before the reel does (unless the track is shorter than the reel).
    const latest = Math.max(0, Math.floor(m.duration - state.length));
    m.start = Math.min(m.start, latest);
    $("tune-start").max = latest; $("tune-start").value = m.start; $("tune-start").disabled = latest === 0;
    $("tune-start-out").textContent = latest === 0 ? "0:00 (the track is no longer than the reel)" : `${clock(m.start)} of ${clock(m.duration)}`;
    $("tune-vol").value = Math.round(m.volume * 100); $("tune-vol-out").textContent = Math.round(m.volume * 100) + "%";
  }
  // "info" describes a library track: { from: "library", title, artist, licence, credit }. Without it, the file is her own.
  // As for the background: only the music asked for last takes effect, and a file that never opens is given up.
  // info.start and info.volume (a draft's own music coming back) are kept; opts.still as for loadBackground.
  let musicAsk = 0;
  function loadMusic(file, info, opts = {}) {
    const mine = ++musicAsk;
    return new Promise((resolve, reject) => {
      if (file.size > 40 * 1024 * 1024) { reject(new Error("That file is over 40 MB. Pick a shorter or smaller one.")); return; }
      const ext = ((file.name.match(/\.([a-z0-9]{2,5})$/i) || [])[1] || TUNE_TYPES[file.type] || "").toLowerCase();
      if (!/^(mp3|m4a|aac|wav|ogg|oga|flac|mp4|mov|m4v|webm)$/.test(ext)) { reject(new Error("That file type can't be used for music. Use an MP3, M4A or WAV file, or a video that has sound.")); return; }
      const url = URL.createObjectURL(file), el = new Audio();
      el.preload = "auto";
      let over = false;
      const fail = (err) => {
        if (over) return;
        over = true; clearTimeout(timer);
        el.onerror = el.onloadedmetadata = null; el.removeAttribute("src");
        URL.revokeObjectURL(url);
        reject(err && err.stale ? err : new Error("That file couldn't be opened as music. Try an MP3 or M4A file, or a video that has sound."));
      };
      const timer = setTimeout(fail, MEDIA_WAIT_MS);
      el.onerror = () => fail();
      el.onloadedmetadata = () => {
        if (over) return;
        if (!Number.isFinite(el.duration) || el.duration < 1) { fail(); return; }
        if (mine !== musicAsk || (opts.still && !opts.still())) { fail(staleError()); return; }
        over = true; clearTimeout(timer);
        clearMusic();
        const volume = Math.min(1, Math.max(0, info && info.volume != null ? +info.volume : 0.8));
        el.volume = volume;
        state.music = { file, url, el, ext, duration: el.duration, start: Math.max(0, +(info && info.start) || 0), volume, from: (info && info.from) || "own",
          title: (info && info.title) || file.name.replace(/\.[a-z0-9]{2,5}$/i, ""), artist: (info && info.artist) || "", licence: (info && info.licence) || "", credit: (info && info.credit) || "" };
        syncMusicPane();
        saveDraft();
        resolve();
      };
      el.src = url;
    });
  }
  $("tune-file").addEventListener("change", () => {
    const file = $("tune-file").files[0];
    $("tune-file").value = "";
    $("tune-say").textContent = "";
    if (file) loadMusic(file).catch((e) => { if (!e.stale) $("tune-say").textContent = e.message; });
  });
  $("tune-clear").addEventListener("click", () => { musicAsk++; clearMusic(); saveDraft(); });
  $("tune-start").addEventListener("input", () => { state.music.start = +$("tune-start").value; stopTune(); syncMusicPane(); saveDraft(); });
  $("tune-vol").addEventListener("input", () => { state.music.volume = +$("tune-vol").value / 100; state.music.el.volume = state.music.volume; syncMusicPane(); saveDraft(); });
  // Plays the part of the track the reel will use, at the chosen volume, and stops where the reel would end.
  $("tune-play").addEventListener("click", async () => {
    const m = state.music;
    if (!m) return;
    if (!m.el.paused) { stopTune(); return; }
    m.el.currentTime = m.start; m.el.volume = m.volume;
    try {
      await m.el.play();
      $("tune-play").textContent = "Stop";
      tuneTimer = setTimeout(stopTune, state.length * 1000);
      m.el.onended = stopTune;
    } catch (e) { $("tune-say").textContent = "The music couldn't be played here, but it will still be added to the reel."; }
  });
  $("len").addEventListener("input", () => { state.length = +$("len").value; $("len-out").textContent = state.length + " s"; if (state.music) syncMusicPane(); saveDraft(); });
  $("mute").addEventListener("change", () => { state.mute = $("mute").checked; saveDraft(); });
  $("fade").addEventListener("change", () => { state.fade = $("fade").checked; saveDraft(); });

  // ---------- saving ----------
  function say(msg) {
    if (openTab !== "save") showTab("save");
    $("done").textContent = msg; $("done").hidden = false;
  }
  function download(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const toBlob = (c, type, q) => new Promise((res) => c.toBlob(res, type, q));

  $("save-img").addEventListener("click", async () => {
    await fontsFor();
    const blob = await toBlob(compose(false), "image/jpeg", 0.92);
    const file = new File([blob], "ds-studio.jpg", { type: "image/jpeg" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); $("done").textContent = "Picture shared."; $("done").hidden = false; return; }
      catch (e) { if (e.name === "AbortError") return; }
    }
    download(blob, "ds-studio.jpg");
    $("done").textContent = "Picture saved to your downloads."; $("done").hidden = false;
  });

  // ---------- server: passcode and reels ----------
  const TOKEN_KEY = "entangledd.token.v1", FACEID_KEY = "entangledd.faceid.v1", STATUS_KEY = "entangledd.status.v1";
  const server = { on: false, reels: false, ai: false, stock: false, instagram: false, locked: false, token: "" };
  const store = {
    get: (k) => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* no storage: nothing is remembered on this device */ } },
    del: (k) => { try { localStorage.removeItem(k); } catch (e) { /* nothing to remove */ } },
  };
  // With the Face ID lock on, the sign-in is never kept on the phone: every fresh open needs Face ID.
  const faceIdOn = () => !!store.get(FACEID_KEY);
  if (!faceIdOn()) server.token = store.get(TOKEN_KEY);

  async function api(path, opts = {}) {
    const res = await fetch("/api/" + path, { ...opts, headers: { ...(opts.headers || {}), Authorization: "Bearer " + server.token } });
    if (res.status === 401) { showLock(); throw Object.assign(new Error("Enter the passcode to continue."), { status: 401 }); }
    if (!res.ok) {
      let msg = "Something went wrong on our side. Try again.";
      try { msg = (await res.json()).error || msg; } catch (e) { /* keep the generic message */ }
      throw Object.assign(new Error(msg), { status: res.status });
    }
    return res;
  }

  function showLock() {
    const face = faceIdOn() && !!window.PublicKeyCredential;
    $("faceid-unlock").hidden = !face;
    $("lock-or").hidden = !face;
    $("passcode-go").classList.toggle("primary", !face);
    $("lock").hidden = false;
    $("passcode").value = "";
    if (face) $("faceid-unlock").focus(); else $("passcode").focus();
  }
  // What the server offers (reels, Nishiii, backgrounds, Instagram). It is also remembered on the phone,
  // so the next open can begin at once instead of waiting to be told again.
  function syncServer() {
    syncReelPane();
    $("stock").disabled = !server.stock;
    $("stock-note").hidden = server.stock;
    $("reword-open").hidden = !server.ai;
    $("tune-search").disabled = false;
    $("check-open").hidden = !server.ai;
    $("queue-add").hidden = !server.instagram;
    $("post-open").hidden = !server.instagram;
  }
  function applyStatus(st, remember) {
    server.on = true; server.reels = !!st.reels; server.ai = !!st.ai; server.stock = !!st.stock; server.instagram = !!st.instagram;
    if (remember !== false) store.set(STATUS_KEY, JSON.stringify({ reels: server.reels, ai: server.ai, stock: server.stock, instagram: server.instagram }));
    syncServer();
  }
  // Tells the rest of the app (studio.js and the add-on sections) that it is open and unlocked. Their scripts
  // load after this one, so the first signal waits until the page has finished loading them.
  let announced = false;                     // whether the rest of the app has been told it may begin
  let statusKnown = Promise.resolve();       // settles once /api/status has answered, or failed
  function announceReady() {
    announced = true;
    const go = () => document.dispatchEvent(new CustomEvent("studio:ready"));
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go, { once: true });
    else go();
  }
  async function unlocked(token, st) {
    server.token = token;
    if (!faceIdOn()) store.set(TOKEN_KEY, token);
    $("lock").hidden = true;
    $("lock-error").hidden = true;
    server.locked = false;
    announced = true;
    if (st) applyStatus(st); else await statusKnown;      // an older server doesn't send it along with the sign-in
    announceReady();
  }
  function lockError(e) {
    $("lock-error").textContent = e.message === "Failed to fetch" ? "You seem to be offline. Check your internet and try again." : e.message;
    $("lock-error").hidden = false;
  }
  async function postJson(path, data, auth) {
    const res = await fetch("/api/" + path, { method: "POST", body: JSON.stringify(data || {}),
      headers: { "Content-Type": "application/json", ...(auth ? { Authorization: "Bearer " + server.token } : {}) } });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || "That didn't work. Try again.");
    return out;
  }
  $("lock").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("lock-error").hidden = true;
    try { const r = await postJson("login", { passcode: $("passcode").value }); unlocked(r.token, r.status); }
    catch (e2) { lockError(e2); }
  });

  // ---- Face ID lock. The phone signs a one-time challenge with a key only Face ID can use. ----
  const b64u = {
    enc: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
    dec: (str) => Uint8Array.from(atob(str.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
  };
  const faceIdName = /iPhone|iPad/.test(navigator.userAgent) ? "Face ID" : "your device's screen lock";
  // The challenge is asked for the instant the page starts (the small script at the top of index.html), so by
  // the time Face ID is wanted it is usually already here. Later tries ask for a fresh one.
  const freshChallenge = () => postJson("passkey/challenge");
  // After a try that didn't unlock, the next challenge is fetched straight away, so a tap on the button goes to
  // Face ID with no wait in between. (One is good for five minutes; one older than three is not used.)
  let ahead = null;                          // { at, promise }
  function fetchAhead() { ahead = { at: Date.now(), promise: freshChallenge().catch(() => null) }; }
  function nextChallenge() {
    const early = window.__challenge || (ahead && Date.now() - ahead.at < 3 * 60 * 1000 ? ahead.promise : null);
    window.__challenge = null; ahead = null;
    return early ? early.then((ch) => (ch && ch.challenge ? ch : freshChallenge()), freshChallenge) : freshChallenge();
  }
  // auto = the app is asking by itself (on opening, or on coming back after a while), not because of a tap.
  // One try at a time. The app never starts a second try of its own while one is going on. A tap always gets a
  // fresh try: an iPhone can leave a try the app started by itself hanging with nothing on screen, and the
  // button must still work then, so the hanging one is given up first.
  let prompting = null;                      // the try going on right now, if any: { stop, answered }
  async function faceIdUnlock(auto) {
    if (prompting) {
      if (auto || prompting.answered) return;  // (once the phone has answered, the sign-in is on its way: nothing to give up)
      prompting.stop.abort();
    }
    const mine = prompting = { stop: new AbortController(), answered: false };
    $("lock-error").hidden = true;
    try {
      const ch = await nextChallenge();
      if (prompting !== mine) return;
      const got = await navigator.credentials.get({ publicKey: {
        challenge: b64u.dec(ch.challenge), userVerification: "required", timeout: 60000,
        allowCredentials: [{ type: "public-key", id: b64u.dec(store.get(FACEID_KEY)), transports: ["internal"] }],
        hints: ["client-device"],
      }, signal: mine.stop.signal });
      if (prompting !== mine) return;
      mine.answered = true;
      const r = got.response;
      const res = await postJson("passkey/login", { challengeId: ch.id, credentialId: b64u.enc(got.rawId),
        authenticatorData: b64u.enc(r.authenticatorData), clientDataJSON: b64u.enc(r.clientDataJSON), signature: b64u.enc(r.signature) });
      unlocked(res.token, res.status);
    } catch (e) {
      if (prompting !== mine) return;        // given up for a newer try, which speaks for itself
      // NotAllowedError is what a cancelled, timed-out or refused Face ID prompt looks like. When the app asked by
      // itself there is nothing to explain: the button is right there for another try.
      const quiet = e.name === "NotAllowedError" || e.name === "AbortError";
      if (!quiet) lockError(e);
      else if (!auto) lockError(new Error("Face ID was cancelled. Try again, or use the passcode."));
      if (server.locked && faceIdOn() && navigator.onLine !== false) fetchAhead();
    } finally { if (prompting === mine) prompting = null; }
  }
  $("faceid-unlock").addEventListener("click", () => faceIdUnlock(false));

  async function faceIdEnable() {
    if (!window.PublicKeyCredential) throw new Error("Face ID isn't available in this browser.");
    const ch = await postJson("passkey/challenge");
    const made = await navigator.credentials.create({ publicKey: {
      rp: { name: "D's Studio" },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: "D's Studio", displayName: "D's Studio" },
      challenge: b64u.dec(ch.challenge), pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
      hints: ["client-device"],      // asks for this device's own lock; a page can't pick where the phone stores the key
      timeout: 60000, attestation: "none",
    } });
    const r = made.response;
    if (!r.getPublicKey || !r.getPublicKey()) throw new Error("Face ID couldn't be set up on this device.");
    const id = b64u.enc(made.rawId);
    await postJson("passkey/register", { challengeId: ch.id, credentialId: id, publicKey: b64u.enc(r.getPublicKey()),
      alg: r.getPublicKeyAlgorithm(), clientDataJSON: b64u.enc(r.clientDataJSON),
      label: /iPhone/.test(navigator.userAgent) ? "iPhone" : /iPad/.test(navigator.userAgent) ? "iPad" : "A computer" }, true);
    store.set(FACEID_KEY, id);
    store.del(TOKEN_KEY);            // from now on the sign-in lives only in memory
  }
  async function faceIdDisable() {
    const id = store.get(FACEID_KEY);
    store.del(FACEID_KEY);
    store.set(TOKEN_KEY, server.token);
    if (id) await fetch("/api/passkey/" + encodeURIComponent(id), { method: "DELETE", headers: { Authorization: "Bearer " + server.token } }).catch(() => {});
  }
  function signOut() {
    server.token = "";
    store.del(TOKEN_KEY);
    store.del("studio.posts");               // the posts as this phone last saw them (web/studio.js)
    server.locked = true;
    showLock();
  }
  // Coming back after a while with the lock on: ask for Face ID again.
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (faceIdOn() && server.token && hiddenAt && Date.now() - hiddenAt > 5 * 60 * 1000) {
      server.token = ""; server.locked = true; showLock();
      if (window.PublicKeyCredential) faceIdUnlock(true);
    }
  });

  async function connect() {
    const asked = server.token;                  // the sign-in this answer will be about
    let st = null;
    try {
      const res = await fetch("/api/status", { headers: { Authorization: "Bearer " + asked } });
      if (res.ok) st = await res.json();         // not ok: no server behind this copy of the app
    } catch (e) { /* offline or static hosting: the composer still works */ }
    if (st) applyStatus(st); else syncServer();
    if (server.token !== asked) return;          // she unlocked while this was on its way: nothing more to decide
    if (st && st.configured && !st.signedIn) {
      server.locked = true;
      if ($("lock").hidden) showLock();          // (with the Face ID lock on, it is already showing)
      return;
    }
    // No lock is needed: already signed in, no passcode set up, or no server in reach.
    if (server.locked) { server.locked = false; $("lock").hidden = true; }
    if (!announced) announceReady();
  }

  let reel = null;   // { id, blob } once a reel is finished
  function syncReelPane(mode) {
    const ready = server.on && server.reels;
    $("make-reel").disabled = !ready;
    $("reel-note").hidden = ready;
    $("reel-note").textContent = "Reels aren't set up yet. You can still save pictures.";
    if (mode) {
      $("pane-save").classList.toggle("busy", mode !== "setup");   // hides "Save as a picture" while a reel is being made or shown
      $("reel-setup").hidden = mode !== "setup" || state.shape === "post";
      $("reel-progress").hidden = mode !== "progress";
      $("reel-result").hidden = mode !== "result";
    }
  }
  function progress(text, pct) {
    $("progress").textContent = text;
    if (pct == null) $("bar").removeAttribute("value"); else $("bar").value = pct;
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Like sleep, but ends early when she comes back to the app (a phone pauses timers while the app is away).
  const sleepOrReturn = (ms) => new Promise((r) => {
    const done = () => { clearTimeout(timer); document.removeEventListener("visibilitychange", back); r(); };
    const back = () => { if (!document.hidden) done(); };
    const timer = setTimeout(done, ms);
    document.addEventListener("visibilitychange", back);
  });
  // How long to wait before asking again whether the reel is ready. Nothing can be ready in the first seconds;
  // after that it is asked often, so the reel shows up almost the moment it is done; a slow one is asked about less.
  const reelCheckEvery = (waited) => (waited < 12000 ? 3000 : waited < 90000 ? 1500 : waited < 240000 ? 3000 : 5000);

  // What is on the canvas right now, in the few words Insights compares posts by.
  function madeWith() {
    const main = state.blocks.find((b) => b.role !== "author") || state.blocks[0] || {};
    return { bg: state.bg ? (state.bg.kind === "video" ? "video" : "photo") : "plain", bgFrom: state.bg ? state.bg.from || "own" : "", bgWords: state.bg ? state.bg.words || "" : "",
      seconds: state.shape === "reel" ? state.length : 0, font: main.font || "", shape: state.shape, lower: !!main.lower,
      music: state.music && state.shape === "reel" ? state.music.from : "", musicTitle: state.music ? state.music.title : "", musicCredit: state.music ? state.music.credit : "" };
  }
  async function makeReel() {
    // A draft's background or music still coming back (web/drafts.js): the reel is not made without them.
    const coming = window.Studio.filesComing ? window.Studio.filesComing() : "";
    if (coming) { $("done").textContent = coming; $("done").hidden = false; return; }
    const made = madeWith(), music = state.music;
    const snap = snapshot(), files = draftFiles();      // what this reel is made from, kept so she can come back to it
    stopTune();
    $("done").hidden = true;
    syncReelPane("progress");
    try {
      // Her background and music are kept with the draft first (web/drafts.js); a video or a song kept there is
      // then used by the reel as it is, so nothing is sent twice. If keeping fails, the reel is sent as before.
      const keepFile = (f, words) => (f && window.Studio.storeFile
        ? window.Studio.storeFile(f, (pct) => progress(words, pct)).catch(() => "") : Promise.resolve(""));
      const bgFile = await keepFile(files.bg, "Sending the background…");
      const musicFile = await keepFile(music && music.file, "Sending the music…");
      // The background: her video as it is, or the still picture exactly as shown.
      let bg, bgName;
      if (state.bg && state.bg.kind === "video") { bg = state.bg.file; bgName = /\.[a-z0-9]{2,5}$/i.test(bg.name) ? bg.name : "clip.mp4"; }
      else {
        // Drawn at twice the reel's size, so the slow zoom has the photo's own detail to work with.
        const c = document.createElement("canvas"); c.width = W * 2; c.height = H * 2;
        const ctx = c.getContext("2d"); ctx.scale(2, 2); drawBackground(ctx);
        bg = await toBlob(c, "image/jpeg", 0.95); bgName = "background.jpg";
      }
      await fontsFor();
      const overlay = await toBlob(compose(true), "image/png");

      progress("Sending the background…", 0);
      const job = await (await api("jobs", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ length: state.length, keepAudio: !state.mute, fade: state.fade, bgName, bgSize: bg.size,
          bgFile: state.bg && state.bg.kind === "video" && bg === files.bg ? bgFile : "" }) })).json();
      const total = job.reused ? 0 : Math.max(1, Math.ceil(bg.size / job.partSize)), parts = [];
      for (let i = 0; i < total; i++) {
        const chunk = bg.slice(i * job.partSize, (i + 1) * job.partSize);
        const part = await (await api(`jobs/${job.id}/bg/${i + 1}?uploadId=${encodeURIComponent(job.uploadId)}`,
          { method: "PUT", body: chunk })).json();
        parts.push(part);
        progress("Sending the background…", Math.round(((i + 1) / total) * 100));
      }
      if (!job.reused) await api(`jobs/${job.id}/bg/complete`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId: job.uploadId, parts }) });
      await api(`jobs/${job.id}/overlay`, { method: "PUT", headers: { "Content-Type": "image/png" }, body: overlay });
      if (music) {
        progress("Sending the music…", null);
        const about = new URLSearchParams({ ext: music.ext, start: String(music.start), volume: String(music.volume), from: music.from, title: music.title, credit: music.credit });
        let named = false;
        if (musicFile) {
          try { await api(`jobs/${job.id}/music?${about}&file=${musicFile}`, { method: "PUT" }); named = true; }
          catch (e) { /* no longer kept: send it */ }
        }
        if (!named) await api(`jobs/${job.id}/music?${about}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: music.file });
      }
      if (window.Studio.keepJob) await window.Studio.keepJob(job.id, snap, files, made).catch(() => {});
      await api(`jobs/${job.id}/start`, { method: "POST" });

      progress("Creating your reel. This takes about a minute. Keep the app open until it's ready.", null);
      const asked = Date.now();
      for (;;) {
        await sleepOrReturn(reelCheckEvery(Date.now() - asked));
        const st = await (await api(`jobs/${job.id}`)).json();
        if (st.state === "done") break;
        if (st.state === "failed") throw new Error(st.error || "The reel couldn't be created. Try again.");
      }
      progress("Fetching the finished reel…", null);
      const blob = await (await api(`jobs/${job.id}/reel`)).blob();
      if (reel && reel.url) URL.revokeObjectURL(reel.url);
      reel = { id: job.id, blob, url: URL.createObjectURL(blob), made };
      $("result").src = reel.url;
      syncReelPane("result");
    } catch (e) {
      syncReelPane("setup");
      $("done").textContent = e.message === "Failed to fetch" ? "The connection dropped. Check your internet and try again." : e.message;
      $("done").hidden = false;
    }
  }
  $("make-reel").addEventListener("click", makeReel);
  // "Start a new one" begins a new piece of work from what is on the canvas; "Edit this reel" goes on changing this one.
  $("again").addEventListener("click", () => { $("result").pause(); syncReelPane("setup"); $("done").hidden = true; newDraft(); saveDraft(); });
  $("edit-reel").addEventListener("click", () => { $("result").pause(); syncReelPane("setup"); $("done").hidden = true; openOn("text"); });
  $("save-reel").addEventListener("click", async () => {
    if (!reel) return;
    const file = new File([reel.blob], "ds-studio-reel.mp4", { type: "video/mp4" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); $("done").textContent = "Reel shared."; $("done").hidden = false; return; }
      catch (e) { if (e.name === "AbortError") return; }
    }
    download(reel.blob, "ds-studio-reel.mp4");
    $("done").textContent = "Reel saved to your downloads."; $("done").hidden = false;
  });

  // ---------- draft (text and settings only; the background file is not kept) ----------
  // The text and settings are also kept on the phone, so they are back at once on opening; web/drafts.js keeps the
  // whole draft (with the background and music) on the server and is told of every change by "studio:changed".
  const KEY = "entangledd.draft.v1";
  let restoring = false, changedAt = 0;
  function saveDraft() {
    if (restoring) return;
    changedAt = Date.now();
    try {
      localStorage.setItem(KEY, JSON.stringify({ blocks: state.blocks, shadow: state.shadow, fade: state.fade,
        mute: state.mute, length: state.length, style: state.style, author: state.author, shape: state.shape,
        draftId: state.draftId, of: state.of, updated: changedAt, selected: state.blocks.findIndex((b) => b.id === state.selected) }));
    } catch (e) { /* private mode or full storage: the draft just isn't kept */ }
    document.dispatchEvent(new CustomEvent("studio:changed"));
  }
  function loadDraft() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || "null");
      if (!d || !Array.isArray(d.blocks) || !d.blocks.length) return false;
      state.blocks = d.blocks.map((b) => ({ ...newBlock("", STYLES[d.style] ? d.style : "sea", 0), ...b, id: nextId++ }));
      state.shadow = d.shadow !== false; state.fade = !!d.fade; state.mute = d.mute !== false;
      state.length = Math.min(30, Math.max(5, +d.length || 8));
      state.style = STYLES[d.style] ? d.style : "sea";
      state.author = typeof d.author === "string" ? d.author : "";
      state.shape = d.shape === "post" ? "post" : "reel";
      state.draftId = typeof d.draftId === "string" && d.draftId ? d.draftId : newId();
      state.of = typeof d.of === "string" ? d.of : "";
      changedAt = +d.updated || 0;
      const sel = state.blocks[d.selected];
      if (sel) state.selected = sel.id;
      return true;
    } catch (e) { return false; }
  }

  // ---------- the whole composer as plain data, and back again (for drafts and made reels) ----------
  const newId = () => (crypto.randomUUID ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
  // Before a new piece of work begins, web/drafts.js sends what is still waiting to be saved of the present one.
  function newDraft() { if (window.Studio && window.Studio.beforeNew) window.Studio.beforeNew(); state.draftId = newId(); state.of = ""; }
  // Every value that decides what is drawn or made, so that the same snapshot always gives the same reel.
  function snapshot() {
    const bg = state.bg, m = state.music;
    return { v: 1, blocks: state.blocks.map(({ id, ...rest }) => ({ ...rest })), selected: state.blocks.findIndex((b) => b.id === state.selected),
      shadow: state.shadow, fade: state.fade, mute: state.mute, length: state.length, style: state.style, author: state.author, shape: state.shape,
      bg: bg ? { name: bg.name, type: (bg.file && bg.file.type) || "", kind: bg.kind, from: bg.from || "own", words: bg.words || "", credit: bg.credit || "" } : null,
      music: m ? { name: (m.file && m.file.name) || "", type: (m.file && m.file.type) || "", ext: m.ext, start: m.start, volume: m.volume,
        from: m.from, title: m.title, artist: m.artist, licence: m.licence, credit: m.credit } : null };
  }
  const draftFiles = () => ({ bg: state.bg ? state.bg.file : null, music: state.music ? state.music.file : null });
  // Puts a snapshot's words and settings back, at once and without waiting for anything; its background and music
  // follow with attach() as web/drafts.js fetches them. (They used to be awaited here first: when one never
  // arrived, the composer was left half put back and saved nothing more. Her case, 17 Nov 2026.)
  // Answers a ticket: which piece of work this is, and the last background and music asked for.
  function restore(snap, ids = {}) {
    restoring = true;
    try {
      stopTune();
      if (reel) $("result").pause();
      syncReelPane("setup"); $("done").hidden = true;
      bgAsk++; musicAsk++;                     // a background or music still on its way for the earlier piece is dropped
      clearBackground(); clearMusic();
      state.shape = snap.shape === "post" ? "post" : "reel";
      setShape(state.shape);
      state.blocks = (snap.blocks || []).map((b) => ({ ...newBlock("", STYLES[snap.style] ? snap.style : "sea", 0), ...b, id: nextId++ }));
      if (!state.blocks.length) state.blocks = [newBlock("", "sea", 0)];
      state.shadow = snap.shadow !== false; state.fade = !!snap.fade; state.mute = snap.mute !== false;
      state.length = Math.min(30, Math.max(5, +snap.length || 8));
      state.style = STYLES[snap.style] ? snap.style : "sea";
      state.author = typeof snap.author === "string" ? snap.author : "";
      if (ids.draftId) state.draftId = ids.draftId;
      state.of = ids.of || "";
      document.querySelectorAll("#styles button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.style === state.style)));
      $("mute").checked = state.mute; $("fade").checked = state.fade; $("shadow").checked = state.shadow;
      select((state.blocks[snap.selected] || state.blocks[0]).id);
      syncBackgroundPane(); syncMusicPane();
      redraw();
    } finally { restoring = false; }
    saveDraft();
    return { id: state.draftId, bg: bgAsk, music: musicAsk };
  }
  // The background and the music of the piece put back by restore(), each as its file arrives. A file is used only
  // while that piece is still the one open and she has not chosen (or removed) a background or music herself
  // meanwhile: hers always stays. Answers which could not be opened ("background", "music").
  async function attach(ticket, snap, files = {}) {
    const failed = [], here = () => state.draftId === ticket.id;
    if (snap.bg && files.bg && here() && bgAsk === ticket.bg) {
      const p = loadBackground(files.bg, snap.bg, { still: here, keepLength: true });
      ticket.bg = bgAsk;
      await p.catch((e) => { if (!e.stale) failed.push("background"); });
    }
    if (snap.music && files.music && here() && musicAsk === ticket.music) {
      const p = loadMusic(files.music, snap.music, { still: here });
      ticket.music = musicAsk;
      await p.catch((e) => { if (!e.stale) failed.push("music"); });
    }
    return failed;
  }
  // Nothing of her own in Create yet: no background, no music, and only the sample words of a style.
  // isBlank(true): only the sample words (a background or music may be chosen).
  function isBlank(wordsOnly) {
    const sample = STYLES[state.style].preview.text.replace(/\n\s+/g, "\n");
    return (wordsOnly === true || (!state.bg && !state.music)) && state.blocks.filter((b) => b.role !== "author").map((b) => b.text).join("\n").trim() === sample;
  }
  // Opens one editor tab (and leaves it open if it already is).
  function openOn(name) { if (openTab !== name) showTab(name); }
  // A small still of the picture for the cards in Posts (the full-size drawing is not touched).
  async function thumbBlob() {
    await fontsFor();
    const full = compose(false), c = document.createElement("canvas");
    c.width = 216; c.height = Math.round(216 * H / W);
    c.getContext("2d").drawImage(full, 0, 0, c.width, c.height);
    return toBlob(c, "image/jpeg", 0.8);
  }

  // What studio.js (Today, Library, rewording, free footage) needs from the composer.
  window.Studio = {
    api, server, loadBackground, showTab, signOut,
    faceId: { on: faceIdOn, supported: () => !!window.PublicKeyCredential, name: faceIdName, enable: faceIdEnable, disable: faceIdDisable },
    selectedText: () => (selectedBlock() ? selectedBlock().text : ""),
    currentReel: () => reel, madeWith, loadMusic,
    musicState: () => (state.music ? { title: state.music.title, start: state.music.start, volume: state.music.el.volume, time: state.music.el.currentTime, playing: !state.music.el.paused } : null),
    shape: () => state.shape,
    pictureBlob: async () => { await fontsFor(); return toBlob(compose(false), "image/jpeg", 0.92); },
    quoteText: () => state.blocks.map((b) => b.text.trim()).filter(Boolean).join("\n"),
    quoteOnly: () => state.blocks.filter((b) => b.role !== "author").map((b) => b.text.trim()).filter(Boolean).join("\n"),
    author: () => state.author,
    setAuthor, setWords, currentLook, applyLook,
    replaceSelectedText: (t) => edit((b) => { b.text = t; }),
    // Drafts (web/drafts.js). A quote put on the canvas from outside begins a new piece of work.
    setQuote: (text, author) => { newDraft(); setQuote(text, author); },
    snapshot, draftFiles, restore, attach, isBlank, openOn, thumbBlob,
    asks: () => ({ bg: bgAsk, music: musicAsk }),
    bgPlaying: () => !!(state.bg && state.bg.kind === "video" && !state.bg.el.paused),
    draft: () => ({ id: state.draftId, of: state.of, updated: changedAt }),
    setDraft: (d) => { if (d.id) state.draftId = d.id; if (d.of != null) state.of = d.of; saveDraft(); },
    newDraft: () => { newDraft(); saveDraft(); },
    storeFile: null, keepJob: null, beforeNew: null, filesComing: null,          // filled in by web/drafts.js
  };

  // ---------- start ----------
  async function start() {
    // Unlocking and the server come first and wait for nothing; the fonts and the composer get ready alongside.
    if (faceIdOn() && window.PublicKeyCredential) {
      server.locked = true; showLock();
      faceIdUnlock(true);                        // Face ID asks by itself: no tap needed
    } else if (server.token) {
      // Already signed in on this phone: begin with what the server said last time, and let it correct that if needed.
      try {
        const last = JSON.parse(store.get(STATUS_KEY) || "null");
        if (last) { applyStatus(last, false); announceReady(); }
      } catch (e) { /* nothing remembered: wait for the server */ }
    }
    statusKnown = connect();
    const coreFonts = Promise.all(FONTS.filter((f) => !f.extra).map((f) => document.fonts.load(f.css(40), "Entangledd"))).catch(() => {});
    Promise.race([coreFonts, sleep(4000)]).then(() => { textReady = true; });      // system fonts if they never arrive
    coreFonts.then(() => FONTS.filter((f) => f.extra).forEach((f) => document.fonts.load(f.css(40), "Entangledd").catch(() => {})));   // the canvas redraws itself as each arrives
    if (!loadDraft()) { newDraft(); applyStyle("sea"); }
    else select(state.selected != null && state.blocks.some((b) => b.id === state.selected) ? state.selected : state.blocks[0].id);
    document.querySelectorAll("#styles button").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.style === state.style)));
    $("mute").checked = state.mute; $("fade").checked = state.fade; $("shadow").checked = state.shadow;
    setShape(state.shape);
    syncBackgroundPane();
    if (window.matchMedia("(min-width: 900px)").matches) showTab("text");
    setInterval(checkContrast, 700);
    loop();
  }
  start();
})();

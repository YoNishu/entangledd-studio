/* Entangledd Studio composer.
   Everything is drawn on one 1080x1920 canvas, so what she sees is what gets saved. */
(() => {
  "use strict";
  const W = 1080, H = 1920;
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
    length: 8,
    style: "sea",
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
    drawText(ctx);
    if (panelOpen() || dragging) drawSelection(ctx);
  }

  function loop() {
    render();
    requestAnimationFrame(loop);
  }

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
  function checkContrast() {
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
  const tabs = ["bg", "text", "style", "save"];
  let openTab = null;
  const panelOpen = () => openTab !== null;
  function showTab(name) {
    const wide = window.matchMedia("(min-width: 900px)").matches;
    openTab = openTab === name && !wide ? null : name;   // on a phone, tapping the open tab closes it
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
    $("save-image").hidden = video;
    $("save-video").hidden = !video;
    $("len-out").textContent = state.length + " s";
    $("len").value = state.length;
    $("done").hidden = true;
  }
  $("file").addEventListener("change", () => {
    const file = $("file").files[0];
    $("file").value = "";
    if (!file) return;
    const url = URL.createObjectURL(file);
    const isVideo = file.type.startsWith("video/") || /\.(mov|mp4|m4v|webm)$/i.test(file.name);
    const fail = () => {
      URL.revokeObjectURL(url);
      say(`This ${isVideo ? "video" : "photo"} couldn't be opened. Try a different file.`);
    };
    if (isVideo) {
      const v = document.createElement("video");
      v.muted = true; v.loop = true; v.playsInline = true; v.setAttribute("playsinline", "");
      v.addEventListener("loadeddata", () => {
        clearBackground();
        state.bg = { kind: "video", el: v, url, name: file.name };
        if (isFinite(v.duration)) state.length = Math.round(Math.min(30, Math.max(5, v.duration)));
        v.play().catch(() => {});
        syncBackgroundPane();
      }, { once: true });
      v.addEventListener("error", fail, { once: true });
      v.src = url; v.load();
    } else {
      const img = new Image();
      img.onload = () => { clearBackground(); state.bg = { kind: "image", el: img, url, name: file.name }; syncBackgroundPane(); };
      img.onerror = fail;
      img.src = url;
    }
  });
  $("clear-bg").addEventListener("click", clearBackground);
  $("len").addEventListener("input", () => { state.length = +$("len").value; $("len-out").textContent = state.length + " s"; saveDraft(); });
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
    const blob = await toBlob(compose(false), "image/jpeg", 0.92);
    const file = new File([blob], "entangledd.jpg", { type: "image/jpeg" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); $("done").textContent = "Image shared."; $("done").hidden = false; return; }
      catch (e) { if (e.name === "AbortError") return; }
    }
    download(blob, "entangledd.jpg");
    $("done").textContent = "Image saved to your downloads."; $("done").hidden = false;
  });

  $("save-layer").addEventListener("click", async () => {
    download(await toBlob(compose(true), "image/png"), "entangledd-text.png");
    const settings = { length: state.length, mute: state.mute, fade: state.fade, background: state.bg ? state.bg.name : null };
    download(new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" }), "entangledd-settings.json");
    $("done").textContent = "Text layer and settings saved."; $("done").hidden = false;
  });

  // ---------- draft (text and settings only; the background file is not kept) ----------
  const KEY = "entangledd.draft.v1";
  function saveDraft() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ blocks: state.blocks, shadow: state.shadow, fade: state.fade,
        mute: state.mute, length: state.length, style: state.style }));
    } catch (e) { /* private mode or full storage: the draft just isn't kept */ }
  }
  function loadDraft() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || "null");
      if (!d || !Array.isArray(d.blocks) || !d.blocks.length) return false;
      state.blocks = d.blocks.map((b) => ({ ...newBlock("", STYLES[d.style] ? d.style : "sea", 0), ...b, id: nextId++ }));
      state.shadow = d.shadow !== false; state.fade = !!d.fade; state.mute = d.mute !== false;
      state.length = Math.min(30, Math.max(5, +d.length || 8));
      state.style = STYLES[d.style] ? d.style : "sea";
      return true;
    } catch (e) { return false; }
  }

  // ---------- start ----------
  async function start() {
    try { await Promise.all(FONTS.map((f) => document.fonts.load(f.css(40), "Entangledd"))); } catch (e) { /* falls back to system fonts */ }
    if (!loadDraft()) applyStyle("sea");
    else select(state.blocks[0].id);
    document.querySelectorAll("#styles button").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.style === state.style)));
    $("mute").checked = state.mute; $("fade").checked = state.fade; $("shadow").checked = state.shadow;
    syncBackgroundPane();
    if (window.matchMedia("(min-width: 900px)").matches) showTab("text");
    setInterval(checkContrast, 700);
    loop();
  }
  start();
})();

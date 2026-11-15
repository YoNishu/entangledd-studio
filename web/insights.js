/* D's Studio: the Insights section.
   Draws what the server works out from the page's numbers: totals for a chosen period, reach over time,
   followers, best posts, best days and times, what kinds of post do best, who saw them, and posting rhythm.
   Charts are plain SVG. Every value in a chart is also written out as text nearby, so nothing depends on
   hovering or on colour alone. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const { el, getJson, friendly, compact, day } = window.StudioKit;

  const NS = "http://www.w3.org/2000/svg";
  const svg = (tag, attrs = {}, ...kids) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    n.append(...kids.filter((k) => k != null));
    return n;
  };
  // Chart colours. The pair was checked for colour-blind separation and contrast on the card surface.
  const C = { one: "#2A9D8A", two: "#D9773F", grid: "#24485A", surface: "#16303C", ink: "#E9EFEA", soft: "#9DB4B8" };
  // One hue, darker to lighter, for "less to more" on a dark surface.
  const RAMP = ["#1D4A52", "#226560", "#27806F", "#2A9D8A", "#63C4AE"];

  const shortDay = (ms) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const pctText = (v) => (v == null ? "–" : `${v}%`);
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const niceMax = (v) => {
    if (v <= 0) return 1;
    const pow = Math.pow(10, Math.floor(Math.log10(v)));
    const step = [1, 2, 2.5, 5, 10].find((s) => s * pow >= v);
    return step * pow;
  };

  let range = "all", data = null, sortBy = "reach", dimension = null, loadNo = 0;

  // ---------- a tooltip shared by every chart in a card ----------
  function tipFor(box) {
    const tip = el("div", { className: "tip", hidden: true });
    tip.setAttribute("role", "status");
    box.append(tip);
    const show = (strong, rest, x, y) => {
      tip.replaceChildren(el("strong", { textContent: strong }), ...rest.map((t) => el("span", { textContent: t })));
      tip.hidden = false;
      const w = box.clientWidth, tw = tip.offsetWidth;
      tip.style.left = `${Math.max(0, Math.min(w - tw, x - tw / 2))}px`;
      tip.style.top = `${Math.max(0, y - tip.offsetHeight - 8)}px`;
    };
    const hide = () => { tip.hidden = true; };
    box.addEventListener("pointerleave", hide);
    return { show, hide };
  }
  // Where a point in the drawing sits inside its box, in screen pixels.
  const place = (box, drawing, x, y, W, H) => {
    const r = drawing.getBoundingClientRect(), b = box.getBoundingClientRect();
    return [r.left - b.left + (x / W) * r.width, r.top - b.top + (y / H) * r.height];
  };

  // Puts children into a node, leaving out anything that is "nothing".
  const fill = (node, ...kids) => node.replaceChildren(...kids.filter((k) => k != null));
  const head = (title, sub) => [el("h3", { textContent: title }), sub ? el("p", { className: "sub", textContent: sub }) : null];
  const emptyCard = (card, title, text) => fill(card, ...head(title), el("p", { className: "note", textContent: text }));

  // ---------- the headline number and the tiles under it ----------
  function change(now, before, label) {
    if (before == null || before === 0 || now == null) return null;
    const diff = Math.round(((now - before) / before) * 100);
    if (!Number.isFinite(diff)) return null;
    const up = diff >= 0;
    // A jump from a very small number makes a silly percentage, so past 200% the two numbers are simply named.
    const words = Math.abs(diff) > 200 ? ` ${up ? "up" : "down"} from ${compact(before)} in ${label}` : ` ${Math.abs(diff)}% ${up ? "up on" : "down on"} ${label}`;
    return el("p", { className: "delta" }, el("span", { className: up ? "up" : "down", textContent: up ? "▲" : "▼" }), words);
  }
  function renderTop(d) {
    const t = d.totals, b = d.before;
    const span = d.range === "all" ? "since your first post" : `in the last ${d.range} days`;
    const earlier = d.range === "all" ? "" : `the ${d.range} days before`;
    fill($("ins-hero"), 
      el("p", { className: "tile-label", textContent: "People reached" }),
      el("p", { className: "hero-num", textContent: compact(t.reach) }),
      el("p", { className: "sub", textContent: `${plural(t.posts, "post")} ${span}${t.avgReach ? `, about ${compact(t.avgReach)} each` : ""}.` }),
      b ? change(t.reach, b.reach, earlier) : null);

    const tile = (label, value, extra) => el("div", { className: "tile" }, el("p", { className: "tile-label", textContent: label }),
      el("p", { className: "tile-num", textContent: value }), extra || null);
    const cmp = (key) => (b ? change(t[key], b[key], earlier) : null);
    const tiles = [];
    if (d.followers) {
      const f = d.followers;
      tiles.push(tile("Followers", compact(f.now), f.change != null
        ? el("p", { className: "delta" }, el("span", { className: f.change >= 0 ? "up" : "down", textContent: f.change >= 0 ? "▲" : "▼" }), ` ${Math.abs(f.change)} since ${shortDay(Date.parse(f.since))}`)
        : el("p", { className: "delta", textContent: "Counting from today" })));
    }
    tiles.push(tile("Views", compact(t.views), cmp("views")));
    tiles.push(tile("Reactions", compact(t.interactions), cmp("interactions") || el("p", { className: "delta", textContent: "likes, comments, saves, shares" })));
    tiles.push(tile("Engagement rate", pctText(t.rate), el("p", { className: "delta", textContent: "of people reached reacted" })));
    tiles.push(tile("Saves", compact(t.saved), el("p", { className: "delta", textContent: t.saveRate != null ? `${t.saveRate}% of people reached` : "" })));
    tiles.push(tile("Shares", compact(t.shares), el("p", { className: "delta", textContent: t.shareRate != null ? `${t.shareRate}% of people reached` : "" })));
    if (t.watch != null) tiles.push(tile("Average watch time", `${t.watch} s`, el("p", { className: "delta", textContent: "per play of a reel" })));
    if (t.skip != null) tiles.push(tile("Left in the first 3 seconds", `${Math.round(t.skip)}%`, el("p", { className: "delta", textContent: "lower is better" })));
    fill($("ins-tiles"), ...tiles);
  }

  // ---------- reach over time: one column per post, or per week once there are many ----------
  function renderTrend(d) {
    const card = $("ins-trend"), bars = d.trend.bars;
    if (bars.length < 2) { emptyCard(card, "Reach over time", "This fills in once two posts have numbers."); return; }
    const byWeek = d.trend.by === "week";
    const W = 340, H = 180, L = 36, R = 6, T = 18, B = 22, pw = W - L - R, ph = H - T - B;
    const top = niceMax(Math.max(...bars.map((b) => b.reach)));
    const y = (v) => T + ph - (v / top) * ph;
    const band = pw / bars.length, bw = Math.max(3, Math.min(24, band - 2));
    const best = bars.reduce((a, b) => (b.reach > a.reach ? b : a));
    const box = el("div", { className: "chart" });
    const g = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Reach ${byWeek ? "each week" : "of each post"}, oldest first. Highest: ${compact(best.reach)}.` });
    for (const v of [0, top / 2, top]) {
      g.append(svg("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: C.grid, "stroke-width": 1 }),
        svg("text", { x: L - 6, y: y(v) + 3.5, "text-anchor": "end", class: "tick" }, compact(v)));
    }
    const tip = tipFor(box);
    bars.forEach((b, i) => {
      const x = L + i * band + (band - bw) / 2, h = Math.max(1, (b.reach / top) * ph), r = Math.min(4, bw / 2, h);
      const mark = svg("path", { d: `M${x},${T + ph} v${-(h - r)} q0,${-r} ${r},${-r} h${bw - 2 * r} q${r},0 ${r},${r} v${h - r} z`, fill: C.one, class: "mark" });
      const hit = svg("rect", { x: L + i * band, y: T, width: band, height: ph + B, fill: "transparent", tabindex: 0, class: "hit",
        "aria-label": `${shortDay(b.at)}: reach ${compact(b.reach)}. ${b.label}` });
      const on = () => { mark.classList.add("lit"); const [px, py] = place(box, g, x + bw / 2, y(b.reach), W, H); tip.show(compact(b.reach), [byWeek ? `Week of ${shortDay(b.at)}` : shortDay(b.at), b.label], px, py); };
      const off = () => mark.classList.remove("lit");
      hit.addEventListener("pointerenter", on); hit.addEventListener("pointerdown", on); hit.addEventListener("focus", on);
      hit.addEventListener("pointerleave", off); hit.addEventListener("blur", () => { off(); tip.hide(); });
      g.append(mark, hit);
      if (b === best) g.append(svg("text", { x: Math.max(L + 12, Math.min(W - R - 12, x + bw / 2)), y: y(b.reach) - 5, "text-anchor": "middle", class: "val" }, compact(b.reach)));
    });
    const lab = (i, anchor) => svg("text", { x: L + i * band + band / 2, y: H - 6, "text-anchor": anchor, class: "tick" }, shortDay(bars[i].at));
    g.append(lab(0, "start"), lab(bars.length - 1, "end"));
    box.prepend(g);
    fill(card, ...head(byWeek ? "Reach each week" : "Reach of each post", `Oldest on the left. Tap a bar to see ${byWeek ? "the week" : "the post"}.`), box);
  }

  // ---------- followers, from the app's own daily record ----------
  function renderFollowers(d) {
    const card = $("ins-followers"), f = d.followers;
    if (!f) { emptyCard(card, "Followers", d.connected ? "Your follower count couldn't be read just now." : "Connect Instagram in Settings to see followers."); return; }
    const pts = f.series;
    if (pts.length < 2) {
      emptyCard(card, "Followers", `${compact(f.now)} today. The app notes the count once a day, so this turns into a chart from tomorrow.`);
      return;
    }
    const W = 340, H = 160, L = 36, R = 40, T = 14, B = 22, pw = W - L - R, ph = H - T - B;
    const vals = pts.map((p) => p.followers), lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = Math.max(1, Math.round((hi - lo) * 0.15)), min = Math.max(0, lo - pad), max = hi + pad;
    const x = (i) => L + (i / (pts.length - 1)) * pw, y = (v) => T + ph - ((v - min) / (max - min || 1)) * ph;
    const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.followers).toFixed(1)}`).join(" ");
    const box = el("div", { className: "chart" });
    const g = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Followers from ${shortDay(Date.parse(pts[0].d))} to ${shortDay(Date.parse(pts[pts.length - 1].d))}: ${pts[0].followers} to ${f.now}.` });
    for (const v of [min, (min + max) / 2, max]) {
      g.append(svg("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: C.grid, "stroke-width": 1 }),
        svg("text", { x: L - 6, y: y(v) + 3.5, "text-anchor": "end", class: "tick" }, compact(Math.round(v))));
    }
    const last = pts.length - 1;
    g.append(
      svg("path", { d: `${line} L${x(last)},${T + ph} L${x(0)},${T + ph} Z`, fill: C.one, opacity: 0.1 }),
      svg("path", { d: line, fill: "none", stroke: C.one, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }),
      svg("circle", { cx: x(last), cy: y(f.now), r: 4, fill: C.one, stroke: C.surface, "stroke-width": 2 }),
      svg("text", { x: x(last) + 8, y: y(f.now) + 4, class: "val" }, compact(f.now)),
      svg("text", { x: L, y: H - 6, class: "tick" }, shortDay(Date.parse(pts[0].d))),
      svg("text", { x: x(last), y: H - 6, "text-anchor": "end", class: "tick" }, shortDay(Date.parse(pts[last].d))));
    // A hairline follows the finger and snaps to the nearest day.
    const hair = svg("line", { y1: T, y2: T + ph, stroke: C.soft, "stroke-width": 1, visibility: "hidden" });
    const dot = svg("circle", { r: 4, fill: C.one, stroke: C.surface, "stroke-width": 2, visibility: "hidden" });
    const hit = svg("rect", { x: L, y: T, width: pw, height: ph, fill: "transparent" });
    const tip = tipFor(box);
    const move = (e) => {
      const r = g.getBoundingClientRect(), gx = ((e.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(last, Math.round(((gx - L) / pw) * last)));
      hair.setAttribute("x1", x(i)); hair.setAttribute("x2", x(i)); hair.setAttribute("visibility", "visible");
      dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(pts[i].followers)); dot.setAttribute("visibility", "visible");
      const [px, py] = place(box, g, x(i), y(pts[i].followers), W, H);
      tip.show(String(pts[i].followers), [shortDay(Date.parse(pts[i].d))], px, py);
    };
    const leave = () => { hair.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); };
    hit.addEventListener("pointermove", move); hit.addEventListener("pointerdown", move); hit.addEventListener("pointerleave", leave);
    g.append(hair, dot, hit);
    box.prepend(g);
    const gained = f.now - pts[0].followers;
    fill(card, ...head("Followers", `${gained >= 0 ? `${gained} gained` : `${-gained} fewer`} since ${shortDay(Date.parse(pts[0].d))}, when the app began keeping count.`), box);
  }

  // ---------- best posts, by whichever number matters ----------
  const SORTS = [["reach", "Reach", (r) => r.reach, (v) => compact(v)], ["saved", "Saves", (r) => r.saved, (v) => compact(v)], ["shares", "Shares", (r) => r.shares, (v) => compact(v)],
    ["rate", "Engagement", (r) => r.rate || 0, (v) => `${v}%`], ["watch", "Watch time", (r) => r.watch || 0, (v) => `${v} s`]];
  function renderBest(d) {
    const card = $("ins-top"), rows = d.posts.filter((r) => r.reach > 0);
    if (!rows.length) { emptyCard(card, "Your best posts", "Posts appear here once Instagram has numbers for them, usually within a few hours."); return; }
    const [, , valueOf, fmt] = SORTS.find((s) => s[0] === sortBy);
    const chips = el("div", { className: "chips pick" }, ...SORTS.filter(([id]) => id !== "watch" || rows.some((r) => r.watch)).map(([id, name]) => {
      const b = el("button", { type: "button", textContent: name });
      b.setAttribute("aria-pressed", String(id === sortBy));
      b.addEventListener("click", () => { sortBy = id; renderBest(d); });
      return b;
    }));
    const ranked = [...rows].sort((a, b) => valueOf(b) - valueOf(a)).slice(0, 5), top = valueOf(ranked[0]) || 1;
    const list = el("ol", { className: "rank" }, ...ranked.map((r) => {
      const name = r.permalink ? el("a", { href: r.permalink, target: "_blank", rel: "noopener", textContent: r.quote || "A post" }) : el("span", { textContent: r.quote || "A post" });
      return el("li", {}, el("div", { className: "rank-top" }, el("p", { className: "rank-name" }, name), el("p", { className: "rank-val", textContent: fmt(valueOf(r)) })),
        el("div", { className: "meter" }, el("i", { style: `width:${Math.max(2, (valueOf(r) / top) * 100)}%` })),
        el("p", { className: "sub", textContent: `${shortDay(r.published)}, ${r.kind === "carousel" ? "carousel" : "reel"}. Reached ${compact(r.reach)}, ${compact(r.saved)} saves, ${compact(r.shares)} shares.` }));
    }));
    fill(card, ...head("Your best posts", "Tap a quote to open it on Instagram."), chips, list);
  }

  // ---------- when posts do best: day of the week against time of day ----------
  function renderTimes(d) {
    const card = $("ins-times"), t = d.times;
    const all = t.grid.flat().filter(Boolean);
    if (!all.length) { emptyCard(card, "When your posts do best", "This fills in as posts get their numbers."); return; }
    const max = Math.max(...all.map((c) => c.reach));
    const box = el("div", { className: "chart" });
    const grid = el("div", { className: "heat" });
    grid.setAttribute("role", "table");
    grid.setAttribute("aria-label", "Average reach by day of the week and time of day");
    grid.append(el("span", {}), ...t.parts.map((p) => el("span", { className: "heat-head", textContent: p })));
    const tip = tipFor(box);
    const full = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    t.grid.forEach((row, i) => {
      grid.append(el("span", { className: "heat-day", textContent: t.days[i] }));
      row.forEach((c, j) => {
        if (!c) { grid.append(el("span", { className: "heat-cell none" })); return; }
        const step = Math.min(RAMP.length - 1, Math.floor((c.reach / max) * (RAMP.length - 0.001)));
        const cell = el("span", { className: "heat-cell", textContent: compact(c.reach), tabIndex: 0 });
        cell.style.background = RAMP[step];
        cell.style.color = step >= 3 ? "#0E1B24" : C.ink;
        cell.setAttribute("aria-label", `${full[i]} ${t.parts[j].toLowerCase()}: ${plural(c.posts, "post")}, about ${compact(c.reach)} reach each`);
        const on = () => tip.show(compact(c.reach), [`${full[i]} ${t.parts[j].toLowerCase()}`, plural(c.posts, "post")], cell.offsetLeft + cell.offsetWidth / 2, cell.offsetTop);
        cell.addEventListener("pointerenter", on); cell.addEventListener("pointerdown", on); cell.addEventListener("focus", on); cell.addEventListener("blur", tip.hide);
        grid.append(cell);
      });
    });
    box.prepend(grid);
    const words = [];
    if (t.byPart.length) words.push(`Best time so far: ${t.byPart[0].name.toLowerCase()}, about ${compact(t.byPart[0].reach)} reach a post across ${plural(t.byPart[0].posts, "post")}.`);
    if (t.byDay.length) words.push(`Best day so far: ${({ Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" })[t.byDay[0].name]}, about ${compact(t.byDay[0].reach)} a post.`);
    if (!t.enough) words.push("With fewer than six posts, treat this as a first hint.");
    fill(card, ...head("When your posts do best", "Average reach for posts made at each time. Brighter means further. Times are India time."), box,
      ...words.map((w) => el("p", { className: "src", textContent: w })));
  }

  // ---------- what works: compare posts by theme, background, font and so on ----------
  function renderWorks(d) {
    const card = $("ins-works");
    if (!d.dimensions.length) {
      emptyCard(card, "What works", "Comparisons appear once there are at least two kinds of post with two posts each: two themes, say, or video against photo backgrounds.");
      return;
    }
    if (!d.dimensions.some((x) => x.id === dimension)) dimension = d.dimensions[0].id;
    const dim = d.dimensions.find((x) => x.id === dimension);
    const chips = el("div", { className: "chips pick" }, ...d.dimensions.map((x) => {
      const b = el("button", { type: "button", textContent: x.name });
      b.setAttribute("aria-pressed", String(x.id === dimension));
      b.addEventListener("click", () => { dimension = x.id; renderWorks(d); });
      return b;
    }));
    const top = dim.groups[0].reach || 1;
    const list = el("ul", { className: "rank" }, ...dim.groups.map((g) => el("li", {},
      el("div", { className: "rank-top" }, el("p", { className: "rank-name", textContent: g.name }), el("p", { className: "rank-val", textContent: compact(g.reach) })),
      el("div", { className: "meter" }, el("i", { style: `width:${Math.max(2, (g.reach / top) * 100)}%` })),
      el("p", { className: "sub", textContent: `${plural(g.posts, "post")}, ${pctText(g.rate)} engagement, about ${compact(g.saves)} saves each.` }))));
    const learnt = el("p", { className: "note", id: "works-engine" });
    fill(card, ...head("What works", "Average reach per post for each kind. Pick what to compare."), chips, list, learnt,
      el("p", { className: "note", textContent: "Only kinds with at least two posts are shown. With few posts these are hints: one strong reel can tilt a group. Backgrounds, fonts and reel lengths are only known for posts made since Insights was added." }));
    worksLine(learnt);
  }
  // What the engine (server/engine.js) takes from the same numbers, and now leans on when it suggests quotes.
  function worksLine(node) {
    getJson("engine").then((e) => {
      const w = (e && e.works) || [];
      node.textContent = w.length ? `Nishiii now leans on this when choosing your quotes: ${w.join("; ")}.` : "";
      node.hidden = !w.length;
    }).catch(() => { node.hidden = true; });
  }

  // ---------- the clearest differences, and what Nishiii would try next ----------
  function renderKnow(d, mine) {
    const card = $("ins-know");
    const kids = [...head("Worth knowing")];
    kids.push(d.standouts.length ? el("ul", {}, ...d.standouts.map((s) => el("li", { textContent: s })))
      : el("p", { className: "note", textContent: "Clear differences between kinds of post will be listed here once there are enough posts to compare." }));
    const advice = el("div", {});
    kids.push(advice);
    fill(card, ...kids);
    if (d.measured < 3 || !window.Studio.server.ai) return;
    fill(advice, el("h3", { textContent: "What Nishiii would try next" }), el("p", { className: "note", textContent: "Thinking it over…" }));
    getJson(`insights/advice?range=${d.range}`).then((a) => {
      if (mine !== loadNo) return;
      fill(advice, ...(a.advice.length ? [el("h3", { textContent: "What Nishiii would try next" }), el("ul", {}, ...a.advice.map((s) => el("li", { textContent: s })))] : []));
    }).catch(() => fill(advice));
  }

  // ---------- the page as a whole (Instagram's own totals), and who follows it ----------
  function renderPage(d) {
    const card = $("ins-reach"), p = d.page;
    if (!d.connected) { card.hidden = true; return; }
    card.hidden = false;
    if (!p || (p.reached == null && p.views == null)) {
      emptyCard(card, "Your whole page", d.range === "7" || d.range === "30"
        ? "Instagram hasn't shared page totals for this period yet. They can lag by a day or two."
        : "Instagram only reports totals for the whole page over the last 30 days. Pick 7 or 30 days above to see them.");
      return;
    }
    const kids = [...head("Your whole page", `Instagram's own totals for the last ${p.days} days. They count everything on your page, including posts not made here.`)];
    const nums = el("dl", { className: "nums" });
    const add = (name, v) => { if (v != null) nums.append(el("div", {}, el("dt", { textContent: name }), el("dd", { textContent: compact(v) }))); };
    add("Accounts reached", p.reached); add("Views", p.views); add("Accounts that reacted", p.engaged);
    kids.push(nums);
    if (p.followers != null && p.others != null && p.followers + p.others > 0) {
      const whole = p.followers + p.others, part = (v) => Math.round((v / whole) * 100);
      const split = el("div", { className: "split" }, el("i", { style: `flex:${p.followers};background:${C.one}` }), el("i", { style: `flex:${p.others};background:${C.two}` }));
      split.setAttribute("role", "img");
      split.setAttribute("aria-label", `Of the accounts reached, ${part(p.followers)}% follow you and ${part(p.others)}% don't.`);
      const key = (colour, name, v) => el("li", {}, el("i", { style: `background:${colour}` }), el("span", { textContent: name }), el("b", { textContent: `${compact(v)}, ${part(v)}%` }));
      kids.push(el("p", { className: "tile-label", textContent: "Who was reached" }), split,
        el("ul", { className: "key" }, key(C.one, "People who follow you", p.followers), key(C.two, "People who don't yet", p.others)));
    }
    fill(card, ...kids);
  }
  // Instagram names countries by two-letter code; show the country's name where the phone knows it.
  const countryName = (code) => {
    try { return new Intl.DisplayNames(undefined, { type: "region" }).of(code) || code; } catch (e) { return code; }
  };
  function renderAudience(d) {
    const card = $("ins-audience"), a = d.audience;
    if (!d.connected || !a) { card.hidden = true; return; }
    card.hidden = false;
    if (!a.available) {
      const have = a.followers || 0;
      const meter = el("div", { className: "meter tall" }, el("i", { style: `width:${Math.min(100, have)}%` }));
      meter.setAttribute("role", "img"); meter.setAttribute("aria-label", `${have} of 100 followers`);
      fill(card, ...head("Who follows you"),
        el("p", { className: "note", textContent: have < 100 ? `Instagram shares where your followers live and their ages once a page has 100 followers. You're at ${have}.` : "Instagram hasn't shared this yet. It can take a few days after reaching 100 followers." }),
        have < 100 ? meter : null);
      return;
    }
    const block = (title, rows) => {
      if (!rows.length) return [];
      const sum = rows.reduce((s, r) => s + r.value, 0) || 1, top = Math.max(...rows.map((r) => r.value));
      return [el("p", { className: "tile-label", textContent: title }), el("ul", { className: "rank tight" }, ...rows.map((r) => el("li", {},
        el("div", { className: "rank-top" }, el("p", { className: "rank-name", textContent: r.name }), el("p", { className: "rank-val", textContent: `${Math.round((r.value / sum) * 100)}%` })),
        el("div", { className: "meter" }, el("i", { style: `width:${Math.max(2, (r.value / top) * 100)}%` })))))];
    };
    fill(card, ...head("Who follows you", "From Instagram, for the followers it can place. Shares are of those listed."),
      ...block("Countries", a.country.map((r) => ({ ...r, name: countryName(r.name) }))), ...block("Cities", a.city), ...block("Ages", a.age), ...block("Women and men", a.gender));
  }

  // ---------- rhythm: how regularly posts go out ----------
  function renderRhythm(d) {
    const card = $("ins-rhythm"), r = d.rhythm, weeks = r.weeks;
    const W = 340, H = 96, L = 4, R = 4, T = 16, B = 18, pw = W - L - R, ph = H - T - B;
    const top = Math.max(1, ...weeks.map((w) => w.posts)), band = pw / weeks.length, bw = 24;
    const g = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Posts in each of the last eight weeks: ${weeks.map((w) => w.posts).join(", ")}.` });
    g.append(svg("line", { x1: L, x2: W - R, y1: T + ph, y2: T + ph, stroke: C.grid, "stroke-width": 1 }));
    weeks.forEach((w, i) => {
      const x = L + i * band + (band - bw) / 2, h = (w.posts / top) * ph, rr = Math.min(4, h);
      if (w.posts) g.append(svg("path", { d: `M${x},${T + ph} v${-(h - rr)} q0,${-rr} ${rr},${-rr} h${bw - 2 * rr} q${rr},0 ${rr},${rr} v${h - rr} z`, fill: C.one }));
      g.append(svg("text", { x: x + bw / 2, y: w.posts ? T + ph - h - 4 : T + ph - 4, "text-anchor": "middle", class: w.posts ? "val" : "tick" }, String(w.posts)));
    });
    g.append(svg("text", { x: L, y: H - 4, class: "tick" }, "8 weeks ago"), svg("text", { x: W - R, y: H - 4, "text-anchor": "end", class: "tick" }, "this week"));
    const words = [];
    if (r.streak >= 2) words.push(`${r.streak} weeks in a row with at least one post.`);
    else if (r.streak === 1) words.push("You've posted this week.");
    else if (r.sinceLast != null) words.push(`Your last post was ${r.sinceLast === 0 ? "today" : r.sinceLast === 1 ? "yesterday" : `${r.sinceLast} days ago`}.`);
    if (r.perWeek) words.push(`About ${r.perWeek} ${r.perWeek === 1 ? "post" : "posts"} a week over the last eight weeks.`);
    fill(card, ...head("Your rhythm", "Posts made in each of the last eight weeks."), el("div", { className: "chart" }, g), ...words.map((w) => el("p", { className: "src", textContent: w })));
  }

  // ---------- a file of every post's numbers, to keep ----------
  async function download() {
    const btn = $("ins-download");
    btn.disabled = true;
    try {
      const all = data && data.range === "all" ? data : await getJson("insights?range=all");
      const safe = (v) => { const s = String(v == null ? "" : v); const t = /^[=+\-@]/.test(s) ? "'" + s : s; return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
      const cols = [["Date", (r) => new Date(r.published).toISOString().slice(0, 10)], ["Kind", (r) => r.kind], ["Quote", (r) => r.quote], ["Author", (r) => r.author], ["Theme", (r) => r.theme], ["Tone", (r) => r.tone],
        ["Reach", (r) => r.reach], ["Views", (r) => r.views], ["Likes", (r) => r.likes], ["Comments", (r) => r.comments], ["Saves", (r) => r.saved], ["Shares", (r) => r.shares],
        ["Engagement %", (r) => r.rate], ["Watch time (s)", (r) => r.watch], ["Left in first 3 s (%)", (r) => r.skip], ["Background", (r) => r.background], ["Music", (r) => r.music], ["Link", (r) => r.permalink]];
      const text = [cols.map(([n]) => n).join(","), ...all.posts.map((r) => cols.map(([, f]) => safe(f(r))).join(","))].join("\r\n");
      const file = new File(["﻿" + text], "ds-studio-insights.csv", { type: "text/csv" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === "AbortError") return; }
      }
      const a = el("a", { href: URL.createObjectURL(file), download: file.name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) { $("ins-note").textContent = friendly(e); }
    finally { btn.disabled = false; }
  }
  $("ins-download").addEventListener("click", download);

  // ---------- the week at a glance (7 days): this week against last, the weekly note, what went furthest ----------
  // (It used to sit on top of Posts; every number now lives here.)
  function renderWeek(w) {
    const card = $("ins-week");
    card.hidden = !(w.thisWeek.posts || w.lastWeek.posts);
    if (card.hidden) return;
    const cell = (name, key) => el("div", {}, el("dt", { textContent: name }), el("dd", { textContent: compact(w.thisWeek[key]) }),
      el("small", { textContent: w.lastWeek.posts ? `was ${compact(w.lastWeek[key])}` : "" }));
    const kids = [el("h3", { textContent: "This week against last" }),
      el("dl", { className: "nums" }, cell("Posts", "posts"), cell("Reach", "reach"), cell("Likes", "likes"), cell("Saves", "saved"), cell("Shares", "shares"), cell("Comments", "comments"))];
    if (w.note) kids.push(el("p", { className: "q", textContent: w.note }));
    if (w.best) kids.push(el("p", { className: "src", textContent: `Went furthest: "${(w.best.quote || "a post").replace(/\s+/g, " ").slice(0, 70)}", reaching ${compact((w.best.metrics || {}).reach || (w.best.metrics || {}).views)}.` }));
    if (w.themes.length) kids.push(el("p", { className: "src", textContent: `Themes that travel furthest: ${w.themes.map((t) => `${t.name} (${compact(t.reach)})`).join(", ")}.` }));
    card.replaceChildren(...kids);
  }
  function loadWeek(mine) {
    if (range !== "7") { $("ins-week").hidden = true; return; }
    getJson("report", { cache: "no-store" }).then((w) => { if (mine === loadNo && range === "7") renderWeek(w); }).catch(() => { $("ins-week").hidden = true; });
  }

  // ---------- "Numbers updated 12 minutes ago", and Refresh ----------
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
  function showFresh() {
    const line = $("ins-fresh");
    $("ins-fresh-row").hidden = !data || !data.connected;
    if (!data || !data.connected) return;
    if (data.instagram && !data.instagram.ok) {
      const from = data.updatedAt ? ` These are the numbers from ${clockText(data.updatedAt)}.` : "";
      line.textContent = (data.instagram.paused ? "Meta has paused the app's access to Instagram for now." : "Instagram isn't answering right now.") + from;
    } else line.textContent = data.updatedAt ? `Numbers updated ${agoText(data.updatedAt)}.` : "";
  }
  setInterval(() => { if (!$("view-insights").hidden) showFresh(); }, 30000);
  $("ins-fresh-row").hidden = true;

  // ---------- loading ----------
  function render(d, mine) {
    loadWeek(mine);
    renderTop(d); renderTrend(d); renderFollowers(d); renderBest(d); renderTimes(d); renderWorks(d); renderKnow(d, mine); renderPage(d); renderAudience(d); renderRhythm(d);
  }
  // force: her Refresh (everything shown is asked for again). quiet: a follow-up while some numbers were
  // still due; nothing is dimmed and the page stays where it is.
  async function load(force = false, quiet = false, round = 0) {
    const mine = ++loadNo, body = $("ins-body"), btn = $("ins-refresh");
    if (!data) $("ins-note").textContent = "Fetching your numbers…";
    if (!quiet && data) body.classList.add("stale");      // the old numbers stay in place, dimmed, until the new ones arrive
    btn.disabled = true; btn.setAttribute("aria-busy", "true"); btn.textContent = "Refreshing…";
    try {
      const d = await getJson(`insights?range=${range}${force ? "&force=1" : ""}`, { cache: "no-store" });
      if (mine !== loadNo) return;
      data = d;
      showFresh();
      if (d.behind > 0 && round < 3) setTimeout(() => { if (!$("view-insights").hidden && mine === loadNo) load(false, true, round + 1); }, 400);
      if (!d.totals.posts) {
        body.hidden = true;
        $("ins-note").textContent = d.range === "all"
          ? "Nothing to show yet. Insights fill in once you've posted from the app."
          : `Nothing was posted in the last ${d.range} days. Try a longer period.`;
        return;
      }
      body.hidden = false;
      $("ins-note").textContent = d.connected ? "" : "Instagram isn't connected, so these are the last numbers the app saved. Connect it in Settings for fresh ones.";
      const y = window.scrollY;
      render(d, mine);
      window.scrollTo(0, y);
    } catch (e) { if (mine === loadNo) $("ins-note").textContent = friendly(e); }
    finally { if (mine === loadNo) { body.classList.remove("stale"); btn.disabled = false; btn.removeAttribute("aria-busy"); btn.textContent = "Refresh"; } }
  }
  $("ins-refresh").addEventListener("click", () => load(true));
  $("ins-range").addEventListener("click", (e) => {
    const r = e.target.dataset.range;
    if (!r || r === range) return;
    range = r;
    $("ins-range").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.range === r)));
    load();
  });

  window.Insights = { load };
})();

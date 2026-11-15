/* D's Studio: what the engine has learnt, for the Nishiii section.
   Starts when the app is open and unlocked ("studio:ready"). Shared helpers: window.StudioKit and window.Studio.
   Other signals: "studio:view" (detail = the section now showing) and "studio:settings" (Settings just opened).
   One line in #scorer-slot (#scorer-line): what the engine has learnt so far, from which signals, how sure;
   and a smaller one (#engine-sources): where today's candidates come from. From the signed-in GET /api/engine
   (server/engine.js). Under them, #scorer-today: today's quotes in the order and with the numbers Today shows
   (the same ranks from GET /api/suggestions, kept by web/studio.js as StudioKit.today()). */
(() => {
  "use strict";
  const slot = document.getElementById("scorer-slot");
  if (!slot) return;
  let busy = false, again = false;

  function sourcesLine(s) {
    const parts = [];
    if (s.found) parts.push(`${s.found} found for your books, films and series`);
    if (s.discover) parts.push(`${s.discover} from the web`);
    if (s.echo) parts.push(`${s.echo} behind posts you follow`);
    if (s.own) parts.push(`${s.own} of your own`);
    return parts.length ? `Lines to choose from: ${parts.join(", ")}, and Nishiii's own reading.` : "";
  }
  function render(s) {
    const { el } = window.StudioKit;
    const line = el("p", { className: "note", id: "scorer-line", textContent: s.line || "" });
    const src = sourcesLine(s.sources || {});
    slot.replaceChildren(line, ...(src ? [el("p", { className: "note engine-src", id: "engine-sources", textContent: src })] : []), ...todayOrder());
    slot.dataset.state = s.state || "learning";
  }

  // Today's order as Today shows it: a numeral and the first words of each quote.
  function todayOrder() {
    const { el } = window.StudioKit, items = window.StudioKit.today ? window.StudioKit.today() : [];
    if (!items.length) return [];
    const list = el("ol", { className: "scorer-today", id: "scorer-today" }, ...items.map((i) => {
      const li = el("li", {}, el("span", { className: "n", textContent: String(i.rank) }), el("span", { className: "t", textContent: i.text }));
      li.dataset.rank = i.rank; li.dataset.id = i.id; li.dataset.score = i.score;
      return li;
    }));
    return [el("p", { className: "note engine-src", id: "scorer-today-note", textContent: "Today's order, best first:" }), list];
  }

  async function load() {
    if (!window.StudioKit) return;
    if (busy) { again = true; return; }            // asked while an answer is on its way: ask once more after it
    busy = true;
    try { render(await window.StudioKit.getJson("engine")); }
    catch (e) { slot.replaceChildren(); }          // nothing to say is better than an error here
    finally { busy = false; if (again) { again = false; load(); } }
  }

  document.addEventListener("studio:view", (e) => { if (e.detail === "nishiii") load(); });
  // After "Forget everything" it starts again from nothing (web/studio.js says when that has happened).
  document.addEventListener("studio:forgot", (e) => { if (e.detail === "all") load(); });
})();

/* D's Studio: what the engine has learnt, for the Nishiii section.
   Starts when the app is open and unlocked ("studio:ready"). Shared helpers: window.StudioKit and window.Studio.
   Other signals: "studio:view" (detail = the section now showing) and "studio:settings" (Settings just opened).
   One line in #scorer-slot (#scorer-line): what the engine has learnt so far, from which signals, how sure;
   and a smaller one (#engine-sources): where today's candidates come from. From the signed-in GET /api/engine
   (server/engine.js). */
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
    slot.replaceChildren(line, ...(src ? [el("p", { className: "note engine-src", id: "engine-sources", textContent: src })] : []));
    slot.dataset.state = s.state || "learning";
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

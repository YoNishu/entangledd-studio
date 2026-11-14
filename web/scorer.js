/* D's Studio: what the taste scorer is up to.
   Starts when the app is open and unlocked ("studio:ready"). Shared helpers: window.StudioKit and window.Studio.
   Other signals: "studio:view" (detail = the section now showing) and "studio:settings" (Settings just opened).
   One line in the Nishiii section (#scorer-slot): how many picks it has learned from, or that it now ranks
   her daily quotes. The numbers come from the signed-in GET /api/scorer (server/scorer.js). */
(() => {
  "use strict";
  const slot = document.getElementById("scorer-slot");
  if (!slot) return;
  let busy = false, again = false;

  function render(s) {
    const { el } = window.StudioKit;
    const bar = el("div", { id: "scorer-bar", className: "scorer-bar" }, el("span", { id: "scorer-fill" }));
    bar.firstChild.style.width = Math.round((s.progress || 0) * 100) + "%";
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", String(s.need || 50));
    bar.setAttribute("aria-valuenow", String(Math.min(s.picks || 0, s.need || 50)));
    bar.setAttribute("aria-label", "Picks learned from");
    const line = el("p", { className: "note", id: "scorer-line", textContent: s.line || "" });
    slot.replaceChildren(...(s.state === "live" ? [line] : [line, bar]));   // no progress line once it is ranking
    slot.dataset.state = s.state || "learning";
  }

  async function load() {
    if (!window.StudioKit) return;
    if (busy) { again = true; return; }            // asked while an answer is on its way: ask once more after it
    busy = true;
    try { render(await window.StudioKit.getJson("scorer")); }
    catch (e) { slot.replaceChildren(); }          // nothing to say is better than an error here
    finally { busy = false; if (again) { again = false; load(); } }
  }

  document.addEventListener("studio:view", (e) => { if (e.detail === "nishiii") load(); });
  // After "Forget everything" the count starts again from nothing (web/studio.js says when that has happened).
  document.addEventListener("studio:forgot", (e) => { if (e.detail === "all") load(); });
})();

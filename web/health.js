/* D's Studio: the health check in Settings.
   Starts when the app is open and unlocked ("studio:ready"). Shared helpers: window.StudioKit and window.Studio.
   Other signals: "studio:view" (detail = the section now showing) and "studio:settings" (Settings just opened).

   Shows, under "Check everything", what the server last found about each key and connection:
   one calm line when all is well; the lines that need Nishith, with the steps, when not. */
(() => {
  "use strict";
  const K = window.StudioKit;
  const $ = (id) => document.getElementById(id);
  const mount = () => $("settings-health");

  // The word on each line's label, and its colour (the existing chip colours).
  const LABEL = {
    ok: () => ["ok", "Working"],
    soon: (i) => ["wait", Number.isFinite(i.daysLeft) && i.daysLeft > 0 ? (i.daysLeft === 1 ? "1 day left" : `${i.daysLeft} days left`) : "Needs Nishith soon"],
    attention: () => ["bad", "Needs Nishith"],
    off: () => ["gone", "Not set up"],
    unknown: () => ["info", "Not checked yet"],
  };
  const needsHim = (i) => i.state === "attention" || i.state === "soon";
  const when = (ms) => {
    const d = new Date(ms), now = new Date();
    const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    return d.toDateString() === now.toDateString() ? `today at ${time}` : `${K.day(ms)} at ${time}`;
  };

  let record = null, busy = false;

  function build() {
    const m = mount();
    if (!m || $("health-title")) return;
    m.append(
      K.el("h3", { id: "health-title", textContent: "Check everything" }),
      K.el("p", { className: "note", id: "health-summary", textContent: "Looking…" }),
      K.el("ul", { className: "list health", id: "health-attention", hidden: true }),
      K.el("details", { className: "explain health-rest", id: "health-rest", hidden: true },
        K.el("summary", { id: "health-rest-label" }),
        K.el("ul", { className: "list health", id: "health-rest-list" })),
      K.el("button", { className: "btn", id: "health-check", type: "button", textContent: "Check now" }),
    );
    m.setAttribute("role", "region");
    m.setAttribute("aria-labelledby", "health-title");
    $("health-summary").setAttribute("role", "status");
    $("health-check").addEventListener("click", checkNow);
  }

  function line(item) {
    const [colour, word] = (LABEL[item.state] || LABEL.unknown)(item);
    const text = K.el("div", {},
      K.el("p", { className: "main", textContent: item.title }),
      K.el("p", { className: "sub", textContent: item.line }));
    if (item.action === "reconnect") {
      const again = K.el("button", { className: "btn", id: "health-reconnect", type: "button", textContent: "Connect again" });
      again.addEventListener("click", showConnect);
      text.append(again);
    }
    const row = K.el("li", { id: `health-item-${item.id}` }, text, K.chip(colour, word));
    // The steps get the full width of the line, under the title and the label.
    if (item.fix && item.fix.length) {
      row.append(K.el("details", { className: "explain health-fix", id: `health-fix-${item.id}` },
        K.el("summary", { textContent: "How to fix it" }),
        K.el("ol", { className: "steps" }, ...item.fix.map((step) => K.el("li", { textContent: step })))));
    }
    return row;
  }

  // Brings up the Instagram token box that Settings already has, without disconnecting first:
  // the old connection stays in place until a new token is accepted.
  function showConnect() {
    const form = $("ig-connect"), box = $("ig-token");
    if (!form) return;
    form.hidden = false;
    form.scrollIntoView({ block: "center", behavior: "smooth" });
    if (box) box.focus({ preventScroll: true });
  }

  function render() {
    if (!$("health-title")) return;
    const items = (record && record.items) || [];
    const need = items.filter(needsHim), rest = items.filter((i) => !needsHim(i));
    $("health-summary").textContent = !record || !record.asOf
      ? "Not checked yet."
      : `${record.summary} Checked ${when(record.asOf)}.`;
    $("health-attention").replaceChildren(...need.map(line));
    $("health-attention").hidden = !need.length;
    $("health-rest-list").replaceChildren(...rest.map(line));
    $("health-rest").hidden = !rest.length;
    $("health-rest-label").textContent = need.length
      ? `What is working (${rest.length})`
      : `See all ${rest.length} checks`;
  }

  async function load() {
    try {
      record = await K.getJson("checkup");
      render();
      if (!record.asOf) checkNow();          // first time in Settings: nothing on record yet
    } catch (e) { $("health-summary").textContent = K.friendly(e); }
  }

  async function checkNow() {
    if (busy) return;
    busy = true;
    const btn = $("health-check");
    btn.disabled = true; btn.textContent = "Checking…";
    try { record = await K.send("checkup", "POST"); render(); }
    catch (e) { $("health-summary").textContent = K.friendly(e); }
    finally { busy = false; btn.disabled = false; btn.textContent = "Check now"; }
  }

  document.addEventListener("studio:settings", () => { build(); load(); });
})();

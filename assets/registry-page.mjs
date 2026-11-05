/** One controller for registry browsing, filtering, search and pagination. */
export function renderRegistryPage({ document, window, loadResults, renderRows }) {
  const grid = document.querySelector("#entry-grid");
  const status = document.querySelector("#status");
  // Pages can briefly pair new JS with HTML cached before pagination existed.
  function button(id, label) {
    let node = document.getElementById(id);
    if (node) return node;
    let navigation = document.querySelector(".registry-pagination");
    if (!navigation) {
      navigation = document.createElement("nav");
      navigation.className = "registry-pagination";
      navigation.setAttribute("aria-label", "Registry pages");
      grid.after(navigation);
    }
    node = document.createElement("button");
    node.id = id;
    node.type = "button";
    node.textContent = label;
    navigation.append(node);
    return node;
  }
  const previous = button("registry-previous", "Previous");
  const next = button("registry-next", "Next");
  const refresh = button("registry-refresh", "Retry");
  const controls = new Map([
    ["q", document.querySelector("#query")], ["arxiv", document.querySelector("#arxiv-query")],
    ["msc", document.querySelector("#msc-query")], ["order", document.querySelector("#order-by")],
    ["from", document.querySelector("#date-from")], ["to", document.querySelector("#date-to")],
  ]);
  let controller = null;
  let generation = 0;
  let timer;
  let page = null;
  let changed = false;
  const parameters = () => new URLSearchParams(window.location.search);
  const view = () => parameters().get("view") === "cards" ? "cards" : "table";
  const selectedTrust = () => document.querySelector(".filter.active")?.dataset.trust || "all";
  const mark = (selector, attribute, value) => document.querySelectorAll(selector).forEach(button => {
    const active = button.dataset[attribute] === value;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const readUrl = () => {
    const p = parameters();
    for (const [name, input] of controls) if (input) input.value = p.get(name) || (name === "order" ? "updated" : "");
    mark(".filter", "trust", p.get("trust") || "all");
    mark(".view-button", "view", view());
  };
  const navigate = (p, replace = false) => {
    const url = new URL(window.location.href);
    url.search = p.toString();
    if (url.href !== window.location.href) window.history[replace ? "replaceState" : "pushState"](null, "", url);
  };
  const busy = () => {
    controller?.abort();
    generation += 1;
    grid.setAttribute("aria-busy", "true");
    status.hidden = false;
    status.className = "status";
    status.textContent = page ? "Updating results… Previous results are still shown." : "Reading the Palomar registry…";
    previous.disabled = next.disabled = true;
    refresh.hidden = true;
  };
  async function load() {
    window.clearTimeout(timer);
    busy();
    const current = generation;
    controller = new AbortController();
    const attempt = controller;
    const deadline = window.setTimeout(() => attempt.abort(), 30_000);
    try {
      const loaded = await loadResults(parameters(), { signal: controller.signal });
      if (current !== generation) return;
      page = loaded;
      changed = false;
      renderRows(page.entries, view(), parameters().get("order") || "updated");
      for (const name of ["results", "projects"]) {
        const metric = document.querySelector(`#metric-${name}`);
        if (metric) metric.textContent = String(page.totals[name]);
      }
      status.textContent = page.message || (page.entries.length
        ? `Showing ${page.entries.length} result${page.entries.length === 1 ? "" : "s"}${page.next ? "; more results are available" : ""}.`
        : "No registry entries match these search terms and filters.");
      previous.disabled = !page.previous;
      next.disabled = !page.next;
    } catch (error) {
      if (current !== generation) return;
      changed = error.code === "registry_changed";
      status.className = "status error";
      status.textContent = `${error.name === "AbortError" ? "The registry request timed out." : error.message}${page ? " Previously loaded results are still shown." : ""}`;
      refresh.textContent = changed ? "Refresh results" : "Retry";
      refresh.hidden = false;
    } finally {
      window.clearTimeout(deadline);
      if (current === generation) grid.setAttribute("aria-busy", "false");
    }
  }
  function apply() {
    const p = parameters();
    for (const [name, control] of controls) {
      const value = control?.value.trim();
      if (value) p.set(name, value); else p.delete(name);
    }
    const trust = selectedTrust();
    if (trust !== "all") p.set("trust", trust); else p.delete("trust");
    p.delete("cursor");
    navigate(p);
    void load();
  }
  for (const control of controls.values()) {
    control?.addEventListener("input", () => {
      window.clearTimeout(timer);
      busy();
      timer = window.setTimeout(apply, 300);
    });
    control?.addEventListener("change", apply);
  }
  document.querySelector("#registry-search")?.addEventListener("submit", event => { event.preventDefault(); apply(); });
  document.querySelectorAll(".filter").forEach(button => button.addEventListener("click", () => {
    mark(".filter", "trust", button.dataset.trust);
    apply();
  }));
  document.querySelectorAll(".view-button").forEach(button => button.addEventListener("click", () => {
    const p = parameters();
    if (button.dataset.view === "table") p.delete("view"); else p.set("view", button.dataset.view);
    navigate(p);
    mark(".view-button", "view", view());
    if (page) renderRows(page.entries, view(), p.get("order") || "updated");
  }));
  for (const [button, key] of [[previous, "previous"], [next, "next"]]) {
    button.addEventListener("click", () => {
      if (!page?.[key]) return;
      const p = parameters();
      p.set("cursor", page[key]);
      navigate(p);
      void load();
    });
  }
  refresh.addEventListener("click", () => {
    if (changed) { const p = parameters(); p.delete("cursor"); navigate(p, true); }
    void load();
  });
  window.addEventListener("popstate", () => { readUrl(); void load(); });
  readUrl();
  void load();
}

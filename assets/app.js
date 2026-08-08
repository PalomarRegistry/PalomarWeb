import {
  RESULT_ORIGIN_LABELS,
  REPOSITORY_ROLE_LABELS,
  isLoopbackHostname,
  pinnedRepositoryDirectoryUrl,
  safeDataUrl,
  safeExternalUrl,
  safeInternalUrl,
  recentUrl,
  validateRecent,
  workflowRunId,
} from "./security.mjs";
import { createRegistrySearch, validateSearchQuery } from "./searching.mjs";
import {
  renderChallengePage,
  renderEntryPage,
} from "./entry-pages.mjs";
import { createChallengePresentation } from "./challenge-presentation.mjs";
import { createEntryHistoryPresentation } from "./entry-history-presentation.mjs";
import { createFormalizationPresentation } from "./formalization-presentation.mjs";
import { createRegistryLoader } from "./registry-loading.mjs";
import {
  decorateCardSet,
  sourceFileUrl,
  sourceLocation,
  topSourceLocation,
} from "./source-preservation.mjs";

const params = new URLSearchParams(window.location.search);
const ARXIV_FILTER_RE = /^[a-z]+(?:-[a-z]+)*(?:\.[A-Za-z-]+)?$/;
const MSC2020_FILTER_RE = /^[0-9]{2}(?:[A-Z][0-9]{2}|-[0-9]{2})$/;
const FILTER_UPDATE_DELAY_MS = 200;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function anchor(text, href, className) {
  const node = el("a", className, text);
  node.href = href.href;
  return node;
}

function externalLink(text, href, className) {
  return anchor(text, safeExternalUrl(href), className);
}

function dataLink(text, href, className) {
  return anchor(text, safeDataUrl(href, window.location.href), className);
}

function internalLink(text, href, className) {
  return anchor(text, safeInternalUrl(href, window.location.href), className);
}

function setOptionalText(selector, text) {
  const node = document.querySelector(selector);
  if (node) node.textContent = text;
}

const {
  dataSource,
  fetchJson,
  loadAvailabilityBounded,
  loadEntry,
} = createRegistryLoader({
  fetch: (...args) => fetch(...args),
  location: window.location,
  warn: (message) => console.warn(message),
});

const searchRegistry = createRegistrySearch(fetchJson);

function authorNames(entry) {
  return entry.authors.map((author) => author.name).join(", ");
}

function theoremNames(entry) {
  return entry.formalization.theorem_names.join(", ");
}

function classification(entry) {
  return {
    arxiv: Array.isArray(entry.classification?.arxiv) ? entry.classification.arxiv : [],
    msc2020: Array.isArray(entry.classification?.msc2020) ? entry.classification.msc2020 : [],
  };
}

function categoryTokens(entry) {
  const categories = classification(entry);
  const tokens = el("span", "category-tokens");
  for (const code of categories.arxiv) tokens.append(el("code", "arxiv-category", code));
  for (const code of categories.msc2020) tokens.append(el("code", "msc-category", `MSC ${code}`));
  if (!tokens.children.length) tokens.append(el("span", "unclassified", "Not recorded"));
  return tokens;
}

/**
 * The day this version was registered.
 *
 * Not `accepted_at`, which is the *result's* date: the identifier carries it,
 * every later version inherits it, and it is already on the card beside this.
 * So a v2 labelled by it named a day years before that version existed, and on
 * a page ordered by registration the visible dates ran out of order.
 *
 * There is no fallback to the review's date any more. A review's verdict and
 * the registration it leads to are different moments, and the record carries
 * `registered_at` for exactly this.
 */
function registrationDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value || "")) {
    throw new Error("entry is missing a valid registration date");
  }
  return value.slice(0, 10);
}

function displayDate(value) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));
}

/**
 * A moment, to the minute, in UTC.
 *
 * The record is immutable and its timestamps are UTC, so they are shown in UTC
 * rather than wherever the reader happens to be: two people quoting the same
 * entry should quote the same time.
 */
function displayTimestamp(value) {
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) return String(value);
  return `${new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(when)} UTC`;
}

const {
  solutionMetadata,
  statementDependencies,
  trustBadge,
} = createFormalizationPresentation({ document });

function entryCard(
  entry,
  { versionCount = null, current = false, registeredAt = entry.registered_at } = {},
) {
  const categories = classification(entry);
  const card = el("article", "entry-card");
  card.dataset.trust = entry.trust.level;
  card.dataset.arxiv = categories.arxiv.join(" ");
  card.dataset.msc = categories.msc2020.join(" ");
  card.dataset.search = [
    entry.title,
    entry.abstract,
    authorNames(entry),
    theoremNames(entry),
    entry.source.repository,
    entry.source.project_path || "",
    entry.id,
    ...categories.arxiv,
    ...categories.msc2020,
  ].join(" ").toLowerCase();

  const top = el("div", "card-top");
  const identity = el("div", "card-identity");
  identity.append(
    el("span", "entry-id", `${entry.id} v${entry.version}${current ? " · current" : ""}`),
    el("span", "entry-date", `Registered ${displayDate(registrationDate(registeredAt))}`),
  );
  top.append(identity, trustBadge(entry));
  const title = el("h3");
  title.append(internalLink(entry.title, localPageUrl("entry.html", entry)));
  const abstract = el("p", "card-abstract", entry.abstract);
  const meta = el("div", "card-meta");
  const authors = el("div");
  authors.append(el("small", "", "Authors"), el("span", "", authorNames(entry)));
  const theorems = el("div");
  theorems.append(el("small", "", "Theorems"), el("span", "", theoremNames(entry)));
  const subjects = el("div", "card-subjects");
  subjects.append(el("small", "", "Subjects"), categoryTokens(entry));
  meta.append(authors, theorems, subjects);
  if (entry.source.project_path) {
    const project = el("div", "card-project");
    project.append(
      el("small", "", "Project directory"),
      el("span", "", entry.source.project_path),
    );
    meta.append(project);
  }
  const footer = el("div", "card-footer");
  const location = topSourceLocation(entry, null);
  const historyUrl = new URL(localPageUrl("entry.html", entry));
  historyUrl.hash = "version-history";
  footer.append(
    externalLink(
      entry.source.repository,
      pinnedRepositoryDirectoryUrl(entry.source.repository, entry.source.commit),
      "repo-link",
    ),
    internalLink("View record", localPageUrl("entry.html", entry)),
  );
  footer.append(
    externalLink(
      "Palomar preserved copy",
      pinnedRepositoryDirectoryUrl(location.archiveRepository, entry.source.commit),
      "archive-link",
    ),
  );
  if (versionCount > 1) {
    const historyLink = internalLink(
      `${versionCount} versions`,
      historyUrl,
      "version-history-link",
    );
    historyLink.setAttribute("aria-label", `${versionCount} versions of ${entry.id}`);
    footer.append(historyLink);
  }
  card.append(top, title, abstract, meta, footer);
  return card;
}

let landingSuppressed = false;
let landingStatusHidden = document.querySelector("#status")?.hidden ?? true;

function setLandingStatusHidden(hidden) {
  landingStatusHidden = hidden;
  const status = document.querySelector("#status");
  if (status) status.hidden = landingSuppressed || hidden;
}

function setLandingSuppressed(suppressed) {
  landingSuppressed = suppressed;
  document.body.classList.toggle("registry-searching", suppressed);
  const toolbar = document.querySelector(".toolbar");
  const status = document.querySelector("#status");
  const grid = document.querySelector("#entry-grid");
  if (toolbar) toolbar.hidden = suppressed;
  if (grid) grid.hidden = suppressed;
  if (status) status.hidden = suppressed || landingStatusHidden;
}

async function renderIndex() {
  const status = document.querySelector("#status");
  const grid = document.querySelector("#entry-grid");
  try {
    status.className = "status";
    status.textContent = "Reading the Palomar database…";
    setLandingStatusHidden(false);
    grid.replaceChildren();
    const { databaseBase, availabilityUrl } = dataSource();
    const availabilityPromise = loadAvailabilityBounded(availabilityUrl);
    // The publisher projects every landing-card field from validated canonical
    // entries into this bounded newest-first document. Rendering the selection
    // therefore costs one summary read, not one record read per card.
    const recent = validateRecent(await fetchJson(recentUrl(databaseBase)));
    const entries = recent.entries;
    // GitHub Pages may briefly pair HTML and JavaScript from adjacent deployments.
    // Metrics are presentation-only, so a removed metric must not abort the registry.
    setOptionalText("#metric-results", String(entries.length));
    setOptionalText(
      "#metric-projects",
      new Set(entries.map((entry) => entry.source.repository)).size,
    );
    if (!entries.length) {
      setLandingStatusHidden(false);
      status.textContent =
        "The telescope is ready. No entries have been published yet; the first accepted database PR will appear here automatically.";
      status.classList.add("empty");
      return true;
    }
    setLandingStatusHidden(true);
    status.textContent = "";
    status.className = "status";
    const cards = entries.map((entry) =>
      entryCard(entry, {
        versionCount: entry.versions,
        current: true,
        registeredAt: entry.published_at,
      }));
    grid.append(...cards);
    void availabilityPromise.then((availability) => {
      decorateCardSet(cards, entries, availability, "Landing card");
    }).catch((error) => {
      console.warn(`Landing card source availability could not be applied: ${error.message}`);
    });
    let trust = "all";
    const search = document.querySelector("#search");
    // The fallback selectors keep new JavaScript compatible with cached HTML
    // from the previous GitHub Pages deployment.
    const arxiv = document.querySelector("#arxiv-query, #arxiv-filter");
    const msc = document.querySelector("#msc-query, #msc-filter");
    const fillCategories = (list, values) => {
      if (!list) return;
      for (const value of [...values].sort()) {
        const option = el("option", "", value);
        option.value = value;
        list.append(option);
      }
    };
    const arxivOptions = document.querySelector("#arxiv-options") ||
      (arxiv?.tagName === "SELECT" ? arxiv : null);
    const mscOptions = document.querySelector("#msc-options") ||
      (msc?.tagName === "SELECT" ? msc : null);
    fillCategories(
      arxivOptions,
      new Set(entries.flatMap((entry) => classification(entry).arxiv)),
    );
    fillCategories(
      mscOptions,
      new Set(entries.flatMap((entry) => classification(entry).msc2020)),
    );
    const applyCategoryParameter = (control, name, maximumLength) => {
      if (!control || !params.has(name)) return;
      const value = params.get(name).slice(0, maximumLength);
      if (control.tagName === "SELECT" &&
          ![...control.options].some((option) => option.value === value)) {
        const option = el("option", "", value);
        option.value = value;
        control.append(option);
      }
      control.value = value;
    };
    applyCategoryParameter(arxiv, "arxiv", 32);
    applyCategoryParameter(msc, "msc", 5);
    const update = () => {
      const query = search.value.trim().toLowerCase();
      const arxivValue = arxiv?.value.trim() || "";
      const mscValue = msc?.value.trim() || "";
      const arxivInvalid = Boolean(arxivValue && !ARXIV_FILTER_RE.test(arxivValue));
      const mscInvalid = Boolean(mscValue && !MSC2020_FILTER_RE.test(mscValue));
      let shown = 0;
      for (const card of grid.children) {
        const visible =
          (trust === "all" || card.dataset.trust === trust) &&
          (!arxivValue || (!arxivInvalid && card.dataset.arxiv.split(" ").includes(arxivValue))) &&
          (!mscValue || (!mscInvalid && card.dataset.msc.split(" ").includes(mscValue))) &&
          (!query || card.dataset.search.includes(query));
        card.hidden = !visible;
        if (visible) shown += 1;
      }
      setLandingStatusHidden(shown !== 0);
      const classificationQuery = [
        arxivValue && `arXiv ${arxivValue}`,
        mscValue && `MSC2020 ${mscValue}`,
      ].filter(Boolean);
      const invalidClassifications = [
        arxivInvalid && "arXiv",
        mscInvalid && "MSC2020",
      ].filter(Boolean);
      status.textContent = shown
        ? ""
        : invalidClassifications.length
          ? `No registry entries match the current filters. Invalid classification code format: ${invalidClassifications.join(", ")}.`
          : classificationQuery.length
          ? `No registry entries match the current filters. Classification query: ${classificationQuery.join(", ")}.`
          : "No registry entries match those filters.";
    };
    let updateTimer;
    const scheduleUpdate = () => {
      window.clearTimeout(updateTimer);
      updateTimer = window.setTimeout(update, FILTER_UPDATE_DELAY_MS);
    };
    search.addEventListener("input", scheduleUpdate);
    for (const control of [arxiv, msc]) {
      for (const eventName of ["input", "change", "search"]) {
        control?.addEventListener(eventName, scheduleUpdate);
      }
    }
    document.querySelectorAll(".filter").forEach((button) => {
      button.addEventListener("click", () => {
        trust = button.dataset.trust;
        document.querySelectorAll(".filter").forEach((candidate) => {
          const active = candidate === button;
          candidate.classList.toggle("active", active);
          candidate.setAttribute("aria-pressed", String(active));
        });
        update();
      });
    });
    update();
    return true;
  } catch (error) {
    setLandingStatusHidden(false);
    status.textContent = `The registry could not be loaded: ${error.message}`;
    status.className = "status error";
    return false;
  }
}

let landingLoad = null;
function ensureLanding() {
  if (!landingLoad) {
    const active = renderIndex();
    landingLoad = active;
    void active.then((loaded) => {
      if (!loaded && landingLoad === active) landingLoad = null;
    });
  }
  return landingLoad;
}

function searchPageUrlFor(query) {
  const target = new URL("index.html", window.location.href);
  target.search = "";
  for (const [name, value] of params.entries()) {
    if (name !== "q") target.searchParams.set(name, value);
  }
  if (query) target.searchParams.set("q", query);
  return safeInternalUrl(target, window.location.href);
}

let searchGeneration = 0;
let activeSearchController = null;

function renderSearchCards(results, entries) {
  const cards = entries.map((entry) => entryCard(entry));
  results.replaceChildren(...cards);
  return cards;
}

function clearSearchQueryWarning(input) {
  input?.removeAttribute("aria-invalid");
  input?.removeAttribute("aria-describedby");
}

function showSearchQueryWarning(input, status, error) {
  status.hidden = false;
  status.textContent = error.message;
  status.classList.add("warning");
  input?.setAttribute("aria-invalid", "true");
  input?.setAttribute("aria-describedby", status.id);
}

async function renderSearch(query) {
  const generation = searchGeneration + 1;
  searchGeneration = generation;
  activeSearchController?.abort(new Error("superseded registry search"));
  activeSearchController = null;
  const status = document.querySelector("#search-status");
  const results = document.querySelector("#search-results");
  const input = document.querySelector("#query");
  if (!status || !results) return;
  results.replaceChildren();
  status.className = "status";
  let asked;
  try {
    asked = validateSearchQuery(query);
    clearSearchQueryWarning(input);
  } catch (error) {
    setLandingSuppressed(Boolean(query));
    if (error instanceof RangeError) showSearchQueryWarning(input, status, error);
    else {
      status.hidden = false;
      status.textContent = `The search could not be run: ${error.message}`;
      status.classList.add("error");
    }
    return;
  }
  const searching = Boolean(asked.length);
  setLandingSuppressed(searching);
  if (!searching) {
    status.hidden = true;
    ensureLanding();
    return;
  }
  const controller = new AbortController();
  activeSearchController = controller;
  status.hidden = false;
  status.textContent = "Searching the registry…";
  try {
    const { databaseBase, availabilityUrl } = dataSource();
    const found = await searchRegistry(query, databaseBase, { signal: controller.signal });
    if (generation !== searchGeneration) return;
    for (const problem of found.problems) {
      console.warn(
        `Search ${problem.stage} ${problem.item} could not be loaded: ` +
          `${problem.reason?.message || String(problem.reason)}`,
      );
    }
    // Availability changes only where a source link points. It must never hold
    // verified registry results behind its own long timeout.
    const cards = renderSearchCards(results, found.entries);
    if (found.entries.length) {
      void loadAvailabilityBounded(availabilityUrl).then((availability) => {
        if (availability !== null && generation === searchGeneration) {
          decorateCardSet(cards, found.entries, availability, "Search card");
        }
      }).catch((error) => {
        if (generation === searchGeneration) {
          console.warn(`Search card source availability could not be applied: ${error.message}`);
        }
      });
    }
    if (!found.terms.length) {
      // Every word of the query is one the indexer drops, so there is nothing
      // to ask for. Saying which words those were is the difference between an
      // answer and an apparently empty registry.
      status.textContent =
        `Every word of that search is too common to be indexed: ${found.dropped.join(", ")}.`;
      return;
    }
    const degraded = found.problems.length
      ? found.timedOut
        ? "the search deadline expired before every request completed"
        : `${found.problems.length} data request${found.problems.length === 1 ? "" : "s"} failed`
      : "";
    if (!found.entries.length) {
      // Naming the words nothing carries is what turns "no results" into
      // something a reader can act on. The words the indexer drops are not
      // among them: they left the query before it was asked.
      status.textContent = degraded
        ? `No verified results could be shown. The search is incomplete because ${degraded}. Try again.`
        : found.missing.length
        ? `No result carries all of: ${found.terms.join(", ")}. Nothing is indexed under `
          + `${found.missing.join(", ")}.`
        : `No result carries all of: ${found.terms.join(", ")}.`;
      status.classList.toggle("warning", Boolean(degraded));
      return;
    }
    status.hidden = found.whole && !degraded;
    status.textContent = degraded
      ? `Showing ${found.entries.length} verified result${found.entries.length === 1 ? "" : "s"}. `
        + `The search is incomplete because ${degraded}.`
      : found.whole
      ? ""
      : `Showing the newest ${found.entries.length} results; narrow the search for older ones.`;
    status.classList.toggle("warning", Boolean(degraded));
  } catch (error) {
    if (generation !== searchGeneration) return;
    if (error instanceof RangeError) showSearchQueryWarning(input, status, error);
    else {
      status.textContent = `The search could not be run: ${error.message}`;
      status.classList.add("error");
    }
  } finally {
    if (generation === searchGeneration) activeSearchController = null;
  }
}

function wireSearch() {
  const form = document.querySelector("#registry-search");
  const input = document.querySelector("#query");
  if (!form || !input) return false;
  const initial = params.get("q") || "";
  input.value = initial;
  form.addEventListener("submit", (event) => {
    // The page's own content security policy forbids form submission, which is
    // right: nothing here posts anywhere. The query is a link to this page.
    event.preventDefault();
    const rawQuery = input.value;
    try {
      // Validate before trimming or constructing the shareable URL. This also
      // keeps an over-limit value out of history.replaceState.
      validateSearchQuery(rawQuery);
    } catch (error) {
      renderSearch(rawQuery);
      return;
    }
    const query = rawQuery.trim();
    window.history.replaceState(null, "", searchPageUrlFor(query));
    renderSearch(query);
  });
  if (initial) renderSearch(initial);
  return Boolean(initial);
}

function detailRow(label, value) {
  const row = el("div", "detail-row");
  row.append(el("dt", "", label), el("dd", "", String(value)));
  return row;
}

/**
 * A note beside a value, for facts that matter but do not deserve a row.
 *
 * A digest is worth publishing and almost never worth reading in full, so it
 * is shown short, in a smaller face, with the whole of it one hover away.
 */
function annotation(text, full) {
  const note = el("span", "detail-note", text);
  if (full) note.title = full;
  return note;
}

function digestNote(sha256) {
  return annotation(`sha256 ${String(sha256).slice(0, 12)}\u2026`, sha256);
}

function externalDetailRow(labelText, text, href, note) {
  const row = el("div", "detail-row");
  row.append(el("dt", "", labelText));
  const value = el("dd");
  value.append(externalLink(text, href));
  if (note) value.append(" ", note);
  row.append(value);
  return row;
}

function dataDetailRow(labelText, text, href) {
  const row = el("div", "detail-row");
  row.append(el("dt", "", labelText));
  const value = el("dd");
  value.append(dataLink(text, href));
  row.append(value);
  return row;
}

function evidenceDataUrl(entry, databaseBase, filename) {
  return new URL(`${entry.verification.evidence_path}${filename}`, databaseBase);
}

function localPageUrl(page, entry) {
  const target = new URL(page, window.location.href);
  target.search = "";
  target.searchParams.set("id", entry.id);
  target.searchParams.set("version", String(entry.version));
  if (isLoopbackHostname(window.location.hostname)) {
    for (const name of ["database", "render-base"]) {
      if (params.has(name)) target.searchParams.set(name, params.get(name));
    }
  }
  return safeInternalUrl(target, window.location.href);
}

const challengePresentation = createChallengePresentation({
  fetchJson,
  document,
  window,
  localPageUrl,
});

const {
  setCanonicalEntryPage,
  versionHistory,
  versionNotice,
} = createEntryHistoryPresentation({ document, localPageUrl, window });

/** One kind of assurance, named so the two can be told apart at a glance. */
function assurance(kind, sentence) {
  const paragraph = el("p");
  paragraph.append(el("strong", "", `${kind}: `), document.createTextNode(sentence));
  return paragraph;
}

/**
 * The repository licence, in one row rather than four.
 *
 * The four said: which file, what it declares, what was detected in it, and
 * its digest. Three of those are the same fact when they agree, which is the
 * ordinary case; the interesting case is when they disagree, and that is the
 * one worth spelling out.
 */
function licenceRow(entry, availability) {
  const licence = entry.source.license;
  const declared = licence.declared_identifier;
  const detected = licence.detected_identifier;
  const agreed = String(declared) === String(detected);
  const row = el("div", "detail-row");
  row.append(el("dt", "", "Repository licence"));
  const value = el("dd");
  value.append(
    agreed
      ? el("span", "", String(declared))
      : el("span", "licence-disagreement", `declared ${declared}, detected ${detected}`),
    " ",
    externalLink(licence.path, sourceFileUrl(entry, licence.path, availability)),
    " ",
    digestNote(licence.sha256),
  );
  row.append(value);
  return row;
}

function acceptanceCallout(entry, databaseBase) {
  const callout = el("div", "acceptance-callout");
  const check = el("span", "acceptance-check", "✓");
  check.setAttribute("aria-hidden", "true");
  const copy = el("div");
  const evidenceLinks = el("p", "certificate-evidence-links");
  evidenceLinks.append(
    dataLink(
      "Archived mechanical report",
      evidenceDataUrl(entry, databaseBase, "mechanical-report.json"),
    ),
    " · ",
    dataLink(
      "Archived editorial review",
      evidenceDataUrl(entry, databaseBase, "review.json"),
    ),
  );
  evidenceLinks.append(
    " · ",
    dataLink(
      "Source preservation receipt",
      evidenceDataUrl(entry, databaseBase, "source-archive.json"),
    ),
  );
  copy.append(
    el("strong", "", `Registered on ${displayDate(registrationDate(entry.registered_at))}`),
    assurance(
      "Mechanical assurance",
      "Comparator checked that the recorded Solution proves the recorded formal Challenge under the listed axiom and dependency rules, and both Lean's kernel and NanoDa accepted the exported proof.",
    ),
    assurance(
      "Editorial assurance",
      "an AI-mediated review judged whether that formal Challenge matches the informal mathematical claim under the recorded policy. This is not human peer review or a novelty certificate.",
    ),
    evidenceLinks,
  );
  callout.append(check, copy);
  return callout;
}

/**
 * The MSC2020 descriptions, fetched once and only where they are shown.
 *
 * A code is not a subject: nobody reads 52C10 and thinks "Erdős problems in
 * discrete geometry". The table is large enough that it is not worth loading
 * for a page with no classification on it, and unimportant enough that a page
 * whose fetch fails should still render.
 */
let mscDescriptions = null;

async function mscGlossary() {
  if (mscDescriptions) return mscDescriptions;
  try {
    const response = await fetch(new URL("assets/data/msc2020-codes.json", document.baseURI));
    mscDescriptions = response.ok ? await response.json() : {};
  } catch {
    mscDescriptions = {};
  }
  return mscDescriptions;
}

/** Every other entry sharing a classification, which is what a code is for. */
function classificationSearchUrl(scheme, code) {
  const url = new URL("index.html", document.baseURI);
  url.searchParams.set(scheme, code);
  return url;
}

function sourceAvailabilityNotice(entry, availability) {
  const location = topSourceLocation(entry, availability);
  const notice = el("section", "source-availability");
  const original = pinnedRepositoryDirectoryUrl(
    location.originalRepository,
    location.commit,
    entry.source.project_path || ".",
  );
  const archived = pinnedRepositoryDirectoryUrl(
    location.archiveRepository,
    location.commit,
    entry.source.project_path || ".",
  );
  if (location.originalStatus === "missing" && location.archiveStatus === "missing") {
    notice.classList.add("unrecoverable");
    notice.append(
      el("strong", "", "No working preserved source location"),
      el("p", "", "Both the recorded original and Palomar's preserved copy are currently unavailable."),
      externalLink("Recorded original location", original),
      " · ",
      externalLink("Recorded Palomar copy", archived),
    );
  } else if (location.originalStatus === "missing") {
    notice.classList.add("original-missing");
    const checked = location.checkedAt ? ` (checked ${location.checkedAt})` : "";
    notice.append(
      el("strong", "", "Original source unavailable"),
      el("p", "", `Source links on this page now use Palomar's preserved copy${checked}.`),
      externalLink("Palomar preserved copy", archived),
      " · ",
      externalLink("Recorded original location", original),
    );
  } else if (location.archiveStatus === "missing") {
    notice.classList.add("archive-missing");
    const originalConfirmed = location.originalStatus === "available";
    notice.append(
      el("strong", "", "Source preservation degraded"),
      el(
        "p",
        "",
        originalConfirmed
          ? "The original source still works, but Palomar's preserved copy is unavailable."
          : "Palomar's preserved copy is unavailable. The recorded original location remains " +
            "linked, but its current availability has not been confirmed.",
      ),
      externalLink(originalConfirmed ? "Original source" : "Recorded original location", original),
      " · ",
      externalLink("Recorded Palomar copy", archived),
    );
  } else {
    notice.classList.add("preserved");
    notice.append(
      el("strong", "", "Source preserved by Palomar"),
      " ",
      externalLink("Palomar preserved copy", archived),
    );
  }
  return notice;
}

function classificationSection(entry) {
  const categories = classification(entry);
  const section = el("section", "entry-classification");
  const heading = el("div", "section-heading");
  const title = el("div");
  title.append(el("div", "eyebrow", "Discoverability"), el("h2", "", "Subject classification"));
  heading.append(title);
  section.append(heading);
  const details = el("dl", "details classification-details");
  const glossed = [];

  const categoryRow = (label, values, scheme) => {
    const row = el("div", "detail-row");
    row.append(el("dt", "", label));
    const value = el("dd", "category-list");
    for (const code of values) {
      // The code itself is the link: a reader who wants the other entries in
      // a subject clicks the subject, rather than a separate word beside it.
      const link = internalLink(code, classificationSearchUrl(scheme, code), "category-link");
      const spoken = el("span", "visually-hidden", ` — other entries classified ${code}`);
      link.append(spoken);
      if (scheme === "msc") glossed.push({ code, link, spoken });
      value.append(link);
    }
    if (!values.length) value.append(el("span", "unclassified", "Not recorded for this older entry"));
    row.append(value);
    return row;
  };

  details.append(
    categoryRow("arXiv subjects", categories.arxiv, "arxiv"),
    categoryRow("MSC2020", categories.msc2020, "msc"),
  );
  section.append(details);

  // Asynchronous, and deliberately not awaited: a description is a courtesy,
  // and the section is correct without one.
  if (glossed.length) {
    mscGlossary().then((table) => {
      for (const { code, link, spoken } of glossed) {
        const description = table[code];
        if (!description) continue;
        // A hover, not a second column: the codes are a compact row, and the
        // descriptions are long enough to swamp them. Given to assistive
        // technology as text, since a title attribute alone reaches nobody
        // who is not holding a mouse.
        link.title = `${code} — ${description}`;
        spoken.textContent = ` — ${description}. Other entries classified ${code}`;
      }
    });
  }
  return section;
}

function provenanceSection(entry, availability) {
  const provenance = entry.provenance;
  const section = el("section", "entry-provenance");
  const heading = el("div", "section-heading");
  const title = el("div");
  title.append(el("div", "eyebrow", "Provenance"), el("h2", "", "Mathematical origin"));
  heading.append(title);
  section.append(heading);

  const details = el("dl", "details provenance-details");
  // Where the mathematics actually lives comes first. For a thin wrapper it is
  // the only row here that points at the work being registered; it used to sit
  // below the repository role that exists to announce it.
  if (provenance.repository_role === "thin-wrapper") {
    const substantive = provenance.substantive_formalization;
    const location = sourceLocation(
      entry,
      availability,
      substantive.repository,
      substantive.commit,
    );
    details.append(
      externalDetailRow(
        "Substantive formalization",
        `${substantive.repository}@${substantive.commit.slice(0, 12)}`,
        pinnedRepositoryDirectoryUrl(location.repository, substantive.commit),
      ),
    );
  }
  details.append(
    detailRow("Result origin", RESULT_ORIGIN_LABELS[provenance.result_origin]),
    detailRow("Repository role", REPOSITORY_ROLE_LABELS[provenance.repository_role]),
    detailRow(
      "Responsible maintainers",
      provenance.responsible_maintainers.map((person) => person.name).join(", "),
    ),
    detailRow(
      "Submission basis",
      {
        maintainer: "Submitted by a responsible author or maintainer",
        approved: "Submitted with approval from a responsible author or maintainer",
      }[entry.submission.authorization.relationship],
    ),
  );
  if (entry.submission.authorization.evidence) {
    details.append(detailRow("Authorization evidence", entry.submission.authorization.evidence));
  }
  section.append(details);

  if (provenance.mathematical_sources.length) {
    section.append(el("h3", "", "Mathematical sources"));
    const sources = el("ul", "plain-list provenance-sources");
    for (const source of provenance.mathematical_sources) {
      const item = el("li");
      const label = source.authors.length
        ? `${source.authors.map((author) => author.name).join(", ")}: ${source.title}`
        : source.title;
      if (source.identifier?.startsWith("https://")) {
        item.append(externalLink(label, source.identifier));
      } else {
        item.append(el("span", "", label));
      }
      item.append(el("span", "source-relationship", ` — ${source.relationship}`));
      if (source.identifier && !source.identifier.startsWith("https://")) {
        item.append(el("code", "", source.identifier));
      }
      sources.append(item);
    }
    section.append(sources);
  } else {
    section.append(el("p", "no-sources", "No prior mathematical source is recorded."));
  }

  if (provenance.related_formalizations.length) {
    section.append(el("h3", "", "Related formalizations"));
    const related = el("ul", "plain-list related-formalizations");
    for (const formalization of provenance.related_formalizations) {
      const item = el("li");
      if (formalization.identifier.startsWith("https://")) {
        item.append(externalLink(formalization.identifier, formalization.identifier));
      } else {
        item.append(el("code", "", formalization.identifier));
      }
      item.append(` — ${formalization.relationship}`);
      if (formalization.note) item.append(`: ${formalization.note}`);
      related.append(item);
    }
    section.append(related);
  }
  return section;
}

async function renderEntry(
  entry,
  content,
  canonicalUrl,
  renderBase,
  versions,
  currentVersion,
  availability,
  databaseBase,
) {
  document.title = `${entry.title} — Palomar`;
  setCanonicalEntryPage(entry);
  const heading = el("header", "entry-heading");
  const top = el("div", "card-top");
  top.append(el("span", "entry-id", `${entry.id} v${entry.version}`), trustBadge(entry));
  heading.append(top, el("h1", "", entry.title), el("p", "lede", entry.abstract));
  const byline = el("p", "byline", `By ${authorNames(entry)}`);
  heading.append(byline);

  const evidence = el("section", "entry-evidence");
  const evidenceTitle = el("div", "section-heading");
  const titleBlock = el("div");
  titleBlock.append(el("div", "eyebrow", "Verification"), el("h2", "", "What was checked"));
  evidenceTitle.append(titleBlock);
  evidence.append(evidenceTitle, acceptanceCallout(entry, databaseBase));
  const details = el("dl", "details");
  const location = topSourceLocation(entry, availability);
  details.append(
    // One date, not two. Acceptance and Lean verification have always been the
    // same day, so the second row said nothing the first did not; what it cost
    // was the time of day, which is now here.
    detailRow("Verified and accepted", displayTimestamp(entry.verification.verified_at)),
    externalDetailRow(
      "Fixed source version",
      `${entry.source.repository}@${entry.source.commit.slice(0, 12)}`,
      pinnedRepositoryDirectoryUrl(location.repository, entry.source.commit),
    ),
  );
  // Only worth a row when it is somewhere. At the repository root it is the
  // absence of a fact, and the fixed source version above already links there.
  if (entry.source.project_path) {
    details.append(
      externalDetailRow(
        "Project directory",
        entry.source.project_path,
        pinnedRepositoryDirectoryUrl(
          location.repository,
          entry.source.commit,
          entry.source.project_path,
        ),
      ),
    );
  }
  details.append(
    // The digest belongs to the file, so it sits with the file rather than in
    // a row of its own two lines further down.
    externalDetailRow(
      "Statement file",
      entry.formalization.challenge_path,
      sourceFileUrl(entry, entry.formalization.challenge_path, availability),
      digestNote(entry.verification.challenge_sha256),
    ),
    externalDetailRow(
      "Proof file",
      entry.formalization.solution_path,
      sourceFileUrl(entry, entry.formalization.solution_path, availability),
      digestNote(entry.verification.solution_sha256),
    ),
    externalDetailRow(
      "Formalization metadata",
      entry.formalization.formalization_metadata_path,
      sourceFileUrl(entry, entry.formalization.formalization_metadata_path, availability),
    ),
    detailRow("Lean version", entry.formalization.lean_toolchain),
    detailRow("Theorems checked", theoremNames(entry)),
    detailRow("Permitted axioms", entry.formalization.permitted_axioms.join(", ") || "none"),
    detailRow("Statement file size", `${entry.trust.challenge_lines} lines · ${entry.trust.challenge_bytes} bytes`),
    detailRow("Comparator commit", entry.verification.comparator_commit),
    externalDetailRow(
      "Verification workflow",
      `Actions run ${workflowRunId(entry.verification.workflow_url)}`,
      entry.verification.workflow_url,
    ),
    dataDetailRow(
      "Full registry record",
      `${entry.id}-v${entry.version}.json`,
      canonicalUrl.href,
    ),
  );
  {
    details.append(
      externalDetailRow(
        "Lakefile",
        entry.formalization.lakefile_path,
        sourceFileUrl(entry, entry.formalization.lakefile_path, availability),
      ),
    );
  }
  details.append(detailRow("NanoDa commit", entry.verification.nanoda_commit));
  {
    details.append(
      dataDetailRow(
        "Durable verification report",
        entry.verification.mechanical_report_sha256,
        evidenceDataUrl(entry, databaseBase, "mechanical-report.json"),
      ),
      detailRow("Verification workflow commit", entry.verification.workflow_commit),
      detailRow("Workflow run attempt", String(entry.verification.workflow_run_attempt)),
      licenceRow(entry, availability),
    );
  }
  evidence.append(details);
  {
    evidence.append(
      el(
        "p",
        "licence-boundary",
        "This licence evidence covers the submitted repository snapshot only. Cited papers, reused formalizations, and dependencies retain their own licences.",
      ),
    );
  }

  const trust = statementDependencies(entry);

  const editorial = el("section", "entry-editorial");
  const editorialTitle = el("div", "section-heading");
  const editorialBlock = el("div");
  editorialBlock.append(el("div", "eyebrow", "Editorial record"), el("h2", "", "Automated review"));
  editorialTitle.append(editorialBlock, el("span", "decision", "Accepted"));
  editorial.append(editorialTitle);
  // No scores. They decide whether a submission is accepted and they are kept
  // beside the database, but they never reach here: the same repository at
  // the same commit has scored 5 and then 4 on the same axis across runs, and a
  // number that moves like that reads as a judgement it cannot support. What
  // it can support is the decision, which is above.
  editorial.append(
    el(
      "p",
      "review-explanation",
      "An AI review compared the informal claim with the formal statement under " +
        "the recorded policy, and its comments are below. It is not human peer " +
        "review and not a novelty certificate.",
    ),
  );
  if (entry.review.warnings.length) {
    editorial.append(el("h3", "", "AI review comments"));
    const comments = el("ul", "review-comments");
    for (const comment of entry.review.warnings) comments.append(el("li", "", comment));
    editorial.append(comments);
  } else {
    editorial.append(el("p", "no-warnings", "The review recorded no comments on this result."));
  }
  editorial.append(
    dataLink(
      "Read the archived review",
      evidenceDataUrl(entry, databaseBase, "review.json"),
    ),
  );

  const challenge = await challengePresentation(entry, renderBase, {
    dependenciesOnThisPage: true,
    availability,
  });
  const sourceNotice = sourceAvailabilityNotice(entry, availability);
  content.append(heading);
  // A broken or degraded source affects every link on the page and remains a
  // warning at the top. The ordinary preservation confirmation is provenance,
  // not an alert, so keep it with the registry history near the bottom.
  if (!sourceNotice.classList.contains("preserved")) content.append(sourceNotice);
  const notice = versionNotice(entry, currentVersion);
  if (notice) content.append(notice);
  // The statement first, then what was checked about it, then what it rests
  // on. A registry entry is about a theorem, and the theorem should not be
  // below the paperwork that certifies it; these three used to be the sixth,
  // fifth and seventh things on the page.
  content.append(
    challenge.section,
    evidence,
    trust,
    solutionMetadata(entry, challenge.metadata, availability),
    provenanceSection(entry, availability),
    classificationSection(entry),
    editorial,
    ...(sourceNotice.classList.contains("preserved") ? [sourceNotice] : []),
    versionHistory(entry, versions, currentVersion),
  );
}

function renderExactTombstone(tombstone, content) {
  document.title = `${tombstone.id} v${tombstone.version} — Palomar`;
  document.body.classList.add("exact-tombstone");
  for (const node of document.querySelectorAll("body > .site-header, body > footer, body > .skip-link")) {
    node.hidden = true;
  }
  const record = el("section", "tombstone-record");
  record.append(
    el("h1", "", `${tombstone.id} v${tombstone.version}`),
    el("p", "", displayDate(tombstone.taken_down_on)),
  );
  content.replaceChildren(record);
  content.hidden = false;
}

if (document.body.dataset.page === "index") {
  // A linked search is its own view. Avoid fetching and exposing a hidden
  // recent listing until the query is cleared; then load it exactly once.
  const hasInitialSearch = wireSearch();
  if (!hasInitialSearch) ensureLanding();
}
if (document.body.dataset.page === "entry") {
  renderEntryPage({
    params,
    document,
    location: window.location,
    history: window.history,
    loadEntry,
    localPageUrl,
    renderEntry: (loaded, content) => renderEntry(
      loaded.entry,
      content,
      loaded.canonicalUrl,
      loaded.renderBase,
      loaded.versions,
      loaded.currentVersion,
      loaded.availability,
      loaded.databaseBase,
    ),
    renderExactTombstone,
  });
}
if (document.body.dataset.page === "render") {
  renderChallengePage({
    params,
    document,
    loadEntry,
    renderExactTombstone,
    el,
    challengePresentation,
  });
}

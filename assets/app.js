import {
  challengeArtifactUrl,
  challengeMetadataUrl,
  challengeSourceUrl,
  isInlineChallenge,
} from "./rendering.js";
import {
  databaseBaseFor,
  availabilityRecord,
  RESULT_ORIGIN_LABELS,
  REPOSITORY_ROLE_LABELS,
  entryRecordUrl,
  isLoopbackHostname,
  pinnedRepositoryDirectoryUrl,
  pinnedRepositoryFileUrl,
  postingRecordUrl,
  safeDataUrl,
  safeExternalUrl,
  safeInternalUrl,
  searchHeadUrl,
  searchPageUrl,
  searchTerms,
  stopwordsUrl,
  selectDatabaseUrl,
  selectAvailabilityUrl,
  recentUrl,
  selectRenderBase,
  tombstoneUrl,
  validateSearchHead,
  validateSearchPage,
  validateStopwords,
  validateEntry,
  validateAvailability,
  validateRecent,
  validateVersions,
  versionsUrl,
  validateTombstone,
  workflowRunId,
} from "./security.mjs";
import { loadSettledBounded } from "./loading.mjs";

const CANONICAL_WEB_BASE = "https://palomar-registry.org/";

const params = new URLSearchParams(window.location.search);
const PALOMAR_ID = /^PALOMAR-\d{4}-\d{2}-\d{2}-\d{6}$/;
const VERSION_PARAMETER = /^[1-9][0-9]*$/;
const ARXIV_FILTER_RE = /^[a-z]+(?:-[a-z]+)*(?:\.[A-Za-z-]+)?$/;
const MSC2020_FILTER_RE = /^[0-9]{2}(?:[A-Z][0-9]{2}|-[0-9]{2})$/;
const FILTER_UPDATE_DELAY_MS = 200;
const RECENT_ENTRY_CONCURRENCY = 8;
const RECENT_ENTRY_TIMEOUT_MS = 30_000;

function dataSource() {
  const databaseBase = databaseBaseFor(
    selectDatabaseUrl(window.location.href, window.location.search),
  );
  const renderBase = selectRenderBase(window.location.href, window.location.search, databaseBase);
  const availabilityUrl = selectAvailabilityUrl(
    window.location.href,
    window.location.search,
    databaseBase,
  );
  return { databaseBase, renderBase, availabilityUrl };
}

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

async function fetchJson(url, { signal } = {}) {
  const response = await fetch(url, { cache: "no-cache", signal });
  if (!response.ok) {
    const error = new Error(`${response.status} ${response.statusText}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function loadAvailability(url) {
  try {
    return validateAvailability(await fetchJson(url));
  } catch (error) {
    console.warn(`Source availability is unavailable: ${error.message}`);
    return null;
  }
}

function sourceLocation(entry, availability, repository, commit) {
  if (!entry.preservation) {
    return {
      repository,
      originalRepository: repository,
      archiveRepository: null,
      commit,
      originalStatus: "unknown",
      archiveStatus: "unknown",
      checkedAt: null,
      useArchive: false,
    };
  }
  const mapping = entry.preservation.repositories.find(
    (row) => row.source_repository.toLowerCase() === repository.toLowerCase() &&
      row.commit === commit,
  );
  if (!mapping) throw new Error(`entry has no preserved copy of ${repository}@${commit}`);
  const observed = availabilityRecord(availability, repository, commit);
  const status = observed &&
      observed.fork_repository.toLowerCase() === mapping.fork_repository.toLowerCase()
    ? observed
    : null;
  const originalStatus = status?.original.status || "unknown";
  const archiveStatus = status?.archive.status || "unknown";
  const useArchive = originalStatus === "missing" && archiveStatus !== "missing";
  return {
    repository: useArchive ? mapping.fork_repository : repository,
    originalRepository: repository,
    archiveRepository: mapping.fork_repository,
    commit,
    originalStatus,
    archiveStatus,
    checkedAt: status?.original.checked_at || null,
    useArchive,
  };
}

function topSourceLocation(entry, availability) {
  return sourceLocation(entry, availability, entry.source.repository, entry.source.commit);
}

function sourceFileUrl(entry, path, availability) {
  const location = topSourceLocation(entry, availability);
  return pinnedRepositoryFileUrl(location.repository, entry.source.commit, path);
}

function sourceDirectoryUrl(entry, path, availability) {
  const location = topSourceLocation(entry, availability);
  return pinnedRepositoryDirectoryUrl(location.repository, entry.source.commit, path);
}

function authorNames(entry) {
  return entry.authors.map((author) => author.name).join(", ");
}

function theoremNames(entry) {
  return entry.formalization.theorem_names.join(", ");
}

function pathBasename(path) {
  return path.split("/").at(-1);
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
function registrationDate(entry) {
  const value = entry.registered_at;
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

function trustBadge(entry) {
  const high = entry.trust.level === "high";
  const badge = el("span", `trust-badge ${high ? "high" : "qualified"}`);
  badge.textContent = high
    ? "Statement dependencies: Mathlib only"
    : "Statement dependencies: additional libraries";
  return badge;
}

function entryCard(entry, versionCount, availability) {
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
    el("span", "entry-id", `${entry.id} v${entry.version} · current`),
    el("span", "entry-date", `Registered ${displayDate(registrationDate(entry))}`),
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
  const location = topSourceLocation(entry, availability);
  const historyUrl = new URL(localPageUrl("entry.html", entry));
  historyUrl.hash = "version-history";
  footer.append(
    externalLink(
      location.useArchive ? "Palomar preserved copy" : entry.source.repository,
      pinnedRepositoryDirectoryUrl(location.repository, entry.source.commit),
      "repo-link",
    ),
    internalLink("View record", localPageUrl("entry.html", entry)),
  );
  if (!location.useArchive && location.archiveRepository) {
    footer.append(
      externalLink(
        "Palomar preserved copy",
        pinnedRepositoryDirectoryUrl(location.archiveRepository, entry.source.commit),
        "archive-link",
      ),
    );
  } else if (location.useArchive) {
    // Reached only when the availability manifest says the original is
    // missing, which is why the link above has switched to the preserved
    // copy. A record with no preservation block predates archiving, so
    // nothing has ever been checked about its repository at all; it used to
    // fall through to here and be told, in public, that it is gone.
    // `sourceAvailabilityNotice` says the accurate thing for that case on the
    // entry page, which is that Palomar has no preserved copy. A card has no
    // room to explain it, so it says nothing.
    footer.append(el("span", "source-status missing", "Original unavailable"));
  }
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

async function loadEntries(page, databaseBase) {
  const settled = await loadSettledBounded(
    page.entries,
    async (summary, signal) => {
      const entry = await fetchJson(entryRecordUrl(summary, databaseBase), { signal });
      // Every response is still untrusted independently. Degraded loading
      // means a malformed record is omitted, never rendered provisionally.
      return validateEntry(entry, summary);
    },
    {
      concurrency: RECENT_ENTRY_CONCURRENCY,
      timeoutMs: RECENT_ENTRY_TIMEOUT_MS,
    },
  );
  const entries = [];
  let failed = 0;
  for (const [position, result] of settled.entries()) {
    if (result.status === "fulfilled") {
      entries.push(result.value);
    } else {
      failed += 1;
      console.warn(
        `Recent entry ${page.entries[position].id} v${page.entries[position].version} ` +
          `could not be loaded: ${result.reason?.message || String(result.reason)}`,
      );
    }
  }
  return { entries, failed };
}

async function renderIndex() {
  const status = document.querySelector("#status");
  const grid = document.querySelector("#entry-grid");
  try {
    const { databaseBase, availabilityUrl } = dataSource();
    const availabilityPromise = loadAvailability(availabilityUrl);
    // What is new, not the whole registry. This page used to read a document
    // naming every active version and then sort and filter it here, which was
    // tens of megabytes for a screen of cards and grew every time anybody else
    // published anything. The publisher decides which results are current and
    // how many versions each has, so neither is worked out again here.
    const recent = validateRecent(await fetchJson(recentUrl(databaseBase)));
    const versionCounts = new Map(recent.entries.map((row) => [row.id, row.versions]));
    const loaded = await loadEntries(recent, databaseBase);
    const { entries } = loaded;
    const recentTotal = recent.entries.length;
    const availability = await availabilityPromise;
    // GitHub Pages may briefly pair HTML and JavaScript from adjacent deployments.
    // Metrics are presentation-only, so a removed metric must not abort the registry.
    // The validated summary still names every accepted result when an
    // individual record is temporarily unavailable. Counting only rendered
    // cards would make a transport failure look like a registry withdrawal.
    setOptionalText("#metric-results", String(recentTotal));
    setOptionalText(
      "#metric-projects",
      new Set(entries.map((entry) => entry.source.repository)).size,
    );
    if (!entries.length && !recentTotal) {
      status.textContent =
        "The telescope is ready. No entries have been published yet; the first accepted database PR will appear here automatically.";
      status.classList.add("empty");
      return;
    }
    if (!entries.length) {
      status.hidden = false;
      status.textContent =
        `No recent registry entries could be loaded (${loaded.failed} of ${recentTotal} failed). ` +
        "Try again later.";
      status.className = "status error";
      return;
    }
    const degradedMessage = loaded.failed
      ? `The recent listing is incomplete: ${loaded.failed} of ${recentTotal} entries ` +
        "could not be loaded."
      : "";
    status.hidden = !degradedMessage;
    status.textContent = degradedMessage;
    status.className = degradedMessage ? "status warning" : "status";
    // `loadEntries` keeps fulfilled values in recent.entries order even when
    // its bounded parallel fetches finish out of order, so render the
    // publisher's newest-first list.
    for (const entry of entries) {
      grid.append(entryCard(entry, versionCounts.get(entry.id), availability));
    }
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
      status.hidden = shown !== 0 && !degradedMessage;
      const classificationQuery = [
        arxivValue && `arXiv ${arxivValue}`,
        mscValue && `MSC2020 ${mscValue}`,
      ].filter(Boolean);
      const invalidClassifications = [
        arxivInvalid && "arXiv",
        mscInvalid && "MSC2020",
      ].filter(Boolean);
      status.textContent = shown
        ? degradedMessage
        : invalidClassifications.length
          ? `No registry entries match the current filters. Invalid classification code format: ${invalidClassifications.join(", ")}.`
          : classificationQuery.length
          ? `No registry entries match the current filters. Classification query: ${classificationQuery.join(", ")}.`
          : "No registry entries match those filters.";
      if (!shown && degradedMessage) status.textContent += ` ${degradedMessage}`;
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
  } catch (error) {
    status.hidden = false;
    status.textContent = `The registry could not be loaded: ${error.message}`;
    status.className = "status error";
  }
}

// How much of a word's postings one query is allowed to pull. A common word
// runs to hundreds of pages at a hundred thousand results, and a reader wants
// the newest matches rather than all of them; the record check below is what
// makes stopping early safe rather than merely cheap.
const SEARCH_PAGE_BUDGET = 16;
const SEARCH_RESULT_LIMIT = 20;
const SEARCH_CANDIDATE_LIMIT = 60;
const POSTING_RE = /^(PALOMAR-\d{4}-\d{2}-\d{2}-\d{6})-v([1-9]\d*)$/;

// One editorial constant, fetched once per page rather than copied into this
// repository, where it would drift from the indexer's across two deployments.
let stopwords = null;

/**
 * The words the indexer drops, so that a query can drop them too.
 *
 * Inferring them instead, from the fact that a dropped word has no head, was
 * wrong in a way a reader could not diagnose: a missing head is also what a
 * word nothing carries looks like, so "the ring" was answered against a record
 * whose text happens not to contain "the" by reporting that "the" is
 * unfindable. The list is published because it is a fixed choice of a few
 * hundred function words, which is nothing like the document naming every
 * known word that this index exists without.
 *
 * A list that cannot be fetched leaves every word in the query, which is the
 * behaviour this replaced: it narrows a search that should have been wider,
 * and never shows a result that does not match.
 */
async function searchStopwords(databaseBase) {
  if (stopwords) return stopwords;
  try {
    stopwords = validateStopwords(await fetchJson(stopwordsUrl(databaseBase)));
  } catch (error) {
    if (error.status !== 404) throw error;
    stopwords = new Set();
  }
  return stopwords;
}

async function searchHead(term, databaseBase) {
  try {
    return validateSearchHead(await fetchJson(searchHeadUrl(term, databaseBase)), term);
  } catch (error) {
    // A 404 is the only answer there is for a word nothing carries. There is
    // no document to consult first: one that named every known word would grow
    // with the registry and be rewritten on every publication, which is the
    // whole reason this index is shaped the way it is.
    if (error.status !== 404) throw error;
    return null;
  }
}

/**
 * One word's postings, newest first, for as many pages as the budget allows.
 *
 * The pages are in registration order, so the last page is the newest batch,
 * and within a page an identifier begins with its registration date. A page
 * the head says exists and that is not there is an error rather than an empty
 * answer: the head is the only account of which pages there are.
 */
async function searchPostings(term, head, databaseBase, wanted) {
  const postings = [];
  const first = Math.max(0, head.pages - wanted);
  for (let number = head.pages - 1; number >= first; number -= 1) {
    const page = validateSearchPage(
      await fetchJson(searchPageUrl(term, number, databaseBase)),
      term,
      number,
      head,
    );
    postings.push(...[...page.postings].reverse());
  }
  return { postings, whole: first === 0 };
}

/**
 * Which results might match, in the order they would be shown.
 *
 * The rarest word drives, because its sequence is the shortest and every match
 * is somewhere in it. Another word joins the intersection only if the whole of
 * it fits in what is left of the budget: intersecting against half a word's
 * postings would drop genuine matches while looking like a narrower search.
 * Everything else is settled per record by `carriesEveryTerm`, which is exact
 * and costs nothing, since the record has to be fetched to be shown anyway.
 *
 * A word with no head is a word nothing carries, and it is that rather than a
 * word the indexer drops because the dropped ones have already left the query
 * by the time this runs. It leaves the intersection and stays in the
 * per-record check, which rejects every candidate, and it is named in what the
 * reader is told rather than guessed about.
 */
async function searchCandidates(terms, databaseBase) {
  const heads = [];
  const missing = [];
  for (const term of terms) {
    const head = await searchHead(term, databaseBase);
    if (head && head.results > 0) heads.push([term, head]);
    else missing.push(term);
  }
  heads.sort((left, right) => left[1].results - right[1].results);
  if (!heads.length) return { postings: [], whole: true, missing };

  let budget = SEARCH_PAGE_BUDGET;
  let found = null;
  let whole = true;
  for (const [term, head] of heads) {
    if (found !== null && head.pages > budget) break;
    const wanted = Math.min(head.pages, budget);
    if (wanted === 0) break;
    const pulled = await searchPostings(term, head, databaseBase, wanted);
    budget -= wanted;
    whole = whole && pulled.whole;
    if (found === null) {
      found = pulled.postings;
    } else {
      const carried = new Set(pulled.postings);
      found = found.filter((posting) => carried.has(posting));
    }
    if (budget <= 0) break;
  }
  return { postings: found ?? [], whole, missing };
}

/**
 * Whether a record really carries every word of the query.
 *
 * This is the check the postings are an index *of*, made against the record
 * itself, so a posting that claims a result it should not is caught here
 * rather than shown. It is also what lets the intersection above stop early
 * and what lets a word with no head still be answered exactly.
 */
function carriesEveryTerm(entry, terms) {
  const words = new Set([
    ...searchTerms(entry.title),
    ...searchTerms(entry.abstract),
    ...entry.authors.flatMap((author) => searchTerms(author.name)),
  ]);
  return terms.every((term) => words.has(term));
}

/**
 * The summary a fetched record is checked against.
 *
 * `index.json` is an independent claim about a record's title, which is why
 * `validateEntry` compares the two. A posting claims something else: that this
 * record carries these words. So the identity is checked here and the claim
 * itself is checked by `carriesEveryTerm`, against the record's own text.
 */
function postingSummary(posting, entry) {
  const match = POSTING_RE.exec(posting);
  return {
    id: match[1],
    version: Number(match[2]),
    title: entry.title,
    status: entry.status,
    path: `entries/${posting}.json`,
  };
}

async function searchRegistry(query, databaseBase) {
  const asked = [...new Set(searchTerms(query))];
  const dropping = await searchStopwords(databaseBase);
  const dropped = asked.filter((term) => dropping.has(term));
  const terms = asked.filter((term) => !dropping.has(term));
  if (!terms.length) {
    return { terms, dropped, entries: [], whole: true, examined: 0, missing: [] };
  }
  const { postings, whole, missing } = await searchCandidates(terms, databaseBase);
  const entries = [];
  let examined = 0;
  for (const posting of postings) {
    if (entries.length >= SEARCH_RESULT_LIMIT || examined >= SEARCH_CANDIDATE_LIMIT) break;
    examined += 1;
    const record = await fetchJson(postingRecordUrl(posting, databaseBase));
    const entry = validateEntry(record, postingSummary(posting, record));
    if (carriesEveryTerm(entry, terms)) entries.push(entry);
  }
  return {
    terms,
    dropped,
    entries,
    missing,
    whole: whole && examined === postings.length,
    examined,
  };
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

async function renderSearch(query) {
  const status = document.querySelector("#search-status");
  const results = document.querySelector("#search-results");
  const grid = document.querySelector("#entry-grid");
  const toolbar = document.querySelector(".toolbar");
  if (!status || !results) return;
  results.replaceChildren();
  status.className = "status";
  const searching = Boolean(searchTerms(query).length);
  if (grid) grid.hidden = searching;
  if (toolbar) toolbar.hidden = searching;
  if (!searching) {
    status.hidden = true;
    return;
  }
  status.hidden = false;
  status.textContent = "Searching the registry…";
  try {
    const { databaseBase } = dataSource();
    const found = await searchRegistry(query, databaseBase);
    for (const entry of found.entries) results.append(entryCard(entry, 1, null));
    if (!found.terms.length) {
      // Every word of the query is one the indexer drops, so there is nothing
      // to ask for. Saying which words those were is the difference between an
      // answer and an apparently empty registry.
      status.textContent =
        `Every word of that search is too common to be indexed: ${found.dropped.join(", ")}.`;
      return;
    }
    if (!found.entries.length) {
      // Naming the words nothing carries is what turns "no results" into
      // something a reader can act on. The words the indexer drops are not
      // among them: they left the query before it was asked.
      status.textContent = found.missing.length
        ? `No result carries all of: ${found.terms.join(", ")}. Nothing is indexed under `
          + `${found.missing.join(", ")}.`
        : `No result carries all of: ${found.terms.join(", ")}.`;
      return;
    }
    status.hidden = found.whole;
    status.textContent = found.whole
      ? ""
      : `Showing the newest ${found.entries.length} results; narrow the search for older ones.`;
  } catch (error) {
    status.textContent = `The search could not be run: ${error.message}`;
    status.classList.add("error");
  }
}

function wireSearch() {
  const form = document.querySelector("#registry-search");
  const input = document.querySelector("#query");
  if (!form || !input) return;
  const initial = params.get("q") || "";
  input.value = initial;
  form.addEventListener("submit", (event) => {
    // The page's own content security policy forbids form submission, which is
    // right: nothing here posts anywhere. The query is a link to this page.
    event.preventDefault();
    const query = input.value.trim();
    window.history.replaceState(null, "", searchPageUrlFor(query));
    renderSearch(query);
  });
  if (initial) renderSearch(initial);
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

function canonicalEntryPageUrl(entry) {
  const target = new URL("entry.html", CANONICAL_WEB_BASE);
  target.searchParams.set("id", entry.id);
  target.searchParams.set("version", String(entry.version));
  return safeExternalUrl(target);
}

function setCanonicalEntryPage(entry) {
  let canonical = document.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement("link");
    canonical.rel = "canonical";
    document.head.append(canonical);
  }
  canonical.href = canonicalEntryPageUrl(entry).href;
}

function versionNotice(entry, currentVersion) {
  if (entry.version === currentVersion) return null;
  const notice = el("aside", "version-notice");
  const heading = el("h2", "", "Newer version available");
  heading.id = "newer-version-heading";
  notice.setAttribute("aria-labelledby", heading.id);
  notice.append(
    heading,
    el(
      "p",
      "",
      `You are viewing immutable version ${entry.version}. Version ${currentVersion} is the current version of this record.`,
    ),
  );
  notice.append(
    internalLink(
      `View current version ${currentVersion}`,
      localPageUrl("entry.html", { id: entry.id, version: currentVersion }),
    ),
  );
  return notice;
}

function versionHistory(entry, versions, currentVersion) {
  const section = el("section", "version-history");
  section.id = "version-history";
  section.setAttribute("aria-labelledby", "version-history-heading");
  const heading = el("div", "section-heading");
  const title = el("div");
  title.append(
    el("div", "eyebrow", "Registry history"),
    el("h2", "", "Versions"),
  );
  title.querySelector("h2").id = "version-history-heading";
  heading.append(title);
  section.append(
    heading,
    el(
      "p",
      "version-history-intro",
      "Every version is an immutable accepted snapshot. The authorship, statement, proof, review comments, and dependency information on this page belong to the selected version only.",
    ),
  );

  const list = el("ol", "version-list");
  list.reversed = true;
  list.setAttribute("role", "list");
  for (const summary of [...versions].reverse()) {
    const item = el("li");
    const label = `Version ${summary.version}`;
    if (summary.version === entry.version) {
      const selected = el("strong", "selected-version", label);
      selected.setAttribute("aria-current", "true");
      item.append(selected);
    } else {
      item.append(internalLink(label, localPageUrl("entry.html", summary)));
    }
    item.append(
      el(
        "span",
        `version-state ${summary.version === currentVersion ? "current" : "superseded"}`,
        summary.version === currentVersion ? "Current" : "Superseded",
      ),
    );
    if (summary.version === entry.version) {
      item.append(el("span", "viewing-version", "Viewing"));
    }
    list.append(item);
  }
  section.append(list);
  return section;
}

function challengeFrame(entry, renderBase) {
  const frame = el("iframe", "challenge-frame");
  frame.src = safeDataUrl(
    challengeArtifactUrl(entry, renderBase).href,
    window.location.href,
  ).href;
  frame.title = `Named compared declarations for ${entry.id} version ${entry.version}`;
  frame.loading = "lazy";
  frame.referrerPolicy = "no-referrer";
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("scrolling", "auto");
  window.addEventListener("message", (event) => {
    if (event.source !== frame.contentWindow || event.data?.type !== "palomar-render-height") {
      return;
    }
    const height = event.data.height;
    if (!Number.isSafeInteger(height) || height <= 0) return;
    frame.style.height = `${Math.max(160, Math.min(672, height + 2))}px`;
    frame.dataset.heightAdjusted = "true";
  });
  return frame;
}

function validateChallengeMetadata(entry, metadata) {
  const expectedDeclarations = [
    ...entry.formalization.theorem_names,
    ...entry.formalization.definition_names,
  ];
  const expectedImports = entry.trust.challenge_imports;
  const sameArray = (left, right) =>
    Array.isArray(left) && left.length === right.length &&
      left.every((value, index) => value === right[index]);
  if (
    ![1, 2].includes(metadata?.schema_version) ||
    !sameArray(metadata.declarations, expectedDeclarations) ||
    !sameArray(metadata.imports, expectedImports) ||
    !(metadata.module_doc === null ||
      (typeof metadata.module_doc === "string" && metadata.module_doc.length <= 256 * 1024))
  ) {
    throw new Error("Challenge render metadata does not match the registry entry");
  }
  if (
    metadata.schema_version >= 2 &&
    (!Array.isArray(metadata.solution_imports) ||
      metadata.solution_imports.length > 1_000 ||
      !metadata.solution_imports.every((item) => typeof item === "string" && item.length > 0))
  ) {
    throw new Error("Challenge render metadata contains invalid Solution imports");
  }
  return metadata;
}

function challengeMetadata(metadata) {
  const panel = el("div", "challenge-metadata");
  panel.append(el("div", "eyebrow", "Statement file information"));
  const imports = el("div", "challenge-metadata-row");
  imports.append(el("strong", "", "Libraries imported by the statement"));
  const tokens = el("span", "token-list");
  for (const item of metadata.imports) tokens.append(el("code", "", item));
  imports.append(tokens);
  panel.append(imports);
  if (metadata.module_doc) {
    const moduleDoc = el("details", "challenge-module-doc");
    moduleDoc.append(el("summary", "", "Notes from the statement file"));
    moduleDoc.append(el("pre", "", metadata.module_doc));
    panel.append(moduleDoc);
  } else {
    panel.append(el("p", "challenge-no-module-doc", "No notes were found in the statement file."));
  }
  return panel;
}

async function challengePresentation(
  entry,
  renderBase,
  { forceFrame = false, dependenciesOnThisPage = false, availability = null } = {},
) {
  const section = el("section", "challenge-presentation");
  const heading = el("div", "section-heading");
  const titleBlock = el("div");
  titleBlock.append(
    el("div", "eyebrow", "Formal comparison surface"),
    el("h2", "", "Named compared declarations"),
  );
  heading.append(titleBlock);
  section.append(heading);

  const links = el("p", "challenge-links");
  // On the entry page the dependencies are a little further down, and a link
  // that rebuilds the entry URL reads as a trip somewhere else. The dedicated
  // render page does not carry them, so from there it is a trip somewhere else.
  const dependencyRecordUrl = dependenciesOnThisPage
    ? new URL("#statement-dependencies", window.location.href)
    : localPageUrl("entry.html", entry);
  if (!dependenciesOnThisPage) dependencyRecordUrl.hash = "statement-dependencies";
  const comparatorPath = entry.formalization.comparator_config_path;
  const challengePath = entry.formalization.challenge_path;
  const challengeFilename = pathBasename(challengePath);
  const location = topSourceLocation(entry, availability);
  links.append(
    externalLink(
      `View full pinned statement file (${challengeFilename})`,
      challengeSourceUrl(entry, location.repository),
      "challenge-source",
    ),
    " · ",
    internalLink(
      "Inspect statement dependencies",
      dependencyRecordUrl,
    ),
    " · ",
    externalLink(
      `View comparator configuration (${pathBasename(comparatorPath)})`,
      sourceFileUrl(entry, comparatorPath, availability),
      "comparator-source",
    ),
  );
  const inline = isInlineChallenge(entry);
  if (!forceFrame && !inline) {
    links.append(
      " · ",
      internalLink("Open formatted statement", localPageUrl("render.html", entry)),
    );
  }
  section.append(links);
  section.append(
    el(
      "p",
      "challenge-surface-disclosure",
      `The formatted view shows only the declarations named in this entry's comparator configuration. Comparator also checks the declarations used by their types. The full pinned ${challengeFilename} and dependency record expose the statement and dependency surface for inspection.`,
    ),
  );

  let metadata;
  try {
    metadata = validateChallengeMetadata(
      entry,
      await fetchJson(challengeMetadataUrl(entry, renderBase)),
    );
  } catch (error) {
    if (error.status !== 404) throw error;
    section.append(
      el(
        "p",
        "challenge-fallback",
        "The formatted statement is not available for this entry yet. Use the statement file link above; the pinned source is the record either way.",
      ),
    );
    return {section, metadata: null};
  }
  section.append(challengeMetadata(metadata));

  if (forceFrame || inline) {
    section.append(challengeFrame(entry, renderBase));
  } else {
    section.append(
      el(
        "p",
        "challenge-fallback",
        "This statement is too large to display here; use the formatted view above.",
      ),
    );
  }
  return {section, metadata};
}

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
  if (entry.preservation) {
    evidenceLinks.append(
      " · ",
      dataLink(
        "Source preservation receipt",
        evidenceDataUrl(entry, databaseBase, "source-archive.json"),
      ),
    );
  }
  copy.append(
    el("strong", "", `Registered on ${displayDate(registrationDate(entry))}`),
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
  if (!location.archiveRepository) {
    notice.classList.add("legacy");
    notice.append(
      el("strong", "", "Palomar has no preservation copy of this source"),
      el(
        "p",
        "",
        "This record was accepted before Palomar began archiving source repositories. " +
          "The link goes to the original repository at the exact commit that was reviewed, " +
          "but it may stop working if that repository is removed.",
      ),
      externalLink("Open the reviewed source", original),
    );
    return notice;
  }
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
    notice.append(
      el("strong", "", "Source preservation degraded"),
      el("p", "", "The original source still works, but Palomar's preserved copy is unavailable."),
      externalLink("Original source", original),
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

function solutionMetadata(entry, renderMetadata, availability) {
  const section = el("section", "entry-solution");
  const heading = el("div", "section-heading");
  const title = el("div");
  title.append(el("div", "eyebrow", "Accepted proof"), el("h2", "", "Verified proof"));
  heading.append(title, el("span", "decision accepted-decision", "Accepted"));
  section.append(heading);
  section.append(
    el(
      "p",
      "solution-summary",
      "Lean checked the accepted proof using the exact versions of the source files and libraries listed below.",
    ),
  );

  const details = el("dl", "details solution-details");
  details.append(
    externalDetailRow(
      "Proof file",
      entry.formalization.solution_path,
      sourceFileUrl(entry, entry.formalization.solution_path, availability),
    ),
    detailRow("Proof file checksum (SHA-256)", entry.verification.solution_sha256),
  );
  if (renderMetadata?.schema_version >= 2) {
    const row = el("div", "detail-row");
    row.append(el("dt", "", "Libraries imported by the proof"));
    const value = el("dd", "token-list");
    for (const item of renderMetadata.solution_imports) value.append(el("code", "", item));
    row.append(value);
    details.append(row);
  }
  section.append(details);

  const dependencies = entry.formalization.project_dependencies;
  const closure = el("details", "solution-dependencies");
  closure.append(
    el(
      "summary",
      "",
      `${dependencies.length} project dependencies used by the proof`,
    ),
  );
  const list = el("ul", "dependency-list");
  for (const dependency of dependencies) {
    const item = el("li");
    if (dependency.path !== undefined) {
      item.append(
        externalLink(
          dependency.name,
          sourceDirectoryUrl(entry, dependency.path, availability),
        ),
        el("code", "", dependency.path),
      );
    } else {
      const location = sourceLocation(
        entry,
        availability,
        dependency.repository,
        dependency.revision,
      );
      item.append(
        externalLink(
          location.useArchive ? `${dependency.repository} (Palomar copy)` : dependency.repository,
          pinnedRepositoryDirectoryUrl(location.repository, dependency.revision),
        ),
        el("code", "", dependency.revision.slice(0, 12)),
      );
      if (!location.useArchive && location.archiveRepository) {
        item.append(
          " · ",
          externalLink(
            "Palomar preserved copy",
            pinnedRepositoryDirectoryUrl(location.archiveRepository, dependency.revision),
          ),
        );
      }
    }
    list.append(item);
  }
  closure.append(list);
  section.append(closure);
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

  const trust = el("section", "entry-trust");
  trust.id = "statement-dependencies";
  const trustTitle = el("div", "section-heading");
  const trustBlock = el("div");
  trustBlock.append(
    el("div", "eyebrow", "Statement dependencies"),
    el(
      "h2",
      "",
      entry.trust.level === "high"
        ? "Depends only on Mathlib"
        : "Depends on additional libraries",
    ),
  );
  trustTitle.append(trustBlock, trustBadge(entry));
  trust.append(trustTitle);
  const imports = el("div", "token-list");
  for (const item of entry.trust.challenge_imports) imports.append(el("code", "", item));
  trust.append(el("h3", "", "Libraries imported by the statement"), imports);
  if (entry.trust.challenge_dependencies.length) {
    trust.append(el("h3", "", "Source repositories"));
    const dependencies = el("ul", "plain-list");
    for (const dependency of entry.trust.challenge_dependencies) {
      dependencies.append(el("li", "", dependency.repository));
    }
    trust.append(dependencies);
  }
  if (entry.trust.reasons.length) {
    trust.append(el("h3", "", "Why additional libraries are needed"));
    const reasons = el("ul", "reason-list");
    for (const reason of entry.trust.reasons) reasons.append(el("li", "", reason));
    trust.append(reasons);
  }

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

async function loadEntry(id, requestedVersion) {
  const { databaseBase, renderBase, availabilityUrl } = dataSource();
  const availabilityPromise = loadAvailability(availabilityUrl);
  // The versions of this one result, not the whole registry. Reading a
  // whole-registry index here meant fetching every record ever registered to
  // render one page, and paying for it again every time anyone else published.
  let versions = [];
  try {
    versions = validateVersions(await fetchJson(versionsUrl(id, databaseBase)), id).entries;
  } catch (error) {
    // Absent means no active version of this result, which is either an
    // unknown identifier or one withdrawn entirely. Both are answered below,
    // by the tombstone if there is one and by "not found" if there is not.
    if (error.status !== 404) throw error;
  }
  const currentVersion = versions.length ? versions.at(-1).version : null;
  const version = requestedVersion ?? currentVersion;
  if (version === null && requestedVersion === undefined) throw new Error("entry not found");
  const summary = versions.find((item) => item.version === version);
  if (!summary) {
    if (requestedVersion === null || requestedVersion === undefined) {
      throw new Error("entry not found");
    }
    try {
      const tombstone = validateTombstone(
        await fetchJson(tombstoneUrl(id, requestedVersion, databaseBase)),
        id,
        requestedVersion,
      );
      return { tombstone };
    } catch (error) {
      if (error.status === 404) throw new Error("entry not found");
      throw error;
    }
  }
  const canonicalUrl = entryRecordUrl(summary, databaseBase);
  const entry = validateEntry(await fetchJson(canonicalUrl), summary);
  const availability = await availabilityPromise;
  return {
    entry,
    canonicalUrl,
    renderBase,
    versions,
    currentVersion,
    availability,
    databaseBase,
  };
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

async function renderEntryPage() {
  const status = document.querySelector("#status");
  const content = document.querySelector("#entry-content");
  const id = params.get("id");
  const versionParameter = params.get("version");
  const version = versionParameter === null || !VERSION_PARAMETER.test(versionParameter)
    ? null
    : Number(versionParameter);
  if (
    !PALOMAR_ID.test(id || "") ||
    (versionParameter !== null &&
      (!VERSION_PARAMETER.test(versionParameter) || !Number.isSafeInteger(version)))
  ) {
    status.textContent = "This registry link has a missing or invalid Palomar ID or version.";
    status.classList.add("error");
    return;
  }
  try {
    const requestedHash = window.location.hash;
    const loaded = await loadEntry(id, version);
    if (loaded.tombstone) {
      status.hidden = true;
      renderExactTombstone(loaded.tombstone, content);
      return;
    }
    const {
      entry,
      canonicalUrl,
      renderBase,
      versions,
      currentVersion,
      availability,
      databaseBase,
    } = loaded;
    if (version === null) {
      const resolvedUrl = localPageUrl("entry.html", entry);
      resolvedUrl.hash = requestedHash;
      window.history.replaceState(null, "", resolvedUrl);
    }
    status.hidden = true;
    content.hidden = false;
    await renderEntry(
      entry,
      content,
      canonicalUrl,
      renderBase,
      versions,
      currentVersion,
      availability,
      databaseBase,
    );
    const anchorTarget = requestedHash.startsWith("#")
      ? document.getElementById(decodeURIComponent(requestedHash.slice(1)))
      : null;
    if (anchorTarget) anchorTarget.scrollIntoView();
  } catch (error) {
    status.textContent = `The registry entry could not be loaded: ${error.message}`;
    status.classList.add("error");
  }
}

async function renderChallengePage() {
  const status = document.querySelector("#status");
  const content = document.querySelector("#render-content");
  const id = params.get("id");
  const versionParameter = params.get("version") || "";
  const version = Number(versionParameter);
  if (
    !PALOMAR_ID.test(id || "") ||
    !VERSION_PARAMETER.test(versionParameter) ||
    !Number.isSafeInteger(version)
  ) {
    status.textContent = "This render link is missing a valid Palomar ID and version.";
    status.classList.add("error");
    return;
  }
  try {
    const loaded = await loadEntry(id, version);
    if (loaded.tombstone) {
      status.hidden = true;
      renderExactTombstone(loaded.tombstone, content);
      return;
    }
    const { entry, renderBase, availability } = loaded;
    document.title = `Named compared declarations — ${entry.title} — Palomar`;
    const heading = el("header", "entry-heading");
    heading.append(
      el("div", "entry-id", `${entry.id} v${entry.version}`),
      el("h1", "", entry.title),
    );
    const challenge = await challengePresentation(
      entry,
      renderBase,
      { forceFrame: true, availability },
    );
    content.append(heading, challenge.section);
    status.hidden = true;
    content.hidden = false;
  } catch (error) {
    status.textContent = `The named compared declarations could not be loaded: ${error.message}`;
    status.classList.add("error");
  }
}

if (document.body.dataset.page === "index") {
  // Wired first and run independently of the listing, so that arriving at a
  // search link does not wait for every record on the landing page to load.
  wireSearch();
  renderIndex();
}
if (document.body.dataset.page === "entry") renderEntryPage();
if (document.body.dataset.page === "render") renderChallengePage();

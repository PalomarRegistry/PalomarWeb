import {
  RESULT_ORIGIN_LABELS,
  REPOSITORY_ROLE_LABELS,
  isLoopbackHostname,
  pinnedRepositoryDirectoryUrl,
  recentValidationIssues,
  safeDataUrl,
  safeExternalUrl,
  safeInternalUrl,
  subjectHeadUrl,
  workflowRunId,
} from "./security.mjs";
import {
  SEARCH_RESULT_LIMIT,
  SEARCH_TERM_LIMIT,
  createRegistrySearch,
  validateSearchQuery,
} from "./searching.mjs";
import {
  expandDetailsForTarget,
  renderChallengePage,
  renderEntryPage,
} from "./entry-pages.mjs";
import { createChallengePresentation } from "./challenge-presentation.mjs";
import { mathematicalSourceUrl } from "./bibliography.mjs";
import { createCitationPresentation } from "./citation-presentation.mjs";
import { createEntryHistoryPresentation } from "./entry-history-presentation.mjs";
import { createFormalizationPresentation } from "./formalization-presentation.mjs";
import { createRegistryLoader } from "./registry-loading.mjs";
import { createStatementPreview } from "./statement-preview.mjs";
import { renderSubjectPage } from "./subject-pages.mjs";
import { presentationAbstract } from "./presentation-text.mjs";
import {
  DEFAULT_ORDER,
  FIRST_REGISTRATION_ORDER,
  cardDates,
  compareRows,
  dayWindow,
  normalizeOrder,
  orderedDay,
  registrationDay,
  withinWindow,
} from "./registry-dates.mjs";
import {
  bindSourceControl,
  createSourceAvailabilityBinding,
  createSourceAvailabilityNotice,
  decorateCardSet,
  sourceFileUrl,
  sourceLocation,
  topSourceLocation,
} from "./source-preservation.mjs";

const params = new URLSearchParams(window.location.search);
const ARXIV_FILTER_RE = /^[a-z]+(?:-[a-z]+)*(?:\.[A-Za-z-]+)?$/;
// Every MSC2020 code is five characters: two digits for the subject, then
// either a letter or a hyphen, then two more digits. A reader knows the
// subject long before the section, so the filter takes any prefix of that
// shape ("11", "11P", "11P3") and matches every code that begins with it.
const MSC2020_FILTER_RE = /^[0-9]{1,2}$|^[0-9]{2}[A-Z-][0-9]{0,2}$/;
const FILTER_UPDATE_DELAY_MS = 200;
// Longer than the classification filter above, because each registry search
// costs a stopword read, a head read per word, posting pages, and up to sixty
// record reads. A pause is the signal; a keystroke is not.
const SEARCH_UPDATE_DELAY_MS = 300;

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
  loadRecent,
  loadRecentRenders,
  loadEntry,
  loadSubjectHead,
  loadSubjectYear,
  loadSubjectPage,
} = createRegistryLoader({
  fetch: (...args) => fetch(...args),
  location: window.location,
  warn: (message) => console.warn(message),
});

const searchRegistry = createRegistrySearch(fetchJson);

const statementPreview = createStatementPreview({
  document,
  window,
  dataSource,
  loadRecentRenders,
  warn: (message) => console.warn(message),
});

function authorNames(entry) {
  return entry.authors.map((author) => author.name).join(", ");
}

function personPresentation(person) {
  const content = el("span", "person");
  content.append(el("span", "person-name", person.name));
  if (person.orcid) {
    const link = externalLink(
      `ORCID ${person.orcid}`,
      `https://orcid.org/${person.orcid}`,
      "orcid-id",
    );
    link.setAttribute("aria-label", `Open the ORCID record ${person.orcid} for ${person.name}`);
    content.append(" · ", link);
    if (person.orcid_record_checked_at) {
      const checked = el("span", "orcid-record-checked", "✓ ORCID record checked");
      checked.title =
        `Palomar found this identifier in the ORCID Registry on ${displayTimestamp(
          person.orcid_record_checked_at,
        )}. This checks the record exists; it does not authenticate the person or prove authorship.`;
      content.append(" ", checked);
    }
  }
  return content;
}

function appendPeople(target, people) {
  people.forEach((person, position) => {
    if (position) target.append(", ");
    target.append(personPresentation(person));
  });
  return target;
}

function theoremNames(entry) {
  return entry.formalization.theorem_names.join(", ");
}

function classification(entry) {
  const distinct = (value) => Array.isArray(value) ? [...new Set(value)] : [];
  return {
    arxiv: distinct(entry.classification?.arxiv),
    msc2020: distinct(entry.classification?.msc2020),
  };
}

// Written out rather than composed from the scheme name. The build asserts that
// everything the site fetches from its own origin is in the artifact, and it can
// only read the URLs that are spelled out where it looks.
const TAXONOMY_SOURCES = Object.freeze({
  arxiv: () => new URL("assets/data/arxiv-categories.json", document.baseURI),
  msc: () => new URL("assets/data/msc2020-codes.json", document.baseURI),
});

const taxonomyLoads = new Map();

/**
 * A taxonomy's descriptions, fetched once and only where they are shown.
 *
 * A code is not a subject: nobody reads 52C10 and thinks "Erdős problems in
 * discrete geometry", and math.MG does not announce itself as metric geometry.
 * The MSC table is large enough that it is not worth loading for a page with no
 * classification on it, and both are unimportant enough that a page whose fetch
 * fails should still render.
 */
function taxonomy(kind) {
  if (!taxonomyLoads.has(kind)) {
    taxonomyLoads.set(kind, (async () => {
      try {
        const response = await fetch(TAXONOMY_SOURCES[kind]());
        return response.ok ? await response.json() : {};
      } catch {
        return {};
      }
    })());
  }
  return taxonomyLoads.get(kind);
}

/**
 * The descriptions, applied to every code on the page in one pass.
 *
 * Both taxonomies, because a Subjects row mixes them and glossing one a moment
 * before the other would move the text under a reader twice instead of once.
 * One pass, because cards are built in bulk and a callback per card would be a
 * hundred of them rewriting a hundred rows. Deliberately not awaited: a
 * description is a courtesy, and the row is correct without one.
 */
let pendingGlosses = null;

function glossLater(pending) {
  if (pendingGlosses !== null) {
    pendingGlosses.push(pending);
    return;
  }
  pendingGlosses = [pending];
  Promise.all([taxonomy("arxiv"), taxonomy("msc")])
    .then(([arxiv, msc]) => {
      const queued = pendingGlosses;
      pendingGlosses = null;
      for (const { kind, code, link, spoken, suffix } of queued) {
        const description = (kind === "arxiv" ? arxiv : msc)[code];
        if (typeof description !== "string" || !description) continue;
        // A hover, not a second column: the codes are a compact row, and the
        // descriptions are long enough to swamp them. Given to assistive
        // technology as text, since a title attribute alone reaches nobody
        // who is not holding a mouse.
        link.title = `${code} — ${description}`;
        spoken.textContent = ` — ${description}. ${suffix}`;
      }
    });
}

/**
 * One classification code, as the link to everything else carrying it.
 *
 * The subject page reads `subjects/<kind>/<code>.json` and the archive behind
 * it, so it answers for the whole registry. The landing page's arXiv and MSC
 * fields narrow the rows already on it, which is a different question and stays
 * where it is.
 */
function classificationToken(kind, code, label, className = "category-token") {
  const link = internalLink(label, subjectPageUrl(kind, code), className);
  const suffix = `Other entries classified ${code}`;
  const spoken = el("span", "visually-hidden", ` — ${suffix.toLowerCase()}`);
  link.append(spoken);
  glossLater({ kind, code, link, spoken, suffix });
  return link;
}

function categoryTokens(entry) {
  const categories = classification(entry);
  const tokens = el("span", "category-tokens");
  for (const code of categories.arxiv) {
    tokens.append(classificationToken("arxiv", code, code));
  }
  for (const code of categories.msc2020) {
    tokens.append(classificationToken("msc", code, `MSC ${code}`));
  }
  if (!tokens.children.length) tokens.append(el("span", "unclassified", "Not recorded"));
  return tokens;
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

/**
 * Everything on a card that a reader might type at it, as one lowercase run.
 *
 * The instant matches shown while the registry answers are chosen from this,
 * and so is the card's own index. Deriving both from here is what keeps the
 * provisional set from disagreeing with the cards it is drawn from.
 */
function searchBlob(entry) {
  const categories = classification(entry);
  return [
    entry.title,
    presentationAbstract(entry),
    authorNames(entry),
    theoremNames(entry),
    entry.source.repository,
    entry.source.project_path || "",
    entry.id,
    ...categories.arxiv,
    ...categories.msc2020,
  ].join(" ").toLowerCase();
}

function dateSpans({ id, registeredAt }, order) {
  return cardDates({ id, registeredAt }, order).map(({ className, label, day }) =>
    el("span", className, `${label} ${displayDate(day)}`));
}

/**
 * Date a card again after the grid is rearranged.
 *
 * The dates are rewritten rather than the card rebuilt: a card carries a hover
 * preview registration and whatever the availability answer decorated it with,
 * and neither survives being replaced by an equal one.
 */
function setCardDates(card, row, order) {
  const identity = card.querySelector(".card-identity");
  identity.replaceChildren(
    identity.querySelector(".entry-id"),
    ...dateSpans(row, order),
  );
}

function entryCard(
  entry,
  {
    versionCount = null,
    current = false,
    registeredAt = entry.registered_at,
    order = DEFAULT_ORDER,
  } = {},
) {
  const categories = classification(entry);
  const card = el("article", "entry-card");
  card.dataset.id = entry.id;
  card.dataset.trust = entry.trust.level;
  card.dataset.arxiv = categories.arxiv.join(" ");
  card.dataset.msc = categories.msc2020.join(" ");
  card.dataset.search = searchBlob(entry);

  const top = el("div", "card-top");
  const identity = el("div", "card-identity");
  identity.append(
    el("span", "entry-id", `${entry.id} v${entry.version}${current ? " · current" : ""}`),
    ...dateSpans({ id: entry.id, registeredAt }, order),
  );
  top.append(identity, trustBadge(entry));
  const title = el("h3");
  const titleLink = internalLink(entry.title, localPageUrl("/entry", entry));
  // The card is built from a landing row on one grid and from a whole
  // validated record on the other. The preview is told which it has rather
  // than left to work it out from what is missing.
  statementPreview.register(titleLink, entry);
  title.append(titleLink);
  const abstract = presentationAbstract(entry);
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
  const historyUrl = new URL(localPageUrl("/entry", entry));
  historyUrl.hash = "version-history";
  footer.append(
    externalLink(
      entry.source.repository,
      pinnedRepositoryDirectoryUrl(entry.source.repository, entry.source.commit),
      "repo-link",
    ),
    internalLink("View record", localPageUrl("/entry", entry)),
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
  card.append(top, title);
  if (abstract) card.append(el("p", "card-abstract", abstract));
  card.append(meta, footer);
  return card;
}

let landingSuppressed = false;
let landingStatusHidden = document.querySelector("#status")?.hidden ?? true;

function registryWarningNode() {
  let warning = document.querySelector("#registry-warning");
  if (warning) return warning;
  const status = document.querySelector("#status");
  if (!status) return null;
  warning = el("div", "status warning");
  warning.id = "registry-warning";
  warning.hidden = true;
  warning.setAttribute("role", "status");
  status.before(warning);
  return warning;
}

function showRecentIssues(issues) {
  const warning = registryWarningNode();
  if (!warning) return;
  warning.hidden = issues.omitted === 0;
  warning.textContent = issues.omitted === 1
    ? "1 registry entry could not be displayed."
    : `${issues.omitted} registry entries could not be displayed.`;
  for (const issue of issues.details) {
    const identity = issue.id ? ` (${issue.id})` : "";
    console.warn(`Recent registry row ${issue.position}${identity}: ${issue.reason}`);
  }
}

function setLandingStatusHidden(hidden) {
  landingStatusHidden = hidden;
  const status = document.querySelector("#status");
  if (status) status.hidden = landingSuppressed || hidden;
}

/** The day window the toolbar is holding, named by the date it applies to. */
function describeWindow(dates, order) {
  const subject = order === FIRST_REGISTRATION_ORDER ? "First registered" : "Registered";
  if (dates.from && dates.to) {
    return `${subject} between ${displayDate(dates.from)} and ${displayDate(dates.to)}`;
  }
  if (dates.from) return `${subject} on or after ${displayDate(dates.from)}`;
  return `${subject} on or before ${displayDate(dates.to)}`;
}

function setLandingSuppressed(suppressed) {
  landingSuppressed = suppressed;
  // A panel outlives the card it was raised from unless something says so:
  // it is over the page, not in the grid, and hiding the grid does not reach
  // it. The same goes for the redraws below.
  statementPreview.close();
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
  const warning = registryWarningNode();
  try {
    if (warning) warning.hidden = true;
    status.className = "status";
    status.textContent = "Reading the Palomar database…";
    setLandingStatusHidden(false);
    grid.replaceChildren();
    const { databaseBase, availabilityUrl } = dataSource();
    const availabilityPromise = loadAvailabilityBounded(availabilityUrl);
    // The publisher projects every landing-card field from validated canonical
    // entries into this bounded newest-first document. Rendering the selection
    // therefore costs one summary read, not one record read per card.
    const recent = await loadRecent(databaseBase);
    const issues = recentValidationIssues(recent);
    const entries = recent.entries;
    landingMatches = entries.map((entry) => ({ entry, blob: searchBlob(entry) }));
    // GitHub Pages may briefly pair HTML and JavaScript from adjacent deployments.
    // Metrics are presentation-only, so a removed metric must not abort the registry.
    setOptionalText("#metric-results", String(entries.length));
    setOptionalText(
      "#metric-projects",
      new Set(entries.map((entry) => entry.source.repository)).size,
    );
    if (!entries.length) {
      setLandingStatusHidden(false);
      if (issues.omitted) {
        status.textContent = issues.omitted === 1
          ? "1 registry entry could not be displayed."
          : `${issues.omitted} registry entries could not be displayed.`;
        status.classList.add("warning");
      } else {
        status.textContent =
          "The telescope is ready. No entries have been registered yet; the first registered result will appear here automatically.";
        status.classList.add("empty");
      }
      showRecentIssues(issues);
      if (warning) warning.hidden = true;
      return true;
    }
    showRecentIssues(issues);
    setLandingStatusHidden(true);
    status.textContent = "";
    status.className = "status";
    const orderControl = document.querySelector("#order-by");
    const fromControl = document.querySelector("#date-from");
    const toControl = document.querySelector("#date-to");
    if (orderControl && params.has("order")) {
      orderControl.value = normalizeOrder(params.get("order"));
    }
    for (const [control, name] of [[fromControl, "from"], [toControl, "to"]]) {
      if (control && params.has(name)) control.value = params.get(name).slice(0, 10);
    }
    // A deployment's HTML and its JavaScript can be a moment apart on GitHub
    // Pages, so the order is read from the control when the page has one and
    // from the link when it does not.
    let order = normalizeOrder(orderControl ? orderControl.value : params.get("order"));
    const cards = entries.map((entry) =>
      entryCard(entry, {
        versionCount: entry.versions,
        current: true,
        registeredAt: entry.published_at,
        order,
      }));
    // The rows the grid is arranged and filtered by, paired with the cards
    // showing them, so that neither question has to read a card back.
    const listed = entries.map((entry, index) => ({
      card: cards[index],
      row: { id: entry.id, registeredAt: entry.published_at },
    }));
    /**
     * The cards, in the order asked for, dated by the day that order keys on.
     *
     * Appending a card already in the grid moves it, so this rearranges the
     * cards rather than rebuilding them: a rebuilt card would lose its hover
     * preview registration and whatever the availability answer decorated it
     * with.
     */
    const arrange = () => {
      statementPreview.close();
      const ordered = [...listed].sort((left, right) =>
        compareRows(left.row, right.row, order));
      for (const item of ordered) setCardDates(item.card, item.row, order);
      grid.append(...ordered.map((item) => item.card));
    };
    arrange();
    void availabilityPromise.then((availability) => {
      decorateCardSet(cards, entries, availability, "Landing card");
    }).catch((error) => {
      console.warn(`Landing card source availability could not be applied: ${error.message}`);
    });
    let trust = "all";
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
    // The subject inputs are always on the toolbar now. Cached HTML from a
    // previous deployment still keeps them behind a disclosure, so a deep link
    // that filters by subject opens it there rather than leaving the page
    // filtered by controls the reader cannot see.
    const advancedFilters = document.querySelector(".advanced-filters");
    if (advancedFilters && (params.has("arxiv") || params.has("msc"))) {
      advancedFilters.open = true;
    }
    // Words are the registry search's business now. What is left here narrows
    // the landing selection by facts the cards already carry, which is why it
    // can stay instant and local.
    const update = () => {
      const arxivValue = arxiv?.value.trim() || "";
      // Codes are written in upper case in the registry, and typing one in
      // lower case is not a mistake worth an error message.
      const mscValue = (msc?.value.trim() || "").toUpperCase();
      const arxivInvalid = Boolean(arxivValue && !ARXIV_FILTER_RE.test(arxivValue));
      const mscInvalid = Boolean(mscValue && !MSC2020_FILTER_RE.test(mscValue));
      const dates = dayWindow({ from: fromControl?.value, to: toControl?.value });
      let shown = 0;
      let oldest = null;
      for (const { card, row } of listed) {
        const day = orderedDay(row, order);
        if (oldest === null || day < oldest) oldest = day;
        const visible =
          (trust === "all" || card.dataset.trust === trust) &&
          (!arxivValue || (!arxivInvalid && card.dataset.arxiv.split(" ").includes(arxivValue))) &&
          (!mscValue ||
            (!mscInvalid &&
              card.dataset.msc.split(" ").some((code) => code.startsWith(mscValue)))) &&
          withinWindow(day, dates);
        card.hidden = !visible;
        if (visible) shown += 1;
      }
      const classificationQuery = [
        arxivValue && `arXiv ${arxivValue}`,
        mscValue && `MSC2020 ${mscValue}`,
      ].filter(Boolean);
      const invalidClassifications = [
        arxivInvalid && "arXiv",
        mscInvalid && "MSC2020",
      ].filter(Boolean);
      const classificationReason = invalidClassifications.length
        ? `Invalid classification code format: ${invalidClassifications.join(", ")}.`
        : classificationQuery.length
        ? `Classification query: ${classificationQuery.join(", ")}.`
        : "";
      const dateReason = dates.malformed.length
        ? `Invalid date: ${dates.malformed.join(", ")}.`
        : dates.empty
        ? "The date range ends before it begins."
        : dates.active
        ? `${describeWindow(dates, order)}.`
        : "";
      // This page is the newest results and not the whole registry, so a range
      // that reaches past its oldest row reaches past what it can answer for.
      // Said whether or not anything matched, because a reader who gets some of
      // the range back has no way to tell that it was not all of it.
      const reachesEarlier = Boolean(
        dates.from && !dates.malformed.length && !dates.empty && oldest && dates.from < oldest,
      );
      const boundReason = reachesEarlier
        ? `${order === FIRST_REGISTRATION_ORDER ? "Results first registered" : "Versions registered"} ` +
          `before ${displayDate(oldest)} are not on this page.`
        : "";
      const reasons = [classificationReason, dateReason, boundReason].filter(Boolean);
      status.textContent = shown
        ? boundReason
        : reasons.length
        ? `No registry entries match the current filters. ${reasons.join(" ")}`
        : "No registry entries match those filters.";
      setLandingStatusHidden(Boolean(shown) && !boundReason);
    };
    let updateTimer;
    const scheduleUpdate = () => {
      window.clearTimeout(updateTimer);
      updateTimer = window.setTimeout(update, FILTER_UPDATE_DELAY_MS);
    };
    for (const control of [arxiv, msc, fromControl, toControl]) {
      for (const eventName of ["input", "change", "search"]) {
        control?.addEventListener(eventName, scheduleUpdate);
      }
    }
    // Not on the delay the text fields use. Choosing an order is one act on a
    // list, not a word being typed a letter at a time.
    orderControl?.addEventListener("change", () => {
      order = normalizeOrder(orderControl.value);
      arrange();
      update();
    });
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
    if (warning) warning.hidden = true;
    setLandingStatusHidden(false);
    status.textContent = `The registry could not be loaded: ${error.message}`;
    status.className = "status error";
    return false;
  }
}

// The landing selection with its text already flattened, kept so that a reader
// who starts typing sees the entries the page holds without waiting for
// anything. Matching happens on a keystroke pause, so the flattening is done
// once here rather than two hundred times per pause.
let landingMatches = [];

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
  statementPreview.close();
  const cards = entries.map((entry) => entryCard(entry));
  results.replaceChildren(...cards);
  return cards;
}

/**
 * The loaded entries that carry what was typed, for the wait.
 *
 * This is not the question the registry index answers. It looks for the text
 * anywhere inside the newest entries the page happens to hold; the index looks
 * for whole words, requires all of them, and covers every published version.
 * So this will show entries the search then removes, and miss ones it finds.
 * That gap is why the result of this is drawn as provisional and thrown away
 * the moment the registry answers.
 */
function previewEntries(query) {
  // Every word must appear, as the index requires, but a word matches anywhere
  // inside a longer one, because half a word is what a reader has typed so far.
  // Bounded like the index bounds itself: the query is up to four thousand
  // characters, and this runs between two keystrokes.
  const wanted = [...new Set(query.trim().toLowerCase().split(/\s+/).filter(Boolean))]
    .slice(0, SEARCH_TERM_LIMIT);
  if (!wanted.length) return [];
  const matches = [];
  for (const { entry, blob } of landingMatches) {
    if (!wanted.every((word) => blob.includes(word))) continue;
    matches.push(entry);
    if (matches.length === SEARCH_RESULT_LIMIT) break;
  }
  return matches;
}

function renderPreviewCards(results, entries) {
  // Drawn like the search cards that will replace them, down to leaving out
  // which version is current: the landing rows do carry that, but showing it
  // here would mean every card quietly lost a claim when the results arrived.
  const cards = entries.map((entry) =>
    entryCard(entry, { registeredAt: entry.published_at }));
  results.replaceChildren(...cards);
  results.classList.add("preview");
  return cards;
}

function setSearchBusy(results, busy) {
  const spinner = document.querySelector("#search-spinner");
  if (spinner) spinner.hidden = !busy;
  // The results grid is a polite live region. Without this it reads out the
  // provisional cards and then reads the whole verified set again, which is
  // two announcements for one search and the first of them not yet true.
  if (busy) results.setAttribute("aria-busy", "true");
  else results.removeAttribute("aria-busy");
}

/** The result a reader is standing on, so that replacing the set can put them back. */
function focusedEntryId(results) {
  const active = document.activeElement;
  if (!active || !results.contains(active)) return null;
  return active.closest(".entry-card")?.dataset.id || null;
}

/**
 * Put the reader back where they were once the provisional cards are replaced.
 *
 * Without this, confirming a result silently drops focus to the document body,
 * because the node the reader was on is one of the ones thrown away.
 */
function restoreFocusAfterSwap(results, entryId) {
  if (!entryId) return;
  // Matched by walking the cards rather than by building a selector out of a
  // value that came from data, which is the rule everywhere else here.
  const card = [...results.children].find((node) => node.dataset.id === entryId);
  const link = card?.querySelector("a");
  if (link) link.focus();
  else document.querySelector("#query")?.focus();
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

/**
 * Show what this query looks like from here, and unless told otherwise, ask.
 *
 * `ask: false` is the keystroke half. A reader who has typed on has already
 * left the answer on the page behind, so the request in flight for it is
 * abandoned and the provisional set is repainted at once, without waiting out
 * the pause first. Waiting would leave one query in the box and a different
 * query's results, verified and undimmed, underneath it.
 */
async function renderSearch(query, { ask = true } = {}) {
  const generation = searchGeneration + 1;
  searchGeneration = generation;
  activeSearchController?.abort(new Error("superseded registry search"));
  activeSearchController = null;
  const status = document.querySelector("#search-status");
  const results = document.querySelector("#search-results");
  const input = document.querySelector("#query");
  if (!status || !results) return;
  results.replaceChildren();
  results.classList.remove("preview");
  setSearchBusy(results, false);
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
  status.hidden = false;
  // Something to read while the registry is asked. It is drawn from a smaller
  // pool by a looser rule, so the status says so rather than letting it pass
  // for an answer.
  const preview = previewEntries(query);
  if (preview.length) {
    renderPreviewCards(results, preview);
    status.textContent =
      `Showing ${preview.length} match${preview.length === 1 ? "" : "es"} from the ` +
      `newest ${landingMatches.length} entries while the registry search runs…`;
  } else {
    status.textContent = "Searching the registry…";
  }
  setSearchBusy(results, true);
  if (!ask) return;
  const controller = new AbortController();
  activeSearchController = controller;
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
    // Read immediately before the swap, not when the search began: the reader
    // had the whole wait in which to go and stand on one of these cards.
    const wasOn = focusedEntryId(results);
    const cards = renderSearchCards(results, found.entries);
    restoreFocusAfterSwap(results, wasOn);
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
    // A failed search shows nothing rather than leaving the provisional set
    // standing under an error that does not describe it.
    results.replaceChildren();
    if (error instanceof RangeError) showSearchQueryWarning(input, status, error);
    else {
      status.textContent = `The search could not be run: ${error.message}`;
      status.classList.add("error");
    }
  } finally {
    // A superseded search owns none of this any more: the query that replaced
    // it has already put up its own provisional set and its own spinner.
    if (generation === searchGeneration) {
      activeSearchController = null;
      results.classList.remove("preview");
      setSearchBusy(results, false);
    }
  }
}

function wireSearch() {
  const form = document.querySelector("#registry-search");
  const input = document.querySelector("#query");
  if (!form || !input) return false;
  const initial = params.get("q") || "";
  input.value = initial;
  let queryTimer;
  const runQuery = () => {
    window.clearTimeout(queryTimer);
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
    // replaceState, not pushState: typing a query is not a series of pages to
    // walk back through, but the address stays worth copying at every pause.
    window.history.replaceState(null, "", searchPageUrlFor(query));
    renderSearch(query);
  };
  const scheduleQuery = () => {
    window.clearTimeout(queryTimer);
    // Repaint from what is already loaded now, and ask the registry once the
    // typing stops. Only the request is worth waiting for: filtering entries
    // the page is already holding costs nothing, and doing it on the same
    // delay would leave the last query's answer sitting under the new one.
    renderSearch(input.value, { ask: false });
    queryTimer = window.setTimeout(runQuery, SEARCH_UPDATE_DELAY_MS);
  };
  input.addEventListener("input", scheduleQuery);
  form.addEventListener("submit", (event) => {
    // The page's own content security policy forbids form submission, which is
    // right: nothing here posts anywhere. The query is a link to this page.
    event.preventDefault();
    // Enter means stop waiting for the pause, not run a second search.
    runQuery();
  });
  if (initial) renderSearch(initial);
  return Boolean(initial);
}

function detailRow(label, value) {
  const row = el("div", "detail-row");
  row.append(el("dt", "", label), el("dd", "", String(value)));
  return row;
}

function peopleDetailRow(label, people) {
  const row = el("div", "detail-row");
  row.append(el("dt", "", label), appendPeople(el("dd"), people));
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

function sourceLink(text, sourceAvailability, urlForAvailability, className) {
  return bindSourceControl(
    externalLink(text, urlForAvailability(sourceAvailability.current), className),
    sourceAvailability,
    (availability) => ({ url: urlForAvailability(availability) }),
  );
}

function sourceDetailRow(
  labelText,
  text,
  sourceAvailability,
  urlForAvailability,
  note,
) {
  const row = el("div", "detail-row");
  row.append(el("dt", "", labelText));
  const value = el("dd");
  value.append(sourceLink(text, sourceAvailability, urlForAvailability));
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

/**
 * The local data overrides, carried across to the page being linked to.
 *
 * Honoured on loopback only, and only there because a test fixture is served
 * from somewhere other than the registry. A link that dropped them would leave
 * the next page reading the production database in the middle of a test run.
 * Appended last, so an ordinary link's own parameters stay at the front of it.
 */
function carryLocalOverrides(target) {
  if (isLoopbackHostname(window.location.hostname)) {
    for (const name of ["database", "render-base"]) {
      if (params.has(name)) target.searchParams.set(name, params.get(name));
    }
  }
  return safeInternalUrl(target, window.location.href);
}

function localPageUrl(page, entry) {
  const target = new URL(page, window.location.href);
  target.search = "";
  target.searchParams.set("id", entry.id);
  target.searchParams.set("version", String(entry.version));
  return carryLocalOverrides(target);
}

function subjectPageUrl(kind, code) {
  const target = new URL("/subject", window.location.href);
  target.search = "";
  target.searchParams.set("kind", kind);
  target.searchParams.set("code", code);
  return carryLocalOverrides(target);
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
const { citationSection } = createCitationPresentation({ document, navigator, window });

/** One kind of assurance, named so the two can be told apart at a glance. */
function assurance(kind, ...content) {
  const paragraph = el("p");
  paragraph.append(el("strong", "", `${kind}: `), ...content);
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
function licenceRow(entry, sourceAvailability) {
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
    sourceLink(
      licence.path,
      sourceAvailability,
      (availability) => sourceFileUrl(entry, licence.path, availability),
    ),
    " ",
    digestNote(licence.sha256),
  );
  row.append(value);
  return row;
}

function registrationCallout(entry, databaseBase) {
  const callout = el("div", "registration-callout");
  const check = el("span", "registration-check", "✓");
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
      "Archived automated review",
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
    el("strong", "", `Registered on ${displayDate(registrationDay(entry.registered_at))}`),
    assurance(
      "Mechanical assurance",
      "Comparator checked that the recorded ",
      el("code", "", "Solution.lean"),
      " proves the recorded formal ",
      el("code", "", "Challenge.lean"),
      " under the listed axiom and dependency rules, and both Lean's kernel and NanoDa checked the exported proof successfully.",
    ),
    assurance(
      "Automated review",
      "an AI-mediated review checked whether that formal ",
      el("code", "", "Challenge.lean"),
      " matches the informal mathematical claim under the recorded policy. This is not human peer review or a novelty certificate.",
    ),
    evidenceLinks,
  );
  callout.append(check, copy);
  return callout;
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

  const categoryRow = (label, values, kind) => {
    const row = el("div", "detail-row");
    row.append(el("dt", "", label));
    const value = el("dd", "category-list");
    for (const code of values) {
      // The code itself is the link: a reader who wants the other entries in
      // a subject clicks the subject, rather than a separate word beside it.
      value.append(classificationToken(kind, code, code, "category-link"));
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
  return section;
}

function mathematicalSourceIdentifier(identifier, sourceLabel) {
  if (!identifier) return null;
  const resolved = mathematicalSourceUrl(identifier);
  if (!resolved) return el("code", "", identifier);
  const link = externalLink(resolved.kind === "url" ? "Source link" : identifier, resolved.href);
  if (resolved.kind === "url") link.setAttribute("aria-label", `Open source for ${sourceLabel}`);
  return link;
}

function provenanceSection(entry, sourceAvailability) {
  const provenance = entry.provenance;
  const section = el("section", "entry-provenance");
  const disclosure = el("details", "section-collapse");
  const heading = el("div", "section-heading");
  const title = el("div");
  // A heading inside a summary is exposed as a heading by Chromium, but the
  // engines that flatten a summary's contents into its own accessible name
  // would leave the section with no way to find it. Naming the section from
  // the same text makes it a landmark, which is a second route to it that does
  // not depend on how the disclosure treats what is inside the summary.
  const sectionHeading = el("h2", "", "Mathematical origin");
  sectionHeading.id = "provenance-heading";
  section.setAttribute("aria-labelledby", sectionHeading.id);
  title.append(el("div", "eyebrow", "Provenance"), sectionHeading);
  heading.append(title);
  const summary = el("summary");
  summary.append(heading);
  disclosure.append(summary);
  section.append(disclosure);

  const details = el("dl", "details provenance-details");
  // Where the mathematics actually lives comes first. For a thin wrapper it is
  // the only row here that points at the work being registered; it used to sit
  // below the repository role that exists to announce it.
  if (provenance.repository_role === "thin-wrapper") {
    const substantive = provenance.substantive_formalization;
    details.append(
      sourceDetailRow(
        "Substantive formalization",
        `${substantive.repository}@${substantive.commit.slice(0, 12)}`,
        sourceAvailability,
        (availability) => {
          const location = sourceLocation(
            entry,
            availability,
            substantive.repository,
            substantive.commit,
          );
          return pinnedRepositoryDirectoryUrl(location.repository, substantive.commit);
        },
      ),
    );
  }
  details.append(
    detailRow("Result origin", RESULT_ORIGIN_LABELS[provenance.result_origin]),
    detailRow("Repository role", REPOSITORY_ROLE_LABELS[provenance.repository_role]),
    peopleDetailRow(
      "Responsible maintainers",
      provenance.responsible_maintainers,
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
  disclosure.append(details);

  if (provenance.mathematical_sources.length) {
    disclosure.append(el("h3", "", "Mathematical sources"));
    const sources = el("ul", "plain-list provenance-sources");
    for (const source of provenance.mathematical_sources) {
      const item = el("li");
      const label = source.authors.length
        ? `${source.authors.map((author) => author.name).join(", ")}: ${source.title}`
        : source.title;
      const citation = el("span", "source-citation");
      if (source.authors.length) {
        appendPeople(citation, source.authors);
        citation.append(`: ${source.title}`);
      } else {
        citation.append(source.title);
      }
      item.append(citation);
      const identifier = mathematicalSourceIdentifier(source.identifier, label);
      if (identifier) item.append(" · ", identifier);
      if (source.contributors?.length) {
        item.append(el(
          "span",
          "source-contributors",
          ` — ${source.contributors
            .map((contributor) => `${contributor.name} (${contributor.role})`)
            .join("; ")}`,
        ));
      }
      item.append(el("span", "source-relationship", ` — ${source.relationship}`));
      sources.append(item);
    }
    disclosure.append(sources);
  } else {
    disclosure.append(el("p", "no-sources", "No prior mathematical source is recorded."));
  }

  if (provenance.related_formalizations.length) {
    disclosure.append(el("h3", "", "Related formalizations"));
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
    disclosure.append(related);
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
  availabilityPromise,
  databaseBase,
) {
  const sourceAvailability = createSourceAvailabilityBinding(availabilityPromise);
  document.title = `${entry.title} — Palomar`;
  setCanonicalEntryPage(entry);
  const heading = el("header", "entry-heading");
  const top = el("div", "card-top");
  top.append(el("span", "entry-id", `${entry.id} v${entry.version}`), trustBadge(entry));
  heading.append(top, el("h1", "", entry.title));
  const abstract = presentationAbstract(entry);
  if (abstract) heading.append(el("p", "lede", abstract));
  const byline = el("p", "byline", "By ");
  appendPeople(byline, entry.authors);
  heading.append(byline);

  const evidence = el("section", "entry-evidence");
  const evidenceTitle = el("div", "section-heading");
  const titleBlock = el("div");
  titleBlock.append(el("div", "eyebrow", "Verification"), el("h2", "", "What was checked"));
  evidenceTitle.append(titleBlock);
  const evidenceDetails = el("details", "section-collapse evidence-collapse");
  evidenceDetails.append(el("summary", "", "Verification details"));
  evidence.append(evidenceTitle, registrationCallout(entry, databaseBase), evidenceDetails);
  const details = el("dl", "details");
  details.append(
    detailRow("Mechanically verified", displayTimestamp(entry.verification.verified_at)),
    sourceDetailRow(
      "Fixed source version",
      `${entry.source.repository}@${entry.source.commit.slice(0, 12)}`,
      sourceAvailability,
      (availability) => pinnedRepositoryDirectoryUrl(
        topSourceLocation(entry, availability).repository,
        entry.source.commit,
      ),
    ),
  );
  // Only worth a row when it is somewhere. At the repository root it is the
  // absence of a fact, and the fixed source version above already links there.
  if (entry.source.project_path) {
    details.append(
      sourceDetailRow(
        "Project directory",
        entry.source.project_path,
        sourceAvailability,
        (availability) => pinnedRepositoryDirectoryUrl(
          topSourceLocation(entry, availability).repository,
          entry.source.commit,
          entry.source.project_path,
        ),
      ),
    );
  }
  details.append(
    // The digest belongs to the file, so it sits with the file rather than in
    // a row of its own two lines further down.
    sourceDetailRow(
      "Statement file",
      entry.formalization.challenge_path,
      sourceAvailability,
      (availability) => sourceFileUrl(
        entry,
        entry.formalization.challenge_path,
        availability,
      ),
      digestNote(entry.verification.challenge_sha256),
    ),
    sourceDetailRow(
      "Proof file",
      entry.formalization.solution_path,
      sourceAvailability,
      (availability) => sourceFileUrl(
        entry,
        entry.formalization.solution_path,
        availability,
      ),
      digestNote(entry.verification.solution_sha256),
    ),
    sourceDetailRow(
      "Formalization metadata",
      entry.formalization.formalization_metadata_path,
      sourceAvailability,
      (availability) => sourceFileUrl(
        entry,
        entry.formalization.formalization_metadata_path,
        availability,
      ),
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
      sourceDetailRow(
        "Lakefile",
        entry.formalization.lakefile_path,
        sourceAvailability,
        (availability) => sourceFileUrl(
          entry,
          entry.formalization.lakefile_path,
          availability,
        ),
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
      licenceRow(entry, sourceAvailability),
    );
  }
  evidenceDetails.append(details);
  {
    // The sentence qualifies the licence row of the table above it, so it
    // lives inside the same disclosure. Outside it, a collapsed page carries a
    // caveat about licence evidence that is nowhere on the page.
    evidenceDetails.append(
      el(
        "p",
        "licence-boundary",
        "This licence evidence covers the submitted repository snapshot only. Cited papers, reused formalizations, and dependencies retain their own licences.",
      ),
    );
  }

  const trust = statementDependencies(entry);

  const editorial = el("section", "entry-editorial");
  const editorialDisclosure = el("details", "section-collapse");
  const editorialTitle = el("div", "section-heading");
  const editorialBlock = el("div");
  const editorialHeading = el("h2", "", "Automated review");
  editorialHeading.id = "review-heading";
  editorial.setAttribute("aria-labelledby", editorialHeading.id);
  editorialBlock.append(el("div", "eyebrow", "Editorial record"), editorialHeading);
  editorialTitle.append(
    editorialBlock,
    el(
      "span",
      "decision",
      entry.review.warnings.length
        ? "No blocking problems identified"
        : "No problems identified",
    ),
  );
  const editorialSummary = el("summary");
  editorialSummary.append(editorialTitle);
  editorialDisclosure.append(editorialSummary);
  editorial.append(editorialDisclosure);
  // No scores. They contribute to the filter outcome and are kept
  // beside the database, but they never reach here: the same repository at
  // the same commit has scored 5 and then 4 on the same axis across runs, and a
  // number that moves like that reads as a judgement it cannot support. What
  // it can support is the plain-language outcome above.
  editorialDisclosure.append(
    el(
      "p",
      "review-explanation",
      "An AI review compared the informal claim with the formal statement under " +
        "the recorded policy, and its comments are below. It is not human peer " +
        "review and not a novelty certificate.",
    ),
  );
  if (entry.review.warnings.length) {
    editorialDisclosure.append(el("h3", "", "AI review comments"));
    const comments = el("ul", "review-comments");
    for (const comment of entry.review.warnings) comments.append(el("li", "", comment));
    editorialDisclosure.append(comments);
  } else {
    editorialDisclosure.append(el("p", "no-warnings", "The review recorded no comments on this result."));
  }
  editorialDisclosure.append(
    dataLink(
      "Read the archived review",
      evidenceDataUrl(entry, databaseBase, "review.json"),
    ),
  );

  const challenge = await challengePresentation(entry, renderBase, {
    dependenciesOnThisPage: true,
    sourceAvailability,
  });
  const sourceNotice = createSourceAvailabilityNotice(entry, sourceAvailability, {
    el,
    externalLink,
  });
  const versionNoticeNode = versionNotice(entry, currentVersion);
  const citation = citationSection(entry);
  const history = versionHistory(entry, versions, currentVersion);
  content.append(heading);
  // A broken or degraded source affects every link on the page and remains a
  // warning at the top. The ordinary preservation confirmation is provenance,
  // not an alert, so keep it with the registry history near the bottom. The
  // ancillary observation decides that placement only after it settles; until
  // then there is no availability claim or placeholder in the document.
  if (versionNoticeNode) content.append(versionNoticeNode);
  // The statement first, then what was checked about it, then what it rests
  // on. A registry entry is about a theorem, and the theorem should not be
  // below the paperwork that certifies it; these three used to be the sixth,
  // fifth and seventh things on the page.
  content.append(
    challenge.section,
    evidence,
    trust,
    solutionMetadata(entry, challenge.metadata, sourceAvailability),
    provenanceSection(entry, sourceAvailability),
    classificationSection(entry),
    citation,
    editorial,
    history,
  );
  sourceAvailability.whenReady(() => {
    if (sourceNotice.classList.contains("preserved")) {
      content.insertBefore(sourceNotice, history);
    } else {
      content.insertBefore(sourceNotice, versionNoticeNode || challenge.section);
    }
  });
}

const SUBJECT_SCHEME_LABELS = Object.freeze({ arxiv: "arXiv subject", msc: "MSC2020" });

/**
 * What one classification code is, above the results carrying it.
 *
 * The code is the heading because the code is what the URL is, and the
 * description is beneath it in full: a page about one subject has room for the
 * words, where the compact rows that link here do not.
 */
function renderSubjectHeading(kind, code, head, content) {
  document.title = `${code} — Palomar`;
  const heading = el("header", "subject-heading");
  const eyebrow = el("div", "eyebrow", SUBJECT_SCHEME_LABELS[kind]);
  const title = el("h1", "", code);
  const gloss = el("p", "subject-gloss");
  taxonomy(kind).then((table) => {
    const description = table[code];
    if (typeof description === "string" && description) gloss.textContent = description;
  });
  const counts = el("div", "subject-counts");
  counts.append(
    el(
      "span",
      "",
      `${head.results} ${head.results === 1 ? "result" : "results"}, ` +
        `${head.versions} current ${head.versions === 1 ? "version" : "versions"}`,
    ),
    dataLink(
      "Machine-readable index",
      subjectHeadUrl(kind, code, dataSource().databaseBase),
      "data-link",
    ),
  );
  heading.append(eyebrow, title, gloss, counts);
  content.append(heading, el("div", "subject-list"));
}

/**
 * The rows of a subject page, which are not registry cards.
 *
 * A subject document carries an index row plus the classification and the
 * registration instant, and nothing else: no authors, no dependencies, no
 * source. Rendering an entry card from it would mean reading fifty records to
 * fill one listing, which is the cost this whole surface exists to avoid.
 */
function renderSubjectRows(rows, content) {
  const list = content.querySelector(".subject-list");
  for (const row of rows) {
    const article = el("article", "subject-row");
    const identity = el("div", "card-identity");
    identity.append(
      el("span", "entry-id", `${row.id} v${row.version}`),
      el("span", "entry-date", `Registered ${displayDate(registrationDay(row.published_at))}`),
    );
    const title = el("h2");
    title.append(internalLink(row.title, localPageUrl("/entry", row)));
    article.append(identity, title);
    const abstract = presentationAbstract(row);
    if (abstract) article.append(el("p", "card-abstract", abstract));
    const subjects = el("div", "card-subjects");
    subjects.append(el("small", "", "Subjects"), categoryTokens(row));
    article.append(subjects);
    list.append(article);
  }
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
  // Bound to the containers, not to the cards, because both grids replace
  // their children whenever a query or a filter changes.
  statementPreview.watch(document.querySelector("#entry-grid"));
  statementPreview.watch(document.querySelector("#search-results"));
  // A linked search is its own view. Avoid fetching and exposing a hidden
  // recent listing until the query is cleared; then load it exactly once.
  const hasInitialSearch = wireSearch();
  if (!hasInitialSearch) ensureLanding();
}
if (document.body.dataset.page === "entry") {
  // A same-page anchor into a collapsed section must open that section first,
  // or the fragment lands on a heading whose content is still hidden. The
  // browser runs this before the default fragment navigation, so the target
  // is already expanded by the time it scrolls.
  document.addEventListener("click", (event) => {
    const link = event.target.closest?.('a[href*="#"]');
    if (!link) return;
    const href = link.getAttribute("href");
    if (!href) return;
    const fragmentIndex = href.indexOf("#");
    if (fragmentIndex === -1) return;
    const fragment = href.slice(fragmentIndex);
    if (fragment === "#") return;
    const target = document.getElementById(decodeURIComponent(fragment.slice(1)));
    if (target) expandDetailsForTarget(target);
  });
  // The click above covers links on this page and the initial render covers a
  // fragment the page was opened with. A hash that arrives any other way, from
  // the address bar or from history navigation, gets the same treatment: the
  // browser has already scrolled to a collapsed heading, so the section is
  // opened and the target brought back into view.
  window.addEventListener("hashchange", () => {
    const fragment = window.location.hash.slice(1);
    if (!fragment) return;
    const target = document.getElementById(decodeURIComponent(fragment));
    if (!target) return;
    expandDetailsForTarget(target);
    target.scrollIntoView();
  });
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
      loaded.availabilityPromise,
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
if (document.body.dataset.page === "subject") {
  renderSubjectPage({
    params,
    document,
    loadSubjectHead,
    loadSubjectYear,
    loadSubjectPage,
    renderHeading: renderSubjectHeading,
    renderRows: renderSubjectRows,
  });
}

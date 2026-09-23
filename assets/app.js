import {
  RESULT_ORIGIN_LABELS,
  REPOSITORY_ROLE_LABELS,
  isLoopbackHostname,
  pinnedRepositoryDirectoryUrl,
  safeDataUrl,
  safeExternalUrl,
  safeInternalUrl,
  subjectHeadUrl,
  workflowRunId,
  hasToolchainProvenance,
} from "./security.mjs";
import { renderRegistryPage } from "./registry-page.mjs";
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
import { abstractSegments, presentationAbstract } from "./presentation-text.mjs";
import {
  DEFAULT_ORDER,
  cardDates,
  registrationDay,
} from "./registry-dates.mjs";
import {
  bindSourceControl,
  createSourceAvailabilityBinding,
  createSourceAvailabilityNotice,
  sourceFileUrl,
  sourceLocation,
  topSourceLocation,
} from "./source-preservation.mjs";

const params = new URLSearchParams(window.location.search);
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * One abstract as a paragraph, with the submitter's own code spans and the
 * mathematics in their sentences each kept apart from the prose.
 *
 * Both surfaces that show an abstract build it here, so a card and an entry
 * page mark the same runs. A span a submitter marked is `code`; an expression
 * found by its operators is not, because this page found it rather than being
 * told, and saying `code` would claim otherwise. Each run is appended as text
 * or as one element, never as markup, which is what keeps a submitter's
 * abstract unable to introduce any.
 */
function abstractParagraph(className, text) {
  const paragraph = el("p", className);
  for (const segment of abstractSegments(text)) {
    if (segment.kind === "code") paragraph.append(el("code", "", segment.text));
    else if (segment.kind === "math") paragraph.append(el("span", "expression", segment.text));
    else paragraph.append(segment.text);
  }
  return paragraph;
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
  loadResults,
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
function dateSpans({ id, registeredAt }, order) {
  return cardDates({ id, registeredAt }, order).map(({ className, label, day }) =>
    el("span", className, `${label} ${displayDate(day)}`));
}

const TABLE_COLUMNS = [
  ["Result", "row-result"],
  ["Authors", "row-authors"],
  ["Subjects", "row-subjects"],
  ["Dependencies", "row-dependencies"],
  ["Registered", "row-registered"],
];

/**
 * One registered result as a table row.
 *
 * Carries the same identity and classification data attributes the card does,
 * because the toolbar narrows the selection by reading them off whichever node
 * is showing rather than by asking the record again.
 */
function entryRow(entry, { registeredAt = entry.registered_at, order = DEFAULT_ORDER } = {}) {
  const categories = classification(entry);
  const row = el("tr", "entry-row");
  row.dataset.id = entry.id;
  row.dataset.trust = entry.trust.level;
  row.dataset.arxiv = categories.arxiv.join(" ");
  row.dataset.msc = categories.msc2020.join(" ");

  const result = el("td", "row-result");
  const titleLink = internalLink(entry.title, localPageUrl("/entry", entry));
  // The same hover preview the cards carry: a row says less than a card, so
  // the rendering behind it is worth more here, not less.
  statementPreview.register(titleLink, entry);
  result.append(titleLink);

  const subjects = el("td", "row-subjects");
  subjects.append(categoryTokens(entry));
  const registered = el("td", "row-registered");
  registered.append(...dateSpans({ id: entry.id, registeredAt }, order));
  row.append(
    result,
    el("td", "row-authors", authorNames(entry)),
    subjects,
    el(
      "td",
      "row-dependencies",
      entry.trust.level === "high" ? "Mathlib only" : "Additional libraries",
    ),
    registered,
  );
  return row;
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
  if (entry.source?.project_path) {
    const project = el("div", "card-project");
    project.append(
      el("small", "", "Project directory"),
      el("span", "", entry.source.project_path),
    );
    meta.append(project);
  }
  const footer = el("div", "card-footer");
  const location = entry.source ? topSourceLocation(entry, null) : null;
  const historyUrl = new URL(localPageUrl("/entry", entry));
  historyUrl.hash = "version-history";
  footer.append(internalLink("View record", localPageUrl("/entry", entry)));
  if (entry.source && location) {
    footer.append(
      externalLink(entry.source.repository, pinnedRepositoryDirectoryUrl(entry.source.repository, entry.source.commit), "repo-link"),
      externalLink("Palomar preserved copy", pinnedRepositoryDirectoryUrl(location.archiveRepository, entry.source.commit), "archive-link"),
    );
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
  card.append(top, title);
  if (abstract) card.append(abstractParagraph("card-abstract", abstract));
  card.append(meta, footer);
  return card;
}

function renderRegistryRows(entries, view, order) {
  const grid = document.querySelector("#entry-grid");
  statementPreview.close();
  grid.replaceChildren();
  grid.classList.toggle("entry-table-view", view === "table");
  let mount = grid;
  if (view === "table") {
    const table = el("table", "entry-table");
    const head = el("thead");
    const headings = el("tr");
    for (const [label, className] of TABLE_COLUMNS) {
      const cell = el("th", className, label);
      cell.scope = "col";
      headings.append(cell);
    }
    head.append(headings);
    mount = el("tbody");
    table.append(head, mount);
    grid.append(table);
  }
  for (const entry of entries) {
    const node = view === "table" ? entryRow(entry, { registeredAt: entry.published_at, order })
      : entryCard(entry, { versionCount: entry.versions, current: true, registeredAt: entry.published_at, order });
    if (entry.abbreviated) {
      const notice = el("small", "summary-abbreviated", "Summary abbreviated; open the record for complete metadata.");
      (view === "table" ? node.querySelector(".row-result") : node).append(notice);
    }
    mount.append(node);
  }
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
  if (abstract) heading.append(abstractParagraph("lede", abstract));
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
    hasToolchainProvenance(entry)
      ? detailRow("Lean toolchain commit", entry.verification.toolchain_commit)
      : detailRow("Comparator commit", entry.verification.comparator_commit),
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
  details.append(
    hasToolchainProvenance(entry)
      ? detailRow(
        "Independent kernels",
        entry.verification.kernels.map((kernel) => kernel.name).join(", "),
      )
      : detailRow("NanoDa commit", entry.verification.nanoda_commit),
  );
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
    if (abstract) article.append(abstractParagraph("card-abstract", abstract));
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
  for (const kind of ["arxiv", "msc"]) {
    void taxonomy(kind).then(codes => {
      const list = document.querySelector(`#${kind}-options`);
      if (!list) return;
      list.replaceChildren(...Object.entries(codes).map(([code, description]) => {
        const option = el("option", "", description);
        option.value = code;
        return option;
      }));
    });
  }
  renderRegistryPage({ document, window, loadResults, renderRows: renderRegistryRows });
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

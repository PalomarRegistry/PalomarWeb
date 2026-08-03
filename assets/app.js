import {
  challengeArtifactUrl,
  challengeMetadataUrl,
  challengeSourceUrl,
  isInlineChallenge,
} from "./rendering.js";
import {
  databaseBaseFor,
  entryRecordUrl,
  isLoopbackHostname,
  pinnedSourceFileUrl,
  reportIssueNumber,
  safeDataUrl,
  safeExternalUrl,
  safeInternalUrl,
  selectDatabaseUrl,
  selectRenderBase,
  validateEntry,
  validateIndex,
  workflowRunId,
} from "./security.mjs";

const CANONICAL_WEB_BASE = "https://kim-em.github.io/PalomarWeb/";
const FEED_BASE = "https://kim-em.github.io/PalomarDatabase/feeds/";
const DATABASE_SOURCE_BASE = "https://github.com/kim-em/PalomarDatabase/blob/main/";

const params = new URLSearchParams(window.location.search);
const PALOMAR_ID = /^PALOMAR-\d{4}-\d{2}-\d{2}-\d{6}$/;
const VERSION_PARAMETER = /^[1-9][0-9]*$/;
const ARXIV_FILTER_RE = /^[a-z]+(?:-[a-z]+)*(?:\.[A-Za-z-]+)?$/;
const MSC2020_FILTER_RE = /^[0-9]{2}(?:[A-Z][0-9]{2}|-[0-9]{2})$/;
const FILTER_UPDATE_DELAY_MS = 200;

function dataSource() {
  const databaseUrl = selectDatabaseUrl(window.location.href, window.location.search);
  const databaseBase = databaseBaseFor(databaseUrl);
  const renderBase = selectRenderBase(window.location.href, window.location.search, databaseBase);
  return { databaseUrl, databaseBase, renderBase };
}

function categoryFeedBase() {
  if (!params.has("database")) return FEED_BASE;
  return new URL("feeds/", dataSource().databaseBase);
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

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) {
    const error = new Error(`${response.status} ${response.statusText}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

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

function acceptanceDate(entry) {
  const value = entry.accepted_at || entry.review?.reviewed_at?.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) {
    throw new Error("entry is missing a valid acceptance date");
  }
  return value;
}

function displayDate(value) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));
}

function latestVersions(entries) {
  const latest = new Map();
  for (const entry of entries) {
    const previous = latest.get(entry.id);
    if (!previous || entry.version > previous.version) latest.set(entry.id, entry);
  }
  return [...latest.values()];
}

function trustBadge(entry) {
  const high = entry.trust.level === "high";
  const badge = el("span", `trust-badge ${high ? "high" : "qualified"}`);
  badge.textContent = high
    ? "Statement dependencies: Mathlib only"
    : "Statement dependencies: additional libraries";
  return badge;
}

function entryCard(entry, versionCount) {
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
    entry.id,
    ...categories.arxiv,
    ...categories.msc2020,
  ].join(" ").toLowerCase();

  const top = el("div", "card-top");
  const identity = el("div", "card-identity");
  identity.append(
    el("span", "entry-id", `${entry.id} v${entry.version} · current`),
    el("span", "entry-date", `Accepted ${displayDate(acceptanceDate(entry))}`),
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
  const footer = el("div", "card-footer");
  const historyUrl = new URL(localPageUrl("entry.html", entry));
  historyUrl.hash = "version-history";
  footer.append(
    externalLink(entry.source.repository, entry.source.tree_url, "repo-link"),
    internalLink("View record", localPageUrl("entry.html", entry)),
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

async function loadEntries(index, databaseBase) {
  return Promise.all(
    index.entries.map(async (summary) => {
      const entry = await fetchJson(entryRecordUrl(summary, databaseBase));
      return validateEntry(entry, summary);
    }),
  );
}

async function renderIndex() {
  const status = document.querySelector("#status");
  const grid = document.querySelector("#entry-grid");
  try {
    const { databaseUrl, databaseBase } = dataSource();
    const index = validateIndex(await fetchJson(databaseUrl));
    const versionCounts = new Map();
    for (const summary of index.entries) {
      versionCounts.set(summary.id, (versionCounts.get(summary.id) || 0) + 1);
    }
    const currentIndex = { entries: latestVersions(index.entries) };
    const entries = await loadEntries(currentIndex, databaseBase);
    // GitHub Pages may briefly pair HTML and JavaScript from adjacent deployments.
    // Metrics are presentation-only, so a removed metric must not abort the registry.
    setOptionalText("#metric-results", String(entries.length));
    setOptionalText(
      "#metric-projects",
      new Set(entries.map((entry) => entry.source.repository)).size,
    );
    if (!entries.length) {
      status.textContent =
        "The telescope is ready. No entries have been published yet; the first accepted database PR will appear here automatically.";
      status.classList.add("empty");
      return;
    }
    status.hidden = true;
    for (const entry of entries.sort((a, b) => a.id.localeCompare(b.id))) {
      grid.append(entryCard(entry, versionCounts.get(entry.id)));
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
      status.hidden = shown !== 0;
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
  } catch (error) {
    status.textContent = `The registry could not be loaded: ${error.message}`;
    status.classList.add("error");
  }
}

function detailRow(label, value) {
  const row = el("div", "detail-row");
  row.append(el("dt", "", label), el("dd", "", String(value)));
  return row;
}

function externalDetailRow(labelText, text, href) {
  const row = el("div", "detail-row");
  row.append(el("dt", "", labelText));
  const value = el("dd");
  value.append(externalLink(text, href));
  row.append(value);
  return row;
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
      "Every version is an immutable accepted snapshot. The authorship, statement, proof, review, warnings, and dependency information on this page belong to the selected version only.",
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

async function challengePresentation(entry, renderBase, { forceFrame = false } = {}) {
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
  const dependencyRecordUrl = localPageUrl("entry.html", entry);
  dependencyRecordUrl.hash = "statement-dependencies";
  const comparatorPath = entry.formalization.comparator_config_path;
  links.append(
    externalLink(
      "View full pinned statement file (Challenge.lean)",
      challengeSourceUrl(entry),
      "challenge-source",
    ),
    " · ",
    internalLink(
      "Inspect statement dependencies",
      dependencyRecordUrl,
    ),
    " · ",
    externalLink(
      `View comparator configuration (${comparatorPath})`,
      pinnedSourceFileUrl(entry, comparatorPath),
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
      "The formatted view shows only the declarations named in this entry's comparator configuration. Comparator also checks the declarations used by their types. The full pinned Challenge.lean and dependency record expose the statement and dependency surface for inspection.",
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
        "This older entry cannot display its statement on this page. Use the statement file link above.",
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

function acceptanceCallout(entry) {
  const callout = el("div", "acceptance-callout");
  const check = el("span", "acceptance-check", "✓");
  check.setAttribute("aria-hidden", "true");
  const copy = el("div");
  const evidenceLinks = el("p", "certificate-evidence-links");
  if (entry.schema_version >= 5) {
    evidenceLinks.append(
      externalLink(
        "Archived mechanical report",
        `${DATABASE_SOURCE_BASE}${entry.verification.evidence_path}mechanical-report.json`,
      ),
      " · ",
    );
  } else {
    evidenceLinks.append(
      externalLink("Mechanical evidence", entry.verification.workflow_url),
      " · ",
    );
  }
  evidenceLinks.append(externalLink("Editorial evidence", entry.review.report_url));
  copy.append(
    el("strong", "", `Accepted on ${displayDate(acceptanceDate(entry))}`),
    el(
      "p",
      "",
      "Mechanical assurance: Comparator checked that the recorded Solution proves the recorded formal Challenge under the listed axiom and dependency rules, and both Lean's kernel and NanoDa accepted the exported proof.",
    ),
    el(
      "p",
      "",
      "Editorial assurance: an AI-mediated review judged whether that formal Challenge matches the informal mathematical claim under the recorded policy. This is not human peer review or a novelty certificate.",
    ),
    evidenceLinks,
  );
  callout.append(check, copy);
  return callout;
}

function classificationSection(entry, currentVersion) {
  const categories = classification(entry);
  const section = el("section", "entry-classification");
  const heading = el("div", "section-heading");
  const title = el("div");
  title.append(el("div", "eyebrow", "Discoverability"), el("h2", "", "Subject classification"));
  heading.append(title);
  section.append(heading);
  const details = el("dl", "details classification-details");
  const categoryRow = (label, values, feedType) => {
    const row = el("div", "detail-row");
    row.append(el("dt", "", label));
    const value = el("dd", "category-feed-list");
    for (const code of values) {
      const item = el("span", "category-feed-item");
      item.append(el("code", "", code));
      if (entry.version === currentVersion) {
        const feedUrl = new URL(
          `${feedType}/${encodeURIComponent(code)}.xml`,
          categoryFeedBase(),
        );
        item.append(" ", dataLink("RSS", feedUrl));
      }
      value.append(item);
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

function provenanceSection(entry) {
  const provenance = entry.provenance;
  const section = el("section", "entry-provenance");
  const heading = el("div", "section-heading");
  const title = el("div");
  title.append(el("div", "eyebrow", "Provenance"), el("h2", "", "Mathematical origin"));
  heading.append(title);
  section.append(heading);

  const details = el("dl", "details provenance-details");
  details.append(
    detailRow(
      "Result origin",
      provenance.result_origin === "original"
        ? "Original result first presented by this formalization"
        : "Formalization of or response to existing mathematical work",
    ),
    detailRow(
      "Repository role",
      provenance.repository_role === "thin-wrapper"
        ? "Thin Comparator wrapper around another formalization repository"
        : "Substantive formalization development",
    ),
    detailRow(
      "Responsible maintainers",
      provenance.responsible_maintainers.map((person) => person.name).join(", "),
    ),
    detailRow(
      "Submission basis",
      {
        maintainer: "Submitted by a responsible author or maintainer",
        approved: "Submitted with approval from a responsible author or maintainer",
        "legacy-unspecified": "Not recorded by the earlier submission form",
      }[entry.submission.authorization.relationship],
    ),
  );
  if (provenance.repository_role === "thin-wrapper") {
    const substantive = provenance.substantive_formalization;
    details.append(
      externalDetailRow(
        "Substantive formalization",
        `${substantive.repository}@${substantive.commit.slice(0, 12)}`,
        substantive.tree_url,
      ),
    );
  }
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

function solutionMetadata(entry, renderMetadata) {
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
      pinnedSourceFileUrl(entry, entry.formalization.solution_path),
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
      `${dependencies.length} source repositories used by the proof`,
    ),
  );
  const list = el("ul", "dependency-list");
  for (const dependency of dependencies) {
    const item = el("li");
    item.append(
      externalLink(
        dependency.repository,
        `https://github.com/${dependency.repository}/tree/${dependency.revision}`,
      ),
      el("code", "", dependency.revision.slice(0, 12)),
    );
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
  evidence.append(evidenceTitle, acceptanceCallout(entry));
  const details = el("dl", "details");
  details.append(
    detailRow("Acceptance date", displayDate(acceptanceDate(entry))),
    detailRow(
      "Lean verification date",
      displayDate(entry.verification.verified_at.slice(0, 10)),
    ),
    externalDetailRow("Fixed source version", `${entry.source.repository}@${entry.source.commit.slice(0, 12)}`, entry.source.tree_url),
    externalDetailRow(
      "Statement file",
      entry.formalization.challenge_path,
      pinnedSourceFileUrl(entry, entry.formalization.challenge_path),
    ),
    externalDetailRow(
      "Proof file",
      entry.formalization.solution_path,
      pinnedSourceFileUrl(entry, entry.formalization.solution_path),
    ),
    externalDetailRow(
      "Formalization metadata",
      entry.formalization.formalization_metadata_path,
      pinnedSourceFileUrl(entry, entry.formalization.formalization_metadata_path),
    ),
    detailRow("Challenge SHA-256", entry.verification.challenge_sha256),
    detailRow("Solution SHA-256", entry.verification.solution_sha256),
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
  );
  details.append(detailRow("NanoDa commit", entry.verification.nanoda_commit));
  if (entry.schema_version >= 5) {
    details.append(
      externalDetailRow(
        "Durable verification report",
        entry.verification.mechanical_report_sha256,
        `${DATABASE_SOURCE_BASE}${entry.verification.evidence_path}mechanical-report.json`,
      ),
      detailRow("Verification workflow commit", entry.verification.workflow_commit),
      detailRow("Workflow run attempt", String(entry.verification.workflow_run_attempt)),
    );
  }
  evidence.append(details);

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
      const provenance = dependency.provenance === "palomar-indexed"
        ? `Palomar-indexed: ${dependency.palomar_id}`
        : "allowlisted";
      dependencies.append(el("li", "", `${dependency.repository} (${provenance})`));
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
  const scores = el("div", "score-grid");
  for (const [name, score] of Object.entries(entry.review.scores)) {
    const item = el("div", "score");
    item.append(el("span", "", name.replaceAll("_", " ")), el("strong", "", `${score}/5`));
    scores.append(item);
  }
  editorial.append(scores);
  if (entry.review.warnings.length) {
    editorial.append(el("h3", "", "Permanent warnings"));
    const warnings = el("ul", "warning-list");
    for (const warning of entry.review.warnings) warnings.append(el("li", "", warning));
    editorial.append(warnings);
  } else {
    editorial.append(el("p", "no-warnings", "No permanent editorial warnings were recorded."));
  }
  editorial.append(
    externalLink(
      `Read the review on submission #${reportIssueNumber(entry.review.report_url)}`,
      entry.review.report_url,
    ),
  );

  const machine = el("section", "machine-record");
  machine.append(el("div", "eyebrow", "Full record"), el("h2", "", "Registry data"));
  const machineLinks = el("p");
  machineLinks.append(dataLink(`Open ${entry.id}-v${entry.version}.json`, canonicalUrl.href));
  machine.append(machineLinks);
  const pre = el("pre");
  pre.append(el("code", "", JSON.stringify(entry, null, 2)));
  machine.append(pre);

  const challenge = await challengePresentation(entry, renderBase);
  content.append(heading);
  const notice = versionNotice(entry, currentVersion);
  if (notice) content.append(notice);
  content.append(
    versionHistory(entry, versions, currentVersion),
    classificationSection(entry, currentVersion),
  );
  if (entry.schema_version >= 4) content.append(provenanceSection(entry));
  content.append(
    challenge.section,
    evidence,
    trust,
    solutionMetadata(entry, challenge.metadata),
    editorial,
    machine,
  );
}

async function loadEntry(id, requestedVersion) {
  const { databaseUrl, databaseBase, renderBase } = dataSource();
  const index = validateIndex(await fetchJson(databaseUrl));
  const versions = index.entries
    .filter((item) => item.id === id)
    .sort((left, right) => left.version - right.version);
  if (!versions.length) throw new Error("entry not found");
  const currentVersion = versions.at(-1).version;
  const version = requestedVersion ?? currentVersion;
  const summary = index.entries.find((item) => item.id === id && item.version === version);
  if (!summary) throw new Error("entry not found");
  const canonicalUrl = entryRecordUrl(summary, databaseBase);
  const entry = validateEntry(await fetchJson(canonicalUrl), summary);
  return {
    entry,
    canonicalUrl,
    renderBase,
    versions,
    currentVersion,
  };
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
    const {
      entry,
      canonicalUrl,
      renderBase,
      versions,
      currentVersion,
    } = await loadEntry(id, version);
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
    const { entry, renderBase } = await loadEntry(id, version);
    document.title = `Named compared declarations — ${entry.title} — Palomar`;
    const heading = el("header", "entry-heading");
    heading.append(
      el("div", "entry-id", `${entry.id} v${entry.version}`),
      el("h1", "", entry.title),
    );
    const challenge = await challengePresentation(entry, renderBase, { forceFrame: true });
    content.append(heading, challenge.section);
    status.hidden = true;
    content.hidden = false;
  } catch (error) {
    status.textContent = `The named compared declarations could not be loaded: ${error.message}`;
    status.classList.add("error");
  }
}

if (document.body.dataset.page === "index") renderIndex();
if (document.body.dataset.page === "entry") renderEntryPage();
if (document.body.dataset.page === "render") renderChallengePage();

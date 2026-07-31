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

const params = new URLSearchParams(window.location.search);
const PALOMAR_ID = /^PALOMAR-\d{4}-\d{2}-\d{2}-\d{6}$/;

function dataSource() {
  const databaseUrl = selectDatabaseUrl(window.location.href, window.location.search);
  const databaseBase = databaseBaseFor(databaseUrl);
  const renderBase = selectRenderBase(window.location.href, window.location.search, databaseBase);
  return { databaseUrl, databaseBase, renderBase };
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
    ? "Dependencies: Mathlib only"
    : "Dependencies: additional libraries";
  return badge;
}

function entryCard(entry, versionCount) {
  const card = el("article", "entry-card");
  card.dataset.trust = entry.trust.level;
  card.dataset.search = [
    entry.title,
    entry.abstract,
    authorNames(entry),
    theoremNames(entry),
    entry.source.repository,
    entry.id,
  ].join(" ").toLowerCase();

  const top = el("div", "card-top");
  const identity = el("div", "card-identity");
  identity.append(
    el("span", "entry-id", `${entry.id} · current version ${entry.version}`),
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
  meta.append(authors, theorems);
  const footer = el("div", "card-footer");
  const historyUrl = new URL(localPageUrl("entry.html", entry));
  historyUrl.hash = "version-history";
  footer.append(
    externalLink(entry.source.repository, entry.source.tree_url, "repo-link"),
    internalLink("View record", localPageUrl("entry.html", entry)),
  );
  if (versionCount > 1) {
    footer.append(
      internalLink(
        `${versionCount} versions`,
        historyUrl,
        "version-history-link",
      ),
    );
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
    const allEntries = await loadEntries(index, databaseBase);
    const entries = latestVersions(allEntries);
    const versionCounts = new Map();
    for (const entry of allEntries) {
      versionCounts.set(entry.id, (versionCounts.get(entry.id) || 0) + 1);
    }
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
    const update = () => {
      const query = search.value.trim().toLowerCase();
      let shown = 0;
      for (const card of grid.children) {
        const visible =
          (trust === "all" || card.dataset.trust === trust) &&
          (!query || card.dataset.search.includes(query));
        card.hidden = !visible;
        if (visible) shown += 1;
      }
      status.hidden = shown !== 0;
      status.textContent = shown ? "" : "No registry entries match those filters.";
    };
    search.addEventListener("input", update);
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
  notice.setAttribute("role", "status");
  notice.append(
    el("strong", "", "Newer version available"),
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
  for (const summary of [...versions].reverse()) {
    const item = el("li");
    const label = `Version ${summary.version}`;
    if (summary.version === entry.version) {
      const selected = el("strong", "selected-version", label);
      selected.setAttribute("aria-current", "page");
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
  frame.title = `Formatted statement for ${entry.id} version ${entry.version}`;
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
  titleBlock.append(el("div", "eyebrow", "Formal statement"), el("h2", "", "Statement"));
  heading.append(titleBlock);
  section.append(heading);

  const links = el("p", "challenge-links");
  links.append(
    externalLink("View statement file (Challenge.lean)", challengeSourceUrl(entry), "challenge-source"),
  );
  const inline = isInlineChallenge(entry);
  if (!forceFrame && !inline) {
    links.append(
      " · ",
      internalLink("Open formatted statement", localPageUrl("render.html", entry)),
    );
  }
  section.append(links);

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
  copy.append(
    el("strong", "", `Accepted on ${displayDate(acceptanceDate(entry))}`),
    el(
      "p",
      "",
      "Palomar used Lean to check the recorded proof against the recorded statement and confirmed that it uses only the allowed axioms. The documented review was also completed. Every required check passed, so Palomar accepted the submission.",
    ),
  );
  callout.append(check, copy);
  return callout;
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
  top.append(el("span", "entry-id", `${entry.id} · version ${entry.version}`), trustBadge(entry));
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
  evidence.append(details);

  const trust = el("section", "entry-trust");
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
  const version = versionParameter === null ? null : Number(versionParameter);
  if (
    !PALOMAR_ID.test(id || "") ||
    (version !== null && (!Number.isInteger(version) || version < 1))
  ) {
    status.textContent = "This registry link has a missing or invalid Palomar ID or version.";
    status.classList.add("error");
    return;
  }
  try {
    const {
      entry,
      canonicalUrl,
      renderBase,
      versions,
      currentVersion,
    } = await loadEntry(id, version);
    if (version === null) {
      window.history.replaceState(null, "", localPageUrl("entry.html", entry));
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
    if (window.location.hash === "#version-history") {
      document.querySelector("#version-history").scrollIntoView();
    }
  } catch (error) {
    status.textContent = `The registry entry could not be loaded: ${error.message}`;
    status.classList.add("error");
  }
}

async function renderChallengePage() {
  const status = document.querySelector("#status");
  const content = document.querySelector("#render-content");
  const id = params.get("id");
  const version = Number(params.get("version"));
  if (!PALOMAR_ID.test(id || "") || !Number.isInteger(version) || version < 1) {
    status.textContent = "This render link is missing a valid Palomar ID and version.";
    status.classList.add("error");
    return;
  }
  try {
    const { entry, renderBase } = await loadEntry(id, version);
    document.title = `Statement — ${entry.title} — Palomar`;
    const heading = el("header", "entry-heading");
    heading.append(
      el("div", "entry-id", `${entry.id} · version ${entry.version}`),
      el("h1", "", entry.title),
    );
    const challenge = await challengePresentation(entry, renderBase, { forceFrame: true });
    content.append(heading, challenge.section);
    status.hidden = true;
    content.hidden = false;
  } catch (error) {
    status.textContent = `The formatted statement could not be loaded: ${error.message}`;
    status.classList.add("error");
  }
}

if (document.body.dataset.page === "index") renderIndex();
if (document.body.dataset.page === "entry") renderEntryPage();
if (document.body.dataset.page === "render") renderChallengePage();

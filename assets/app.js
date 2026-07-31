import {
  challengeArtifactUrl,
  challengeMetadataUrl,
  challengeSourceUrl,
  entryRecordPath,
  isInlineChallenge,
} from "./rendering.js";

const DEFAULT_DATABASE =
  "https://raw.githubusercontent.com/kim-em/PalomarDatabase/main/index.json";
const DEFAULT_RENDER_BASE = "https://kim-em.github.io/PalomarDatabase/";

const params = new URLSearchParams(window.location.search);
const databaseUrl = params.get("database") || DEFAULT_DATABASE;
const databaseBase = new URL(".", databaseUrl);
const renderBase = params.get("render-base") ||
  (params.has("database") ? databaseBase.href : DEFAULT_RENDER_BASE);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function link(text, href, className) {
  const node = el("a", className, text);
  node.href = href;
  return node;
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
    ? "Trust: Mathlib-only surface"
    : "Trust: extended import surface";
  return badge;
}

function entryCard(entry) {
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
  top.append(el("span", "entry-id", `${entry.id} · v${entry.version}`), trustBadge(entry));
  const title = el("h3");
  title.append(link(entry.title, localPageUrl("entry.html", entry)));
  const abstract = el("p", "card-abstract", entry.abstract);
  const meta = el("div", "card-meta");
  const authors = el("div");
  authors.append(el("small", "", "Authors"), el("span", "", authorNames(entry)));
  const theorems = el("div");
  theorems.append(el("small", "", "Theorems"), el("span", "", theoremNames(entry)));
  meta.append(authors, theorems);
  const footer = el("div", "card-footer");
  footer.append(
    link(entry.source.repository, entry.source.tree_url, "repo-link"),
    link("View record", localPageUrl("entry.html", entry)),
  );
  card.append(top, title, abstract, meta, footer);
  return card;
}

async function loadEntries(index) {
  return Promise.all(
    index.entries.map((summary) => fetchJson(new URL(summary.path, databaseBase))),
  );
}

async function renderIndex() {
  const status = document.querySelector("#status");
  const grid = document.querySelector("#entry-grid");
  try {
    const index = await fetchJson(databaseUrl);
    const entries = latestVersions(await loadEntries(index));
    document.querySelector("#metric-results").textContent = String(entries.length);
    document.querySelector("#metric-projects").textContent = String(
      new Set(entries.map((entry) => entry.source.repository)).size,
    );
    document.querySelector("#metric-high-trust").textContent = String(
      entries.filter((entry) => entry.trust.level === "high").length,
    );
    if (!entries.length) {
      status.textContent =
        "The telescope is ready. No entries have been published yet; the first accepted database PR will appear here automatically.";
      status.classList.add("empty");
      return;
    }
    status.hidden = true;
    for (const entry of entries.sort((a, b) => a.id.localeCompare(b.id))) {
      grid.append(entryCard(entry));
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
  value.append(link(text, href));
  row.append(value);
  return row;
}

function pinnedSourceFileUrl(entry, path) {
  const repository = entry.source.repository_url.replace(/\/+$/, "");
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `${repository}/blob/${entry.source.commit}/${encodedPath}`;
}

function localPageUrl(page, entry) {
  const target = new URL(page, window.location.href);
  target.search = "";
  target.searchParams.set("id", entry.id);
  target.searchParams.set("version", String(entry.version));
  for (const name of ["database", "render-base"]) {
    if (params.has(name)) target.searchParams.set(name, params.get(name));
  }
  return target.href;
}

function challengeFrame(entry) {
  const frame = el("iframe", "challenge-frame");
  frame.src = challengeArtifactUrl(entry, renderBase).href;
  frame.title = `Rendered Challenge for ${entry.id} version ${entry.version}`;
  frame.loading = "lazy";
  frame.referrerPolicy = "no-referrer";
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("scrolling", "auto");
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
    metadata?.schema_version !== 1 ||
    !sameArray(metadata.declarations, expectedDeclarations) ||
    !sameArray(metadata.imports, expectedImports) ||
    !(metadata.module_doc === null ||
      (typeof metadata.module_doc === "string" && metadata.module_doc.length <= 256 * 1024))
  ) {
    throw new Error("Challenge render metadata does not match the registry entry");
  }
  return metadata;
}

function challengeMetadata(metadata) {
  const panel = el("div", "challenge-metadata");
  panel.append(el("div", "eyebrow", "Parsed source metadata"));
  const imports = el("div", "challenge-metadata-row");
  imports.append(el("strong", "", "Direct imports"));
  const tokens = el("span", "token-list");
  for (const item of metadata.imports) tokens.append(el("code", "", item));
  imports.append(tokens);
  panel.append(imports);
  if (metadata.module_doc) {
    const moduleDoc = el("details", "challenge-module-doc");
    moduleDoc.append(el("summary", "", "Module documentation"));
    moduleDoc.append(el("pre", "", metadata.module_doc));
    panel.append(moduleDoc);
  } else {
    panel.append(el("p", "challenge-no-module-doc", "No module documentation was found."));
  }
  return panel;
}

async function challengePresentation(entry, { forceFrame = false } = {}) {
  const section = el("section", "challenge-presentation");
  const heading = el("div", "section-heading");
  const titleBlock = el("div");
  titleBlock.append(el("div", "eyebrow", "Formal statement"), el("h2", "", "Challenge"));
  heading.append(titleBlock);
  section.append(heading);

  const links = el("p", "challenge-links");
  links.append(link("View canonical Challenge.lean", challengeSourceUrl(entry), "challenge-source"));
  if (!forceFrame) {
    links.append(" · ", link("Open rendered Challenge", localPageUrl("render.html", entry)));
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
        "This historical rendering predates declaration-only presentation metadata; use the canonical Challenge.lean link above.",
      ),
    );
    return section;
  }
  section.append(challengeMetadata(metadata));

  if (forceFrame || isInlineChallenge(entry)) {
    section.append(challengeFrame(entry));
  } else {
    section.append(
      el(
        "p",
        "challenge-fallback",
        "This Challenge is larger than the inline reading limit; use the rendered view above.",
      ),
    );
  }
  return section;
}

async function renderEntry(entry, content, canonicalUrl) {
  document.title = `${entry.title} — Palomar`;
  const heading = el("header", "entry-heading");
  const top = el("div", "card-top");
  top.append(el("span", "entry-id", `${entry.id} · version ${entry.version}`), trustBadge(entry));
  heading.append(top, el("h1", "", entry.title), el("p", "lede", entry.abstract));
  const byline = el("p", "byline", `By ${authorNames(entry)}`);
  heading.append(byline);

  const evidence = el("section", "entry-evidence");
  const evidenceTitle = el("div", "section-heading");
  const titleBlock = el("div");
  titleBlock.append(el("div", "eyebrow", "Machine evidence"), el("h2", "", "What was checked"));
  evidenceTitle.append(titleBlock);
  const details = el("dl", "details");
  details.append(
    externalDetailRow("Immutable source", `${entry.source.repository}@${entry.source.commit.slice(0, 12)}`, entry.source.tree_url),
    externalDetailRow(
      "Challenge file",
      `Open ${entry.formalization.challenge_path}`,
      pinnedSourceFileUrl(entry, entry.formalization.challenge_path),
    ),
    detailRow("Lean toolchain", entry.formalization.lean_toolchain),
    detailRow("Compared theorems", theoremNames(entry)),
    detailRow("Permitted axioms", entry.formalization.permitted_axioms.join(", ") || "none"),
    detailRow("Challenge surface", `${entry.trust.challenge_lines} lines · ${entry.trust.challenge_bytes} bytes`),
    externalDetailRow("Comparator run", entry.verification.comparator_commit.slice(0, 12), entry.verification.workflow_url),
  );
  evidence.append(evidenceTitle, details);

  const trust = el("section", "entry-trust");
  const trustTitle = el("div", "section-heading");
  const trustBlock = el("div");
  trustBlock.append(el("div", "eyebrow", "Statement trust"), el("h2", "", entry.trust.level === "high" ? "Mathlib-only challenge surface" : "Qualified challenge surface"));
  trustTitle.append(trustBlock, trustBadge(entry));
  trust.append(trustTitle);
  const imports = el("div", "token-list");
  for (const item of entry.trust.challenge_imports) imports.append(el("code", "", item));
  trust.append(el("h3", "", "Direct imports"), imports);
  if (entry.trust.challenge_dependencies.length) {
    trust.append(el("h3", "", "Trusted source repositories"));
    const dependencies = el("ul", "plain-list");
    for (const dependency of entry.trust.challenge_dependencies) {
      dependencies.append(el("li", "", `${dependency.repository} · ${dependency.provenance}`));
    }
    trust.append(dependencies);
  }
  if (entry.trust.reasons.length) {
    trust.append(el("h3", "", "Qualification reasons"));
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
  editorial.append(link("Read the public review", entry.review.report_url));

  const machine = el("section", "machine-record");
  machine.append(el("div", "eyebrow", "For machines and mirrors"), el("h2", "", "Canonical JSON"));
  const machineLinks = el("p");
  machineLinks.append(link("Open the canonical JSON record", canonicalUrl.href));
  machine.append(machineLinks);
  const pre = el("pre");
  pre.append(el("code", "", JSON.stringify(entry, null, 2)));
  machine.append(pre);

  content.append(
    heading,
    await challengePresentation(entry),
    evidence,
    trust,
    editorial,
    machine,
  );
}

async function loadEntry(id, version) {
  const index = await fetchJson(databaseUrl);
  const summary = index.entries.find((item) => item.id === id && item.version === version);
  if (!summary) throw new Error("entry not found");
  const path = entryRecordPath(id, version, summary.path);
  const canonicalUrl = new URL(path, databaseBase);
  return { entry: await fetchJson(canonicalUrl), canonicalUrl };
}

async function renderEntryPage() {
  const status = document.querySelector("#status");
  const content = document.querySelector("#entry-content");
  const id = params.get("id");
  const version = Number(params.get("version"));
  if (!/^PALOMAR-\d{6}$/.test(id || "") || !Number.isInteger(version) || version < 1) {
    status.textContent = "This registry link is missing a valid Palomar ID and version.";
    status.classList.add("error");
    return;
  }
  try {
    const { entry, canonicalUrl } = await loadEntry(id, version);
    status.hidden = true;
    content.hidden = false;
    await renderEntry(entry, content, canonicalUrl);
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
  if (!/^PALOMAR-\d{6}$/.test(id || "") || !Number.isInteger(version) || version < 1) {
    status.textContent = "This render link is missing a valid Palomar ID and version.";
    status.classList.add("error");
    return;
  }
  try {
    const { entry } = await loadEntry(id, version);
    document.title = `Challenge — ${entry.title} — Palomar`;
    const heading = el("header", "entry-heading");
    heading.append(
      el("div", "entry-id", `${entry.id} · version ${entry.version}`),
      el("h1", "", entry.title),
    );
    content.append(heading, await challengePresentation(entry, { forceFrame: true }));
    status.hidden = true;
    content.hidden = false;
  } catch (error) {
    status.textContent = `The rendered Challenge could not be loaded: ${error.message}`;
    status.classList.add("error");
  }
}

if (document.body.dataset.page === "index") renderIndex();
if (document.body.dataset.page === "entry") renderEntryPage();
if (document.body.dataset.page === "render") renderChallengePage();

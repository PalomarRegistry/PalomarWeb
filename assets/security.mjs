export const VERSIONS_SCHEMA_VERSION = 2;
export const RECENT_SCHEMA_VERSION = 2;
export const BROWSE_SCHEMA_VERSION = 2;
// A result with five hundred registered versions is a bug, not a history, and
// this is the one read surface whose size is not bounded by anything else.
const MAX_VERSIONS_PER_ID = 500;
// The publisher's cap on `recent.json`, and the reason to have it here too: the
// document this replaced was the whole registry, and a reader that admitted an
// unbounded one would let it come back without anything saying so.
const RECENT_ITEMS = 200;
const BROWSE_PAGE_SERIALS = 200;
const BROWSE_MAX_PAGE = Math.ceil(999_999 / BROWSE_PAGE_SERIALS);
// The path a day-paged collection publishes for the level below it. A head
// named years and counts and no path, and a year named days and no path, so
// the URL grammar that gets a reader from one to the next was stated in the
// publisher's source and in nothing it served; a reader holding one of those
// documents and nothing else could go no further.
//
// This reader has that grammar and never needed the templates, so it requires
// them to equal what it already knows, exactly as an entry summary's `path`
// has always had to equal the path derived here. That is the only useful
// question a consumer can ask of a template -- whether the producer is telling
// everybody else the truth -- and requiring the equality is also what keeps a
// template from becoming a path the data origin chooses and this consumer
// follows. Nothing here expands one to build a request.
const yearTemplate = (directory) => `${directory}/{year}.json`;
const pageTemplate = (directory) => `${directory}/{day}/{page}.json`;
const BROWSE_DIRECTORY = "browse";
export const ENTRY_SCHEMA_VERSION = 3;
// The endpoint, not a document. There is no whole-registry document to name
// any more: every surface is derived from this prefix by the function that
// knows which one it wants.
export const DEFAULT_DATABASE = "https://data.palomar-registry.org/";
export const DEFAULT_AVAILABILITY =
  "https://data.palomar-registry.org/source-availability.json";
export const DEFAULT_RENDER_BASE = "https://data.palomar-registry.org/";

// Provenance is three-valued. Rendering it with a binary fallback turns "the
// submitter never told us" into a positive claim about someone's work, which
// is the one thing a registry must not do. These live here, beside the
// validator that decides which values are legal, so the two cannot drift.
export const RESULT_ORIGIN_LABELS = Object.freeze({
  original: "Original result first presented by this formalization",
  "source-based": "Formalization of or response to existing mathematical work",
});
export const REPOSITORY_ROLE_LABELS = Object.freeze({
  "substantive-development": "Substantive formalization development",
  "thin-wrapper": "Thin Comparator wrapper around another formalization repository",
});

// Verification runs in exactly one public workflow, and every run URL a record
// carries is derived from the repository the record itself names, which must
// be this one.
const SUBMISSION_REPOSITORY = "PalomarRegistry/PalomarSubmission";
const ID_RE = /^PALOMAR-([0-9]{4}-[0-9]{2}-[0-9]{2})-([0-9]{6})$/;
const SUBMISSION_ID_RE = /^[0-9a-z]{12}$/;
const REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const POSITIVE_INTEGER_RE = /^[1-9][0-9]*$/;
const DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const ARXIV_RE = /^[a-z]+(?:-[a-z]+)*(?:\.[A-Za-z-]+)?$/;
const MSC2020_RE = /^[0-9]{2}(?:[A-Z][0-9]{2}|-[0-9]{2})$/;
const LICENSE_PATH_RE = /^(?:licen[cs]e|copying|unlicense|ofl)(?:\.(?:md|markdown|txt))?$/i;
const TIMESTAMP_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/;
export const AVAILABILITY_MAX_AGE_MS = 18 * 60 * 60 * 1000;
export const AVAILABILITY_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

// These indexes and validation receipts are deliberately out-of-band. Public
// registry objects retain their exact JSON shape, while consumers can refuse
// raw lookalikes instead of falling back to repeated array scans.
const availabilityIndexes = new WeakMap();
const validatedSourceRecords = new WeakMap();
const recentRenderIndexes = new WeakMap();

function fail(message) {
  throw new Error(`invalid registry data: ${message}`);
}

export function validatedSourceMapping(record, repository, revision) {
  const repositories = record?.preservation?.repositories;
  const receipt = validatedSourceRecords.get(record);
  if (!Array.isArray(repositories) || receipt?.repositories !== repositories) {
    fail("source record was not validated or its preservation receipt changed");
  }
  return receipt.index.get(`${repository.toLowerCase()}\0${revision}`) || null;
}

function sourceMappingSnapshot(row) {
  return Object.freeze({
    source_repository: row.source_repository,
    commit: row.commit,
    fork_repository: row.fork_repository,
  });
}

function object(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${field} must be an object`);
  return value;
}

function string(value, field) {
  if (typeof value !== "string" || !value) fail(`${field} must be a non-empty string`);
  return value;
}

function boundedString(value, field, maximum) {
  const text = string(value, field);
  let length = 0;
  for (const _character of text) {
    length += 1;
    if (length > maximum) fail(`${field} is longer than ${maximum} characters`);
  }
  return text;
}

function integer(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) fail(`${field} must be a positive integer`);
  return value;
}

function nonnegativeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${field} must be a non-negative integer`);
  }
  return value;
}

function array(value, field) {
  if (!Array.isArray(value)) fail(`${field} must be an array`);
  return value;
}

function exactObject(value, keys, field) {
  const item = object(value, field);
  const actual = Object.keys(item).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length ||
      actual.some((key, position) => key !== expected[position])) {
    fail(`${field} has an invalid shape`);
  }
  return item;
}

/**
 * One RFC3339 instant in Z, refused rather than rounded into a neighbouring one.
 *
 * The shape is not the value. `2026-02-30T00:00:00Z` and `2026-99-99T99:99:99Z`
 * both match the grammar, and the first is a day that does not exist while the
 * second is not a time at all. A row carrying either reaches a date formatter,
 * which throws on what it cannot format, so the document has to be refused
 * where documents are refused rather than where dates are drawn.
 */
function instant(value, field) {
  const text = string(value, field);
  if (!TIMESTAMP_RE.test(text)) fail(`${field} is malformed`);
  const moment = Date.parse(text);
  if (Number.isNaN(moment) ||
      new Date(moment).toISOString().replace(".000Z", "Z") !== text) {
    fail(`${field} is malformed`);
  }
  return text;
}

function stringArray(value, field) {
  for (const [position, item] of array(value, field).entries()) {
    string(item, `${field}[${position}]`);
  }
  return value;
}

function distinctStringArray(value, field, pattern = null) {
  const items = stringArray(value, field);
  if (!items.length) fail(`${field} must be a non-empty array`);
  if (new Set(items).size !== items.length) fail(`${field} must contain distinct values`);
  if (pattern && items.some((item) => !pattern.test(item))) {
    fail(`${field} contains a malformed value`);
  }
  return items;
}

function commit(value, field) {
  if (!COMMIT_RE.test(value)) fail(`${field} is not a full lowercase commit`);
  return value;
}

function digest(value, field) {
  if (!SHA256_RE.test(value)) fail(`${field} is not a SHA-256 digest`);
  return value;
}

export function isLoopbackHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized === "::1") return true;
  const octets = normalized.split(".");
  return (
    octets.length === 4 &&
    octets.every((part) => /^(0|[1-9][0-9]{0,2})$/.test(part) && Number(part) <= 255) &&
    Number(octets[0]) === 127
  );
}

export function selectDatabaseUrl(locationHref, search) {
  const locationUrl = new URL(locationHref);
  const override = new URLSearchParams(search).get("database");
  if (!override || !isLoopbackHostname(locationUrl.hostname)) return new URL(DEFAULT_DATABASE);
  const candidate = new URL(override, locationUrl);
  if (!['http:', 'https:'].includes(candidate.protocol) || candidate.username || candidate.password) {
    throw new Error("local database fixture must use an HTTP(S) URL without credentials");
  }
  return candidate;
}

export function databaseBaseFor(databaseUrl) {
  const url = new URL(databaseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error("database endpoint must use HTTP(S) without credentials");
  }
  return new URL(".", url);
}

export function selectRenderBase(locationHref, search, databaseBase) {
  const locationUrl = new URL(locationHref);
  if (!isLoopbackHostname(locationUrl.hostname)) return new URL(DEFAULT_RENDER_BASE);
  const override = new URLSearchParams(search).get("render-base");
  const candidate = override ? new URL(override, locationUrl) : new URL(databaseBase);
  if (!["http:", "https:"].includes(candidate.protocol) || candidate.username || candidate.password) {
    throw new Error("local render fixture must use an HTTP(S) URL without credentials");
  }
  return candidate;
}

export function selectAvailabilityUrl(locationHref, search, databaseBase) {
  const locationUrl = new URL(locationHref);
  if (!isLoopbackHostname(locationUrl.hostname)) return new URL(DEFAULT_AVAILABILITY);
  const override = new URLSearchParams(search).get("availability");
  const candidate = override
    ? new URL(override, locationUrl)
    : new URL("source-availability.json", databaseBase);
  if (!["http:", "https:"].includes(candidate.protocol) || candidate.username || candidate.password) {
    throw new Error("local availability fixture must use an HTTP(S) URL without credentials");
  }
  return candidate;
}

export function safeExternalUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("external record links must use HTTPS without credentials");
  }
  return url;
}

export function safeDataUrl(value, locationHref) {
  const url = new URL(value);
  if (url.protocol === "https:" && !url.username && !url.password) return url;
  const locationUrl = new URL(locationHref);
  if (
    url.protocol === "http:" &&
    url.origin === locationUrl.origin &&
    isLoopbackHostname(locationUrl.hostname) &&
    !url.username &&
    !url.password
  ) {
    return url;
  }
  throw new Error("record data links must use HTTPS (or same-origin HTTP on loopback)");
}

export function safeInternalUrl(value, locationHref) {
  const locationUrl = new URL(locationHref);
  const url = new URL(value, locationUrl);
  if (url.origin !== locationUrl.origin || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error("internal record link escaped the Palomar origin");
  }
  return url;
}

export function recentUrl(databaseBase) {
  const base = new URL(databaseBase);
  const expected = new URL("recent.json", base);
  if (expected.origin !== base.origin) fail("recent path escaped the database origin");
  return expected;
}

export function recentRendersUrl(databaseBase) {
  const base = new URL(databaseBase);
  const expected = new URL("recent-renders.json", base);
  if (expected.origin !== base.origin) {
    fail("recent renders path escaped the database origin");
  }
  return expected;
}

/**
 * What is new, from `recent.json`.
 *
 * Each row is the publisher's exact, self-contained landing-card projection of
 * one validated canonical entry. The deliberately small nested objects carry
 * every field a card renders and no record-only fields. Besides that complete
 * shape, this document claims to be the newest current versions and no more
 * than the publisher's bound of them, so coverage and ordering are checked too.
 */
export function validateRecent(value) {
  const document = exactObject(value, ["schema_version", "entries"], "recent");
  if (document.schema_version !== RECENT_SCHEMA_VERSION) {
    fail(`unsupported recent schema_version ${String(document.schema_version)}`);
  }
  const entries = array(document.entries, "recent.entries");
  if (entries.length > RECENT_ITEMS) fail("recent carries more rows than it may");
  const seen = new Set();
  const sourceReceipts = [];
  let previous = null;
  for (const [position, value] of entries.entries()) {
    const field = `recent.entries[${position}]`;
    const summary = exactObject(value, [
      "abstract",
      "authors",
      "classification",
      "formalization",
      "id",
      "path",
      "preservation",
      "published_at",
      "source",
      "status",
      "title",
      "trust",
      "version",
      "versions",
    ], field);
    const id = string(summary.id, `${field}.id`);
    if (!ID_RE.test(id)) fail(`recent.entries[${position}].id is malformed`);
    const version = integer(summary.version, `${field}.version`);
    boundedString(summary.title, `${field}.title`, 300);
    boundedString(summary.abstract, `${field}.abstract`, 10_000);
    if (summary.status !== "registered") fail(`recent.entries[${position}].status is not registered`);
    const expectedPath = `entries/${id}-v${version}.json`;
    if (summary.path !== expectedPath) {
      fail(`recent.entries[${position}].path must be ${expectedPath}`);
    }
    integer(summary.versions, `${field}.versions`);
    const publishedAt = string(summary.published_at, `${field}.published_at`);
    // An instant, and only an instant. This is the record's `registered_at`,
    // which the schema requires of every version. A date was tolerated while a
    // row could fall back to `first_registered_on`, and a date read as an instant is
    // midnight, so such a row would sort ahead of everything registered that
    // day with nothing to say why.
    if (!TIMESTAMP_RE.test(publishedAt)) {
      fail(`recent.entries[${position}].published_at is malformed`);
    }
    const moment = Date.parse(publishedAt);
    if (Number.isNaN(moment) ||
        new Date(moment).toISOString().replace(".000Z", "Z") !== publishedAt) {
      fail(`recent.entries[${position}].published_at is malformed`);
    }
    if (previous !== null &&
        (moment > previous.moment || (moment === previous.moment && id > previous.id))) {
      fail("recent is not in newest-first order");
    }
    previous = { moment, id };
    // One row per result, because these are the current versions: the same
    // identifier twice means this is not the selection it says it is.
    if (seen.has(id)) fail(`recent names ${id} more than once`);
    seen.add(id);

    const authors = array(summary.authors, `${field}.authors`);
    if (!authors.length) fail(`${field}.authors must be a non-empty array`);
    for (const [authorPosition, authorValue] of authors.entries()) {
      const authorField = `${field}.authors[${authorPosition}]`;
      const author = exactObject(authorValue, ["name"], authorField);
      string(author.name, `${authorField}.name`);
    }

    const classification = exactObject(
      summary.classification,
      ["arxiv", "msc2020"],
      `${field}.classification`,
    );
    const arxiv = distinctStringArray(
      classification.arxiv,
      `${field}.classification.arxiv`,
      ARXIV_RE,
    );
    if (arxiv.length > 8) fail(`${field}.classification.arxiv has more than 8 codes`);
    const msc2020 = distinctStringArray(
      classification.msc2020,
      `${field}.classification.msc2020`,
      MSC2020_RE,
    );
    if (msc2020.length > 8) fail(`${field}.classification.msc2020 has more than 8 codes`);
    const formalization = exactObject(
      summary.formalization,
      ["theorem_names"],
      `${field}.formalization`,
    );
    distinctStringArray(formalization.theorem_names, `${field}.formalization.theorem_names`);
    const trust = exactObject(summary.trust, ["level"], `${field}.trust`);
    if (!["high", "qualified"].includes(trust.level)) fail(`${field}.trust.level is invalid`);

    const source = exactObject(
      summary.source,
      ["repository", "commit", "project_path"],
      `${field}.source`,
    );
    const repository = string(source.repository, `${field}.source.repository`);
    if (!REPOSITORY_RE.test(repository)) fail(`${field}.source.repository is malformed`);
    commit(string(source.commit, `${field}.source.commit`), `${field}.source.commit`);
    if (source.project_path !== null) safeRepositoryPath(source.project_path, `${field}.source.project_path`);

    const preservation = exactObject(
      summary.preservation,
      ["repositories"],
      `${field}.preservation`,
    );
    const repositories = array(preservation.repositories, `${field}.preservation.repositories`);
    if (repositories.length !== 1) fail(`${field}.preservation must contain one source mapping`);
    const mapping = exactObject(repositories[0], [
      "source_repository",
      "commit",
      "fork_repository",
    ], `${field}.preservation.repositories[0]`);
    if (typeof mapping.source_repository !== "string" ||
        mapping.source_repository.toLowerCase() !== repository.toLowerCase() ||
        mapping.commit !== source.commit ||
        typeof mapping.fork_repository !== "string" ||
        !REPOSITORY_RE.test(mapping.fork_repository) ||
        !mapping.fork_repository.startsWith("PalomarArchive/")) {
      fail(`${field}.preservation does not match source`);
    }
    const key = `${mapping.source_repository.toLowerCase()}\0${mapping.commit}`;
    sourceReceipts.push({
      record: summary,
      repositories,
      index: new Map([[key, sourceMappingSnapshot(mapping)]]),
    });
  }
  // Mark rows only after the complete projection succeeds. A reference to an
  // early row from a later-rejected document must not become presentation data.
  for (const receipt of sourceReceipts) {
    validatedSourceRecords.set(receipt.record, receipt);
  }
  return document;
}

/**
 * The content address of each listed result's rendering, from
 * `recent-renders.json`.
 *
 * A landing row is the card and nothing else, so it cannot say where the
 * result's rendering is served. This document says, for exactly the results on
 * that page, and the landing page reads it only when a reader asks to see one.
 *
 * It carries the tree hash alone. The path is derivable from the identifier,
 * the version and the hash, and the format and entrypoint are constants
 * `renderArtifactUrl` applies rather than fields to be told, so a row that
 * carried them would be a row that could disagree with them.
 *
 * Rows strictly increase by identifier, which is distinctness and a canonical
 * order in one rule. One row per result, as on the page this accompanies, so a
 * repeated identifier means this is not the projection it says it is, and
 * reading it as if it were would offer a reader one result's statement under
 * another result's name.
 */
export function validateRecentRenders(value) {
  const document = exactObject(value, ["schema_version", "renders"], "recent renders");
  if (document.schema_version !== RECENT_SCHEMA_VERSION) {
    fail(`unsupported recent renders schema_version ${String(document.schema_version)}`);
  }
  const renders = array(document.renders, "recent renders rows");
  if (renders.length > RECENT_ITEMS) fail("recent renders carries more rows than it may");
  const index = new Map();
  let previous = "";
  for (const [position, value] of renders.entries()) {
    const field = `recent renders rows[${position}]`;
    const item = exactObject(value, ["artifact_tree_sha256", "id", "version"], field);
    const id = string(item.id, `${field}.id`);
    if (!ID_RE.test(id)) fail(`${field}.id is malformed`);
    if (id <= previous) fail("recent renders rows are not in increasing identifier order");
    previous = id;
    const version = integer(item.version, `${field}.version`);
    if (version < 1) fail(`${field}.version is not a version`);
    const treeHash = string(item.artifact_tree_sha256, `${field}.artifact_tree_sha256`);
    if (!SHA256_RE.test(treeHash)) fail(`${field}.artifact_tree_sha256 is malformed`);
    index.set(id, Object.freeze({ id, version, artifact_tree_sha256: treeHash }));
  }
  // Captured by value while the document is validated, so a lookup answers from
  // what was checked rather than from a public row that has since been written
  // over. Set only after the whole projection succeeds: a reference to an early
  // row of a later-rejected document must not become presentation data.
  recentRenderIndexes.set(document, index);
  return document;
}

/**
 * The validated render row for one result, or `null` if this page has none.
 *
 * Refuses a raw lookalike rather than scanning it, for the same reason the
 * availability lookup does: an object that merely has the right keys has not
 * been through the bounds above.
 */
export function recentRenderRow(document, id) {
  const index = recentRenderIndexes.get(document);
  if (!index) fail("recent renders document was not validated");
  return index.get(id) || null;
}

function availabilityTimestamp(value) {
  if (typeof value !== "string" || !TIMESTAMP_RE.test(value)) return null;
  const moment = Date.parse(value);
  if (!Number.isFinite(moment) ||
      new Date(moment).toISOString().replace(".000Z", "Z") !== value) {
    return null;
  }
  return moment;
}

function availabilityEndpoint(value, field) {
  const endpoint = object(value, field);
  if (!["available", "missing", "unknown"].includes(endpoint.status)) {
    fail(`${field}.status is unsupported`);
  }
  if (endpoint.last_attempt_at !== null && endpoint.last_attempt_at !== undefined &&
      availabilityTimestamp(endpoint.last_attempt_at) === null) {
    fail(`${field}.last_attempt_at is malformed`);
  }
  if (!Number.isSafeInteger(endpoint.consecutive_missing) || endpoint.consecutive_missing < 0) {
    fail(`${field}.consecutive_missing is malformed`);
  }
  if (endpoint.last_error !== null && endpoint.last_error !== undefined &&
      typeof endpoint.last_error !== "string") {
    fail(`${field}.last_error is malformed`);
  }
  // checked_at is evidence rather than structure. Whatever malformed value
  // arrived, it says only that this endpoint has no trustworthy observation;
  // do not let it invalidate fresh sibling endpoints or rows.
  if (availabilityTimestamp(endpoint.checked_at) !== null) return endpoint;
  return {
    ...endpoint,
    status: ["available", "missing"].includes(endpoint.status) ? "unknown" : endpoint.status,
    checked_at: null,
  };
}

export function validateAvailability(manifest) {
  const document = object(manifest, "availability");
  // Schema 1 remains readable only for the deployment handoff: the old R2
  // object can outlive the Worker deployment until the first public refresh.
  // Schema 2 binds every observation row to the separately published exact
  // target set and is what all new producers write.
  if (![1, 2].includes(document.schema_version)) {
    fail("availability schema_version is unsupported");
  }
  if (document.schema_version === 2) {
    if (typeof document.targets_sha256 !== "string" ||
        !/^[0-9a-f]{64}$/.test(document.targets_sha256)) {
      fail("availability.targets_sha256 is malformed");
    }
    if (!Number.isSafeInteger(document.publication_revision) ||
        document.publication_revision < 1) {
      fail("availability.publication_revision is malformed");
    }
  }
  const generatedAt = availabilityTimestamp(document.generated_at);
  if (generatedAt === null) {
    fail("availability.generated_at is malformed");
  }
  if (document.schema_version === 1 && document.database_commit !== undefined) {
    commit(document.database_commit, "availability.database_commit");
  }
  const coverage = object(document.coverage, "availability.coverage");
  if (coverage.freshness_max_age_seconds !== AVAILABILITY_MAX_AGE_MS / 1_000) {
    fail("availability.coverage.freshness_max_age_seconds disagrees with the consumer");
  }
  const seen = new Set();
  const repositories = [];
  const index = new Map();
  for (const [position, value] of array(
    document.repositories,
    "availability.repositories",
  ).entries()) {
    const row = object(value, `availability.repositories[${position}]`);
    if (!REPOSITORY_RE.test(row.source_repository)) {
      fail(`availability.repositories[${position}].source_repository is malformed`);
    }
    if (!REPOSITORY_RE.test(row.fork_repository) ||
        !row.fork_repository.startsWith("PalomarArchive/")) {
      fail(`availability.repositories[${position}].fork_repository is malformed`);
    }
    commit(row.commit, `availability.repositories[${position}].commit`);
    const key = `${row.source_repository.toLowerCase()}\0${row.commit}`;
    if (seen.has(key)) fail(`availability.repositories[${position}] is duplicated`);
    seen.add(key);
    const validated = {
      ...row,
      original: availabilityEndpoint(
        row.original,
        `availability.repositories[${position}].original`,
      ),
      archive: availabilityEndpoint(
        row.archive,
        `availability.repositories[${position}].archive`,
      ),
    };
    repositories.push(validated);
    // The private consequence of validation must not point back at mutable
    // public rows. Capture exactly the fields lookup can later return/use.
    index.set(key, Object.freeze({
      source_repository: validated.source_repository,
      commit: validated.commit,
      fork_repository: validated.fork_repository,
      original: Object.freeze({ ...validated.original }),
      archive: Object.freeze({ ...validated.archive }),
    }));
  }
  const validated = { ...document, repositories };
  availabilityIndexes.set(validated, { generatedAt, index });
  return validated;
}

export function availabilityRecord(manifest, repository, revision, now = Date.now()) {
  if (!manifest) return null;
  const receipt = availabilityIndexes.get(manifest);
  if (!receipt) fail("availability document was not validated");
  if (receipt.generatedAt > now + AVAILABILITY_MAX_CLOCK_SKEW_MS ||
      now - receipt.generatedAt > AVAILABILITY_MAX_AGE_MS) {
    return null;
  }
  const record = receipt.index.get(`${repository.toLowerCase()}\0${revision}`) || null;
  if (record === null) return null;

  // generated_at describes the publication, not the age of every observation
  // carried in it. Apply the same inclusive freshness window to each known
  // endpoint at the point all landing, search, and entry links consume it.
  const authoritativeEndpoint = (endpoint) => {
    const checked = availabilityTimestamp(endpoint.checked_at);
    const normalized = {
      ...endpoint,
      checked_at: checked === null && endpoint.checked_at !== null
        ? null
        : endpoint.checked_at,
    };
    if (!["available", "missing"].includes(endpoint.status)) return normalized;
    const age = checked === null ? null : now - checked;
    if (age !== null && age >= -AVAILABILITY_MAX_CLOCK_SKEW_MS &&
        age <= AVAILABILITY_MAX_AGE_MS) {
      return normalized;
    }
    return { ...normalized, status: "unknown" };
  };
  return {
    ...record,
    original: authoritativeEndpoint(record.original),
    archive: authoritativeEndpoint(record.archive),
  };
}

function validateEntrySummary(value, field) {
  const summary = exactObject(
    value,
    ["id", "path", "status", "title", "version"],
    field,
  );
  const id = string(summary.id, `${field}.id`);
  if (!ID_RE.test(id)) fail(`${field}.id is malformed`);
  const version = integer(summary.version, `${field}.version`);
  boundedString(summary.title, `${field}.title`, 300);
  if (summary.status !== "registered") fail(`${field}.status is not registered`);
  const expectedPath = `entries/${id}-v${version}.json`;
  if (summary.path !== expectedPath) fail(`${field}.path must be ${expectedPath}`);
  return summary;
}

export function entryRecordUrl(summary, databaseBase) {
  object(summary, "entry summary");
  const id = string(summary.id, "entry summary id");
  const version = integer(summary.version, "entry summary version");
  const expectedPath = `entries/${id}-v${version}.json`;
  if (summary.path !== expectedPath) fail(`entry path must be ${expectedPath}`);
  const base = new URL(databaseBase);
  const expected = new URL(expectedPath, base);
  const resolved = new URL(summary.path, base);
  if (resolved.href !== expected.href || resolved.origin !== base.origin) {
    fail("entry path escaped the canonical database prefix");
  }
  return resolved;
}

export function versionsUrl(id, databaseBase) {
  if (typeof id !== "string" || !ID_RE.test(id)) fail("version index ID is malformed");
  const base = new URL(databaseBase);
  const expected = new URL(`versions/${id}.json`, base);
  if (expected.origin !== base.origin) fail("version index path escaped the database origin");
  return expected;
}

/**
 * The versions of one result, from `versions/<id>.json`.
 *
 * Each row uses the registry's exact entry-summary grammar and resolves through
 * `entryRecordUrl`. The document claims to be *every* active version of one
 * identifier, so a row belonging to another identifier means it is not what it
 * says it is, and reading it as if it were would show one result's history
 * under another result's name.
 */
export function validateVersions(value, id) {
  const document = exactObject(value, ["schema_version", "id", "entries"], "version index");
  if (document.schema_version !== VERSIONS_SCHEMA_VERSION) {
    fail(`unsupported version index schema_version ${String(document.schema_version)}`);
  }
  if (document.id !== id) fail("version index is for a different result");
  const entries = array(document.entries, "version index entries");
  if (entries.length === 0) fail("version index carries no versions");
  if (entries.length > MAX_VERSIONS_PER_ID) fail("version index is implausibly long");
  let previous = 0;
  for (const [position, row] of entries.entries()) {
    const field = `version index entries[${position}]`;
    const summary = validateEntrySummary(row, field);
    if (summary.id !== id) fail(`version index entries[${position}] is a different result`);
    const version = summary.version;
    if (version <= previous) fail("version index is not in increasing version order");
    previous = version;
  }
  return document;
}

/**
 * The year rows every day-paged collection's head is bounded by.
 *
 * Browsing the registry and browsing one classification code are the same
 * traversal over different rows: PalomarDatabase writes both heads from
 * `day_pages.write_collection`, and the year rows are the part that does not
 * know which. Reading them with one function is what keeps a subject's
 * traversal from drifting away from the registry's, which is a disagreement
 * neither side could report.
 */
function validateCollectionYears(document, label, directory) {
  if (document.year_path !== yearTemplate(directory)) {
    fail(`${label} year_path must be ${yearTemplate(directory)}`);
  }
  const results = nonnegativeInteger(document.results, `${label} results`);
  const versions = nonnegativeInteger(document.versions, `${label} versions`);
  if (results > versions) fail(`${label} has more results than versions`);
  let previous = "";
  let countedResults = 0;
  let countedVersions = 0;
  const years = array(document.years, `${label} years`);
  for (const [position, value] of years.entries()) {
    const field = `${label} years[${position}]`;
    const row = exactObject(value, ["days", "results", "versions", "year"], field);
    const year = string(row.year, `${field}.year`);
    if (!/^[0-9]{4}$/.test(year) || year <= previous) {
      fail(`${label} years are malformed or not in increasing order`);
    }
    previous = year;
    const days = integer(row.days, `${field}.days`);
    if (days > 366) fail(`${field}.days exceeds one calendar year`);
    const yearResults = nonnegativeInteger(row.results, `${field}.results`);
    const yearVersions = nonnegativeInteger(row.versions, `${field}.versions`);
    if (yearResults > yearVersions) fail(`${field} has more results than versions`);
    countedResults += yearResults;
    countedVersions += yearVersions;
  }
  if (countedResults !== results || countedVersions !== versions) {
    fail(`${label} counts do not equal its year rows`);
  }
  return document;
}

/** Every day and page range belonging to one collection head's year row. */
function validateCollectionYear(value, expected, label, directory) {
  const document = exactObject(value, ["schema_version", "year", "page_path", "days"], label);
  if (document.schema_version !== BROWSE_SCHEMA_VERSION) {
    fail(`unsupported ${label} schema_version ${String(document.schema_version)}`);
  }
  if (document.page_path !== pageTemplate(directory)) {
    fail(`${label} page_path must be ${pageTemplate(directory)}`);
  }
  if (document.year !== expected.year) fail(`${label} is for a different year`);
  const days = array(document.days, `${label} days`);
  if (days.length !== expected.days) fail(`${label} does not carry its declared number of days`);
  let previous = "";
  let countedResults = 0;
  let countedVersions = 0;
  for (const [position, value] of days.entries()) {
    const field = `${label} days[${position}]`;
    const row = exactObject(
      value,
      ["day", "first_page", "last_page", "results", "versions"],
      field,
    );
    const day = string(row.day, `${field}.day`);
    const parsed = new Date(`${day}T00:00:00Z`);
    if (!DATE_RE.test(day) || day.slice(0, 4) !== expected.year ||
        Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day ||
        day <= previous) {
      fail(`${label} days are malformed or not in increasing order`);
    }
    previous = day;
    const first = integer(row.first_page, `${field}.first_page`);
    const last = integer(row.last_page, `${field}.last_page`);
    if (last < first) fail(`${field} has a reversed page range`);
    if (last > BROWSE_MAX_PAGE) fail(`${field} exceeds the identifier page range`);
    const dayResults = nonnegativeInteger(row.results, `${field}.results`);
    const dayVersions = nonnegativeInteger(row.versions, `${field}.versions`);
    if (dayResults > dayVersions) fail(`${field} has more results than versions`);
    countedResults += dayResults;
    countedVersions += dayVersions;
  }
  if (countedResults !== expected.results || countedVersions !== expected.versions) {
    fail(`${label} counts do not equal its index row`);
  }
  return document;
}

/**
 * That an identifier belongs on the day and page a URL asked for.
 *
 * The page a row is on is read from its identifier and from nothing else, so
 * this is the whole of the claim a paged URL makes. It is the same claim for
 * browsing and for one classification code, because both are paged by the same
 * function of the same identifier.
 */
function pagedHere(id, day, page, field) {
  const match = ID_RE.exec(id);
  const expectedPage = Math.floor((Number(match[2]) - 1) / BROWSE_PAGE_SERIALS) + 1;
  if (match[1] !== day || expectedPage !== page) fail(`${field} does not belong on this page`);
}

/** The bounded-by-years root of the complete public browse traversal. */
export function validateBrowseHead(value) {
  const document = exactObject(
    value,
    ["schema_version", "results", "versions", "year_path", "years"],
    "browse index",
  );
  if (document.schema_version !== BROWSE_SCHEMA_VERSION) {
    fail(`unsupported browse index schema_version ${String(document.schema_version)}`);
  }
  return validateCollectionYears(document, "browse index", BROWSE_DIRECTORY);
}

/** Every day and page range belonging to one browse-index year row. */
export function validateBrowseYear(value, expected) {
  return validateCollectionYear(value, expected, "browse year", BROWSE_DIRECTORY);
}

/** Every active version whose identifier places it on one public browse page. */
export function validateBrowsePage(value, day, page) {
  const document = exactObject(
    value,
    ["schema_version", "day", "page", "entries"],
    "browse page",
  );
  if (document.schema_version !== BROWSE_SCHEMA_VERSION) {
    fail(`unsupported browse page schema_version ${String(document.schema_version)}`);
  }
  if (document.day !== day || document.page !== page) {
    fail("browse page identity does not match its URL");
  }
  let previousId = "";
  let previousVersion = 0;
  for (const [position, value] of array(document.entries, "browse page entries").entries()) {
    const field = `browse page entries[${position}]`;
    const summary = validateEntrySummary(value, field);
    pagedHere(summary.id, day, page, field);
    if (summary.id < previousId ||
        (summary.id === previousId && summary.version <= previousVersion)) {
      fail("browse page entries are not in increasing identity and version order");
    }
    previousId = summary.id;
    previousVersion = summary.version;
  }
  return document;
}

// The same document family as browsing. PalomarDatabase writes both from
// `day_pages.write_collection`, and `build_subjects.SCHEMA_VERSION` is
// `day_pages.SCHEMA_VERSION`; one constant here says so rather than leaving two
// numbers to agree by coincidence.
export const SUBJECT_SCHEMA_VERSION = BROWSE_SCHEMA_VERSION;
// The publisher's front-page cap, `SUBJECT_PAGE_ITEMS` in PalomarDatabase's
// `tools/build_subjects.py`. The head is a page of what is new under a code and
// not the code's archive, so a head carrying more than this is not the document
// this reader was told to expect.
const SUBJECT_HEAD_ITEMS = 50;
const SUBJECT_CODE_PATTERNS = Object.freeze({ arxiv: ARXIV_RE, msc: MSC2020_RE });
// Which array of a classification a `subjects/<kind>/` directory is drawn from.
// The directory is named for the scheme and the record's field is named for the
// taxonomy revision, so the two spellings have to be mapped somewhere.
const SUBJECT_CLASSIFICATION_FIELDS = Object.freeze({ arxiv: "arxiv", msc: "msc2020" });

/**
 * The taxonomy and code a subject URL may name.
 *
 * A code becomes a path segment, so a code that is not a code is a way out of
 * the directory it names -- which is why PalomarDatabase checks the same two
 * patterns in `selection.codes_of` before it will write one. Checked here for
 * the same reason, at the one place every subject URL is built from.
 */
function subjectCoordinate(kind, code) {
  const pattern = Object.hasOwn(SUBJECT_CODE_PATTERNS, kind)
    ? SUBJECT_CODE_PATTERNS[kind]
    : null;
  if (pattern === null) fail(`unknown classification scheme ${String(kind)}`);
  if (typeof code !== "string" || !pattern.test(code)) {
    fail(`malformed ${kind} classification code`);
  }
  return { kind, code };
}

// Where a code's archive is written, which is what its templates are built
// from. A subject's archive is the registry's layout under a different
// directory, so its head and year name their own pages and not browsing's.
const subjectDirectory = ({ kind, code }) => `subjects/${kind}/${code}`;

function subjectUrl(path, databaseBase) {
  const base = new URL(databaseBase);
  const resolved = new URL(path, base);
  if (resolved.origin !== base.origin || !resolved.pathname.endsWith(`/${path}`)) {
    fail("subject path escaped the canonical database prefix");
  }
  return resolved;
}

export function subjectHeadUrl(kind, code, databaseBase) {
  const at = subjectCoordinate(kind, code);
  return subjectUrl(`subjects/${at.kind}/${at.code}.json`, databaseBase);
}

export function subjectYearUrl(kind, code, year, databaseBase) {
  const at = subjectCoordinate(kind, code);
  if (typeof year !== "string" || !/^[0-9]{4}$/.test(year)) fail("subject year is malformed");
  return subjectUrl(`subjects/${at.kind}/${at.code}/${year}.json`, databaseBase);
}

export function subjectPageUrl(kind, code, day, page, databaseBase) {
  const at = subjectCoordinate(kind, code);
  if (typeof day !== "string" || !DATE_RE.test(day)) fail("subject day is malformed");
  if (!Number.isSafeInteger(page) || page < 1 || page > BROWSE_MAX_PAGE) {
    fail("subject page number is outside the identifier page range");
  }
  return subjectUrl(`subjects/${at.kind}/${at.code}/${day}/${page}.json`, databaseBase);
}

/**
 * One row of a subject page.
 *
 * The registry's entry-summary grammar, plus the two facts a reader cannot
 * check without them. A page claims to carry results under one code in a
 * stated order; without the timestamp nothing here can tell whether the order
 * is the one claimed, and without the classification nothing can tell whether
 * the row belongs on the page at all. Both would be well-formed rows either
 * way, which is exactly the failure worth catching: a result shown under a
 * heading it has nothing to do with.
 */
function validateSubjectRow(value, field, { kind, code, abstract }) {
  const keys = ["classification", "id", "path", "published_at", "status", "title", "version"];
  const row = exactObject(value, abstract ? [...keys, "abstract"] : keys, field);
  const summary = validateEntrySummary(
    { id: row.id, path: row.path, status: row.status, title: row.title, version: row.version },
    field,
  );
  instant(row.published_at, `${field}.published_at`);
  if (abstract) boundedString(row.abstract, `${field}.abstract`, 10_000);
  const classification = exactObject(
    row.classification,
    ["arxiv", "msc2020"],
    `${field}.classification`,
  );
  const arxiv = distinctStringArray(classification.arxiv, `${field}.classification.arxiv`, ARXIV_RE);
  if (arxiv.length > 8) fail(`${field}.classification.arxiv has more than 8 codes`);
  const msc2020 = distinctStringArray(
    classification.msc2020,
    `${field}.classification.msc2020`,
    MSC2020_RE,
  );
  if (msc2020.length > 8) fail(`${field}.classification.msc2020 has more than 8 codes`);
  if (!classification[SUBJECT_CLASSIFICATION_FIELDS[kind]].includes(code)) {
    fail(`${field} is not classified ${code}`);
  }
  return { ...summary, published_at: row.published_at, classification, abstract: row.abstract };
}

/**
 * The front page of one classification code, from `subjects/<kind>/<code>.json`.
 *
 * The newest current versions carrying the code, newest first, and the years
 * its archive is paged by. An empty `entries` is an answer and not an absence:
 * PalomarDatabase seeds a page for every code the registry has ever used, so a
 * code whose last classifier was superseded keeps answering rather than
 * starting to 404 at a URL somebody has linked.
 */
export function validateSubjectHead(value, kind, code) {
  const at = subjectCoordinate(kind, code);
  const document = exactObject(
    value,
    ["schema_version", "kind", "code", "entries", "results", "versions", "year_path", "years"],
    "subject index",
  );
  if (document.schema_version !== SUBJECT_SCHEMA_VERSION) {
    fail(`unsupported subject index schema_version ${String(document.schema_version)}`);
  }
  if (document.kind !== at.kind || document.code !== at.code) {
    fail("subject index is for a different classification code");
  }
  const entries = array(document.entries, "subject index entries");
  // Every row under a code is a *current* version, one per result, so the two
  // counts are the same number and the front page is the whole of the code or
  // the publisher's cap on it. A head that says otherwise is describing some
  // other selection, and this page would present it as the current one.
  if (document.results !== document.versions) {
    fail("subject index counts a result that is not one current version");
  }
  if (entries.length !== Math.min(SUBJECT_HEAD_ITEMS, document.versions)) {
    fail("subject index does not carry the rows it says it has");
  }
  const rows = [];
  const seen = new Set();
  for (const [position, value] of entries.entries()) {
    const field = `subject index entries[${position}]`;
    const row = validateSubjectRow(value, field, { ...at, abstract: true });
    if (seen.has(row.id)) fail(`${field} repeats a result already on this page`);
    seen.add(row.id);
    // Newest first, by the registration instant and then the identifier, which
    // is the order `selection.latest_entries` puts them in. The timestamps are
    // fixed-width UTC, so comparing them as text is comparing the moments.
    const previous = rows.at(-1);
    if (previous !== undefined &&
        (row.published_at > previous.published_at ||
          (row.published_at === previous.published_at && row.id >= previous.id))) {
      fail("subject index entries are not newest first");
    }
    rows.push(row);
  }
  validateCollectionYears(document, "subject index", subjectDirectory(at));
  return { ...document, entries: rows };
}

/** Every day and page range belonging to one subject head's year row. */
export function validateSubjectYear(value, expected, kind, code) {
  const at = subjectCoordinate(kind, code);
  return validateCollectionYear(value, expected, "subject year", subjectDirectory(at));
}

/** Every current version under one code whose identifier places it on one page. */
export function validateSubjectPage(value, kind, code, day, page) {
  const at = subjectCoordinate(kind, code);
  const document = exactObject(
    value,
    ["schema_version", "day", "page", "entries"],
    "subject page",
  );
  if (document.schema_version !== SUBJECT_SCHEMA_VERSION) {
    fail(`unsupported subject page schema_version ${String(document.schema_version)}`);
  }
  if (document.day !== day || document.page !== page) {
    fail("subject page identity does not match its URL");
  }
  let previousId = "";
  const rows = [];
  for (const [position, value] of array(document.entries, "subject page entries").entries()) {
    const field = `subject page entries[${position}]`;
    const row = validateSubjectRow(value, field, { ...at, abstract: false });
    pagedHere(row.id, day, page, field);
    // Increasing, and strictly: one current version per result means a code's
    // page never carries a result twice, so an identifier repeated here is two
    // versions of one result presented as two results.
    if (row.id <= previousId) {
      fail("subject page entries are not in increasing identity order");
    }
    previousId = row.id;
    rows.push(row);
  }
  return { ...document, entries: rows };
}

export const SEARCH_SCHEMA_VERSION = 2;
// A word is lowercase, alphanumeric and short, and anything a word cannot be
// was dropped by the indexer rather than escaped. That is what lets this
// request be built straight from what somebody typed: there is no term
// dictionary to check the word against first, because a document naming every
// known word grows with the registry and would be rewritten on every
// publication. See `docs/publication.md` in PalomarDatabase.
const SEARCH_TERM_RE = /^[a-z0-9]{2,32}$/;
const POSTING_RE = /^PALOMAR-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{6}-v[1-9][0-9]*$/;
// Two hundred and sixty thousand results under one word at the published page
// size. The publisher refuses to go past this, so a head that claims to is
// describing an index this reader has never been able to read.
const MAX_SEARCH_PAGES = 2048;
const MAX_SEARCH_PAGE_SIZE = 1024;
// The published list is a few hundred function words and is meant to stay
// that way. A list an order of magnitude longer is not a stopword list any
// more, and reading one would let the served data decide which queries this
// page is willing to run.
const MAX_STOPWORDS = 2000;

function count(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${field} must be a count`);
  return value;
}

/**
 * The words of a text, by exactly the rule the indexer used.
 *
 * Three steps, in this order: decompose, drop combining marks, lowercase. The
 * marks are dropped rather than split on, so Erdős is `erdos` and not `erd`
 * and `s`; a registry of mathematics is full of names nobody types with their
 * accents. `toLowerCase` rather than a fuller case fold, because Python's
 * `str.casefold` maps ß to ss and this does not, and the two sides have to
 * agree exactly: a query folded differently is a request for a word the
 * indexer never wrote, which looks from here exactly like no results.
 *
 * Used on the query and on each record this page is about to show, which is
 * what lets a word with no postings still be decided correctly. See
 * `searchCandidates` in `app.js`.
 */
export function searchTerms(text) {
  const folded = String(text ?? "")
    .normalize("NFKD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase();
  return folded.split(/[^a-z0-9]+/).filter((word) => SEARCH_TERM_RE.test(word));
}

function searchUrl(term, leaf, databaseBase) {
  if (typeof term !== "string" || !SEARCH_TERM_RE.test(term)) {
    fail("search term is not a word this index can name");
  }
  const base = new URL(databaseBase);
  const expected = new URL(`search/t/${term}/${leaf}.json`, base);
  if (expected.origin !== base.origin || !expected.pathname.endsWith(`/${term}/${leaf}.json`)) {
    fail("search path escaped the database origin");
  }
  return expected;
}

export function searchHeadUrl(term, databaseBase) {
  return searchUrl(term, "head", databaseBase);
}

export function searchPageUrl(term, page, databaseBase) {
  if (!Number.isSafeInteger(page) || page < 0 || page >= MAX_SEARCH_PAGES) {
    fail("search page number is out of range");
  }
  return searchUrl(term, String(page), databaseBase);
}

/**
 * How long one word's postings are, from `search/t/<term>/head.json`.
 *
 * The head is the only thing that tells a reader which pages exist, so it is
 * an instruction and not data: its numbers become the next requests. A head
 * claiming more pages than its sequence has sends a reader after pages that
 * are not there; one claiming fewer hides results while looking perfectly
 * well-formed. So the arithmetic is checked rather than trusted, and the
 * bounds are checked too, because the alternative to a bound here is a page
 * count somebody can make as large as they like.
 *
 * One count, not two. There were two while a withdrawal emptied its slot
 * instead of closing the sequence up, and the difference between them said how
 * many withdrawn results carried the word, which is what a takedown is meant
 * to take away.
 */
export function validateSearchHead(value, term) {
  const head = object(value, "search head");
  if (head.schema_version !== SEARCH_SCHEMA_VERSION) {
    fail(`unsupported search head schema_version ${String(head.schema_version)}`);
  }
  if (head.term !== term) fail("search head is for a different word");
  const pageSize = integer(head.page_size, "search head page_size");
  if (pageSize > MAX_SEARCH_PAGE_SIZE) fail("search head page_size is implausibly large");
  const pages = count(head.pages, "search head pages");
  if (pages > MAX_SEARCH_PAGES) fail("search head claims more pages than this index can have");
  const results = count(head.results, "search head results");
  if (pages !== Math.ceil(results / pageSize)) {
    fail("search head page count does not cover the postings it claims");
  }
  return head;
}

/**
 * One page of a word's postings, from `search/t/<term>/<page>.json`.
 *
 * The rows are versioned identifiers, so a posting resolves straight to a
 * record with nothing in between. What is checked beyond their shape is what
 * the page claims about itself: that it is this page of this word, that it
 * holds no more than the page size the head published, and that its postings
 * strictly increase. The last of those is the one worth having. An identifier
 * begins with its registration date, so increasing order is date order within
 * the page, and a page that repeated a posting or padded itself with the same
 * result over and over would be a well-formed page that showed a reader the
 * same work several times under a search it may not match at all.
 */
export function validateSearchPage(value, term, number, head) {
  const page = object(value, "search page");
  if (page.schema_version !== SEARCH_SCHEMA_VERSION) {
    fail(`unsupported search page schema_version ${String(page.schema_version)}`);
  }
  if (page.term !== term) fail("search page is for a different word");
  if (page.page !== number) fail("search page is not the page that was requested");
  if (number >= head.pages) fail("search page is past the end of the sequence");
  const postings = array(page.postings, "search page postings");
  if (postings.length > head.page_size) fail("search page is longer than the head allows");
  let previous = "";
  for (const [position, posting] of postings.entries()) {
    string(posting, `search page postings[${position}]`);
    if (!POSTING_RE.test(posting)) fail(`search page postings[${position}] is malformed`);
    if (posting <= previous) fail("search page postings are not in increasing order");
    previous = posting;
  }
  return page;
}

export function stopwordsUrl(databaseBase) {
  const base = new URL(databaseBase);
  const expected = new URL("search/stopwords.json", base);
  if (expected.origin !== base.origin) fail("stopwords path escaped the database origin");
  return expected;
}

/**
 * The words the indexer drops, from `search/stopwords.json`.
 *
 * This is the one document in the search surface that names words, and it is
 * not the term dictionary the design refuses: it is a fixed editorial choice of
 * function words, so it is the same size at a hundred thousand results as it is
 * now, where a dictionary of every known word grows with the vocabulary and is
 * rewritten on every publication. So the bound is checked here, and a list that
 * had grown into a dictionary is refused rather than read.
 *
 * Fetched rather than copied. A copy in this repository would drift from the
 * indexer's across two deployments, and a reader whose copy disagreed would ask
 * for a word that was never written and be told, in a way they cannot diagnose,
 * that nothing carries it.
 */
export function validateStopwords(value) {
  const document = object(value, "stopwords");
  if (document.schema_version !== SEARCH_SCHEMA_VERSION) {
    fail(`unsupported stopwords schema_version ${String(document.schema_version)}`);
  }
  const words = array(document.stopwords, "stopwords list");
  if (words.length > MAX_STOPWORDS) fail("stopword list has grown into a term dictionary");
  for (const [position, word] of words.entries()) {
    string(word, `stopwords list[${position}]`);
    if (!SEARCH_TERM_RE.test(word)) fail(`stopwords list[${position}] is not a word`);
  }
  return new Set(words);
}

export function postingRecordUrl(posting, databaseBase) {
  if (typeof posting !== "string" || !POSTING_RE.test(posting)) fail("posting is malformed");
  const base = new URL(databaseBase);
  const expected = new URL(`entries/${posting}.json`, base);
  if (expected.origin !== base.origin) fail("posting path escaped the database origin");
  return expected;
}

export function tombstoneUrl(id, version, databaseBase) {
  if (typeof id !== "string" || !ID_RE.test(id)) fail("tombstone ID is malformed");
  integer(version, "tombstone version");
  const base = new URL(databaseBase);
  const expected = new URL(`tombstones/${id}-v${version}.json`, base);
  if (expected.origin !== base.origin) fail("tombstone path escaped the database origin");
  return expected;
}

export function validateTombstone(value, id, version) {
  const tombstone = object(value, "tombstone");
  if (Object.keys(tombstone).sort().join(",") !== "id,taken_down_on,version") {
    fail("tombstone contains unexpected fields");
  }
  if (tombstone.id !== id || tombstone.version !== version) {
    fail("tombstone identity does not match the requested version");
  }
  const timestamp = `${tombstone.taken_down_on}T00:00:00Z`;
  const parsed = new Date(timestamp);
  if (
    !DATE_RE.test(tombstone.taken_down_on) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== tombstone.taken_down_on
  ) {
    fail("tombstone date is malformed");
  }
  return tombstone;
}

export function safeRepositoryPath(value, field = "repository path") {
  string(value, field);
  const segments = value.split("/");
  if (
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("?") ||
    value.includes("#") ||
    segments.some((segment) => !segment || segment === "." || segment === "..") ||
    segments[0].includes(":") ||
    /[\uD800-\uDFFF]/u.test(value) ||
    [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  ) {
    fail(`${field} is not a safe relative path`);
  }
  return value;
}

export function encodedRepositoryPath(path) {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(
      /[!'()*]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    ))
    .join("/");
}

function safeDependencyPath(value, field) {
  if (value === ".") return value;
  return safeRepositoryPath(value, field);
}

function validateCanonicalRecordLinks(entry) {
  const identifier = ID_RE.exec(entry.id);
  if (identifier[1] !== entry.first_registered_on) fail("entry ID date does not match first_registered_on");

  // `first_registered_on` is the result's date, inherited by every later version, and
  // `registered_at` is the version's own instant. They meet at version 1, and
  // there they must: one is in the identifier and decides which browse page
  // the result is on, the other decides where it appears among what is new. A
  // record where they have come apart renders perfectly well while being
  // browsed under one day and ordered under another.
  const registeredOn = entry.registered_at.slice(0, 10);
  if (entry.version === 1 && registeredOn !== entry.first_registered_on) {
    fail("entry.first_registered_on is not the day version 1 was registered");
  }
  if (registeredOn < entry.first_registered_on) {
    fail("entry.registered_at is before the result entered the registry");
  }

  const submission = entry.submission;
  if (!SUBMISSION_ID_RE.test(submission.submission_id)) {
    fail("entry.submission.submission_id is malformed");
  }

  const source = entry.source;
  if (!REPOSITORY_RE.test(source.repository)) fail("source.repository is malformed");
  if (!COMMIT_RE.test(source.commit)) fail("source.commit is not a full lowercase commit");
  const repositoryUrl = `https://github.com/${source.repository}`;
  if (source.repository_url !== repositoryUrl) fail("source.repository_url is not canonical");
  let expectedTreeUrl = `${repositoryUrl}/tree/${source.commit}`;
  if (source.project_path !== undefined) {
    safeRepositoryPath(source.project_path, "entry.source.project_path");
    expectedTreeUrl += `/${encodedRepositoryPath(source.project_path)}`;
  }
  if (source.tree_url !== expectedTreeUrl) {
    fail("source.tree_url is not derived from source repository and commit");
  }
  safeExternalUrl(source.tree_url);

  // The run URL is derived, never trusted: a record names the repository, the
  // run id and the workflow, and the link follows from those.
  const verification = entry.verification;
  if (verification.repository !== SUBMISSION_REPOSITORY) {
    fail("verification.repository is not the Palomar verification repository");
  }
  const expectedRunUrl =
    `https://github.com/${verification.repository}/actions/runs/${verification.run_id}`;
  if (verification.workflow_url !== expectedRunUrl) {
    fail("verification.workflow_url is not derived from the recorded run");
  }
  safeExternalUrl(verification.workflow_url);
}

export function validateEntry(entry, summary) {
  object(entry, "entry");
  object(summary, "entry summary");
  if (entry.schema_version !== ENTRY_SCHEMA_VERSION) {
    fail(`unsupported entry schema_version ${String(entry.schema_version)}`);
  }
  if (entry.status !== "registered") fail("entry status is not registered");
  const id = string(entry.id, "entry.id");
  if (!ID_RE.test(id)) fail("entry.id is malformed");
  const version = integer(entry.version, "entry.version");
  if (id !== summary.id || version !== summary.version) {
    fail("fetched entry identity does not match the selected index summary");
  }
  if (entry.title !== summary.title || entry.status !== summary.status) {
    fail("fetched entry summary fields do not match the index");
  }
  string(entry.title, "entry.title");
  string(entry.abstract, "entry.abstract");
  const firstRegisteredOn = string(entry.first_registered_on, "entry.first_registered_on");
  if (!DATE_RE.test(firstRegisteredOn)) fail("entry.first_registered_on is malformed");
  // The version's own registration instant, which is what every ordering
  // surface reads and what the card is dated by. How it has to agree with
  // `first_registered_on` is in `validateCanonicalRecordLinks`, beside the rest of what
  // a record derives from itself.
  const registeredAt = string(entry.registered_at, "entry.registered_at");
  if (!TIMESTAMP_RE.test(registeredAt) || Number.isNaN(Date.parse(registeredAt))) {
    fail("entry.registered_at is malformed");
  }
  if (summary.published_at !== undefined && summary.published_at !== registeredAt) {
    fail("entry.registered_at does not match summary.published_at");
  }

  const entryAuthors = array(entry.authors, "entry.authors");
  if (!entryAuthors.length) fail("entry.authors must not be empty");
  for (const [position, value] of entryAuthors.entries()) {
    string(object(value, `entry.authors[${position}]`).name, `entry.authors[${position}].name`);
  }

  {
    const classification = object(entry.classification, "entry.classification");
    const arxiv = stringArray(classification.arxiv, "entry.classification.arxiv");
    const msc2020 = stringArray(classification.msc2020, "entry.classification.msc2020");
    if (arxiv.length < 1 || arxiv.length > 8 || new Set(arxiv).size !== arxiv.length) {
      fail("entry.classification.arxiv must contain one to eight unique codes");
    }
    if (msc2020.length > 8 || new Set(msc2020).size !== msc2020.length) {
      fail("entry.classification.msc2020 must contain at most eight unique codes");
    }
    if (arxiv.some((code) => !ARXIV_RE.test(code))) {
      fail("entry.classification.arxiv contains a malformed code");
    }
    if (msc2020.some((code) => !MSC2020_RE.test(code))) {
      fail("entry.classification.msc2020 contains a malformed code");
    }
  }

  // A published record names the submission, and nothing about the person who
  // sent it. There is no submitter field to display, by construction.
  const submission = object(entry.submission, "entry.submission");
  string(submission.submission_id, "entry.submission.submission_id");
  if (Object.hasOwn(submission, "submitter") || Object.hasOwn(submission, "issue")) {
    fail("entry.submission carries a field this schema does not have");
  }

  {
    const authorization = object(submission.authorization, "entry.submission.authorization");
    if (!["maintainer", "approved"].includes(authorization.relationship)) {
      fail("entry.submission.authorization.relationship is not recognized");
    }
    if (authorization.evidence !== undefined) {
      string(authorization.evidence, "entry.submission.authorization.evidence");
    }

    const provenance = object(entry.provenance, "entry.provenance");
    // Provenance is declared at intake, so every published record states it.
    // The labels live beside this list so the two cannot drift.
    if (!Object.hasOwn(RESULT_ORIGIN_LABELS, provenance.result_origin)) {
      fail("entry.provenance.result_origin is not recognized");
    }
    if (!Object.hasOwn(REPOSITORY_ROLE_LABELS, provenance.repository_role)) {
      fail("entry.provenance.repository_role is not recognized");
    }
    const maintainers = array(
      provenance.responsible_maintainers,
      "entry.provenance.responsible_maintainers",
    );
    if (!maintainers.length) {
      fail("entry.provenance.responsible_maintainers must not be empty");
    }
    for (const [position, maintainer] of maintainers.entries()) {
      string(
        object(maintainer, `entry.provenance.responsible_maintainers[${position}]`).name,
        `entry.provenance.responsible_maintainers[${position}].name`,
      );
    }
    const substantiveRelationships = new Set(["formalizes", "adapts", "independently-proves"]);
    const sources = array(provenance.mathematical_sources, "entry.provenance.mathematical_sources");
    for (const [position, sourceRecord] of sources.entries()) {
      const item = object(sourceRecord, `entry.provenance.mathematical_sources[${position}]`);
      string(item.title, `entry.provenance.mathematical_sources[${position}].title`);
      array(item.authors, `entry.provenance.mathematical_sources[${position}].authors`);
      if (item.identifier !== undefined) {
        boundedString(
          item.identifier,
          `entry.provenance.mathematical_sources[${position}].identifier`,
          2048,
        );
      }
      if (item.contributors !== undefined) {
        const contributors = array(
          item.contributors,
          `entry.provenance.mathematical_sources[${position}].contributors`,
        );
        for (const [creditPosition, contributorRecord] of contributors.entries()) {
          const field =
            `entry.provenance.mathematical_sources[${position}].contributors[${creditPosition}]`;
          const contributor = object(contributorRecord, field);
          string(contributor.name, `${field}.name`);
          const role = string(contributor.role, `${field}.role`);
          if (role.length > 200) fail(`${field}.role is too long`);
        }
      }
      if (![...substantiveRelationships, "background", "other"].includes(item.relationship)) {
        fail(`entry.provenance.mathematical_sources[${position}].relationship is not recognized`);
      }
    }
    if (provenance.result_origin === "source-based" &&
        !sources.some((item) => substantiveRelationships.has(item.relationship))) {
      fail("source-based provenance lacks a substantive mathematical source");
    }
    if (provenance.result_origin === "original" &&
        sources.some((item) => substantiveRelationships.has(item.relationship))) {
      fail("original provenance claims a substantive source relationship");
    }
    array(provenance.related_formalizations, "entry.provenance.related_formalizations");
    if (provenance.repository_role === "thin-wrapper") {
      const substantive = object(
        provenance.substantive_formalization,
        "entry.provenance.substantive_formalization",
      );
      if (!REPOSITORY_RE.test(substantive.repository) || !COMMIT_RE.test(substantive.commit)) {
        fail("entry.provenance.substantive_formalization is malformed");
      }
      const repositoryUrl = `https://github.com/${substantive.repository}`;
      if (substantive.repository_url !== repositoryUrl ||
          substantive.tree_url !== `${repositoryUrl}/tree/${substantive.commit}`) {
        fail("entry.provenance.substantive_formalization is not canonical");
      }
      safeExternalUrl(substantive.tree_url);
    }
  }

  const source = object(entry.source, "entry.source");
  string(source.repository, "entry.source.repository");
  string(source.repository_url, "entry.source.repository_url");
  string(source.commit, "entry.source.commit");
  string(source.tree_url, "entry.source.tree_url");
  {
    const license = object(source.license, "entry.source.license");
    const licensePath = string(license.path, "entry.source.license.path");
    if (!LICENSE_PATH_RE.test(licensePath)) {
      fail("entry.source.license.path is not a conventional root licence filename");
    }
    digest(license.sha256, "entry.source.license.sha256");
    const declared = string(
      license.declared_identifier,
      "entry.source.license.declared_identifier",
    );
    const detected = string(
      license.detected_identifier,
      "entry.source.license.detected_identifier",
    );
    if (declared !== detected) {
      fail("entry.source.license declared and detected identifiers disagree");
    }
  }

  const formalization = object(entry.formalization, "entry.formalization");
  safeRepositoryPath(formalization.challenge_path, "entry.formalization.challenge_path");
  safeRepositoryPath(formalization.solution_path, "entry.formalization.solution_path");
  safeRepositoryPath(
    formalization.comparator_config_path,
    "entry.formalization.comparator_config_path",
  );
  safeRepositoryPath(
    formalization.formalization_metadata_path,
    "entry.formalization.formalization_metadata_path",
  );
  {
    safeRepositoryPath(formalization.lakefile_path, "entry.formalization.lakefile_path");
    const prefix = source.project_path ? `${source.project_path}/` : "";
    for (const [field, value] of [
      ["challenge_path", formalization.challenge_path],
      ["solution_path", formalization.solution_path],
      ["comparator_config_path", formalization.comparator_config_path],
      ["lakefile_path", formalization.lakefile_path],
    ]) {
      if (!value.startsWith(prefix)) {
        fail(`entry.formalization.${field} is outside entry.source.project_path`);
      }
    }
    if (![`${prefix}lakefile.toml`, `${prefix}lakefile.lean`].includes(formalization.lakefile_path)) {
      fail("entry.formalization.lakefile_path is not the selected project's Lakefile");
    }
  }
  string(formalization.lean_toolchain, "entry.formalization.lean_toolchain");
  stringArray(formalization.theorem_names, "entry.formalization.theorem_names");
  stringArray(formalization.definition_names, "entry.formalization.definition_names");
  stringArray(formalization.permitted_axioms, "entry.formalization.permitted_axioms");
  const dependencyNames = new Set();
  const dependencyPaths = new Set();
  for (const [position, value] of array(
    formalization.project_dependencies,
    "entry.formalization.project_dependencies",
  ).entries()) {
    const dependency = object(value, `entry.formalization.project_dependencies[${position}]`);
    const dependencyName = string(
      dependency.name,
      `entry.formalization.project_dependencies[${position}].name`,
    );
    if (dependencyNames.has(dependencyName)) {
      fail(`entry.formalization.project_dependencies[${position}].name is duplicated`);
    }
    dependencyNames.add(dependencyName);
    if (dependency.path !== undefined) {
      const path = safeDependencyPath(
        dependency.path,
        `entry.formalization.project_dependencies[${position}].path`,
      );
      if (dependency.repository !== undefined || dependency.revision !== undefined) {
        fail(`entry.formalization.project_dependencies[${position}] mixes path and Git fields`);
      }
      if (dependencyPaths.has(path)) {
        fail(`entry.formalization.project_dependencies[${position}].path is duplicated`);
      }
      dependencyPaths.add(path);
    } else {
      if (!REPOSITORY_RE.test(dependency.repository)) {
        fail(`entry.formalization.project_dependencies[${position}].repository is malformed`);
      }
      commit(
        dependency.revision,
        `entry.formalization.project_dependencies[${position}].revision`,
      );
    }
  }

  const preservation = object(entry.preservation, "entry.preservation");
  if (preservation.archive_owner !== "PalomarArchive") {
    fail("entry.preservation.archive_owner is unsupported");
  }
  if (!TIMESTAMP_RE.test(preservation.archived_at) ||
      Number.isNaN(Date.parse(preservation.archived_at))) {
    fail("entry.preservation.archived_at is malformed");
  }
  digest(preservation.receipt_sha256, "entry.preservation.receipt_sha256");
  const expected = new Map();
  const addExpected = (repository, revision) => {
    expected.set(`${repository.toLowerCase()}\0${revision}`, [repository, revision]);
  };
  addExpected(source.repository, source.commit);
  for (const dependency of formalization.project_dependencies) {
    if (dependency.path === undefined) addExpected(dependency.repository, dependency.revision);
  }
  const substantive = entry.provenance.substantive_formalization;
  if (substantive) addExpected(substantive.repository, substantive.commit);
  const expectedRows = [...expected.values()].sort((left, right) => {
    const leftKey = `${left[0].toLowerCase()}\0${left[1]}`;
    const rightKey = `${right[0].toLowerCase()}\0${right[1]}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  const actualRows = [];
  const seen = new Set();
  const preservationIndex = new Map();
  for (const [position, value] of array(
    preservation.repositories,
    "entry.preservation.repositories",
  ).entries()) {
    const row = object(value, `entry.preservation.repositories[${position}]`);
    if (!REPOSITORY_RE.test(row.source_repository)) {
      fail(`entry.preservation.repositories[${position}].source_repository is malformed`);
    }
    commit(row.commit, `entry.preservation.repositories[${position}].commit`);
    if (!REPOSITORY_RE.test(row.fork_repository) ||
        !row.fork_repository.startsWith("PalomarArchive/")) {
      fail(`entry.preservation.repositories[${position}].fork_repository is malformed`);
    }
    const key = `${row.source_repository.toLowerCase()}\0${row.commit}`;
    if (seen.has(key)) fail(`entry.preservation.repositories[${position}] is duplicated`);
    seen.add(key);
    const expectedRef = `refs/tags/palomar/${entry.id}-v${entry.version}/${row.commit}`;
    if (row.ref !== expectedRef) {
      fail(`entry.preservation.repositories[${position}].ref is not canonical`);
    }
    actualRows.push([row.source_repository, row.commit]);
    preservationIndex.set(key, sourceMappingSnapshot(row));
  }
  if (JSON.stringify(actualRows) !== JSON.stringify(expectedRows)) {
    fail("entry.preservation.repositories does not exactly cover the source graph");
  }

  const verification = object(entry.verification, "entry.verification");
  string(verification.verified_at, "entry.verification.verified_at");
  string(verification.workflow_url, "entry.verification.workflow_url");
  commit(verification.comparator_commit, "entry.verification.comparator_commit");
  commit(verification.lean4export_commit, "entry.verification.lean4export_commit");
  commit(verification.landrun_commit, "entry.verification.landrun_commit");
  commit(verification.nanoda_commit, "entry.verification.nanoda_commit");
  digest(verification.challenge_sha256, "entry.verification.challenge_sha256");
  digest(verification.solution_sha256, "entry.verification.solution_sha256");
  {
    commit(verification.workflow_commit, "entry.verification.workflow_commit");
    integer(verification.workflow_run_attempt, "entry.verification.workflow_run_attempt");
    digest(verification.evidence_tree_sha256, "entry.verification.evidence_tree_sha256");
    digest(verification.mechanical_report_sha256, "entry.verification.mechanical_report_sha256");
    const evidencePath = string(
      verification.evidence_path,
      "entry.verification.evidence_path",
    );
    if (!evidencePath.endsWith("/")) {
      fail("entry.verification.evidence_path must end with a slash");
    }
    safeRepositoryPath(
      evidencePath.slice(0, -1),
      "entry.verification.evidence_path",
    );
    const expectedEvidencePath =
      `evidence/${entry.id}-v${entry.version}/${verification.evidence_tree_sha256}/`;
    if (evidencePath !== expectedEvidencePath) {
      fail(`entry.verification.evidence_path must be ${expectedEvidencePath}`);
    }
  }

  const trust = object(entry.trust, "entry.trust");
  if (!['high', 'qualified'].includes(trust.level)) fail("entry.trust.level is unsupported");
  integer(trust.challenge_lines, "entry.trust.challenge_lines");
  integer(trust.challenge_bytes, "entry.trust.challenge_bytes");
  stringArray(trust.challenge_imports, "entry.trust.challenge_imports");
  for (const [position, value] of array(
    trust.challenge_dependencies,
    "entry.trust.challenge_dependencies",
  ).entries()) {
    const dependency = object(value, `entry.trust.challenge_dependencies[${position}]`);
    if (!REPOSITORY_RE.test(dependency.repository)) {
      fail(`entry.trust.challenge_dependencies[${position}].repository is malformed`);
    }
    if (dependency.provenance !== 'allowlisted') {
      fail(`entry.trust.challenge_dependencies[${position}].provenance is unsupported`);
    }
    if (dependency.palomar_id !== undefined) {
      fail(
        `entry.trust.challenge_dependencies[${position}].palomar_id is forbidden for allowlisted provenance`,
      );
    }
  }
  stringArray(trust.reasons, "entry.trust.reasons");

  const review = object(entry.review, "entry.review");
  string(review.reviewed_at, "entry.review.reviewed_at");
  commit(review.policy_commit, "entry.review.policy_commit");
  if (review.outcome !== "neutral") fail("entry.review.outcome does not permit registration");
  digest(object(review.report, "entry.review.report").sha256, "entry.review.report.sha256");
  if (review.report.source_url !== undefined) {
    safeExternalUrl(string(review.report.source_url, "entry.review.report.source_url"));
  }
  stringArray(review.reviewer_models, "entry.review.reviewer_models");
  // A record is served exactly as it was committed, and a committed record has
  // no scores: they are recorded beside the database, in a directory nothing
  // stages. This tolerated them while the release tooling stripped them on the
  // way out, which meant a release that forgot to strip would have rendered
  // without complaint. Refusing them makes the browser the last check.
  if (review.scores !== undefined) fail("entry.review.scores is not published");
  stringArray(review.warnings, "entry.review.warnings");

  const render = object(entry.challenge_render, "entry.challenge_render");
  const treeHash = string(render.artifact_tree_sha256, "entry.challenge_render.artifact_tree_sha256");
  const expectedPath = `renders/${id}-v${version}/${treeHash}/`;
  if (
    render.format !== "verso-html" ||
    render.entrypoint !== "Challenge/index.html" ||
    !SHA256_RE.test(treeHash) ||
    render.artifact_path !== expectedPath
  ) {
    fail("entry.challenge_render is not canonical");
  }
  commit(render.verso_commit, "entry.challenge_render.verso_commit");
  commit(render.renderer_commit, "entry.challenge_render.renderer_commit");
  commit(render.landrun_commit, "entry.challenge_render.landrun_commit");
  string(render.rendered_at, "entry.challenge_render.rendered_at");

  validateCanonicalRecordLinks(entry);
  validatedSourceRecords.set(entry, {
    repositories: entry.preservation.repositories,
    index: preservationIndex,
  });
  return entry;
}

export function pinnedRepositoryFileUrl(repository, revision, path) {
  if (!REPOSITORY_RE.test(repository)) fail("source repository is malformed");
  commit(revision, "source commit");
  safeRepositoryPath(path, "source file path");
  return safeExternalUrl(
    `https://github.com/${repository}/blob/${revision}/${encodedRepositoryPath(path)}`,
  );
}

export function pinnedRepositoryDirectoryUrl(repository, revision, path = ".") {
  if (!REPOSITORY_RE.test(repository)) fail("source repository is malformed");
  commit(revision, "source commit");
  safeDependencyPath(path, "source directory path");
  const suffix = path === "." ? "" : `/${encodedRepositoryPath(path)}`;
  return safeExternalUrl(`https://github.com/${repository}/tree/${revision}${suffix}`);
}

export function workflowRunId(workflowUrl) {
  return new URL(workflowUrl).pathname.split("/").at(-1);
}

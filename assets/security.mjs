export const INDEX_SCHEMA_VERSION = 2;
export const ENTRY_SCHEMA_VERSIONS = new Set([2, 3, 4, 5, 6]);
export const DEFAULT_DATABASE =
  "https://raw.githubusercontent.com/PalomarRegistry/PalomarDatabase/main/index.json";
export const DEFAULT_RENDER_BASE = "https://palomarregistry.github.io/PalomarDatabase/";

export function supportsProjectPaths(entry) {
  return entry?.schema_version === 6;
}

// Palomar moved from a personal account to the PalomarRegistry organisation on
// 2026-08-04. Records published before the move name the old repository and are
// immutable, so both are canonical forever. A record must still be internally
// consistent: every derived URL below comes from the repository the record
// itself names, and that repository must be one of these.
const SUBMISSION_REPOSITORIES = new Set([
  "kim-em/PalomarSubmission",
  "PalomarRegistry/PalomarSubmission",
]);
const ID_RE = /^PALOMAR-([0-9]{4}-[0-9]{2}-[0-9]{2})-([0-9]{6})$/;
const REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const POSITIVE_INTEGER_RE = /^[1-9][0-9]*$/;
const DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const ARXIV_RE = /^[a-z]+(?:-[a-z]+)*(?:\.[A-Za-z-]+)?$/;
const MSC2020_RE = /^[0-9]{2}(?:[A-Z][0-9]{2}|-[0-9]{2})$/;
const LICENSE_PATH_RE = /^(?:licen[cs]e|copying|unlicense|ofl)(?:\.(?:md|markdown|txt))?$/i;

function fail(message) {
  throw new Error(`invalid registry data: ${message}`);
}

function object(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${field} must be an object`);
  return value;
}

function string(value, field) {
  if (typeof value !== "string" || !value) fail(`${field} must be a non-empty string`);
  return value;
}

function integer(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) fail(`${field} must be a positive integer`);
  return value;
}

function array(value, field) {
  if (!Array.isArray(value)) fail(`${field} must be an array`);
  return value;
}

function stringArray(value, field) {
  for (const [position, item] of array(value, field).entries()) {
    string(item, `${field}[${position}]`);
  }
  return value;
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

export function validateIndex(index) {
  object(index, "index");
  if (index.schema_version !== INDEX_SCHEMA_VERSION) {
    fail(`unsupported index schema_version ${String(index.schema_version)}`);
  }
  const seen = new Set();
  for (const [position, value] of array(index.entries, "index.entries").entries()) {
    const summary = object(value, `index.entries[${position}]`);
    const id = string(summary.id, `index.entries[${position}].id`);
    if (!ID_RE.test(id)) fail(`index.entries[${position}].id is malformed`);
    const version = integer(summary.version, `index.entries[${position}].version`);
    string(summary.title, `index.entries[${position}].title`);
    if (summary.status !== "accepted") fail(`index.entries[${position}].status is not accepted`);
    const expectedPath = `entries/${id}-v${version}.json`;
    if (summary.path !== expectedPath) {
      fail(`index.entries[${position}].path must be ${expectedPath}`);
    }
    const key = `${id}\0${version}`;
    if (seen.has(key)) fail(`duplicate index entry ${id} version ${version}`);
    seen.add(key);
  }
  return index;
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
  if (identifier[1] !== entry.accepted_at) fail("entry ID date does not match accepted_at");
  const issue = Number(identifier[2]);
  const submission = entry.submission;
  const submissionRepository = submission.repository;
  if (
    !SUBMISSION_REPOSITORIES.has(submissionRepository) ||
    submission.issue !== issue ||
    submission.url !== `https://github.com/${submissionRepository}/issues/${issue}`
  ) {
    fail("submission evidence does not match the Palomar ID and canonical issue");
  }
  safeExternalUrl(submission.url);

  const source = entry.source;
  if (!REPOSITORY_RE.test(source.repository)) fail("source.repository is malformed");
  if (!COMMIT_RE.test(source.commit)) fail("source.commit is not a full lowercase commit");
  const repositoryUrl = `https://github.com/${source.repository}`;
  if (source.repository_url !== repositoryUrl) fail("source.repository_url is not canonical");
  let expectedTreeUrl = `${repositoryUrl}/tree/${source.commit}`;
  if (!supportsProjectPaths(entry) && source.project_path !== undefined) {
    fail("source.project_path is not supported by this entry schema");
  }
  if (supportsProjectPaths(entry) && source.project_path !== undefined) {
    safeRepositoryPath(source.project_path, "entry.source.project_path");
    expectedTreeUrl += `/${encodedRepositoryPath(source.project_path)}`;
  }
  if (source.tree_url !== expectedTreeUrl) {
    fail("source.tree_url is not derived from source repository and commit");
  }
  safeExternalUrl(source.tree_url);

  const runPrefix = `https://github.com/${submissionRepository}/actions/runs/`;
  const runId = entry.verification.workflow_url.slice(runPrefix.length);
  if (
    !entry.verification.workflow_url.startsWith(runPrefix) ||
    !POSITIVE_INTEGER_RE.test(runId)
  ) {
    fail("verification.workflow_url is not a canonical PalomarSubmission Actions run");
  }

  const reportPrefix =
    `https://github.com/${submissionRepository}/issues/${issue}#issuecomment-`;
  const commentId = entry.review.report_url.slice(reportPrefix.length);
  if (!entry.review.report_url.startsWith(reportPrefix) || !POSITIVE_INTEGER_RE.test(commentId)) {
    fail("review.report_url is not a canonical report comment for this Palomar ID");
  }
  safeExternalUrl(entry.verification.workflow_url);
  safeExternalUrl(entry.review.report_url);
}

export function validateEntry(entry, summary) {
  object(entry, "entry");
  object(summary, "entry summary");
  if (!ENTRY_SCHEMA_VERSIONS.has(entry.schema_version)) {
    fail(`unsupported entry schema_version ${String(entry.schema_version)}`);
  }
  if (entry.status !== "accepted") fail("entry status is not accepted");
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
  const acceptedAt = string(entry.accepted_at, "entry.accepted_at");
  if (!DATE_RE.test(acceptedAt)) fail("entry.accepted_at is malformed");

  for (const [position, value] of array(entry.authors, "entry.authors").entries()) {
    string(object(value, `entry.authors[${position}]`).name, `entry.authors[${position}].name`);
  }

  if (entry.schema_version === 2 && entry.classification !== undefined) {
    fail("entry.classification is not valid in schema version 2");
  }
  if (entry.schema_version >= 3) {
    const classification = object(entry.classification, "entry.classification");
    const arxiv = stringArray(classification.arxiv, "entry.classification.arxiv");
    const msc2020 = stringArray(classification.msc2020, "entry.classification.msc2020");
    if (arxiv.length < 1 || arxiv.length > 2 || new Set(arxiv).size !== arxiv.length) {
      fail("entry.classification.arxiv must contain one or two unique codes");
    }
    if (msc2020.length < 1 || msc2020.length > 8 || new Set(msc2020).size !== msc2020.length) {
      fail("entry.classification.msc2020 must contain one to eight unique codes");
    }
    if (arxiv.some((code) => !ARXIV_RE.test(code))) {
      fail("entry.classification.arxiv contains a malformed code");
    }
    if (msc2020.some((code) => !MSC2020_RE.test(code))) {
      fail("entry.classification.msc2020 contains a malformed code");
    }
  }

  const submission = object(entry.submission, "entry.submission");
  string(submission.repository, "entry.submission.repository");
  integer(submission.issue, "entry.submission.issue");
  string(submission.url, "entry.submission.url");
  string(submission.submitter, "entry.submission.submitter");

  if (entry.schema_version >= 4) {
    const authorization = object(submission.authorization, "entry.submission.authorization");
    if (!["maintainer", "approved", "legacy-unspecified"].includes(authorization.relationship)) {
      fail("entry.submission.authorization.relationship is not recognized");
    }
    if (authorization.evidence !== undefined) {
      string(authorization.evidence, "entry.submission.authorization.evidence");
    }

    const provenance = object(entry.provenance, "entry.provenance");
    if (!["original", "source-based"].includes(provenance.result_origin)) {
      fail("entry.provenance.result_origin is not recognized");
    }
    if (!["substantive-development", "thin-wrapper"].includes(provenance.repository_role)) {
      fail("entry.provenance.repository_role is not recognized");
    }
    const maintainers = array(
      provenance.responsible_maintainers,
      "entry.provenance.responsible_maintainers",
    );
    if (!maintainers.length) fail("entry.provenance.responsible_maintainers must not be empty");
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
  if (entry.schema_version >= 5) {
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
  if (!supportsProjectPaths(entry) && formalization.lakefile_path !== undefined) {
    fail("entry.formalization.lakefile_path is not supported by this entry schema");
  }
  if (supportsProjectPaths(entry)) {
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
    if (supportsProjectPaths(entry) && dependencyNames.has(dependencyName)) {
      fail(`entry.formalization.project_dependencies[${position}].name is duplicated`);
    }
    dependencyNames.add(dependencyName);
    if (!supportsProjectPaths(entry) && dependency.path !== undefined) {
      fail(`entry.formalization.project_dependencies[${position}].path is not supported`);
    }
    if (supportsProjectPaths(entry) && dependency.path !== undefined) {
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

  const verification = object(entry.verification, "entry.verification");
  string(verification.verified_at, "entry.verification.verified_at");
  string(verification.workflow_url, "entry.verification.workflow_url");
  commit(verification.comparator_commit, "entry.verification.comparator_commit");
  commit(verification.lean4export_commit, "entry.verification.lean4export_commit");
  commit(verification.landrun_commit, "entry.verification.landrun_commit");
  commit(verification.nanoda_commit, "entry.verification.nanoda_commit");
  digest(verification.challenge_sha256, "entry.verification.challenge_sha256");
  digest(verification.solution_sha256, "entry.verification.solution_sha256");
  if (entry.schema_version >= 5) {
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
  if (review.verdict !== "accept") fail("entry.review.verdict is not accept");
  string(review.report_url, "entry.review.report_url");
  stringArray(review.reviewer_models, "entry.review.reviewer_models");
  object(review.scores, "entry.review.scores");
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
  return entry;
}

export function pinnedSourceFileUrl(entry, path) {
  safeRepositoryPath(path, "source file path");
  const expectedRepository = `https://github.com/${entry.source.repository}`;
  if (
    !REPOSITORY_RE.test(entry.source.repository) ||
    entry.source.repository_url !== expectedRepository ||
    !COMMIT_RE.test(entry.source.commit)
  ) {
    fail("source file link lacks canonical repository evidence");
  }
  const encodedPath = encodedRepositoryPath(path);
  return safeExternalUrl(`${expectedRepository}/blob/${entry.source.commit}/${encodedPath}`);
}

export function pinnedSourceDirectoryUrl(entry, path) {
  safeDependencyPath(path, "source directory path");
  const expectedRepository = `https://github.com/${entry.source.repository}`;
  if (
    !REPOSITORY_RE.test(entry.source.repository) ||
    entry.source.repository_url !== expectedRepository ||
    !COMMIT_RE.test(entry.source.commit)
  ) {
    fail("source directory link lacks canonical repository evidence");
  }
  const suffix = path === "." ? "" : `/${encodedRepositoryPath(path)}`;
  return safeExternalUrl(`${expectedRepository}/tree/${entry.source.commit}${suffix}`);
}

export function workflowRunId(workflowUrl) {
  return new URL(workflowUrl).pathname.split("/").at(-1);
}

export function reportIssueNumber(reportUrl) {
  const match = new URL(reportUrl).pathname.match(/\/issues\/([1-9][0-9]*)$/);
  return match ? match[1] : "?";
}

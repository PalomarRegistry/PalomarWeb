import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { htmlFiles } from "../scripts/build-site.mjs";

import {
  DEFAULT_DATABASE,
  DEFAULT_RENDER_BASE,
  databaseBaseFor,
  entryRecordUrl,
  isLoopbackHostname,
  pinnedSourceDirectoryUrl,
  pinnedSourceFileUrl,
  safeDataUrl,
  safeExternalUrl,
  safeInternalUrl,
  selectDatabaseUrl,
  selectRenderBase,
  validateEntry,
  validateIndex,
} from "../assets/security.mjs";

// The website's own origin, for the cross-origin assertion below.
const CANONICAL_WEB_BASE_FOR_TEST = "https://palomarregistry.github.io/PalomarWeb/";

const COMMIT = "1".repeat(40);
const DIGEST = "a".repeat(64);

function summary(overrides = {}) {
  return {
    id: "PALOMAR-2026-07-29-000123",
    version: 1,
    title: "Fixture theorem",
    status: "accepted",
    path: "entries/PALOMAR-2026-07-29-000123-v1.json",
    ...overrides,
  };
}

function index(entries = [summary()], overrides = {}) {
  return { schema_version: 2, entries, ...overrides };
}

function entry(overrides = {}) {
  const value = {
    schema_version: 2,
    id: "PALOMAR-2026-07-29-000123",
    accepted_at: "2026-07-29",
    version: 1,
    status: "accepted",
    title: "Fixture theorem",
    abstract: "A security fixture.",
    authors: [{ name: "Example" }],
    submission: {
      repository: "PalomarRegistry/PalomarSubmission",
      issue: 123,
      url: "https://github.com/PalomarRegistry/PalomarSubmission/issues/123",
      submitter: "example",
    },
    source: {
      repository: "example/challenge",
      repository_url: "https://github.com/example/challenge",
      commit: COMMIT,
      tree_url: `https://github.com/example/challenge/tree/${COMMIT}`,
    },
    formalization: {
      challenge_path: "Challenge.lean",
      solution_path: "Solution.lean",
      comparator_config_path: "comparator.json",
      formalization_metadata_path: "formalization.yaml",
      lean_toolchain: "leanprover/lean4:v4.31.0",
      theorem_names: ["Example.theorem"],
      definition_names: [],
      permitted_axioms: [],
      project_dependencies: [
        { name: "mathlib", repository: "leanprover-community/mathlib4", revision: COMMIT },
      ],
    },
    verification: {
      comparator_commit: "2".repeat(40),
      lean4export_commit: "3".repeat(40),
      landrun_commit: "4".repeat(40),
      nanoda_commit: "9".repeat(40),
      verified_at: "2026-07-29T08:46:32Z",
      workflow_url: "https://github.com/PalomarRegistry/PalomarSubmission/actions/runs/12345",
      challenge_sha256: DIGEST,
      solution_sha256: "b".repeat(64),
    },
    trust: {
      level: "high",
      challenge_lines: 10,
      challenge_bytes: 200,
      challenge_imports: ["Mathlib"],
      challenge_dependencies: [],
      reasons: [],
    },
    review: {
      reviewed_at: "2026-07-29T08:53:02Z",
      policy_commit: "5".repeat(40),
      verdict: "accept",
      report_url:
        "https://github.com/PalomarRegistry/PalomarSubmission/issues/123#issuecomment-456",
      scores: { clarity: 5 },
      reviewer_models: ["fixture:model"],
      warnings: [],
    },
    challenge_render: {
      format: "verso-html",
      artifact_path: `renders/PALOMAR-2026-07-29-000123-v1/${DIGEST}/`,
      entrypoint: "Challenge/index.html",
      artifact_tree_sha256: DIGEST,
      verso_commit: "6".repeat(40),
      renderer_commit: "7".repeat(40),
      landrun_commit: "8".repeat(40),
      rendered_at: "2026-07-29T09:00:00Z",
    },
  };
  return Object.assign(value, overrides);
}

test("production ignores every database query override", () => {
  for (const override of [
    "https://attacker.invalid/index.json",
    "javascript:alert(1)",
    "data:application/json,{}",
  ]) {
    assert.equal(
      selectDatabaseUrl(
        "https://data.palomar-registry.org/PalomarWeb/",
        `?database=${encodeURIComponent(override)}`,
      ).href,
      DEFAULT_DATABASE,
    );
  }
});

test("production also pins the rendered-Challenge origin", () => {
  assert.equal(
    selectRenderBase(
      "https://data.palomar-registry.org/PalomarWeb/",
      "?render-base=https://attacker.invalid/",
      "https://attacker.invalid/database/",
    ).href,
    DEFAULT_RENDER_BASE,
  );
  assert.equal(
    selectRenderBase(
      "http://127.0.0.1:8000/",
      "?render-base=/fixtures/renders/",
      "http://127.0.0.1:8000/fixtures/",
    ).href,
    "http://127.0.0.1:8000/fixtures/renders/",
  );
});

test("loopback development can select an HTTP fixture", () => {
  assert.equal(isLoopbackHostname("localhost"), true);
  assert.equal(isLoopbackHostname("127.9.8.7"), true);
  assert.equal(isLoopbackHostname("[::1]"), true);
  assert.equal(isLoopbackHostname("127.0.0.999"), false);
  assert.equal(
    selectDatabaseUrl("http://127.0.0.1:8000/", "?database=/fixtures/index.json").href,
    "http://127.0.0.1:8000/fixtures/index.json",
  );
  assert.throws(
    () => selectDatabaseUrl("http://localhost:8000/", "?database=javascript:alert(1)"),
    /must use an HTTP\(S\) URL/,
  );
});

test("index entry paths are exact descendants of the database prefix", () => {
  const base = databaseBaseFor("https://example.test/database/index.json");
  assert.equal(
    entryRecordUrl(summary(), base).href,
    "https://example.test/database/entries/PALOMAR-2026-07-29-000123-v1.json",
  );
  for (const path of [
    "../PALOMAR-2026-07-29-000123-v1.json",
    "/entries/PALOMAR-2026-07-29-000123-v1.json",
    "https://attacker.invalid/PALOMAR-2026-07-29-000123-v1.json",
    "entries-evil/PALOMAR-2026-07-29-000123-v1.json",
    "entries/PALOMAR-2026-07-29-000123-v1.json?raw=1",
  ]) {
    assert.throws(() => entryRecordUrl(summary({ path }), base), /entry path must be/);
  }
});

test("index validation rejects unsupported, rejected, and duplicate summaries", () => {
  assert.throws(() => validateIndex(index([], { schema_version: 3 })), /unsupported index/);
  assert.throws(
    () => validateIndex(index([summary({ status: "draft" })])),
    /status is not accepted/,
  );
  assert.throws(() => validateIndex(index([summary(), summary()])), /duplicate index entry/);
  assert.equal(validateIndex(index()).entries.length, 1);
});

test("active-content and insecure data-derived links are never allowed", () => {
  for (const value of [
    "javascript:alert(1)",
    "data:text/html,hostile",
    "blob:https://example.test/id",
    "http://github.com/example/project",
    "https://user:secret@example.test/",
  ]) {
    assert.throws(() => safeExternalUrl(value), /must use HTTPS/);
  }
  assert.equal(safeExternalUrl("https://example.test/path").href, "https://example.test/path");
  assert.equal(
    safeDataUrl("http://127.0.0.1:8000/entry.json", "http://127.0.0.1:8000/entry.html").href,
    "http://127.0.0.1:8000/entry.json",
  );
  assert.throws(
    () => safeDataUrl("http://127.0.0.1:9000/entry.json", "http://127.0.0.1:8000/"),
    /same-origin HTTP/,
  );
  assert.throws(
    () => safeInternalUrl("https://attacker.invalid/", "https://palomar.example/"),
    /escaped the Palomar origin/,
  );
});

test("a canonical accepted record validates", () => {
  assert.equal(validateEntry(entry(), summary()).id, "PALOMAR-2026-07-29-000123");
  assert.equal(
    pinnedSourceFileUrl(entry(), "Challenge.lean").href,
    `https://github.com/example/challenge/blob/${COMMIT}/Challenge.lean`,
  );
});

test("withdrawn palomar-indexed provenance is rejected", () => {
  const trust = {
    ...entry().trust,
    level: "qualified",
    challenge_dependencies: [
      { repository: "example/dependency", provenance: "palomar-indexed" },
    ],
  };
  assert.throws(
    () => validateEntry(entry({ trust }), summary()),
    /provenance is unsupported/,
  );

  trust.challenge_dependencies = [
    {
      repository: "example/dependency",
      provenance: "allowlisted",
      palomar_id: "PALOMAR-2026-07-29-000123",
    },
  ];
  assert.throws(
    () => validateEntry(entry({ trust }), summary()),
    /palomar_id is forbidden/,
  );
});

test("entry schema, acceptance state, verdict, and selected identity fail closed", () => {
  assert.throws(() => validateEntry(entry({ schema_version: 7 }), summary()), /unsupported entry/);
  assert.throws(() => validateEntry(entry({ status: "draft" }), summary()), /not accepted/);
  const rejected = entry();
  rejected.review.verdict = "reject";
  assert.throws(() => validateEntry(rejected, summary()), /verdict is not accept/);
  assert.throws(
    () => validateEntry(entry(), summary({ id: "PALOMAR-2026-07-29-000124", path: "entries/PALOMAR-2026-07-29-000124-v1.json" })),
    /identity does not match/,
  );
  assert.throws(
    () => validateEntry(entry(), summary({ version: 2, path: "entries/PALOMAR-2026-07-29-000123-v2.json" })),
    /identity does not match/,
  );
});

test("schema v3 classification is required and strictly shaped", () => {
  const valid = entry({
    schema_version: 3,
    classification: { arxiv: ["math.CO", "cs.DM"], msc2020: ["05C10"] },
  });
  assert.doesNotThrow(() => validateEntry(valid, summary()));

  assert.throws(
    () => validateEntry(entry({ schema_version: 3 }), summary()),
    /classification must be an object/,
  );
  const malformed = entry({
    schema_version: 3,
    classification: { arxiv: ["math.NOT REAL"], msc2020: ["05C10"] },
  });
  assert.throws(() => validateEntry(malformed, summary()), /malformed code/);
});

test("schema v4 requires explicit provenance and submission authorization", () => {
  const valid = entry({
    schema_version: 4,
    classification: { arxiv: ["math.CO"], msc2020: ["05C10"] },
    provenance: {
      result_origin: "original",
      repository_role: "substantive-development",
      responsible_maintainers: [{ name: "Example" }],
      mathematical_sources: [],
      related_formalizations: [],
    },
  });
  valid.submission.authorization = { relationship: "maintainer" };
  valid.verification.nanoda_commit = "9".repeat(40);
  assert.doesNotThrow(() => validateEntry(valid, summary()));

  const sourceBasedWithoutSource = structuredClone(valid);
  sourceBasedWithoutSource.provenance.result_origin = "source-based";
  assert.throws(
    () => validateEntry(sourceBasedWithoutSource, summary()),
    /lacks a substantive mathematical source/,
  );

  const wrapperWithoutTarget = structuredClone(valid);
  wrapperWithoutTarget.provenance.repository_role = "thin-wrapper";
  assert.throws(
    () => validateEntry(wrapperWithoutTarget, summary()),
    /substantive_formalization must be an object/,
  );

});

test("schema v5 requires content-addressed durable verification evidence", () => {
  const evidenceTree = "c".repeat(64);
  const valid = entry({
    schema_version: 5,
    classification: { arxiv: ["math.CO"], msc2020: ["05C10"] },
    provenance: {
      result_origin: "original",
      repository_role: "substantive-development",
      responsible_maintainers: [{ name: "Example" }],
      mathematical_sources: [],
      related_formalizations: [],
    },
  });
  valid.submission.authorization = { relationship: "maintainer" };
  valid.verification.nanoda_commit = "9".repeat(40);
  valid.source.license = {
    path: "LICENSE",
    sha256: DIGEST,
    declared_identifier: "Apache-2.0",
    detected_identifier: "Apache-2.0",
  };
  Object.assign(valid.verification, {
    workflow_commit: "8".repeat(40),
    workflow_run_attempt: 1,
    evidence_tree_sha256: evidenceTree,
    mechanical_report_sha256: "d".repeat(64),
    evidence_path: `evidence/${valid.id}-v${valid.version}/${evidenceTree}/`,
  });
  assert.doesNotThrow(() => validateEntry(valid, summary()));

  const disagreement = structuredClone(valid);
  disagreement.source.license.detected_identifier = "MIT";
  assert.throws(() => validateEntry(disagreement, summary()), /identifiers disagree/);

  const nestedLicense = structuredClone(valid);
  nestedLicense.source.license.path = "licenses/LICENSE";
  assert.throws(() => validateEntry(nestedLicense, summary()), /conventional root/);

  const badLicenseDigest = structuredClone(valid);
  badLicenseDigest.source.license.sha256 = "not a digest";
  assert.throws(() => validateEntry(badLicenseDigest, summary()), /not a SHA-256/);

  const traversal = structuredClone(valid);
  traversal.verification.evidence_path = "../mechanical-report.json/";
  assert.throws(() => validateEntry(traversal, summary()), /not a safe relative path/);

  const wrongAddress = structuredClone(valid);
  wrongAddress.verification.evidence_path =
    `evidence/${valid.id}-v${valid.version}/${"e".repeat(64)}/`;
  assert.throws(() => validateEntry(wrongAddress, summary()), /evidence_path must be/);
});

test("schema v6 accepts and canonically links a nested project and path dependency", () => {
  const evidenceTree = "c".repeat(64);
  const projectPath = "examples/Sharp Smoothing";
  const valid = entry({
    schema_version: 6,
    classification: { arxiv: ["math.CO"], msc2020: ["05C10"] },
    provenance: {
      result_origin: "original",
      repository_role: "substantive-development",
      responsible_maintainers: [{ name: "Example" }],
      mathematical_sources: [],
      related_formalizations: [],
    },
  });
  valid.submission.authorization = { relationship: "maintainer" };
  valid.source.project_path = projectPath;
  valid.source.tree_url =
    `https://github.com/example/challenge/tree/${COMMIT}/examples/Sharp%20Smoothing`;
  valid.source.license = {
    path: "LICENSE",
    sha256: DIGEST,
    declared_identifier: "Apache-2.0",
    detected_identifier: "Apache-2.0",
  };
  Object.assign(valid.formalization, {
    challenge_path: `${projectPath}/Comparator/Task.lean`,
    solution_path: `${projectPath}/Comparator/Answer.lean`,
    comparator_config_path: `${projectPath}/Comparator/settings.json`,
    formalization_metadata_path: `${projectPath}/formalization.yaml`,
    lakefile_path: `${projectPath}/lakefile.lean`,
    project_dependencies: [
      { name: "local", path: "." },
      { name: "mathlib", repository: "leanprover-community/mathlib4", revision: COMMIT },
    ],
  });
  Object.assign(valid.verification, {
    workflow_commit: "8".repeat(40),
    workflow_run_attempt: 1,
    evidence_tree_sha256: evidenceTree,
    mechanical_report_sha256: "d".repeat(64),
    evidence_path: `evidence/${valid.id}-v${valid.version}/${evidenceTree}/`,
  });
  assert.doesNotThrow(() => validateEntry(valid, summary()));
  assert.equal(
    pinnedSourceFileUrl(valid, valid.formalization.challenge_path).href,
    `https://github.com/example/challenge/blob/${COMMIT}/examples/Sharp%20Smoothing/Comparator/Task.lean`,
  );
  assert.equal(
    pinnedSourceDirectoryUrl(valid, ".").href,
    `https://github.com/example/challenge/tree/${COMMIT}`,
  );

  const wrongTree = structuredClone(valid);
  wrongTree.source.tree_url = `https://github.com/example/challenge/tree/${COMMIT}`;
  assert.throws(() => validateEntry(wrongTree, summary()), /tree_url is not derived/);

  const escape = structuredClone(valid);
  escape.formalization.project_dependencies[0].path = "../outside";
  assert.throws(() => validateEntry(escape, summary()), /not a safe relative path/);

  const misplacedLakefile = structuredClone(valid);
  misplacedLakefile.formalization.lakefile_path = `${projectPath}/nested/lakefile.toml`;
  assert.throws(() => validateEntry(misplacedLakefile, summary()), /selected project's Lakefile/);
});

test("schema v6 keeps the repository-root layout as the natural default", () => {
  const evidenceTree = "c".repeat(64);
  const valid = entry({
    schema_version: 6,
    classification: { arxiv: ["math.CO"], msc2020: ["05C10"] },
    provenance: {
      result_origin: "original",
      repository_role: "substantive-development",
      responsible_maintainers: [{ name: "Example" }],
      mathematical_sources: [],
      related_formalizations: [],
    },
  });
  valid.submission.authorization = { relationship: "maintainer" };
  valid.source.license = {
    path: "LICENSE",
    sha256: DIGEST,
    declared_identifier: "Apache-2.0",
    detected_identifier: "Apache-2.0",
  };
  valid.formalization.lakefile_path = "lakefile.toml";
  Object.assign(valid.verification, {
    workflow_commit: "8".repeat(40),
    workflow_run_attempt: 1,
    evidence_tree_sha256: evidenceTree,
    mechanical_report_sha256: "d".repeat(64),
    evidence_path: `evidence/${valid.id}-v${valid.version}/${evidenceTree}/`,
  });
  assert.doesNotThrow(() => validateEntry(valid, summary()));

  const misplacedLakefile = structuredClone(valid);
  misplacedLakefile.formalization.lakefile_path = "src/lakefile.toml";
  assert.throws(() => validateEntry(misplacedLakefile, summary()), /selected project's Lakefile/);

  const legacyWithProjectPath = entry();
  legacyWithProjectPath.source.project_path = "project";
  assert.throws(() => validateEntry(legacyWithProjectPath, summary()), /not supported/);
});

test("record evidence links must agree with their canonical values", () => {
  const wrongDate = entry({ accepted_at: "2026-07-30" });
  assert.throws(() => validateEntry(wrongDate, summary()), /ID date does not match/);

  const wrongSubmission = entry();
  wrongSubmission.submission.url =
    "https://github.com/PalomarRegistry/PalomarSubmission/issues/999";
  assert.throws(
    () => validateEntry(wrongSubmission, summary()),
    /submission evidence does not match/,
  );

  const wrongTree = entry();
  wrongTree.source.tree_url = `https://github.com/attacker/wrong/tree/${COMMIT}`;
  assert.throws(() => validateEntry(wrongTree, summary()), /tree_url is not derived/);

  const activeWorkflow = entry();
  activeWorkflow.verification.workflow_url = "javascript:alert(1)";
  assert.throws(() => validateEntry(activeWorkflow, summary()), /workflow_url is not a canonical/);

  const wrongReview = entry();
  wrongReview.review.report_url =
    "https://github.com/PalomarRegistry/PalomarSubmission/issues/999#issuecomment-456";
  assert.throws(() => validateEntry(wrongReview, summary()), /report_url is not a canonical/);
});

test("unsafe source paths and malformed displayed digests fail closed", () => {
  const traversal = entry();
  traversal.formalization.challenge_path = "../Challenge.lean";
  assert.throws(() => validateEntry(traversal, summary()), /not a safe relative path/);

  const badDigest = entry();
  badDigest.verification.challenge_sha256 = "not a digest";
  assert.throws(() => validateEntry(badDigest, summary()), /challenge_sha256 is not a SHA-256/);

  const badNanodaPin = entry();
  badNanodaPin.verification.nanoda_commit = "not a commit";
  assert.throws(
    () => validateEntry(badNanodaPin, summary()),
    /nanoda_commit is not a full lowercase commit/,
  );

  const missingNanodaPin = structuredClone(badNanodaPin);
  delete missingNanodaPin.verification.nanoda_commit;
  assert.throws(
    () => validateEntry(missingNanodaPin, summary()),
    /nanoda_commit is not a full lowercase commit/,
  );
});

test("every HTML entry point carries the restrictive CSP", async () => {
  for (const name of htmlFiles) {
    const html = await readFile(new URL(`../${name}`, import.meta.url), "utf8");
    assert.match(html, /Content-Security-Policy/);
    assert.match(html, /default-src 'none'/);
    assert.match(html, /script-src 'self'/);
    assert.match(html, /frame-src 'self' https:\/\/data\.palomar-registry\.org/);
    // The render origin is fetched as well as framed: app.js reads
    // challenge-metadata.json from it. While the site and the renders shared
    // an origin, connect-src 'self' covered that silently. It does not now,
    // and omitting it fails only in the browser console.
    assert.match(
      html,
      /connect-src 'self' https:\/\/raw\.githubusercontent\.com https:\/\/data\.palomar-registry\.org/,
    );
    assert.match(html, /object-src 'none'/);
  }
});

test("the render origin is a different origin from the site", () => {
  // The iframe sandbox omits allow-same-origin, but that should not be the
  // only thing separating a submitter's rendered output from the registry.
  const site = new URL(CANONICAL_WEB_BASE_FOR_TEST);
  const renders = new URL(DEFAULT_RENDER_BASE);
  assert.notStrictEqual(renders.origin, site.origin);
  assert.strictEqual(renders.protocol, "https:");
});

test("About states the repository licence boundary", async () => {
  const about = await readFile(new URL("../about.html", import.meta.url), "utf8");
  assert.match(about, /root licence file, SPDX identifier, and checksum/);
  assert.match(about, /reused formalizations, and\s+dependencies retain their own licences/);
  assert.match(about, /repository root is the default project directory/);
  assert.match(about, /licence file remains at repository root/);
});

// Palomar moved to the PalomarRegistry organisation on 2026-08-04. Records
// published before the move are immutable and name the old repository, so both
// are canonical, and a record must still be internally consistent about which.

function withSubmissionRepository(repository) {
  return entry({
    submission: {
      repository,
      issue: 123,
      url: `https://github.com/${repository}/issues/123`,
      submitter: "example",
    },
    verification: {
      ...entry().verification,
      workflow_url: `https://github.com/${repository}/actions/runs/12345`,
    },
    review: {
      ...entry().review,
      report_url: `https://github.com/${repository}/issues/123#issuecomment-456`,
    },
  });
}

test("a record published before the organisation move still validates", () => {
  const historical = withSubmissionRepository("kim-em/PalomarSubmission");
  assert.equal(validateEntry(historical, summary()).id, "PALOMAR-2026-07-29-000123");
});

test("an unknown submission repository is refused", () => {
  assert.throws(
    () => validateEntry(withSubmissionRepository("attacker/PalomarSubmission"), summary()),
    /submission evidence does not match/,
  );
});

test("submission, run, and report links must name the same repository", () => {
  const mixed = withSubmissionRepository("PalomarRegistry/PalomarSubmission");
  mixed.review.report_url =
    "https://github.com/kim-em/PalomarSubmission/issues/123#issuecomment-456";
  assert.throws(() => validateEntry(mixed, summary()), /review.report_url is not a canonical/);
});

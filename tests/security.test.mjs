import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { htmlFiles } from "../scripts/build-site.mjs";

import {
  DEFAULT_DATABASE,
  ENTRY_SCHEMA_VERSION,
  DEFAULT_RENDER_BASE,
  databaseBaseFor,
  RESULT_ORIGIN_LABELS,
  REPOSITORY_ROLE_LABELS,
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
const CANONICAL_WEB_BASE_FOR_TEST = "https://palomar-registry.org/";

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
  const evidenceTree = "c".repeat(64);
  const value = {
    schema_version: 1,
    id: "PALOMAR-2026-07-29-000123",
    accepted_at: "2026-07-29",
    version: 1,
    status: "accepted",
    title: "Fixture theorem",
    abstract: "A security fixture.",
    authors: [{ name: "Example" }],
    classification: { arxiv: ["math.CO"], msc2020: ["05C10"] },
    submission: {
      submission_id: "a1b2c3d4e5f6",
      authorization: { relationship: "maintainer" },
    },
    provenance: {
      result_origin: "original",
      repository_role: "substantive-development",
      responsible_maintainers: [{ name: "Example" }],
      mathematical_sources: [],
      related_formalizations: [],
    },
    source: {
      repository: "example/challenge",
      repository_url: "https://github.com/example/challenge",
      commit: COMMIT,
      tree_url: `https://github.com/example/challenge/tree/${COMMIT}`,
      license: {
        path: "LICENSE",
        sha256: DIGEST,
        declared_identifier: "Apache-2.0",
        detected_identifier: "Apache-2.0",
      },
    },
    formalization: {
      challenge_path: "Challenge.lean",
      solution_path: "Solution.lean",
      comparator_config_path: "comparator.json",
      formalization_metadata_path: "formalization.yaml",
      lakefile_path: "lakefile.toml",
      lean_toolchain: "leanprover/lean4:v4.31.0",
      theorem_names: ["Example.theorem"],
      definition_names: [],
      permitted_axioms: [],
      project_dependencies: [
        { name: "mathlib", repository: "leanprover-community/mathlib4", revision: COMMIT },
      ],
    },
    verification: {
      repository: "PalomarRegistry/PalomarSubmission",
      run_id: 12345,
      workflow_path: ".github/workflows/submission.yml",
      comparator_commit: "2".repeat(40),
      lean4export_commit: "3".repeat(40),
      landrun_commit: "4".repeat(40),
      nanoda_commit: "9".repeat(40),
      verified_at: "2026-07-29T08:46:32Z",
      workflow_url: "https://github.com/PalomarRegistry/PalomarSubmission/actions/runs/12345",
      workflow_commit: "8".repeat(40),
      workflow_run_attempt: 1,
      challenge_sha256: DIGEST,
      solution_sha256: "b".repeat(64),
      evidence_tree_sha256: evidenceTree,
      mechanical_report_sha256: "d".repeat(64),
      evidence_path: `evidence/PALOMAR-2026-07-29-000123-v1/${evidenceTree}/`,
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
      report: { sha256: "e".repeat(64) },
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
  assert.throws(() => validateEntry(entry({ schema_version: 2 }), summary()), /unsupported entry/);
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

test("record evidence links must agree with their canonical values", () => {
  const wrongDate = entry({ accepted_at: "2026-07-30" });
  assert.throws(() => validateEntry(wrongDate, summary()), /ID date does not match/);

  const wrongSubmissionId = entry();
  wrongSubmissionId.submission.submission_id = "not-an-id";
  assert.throws(() => validateEntry(wrongSubmissionId, summary()), /submission_id is malformed/);

  const wrongTree = entry();
  wrongTree.source.tree_url = `https://github.com/attacker/wrong/tree/${COMMIT}`;
  assert.throws(() => validateEntry(wrongTree, summary()), /tree_url is not derived/);

  // The run URL is derived from the recorded repository and run id, so a link
  // pointing anywhere else is a disagreement inside the record itself.
  const activeWorkflow = entry();
  activeWorkflow.verification.workflow_url = "javascript:alert(1)";
  assert.throws(() => validateEntry(activeWorkflow, summary()), /not derived from the recorded run/);

  const foreignRun = entry();
  foreignRun.verification.workflow_url =
    "https://github.com/attacker/PalomarSubmission/actions/runs/12345";
  assert.throws(() => validateEntry(foreignRun, summary()), /not derived from the recorded run/);

  const foreignRepository = entry();
  foreignRepository.verification.repository = "attacker/PalomarSubmission";
  foreignRepository.verification.workflow_url =
    "https://github.com/attacker/PalomarSubmission/actions/runs/12345";
  assert.throws(
    () => validateEntry(foreignRepository, summary()),
    /not the Palomar verification repository/,
  );

  const relabelledRun = entry();
  relabelledRun.verification.run_id = 99999;
  assert.throws(() => validateEntry(relabelledRun, summary()), /not derived from the recorded run/);
});

test("a published record never carries the submitter", () => {
  // Keeping the submitter private is the whole point of a private intake, and
  // the schema has no field for one. A record that grew one is not displayed.
  for (const field of ["submitter", "issue"]) {
    const leaky = entry();
    leaky.submission[field] = "example";
    assert.throws(() => validateEntry(leaky, summary()), /a field this schema does not have/);
  }
});

test("the archived review is cited by digest, not by a public link", () => {
  const badDigest = entry();
  badDigest.review.report = { sha256: "not a digest" };
  assert.throws(() => validateEntry(badDigest, summary()), /report.sha256 is not a SHA-256/);

  const activeSource = entry();
  activeSource.review.report = { sha256: "e".repeat(64), source_url: "javascript:alert(1)" };
  assert.throws(() => validateEntry(activeSource, summary()));
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

  const missingNanodaPin = entry();
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

test("every page sends submitters to the submission server", async () => {
  // The issue form is gone. A link to it would send a submitter to a 404, and
  // worse, would suggest submissions are still public by default.
  for (const name of htmlFiles) {
    const html = await readFile(new URL(`../${name}`, import.meta.url), "utf8");
    assert.doesNotMatch(html, /PalomarSubmission\/issues/, `${name} links to the deleted issue form`);
  }
  const about = await readFile(new URL("../about.html", import.meta.url), "utf8");
  assert.match(about, /https:\/\/submit\.palomar-registry\.org\//);
  assert.match(about, /Not public unless you publish/);
  assert.match(about, /Nothing is published until you ask for it/);
});

test("About states the repository licence boundary", async () => {
  const about = await readFile(new URL("../about.html", import.meta.url), "utf8");
  assert.match(about, /root licence file, SPDX identifier, and checksum/);
  assert.match(about, /reused formalizations, and\s+dependencies retain their own licences/);
  assert.match(about, /repository root is the default project directory/);
  assert.match(about, /licence file remains at repository root/);
});

test("every provenance value the schema allows has an explicit label", async () => {
  // The renderer once used a binary fallback, so a value nobody stated was
  // displayed as a positive claim about someone's work. Anything the
  // validator accepts must have a label of its own.
  // The authoritative schema lives in PalomarDatabase. CI checks it out and
  // sets PALOMAR_DATABASE_CHECKOUT; locally a sibling clone is assumed. This
  // test exists because the site drifting from the schema is what took the
  // registry down, so an unavailable schema is a failure, not a skip.
  const checkout = process.env.PALOMAR_DATABASE_CHECKOUT
    ?? new URL("../../PalomarDatabase/", import.meta.url).pathname;
  const schema = JSON.parse(
    await readFile(new URL("schema-v1.json", `file://${checkout}/`), "utf8"),
  );
  const provenance = schema.properties.provenance.properties;
  for (const [field, labels] of [
    ["result_origin", RESULT_ORIGIN_LABELS],
    ["repository_role", REPOSITORY_ROLE_LABELS],
  ]) {
    assert.deepStrictEqual(
      Object.keys(labels).sort(),
      [...provenance[field].enum].sort(),
      `${field} labels must cover exactly the schema's values`,
    );
  }
});

test("the site validates exactly the schema version the database publishes", async () => {
  const checkout = process.env.PALOMAR_DATABASE_CHECKOUT
    ?? new URL("../../PalomarDatabase/", import.meta.url).pathname;
  const schema = JSON.parse(
    await readFile(new URL("schema-v1.json", `file://${checkout}/`), "utf8"),
  );
  assert.strictEqual(schema.properties.schema_version.const, ENTRY_SCHEMA_VERSION);
});

test("the favicon ships with the site and every page asks for it", async () => {
  // The build copies a fixed list, so an asset that is not on it is simply
  // absent from the deployment however correct the markup is.
  const build = await readFile(new URL("../scripts/build-site.mjs", import.meta.url), "utf8");
  assert.match(build, /"favicon\.svg"/);
  for (const name of htmlFiles) {
    const html = await readFile(new URL(`../${name}`, import.meta.url), "utf8");
    assert.match(html, /rel="icon" href="favicon\.svg"/, `${name} does not ask for the favicon`);
  }
  const icon = await readFile(new URL("../favicon.svg", import.meta.url), "utf8");
  // One flat colour per scheme, and nothing that a strict policy would refuse.
  assert.match(icon, /prefers-color-scheme: dark/);
  assert.doesNotMatch(icon, /<script|xlink:href|href="http/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEFAULT_DATABASE,
  DEFAULT_RENDER_BASE,
  databaseBaseFor,
  entryRecordUrl,
  isLoopbackHostname,
  pinnedSourceFileUrl,
  safeDataUrl,
  safeExternalUrl,
  safeInternalUrl,
  selectDatabaseUrl,
  selectRenderBase,
  validateEntry,
  validateIndex,
} from "../assets/security.mjs";

const COMMIT = "1".repeat(40);
const DIGEST = "a".repeat(64);

function summary(overrides = {}) {
  return {
    id: "PALOMAR-000123",
    version: 1,
    title: "Fixture theorem",
    status: "accepted",
    path: "entries/PALOMAR-000123-v1.json",
    ...overrides,
  };
}

function index(entries = [summary()], overrides = {}) {
  return { schema_version: 1, entries, ...overrides };
}

function entry(overrides = {}) {
  const value = {
    schema_version: 1,
    id: "PALOMAR-000123",
    version: 1,
    status: "accepted",
    title: "Fixture theorem",
    abstract: "A security fixture.",
    authors: [{ name: "Example" }],
    source: {
      repository: "example/challenge",
      repository_url: "https://github.com/example/challenge",
      commit: COMMIT,
      tree_url: `https://github.com/example/challenge/tree/${COMMIT}`,
    },
    formalization: {
      challenge_path: "Challenge.lean",
      solution_path: "Solution.lean",
      lean_toolchain: "leanprover/lean4:v4.31.0",
      theorem_names: ["Example.theorem"],
      permitted_axioms: [],
    },
    verification: {
      comparator_commit: "2".repeat(40),
      workflow_url: "https://github.com/kim-em/PalomarSubmission/actions/runs/12345",
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
      verdict: "accept",
      report_url:
        "https://github.com/kim-em/PalomarSubmission/issues/123#issuecomment-456",
      scores: { clarity: 5 },
      warnings: [],
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
        "https://kim-em.github.io/PalomarWeb/",
        `?database=${encodeURIComponent(override)}`,
      ).href,
      DEFAULT_DATABASE,
    );
  }
});

test("production also pins the rendered-Challenge origin", () => {
  assert.equal(
    selectRenderBase(
      "https://kim-em.github.io/PalomarWeb/",
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
    "https://example.test/database/entries/PALOMAR-000123-v1.json",
  );
  for (const path of [
    "../PALOMAR-000123-v1.json",
    "/entries/PALOMAR-000123-v1.json",
    "https://attacker.invalid/PALOMAR-000123-v1.json",
    "entries-evil/PALOMAR-000123-v1.json",
    "entries/PALOMAR-000123-v1.json?raw=1",
  ]) {
    assert.throws(() => entryRecordUrl(summary({ path }), base), /entry path must be/);
  }
});

test("index validation rejects unsupported, rejected, and duplicate summaries", () => {
  assert.throws(() => validateIndex(index([], { schema_version: 2 })), /unsupported index/);
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
  assert.equal(validateEntry(entry(), summary()).id, "PALOMAR-000123");
  assert.equal(
    pinnedSourceFileUrl(entry(), "Challenge.lean").href,
    `https://github.com/example/challenge/blob/${COMMIT}/Challenge.lean`,
  );
});

test("entry schema, acceptance state, verdict, and selected identity fail closed", () => {
  assert.throws(() => validateEntry(entry({ schema_version: 2 }), summary()), /unsupported entry/);
  assert.throws(() => validateEntry(entry({ status: "draft" }), summary()), /not accepted/);
  const rejected = entry();
  rejected.review.verdict = "reject";
  assert.throws(() => validateEntry(rejected, summary()), /verdict is not accept/);
  assert.throws(
    () => validateEntry(entry(), summary({ id: "PALOMAR-000124", path: "entries/PALOMAR-000124-v1.json" })),
    /identity does not match/,
  );
  assert.throws(
    () => validateEntry(entry(), summary({ version: 2, path: "entries/PALOMAR-000123-v2.json" })),
    /identity does not match/,
  );
});

test("record evidence links must agree with their canonical values", () => {
  const wrongTree = entry();
  wrongTree.source.tree_url = `https://github.com/attacker/wrong/tree/${COMMIT}`;
  assert.throws(() => validateEntry(wrongTree, summary()), /tree_url is not derived/);

  const activeWorkflow = entry();
  activeWorkflow.verification.workflow_url = "javascript:alert(1)";
  assert.throws(() => validateEntry(activeWorkflow, summary()), /workflow_url is not a canonical/);

  const wrongReview = entry();
  wrongReview.review.report_url =
    "https://github.com/kim-em/PalomarSubmission/issues/999#issuecomment-456";
  assert.throws(() => validateEntry(wrongReview, summary()), /report_url is not a canonical/);
});

test("unsafe source paths and malformed displayed digests fail closed", () => {
  const traversal = entry();
  traversal.formalization.challenge_path = "../Challenge.lean";
  assert.throws(() => validateEntry(traversal, summary()), /not a safe relative path/);

  const badDigest = entry();
  badDigest.verification.challenge_sha256 = "not a digest";
  assert.throws(() => validateEntry(badDigest, summary()), /challenge_sha256 is malformed/);
});

test("every HTML entry point carries the restrictive CSP", async () => {
  for (const name of ["index.html", "entry.html", "render.html", "about.html", "404.html"]) {
    const html = await readFile(new URL(`../${name}`, import.meta.url), "utf8");
    assert.match(html, /Content-Security-Policy/);
    assert.match(html, /default-src 'none'/);
    assert.match(html, /script-src 'self'/);
    assert.match(html, /frame-src 'self' https:\/\/kim-em\.github\.io/);
    assert.match(html, /object-src 'none'/);
  }
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { DOSSIER_LIMITATION, evidenceDossier } from "../assets/evidence-dossier.mjs";
import { validateAvailability } from "../assets/security.mjs";
import {
  COMMIT,
  availabilityEndpoint,
  availabilityManifest,
  availabilityRow,
  entry,
  toolchainEntry,
} from "./registry-fixture.mjs";

const CHECKED_AT = new Date(Math.floor(Date.now() / 1_000) * 1_000)
  .toISOString()
  .replace(".000Z", "Z");

const FIELD_ORDER = [
  "id",
  "version",
  "title",
  "statement",
  "source",
  "assumptions",
  "checker_evidence",
  "source_revisions",
  "preservation",
  "limitation",
];

function manifest() {
  return validateAvailability(availabilityManifest([
    availabilityRow({
      original: availabilityEndpoint({ status: "available", checked_at: CHECKED_AT }),
      archive: availabilityEndpoint({ status: "available", checked_at: CHECKED_AT }),
    }),
  ], { generated_at: CHECKED_AT }));
}

test("a dossier copies one exact record in a stable order and escapes record text", () => {
  const record = entry();
  record.title = "Hi <script>alert(1)</script> [click](https://evil.example)";
  record.formalization.permitted_axioms = ["propext", "<img src=x>"];
  const first = evidenceDossier(record, manifest());
  const second = evidenceDossier(record, manifest());
  assert.equal(first.json, second.json);
  assert.deepEqual(Object.keys(first.model), FIELD_ORDER);
  assert.equal(first.model.limitation, DOSSIER_LIMITATION);
  assert.equal(first.basename, `${record.id}-v${record.version}-dossier`);

  const parsed = JSON.parse(first.json);
  assert.equal(parsed.title, record.title);
  assert.deepEqual(parsed.assumptions, ["propext", "<img src=x>"]);
  assert.equal(Object.hasOwn(parsed.checker_evidence, "kernels"), false);
  assert.equal(
    parsed.statement.url,
    `https://github.com/example/challenge/blob/${COMMIT}/Challenge.lean`,
  );
  assert.equal(
    parsed.source.url,
    `https://github.com/example/challenge/tree/${COMMIT}`,
  );
  assert.deepEqual(parsed.source_revisions, [
    { repository: "example/challenge", revision: COMMIT, role: "submitted-source" },
    { repository: "leanprover-community/mathlib4", revision: COMMIT, role: "project-dependency" },
  ]);

  const [challenge, mathlib] = parsed.preservation.repositories;
  assert.equal(challenge.original_status, "available");
  assert.equal(challenge.original_observed_at, CHECKED_AT);
  assert.equal(challenge.archive_observed_at, CHECKED_AT);
  assert.equal(Object.hasOwn(mathlib, "original_status"), false);
  assert.equal(Object.hasOwn(mathlib, "archive_status"), false);
  assert.equal(mathlib.fork_url, `https://github.com/PalomarArchive/mathlib4--fixture/tree/${COMMIT}`);

  assert.match(first.markdown, /&lt;script&gt;alert\\\(1\\\)&lt;\/script&gt;/);
  assert.match(first.markdown, /\\\[click\\\]\\\(https:\/\/evil\.example\\\)/);
  assert.match(first.markdown, /&lt;img src=x&gt;/);
  assert.doesNotMatch(first.markdown, /<script>|<img/);
  assert.doesNotMatch(first.markdown, /\[click\]\(https:\/\/evil\.example\)/);
  assert.match(first.markdown, new RegExp(DOSSIER_LIMITATION));
  assert.match(first.markdown, new RegExp(CHECKED_AT));
  assert.doesNotMatch(first.markdown, /Successful kernels|kernel check failed|unavailable/);
});

test("missing evidence is omitted instead of written as a negative finding", async () => {
  const recorded = toolchainEntry();
  const withKernels = evidenceDossier(recorded);
  assert.deepEqual(withKernels.model.checker_evidence.kernels, ["nanoda", "con-ron"]);
  assert.match(withKernels.markdown, /Successful kernels: nanoda, con-ron/);
  assert.equal(Object.hasOwn(withKernels.model.preservation.repositories[0], "original_status"), false);

  const sparse = entry();
  delete sparse.formalization.permitted_axioms;
  delete sparse.verification.kernels;
  delete sparse.preservation;
  sparse.title = "Sparse";
  const hidden = evidenceDossier(sparse);
  assert.equal(Object.hasOwn(hidden.model, "assumptions"), false);
  assert.equal(Object.hasOwn(hidden.model, "preservation"), false);
  assert.equal(Object.hasOwn(hidden.model.checker_evidence, "kernels"), false);
  assert.doesNotMatch(hidden.markdown, /Recorded assumptions|## Preservation|not preserved|no kernel|failed|unavailable|unknown/);
  assert.match(hidden.markdown, new RegExp(DOSSIER_LIMITATION));

  const source = await readFile(new URL("../assets/evidence-dossier.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /data\.palomar-registry\.org/);
});

import assert from "node:assert/strict";
import test from "node:test";

import { entryDelta } from "../assets/version-diff.mjs";

const base = {
  title: "A result",
  abstract: "Same words",
  formalization: { theorem_names: ["main"] },
  classification: { arxiv: ["math.NT"], msc2020: ["11N05"] },
  trust: { level: "high" },
  source: { commit: "abc" },
};

test("identical versions report no reader-visible change", () => {
  assert.deepEqual(entryDelta(base, { ...base }), []);
});

test("a changed theorem name and commit are both reported", () => {
  const next = {
    ...base,
    formalization: { theorem_names: ["main", "extra"] },
    source: { commit: "def" },
  };
  assert.deepEqual(entryDelta(base, next), [
    { field: "theorems", before: "main", after: "main, extra" },
    { field: "commit", before: "abc", after: "def" },
  ]);
});

import assert from "node:assert/strict";
import test from "node:test";

import { mathematicalSourceUrl } from "../assets/bibliography.mjs";

test("current and legacy arXiv identifiers resolve to their matching abstracts", () => {
  assert.equal(
    mathematicalSourceUrl("arXiv:2605.20695v2").href.href,
    "https://arxiv.org/abs/2605.20695v2",
  );
  assert.equal(
    mathematicalSourceUrl("arXiv:math.AG/0211159").href.href,
    "https://arxiv.org/abs/math.AG/0211159",
  );
});

test("DOI links encode data and refuse path normalization", () => {
  assert.equal(
    mathematicalSourceUrl("doi:10.1000/a?#b").href.href,
    "https://doi.org/10.1000/a%3F%23b",
  );
  assert.equal(mathematicalSourceUrl("doi:10.1000/../10.9999/other"), null);
});

test("unsafe and unknown source identifiers remain unresolved", () => {
  assert.equal(mathematicalSourceUrl("https://reader:secret@example.invalid/source"), null);
  assert.equal(mathematicalSourceUrl("bibliographic:custom-reference"), null);
  assert.equal(mathematicalSourceUrl(null), null);
});

import assert from "node:assert/strict";
import test from "node:test";

import { presentationAbstract } from "../assets/presentation-text.mjs";

test("the accidentally published AI review synthesis is not presentation text", () => {
  assert.equal(
    presentationAbstract({
      id: "PALOMAR-2026-08-13-000001",
      version: 1,
      abstract: "AI-generated editorial synthesis.",
    }),
    "",
  );
});

test("submitter-authored abstracts and later corrected versions remain visible", () => {
  assert.equal(
    presentationAbstract({
      id: "PALOMAR-2026-08-08-000001",
      version: 3,
      abstract: "A submitter-authored description.",
    }),
    "A submitter-authored description.",
  );
  assert.equal(
    presentationAbstract({
      id: "PALOMAR-2026-08-13-000001",
      version: 2,
      abstract: "A corrected submitter-authored description.",
    }),
    "A corrected submitter-authored description.",
  );
});

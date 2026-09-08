import assert from "node:assert/strict";
import test from "node:test";

import { abstractSegments, presentationAbstract } from "../assets/presentation-text.mjs";

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

// Submitters mark identifiers in an abstract with Markdown code spans, and the
// page used to show the backticks to the reader as punctuation. These are the
// runs it reads, and the ones it deliberately leaves alone.
test("a submitter's code spans are separated from their prose", () => {
  assert.deepEqual(
    abstractSegments("classifies `AddCircle (1 : ℝ)` by `ℤ` today"),
    [
      { code: false, text: "classifies " },
      { code: true, text: "AddCircle (1 : ℝ)" },
      { code: false, text: " by " },
      { code: true, text: "ℤ" },
      { code: false, text: " today" },
    ],
  );
  assert.deepEqual(
    abstractSegments("no marks at all"),
    [{ code: false, text: "no marks at all" }],
  );
});

// An abstract is plain text a submitter wrote, not a document this page parses.
// A tick they used for something else must cost them that tick and nothing
// more: swallowing the rest of the abstract into one code run would hide the
// text, and hiding a submitter's words is worse than showing a stray mark.
test("an unpaired backtick stays prose and takes no more than its own line", () => {
  assert.deepEqual(
    abstractSegments("an unclosed `tick stays put"),
    [{ code: false, text: "an unclosed `tick stays put" }],
  );
  assert.deepEqual(
    abstractSegments("opens `here\nand closes `there` below"),
    [
      { code: false, text: "opens `here\nand closes " },
      { code: true, text: "there" },
      { code: false, text: " below" },
    ],
  );
  assert.deepEqual(
    abstractSegments("empty `` marks are not a code run"),
    [{ code: false, text: "empty `` marks are not a code run" }],
  );
});

// Every run is reassembled by a caller as text or as a `code` element, so the
// runs must carry the whole abstract and nothing but the abstract: a segmenter
// that dropped or duplicated a character would quietly rewrite a record. Put
// the delimiters back around the code runs and the original must return.
test("the runs reassemble into exactly the abstract that was read", () => {
  for (const abstract of [
    "plain",
    "`leads` and trails `here`",
    "``",
    "`",
    "a `b` c `d` e",
    "line one\n  indented `code` two",
    "",
  ]) {
    assert.equal(
      abstractSegments(abstract)
        .map((segment) => (segment.code ? `\`${segment.text}\`` : segment.text))
        .join(""),
      abstract,
    );
  }
});

// A run with no text would reach the caller as an empty text node or, worse, an
// empty `code` element with a ground and padding and nothing inside it.
test("no run is empty", () => {
  for (const abstract of ["`a`", "a `b`", "`a` b", "``", ""]) {
    for (const segment of abstractSegments(abstract)) {
      assert.ok(segment.text.length > 0, `empty run from ${JSON.stringify(abstract)}`);
    }
  }
});

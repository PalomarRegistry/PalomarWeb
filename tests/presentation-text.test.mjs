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
      { kind: "prose", text: "classifies " },
      { kind: "code", text: "AddCircle (1 : ℝ)" },
      { kind: "prose", text: " by " },
      { kind: "code", text: "ℤ" },
      { kind: "prose", text: " today" },
    ],
  );
  assert.deepEqual(
    abstractSegments("no marks at all"),
    [{ kind: "prose", text: "no marks at all" }],
  );
});

// An abstract is plain text a submitter wrote, not a document this page parses.
// A tick they used for something else must cost them that tick and nothing
// more: swallowing the rest of the abstract into one code run would hide the
// text, and hiding a submitter's words is worse than showing a stray mark.
test("an unpaired backtick stays prose and takes no more than its own line", () => {
  assert.deepEqual(
    abstractSegments("an unclosed `tick stays put"),
    [{ kind: "prose", text: "an unclosed `tick stays put" }],
  );
  assert.deepEqual(
    abstractSegments("opens `here\nand closes `there` below"),
    [
      { kind: "prose", text: "opens `here\nand closes " },
      { kind: "code", text: "there" },
      { kind: "prose", text: " below" },
    ],
  );
  assert.deepEqual(
    abstractSegments("empty `` marks are not a code run"),
    [{ kind: "prose", text: "empty `` marks are not a code run" }],
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
        .map((segment) => (segment.kind === "code" ? `\`${segment.text}\`` : segment.text))
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

const kinds = (text) =>
  abstractSegments(text).map((segment) => [segment.kind, segment.text]);
const mathIn = (text) =>
  abstractSegments(text).filter((s) => s.kind === "math").map((s) => s.text);

// Most submitters mark nothing and write the mathematics into the sentence.
// These are found by their operators, so the reader gets the same separation
// without the page having to decide which words are variables.
test("mathematics written into a sentence is found by its operators", () => {
  assert.deepEqual(
    mathIn(
      "Fix an ordinal kappa; a colour count mu ≥ 2; and a target order type " +
        "theta = omega^alpha with alpha > 0, on 2^kappa.",
    ),
    ["mu ≥ 2", "theta = omega^alpha", "alpha > 0", "2^kappa"],
  );
  // "kappa" on its own is left alone: a bare word carries no operator, and
  // restyling it would assert something about the prose that was never said.
  assert.deepEqual(
    kinds("Fix an ordinal kappa")[0],
    ["prose", "Fix an ordinal kappa"],
  );
});

// Mathematicians write inner products as <x*y, z>. Reading those brackets as
// comparisons cut the notation at the wrong places and pulled in the words
// either side -- "the inner product <x*y" and "v> equals" -- so a comparison
// counts only when it is spaced, which is what separates the two in practice.
test("angle brackets around a term are not read as comparisons", () => {
  assert.deepEqual(mathIn("the associativity of the inner product <x*y, z> = <y, x*z>"), []);
  assert.deepEqual(mathIn("the supremum of <1,v>^2 / <Av,v> equals c*"), []);
  // A spaced comparison is still found.
  assert.deepEqual(mathIn("every r_n < 1 and n > 10 hold"), ["r_n < 1", "n > 10"]);
});

// Identifiers, citations and versions carry dots, slashes and digits but no
// operator, and each of these appears in real published abstracts.
test("citations, versions and prose punctuation are not mathematics", () => {
  for (const text of [
    "A Lean 4 / Mathlib development of the companion paper",
    "(doi:10.13140/RG.2.2.10727.82081)",
    "arXiv:2602.17613",
    "the pinned Mathlib revision (Mathlib v4.34.0-rc1)",
    "proves compact--Hausdorff and discrete sufficient cases",
    "the sequence A061419, which is therefore not holonomic",
  ]) {
    assert.deepEqual(mathIn(text), [], text);
  }
});

// A submitter's own mark is the stronger statement, so it is read first and an
// expression is looked for only in what is left over. A code span is never
// reopened to look inside it.
test("a submitter's marked span outranks anything found inside it", () => {
  assert.deepEqual(
    kinds("classifies `n ≥ 3` by `ℤ` where m ≥ 2"),
    [
      ["prose", "classifies "],
      ["code", "n ≥ 3"],
      ["prose", " by "],
      ["code", "ℤ"],
      ["prose", " where "],
      ["math", "m ≥ 2"],
    ],
  );
});

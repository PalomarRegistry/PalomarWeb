// Registered entry records are immutable. This one record was registered before
// Palomar stopped using an AI review synthesis as an abstract fallback, so its
// canonical bytes must remain available while reader-facing surfaces suppress
// the text that was never supplied or endorsed by the submitter.
const SUPPRESSED_ABSTRACTS = new Set([
  "PALOMAR-2026-08-13-000001-v1",
]);

export function presentationAbstract(entry) {
  const key = `${entry.id}-v${entry.version}`;
  if (SUPPRESSED_ABSTRACTS.has(key)) return "";
  return entry.abstract;
}

// Submitters already mark identifiers in an abstract the way they would
// anywhere else, with Markdown code spans -- 38 of them across the published
// set, holding things like `Polynomial.roots_countP_pos_le_signVariations` and
// `ℤ × ℤ`. Rendering the abstract verbatim showed the reader the backticks as
// punctuation and left the identifier in the same face as the prose around it,
// so the one thing the submitter did say about their own text was the one
// thing the page dropped.
//
// This reads that delimiter and nothing else. It is not a Markdown parser and
// must not become one: an abstract is a submitter's plain text, and every
// further construct guessed at here is the page deciding what their prose
// meant. A run with no closing backtick stays prose, backtick and all, rather
// than swallowing the rest of the abstract, and a span never crosses a line
// break, so an unpaired tick costs at most its own line.
const CODE_SPAN = /`([^`\n]+)`/g;

// Most submitters mark nothing, and write their mathematics into the sentence:
// "a colour count mu ≥ 2; and a target order type theta = omega^alpha with
// alpha > 0". Set those apart too -- but find them by their operators, never by
// deciding which words are variables. "kappa" alone stays prose here, because a
// page that restyles a bare word has asserted something about a submitter's
// prose that the submitter did not.
//
// An atom is what can stand either side of an operator.
const ATOM =
  "[A-Za-z0-9_'\\u0370-\\u03FF\\u2100-\\u214F\\u2070-\\u209C\\u{1D400}-\\u{1D7FF}]";
// These mean one thing wherever they appear, so they may bind tightly: x^2.
const TIGHT =
  "[=^\\u2190\\u2192\\u21A6\\u2208\\u2209\\u2260\\u2261\\u2264\\u2265" +
  "\\u2282\\u2286\\u2287\\u2200\\u2203\\u2227\\u2228\\u2248\\u222A\\u2229\\u00D7\\u00B1]";
// `<` and `>` do not. Mathematicians write inner products as <x*y, z>, and
// reading those as comparisons cut the notation at the wrong places and pulled
// the words either side of it in: "the inner product <x*y" and "v> equals".
// Spaces are what separate the comparison from the bracket, so only a spaced
// one counts. Deliberately absent for the same reason: / + - * : , all of which
// carry prose ("a Lean 4 / Mathlib development", "compact--Hausdorff").
const EXPRESSION = new RegExp(
  `${ATOM}+(?:(?:\\s?${TIGHT}\\s?|\\s[<>]\\s)${ATOM}+)+`,
  "gu",
);

function withExpressions(text, segments) {
  let read = 0;
  for (const match of text.matchAll(EXPRESSION)) {
    if (match.index > read) {
      segments.push({ kind: "prose", text: text.slice(read, match.index) });
    }
    segments.push({ kind: "math", text: match[0] });
    read = match.index + match[0].length;
  }
  if (read < text.length) segments.push({ kind: "prose", text: text.slice(read) });
}

/**
 * One abstract as prose, marked code, and mathematical expressions, in order.
 *
 * Returns `[{ kind, text }]` with `kind` one of "prose", "code" or "math", and
 * never empty text, so a caller appends each run as a text node or as one
 * element. Callers build the DOM: the runs carry no markup, which is what keeps
 * a submitter's text incapable of introducing any.
 *
 * A submitter's own code span wins over anything found inside it: the marks
 * they wrote are read first, and expressions are looked for only in what is
 * left over.
 */
export function abstractSegments(text) {
  const segments = [];
  let read = 0;
  for (const match of text.matchAll(CODE_SPAN)) {
    if (match.index > read) withExpressions(text.slice(read, match.index), segments);
    segments.push({ kind: "code", text: match[1] });
    read = match.index + match[0].length;
  }
  if (read < text.length) withExpressions(text.slice(read), segments);
  return segments;
}

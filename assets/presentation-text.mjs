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

/**
 * One abstract as alternating prose and code runs, in order.
 *
 * Returns `[{ code, text }]`, never empty text, so a caller appends each run
 * as a text node or a `code` element and nothing else. Callers build the DOM:
 * the runs carry no markup, which is what keeps a submitter's text incapable
 * of introducing any.
 */
export function abstractSegments(text) {
  const segments = [];
  let read = 0;
  for (const match of text.matchAll(CODE_SPAN)) {
    if (match.index > read) {
      segments.push({ code: false, text: text.slice(read, match.index) });
    }
    segments.push({ code: true, text: match[1] });
    read = match.index + match[0].length;
  }
  if (read < text.length) segments.push({ code: false, text: text.slice(read) });
  return segments;
}

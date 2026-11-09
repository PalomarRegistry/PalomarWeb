/**
 * What changed between two immutable versions of one result.
 *
 * Compared fields are the ones a reader can see without opening the proof: the
 * title, the abstract, the theorem names, the classification, the trust label,
 * and the source commit. A registry correction's field list is a different
 * record and is not repeated here.
 */
function list(value) {
  return Array.isArray(value) ? value.join(", ") : "";
}

export function entryDelta(before, after) {
  const fields = [
    ["title", before.title, after.title],
    ["abstract", before.abstract || "", after.abstract || ""],
    ["theorems", list(before.formalization?.theorem_names), list(after.formalization?.theorem_names)],
    ["arxiv", list(before.classification?.arxiv), list(after.classification?.arxiv)],
    ["msc2020", list(before.classification?.msc2020), list(after.classification?.msc2020)],
    ["trust", before.trust?.level || "", after.trust?.level || ""],
    ["commit", before.source?.commit || "", after.source?.commit || ""],
  ];
  return fields
    .filter(([, left, right]) => left !== right)
    .map(([field, left, right]) => ({ field, before: left, after: right }));
}

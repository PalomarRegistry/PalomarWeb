import assert from "node:assert/strict";
import test from "node:test";

import { bibtexCitation } from "../assets/citation-presentation.mjs";

test("BibTeX citations pin the selected immutable Palomar version", () => {
  const entry = {
    id: "PALOMAR-2026-08-08-000001",
    version: 3,
    registered_at: "2027-01-02T03:04:05Z",
    title: "A result",
    authors: [{ name: "Ada Lovelace" }, { name: "Emmy Noether" }],
  };

  assert.equal(
    bibtexCitation(entry),
    `@misc{palomar-2026-08-08-000001-v3,
  author = {{Ada Lovelace} and {Emmy Noether}},
  title = {{A result}},
  year = {2027},
  howpublished = {Palomar, PALOMAR-2026-08-08-000001 v3},
  url = {https://palomar-registry.org/entry?id=PALOMAR-2026-08-08-000001&version=3},
}`,
  );
});

test("BibTeX citations preserve Unicode and escape TeX-significant record text", () => {
  const citation = bibtexCitation({
    id: "PALOMAR-2026-08-08-000001",
    version: 1,
    registered_at: "2026-08-08T12:00:00Z",
    title: "Erdős & 100% of {cases}_x ~ ^ \\ path\ncontinued",
    authors: [{ name: "Research & Development" }],
  });

  assert.match(citation, /author = \{\{Research \\& Development\}\}/);
  assert.match(
    citation,
    /title = \{\{Erdős \\& 100\\% of \\\{cases\\\}\\_x \\~\{\} \\\^\{\} \\textbackslash\{\} path continued\}\}/,
  );
});

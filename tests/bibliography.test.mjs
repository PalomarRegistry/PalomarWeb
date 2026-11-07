import assert from "node:assert/strict";
import test from "node:test";

import { entryReferenceLinks, mathematicalSourceUrl } from "../assets/bibliography.mjs";

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

test("Hexagon and OEIS identifiers resolve without losing explicit versions", () => {
  assert.equal(mathematicalSourceUrl("hexagon:2610.00022v2").href.href,
    "https://hexagonmath.org/2610.00022v2");
  assert.equal(mathematicalSourceUrl("HEXAGON:2610.00022").href.href,
    "https://hexagonmath.org/2610.00022");
  assert.equal(mathematicalSourceUrl("OEIS:A116485").href.href, "https://oeis.org/A116485");
  for (const identifier of ["hexagon:2610.22", "hexagon:2610.00022v0", "hexagon:../other"]) {
    assert.equal(mathematicalSourceUrl(identifier), null);
  }
});

function provenance(identifiers, related = []) {
  return {
    mathematical_sources: identifiers.map((identifier) => ({
      identifier, title: `Paper ${identifier}`, relationship: "background",
    })),
    related_formalizations: related.map((identifier) => ({ identifier, relationship: "prior work" })),
  };
}

test("entry references deduplicate equivalent paper links and retain their provenance", () => {
  const links = entryReferenceLinks(provenance([
    "arXiv:2605.20695v2",
    "https://arxiv.org/pdf/2605.20695v2.pdf",
    "https://arxiv.org/abs/2605.20695v1",
    "hexagon:2610.00022",
  ], ["https://hexagonmath.org/2610.00022"]));
  assert.deepEqual(links.map(({ href }) => href.href), [
    "https://arxiv.org/abs/2605.20695v2",
    "https://arxiv.org/abs/2605.20695v1",
    "https://hexagonmath.org/2610.00022",
  ]);
  assert.equal(links[0].descriptions.length, 2);
  assert.match(links[2].descriptions[1], /^Related formalization:.*prior work/);
});

test("entry references recognize identifiers in composite citations", () => {
  const links = entryReferenceLinks(provenance([
    "A journal citation; doi:10.1007/BF02848939; arXiv:math.AG/0211159 (2002)",
    "See (https://hexagonmath.org/2610.00022).",
    "OEIS:A116485",
    "doi:10.1000/a?#b",
    'https://www.isa-afp.org/entries/TsirelsonBound.html (companion arXiv:2306.12535)',
  ]));
  assert.deepEqual(links.map(({ href }) => href.href), [
    "https://doi.org/10.1007/BF02848939",
    "https://arxiv.org/abs/math.AG/0211159",
    "https://hexagonmath.org/2610.00022",
    "https://oeis.org/A116485",
    "https://doi.org/10.1000/a%3F%23b",
    "https://www.isa-afp.org/entries/TsirelsonBound.html",
    "https://arxiv.org/abs/2306.12535",
  ]);
});

test("other corpus sites are recognized by exact host, and unknown links stay in provenance", () => {
  const urls = [
    "https://www.erdosproblems.com/501",
    "https://www.isa-afp.org/entries/Jacobian_Counterexample.html",
    "https://mathoverflow.net/a/449571/109573",
    "https://oeis.org/A071642",
    "https://zbmath.org/3254142",
    "https://proofatlas.ai/formalizations/sendov-conjecture/",
    "https://projecteuclid.org/journals/a-paper",
    "https://eudml.org/doc/158244",
  ];
  const links = entryReferenceLinks(provenance([
    ...urls,
    "https://hexagonmath.org.evil.invalid/2610.00022",
    "https://reader:secret@hexagonmath.org/2610.00022",
    "http://hexagonmath.org/2610.00022",
    "https://example.invalid/?reference=arXiv:2605.20695",
    "javascript:alert(1)",
    "bibliographic:custom-reference",
  ]));
  assert.deepEqual(links.map(({ href }) => href.href), urls);
  assert.deepEqual(entryReferenceLinks(provenance([])), []);
});

test("composite citations preserve SICI DOI punctuation without truncating the target", () => {
  const doi = "10.1002/(SICI)1097-0118(199601)21:1<1::AID-JGT1>3.0.CO;2-Q";
  const links = entryReferenceLinks(provenance([
    `Wiley; doi:${doi}`,
    `A citation (doi:${doi}); arXiv:2306.12535`,
    "Another citation; doi:10.1000/a,b;",
  ]));
  assert.deepEqual(links.map(({ href }) => href.href), [
    "https://doi.org/10.1002/%28SICI%291097-0118%28199601%2921%3A1%3C1%3A%3AAID-JGT1%3E3.0.CO%3B2-Q",
    "https://arxiv.org/abs/2306.12535",
    "https://doi.org/10.1000/a%2Cb",
  ]);
});

test("bracketed citation links strip unmatched closing brackets", () => {
  const links = entryReferenceLinks(provenance([
    "See [https://arxiv.org/abs/2306.12535].",
    "See {https://hexagonmath.org/2610.00022}.",
    "See ([https://oeis.org/A116485]).",
  ]));
  assert.deepEqual(links.map(({ href }) => href.href), [
    "https://arxiv.org/abs/2306.12535",
    "https://hexagonmath.org/2610.00022",
    "https://oeis.org/A116485",
  ]);
});

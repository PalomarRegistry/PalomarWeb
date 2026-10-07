import { safeExternalUrl } from "./security.mjs";

const ARXIV_IDENTIFIER_RE = /^arXiv:((?:[0-9]{4}\.[0-9]{4,5}|[a-z-]+(?:\.[a-z]{2})?\/[0-9]{7})(?:v[0-9]+)?)$/i;
const DOI_IDENTIFIER_RE = /^doi:(10\.[0-9]{4,9}\/\S+)$/i;
const HEXAGON_IDENTIFIER_RE = /^hexagon:([0-9]{4}\.[0-9]{5}(?:v[1-9][0-9]*)?)$/i;
const OEIS_IDENTIFIER_RE = /^oeis:(A[0-9]{6})$/i;

// Add a site's exact hosts here to surface its recorded links on entry pages.
// Identifier resolution stays separate: unknown citations remain readable in
// Mathematical origin, even when they have no recognized link target.
const REFERENCE_SITES = [
  { key: "arxiv", icon: "arxiv.png", label: "arXiv", hosts: ["arxiv.org", "www.arxiv.org"] },
  { key: "hexagon", icon: "hexagon.svg", label: "Hexagon", hosts: ["hexagonmath.org", "www.hexagonmath.org"] },
  { key: "doi", icon: "doi.png", label: "DOI", hosts: ["doi.org", "dx.doi.org"] },
  { key: "erdos", icon: "erdosproblems.png", label: "Erdős Problems", hosts: ["erdosproblems.com", "www.erdosproblems.com"] },
  { key: "afp", icon: "afp.ico", label: "Archive of Formal Proofs", hosts: ["isa-afp.org", "www.isa-afp.org"] },
  { key: "mathoverflow", icon: "mathoverflow.ico", label: "MathOverflow", hosts: ["mathoverflow.net"] },
  { key: "oeis", icon: "oeis.ico", label: "OEIS", hosts: ["oeis.org", "www.oeis.org"] },
  { key: "zbmath", icon: "zbmath.ico", label: "zbMATH", hosts: ["zbmath.org"] },
  { key: "proofatlas", icon: "proofatlas.svg", label: "ProofAtlas", hosts: ["proofatlas.ai", "www.proofatlas.ai"] },
  { key: "euclid", icon: "euclid.png", label: "Project Euclid", hosts: ["projecteuclid.org"] },
  { key: "eudml", icon: "eudml.ico", label: "EuDML", hosts: ["eudml.org"] },
];

function encodePathSegment(segment) {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Resolve recognized bibliography identifiers without ever hiding raw text. */
export function mathematicalSourceUrl(identifier) {
  if (typeof identifier !== "string") return null;

  const arxiv = ARXIV_IDENTIFIER_RE.exec(identifier);
  if (arxiv) {
    return { href: safeExternalUrl(`https://arxiv.org/abs/${arxiv[1]}`), kind: "arxiv" };
  }

  const hexagon = HEXAGON_IDENTIFIER_RE.exec(identifier);
  if (hexagon) {
    return { href: safeExternalUrl(`https://hexagonmath.org/${hexagon[1]}`), kind: "hexagon" };
  }

  const oeis = OEIS_IDENTIFIER_RE.exec(identifier);
  if (oeis) {
    return { href: safeExternalUrl(`https://oeis.org/${oeis[1].toUpperCase()}`), kind: "oeis" };
  }

  const doi = DOI_IDENTIFIER_RE.exec(identifier);
  if (doi) {
    const segments = doi[1].split("/");
    if (segments.some((segment) => segment === "." || segment === "..")) return null;
    const encoded = segments.map(encodePathSegment).join("/");
    const target = new URL(encoded, "https://doi.org/");
    if (target.origin !== "https://doi.org" || target.pathname !== `/${encoded}`) return null;
    return { href: safeExternalUrl(target), kind: "doi" };
  }

  if (identifier.startsWith("https://")) {
    try {
      return { href: safeExternalUrl(identifier), kind: "url" };
    } catch {
      return null;
    }
  }
  return null;
}

function referenceLink(identifier) {
  const resolved = mathematicalSourceUrl(identifier);
  if (!resolved) return null;
  const site = REFERENCE_SITES.find(({ hosts }) => hosts.includes(resolved.href.hostname));
  if (!site) return null;
  let href = resolved.href;
  let label = site.label;
  // Abstract and PDF references to the same paper share one link. Preserve
  // explicit versions, because distinct paper versions need distinct targets.
  if (site.key === "arxiv") {
    const match = /^\/(?:abs|pdf|html)\/(.+?)(?:\.pdf)?\/?$/.exec(href.pathname);
    if (match && ARXIV_IDENTIFIER_RE.test(`arXiv:${match[1]}`)) {
      href = mathematicalSourceUrl(`arXiv:${match[1]}`).href;
      label = `arXiv:${match[1]}`;
    }
  } else if (site.key === "hexagon") {
    const match = /^\/([0-9]{4}\.[0-9]{5}(?:v[1-9][0-9]*)?)\/?$/.exec(href.pathname);
    if (match) {
      href = mathematicalSourceUrl(`hexagon:${match[1]}`).href;
      label = `Hexagon:${match[1]}`;
    }
  } else if (site.key === "oeis") {
    const match = /^\/(A[0-9]{6})\/?$/.exec(href.pathname);
    if (match) label = `OEIS:${match[1]}`;
  }
  return { href, label, icon: site.icon };
}

function citationIdentifiers(identifier) {
  if (typeof identifier !== "string") return [];
  const text = identifier.trim();
  // Resolve a whole identifier first so valid DOI punctuation is preserved.
  if (!/\s/.test(text) && mathematicalSourceUrl(text)) return [text];
  // Some submissions put several identifiers inside a bibliographic citation.
  // Only scan the recorded identifier, never unrelated free-form metadata.
  // Older SICI DOIs contain angle brackets, commas, and semicolons. Preserve
  // the complete non-whitespace token rather than cutting a DOI at those marks.
  const tokens = text.match(/https?:\/\/[^\s"']+|\bdoi:\S+|\b(?:arxiv|hexagon|oeis):[^\s;,<>"']+/gi) || [];
  return tokens.map((token) => {
    let result = token.replace(/[.,;]+$/, "");
    const brackets = { ")": "(", "]": "[", "}": "{" };
    while (brackets[result.at(-1)]) {
      const closing = result.at(-1);
      if (result.split(closing).length <= result.split(brackets[closing]).length) break;
      result = result.slice(0, -1).replace(/[.,;]+$/, "");
    }
    return result;
  });
}

/** Recognized links from the provenance already parsed from formalization.yaml. */
export function entryReferenceLinks(provenance) {
  const links = new Map();
  for (const [field, role] of [
    ["mathematical_sources", "Source"],
    ["related_formalizations", "Related formalization"],
  ]) {
    for (const source of provenance[field]) {
      for (const identifier of citationIdentifiers(source.identifier)) {
        const link = referenceLink(identifier);
        if (!link) continue;
        const description = `${role}: ${source.title || source.identifier} (${source.relationship})`;
        const previous = links.get(link.href.href);
        if (previous) {
          if (!previous.descriptions.includes(description)) previous.descriptions.push(description);
        } else {
          links.set(link.href.href, { ...link, descriptions: [description] });
        }
      }
    }
  }
  return [...links.values()];
}

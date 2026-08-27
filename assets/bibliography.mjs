import { safeExternalUrl } from "./security.mjs";

const ARXIV_IDENTIFIER_RE = /^arXiv:((?:[0-9]{4}\.[0-9]{4,5}|[a-z-]+(?:\.[a-z]{2})?\/[0-9]{7})(?:v[0-9]+)?)$/i;
const DOI_IDENTIFIER_RE = /^doi:(10\.[0-9]{4,9}\/\S+)$/i;

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

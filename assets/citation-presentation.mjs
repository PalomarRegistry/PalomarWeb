import { canonicalEntryPageUrl } from "./entry-history-presentation.mjs";

const RESET_DELAY_MS = 1600;
const BIBTEX_ESCAPES = Object.freeze({
  "\\": "\\textbackslash{}",
  "{": "\\{",
  "}": "\\}",
  "#": "\\#",
  "$": "\\$",
  "%": "\\%",
  "&": "\\&",
  "_": "\\_",
  "^": "\\^{}",
  "~": "\\~{}",
});

function bibtexText(value) {
  const oneLine = value.replace(/\s+/gu, " ").trim();
  return [...oneLine].map((character) => BIBTEX_ESCAPES[character] ?? character).join("");
}

/** A ready-to-paste citation of exactly the immutable snapshot being viewed. */
export function bibtexCitation(entry) {
  const key = `${entry.id.toLowerCase()}-v${entry.version}`;
  const authors = entry.authors
    .map((author) => `{${bibtexText(author.name)}}`)
    .join(" and ");
  return [
    `@misc{${key},`,
    `  author = {${authors}},`,
    `  title = {{${bibtexText(entry.title)}}},`,
    `  year = {${entry.registered_at.slice(0, 4)}},`,
    `  howpublished = {Palomar, ${entry.id} v${entry.version}},`,
    `  url = {${canonicalEntryPageUrl(entry).href}},`,
    "}",
  ].join("\n");
}

function fallbackCopy(document, text) {
  const previousFocus = document.activeElement;
  const input = document.createElement("textarea");
  input.value = text;
  input.className = "clipboard-fallback";
  document.body.append(input);
  input.select();
  input.setSelectionRange(0, text.length);
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    input.remove();
    previousFocus?.focus();
  }
}

/** Bind the citation and its clipboard control to an entry page. */
export function createCitationPresentation({ document, navigator, window }) {
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // The fallback supports browsers that expose but deny the Clipboard API.
      }
    }
    return fallbackCopy(document, text);
  }

  function citationSection(entry) {
    const citation = bibtexCitation(entry);
    const section = el("section", "entry-citation");
    section.setAttribute("aria-labelledby", "citation-heading");

    const heading = el("div", "section-heading");
    const title = el("div");
    const titleHeading = el("h2", "", "Cite this");
    titleHeading.id = "citation-heading";
    title.append(el("div", "eyebrow", "Citation"), titleHeading);

    const copy = el("button", "citation-copy", "Copy BibTeX");
    copy.type = "button";
    const status = el("span", "visually-hidden citation-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    heading.append(title, copy);

    const code = el("code", "", citation);
    const block = el("pre", "citation-bibtex");
    block.append(code);
    section.append(
      heading,
      el(
        "p",
        "citation-intro",
        `This citation names immutable version ${entry.version} of the registered record.`,
      ),
      block,
      status,
    );

    let resetTimer;
    copy.addEventListener("click", async () => {
      const copied = await copyText(citation);
      window.clearTimeout(resetTimer);
      copy.classList.toggle("copied", copied);
      copy.textContent = copied ? "Copied!" : "Copy failed";
      status.textContent = copied
        ? "Copied BibTeX citation."
        : "Could not copy BibTeX citation.";
      resetTimer = window.setTimeout(() => {
        copy.classList.remove("copied");
        copy.textContent = "Copy BibTeX";
      }, RESET_DELAY_MS);
    });

    return section;
  }

  return { citationSection };
}

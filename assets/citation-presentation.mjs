import {
  CLIPBOARD_RESET_DELAY_MS,
  createClipboard,
} from "./clipboard.mjs";
import { canonicalEntryPageUrl } from "./entry-history-presentation.mjs";

const BIBTEX_ESCAPES = Object.freeze({
  "\\": "\\textbackslash{}",
  "{": "\\{",
  "}": "\\}",
  "#": "\\#",
  "$": "\\$",
  "%": "\\%",
  "&": "\\&",
  "_": "\\_",
  "^": "\\textasciicircum{}",
  "~": "\\textasciitilde{}",
});

function bibtexText(value) {
  const oneLine = value.replace(/\s+/gu, " ").trim();
  return [...oneLine].map((character) => BIBTEX_ESCAPES[character] ?? character).join("");
}

/** A ready-to-paste citation of exactly the immutable snapshot being viewed. */
export function bibtexCitation(entry) {
  const key = `${entry.id.toLowerCase()}-v${entry.version}`;
  // Records carry one exact display name rather than structured given/family
  // parts. Bracing each complete name preserves it and prevents a literal
  // "and" in one name from becoming a false author boundary.
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

function citationAuthors(entry) {
  return entry.authors.map((author) => author.name.trim()).filter(Boolean);
}

/** RIS for the same immutable snapshot. One author per `AU` line. */
export function risCitation(entry) {
  const url = canonicalEntryPageUrl(entry).href;
  const lines = ["TY  - GEN"];
  for (const author of citationAuthors(entry)) lines.push(`AU  - ${author}`);
  lines.push(
    `TI  - ${entry.title.replace(/\s+/gu, " ").trim()}`,
    `PY  - ${entry.registered_at.slice(0, 4)}`,
    `DA  - ${entry.registered_at.slice(0, 10).replaceAll("-", "/")}`,
    `ID  - ${entry.id} v${entry.version}`,
    `UR  - ${url}`,
    "ER  - ",
  );
  return lines.join("\n");
}

/** CSL-JSON for the same snapshot, including the theorem names the record lists. */
export function cslCitation(entry) {
  const item = {
    type: "article",
    id: `${entry.id}-v${entry.version}`,
    title: entry.title.replace(/\s+/gu, " ").trim(),
    author: citationAuthors(entry).map((name) => ({ literal: name })),
    issued: { "date-parts": [entry.registered_at.slice(0, 10).split("-").map(Number)] },
    URL: canonicalEntryPageUrl(entry).href,
    "container-title": "Palomar",
    note: (entry.formalization?.theorem_names || []).join("; "),
  };
  return JSON.stringify([item], null, 2);
}

/** Bind the citation and its clipboard control to an entry page. */
export function createCitationPresentation({ document, navigator, window }) {
  const { announce, copyText } = createClipboard({ document, navigator, window });

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
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
    const copyRis = el("button", "citation-copy citation-copy-ris", "Copy RIS");
    copyRis.type = "button";
    const copyCsl = el("button", "citation-copy citation-copy-csl", "Copy CSL");
    copyCsl.type = "button";
    const status = el("span", "visually-hidden citation-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    heading.append(title, copy, copyRis, copyCsl);

    const code = el("code", "", citation);
    const block = el("pre", "citation-bibtex");
    block.tabIndex = 0;
    block.setAttribute("role", "group");
    block.setAttribute("aria-labelledby", titleHeading.id);
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
    function onCopy(button, text, idle, spoken, failureSpoken) {
      return async () => {
        const copied = await copyText(text);
        window.clearTimeout(resetTimer);
        button.classList.toggle("copied", copied);
        button.textContent = copied ? "Copied!" : "Copy failed";
        announce(status, copied ? spoken : failureSpoken);
        resetTimer = window.setTimeout(() => {
          button.classList.remove("copied");
          button.textContent = idle;
          status.textContent = "";
        }, CLIPBOARD_RESET_DELAY_MS);
      };
    }
    copy.addEventListener("click", onCopy(copy, citation, "Copy BibTeX", "Copied BibTeX citation.", "Could not copy BibTeX citation."));
    copyRis.addEventListener("click", onCopy(copyRis, risCitation(entry), "Copy RIS", "Copied RIS citation.", "Could not copy RIS citation."));
    copyCsl.addEventListener("click", onCopy(copyCsl, cslCitation(entry), "Copy CSL", "Copied CSL-JSON citation.", "Could not copy CSL-JSON citation."));

    return section;
  }

  return { citationSection };
}

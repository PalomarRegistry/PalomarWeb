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

const BIBTEX_MONTHS = Object.freeze([
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
]);

/** The UTC calendar day a record was registered, as BibTeX fields. */
function registrationCalendar(value) {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T/.exec(value || "");
  const month = match ? Number(match[2]) : 0;
  const day = match ? Number(match[3]) : 0;
  if (!match || month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error("entry is missing a valid registration date");
  }
  return { year: match[1], month: BIBTEX_MONTHS[month - 1], day: match[3] };
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
  const registered = registrationCalendar(entry.registered_at);
  return [
    `@misc{${key},`,
    `  author = {${authors}},`,
    `  title = {{${bibtexText(entry.title)}}},`,
    `  year = {${registered.year}},`,
    `  month = ${registered.month},`,
    `  day = {${registered.day}},`,
    `  howpublished = {Palomar, ${entry.id} v${entry.version}},`,
    `  url = {${canonicalEntryPageUrl(entry).href}},`,
    "}",
  ].join("\n");
}

/** One sentence a reader can paste where BibTeX is not wanted. */
export function plainCitation(entry) {
  const authors = entry.authors.map((author) => author.name.trim()).filter(Boolean).join(", ");
  const registered = registrationCalendar(entry.registered_at);
  const title = entry.title.replace(/\s+/gu, " ").trim();
  return `${authors} (${registered.year}). ${title}. Palomar, ${entry.id} version ${entry.version}, registered ${registered.year}-${entry.registered_at.slice(5, 10)}. ${canonicalEntryPageUrl(entry).href}`;
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
    const plain = plainCitation(entry);
    const pageUrl = canonicalEntryPageUrl(entry).href;
    const section = el("section", "entry-citation");
    section.setAttribute("aria-labelledby", "citation-heading");

    const heading = el("div", "section-heading");
    const title = el("div");
    const titleHeading = el("h2", "", "Cite this");
    titleHeading.id = "citation-heading";
    title.append(el("div", "eyebrow", "Citation"), titleHeading);

    const copy = el("button", "citation-copy", "Copy BibTeX");
    copy.type = "button";
    const copyLink = el("button", "citation-copy citation-copy-link", "Copy link");
    copyLink.type = "button";
    const status = el("span", "visually-hidden citation-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    heading.append(title, copy, copyLink);

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
      el("p", "citation-plain", plain),
      block,
      status,
    );

    let resetTimer;
    async function onCopy(button, text, successLabel, failureLabel, successSpoken, failureSpoken) {
      const copied = await copyText(text);
      window.clearTimeout(resetTimer);
      button.classList.toggle("copied", copied);
      button.textContent = copied ? successLabel : failureLabel;
      announce(status, copied ? successSpoken : failureSpoken);
      const idle = button === copy ? "Copy BibTeX" : "Copy link";
      resetTimer = window.setTimeout(() => {
        button.classList.remove("copied");
        button.textContent = idle;
        status.textContent = "";
      }, CLIPBOARD_RESET_DELAY_MS);
    }
    copy.addEventListener("click", () => onCopy(
      copy,
      citation,
      "Copied!",
      "Copy failed",
      "Copied BibTeX citation.",
      "Could not copy BibTeX citation.",
    ));
    copyLink.addEventListener("click", () => onCopy(
      copyLink,
      pageUrl,
      "Copied!",
      "Copy failed",
      "Copied the link to this version.",
      "Could not copy the link to this version.",
    ));
    return section;
  }

  return { citationSection };
}

import {
  CLIPBOARD_RESET_DELAY_MS,
  createClipboard,
} from "./clipboard.mjs";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

function linkIcon() {
  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");

  const path = document.createElementNS(SVG_NAMESPACE, "path");
  path.setAttribute(
    "d",
    "M7.775 3.275a.75.75 0 0 0 1.06 1.06l1.25-1.25a2 2 0 1 1 2.83 2.83l-2.5 2.5a2 2 0 0 1-2.83 0 .75.75 0 0 0-1.06 1.06 3.5 3.5 0 0 0 4.95 0l2.5-2.5a3.5 3.5 0 0 0-4.95-4.95l-1.25 1.25Zm.45 9.45a.75.75 0 0 0-1.06-1.06l-1.25 1.25a2 2 0 1 1-2.83-2.83l2.5-2.5a2 2 0 0 1 2.83 0 .75.75 0 0 0 1.06-1.06 3.5 3.5 0 0 0-4.95 0l-2.5 2.5a3.5 3.5 0 0 0 4.95 4.95l1.25-1.25Z",
  );
  svg.append(path);
  return svg;
}

const { announce: announceClipboard, copyText } = createClipboard({
  document,
  navigator,
  window,
});

function anchorTarget(heading) {
  if (heading.id) return heading.id;
  return heading.closest("section[id]")?.id;
}

const status = document.querySelector("#anchor-status");

function announce(message) {
  announceClipboard(status, message);
}

const headings = [...document.querySelectorAll("main.about h2, main.about h3")]
  .map((heading) => ({
    heading,
    target: anchorTarget(heading),
    label: heading.textContent.replace(/\s+/g, " ").trim(),
    level: Number(heading.tagName.slice(1)),
  }))
  .filter(({ target }) => target);

function contentsLink({ target, label }) {
  const link = document.createElement("a");
  link.href = `#${encodeURIComponent(target)}`;
  link.textContent = label;
  return link;
}

function tableOfContents(entries) {
  const details = document.createElement("details");
  details.className = "page-toc";
  const desktop = window.matchMedia("(min-width: 701px)");
  details.open = desktop.matches;

  const summary = document.createElement("summary");
  summary.textContent = "On this page";
  const navigation = document.createElement("nav");
  navigation.setAttribute("aria-label", "On this page");
  const list = document.createElement("ol");
  let currentSection;

  for (const entry of entries) {
    const item = document.createElement("li");
    item.append(contentsLink(entry));
    if (entry.level === 2 || !currentSection) {
      list.append(item);
      currentSection = item;
      continue;
    }
    let children = currentSection.querySelector(":scope > ol");
    if (!children) {
      children = document.createElement("ol");
      currentSection.append(children);
    }
    children.append(item);
  }

  navigation.append(list);
  details.append(summary, navigation);
  details.addEventListener("click", (event) => {
    if (!desktop.matches && event.target.closest?.("a[href^='#']")) details.open = false;
  });
  return details;
}

const main = document.querySelector("main.about");
const firstSection = main?.querySelector(":scope > section[id]");
if (main && firstSection && headings.length) {
  main.insertBefore(tableOfContents(headings), firstSection);
}

for (const { heading, target, label } of headings) {

  const anchor = document.createElement("a");
  anchor.className = "heading-anchor";
  anchor.href = `#${encodeURIComponent(target)}`;
  anchor.setAttribute("aria-label", `Copy link to ${label}`);
  anchor.title = "Copy link to this section";
  anchor.append(linkIcon());
  heading.classList.add("anchored-heading");
  heading.append(anchor);

  let resetTimer;
  anchor.addEventListener("click", async () => {
    const copied = await copyText(anchor.href);
    window.clearTimeout(resetTimer);
    if (!copied) {
      anchor.classList.remove("copied");
      anchor.title = "Could not copy link";
      announce(`Could not copy link to ${label}`);
      resetTimer = window.setTimeout(() => {
        anchor.title = "Copy link to this section";
        status.textContent = "";
      }, CLIPBOARD_RESET_DELAY_MS);
      return;
    }
    anchor.classList.add("copied");
    anchor.title = "Copied!";
    announce(`Copied link to ${label}`);
    resetTimer = window.setTimeout(() => {
      anchor.classList.remove("copied");
      anchor.title = "Copy link to this section";
      status.textContent = "";
    }, CLIPBOARD_RESET_DELAY_MS);
  });
}

// The generated contents sits above every fragment target. Re-apply an initial
// fragment after that insertion so a deep link cannot stop at the target's old
// pre-enhancement position.
if (window.location.hash) {
  window.requestAnimationFrame(() => {
    const fragment = decodeURIComponent(window.location.hash.slice(1));
    document.getElementById(fragment)?.scrollIntoView();
  });
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const RESET_DELAY_MS = 1600;

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

function fallbackCopy(text) {
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

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // The fallback supports browsers that expose but deny the Clipboard API.
    }
  }
  return fallbackCopy(text);
}

function anchorTarget(heading) {
  if (heading.id) return heading.id;
  return heading.closest("section[id]")?.id;
}

const status = document.querySelector("#anchor-status");

function announce(message) {
  status.textContent = "";
  window.requestAnimationFrame(() => {
    status.textContent = message;
  });
}

for (const heading of document.querySelectorAll("main.about h2, main.about h3")) {
  const target = anchorTarget(heading);
  if (!target) continue;

  const label = heading.textContent.replace(/\s+/g, " ").trim();
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
      }, RESET_DELAY_MS);
      return;
    }
    anchor.classList.add("copied");
    anchor.title = "Copied!";
    announce(`Copied link to ${label}`);
    resetTimer = window.setTimeout(() => {
      anchor.classList.remove("copied");
      anchor.title = "Copy link to this section";
    }, RESET_DELAY_MS);
  });
}

const PALOMAR_ID = /^PALOMAR-\d{4}-\d{2}-\d{2}-\d{6}$/;
const VERSION_PARAMETER = /^[1-9][0-9]*$/;

function parsedVersion(value) {
  if (!VERSION_PARAMETER.test(value)) return null;
  const version = Number(value);
  return Number.isSafeInteger(version) ? version : null;
}

/**
 * Open the disclosures that would otherwise hide a fragment target.
 *
 * A section's body is a `details.section-collapse`; its heading is the
 * summary. Opening the target's own section disclosure, or any disclosure
 * ancestor, guarantees the element a fragment link names is visible before the
 * caller scrolls to it. Missing DOM hooks are tolerated so the route stays
 * testable with a stub element.
 */
export function expandDetailsForTarget(target) {
  if (!target) return;
  if (target.tagName === "DETAILS" && !target.open) target.open = true;
  const disclosure = typeof target.querySelector === "function"
    ? target.querySelector("details.section-collapse")
    : null;
  if (disclosure && !disclosure.open) disclosure.open = true;
  for (let node = target; node; node = node.parentElement) {
    if (node.tagName === "DETAILS" && !node.open) node.open = true;
  }
}

/**
 * Orchestrate the entry route around the data loader and page composer.
 *
 * The caller retains those two domain boundaries. This module owns URL input,
 * progressive visibility, immutable-URL replacement, fragment scrolling, and
 * the route's public failure text so those state transitions are testable
 * without importing the whole browser application.
 */
export async function renderEntryPage({
  params,
  document,
  location,
  history,
  loadEntry,
  localPageUrl,
  renderEntry,
  renderExactTombstone,
}) {
  const status = document.querySelector("#status");
  const content = document.querySelector("#entry-content");
  const id = params.get("id");
  const versionParameter = params.get("version");
  const version = versionParameter === null ? null : parsedVersion(versionParameter);
  if (!PALOMAR_ID.test(id || "") || (versionParameter !== null && version === null)) {
    status.textContent = "This registry link has a missing or invalid Palomar ID or version.";
    status.classList.add("error");
    return;
  }
  try {
    const requestedHash = location.hash;
    const loaded = await loadEntry(id, version);
    if (loaded.tombstone) {
      status.hidden = true;
      renderExactTombstone(loaded.tombstone, content);
      return;
    }
    const { entry } = loaded;
    if (version === null) {
      const resolvedUrl = localPageUrl("/entry", entry);
      resolvedUrl.hash = requestedHash;
      history.replaceState(null, "", resolvedUrl);
    }
    await renderEntry(loaded, content);
    status.hidden = true;
    content.hidden = false;
    const anchorTarget = requestedHash.startsWith("#")
      ? document.getElementById(decodeURIComponent(requestedHash.slice(1)))
      : null;
    if (anchorTarget) {
      expandDetailsForTarget(anchorTarget);
      anchorTarget.scrollIntoView();
    }
  } catch (error) {
    content.replaceChildren();
    content.hidden = true;
    status.hidden = false;
    status.textContent = `The registry entry could not be loaded: ${error.message}`;
    status.classList.add("error");
  }
}

/** Orchestrate the dedicated named-declarations route. */
export async function renderChallengePage({
  params,
  document,
  loadEntry,
  renderExactTombstone,
  el,
  challengePresentation,
}) {
  const status = document.querySelector("#status");
  const content = document.querySelector("#render-content");
  const id = params.get("id");
  const versionParameter = params.get("version") || "";
  const version = parsedVersion(versionParameter);
  if (!PALOMAR_ID.test(id || "") || version === null) {
    status.textContent = "This render link is missing a valid Palomar ID and version.";
    status.classList.add("error");
    return;
  }
  try {
    const loaded = await loadEntry(id, version);
    if (loaded.tombstone) {
      status.hidden = true;
      renderExactTombstone(loaded.tombstone, content);
      return;
    }
    const { entry, renderBase, availabilityPromise } = loaded;
    document.title = `Named compared declarations — ${entry.title} — Palomar`;
    const heading = el("header", "entry-heading");
    heading.append(
      el("div", "entry-id", `${entry.id} v${entry.version}`),
      el("h1", "", entry.title),
    );
    const challenge = await challengePresentation(
      entry,
      renderBase,
      { forceFrame: true, availabilityPromise },
    );
    content.append(heading, challenge.section);
    status.hidden = true;
    content.hidden = false;
  } catch (error) {
    status.textContent = `The named compared declarations could not be loaded: ${error.message}`;
    status.classList.add("error");
  }
}

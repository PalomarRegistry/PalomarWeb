import { safeExternalUrl, safeInternalUrl } from "./security.mjs";

const CANONICAL_WEB_BASE = "https://palomar-registry.org/";

/**
 * Bind immutable-version history presentation to the page's DOM and local URL
 * builder. Entry/version validation, route orchestration, and page composition
 * remain with their existing owners; this boundary receives only validated
 * records and version summaries.
 */
export function createEntryHistoryPresentation({ document, localPageUrl, window }) {
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function localLink(text, entry) {
    const node = el("a", "", text);
    node.href = safeInternalUrl(
      localPageUrl("/entry", entry),
      window.location.href,
    ).href;
    return node;
  }

  function canonicalEntryPageUrl(entry) {
    const target = new URL("entry", CANONICAL_WEB_BASE);
    target.searchParams.set("id", entry.id);
    target.searchParams.set("version", String(entry.version));
    return safeExternalUrl(target);
  }

  function setCanonicalEntryPage(entry) {
    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.append(canonical);
    }
    canonical.href = canonicalEntryPageUrl(entry).href;
  }

  function versionNotice(entry, currentVersion) {
    if (entry.version === currentVersion) return null;
    const notice = el("aside", "version-notice");
    const heading = el("h2", "", "Newer version available");
    heading.id = "newer-version-heading";
    notice.setAttribute("aria-labelledby", heading.id);
    notice.append(
      heading,
      el(
        "p",
        "",
        `You are viewing immutable version ${entry.version}. Version ${currentVersion} is the current version of this record.`,
      ),
      localLink(
        `View current version ${currentVersion}`,
        { id: entry.id, version: currentVersion },
      ),
    );
    return notice;
  }

  function versionHistory(entry, versions, currentVersion) {
    const section = el("section", "version-history");
    section.id = "version-history";
    section.setAttribute("aria-labelledby", "version-history-heading");
    const heading = el("div", "section-heading");
    const title = el("div");
    const titleHeading = el("h2", "", "Versions");
    titleHeading.id = "version-history-heading";
    title.append(el("div", "eyebrow", "Registry history"), titleHeading);
    heading.append(title);
    section.append(
      heading,
      el(
        "p",
        "version-history-intro",
        "Every version is an immutable accepted snapshot. The authorship, statement, proof, review comments, and dependency information on this page belong to the selected version only.",
      ),
    );

    const list = el("ol", "version-list");
    list.reversed = true;
    list.setAttribute("role", "list");
    for (const summary of [...versions].reverse()) {
      const item = el("li");
      const label = `Version ${summary.version}`;
      if (summary.version === entry.version) {
        const selected = el("strong", "selected-version", label);
        selected.setAttribute("aria-current", "true");
        item.append(selected);
      } else {
        item.append(localLink(label, summary));
      }
      item.append(
        el(
          "span",
          `version-state ${summary.version === currentVersion ? "current" : "superseded"}`,
          summary.version === currentVersion ? "Current" : "Superseded",
        ),
      );
      if (summary.version === entry.version) {
        item.append(el("span", "viewing-version", "Viewing"));
      }
      list.append(item);
    }
    section.append(list);
    return section;
  }

  return { setCanonicalEntryPage, versionHistory, versionNotice };
}

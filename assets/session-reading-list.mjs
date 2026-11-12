import { pinnedRepositoryDirectoryUrl } from "./security.mjs";

export const READING_LIST_LIMIT = 20;
export const READING_LIST_STORAGE_KEY = "palomar-session-reading-list";

const ID = /^PALOMAR-\d{4}-\d{2}-\d{2}-\d{6}$/;
const PINNED_SOURCE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/tree\/[0-9a-f]{40}(?:\/[A-Za-z0-9._~%-]+)*$/;

/**
 * A session reading list of exact versions already on screen.
 *
 * The list is capped, stored in sessionStorage, and exported as Markdown.
 * It has no account, and it does not fetch a record that is not already in
 * hand. Titles are escaped on the way into Markdown; a source link is emitted
 * only when it is the pinned GitHub tree URL of that version.
 */
export function readingListItem(result) {
  let source = null;
  const repository = result?.source?.repository;
  const commit = result?.source?.commit;
  if (typeof repository === "string" && typeof commit === "string") {
    try {
      source = pinnedRepositoryDirectoryUrl(
        repository,
        commit,
        result.source.project_path || ".",
      ).href;
    } catch {
      source = null;
    }
  }
  return normalizeItem({
    id: result?.id,
    version: result?.version,
    title: result?.title,
    source,
  });
}

export function addReadingListItem(items, result) {
  const current = (Array.isArray(items) ? items : []).map(normalizeItem).filter(Boolean);
  const item = readingListItem(result);
  if (!item?.source) return current.slice(-READING_LIST_LIMIT);
  const key = `${item.id}\0${item.version}`;
  const without = current.filter((existing) => `${existing.id}\0${existing.version}` !== key);
  return [...without, item].slice(-READING_LIST_LIMIT);
}

export function escapeMarkdownText(value) {
  return String(value)
    .replace(/\r\n|\n|\r/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_{}\[\]()#!|]/g, (character) => `\\${character}`);
}

export function readingListMarkdown(items) {
  const lines = [
    "# Palomar reading list",
    "",
    "This list is kept in this browser session only. It is not an account.",
    "",
  ];
  const recorded = (Array.isArray(items) ? items : []).map(normalizeItem).filter(Boolean);
  if (recorded.length === 0) {
    lines.push("No results saved.", "");
    return lines.join("\n");
  }
  for (const item of recorded) {
    lines.push(`- ${item.id} v${item.version}: ${escapeMarkdownText(item.title)}`);
    if (item.source) lines.push(`  - Source: <${item.source}>`);
  }
  lines.push("");
  return lines.join("\n");
}

function normalizeItem(value) {
  if (!value || typeof value !== "object") return null;
  if (!ID.test(value.id || "")) return null;
  if (!Number.isInteger(value.version) || value.version < 1) return null;
  if (typeof value.title !== "string" || value.title.length === 0 || value.title.length > 300) {
    return null;
  }
  if (value.source == null) return { id: value.id, version: value.version, title: value.title, source: null };
  if (typeof value.source !== "string" || !PINNED_SOURCE.test(value.source)) return null;
  return { id: value.id, version: value.version, title: value.title, source: value.source };
}

function openStorage(storage) {
  if (storage && typeof storage.getItem === "function" && typeof storage.setItem === "function") {
    try {
      const probe = `${READING_LIST_STORAGE_KEY}.probe`;
      storage.setItem(probe, "1");
      storage.removeItem(probe);
      return storage;
    } catch {
      // A blocked sessionStorage still leaves a list for this page.
    }
  }
  const memory = new Map();
  return {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: (key) => memory.delete(key),
  };
}

export function createSessionReadingList({ document, storage, window }) {
  const box = openStorage(storage);

  function load() {
    try {
      const parsed = JSON.parse(box.getItem(READING_LIST_STORAGE_KEY) || "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed.map(normalizeItem).filter(Boolean).slice(-READING_LIST_LIMIT);
    } catch {
      return [];
    }
  }

  function save(items) {
    box.setItem(READING_LIST_STORAGE_KEY, JSON.stringify(items));
    return items;
  }

  function add(result) {
    return save(addReadingListItem(load(), result));
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function download(filename, markdown) {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
  }

  function addButton(result) {
    const item = readingListItem(result);
    if (!item?.source) return null;
    const button = el("button", "reading-list-add", "Add to reading list");
    button.type = "button";
    const saved = () => load().some((existing) =>
      existing.id === item.id && existing.version === item.version);
    const paint = () => {
      const pressed = saved();
      button.textContent = pressed ? "Saved for this session" : "Add to reading list";
      button.setAttribute("aria-pressed", pressed ? "true" : "false");
    };
    paint();
    button.addEventListener("click", () => {
      add(result);
      paint();
    });
    return button;
  }

  function exportButton() {
    const button = el("button", "reading-list-export", "Export reading list");
    button.type = "button";
    button.addEventListener("click", () => {
      download("palomar-reading-list.md", readingListMarkdown(load()));
    });
    return button;
  }

  return { add, addButton, exportButton, load, markdown: () => readingListMarkdown(load()) };
}

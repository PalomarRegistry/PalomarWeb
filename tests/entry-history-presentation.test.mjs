import assert from "node:assert/strict";
import test from "node:test";

import { createEntryHistoryPresentation } from "../assets/entry-history-presentation.mjs";

function fakeDocument() {
  function createElement(tag) {
    return {
      attributes: new Map(),
      children: [],
      className: "",
      href: "",
      id: "",
      rel: "",
      reversed: false,
      tagName: tag.toUpperCase(),
      textContent: "",
      append(...children) {
        this.children.push(...children);
      },
      setAttribute(name, value) {
        this.attributes.set(name, value);
      },
    };
  }

  const head = createElement("head");
  return {
    head,
    createElement,
    querySelector(selector) {
      if (selector !== 'link[rel="canonical"]') {
        throw new Error(`unsupported fixture selector: ${selector}`);
      }
      return head.children.find((node) => node.tagName === "LINK" && node.rel === "canonical") ?? null;
    },
  };
}

function descendants(root) {
  const found = [];
  const visit = (value) => {
    if (!value || typeof value !== "object" || !Array.isArray(value.children)) return;
    found.push(value);
    value.children.forEach(visit);
  };
  visit(root);
  return found;
}

function byTag(root, tagName) {
  return descendants(root).filter((node) => node.tagName === tagName.toUpperCase());
}

function byClass(root, className) {
  return descendants(root).filter((node) =>
    String(node.className).split(" ").includes(className));
}

function fullText(root) {
  if (typeof root === "string") return root;
  return [root.textContent, ...root.children.map(fullText)].join("");
}

function localPageUrl(page, entry) {
  const url = new URL(page, "https://fixture.invalid/");
  url.searchParams.set("id", entry.id);
  url.searchParams.set("version", String(entry.version));
  return url;
}

const window = { location: { href: "https://fixture.invalid/entry.html" } };

test("canonical entry links are inserted once and updated for the selected immutable version", () => {
  const document = fakeDocument();
  const { setCanonicalEntryPage } = createEntryHistoryPresentation({
    document,
    localPageUrl,
    window,
  });

  setCanonicalEntryPage({ id: "PALOMAR-2026-08-08-000001", version: 1 });
  setCanonicalEntryPage({ id: "PALOMAR-2026-08-08-000001", version: 2 });

  assert.equal(document.head.children.length, 1);
  assert.equal(document.head.children[0].rel, "canonical");
  assert.equal(
    document.head.children[0].href,
    "https://palomar-registry.org/entry.html?id=PALOMAR-2026-08-08-000001&version=2",
  );
});

test("only a superseded version presents a labelled link to the current version", () => {
  const document = fakeDocument();
  const { versionNotice } = createEntryHistoryPresentation({ document, localPageUrl, window });
  const entry = { id: "PALOMAR-2026-08-08-000001", version: 1 };

  assert.equal(versionNotice(entry, 1), null);
  const notice = versionNotice(entry, 3);

  assert.equal(notice.attributes.get("aria-labelledby"), "newer-version-heading");
  assert.equal(byTag(notice, "h2")[0].id, "newer-version-heading");
  assert.match(fullText(notice), /Version 3 is the current version/);
  assert.equal(byTag(notice, "a")[0].textContent, "View current version 3");
  assert.equal(
    byTag(notice, "a")[0].href,
    "https://fixture.invalid/entry.html?id=PALOMAR-2026-08-08-000001&version=3",
  );
});

test("history links remain confined even if its local URL adapter regresses", () => {
  const presentation = createEntryHistoryPresentation({
    document: fakeDocument(),
    localPageUrl: () => new URL("https://attacker.invalid/entry.html"),
    window,
  });

  assert.throws(
    () => presentation.versionNotice({ id: "PALOMAR-2026-08-08-000001", version: 1 }, 2),
    /internal record link escaped the Palomar origin/,
  );
});

test("history is newest-first, identifies the selected snapshot, and leaves input order intact", () => {
  const document = fakeDocument();
  const { versionHistory } = createEntryHistoryPresentation({ document, localPageUrl, window });
  const id = "PALOMAR-2026-08-08-000001";
  const versions = [1, 2, 3].map((version) => ({ id, version }));
  const original = structuredClone(versions);

  const history = versionHistory({ id, version: 2 }, versions, 3);

  assert.equal(history.id, "version-history");
  assert.equal(history.attributes.get("aria-labelledby"), "version-history-heading");
  assert.equal(byTag(history, "h2")[0].id, "version-history-heading");
  const list = byTag(history, "ol")[0];
  assert.equal(list.reversed, true);
  assert.equal(list.attributes.get("role"), "list");
  assert.deepEqual(byTag(list, "li").map(fullText), [
    "Version 3Current",
    "Version 2SupersededViewing",
    "Version 1Superseded",
  ]);
  assert.deepEqual(byClass(list, "version-state").map((node) => node.textContent), [
    "Current",
    "Superseded",
    "Superseded",
  ]);
  assert.equal(byClass(list, "current").length, 1);
  assert.equal(byClass(list, "superseded").length, 2);
  assert.equal(byClass(list, "viewing-version").length, 1);
  assert.equal(byClass(list, "selected-version")[0].attributes.get("aria-current"), "true");
  assert.deepEqual(byTag(list, "a").map((node) => node.href), [
    `https://fixture.invalid/entry.html?id=${id}&version=3`,
    `https://fixture.invalid/entry.html?id=${id}&version=1`,
  ]);
  assert.deepEqual(versions, original);
});

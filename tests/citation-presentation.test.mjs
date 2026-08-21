import assert from "node:assert/strict";
import test from "node:test";

import {
  bibtexCitation,
  createCitationPresentation,
} from "../assets/citation-presentation.mjs";

function fakeDocument(copyResult) {
  const createElement = (tag) => {
    const node = {
      attributes: new Map(),
      children: [],
      className: "",
      listeners: new Map(),
      tagName: tag.toUpperCase(),
      textContent: "",
      append(...children) {
        for (const child of children) {
          if (child && typeof child === "object") child.parent = this;
          this.children.push(child);
        }
      },
      addEventListener(name, listener) {
        this.listeners.set(name, listener);
      },
      remove() {
        if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
      },
      select() {},
      setAttribute(name, value) {
        this.attributes.set(name, value);
      },
      setSelectionRange() {},
    };
    node.classList = {
      remove(name) {
        node.className = node.className.split(" ").filter((item) => item !== name).join(" ");
      },
      toggle(name, force) {
        this.remove(name);
        if (force) node.className = `${node.className} ${name}`.trim();
      },
    };
    return node;
  };
  const body = createElement("body");
  return {
    activeElement: { focus() {} },
    body,
    createElement,
    execCommand: () => copyResult,
  };
}

function byClass(root, className) {
  if (!root || typeof root !== "object") return null;
  if (root.className?.split(" ").includes(className)) return root;
  for (const child of root.children ?? []) {
    const found = byClass(child, className);
    if (found) return found;
  }
  return null;
}

test("BibTeX citations pin the selected immutable Palomar version", () => {
  const entry = {
    id: "PALOMAR-2026-08-08-000001",
    version: 3,
    registered_at: "2027-01-02T03:04:05Z",
    title: "A result",
    authors: [{ name: "Ada Lovelace" }, { name: "Emmy Noether" }],
  };

  assert.equal(
    bibtexCitation(entry),
    `@misc{palomar-2026-08-08-000001-v3,
  author = {{Ada Lovelace} and {Emmy Noether}},
  title = {{A result}},
  year = {2027},
  howpublished = {Palomar, PALOMAR-2026-08-08-000001 v3},
  url = {https://palomar-registry.org/entry?id=PALOMAR-2026-08-08-000001&version=3},
}`,
  );
});

test("BibTeX citations preserve Unicode and escape TeX-significant record text", () => {
  const citation = bibtexCitation({
    id: "PALOMAR-2026-08-08-000001",
    version: 1,
    registered_at: "2026-08-08T12:00:00Z",
    title: "Erdős & 100% of {cases}_x ~ ^ \\ path\ncontinued",
    authors: [{ name: "Research & Development" }],
  });

  assert.match(citation, /author = \{\{Research \\& Development\}\}/);
  assert.match(
    citation,
    /title = \{\{Erdős \\& 100\\% of \\\{cases\\\}\\_x \\textasciitilde\{\} \\textasciicircum\{\} \\textbackslash\{\} path continued\}\}/,
  );
});

test("citation controls report and reset a failed clipboard fallback", async () => {
  const document = fakeDocument(false);
  let reset;
  const window = {
    clearTimeout() {},
    requestAnimationFrame: (callback) => callback(),
    setTimeout(callback) {
      reset = callback;
      return 1;
    },
  };
  const navigator = { clipboard: { writeText: async () => { throw new Error("denied"); } } };
  const { citationSection } = createCitationPresentation({ document, navigator, window });
  const section = citationSection({
    id: "PALOMAR-2026-08-08-000001",
    version: 1,
    registered_at: "2026-08-08T12:00:00Z",
    title: "A result",
    authors: [{ name: "Example" }],
  });
  const button = byClass(section, "citation-copy");
  const status = byClass(section, "citation-status");
  const block = byClass(section, "citation-bibtex");

  assert.equal(block.tabIndex, 0);
  assert.equal(block.attributes.get("role"), "group");
  await button.listeners.get("click")();
  assert.equal(button.textContent, "Copy failed");
  assert.equal(status.textContent, "Could not copy BibTeX citation.");
  reset();
  assert.equal(button.textContent, "Copy BibTeX");
  assert.equal(status.textContent, "");
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  renderChallengePage,
  renderEntryPage,
} from "../assets/entry-pages.mjs";

function classList() {
  const names = new Set();
  return {
    add: (...values) => values.forEach((value) => names.add(value)),
    contains: (value) => names.has(value),
  };
}

function node({ hidden = false } = {}) {
  return {
    children: [],
    classList: classList(),
    hidden,
    textContent: "",
    append(...children) {
      this.children.push(...children);
    },
  };
}

function pageDocument(contentSelector) {
  const status = node();
  const content = node({ hidden: true });
  const targets = new Map();
  return {
    content,
    document: {
      title: "",
      querySelector(selector) {
        if (selector === "#status") return status;
        if (selector === contentSelector) return content;
        return null;
      },
      getElementById(id) {
        return targets.get(id) || null;
      },
    },
    status,
    targets,
  };
}

function entryDependencies(overrides = {}) {
  const view = pageDocument("#entry-content");
  return {
    view,
    settings: {
      params: new URLSearchParams("id=PALOMAR-2026-08-08-000001&version=2"),
      document: view.document,
      location: { hash: "" },
      history: { replaceState() {} },
      loadEntry: async () => ({ tombstone: {} }),
      localPageUrl: () => new URL("https://palomar-registry.org/entry.html"),
      renderEntry: async () => {},
      renderExactTombstone: () => {},
      ...overrides,
    },
  };
}

test("entry routes reject noncanonical parameters before loading data", async () => {
  let loads = 0;
  const { settings, view } = entryDependencies({
    params: new URLSearchParams("id=PALOMAR-2026-08-08-000001&version=2.0"),
    loadEntry: async () => {
      loads += 1;
    },
  });

  await renderEntryPage(settings);

  assert.equal(loads, 0);
  assert.equal(view.status.textContent, "This registry link has a missing or invalid Palomar ID or version.");
  assert.equal(view.status.classList.contains("error"), true);
  assert.equal(view.content.hidden, true);
});

test("unversioned entry routes expose content progressively then preserve and scroll the fragment", async () => {
  const entry = { id: "PALOMAR-2026-08-08-000001", version: 3 };
  const loaded = {
    entry,
    canonicalUrl: new URL("https://data.example/entry.json"),
    renderBase: new URL("https://render.example/"),
    versions: [{ version: 3 }],
    currentVersion: 3,
    availability: { repositories: [] },
    databaseBase: new URL("https://data.example/"),
  };
  let releaseRender;
  let renderStarted;
  const rendering = new Promise((resolve) => {
    releaseRender = resolve;
  });
  const started = new Promise((resolve) => {
    renderStarted = resolve;
  });
  let replaced = null;
  let scrolled = 0;
  let renderedArguments = null;
  const { settings, view } = entryDependencies({
    params: new URLSearchParams(`id=${entry.id}`),
    location: { hash: "#version-history" },
    history: {
      replaceState(state, title, url) {
        replaced = { state, title, url };
      },
    },
    loadEntry: async (id, version) => {
      assert.equal(id, entry.id);
      assert.equal(version, null);
      return loaded;
    },
    localPageUrl: (page, selected) => {
      assert.equal(page, "entry.html");
      assert.equal(selected, entry);
      return new URL(`https://palomar-registry.org/entry.html?id=${entry.id}&version=3`);
    },
    renderEntry: async (...args) => {
      renderedArguments = args;
      renderStarted();
      await rendering;
    },
  });
  view.targets.set("version-history", { scrollIntoView: () => { scrolled += 1; } });

  const route = renderEntryPage(settings);
  await started;
  assert.equal(view.status.hidden, true);
  assert.equal(view.content.hidden, false);
  assert.equal(scrolled, 0);
  releaseRender();
  await route;

  assert.deepEqual(renderedArguments, [loaded, view.content]);
  assert.equal(replaced.state, null);
  assert.equal(replaced.title, "");
  assert.equal(replaced.url.href, `https://palomar-registry.org/entry.html?id=${entry.id}&version=3#version-history`);
  assert.equal(scrolled, 1);
});

test("entry routes preserve exact tombstones and load failures", async (t) => {
  await t.test("exact tombstone", async () => {
    const tombstone = { id: "PALOMAR-2026-08-08-000001", version: 2 };
    let rendered = null;
    const { settings, view } = entryDependencies({
      loadEntry: async () => ({ tombstone }),
      renderExactTombstone: (...args) => {
        rendered = args;
      },
    });

    await renderEntryPage(settings);

    assert.deepEqual(rendered, [tombstone, view.content]);
    assert.equal(view.status.hidden, true);
  });

  await t.test("load failure", async () => {
    const { settings, view } = entryDependencies({
      loadEntry: async () => {
        throw new Error("503 Unavailable");
      },
    });

    await renderEntryPage(settings);

    assert.equal(view.status.textContent, "The registry entry could not be loaded: 503 Unavailable");
    assert.equal(view.status.classList.contains("error"), true);
    assert.equal(view.content.hidden, true);
  });
});

test("named-declaration routes validate before loading and reveal only completed views", async () => {
  const invalid = pageDocument("#render-content");
  let loads = 0;
  await renderChallengePage({
    params: new URLSearchParams("id=PALOMAR-2026-08-08-000001&version=02"),
    document: invalid.document,
    loadEntry: async () => { loads += 1; },
  });
  assert.equal(loads, 0);
  assert.equal(invalid.status.textContent, "This render link is missing a valid Palomar ID and version.");
  assert.equal(invalid.content.hidden, true);

  const view = pageDocument("#render-content");
  const entry = { id: "PALOMAR-2026-08-08-000001", version: 2, title: "A result" };
  const section = node();
  let releaseChallenge;
  let challengeStarted;
  const challenging = new Promise((resolve) => { releaseChallenge = resolve; });
  const started = new Promise((resolve) => { challengeStarted = resolve; });
  const route = renderChallengePage({
    params: new URLSearchParams(`id=${entry.id}&version=2`),
    document: view.document,
    loadEntry: async () => ({
      entry,
      renderBase: new URL("https://render.example/"),
      availability: { repositories: [] },
    }),
    renderExactTombstone: () => assert.fail("unexpected tombstone"),
    el: (tag, className, text = "") => ({ ...node(), tag, className, textContent: text }),
    challengePresentation: async (selected, renderBase, options) => {
      assert.equal(selected, entry);
      assert.equal(renderBase.href, "https://render.example/");
      assert.deepEqual(options, { forceFrame: true, availability: { repositories: [] } });
      challengeStarted();
      await challenging;
      return { section };
    },
  });

  await started;
  assert.equal(view.status.hidden, false);
  assert.equal(view.content.hidden, true);
  releaseChallenge();
  await route;

  assert.equal(view.document.title, "Named compared declarations — A result — Palomar");
  assert.equal(view.status.hidden, true);
  assert.equal(view.content.hidden, false);
  assert.equal(view.content.children.length, 2);
  assert.equal(view.content.children[1], section);
});

test("named-declaration routes use the shared exact-tombstone presentation", async () => {
  const view = pageDocument("#render-content");
  const tombstone = { id: "PALOMAR-2026-08-08-000001", version: 2 };
  let rendered = null;

  await renderChallengePage({
    params: new URLSearchParams(`id=${tombstone.id}&version=2`),
    document: view.document,
    loadEntry: async () => ({ tombstone }),
    renderExactTombstone: (...args) => { rendered = args; },
  });

  assert.deepEqual(rendered, [tombstone, view.content]);
  assert.equal(view.status.hidden, true);
});

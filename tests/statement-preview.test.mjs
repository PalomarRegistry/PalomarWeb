import assert from "node:assert/strict";
import test from "node:test";

import { createStatementPreview } from "../assets/statement-preview.mjs";
import {
  recentRenderRow,
  validateEntry,
  validateRecentRenders,
} from "../assets/security.mjs";
import {
  DIGEST,
  entry,
  recentRenders,
  recentRow,
  renderRow,
  summary,
} from "./registry-fixture.mjs";

const DATABASE = "http://127.0.0.1:4173/database/";
const OPEN_MS = 350;
const CLOSE_MS = 200;

/**
 * A pointer, a clock, and enough of a document to hang a panel off.
 *
 * Small on purpose. What is under test is when a panel appears, which one it
 * frames, and what is torn down afterwards, and none of that needs layout.
 */
function fakeBrowser({ hover = true } = {}) {
  let now = 0;
  let sequence = 0;
  const timers = new Map();
  const windowListeners = new Map();

  function createElement(tag) {
    const node = {
      attributes: new Map(),
      children: [],
      className: "",
      dataset: {},
      href: "",
      isConnected: false,
      listeners: new Map(),
      parent: null,
      style: {},
      tagName: tag.toUpperCase(),
      textContent: "",
      contentWindow: tag === "iframe" ? {} : undefined,
      offsetHeight: 200,
      offsetWidth: 400,
      append(...children) {
        for (const child of children) {
          child.parent = node;
          child.isConnected = true;
          node.children.push(child);
        }
      },
      remove() {
        if (node.parent) {
          node.parent.children = node.parent.children.filter((item) => item !== node);
        }
        node.parent = null;
        node.isConnected = false;
      },
      setAttribute(name, value) {
        node.attributes.set(name, String(value));
      },
      getAttribute(name) {
        return node.attributes.get(name) ?? null;
      },
      addEventListener(name, listener) {
        node.listeners.set(name, [...(node.listeners.get(name) || []), listener]);
      },
      removeEventListener(name, listener) {
        node.listeners.set(
          name,
          (node.listeners.get(name) || []).filter((item) => item !== listener),
        );
      },
      emit(name, event = {}) {
        for (const listener of node.listeners.get(name) || []) listener(event);
      },
      closest(selector) {
        return node.matches === selector ? node : null;
      },
      contains(other) {
        return other === node;
      },
      getBoundingClientRect() {
        return { top: 100, bottom: 120, left: 40, right: 300 };
      },
    };
    return node;
  }

  const body = createElement("div");
  body.isConnected = true;

  return {
    body,
    createElement,
    now: () => now,
    document: { createElement, body },
    window: {
      innerHeight: 800,
      innerWidth: 1200,
      location: { href: "http://127.0.0.1:4173/" },
      matchMedia: (query) => ({ matches: hover && query === "(hover: hover)" }),
      setTimeout(callback, delay) {
        const id = (sequence += 1);
        timers.set(id, { at: now + delay, callback });
        return id;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
      addEventListener(name, listener) {
        windowListeners.set(name, [...(windowListeners.get(name) || []), listener]);
      },
      removeEventListener(name, listener) {
        windowListeners.set(
          name,
          (windowListeners.get(name) || []).filter((item) => item !== listener),
        );
      },
    },
    windowListeners,
    /** Advance the clock, then let anything the timers started settle. */
    async tick(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.callback();
        }
      }
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

function titleLink(browser) {
  const link = browser.createElement("a");
  link.matches = "h3 > a";
  link.isConnected = true;
  return link;
}

function build(browser, { renders = recentRenders(), warn = () => {} } = {}) {
  let reads = 0;
  const preview = createStatementPreview({
    document: browser.document,
    window: browser.window,
    dataSource: () => ({ databaseBase: DATABASE, renderBase: DATABASE }),
    loadRecentRenders: async () => {
      reads += 1;
      return renders === null ? null : validateRecentRenders(renders);
    },
    warn,
  });
  const grid = browser.createElement("div");
  preview.watch(grid);
  return { preview, grid, reads: () => reads };
}

function panels(browser) {
  return browser.body.children.filter((node) =>
    String(node.className).split(" ").includes("statement-preview"));
}

function frameOf(browser) {
  return panels(browser)[0]?.children.find((node) => node.tagName === "IFRAME");
}

test("a rest on a landing title frames that result's published rendering", async () => {
  const browser = fakeBrowser();
  const { preview, grid } = build(browser);
  const link = titleLink(browser);
  preview.register(link, recentRow());

  grid.emit("mouseover", { target: link });
  assert.equal(panels(browser).length, 0, "nothing opens before the rest is one");

  await browser.tick(OPEN_MS);

  const frame = frameOf(browser);
  assert.equal(
    frame.src,
    `${DATABASE}renders/PALOMAR-2026-07-29-000123-v1/${DIGEST}/Challenge/index.html`,
  );
  // Scripts, because the rendering is one; nothing else, because it is not this
  // page's.
  assert.equal(frame.getAttribute("sandbox"), "allow-scripts");
  assert.equal(frame.referrerPolicy, "no-referrer");
});

test("a search result carries its own render metadata and needs no companion read", async () => {
  const browser = fakeBrowser();
  const { preview, grid, reads } = build(browser);
  const link = titleLink(browser);
  preview.register(link, validateEntry(entry(), summary()));

  grid.emit("mouseover", { target: link });
  await browser.tick(OPEN_MS);

  assert.equal(reads(), 0, "a whole record already says where its rendering is");
  assert.match(frameOf(browser).src, /Challenge\/index\.html$/);
});

test("moving to another title replaces the panel rather than adding one", async () => {
  const browser = fakeBrowser();
  const second = { ...renderRow(), id: "PALOMAR-2026-07-29-000124" };
  const { preview, grid } = build(browser, {
    renders: recentRenders([renderRow(), second]),
  });
  const first = titleLink(browser);
  const other = titleLink(browser);
  preview.register(first, recentRow());
  preview.register(other, recentRow({ id: second.id }));

  grid.emit("mouseover", { target: first });
  await browser.tick(OPEN_MS);
  grid.emit("mouseout", { target: first, relatedTarget: null });
  grid.emit("mouseover", { target: other });
  await browser.tick(OPEN_MS);

  assert.equal(panels(browser).length, 1, "one panel, and one frame, at a time");
  assert.match(frameOf(browser).src, new RegExp(`${second.id}-v1`));
  assert.equal(browser.windowListeners.get("message").length, 1);
});

test("leaving the title closes the panel, and crossing into it does not", async () => {
  const browser = fakeBrowser();
  const { preview, grid } = build(browser);
  const link = titleLink(browser);
  preview.register(link, recentRow());

  grid.emit("mouseover", { target: link });
  await browser.tick(OPEN_MS);
  const panel = panels(browser)[0];

  grid.emit("mouseout", { target: link, relatedTarget: null });
  panel.emit("mouseenter");
  await browser.tick(CLOSE_MS);
  assert.equal(panels(browser).length, 1, "the pointer reached the panel in time");

  panel.emit("mouseleave");
  await browser.tick(CLOSE_MS);
  assert.equal(panels(browser).length, 0);
});

test("passing over a title opens nothing and starts no read", async () => {
  const browser = fakeBrowser();
  const { preview, grid, reads } = build(browser);
  const link = titleLink(browser);
  preview.register(link, recentRow());

  grid.emit("mouseover", { target: link });
  await browser.tick(OPEN_MS - 1);
  grid.emit("mouseout", { target: link, relatedTarget: null });
  await browser.tick(OPEN_MS);

  assert.equal(panels(browser).length, 0);
  assert.equal(reads(), 0);
});

test("a panel above its title is placed again on the height the render reports", async () => {
  const browser = fakeBrowser();
  const { preview, grid } = build(browser);
  const link = titleLink(browser);
  preview.register(link, recentRow());
  // A title low enough that the roomier side is above it, so a panel that grew
  // after placement would grow back down over the title.
  link.getBoundingClientRect = () => ({ top: 700, bottom: 720, left: 40, right: 300 });

  grid.emit("mouseover", { target: link });
  await browser.tick(OPEN_MS);
  const panel = panels(browser)[0];
  assert.equal(panel.style.top, `${700 - 8 - 200}px`);

  panel.offsetHeight = 400;
  for (const listener of browser.windowListeners.get("message")) {
    listener({ source: frameOf(browser).contentWindow, data: { type: "palomar-render-height", height: 500 } });
  }

  assert.equal(panel.style.top, `${700 - 8 - 400}px`, "replaced against the reported height");
  assert.equal(frameOf(browser).style.height, "420px", "and clamped to the preview's bound");
});

test("a closed panel leaves nothing subscribed to the height channel", async () => {
  const browser = fakeBrowser();
  const { preview, grid } = build(browser);
  const link = titleLink(browser);
  preview.register(link, recentRow());

  grid.emit("mouseover", { target: link });
  await browser.tick(OPEN_MS);
  assert.equal(browser.windowListeners.get("message").length, 1);

  preview.close();

  assert.equal(
    browser.windowListeners.get("message").length,
    0,
    "the listener is on the window, so the frame going away does not remove it",
  );
  assert.equal(panels(browser).length, 0);
});

test("a rest superseded while its reads are in flight does not open behind the reader", async () => {
  const browser = fakeBrowser();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const preview = createStatementPreview({
    document: browser.document,
    window: browser.window,
    dataSource: () => ({ databaseBase: DATABASE, renderBase: DATABASE }),
    loadRecentRenders: async () => {
      await gate;
      return validateRecentRenders(recentRenders());
    },
  });
  const grid = browser.createElement("div");
  preview.watch(grid);
  const link = titleLink(browser);
  preview.register(link, recentRow());

  grid.emit("mouseover", { target: link });
  await browser.tick(OPEN_MS);
  grid.emit("mouseout", { target: link, relatedTarget: null });
  await browser.tick(CLOSE_MS);
  release();
  await browser.tick(0);

  assert.equal(panels(browser).length, 0);
});

test("a card the grid has redrawn under raises nothing", async () => {
  const browser = fakeBrowser();
  const { preview, grid } = build(browser);
  const link = titleLink(browser);
  preview.register(link, recentRow());

  grid.emit("mouseover", { target: link });
  link.isConnected = false;
  await browser.tick(OPEN_MS);

  assert.equal(panels(browser).length, 0);
});

test("an absent or unusable companion document leaves the listing alone", async (t) => {
  for (const [name, renders, reason] of [
    ["absent", null, null],
    ["naming no such result", recentRenders([renderRow({ id: "PALOMAR-2026-07-29-000999" })]), null],
    ["naming another version", recentRenders([renderRow({ version: 7 })]), null],
    ["malformed", { schema_version: 2, renders: [{ id: "nope" }] }, /invalid registry data/],
  ]) {
    await t.test(name, async () => {
      const browser = fakeBrowser();
      const warnings = [];
      const { preview, grid } = build(browser, {
        renders,
        warn: (message) => warnings.push(message),
      });
      const link = titleLink(browser);
      preview.register(link, recentRow());

      grid.emit("mouseover", { target: link });
      await browser.tick(OPEN_MS);

      assert.equal(panels(browser).length, 0);
      if (reason) assert.match(warnings.join("\n"), reason);
      else assert.deepEqual(warnings, []);
    });
  }
});

test("without a pointer that can rest, nothing is registered or bound", async () => {
  const browser = fakeBrowser({ hover: false });
  const { preview, grid } = build(browser);
  const link = titleLink(browser);
  preview.register(link, recentRow());

  grid.emit("mouseover", { target: link });
  await browser.tick(OPEN_MS);

  assert.equal(panels(browser).length, 0);
  assert.deepEqual(grid.listeners.get("mouseover"), undefined);
});

test("a lookup refuses a companion document that was never validated", () => {
  const raw = recentRenders();
  assert.throws(() => recentRenderRow(raw, raw.renders[0].id), /was not validated/);
  const accepted = validateRecentRenders(recentRenders());
  assert.equal(recentRenderRow(accepted, "PALOMAR-2026-07-29-000123").version, 1);
  assert.equal(recentRenderRow(accepted, "PALOMAR-2026-07-29-000999"), null);
});

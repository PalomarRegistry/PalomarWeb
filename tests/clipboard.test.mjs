import assert from "node:assert/strict";
import test from "node:test";

import { createClipboard } from "../assets/clipboard.mjs";

test("clipboard announcements clear before repeating the same message", () => {
  const frames = [];
  const status = { textContent: "Copied" };
  const { announce } = createClipboard({
    document: {},
    navigator: {},
    window: { requestAnimationFrame: (callback) => frames.push(callback) },
  });

  announce(status, "Copied");
  assert.equal(status.textContent, "");
  frames.shift()();
  assert.equal(status.textContent, "Copied");
  announce(status, "Copied");
  assert.equal(status.textContent, "");
  frames.shift()();
  assert.equal(status.textContent, "Copied");
});

test("denied Clipboard API access falls back without taking focus", async () => {
  let fallback;
  let restored = false;
  const body = {
    append(node) {
      fallback = node;
    },
  };
  const document = {
    activeElement: { focus: () => { restored = true; } },
    body,
    createElement() {
      return {
        remove() {},
        select() {},
        setSelectionRange() {},
      };
    },
    execCommand(command) {
      assert.equal(command, "copy");
      return true;
    },
  };
  const navigator = { clipboard: { writeText: async () => { throw new Error("denied"); } } };
  const { copyText } = createClipboard({ document, navigator, window: {} });

  assert.equal(await copyText("citation"), true);
  assert.equal(fallback.value, "citation");
  assert.equal(fallback.readOnly, true);
  assert.equal(restored, true);
});

test("clipboard fallback restores the reader's selected text without scrolling", async () => {
  const original = { cloneRange() { return this; } };
  let selected = original;
  const selection = {
    rangeCount: 1,
    getRangeAt: () => original,
    removeAllRanges() { selected = null; },
    addRange(range) { selected = range; },
  };
  let focusOptions;
  const document = {
    activeElement: { focus(options) { focusOptions = options; } },
    body: { append() {} },
    createElement: () => ({
      select() { selected = null; }, setSelectionRange() {}, remove() {},
    }),
    execCommand: () => true,
  };
  const clipboard = createClipboard({ document, navigator: {}, window: { getSelection: () => selection } });
  assert.equal(await clipboard.copyText("citation"), true);
  assert.equal(selected, original);
  assert.deepEqual(focusOptions, { preventScroll: true });
});

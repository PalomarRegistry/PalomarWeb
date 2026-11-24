import assert from "node:assert/strict";
import test from "node:test";

import { resultsStatusText } from "../assets/registry-page.mjs";

test("a page with nothing dropped reads as the registry left it", () => {
  assert.equal(
    resultsStatusText({ entries: [{}, {}], next: "cursor", message: null, dropped: [] }),
    "Showing 2 results; more results are available.",
  );
  assert.equal(
    resultsStatusText({ entries: [], next: null, message: "Nothing under that subject.", dropped: [] }),
    "Nothing under that subject.",
  );
});

test("dropped query words are named instead of disappearing", () => {
  assert.equal(
    resultsStatusText({ entries: [{}], next: null, message: null, dropped: ["the"] }),
    'Showing 1 result. This word was not searched: "the".',
  );
  assert.equal(
    resultsStatusText({
      entries: [],
      next: null,
      message: null,
      dropped: ["of", "a"],
    }),
    'No registry entries match these search terms and filters. These words were not searched: "of", "a".',
  );
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  READING_LIST_LIMIT,
  READING_LIST_STORAGE_KEY,
  addReadingListItem,
  createSessionReadingList,
  readingListMarkdown,
} from "../assets/session-reading-list.mjs";
import { COMMIT, recentRow } from "./registry-fixture.mjs";

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

function result(serial, extras = {}) {
  return {
    id: `PALOMAR-2026-07-29-${String(serial).padStart(6, "0")}`,
    version: 1,
    title: `Result ${serial}`,
    source: { repository: "example/challenge", commit: COMMIT },
    ...extras,
  };
}

test("the session list keeps twenty exact versions and escapes titles", () => {
  let items = [];
  for (let serial = 1; serial <= READING_LIST_LIMIT + 1; serial += 1) {
    items = addReadingListItem(items, result(serial));
  }
  assert.equal(items.length, READING_LIST_LIMIT);
  assert.equal(items[0].id, "PALOMAR-2026-07-29-000002");
  assert.equal(items.at(-1).id, "PALOMAR-2026-07-29-000021");

  const again = addReadingListItem(items, result(2, { title: "Result 2" }));
  assert.equal(again.length, READING_LIST_LIMIT);
  assert.equal(again.at(-1).id, "PALOMAR-2026-07-29-000002");

  const separateVersion = addReadingListItem(
    [],
    result(1, { version: 2, title: "Second snapshot" }),
  );
  assert.equal(separateVersion[0].version, 2);
  assert.equal(
    separateVersion[0].source,
    `https://github.com/example/challenge/tree/${COMMIT}`,
  );

  const markdown = readingListMarkdown([{
    id: "PALOMAR-2026-07-29-000123",
    version: 2,
    title: "A <script>alert(1)</script> [click](https://evil.example)",
    source: `https://github.com/example/challenge/tree/${COMMIT}`,
  }, {
    id: "PALOMAR-2026-07-29-000124",
    version: 1,
    title: "Kept",
    source: "javascript:alert(1)",
  }]);
  assert.match(markdown, /PALOMAR-2026-07-29-000123 v2/);
  assert.match(markdown, /&lt;script&gt;alert\\\(1\\\)&lt;\/script&gt;/);
  assert.match(markdown, /\\\[click\\\]\\\(https:\/\/evil\.example\\\)/);
  assert.doesNotMatch(markdown, /<script>/);
  assert.doesNotMatch(markdown, /\[click\]\(https:\/\/evil\.example\)/);
  assert.match(markdown, new RegExp(`<https://github.com/example/challenge/tree/${COMMIT}>`));
  assert.doesNotMatch(markdown, /javascript:/);
  assert.match(markdown, /not an account/);
});

test("the list persists in sessionStorage and does not fetch the registry", async () => {
  const storage = memoryStorage();
  const first = createSessionReadingList({ storage });
  const saved = first.add(recentRow());
  assert.equal(saved.length, 1);
  assert.equal(saved[0].title, "Fixture theorem");

  const second = createSessionReadingList({ storage });
  assert.deepEqual(second.load(), saved);
  assert.equal(storage.getItem(READING_LIST_STORAGE_KEY) !== null, true);

  storage.setItem(READING_LIST_STORAGE_KEY, "{");
  assert.deepEqual(second.load(), []);

  const source = await readFile(new URL("../assets/session-reading-list.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /data\.palomar-registry\.org/);
});

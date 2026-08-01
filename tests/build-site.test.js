import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildSite } from "../scripts/build-site.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

test("deployment build versions coupled browser assets", async () => {
  const output = `.site-test-${process.pid}`;
  const destination = path.join(root, output);
  try {
    await buildSite({ output, version: "0123456789abcdef" });
    const index = await readFile(path.join(destination, "index.html"), "utf8");
    const faq = await readFile(path.join(destination, "faq.html"), "utf8");
    const app = await readFile(path.join(destination, "assets", "app.js"), "utf8");
    assert.match(index, /assets\/style\.css\?v=0123456789abcdef/);
    assert.match(index, /assets\/app\.js\?v=0123456789abcdef/);
    assert.match(faq, /assets\/style\.css\?v=0123456789abcdef/);
    assert.match(app, /\.\/rendering\.js\?v=0123456789abcdef/);
    assert.match(app, /\.\/security\.mjs\?v=0123456789abcdef/);
    await readFile(path.join(destination, "assets", "security.mjs"), "utf8");
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
});

test("deployment build refuses to remove a directory outside the repository", async () => {
  await assert.rejects(
    buildSite({ output: "../outside", version: "test" }),
    /output must be \.site or a \.site-test-/,
  );
  await assert.rejects(
    buildSite({ output: ".git", version: "test" }),
    /output must be \.site or a \.site-test-/,
  );
});

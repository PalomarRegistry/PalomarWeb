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
    const about = await readFile(path.join(destination, "about.html"), "utf8");
    const app = await readFile(path.join(destination, "assets", "app.js"), "utf8");
    assert.match(index, /assets\/style\.css\?v=0123456789abcdef/);
    assert.match(index, /assets\/app\.js\?v=0123456789abcdef/);
    assert.match(about, /assets\/style\.css\?v=0123456789abcdef/);
    assert.match(about, /assets\/about\.js\?v=0123456789abcdef/);
    await readFile(path.join(destination, "assets", "about.js"), "utf8");
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

test("the MSC descriptions shown to readers are readable", async () => {
  // Vendored from PalomarSubmission, which validates against it. A '?' inside
  // a description is a character that did not survive an encoding step, not
  // punctuation: the first record in the registry is classified 52C10, whose
  // description names Erdős.
  const codes = JSON.parse(
    await readFile(new URL("../assets/data/msc2020-codes.json", import.meta.url), "utf8"),
  );
  const broken = Object.entries(codes).filter(([, text]) => text.includes("?"));
  assert.deepEqual(broken, []);
  assert.equal(codes["52C10"], "Erdős problems and related topics of discrete geometry");
});

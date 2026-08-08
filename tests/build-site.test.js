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
    assert.match(app, /\.\/loading\.mjs\?v=0123456789abcdef/);
    assert.match(app, /\.\/searching\.mjs\?v=0123456789abcdef/);
    await readFile(path.join(destination, "assets", "loading.mjs"), "utf8");
    await readFile(path.join(destination, "assets", "searching.mjs"), "utf8");
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

test("app.js writes down no data origin the database override cannot redirect", async () => {
  // `?database=` names the endpoint every read surface is resolved against, so
  // a fixture directory can stand in for the live service. A data URL spelled
  // out as a literal in app.js is outside that arrangement by construction.
  // `FEED_BASE` and the `categoryFeedBase()` that read it were the last of
  // those: they outlived the category feed links, which were removed when
  // every one of them answered 404, and went on naming a `feeds/` directory
  // that nothing fetched and no reader could reach. The canonical web origin
  // is a different thing and stays, because an entry's canonical link has to
  // point at the official URL even when the page is being read from a fixture.
  const app = await readFile(new URL("../assets/app.js", import.meta.url), "utf8");
  assert.equal(
    app.includes("data.palomar-registry.org"),
    false,
    "app.js names the data origin directly instead of resolving against the chosen endpoint",
  );
  assert.match(app, /const CANONICAL_WEB_BASE = "https:\/\/palomar-registry\.org\/";/);
});

test("everything the pages fetch at runtime is actually shipped", async () => {
  // The MSC table was added under assets/data/ and never added to the build's
  // copy list, so it was absent from the deployed site while the hover that
  // needs it failed silently by design. Anything the site fetches from its own
  // origin has to be in the artifact.
  const output = ".site-test-shipped";
  await buildSite({ output, version: "test" });
  try {
    const app = await readFile(path.join(output, "assets", "app.js"), "utf8");
    const referenced = [...app.matchAll(/new URL\("(assets\/[^"]+)"/g)].map((m) => m[1]);
    assert.ok(referenced.length, "no same-origin asset URLs were found in app.js");
    for (const asset of new Set(referenced)) {
      await readFile(path.join(output, asset));
    }
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

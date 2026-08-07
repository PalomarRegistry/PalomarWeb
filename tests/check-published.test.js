import assert from "node:assert/strict";
import test from "node:test";

import { publishState, publishedVersion } from "../scripts/check-published.mjs";

const sha = "b500f02dec58268ea22de28332f63136dac092d9";
const page = (version) =>
  `<html><head><script type="module" src="assets/app.js?v=${version}"></script></head></html>`;

test("a page built from the expected commit is fresh", () => {
  const state = publishState(page(sha), sha);
  assert.equal(state.fresh, true);
  assert.equal(state.published, sha);
});

test("a page built from anything else is stale, and says both commits", () => {
  // The real case: the site served 085e7aa1 for seven hours while main was
  // b500f02d, and every workflow that mattered was green.
  const state = publishState(page("085e7aa1e81c1309aaf40f1053841d7116b9c1c2"), sha);
  assert.equal(state.fresh, false);
  assert.match(state.reason, /085e7aa1e81c/);
  assert.match(state.reason, /b500f02dec58/);
});

test("a page with no stamp is not given the benefit of the doubt", () => {
  // Either older than stamping, or not the page we think we are looking at.
  const state = publishState("<html><head></head></html>", sha);
  assert.equal(state.fresh, false);
  assert.equal(state.published, null);
  assert.match(state.reason, /no build stamp/);
});

test("the stamp is read from the asset URL the build actually writes", async () => {
  const { buildSite } = await import("../scripts/build-site.mjs");
  const { readFile, rm } = await import("node:fs/promises");
  const output = ".site-test-stamp";
  await buildSite({ output, version: sha });
  try {
    const html = await readFile(`${output}/index.html`, "utf8");
    assert.equal(publishedVersion(html), sha);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

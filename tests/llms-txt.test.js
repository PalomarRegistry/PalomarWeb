import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { monitoredLinkedDocuments } from "../scripts/check-published.mjs";
import { shippedFiles } from "../scripts/build-site.mjs";

test("llms.txt is shipped and is a short machine map, not a scrape of the pages", async () => {
  assert.ok(shippedFiles.includes("llms.txt"), "llms.txt is absent from the deployment copy list");
  const text = await readFile(new URL("../llms.txt", import.meta.url), "utf8");
  assert.match(text, /^# Palomar\n/);
  assert.match(text, /This site is the human explorer/);
  assert.match(text, /Do not drive the browser form or GitHub OAuth/);
  assert.match(text, /https:\/\/submit\.palomar-registry\.org\/llms\.txt/);
  assert.match(text, /https:\/\/data\.palomar-registry\.org\/recent\.json/);
  assert.match(text, /GET \/api\/submission/);
  assert.match(text, /registered_url/);
  // Templates are path grammar. Written as origin URLs they would be sent to
  // the published-site link check and fail it: that check is what used to
  // leave seven 404s to /index.json unnoticed.
  assert.doesNotMatch(text, /https:\/\/data\.palomar-registry\.org\/versions\//);
  assert.doesNotMatch(text, /https:\/\/data\.palomar-registry\.org\/entries\//);
  assert.doesNotMatch(text, /https:\/\/data\.palomar-registry\.org\/repositories\//);
  assert.doesNotMatch(text, /https:\/\/data\.palomar-registry\.org\/subjects\//);
  assert.doesNotMatch(text, /https:\/\/data\.palomar-registry\.org\/search\/t\//);
  assert.doesNotMatch(text, /https:\/\/data\.palomar-registry\.org\/registration-identities\//);
});

test("llms.txt names only registry documents the link checker can HEAD", async () => {
  const text = await readFile(new URL("../llms.txt", import.meta.url), "utf8");
  const documents = monitoredLinkedDocuments([["llms.txt", text]]);
  const hrefs = [...documents.keys()].sort();
  assert.deepEqual(hrefs, [
    "https://data.palomar-registry.org/LICENSE",
    "https://data.palomar-registry.org/browse/index.json",
    "https://data.palomar-registry.org/feed.xml",
    "https://data.palomar-registry.org/recent.json",
    "https://data.palomar-registry.org/schema-v3.json",
    "https://data.palomar-registry.org/search/stopwords.json",
    "https://github.com/PalomarRegistry/PalomarPolicy/blob/main/CONTRIBUTING.md",
  ]);
});

test("How to submit points machines at this origin's llms.txt", async () => {
  const guide = await readFile(new URL("../how-to-submit.html", import.meta.url), "utf8");
  assert.match(guide, /href="\/llms\.txt"/);
  assert.match(guide, /https:\/\/submit\.palomar-registry\.org\/llms\.txt/);
  assert.match(guide, /Machines should not drive the form/);
});

test("the landing page advertises llms.txt to clients that look for alternates", async () => {
  const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(
    index,
    /<link rel="alternate" type="text\/plain" title="llms\.txt" href="\/llms\.txt">/,
  );
});

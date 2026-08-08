import assert from "node:assert/strict";
import test from "node:test";

import {
  publicDataState,
  publishState,
  publishedVersion,
} from "../scripts/check-published.mjs";

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

test("live-data health traverses browse and history to validate every public permalink", async () => {
  const calls = [];
  const first = {
    id: "PALOMAR-2026-08-08-000001",
    version: 1,
    title: "One",
    status: "accepted",
    path: "entries/PALOMAR-2026-08-08-000001-v1.json",
  };
  const second = {
    ...first,
    version: 2,
    title: "Two",
    path: "entries/PALOMAR-2026-08-08-000001-v2.json",
  };
  const responses = new Map([
    ["https://data.example/recent.json", { entries: [{ ...second, versions: 2 }] }],
    ["https://data.example/browse/index.json", {
      results: 1,
      versions: 2,
      years: [{ year: "2026", days: 1, results: 1, versions: 2 }],
    }],
    ["https://data.example/browse/2026.json", {
      year: "2026",
      days: [{
        day: "2026-08-08",
        first_page: 1,
        last_page: 1,
        results: 1,
        versions: 2,
      }],
    }],
    ["https://data.example/browse/2026-08-08/1.json", { entries: [first, second] }],
    ["https://data.example/versions/PALOMAR-2026-08-08-000001.json", {
      id: first.id,
      entries: [first, second],
    }],
    ["https://data.example/entries/PALOMAR-2026-08-08-000001-v1.json", { id: "one-v1" }],
    ["https://data.example/entries/PALOMAR-2026-08-08-000001-v2.json", { id: "one-v2" }],
  ]);
  const fetcher = async (url) => {
    calls.push(String(url));
    return {
      ok: true,
      async json() { return responses.get(String(url)); },
    };
  };
  const validated = [];
  const state = await publicDataState("https://data.example", fetcher, {
    validateRecent(page) {
      validated.push("recent");
      return page;
    },
    validateBrowseHead(page) {
      validated.push("browse-head");
      return page;
    },
    validateBrowseYear(page, expected) {
      validated.push(`year:${expected.year}`);
      return page;
    },
    validateBrowsePage(page, day, number) {
      validated.push(`page:${day}:${number}`);
      return page;
    },
    validateVersions(page, id) {
      validated.push(`versions:${id}`);
      return page;
    },
    validateEntry(value, summary) {
      validated.push(`${value.id}:${summary.path}`);
    },
  });

  assert.equal(state.healthy, true);
  assert.deepEqual(calls, [
    "https://data.example/recent.json",
    "https://data.example/browse/index.json",
    "https://data.example/browse/2026.json",
    "https://data.example/browse/2026-08-08/1.json",
    "https://data.example/versions/PALOMAR-2026-08-08-000001.json",
    "https://data.example/entries/PALOMAR-2026-08-08-000001-v1.json",
    "https://data.example/entries/PALOMAR-2026-08-08-000001-v2.json",
  ]);
  assert.deepEqual(validated, [
    "recent",
    "browse-head",
    "year:2026",
    "page:2026-08-08:1",
    `versions:${first.id}`,
    `one-v1:${first.path}`,
    `one-v2:${second.path}`,
  ]);
  assert.match(state.reason, /all 2 active entry versions across 1 results/);
});

test("live-data health fails closed when a version index omits or rewrites browse history", async () => {
  const id = "PALOMAR-2026-08-08-000001";
  const browseRow = {
    id,
    version: 1,
    title: "Browse title",
    status: "accepted",
    path: `entries/${id}-v1.json`,
  };
  const responses = new Map([
    ["https://data.example/recent.json", { entries: [] }],
    ["https://data.example/browse/index.json", {
      results: 1,
      versions: 1,
      years: [{ year: "2026", days: 1, results: 1, versions: 1 }],
    }],
    ["https://data.example/browse/2026.json", {
      year: "2026",
      days: [{
        day: "2026-08-08",
        first_page: 1,
        last_page: 1,
        results: 1,
        versions: 1,
      }],
    }],
    ["https://data.example/browse/2026-08-08/1.json", { entries: [browseRow] }],
    ["https://data.example/versions/PALOMAR-2026-08-08-000001.json", {
      id,
      entries: [{ ...browseRow, title: "Rewritten title" }],
    }],
  ]);
  const identityValidators = {
    validateRecent: (value) => value,
    validateBrowseHead: (value) => value,
    validateBrowseYear: (value) => value,
    validateBrowsePage: (value) => value,
    validateVersions: (value) => value,
    validateEntry() { assert.fail("an unreconciled permalink must not be accepted"); },
  };
  const state = await publicDataState(
    "https://data.example",
    async (url) => ({ ok: true, async json() { return responses.get(String(url)); } }),
    identityValidators,
  );

  assert.equal(state.healthy, false);
  assert.match(state.reason, /version index .* does not equal its browse history/);
});

test("live-data health fails on the same contract error a visitor would see", async () => {
  const fetcher = async () => ({ ok: true, async json() { return { entries: [] }; } });
  const state = await publicDataState("https://data.example", fetcher, {
    validateRecent() { throw new Error("entry.review.scores must be an object"); },
    validateEntry() {},
  });

  assert.equal(state.healthy, false);
  assert.match(state.reason, /entry\.review\.scores must be an object/);
});

test("every registry document the site links to is one the registry still serves", async () => {
  // Seven links pointed at `index.json` for weeks after it stopped being
  // served: the landing page's machine-readable index, both noscript
  // fallbacks, and four footers. Each answered 404 to whoever followed it, and
  // nothing noticed, because nothing had ever asked the registry whether the
  // documents this site names are ones it will answer for.
  //
  // Offline, that question is answered by the one document whose removal is
  // already history. Against the live registry it is answered in full, by
  // `check-published.mjs --links` in the published-site health workflow.
  const { shippedSources, linkedDataState } = await import("../scripts/check-published.mjs");
  const asked = [];
  const registry = async (url, options) => {
    asked.push([String(url), options.method]);
    return { ok: new URL(url).pathname !== "/index.json", status: 404 };
  };

  const state = await linkedDataState(await shippedSources(), registry);
  assert.equal(state.healthy, true, state.reason);
  assert.ok(asked.length, "the shipped site names no registry documents at all");
  assert.deepEqual([...new Set(asked.map(([, method]) => method))], ["HEAD"]);
});

test("a link to a document the registry has removed is reported with the file that carries it", async () => {
  const { linkedDataState } = await import("../scripts/check-published.mjs");
  const state = await linkedDataState(
    [["index.html", '<a href="https://data.palomar-registry.org/index.json">Data</a>']],
    async () => ({ ok: false, status: 404 }),
  );
  assert.equal(state.healthy, false);
  assert.match(state.reason, /index\.html links .*\/index\.json, which responded 404/);
});

test("a prefix the site builds documents out of is not itself requested", async () => {
  const { linkedDataDocuments } = await import("../scripts/check-published.mjs");
  // `connect-src https://data.palomar-registry.org` in every page's content
  // policy, and the render base the entry page resolves an artifact against.
  // Neither names a document, and requesting either would report a 404 that
  // means nothing.
  const documents = linkedDataDocuments([
    ["index.html", "connect-src 'self' https://data.palomar-registry.org; frame-src 'self'"],
    ["assets/security.mjs", 'const base = "https://data.palomar-registry.org/";'],
  ]);
  assert.deepEqual([...documents], []);
});

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

const registryValidators = {
  validateRecent: (value) => value,
  validateBrowseHead: (value) => value,
  validateBrowseYear: (value) => value,
  validateBrowsePage: (value) => value,
  validateSubjectHead: (value) => value,
  validateVersions: (value) => value,
  validateEntry() {},
};

const CLASSIFICATION = { arxiv: ["math.CO"], msc2020: ["05C10"] };

function subjectHead(kind, code, rows, registeredAt = "2026-08-08T12:00:00Z") {
  return {
    kind,
    code,
    entries: rows.map((row) => ({
      ...row,
      published_at: registeredAt,
      classification: CLASSIFICATION,
    })),
  };
}

function oneEntryRegistry() {
  const id = "PALOMAR-2026-08-08-000001";
  const row = {
    id,
    version: 1,
    title: "One",
    status: "accepted",
    path: `entries/${id}-v1.json`,
  };
  const registeredAt = "2026-08-08T12:00:00Z";
  const recent = { ...row, versions: 1, published_at: registeredAt, classification: CLASSIFICATION };
  const head = {
    results: 1,
    versions: 1,
    years: [{ year: "2026", days: 1, results: 1, versions: 1 }],
  };
  const year = {
    year: "2026",
    days: [{
      day: "2026-08-08",
      first_page: 1,
      last_page: 1,
      results: 1,
      versions: 1,
    }],
  };
  const browsePage = { entries: [row] };
  const history = { id, entries: [row] };
  const entry = { id, registered_at: registeredAt, classification: CLASSIFICATION };
  return {
    entry,
    head,
    history,
    page: browsePage,
    recent,
    row,
    year,
    responses: new Map([
      ["https://data.example/recent.json", { entries: [recent] }],
      ["https://data.example/browse/index.json", head],
      ["https://data.example/browse/2026.json", year],
      ["https://data.example/browse/2026-08-08/1.json", browsePage],
      [`https://data.example/versions/${id}.json`, history],
      [`https://data.example/entries/${id}-v1.json`, entry],
      ["https://data.example/subjects/arxiv/math.CO.json", subjectHead("arxiv", "math.CO", [row])],
      ["https://data.example/subjects/msc/05C10.json", subjectHead("msc", "05C10", [row])],
    ]),
  };
}

const responseFrom = (responses) => async (url) => ({
  ok: true,
  status: 200,
  async json() { return responses.get(String(url)); },
});

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
  const registeredAt = "2026-08-08T12:00:00Z";
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
    ["https://data.example/recent.json", {
      entries: [{
        ...second,
        versions: 2,
        published_at: registeredAt,
        classification: CLASSIFICATION,
      }],
    }],
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
    ["https://data.example/entries/PALOMAR-2026-08-08-000001-v1.json", {
      id: "one-v1",
      registered_at: "2026-08-08T11:00:00Z",
      classification: CLASSIFICATION,
    }],
    ["https://data.example/entries/PALOMAR-2026-08-08-000001-v2.json", {
      id: "one-v2",
      registered_at: registeredAt,
      classification: CLASSIFICATION,
    }],
    ["https://data.example/subjects/arxiv/math.CO.json", subjectHead("arxiv", "math.CO", [second])],
    ["https://data.example/subjects/msc/05C10.json", subjectHead("msc", "05C10", [second])],
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
    validateSubjectHead(page, kind, code) {
      validated.push(`subject:${kind}/${code}`);
      return page;
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
    "https://data.example/subjects/arxiv/math.CO.json",
    "https://data.example/subjects/msc/05C10.json",
  ]);
  assert.deepEqual(validated, [
    "recent",
    "browse-head",
    "year:2026",
    "page:2026-08-08:1",
    `versions:${first.id}`,
    `one-v1:${first.path}`,
    `one-v2:${second.path}`,
    "subject:arxiv/math.CO",
    "subject:msc/05C10",
  ]);
  assert.match(
    state.reason,
    /all 2 active entry versions across 1 results and 2 classification codes/,
  );
});

test("live-data health refuses a subject page naming what is not a current version", async () => {
  const fixture = oneEntryRegistry();
  const superseded = { ...fixture.row, version: 2, path: `entries/${fixture.row.id}-v2.json` };
  const responses = new Map(fixture.responses);
  responses.set(
    "https://data.example/subjects/arxiv/math.CO.json",
    subjectHead("arxiv", "math.CO", [superseded]),
  );
  const state = await publicDataState(
    "https://data.example",
    responseFrom(responses),
    registryValidators,
  );

  assert.equal(state.healthy, false);
  assert.match(state.reason, /which is not a current version/);
});

test("live-data health refuses a subject row that is not the record it names", async () => {
  // Every field the subject page draws is compared with the record behind it.
  // A row that reads perfectly well and says something its record does not is
  // the failure this surface can still have.
  for (const [field, wrong] of [
    ["published_at", "2026-08-08T23:59:59Z"],
    ["abstract", "An abstract the record does not carry."],
    ["classification", { arxiv: ["math.CO", "math.MG"], msc2020: ["05C10"] }],
  ]) {
    const fixture = oneEntryRegistry();
    const responses = new Map(fixture.responses);
    const head = subjectHead("arxiv", "math.CO", [fixture.row]);
    responses.set("https://data.example/subjects/arxiv/math.CO.json", {
      ...head,
      entries: [{ ...head.entries[0], [field]: wrong }],
    });
    const state = await publicDataState(
      "https://data.example",
      responseFrom(responses),
      registryValidators,
    );

    assert.equal(state.healthy, false, field);
    assert.match(state.reason, /as something its record is not/);
  }
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

test("live-data health retries a transient request and recovers", async () => {
  const fixture = oneEntryRegistry();
  let recentAttempts = 0;
  const fetcher = async (url) => {
    if (String(url).endsWith("/recent.json") && recentAttempts++ === 0) {
      return { ok: false, status: 503 };
    }
    return responseFrom(fixture.responses)(url);
  };
  const state = await publicDataState(
    "https://data.example",
    fetcher,
    registryValidators,
    { attempts: 2, backoffMs: 0, timeoutMs: 100 },
  );

  assert.equal(state.healthy, true, state.reason);
  assert.equal(recentAttempts, 2);
});

test("live-data health does not retry a permanent response", async () => {
  let attempts = 0;
  const state = await publicDataState(
    "https://data.example",
    async () => {
      attempts += 1;
      return { ok: false, status: 404 };
    },
    registryValidators,
    { attempts: 3, backoffMs: 0, timeoutMs: 100 },
  );

  assert.equal(state.healthy, false);
  assert.equal(attempts, 1);
  assert.match(state.reason, /recent\.json responded 404/);
});

test("live-data health times out, aborts, and bounds every retry", async () => {
  const signals = [];
  const state = await publicDataState(
    "https://data.example",
    (_url, { signal }) => new Promise((_resolve, reject) => {
      signals.push(signal);
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
    registryValidators,
    { attempts: 2, backoffMs: 0, timeoutMs: 5 },
  );

  assert.equal(state.healthy, false);
  assert.equal(signals.length, 2);
  assert.ok(signals.every((signal) => signal.aborted));
  assert.match(state.reason, /recent\.json timed out after 5ms/);
});

test("live-data health rejects day and global count mismatches", async () => {
  const dayFixture = oneEntryRegistry();
  dayFixture.year.days[0].versions = 2;
  let state = await publicDataState(
    "https://data.example",
    responseFrom(dayFixture.responses),
    registryValidators,
  );
  assert.equal(state.healthy, false);
  assert.match(state.reason, /browse counts do not equal the rows served/);

  const globalFixture = oneEntryRegistry();
  globalFixture.head.versions = 2;
  state = await publicDataState(
    "https://data.example",
    responseFrom(globalFixture.responses),
    registryValidators,
  );
  assert.equal(state.healthy, false);
  assert.match(state.reason, /index counts do not equal the complete page traversal/);
});

test("live-data health rejects duplicate permalinks before fetching histories", async () => {
  const fixture = oneEntryRegistry();
  const duplicate = {
    ...fixture.row,
    id: "PALOMAR-2026-08-08-000002",
  };
  fixture.page.entries.push(duplicate);
  fixture.head.results = 2;
  fixture.head.versions = 2;
  fixture.year.days[0].results = 2;
  fixture.year.days[0].versions = 2;
  const state = await publicDataState(
    "https://data.example",
    responseFrom(fixture.responses),
    registryValidators,
  );

  assert.equal(state.healthy, false);
  assert.match(state.reason, /browse pages repeat an entry permalink/);
});

test("live-data health rejects a recent row absent from advertised history", async () => {
  const fixture = oneEntryRegistry();
  fixture.recent.id = "PALOMAR-2026-08-08-000002";
  fixture.recent.path = "entries/PALOMAR-2026-08-08-000002-v1.json";
  const state = await publicDataState(
    "https://data.example",
    responseFrom(fixture.responses),
    registryValidators,
  );

  assert.equal(state.healthy, false);
  assert.match(state.reason, /recent row .* does not equal its current version history/);
});

test("live-data health checks recent publication time against the already fetched entry", async () => {
  const fixture = oneEntryRegistry();
  fixture.recent.published_at = "2026-08-08T13:00:00Z";
  let entryFetches = 0;
  const state = await publicDataState(
    "https://data.example",
    async (url) => {
      if (String(url) === `https://data.example/${fixture.row.path}`) entryFetches += 1;
      return responseFrom(fixture.responses)(url);
    },
    registryValidators,
  );

  assert.equal(state.healthy, false);
  assert.equal(entryFetches, 1);
  assert.match(state.reason, /does not match its entry registered_at/);
});

test("every monitored linked document is requested exactly once from its owner", async () => {
  const {
    linkedDocumentState,
    monitoredLinkedDocuments,
    shippedSources,
  } = await import("../scripts/check-published.mjs");
  const sources = await shippedSources();
  const documents = monitoredLinkedDocuments(sources);
  // The browse head is not here because no page links it: it names years and
  // counts and no path, so a reader who followed it learned nothing and could
  // not go on. `--data` fetches it as the root of the complete traversal, which
  // is the only thing that ever read it.
  for (const path of ["feed.xml", "recent.json", "source-availability.json"]) {
    assert.ok(
      documents.has(`https://data.palomar-registry.org/${path}`),
      `${path} is absent from the shipped document reconciliation`,
    );
  }
  assert.deepEqual(
    [...documents.keys()].filter((href) => href.includes("PalomarRegistry/PalomarPolicy")),
    ["https://github.com/PalomarRegistry/PalomarPolicy/blob/main/CONTRIBUTING.md"],
    "About's Policy links must collapse to one fragment-free request",
  );
  const asked = [];
  const registry = async (url, options) => {
    asked.push([String(url), options]);
    return { ok: true, status: 200 };
  };

  const state = await linkedDocumentState(sources, registry);
  assert.equal(state.healthy, true, state.reason);
  assert.ok(documents.size, "the shipped site names no monitored documents at all");
  assert.equal(asked.length, documents.size);
  assert.deepEqual(
    asked.map(([url]) => url).sort(),
    [...documents.keys()].sort(),
  );
  for (const [, options] of asked) {
    assert.deepEqual(options, { method: "HEAD", cache: "no-store" });
  }
});

test("a missing current registry document is reported with the file that carries it", async () => {
  const { linkedDocumentState } = await import("../scripts/check-published.mjs");
  const state = await linkedDocumentState(
    [["index.html", '<a href="https://data.palomar-registry.org/recent.json">Data</a>']],
    async () => ({ ok: false, status: 404 }),
  );
  assert.equal(state.healthy, false);
  assert.match(state.reason, /index\.html links .*\/recent\.json, which responded 404/);
});

test("a prefix the site builds documents out of is not itself requested", async () => {
  const { monitoredLinkedDocuments } = await import("../scripts/check-published.mjs");
  // `connect-src https://data.palomar-registry.org` in every page's content
  // policy, and the render base the entry page resolves an artifact against.
  // Neither names a document, and requesting either would report a 404 that
  // means nothing.
  const documents = monitoredLinkedDocuments([
    ["index.html", "connect-src 'self' https://data.palomar-registry.org; frame-src 'self'"],
    ["assets/security.mjs", 'const base = "https://data.palomar-registry.org/";'],
  ]);
  assert.deepEqual([...documents], []);
});

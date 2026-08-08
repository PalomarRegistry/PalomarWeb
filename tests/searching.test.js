import assert from "node:assert/strict";
import test from "node:test";

import { createRegistrySearch } from "../assets/searching.mjs";
import { identifiedEntry } from "./registry-fixture.mjs";

const BASE = "https://data.example.test/";

function posting(serial) {
  return `PALOMAR-2026-07-29-${String(serial).padStart(6, "0")}-v1`;
}

function head(term, results, pageSize) {
  return {
    schema_version: 1,
    term,
    page_size: pageSize,
    pages: Math.ceil(results / pageSize),
    results,
  };
}

function page(term, number, postings) {
  return { schema_version: 1, term, page: number, postings };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test("search pipelines I/O but retains validated publisher order", async () => {
  const postings = [1, 2, 3, 4].map(posting);
  const responses = new Map([
    ["/search/stopwords.json", { schema_version: 1, stopwords: [] }],
    ["/search/t/alpha/head.json", head("alpha", 4, 2)],
    ["/search/t/beta/head.json", head("beta", 4, 2)],
    ["/search/t/alpha/0.json", page("alpha", 0, postings.slice(0, 2))],
    ["/search/t/alpha/1.json", page("alpha", 1, postings.slice(2))],
    ["/search/t/beta/0.json", page("beta", 0, postings.slice(0, 2))],
    ["/search/t/beta/1.json", page("beta", 1, postings.slice(2))],
  ]);
  const delays = new Map([
    ["/search/t/alpha/head.json", 25],
    ["/search/t/beta/head.json", 2],
    ["/search/t/alpha/1.json", 30],
    ["/search/t/alpha/0.json", 20],
    ["/search/t/beta/1.json", 2],
    ["/search/t/beta/0.json", 1],
  ]);
  let active = 0;
  let maximumActive = 0;
  const completed = [];
  const fetchJson = async (url) => {
    const path = new URL(url).pathname;
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await wait(delays.get(path) ?? (path.includes("000004") ? 30 : 2));
    active -= 1;
    completed.push(path);
    if (path.startsWith("/entries/")) {
      const serial = Number(path.match(/-([0-9]{6})-v1\.json$/)[1]);
      return identifiedEntry(serial);
    }
    if (!responses.has(path)) throw new Error(`unexpected request ${path}`);
    return responses.get(path);
  };

  const search = createRegistrySearch(fetchJson, { concurrency: 3, timeoutMs: 1_000 });
  const result = await search("alpha beta", BASE);

  assert.ok(maximumActive > 1, "search requests stayed serial");
  assert.ok(maximumActive <= 3, "search exceeded its concurrency bound");
  assert.ok(
    completed.indexOf("/entries/PALOMAR-2026-07-29-000004-v1.json") >
      completed.indexOf("/entries/PALOMAR-2026-07-29-000003-v1.json"),
    "the completion fixture did not finish out of posting order",
  );
  assert.deepEqual(result.entries.map((entry) => entry.id), [4, 3, 2, 1].map((serial) =>
    `PALOMAR-2026-07-29-${String(serial).padStart(6, "0")}`,
  ));
  assert.equal(result.whole, true);
  assert.deepEqual(result.problems, []);
});

test("failed pages and records yield only validated results and a degraded result", async () => {
  const postings = [1, 2, 3, 4].map(posting);
  const fetchJson = async (url) => {
    const path = new URL(url).pathname;
    if (path === "/search/stopwords.json") return { schema_version: 1, stopwords: [] };
    if (path === "/search/t/alpha/head.json") return head("alpha", 4, 2);
    if (path === "/search/t/alpha/1.json") throw new Error("posting page unavailable");
    if (path === "/search/t/alpha/0.json") return page("alpha", 0, postings.slice(0, 2));
    if (path.endsWith("000002-v1.json")) throw new Error("record unavailable");
    if (path.startsWith("/entries/")) return identifiedEntry(1);
    throw new Error(`unexpected request ${path}`);
  };

  const search = createRegistrySearch(fetchJson, { concurrency: 4, timeoutMs: 1_000 });
  const result = await search("alpha", BASE);

  assert.deepEqual(result.entries.map((entry) => entry.id), [
    "PALOMAR-2026-07-29-000001",
  ]);
  assert.deepEqual(result.problems.map((problem) => problem.stage), ["page", "record"]);
  assert.equal(result.whole, false);
  assert.equal(result.timedOut, false);
});

test("one overall deadline bounds every search stage, including an abort-ignoring fetch", async () => {
  const fetchJson = async (url) => {
    const path = new URL(url).pathname;
    if (path === "/search/stopwords.json") return { schema_version: 1, stopwords: [] };
    if (path === "/search/t/alpha/head.json") return head("alpha", 1, 1);
    if (path === "/search/t/alpha/0.json") return new Promise(() => {});
    throw new Error(`unexpected request ${path}`);
  };
  const search = createRegistrySearch(fetchJson, { concurrency: 2, timeoutMs: 30 });

  const before = Date.now();
  const result = await search("alpha", BASE);

  assert.ok(Date.now() - before < 500, "search exceeded its overall deadline");
  assert.equal(result.timedOut, true);
  assert.equal(result.whole, false);
  assert.equal(result.entries.length, 0);
  assert.deepEqual(result.problems.map((problem) => problem.stage), ["page"]);
});

test("a caller can abort the shared search deadline without reporting a timeout", async () => {
  const fetchJson = async (url) => {
    const path = new URL(url).pathname;
    if (path === "/search/stopwords.json") return { schema_version: 1, stopwords: [] };
    if (path === "/search/t/alpha/head.json") return head("alpha", 1, 1);
    if (path === "/search/t/alpha/0.json") return new Promise(() => {});
    throw new Error(`unexpected request ${path}`);
  };
  const search = createRegistrySearch(fetchJson, { concurrency: 2, timeoutMs: 1_000 });
  const controller = new AbortController();

  const before = Date.now();
  const pending = search("alpha", BASE, { signal: controller.signal });
  setTimeout(() => controller.abort(new Error("query superseded")), 20);
  const result = await pending;

  assert.ok(Date.now() - before < 500, "caller abort did not settle the search promptly");
  assert.equal(result.timedOut, false);
  assert.equal(result.whole, false);
  assert.deepEqual(result.problems.map((problem) => problem.stage), ["page"]);
});

test("one failed head degrades but does not discard exact results from a healthy driver", async () => {
  const fetchJson = async (url) => {
    const path = new URL(url).pathname;
    if (path === "/search/stopwords.json") return { schema_version: 1, stopwords: [] };
    if (path === "/search/t/alpha/head.json") throw new Error("head unavailable");
    if (path === "/search/t/beta/head.json") return head("beta", 1, 1);
    if (path === "/search/t/beta/0.json") return page("beta", 0, [posting(1)]);
    if (path.startsWith("/entries/")) return identifiedEntry(1);
    throw new Error(`unexpected request ${path}`);
  };
  const search = createRegistrySearch(fetchJson, { concurrency: 2, timeoutMs: 1_000 });

  const result = await search("alpha beta", BASE);

  assert.deepEqual(result.entries.map((entry) => entry.id), [
    "PALOMAR-2026-07-29-000001",
  ]);
  assert.deepEqual(result.problems.map((problem) => problem.stage), ["head"]);
  assert.equal(result.whole, false);
});

test("a non-404 stopword failure is reported and retried by the next search", async () => {
  let stopwordRequests = 0;
  const fetchJson = async (url) => {
    const path = new URL(url).pathname;
    if (path === "/search/stopwords.json") {
      stopwordRequests += 1;
      if (stopwordRequests === 1) {
        const error = new Error("stopwords unavailable");
        error.status = 503;
        throw error;
      }
      return { schema_version: 1, stopwords: [] };
    }
    if (path === "/search/t/alpha/head.json") return head("alpha", 1, 1);
    if (path === "/search/t/alpha/0.json") return page("alpha", 0, [posting(1)]);
    if (path.startsWith("/entries/")) return identifiedEntry(1);
    throw new Error(`unexpected request ${path}`);
  };
  const search = createRegistrySearch(fetchJson, { concurrency: 2, timeoutMs: 1_000 });

  const first = await search("alpha", BASE);
  const second = await search("alpha", BASE);

  assert.deepEqual(first.problems.map((problem) => problem.stage), ["stopwords"]);
  assert.deepEqual(second.problems, []);
  assert.equal(stopwordRequests, 2);
});

test("a secondary term that cannot fit the remaining page budget is not partly requested", async () => {
  const requestedPages = [];
  const postings = [posting(1), posting(2)];
  const fetchJson = async (url) => {
    const path = new URL(url).pathname;
    if (path === "/search/stopwords.json") return { schema_version: 1, stopwords: [] };
    if (path === "/search/t/alpha/head.json") return head("alpha", 2, 1);
    if (path === "/search/t/beta/head.json") return head("beta", 2, 1);
    const match = path.match(/^\/search\/t\/(alpha|beta)\/([0-9]+)\.json$/);
    if (match) {
      requestedPages.push(`${match[1]}/${match[2]}`);
      const number = Number(match[2]);
      return page(match[1], number, [postings[number]]);
    }
    if (path.startsWith("/entries/")) {
      const serial = Number(path.match(/-([0-9]{6})-v1\.json$/)[1]);
      return identifiedEntry(serial);
    }
    throw new Error(`unexpected request ${path}`);
  };
  const search = createRegistrySearch(fetchJson, {
    concurrency: 3,
    timeoutMs: 1_000,
    pageBudget: 3,
  });

  const result = await search("alpha beta", BASE);

  assert.deepEqual(requestedPages, ["alpha/1", "alpha/0"]);
  assert.equal(result.entries.length, 2);
  assert.equal(result.whole, true);
});

test("matching versions of one result collapse to its newest matching version", async () => {
  const id = "PALOMAR-2026-07-29-000001";
  const requestedRecords = [];
  const fetchJson = async (url) => {
    const path = new URL(url).pathname;
    if (path === "/search/stopwords.json") return { schema_version: 1, stopwords: [] };
    if (path === "/search/t/alpha/head.json") return head("alpha", 2, 2);
    if (path === "/search/t/alpha/0.json") {
      // Publisher order is lexical, so the consumer must compare versions as
      // integers rather than assuming the reversed posting sequence is enough.
      return page("alpha", 0, [`${id}-v10`, `${id}-v9`]);
    }
    if (path.startsWith("/entries/")) {
      requestedRecords.push(path);
      return identifiedEntry(1, { version: Number(path.match(/-v([0-9]+)\.json$/)[1]) });
    }
    throw new Error(`unexpected request ${path}`);
  };
  const search = createRegistrySearch(fetchJson, { concurrency: 2, timeoutMs: 1_000 });

  const result = await search("alpha", BASE);

  assert.deepEqual(requestedRecords, [`/entries/${id}-v10.json`]);
  assert.deepEqual(result.entries.map((entry) => [entry.id, entry.version]), [[id, 10]]);
  assert.equal(result.whole, true);
});

test("a version group reports broken postings in order and continues to an older match", async () => {
  const id = "PALOMAR-2026-07-29-000001";
  const fetchJson = async (url) => {
    const path = new URL(url).pathname;
    if (path === "/search/stopwords.json") return { schema_version: 1, stopwords: [] };
    if (path === "/search/t/alpha/head.json") return head("alpha", 3, 3);
    if (path === "/search/t/alpha/0.json") {
      return page("alpha", 0, [`${id}-v10`, `${id}-v8`, `${id}-v9`]);
    }
    if (path.endsWith("-v10.json")) throw new Error("newest record unavailable");
    if (path.endsWith("-v9.json")) return identifiedEntry(1, { version: 9, title: "" });
    if (path.endsWith("-v8.json")) return identifiedEntry(1, { version: 8 });
    throw new Error(`unexpected request ${path}`);
  };
  const search = createRegistrySearch(fetchJson, { concurrency: 2, timeoutMs: 1_000 });

  const result = await search("alpha", BASE);

  assert.deepEqual(result.entries.map((entry) => [entry.id, entry.version]), [[id, 8]]);
  assert.deepEqual(result.problems.map((problem) => problem.item), [
    `${id}-v10`,
    `${id}-v9`,
  ]);
  assert.equal(result.whole, false);
});

test("a complete postings sequence remains incomplete when the candidate cap truncates it", async () => {
  const postings = [posting(1), posting(2), posting(3)];
  let recordRequests = 0;
  const fetchJson = async (url) => {
    const path = new URL(url).pathname;
    if (path === "/search/stopwords.json") return { schema_version: 1, stopwords: [] };
    if (path === "/search/t/alpha/head.json") return head("alpha", 3, 3);
    if (path === "/search/t/alpha/0.json") return page("alpha", 0, postings);
    if (path.startsWith("/entries/")) {
      recordRequests += 1;
      const serial = Number(path.match(/-([0-9]{6})-v1\.json$/)[1]);
      return identifiedEntry(serial, { title: "Gamma", abstract: "Delta" });
    }
    throw new Error(`unexpected request ${path}`);
  };
  const search = createRegistrySearch(fetchJson, {
    concurrency: 2,
    timeoutMs: 1_000,
    candidateLimit: 2,
  });

  const result = await search("alpha", BASE);

  assert.equal(recordRequests, 2);
  assert.equal(result.entries.length, 0);
  assert.equal(result.whole, false);
});

test("page, candidate, and concurrency limits remain hard bounds", async () => {
  const postings = Array.from({ length: 100 }, (_unused, index) => posting(index + 1));
  let active = 0;
  let maximumActive = 0;
  const pageRequests = [];
  let recordRequests = 0;
  const fetchJson = async (url) => {
    const path = new URL(url).pathname;
    if (path === "/search/stopwords.json") return { schema_version: 1, stopwords: [] };
    if (path === "/search/t/alpha/head.json") return head("alpha", 100, 5);
    const pageMatch = path.match(/^\/search\/t\/alpha\/([0-9]+)\.json$/);
    if (pageMatch) {
      const number = Number(pageMatch[1]);
      pageRequests.push(number);
      return page("alpha", number, postings.slice(number * 5, number * 5 + 5));
    }
    if (path.startsWith("/entries/")) {
      recordRequests += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await wait(1);
      active -= 1;
      const serial = Number(path.match(/-([0-9]{6})-v1\.json$/)[1]);
      return identifiedEntry(serial, {
        title: `Nonmatching fixture ${serial}`,
        abstract: "Gamma delta fixture.",
      });
    }
    throw new Error(`unexpected request ${path}`);
  };
  const search = createRegistrySearch(fetchJson, {
    concurrency: 4,
    timeoutMs: 1_000,
    pageBudget: 16,
    candidateLimit: 60,
    resultLimit: 20,
  });

  const result = await search("alpha", BASE);

  assert.equal(pageRequests.length, 16);
  assert.deepEqual(
    [...pageRequests].sort((left, right) => left - right),
    Array.from({ length: 16 }, (_unused, index) => index + 4),
  );
  assert.equal(recordRequests, 60);
  assert.equal(result.entries.length, 0);
  assert.ok(maximumActive <= 4);
  assert.equal(result.whole, false);
});

test("the record window stops with at most concurrency minus one speculative groups", async () => {
  const postings = Array.from({ length: 100 }, (_unused, index) => posting(index + 1));
  let recordRequests = 0;
  const fetchJson = async (url) => {
    const path = new URL(url).pathname;
    if (path === "/search/stopwords.json") return { schema_version: 1, stopwords: [] };
    if (path === "/search/t/alpha/head.json") return head("alpha", 100, 100);
    if (path === "/search/t/alpha/0.json") return page("alpha", 0, postings);
    if (path.startsWith("/entries/")) {
      recordRequests += 1;
      const serial = Number(path.match(/-([0-9]{6})-v1\.json$/)[1]);
      return identifiedEntry(serial);
    }
    throw new Error(`unexpected request ${path}`);
  };
  const search = createRegistrySearch(fetchJson, {
    concurrency: 8,
    timeoutMs: 1_000,
    candidateLimit: 60,
    resultLimit: 20,
  });

  const result = await search("alpha", BASE);

  assert.equal(recordRequests, 27, "more than seven speculative groups were started");
  assert.equal(result.entries.length, 20);
  assert.equal(result.entries[0].id, "PALOMAR-2026-07-29-000100");
  assert.equal(result.entries.at(-1).id, "PALOMAR-2026-07-29-000081");
  assert.equal(result.whole, false);
});

test("the initial record window never exceeds the result limit", async () => {
  const postings = Array.from({ length: 20 }, (_unused, index) => posting(index + 1));
  let recordRequests = 0;
  const fetchJson = async (url) => {
    const path = new URL(url).pathname;
    if (path === "/search/stopwords.json") return { schema_version: 1, stopwords: [] };
    if (path === "/search/t/alpha/head.json") return head("alpha", 20, 20);
    if (path === "/search/t/alpha/0.json") return page("alpha", 0, postings);
    if (path.startsWith("/entries/")) {
      recordRequests += 1;
      return new Promise(() => {});
    }
    throw new Error(`unexpected request ${path}`);
  };
  const search = createRegistrySearch(fetchJson, {
    concurrency: 8,
    timeoutMs: 30,
    resultLimit: 2,
  });

  const result = await search("alpha", BASE);

  assert.equal(recordRequests, 2);
  assert.equal(result.timedOut, true);
});

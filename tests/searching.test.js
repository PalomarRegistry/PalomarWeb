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

test("record waves stop after the result limit instead of eagerly loading every candidate", async () => {
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

  assert.equal(recordRequests, 24, "more than the final partial wave was fetched");
  assert.equal(result.entries.length, 20);
  assert.equal(result.entries[0].id, "PALOMAR-2026-07-29-000100");
  assert.equal(result.entries.at(-1).id, "PALOMAR-2026-07-29-000081");
  assert.equal(result.whole, false);
});

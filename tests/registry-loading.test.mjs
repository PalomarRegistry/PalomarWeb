import assert from "node:assert/strict";
import test from "node:test";

import { createRegistryLoader } from "../assets/registry-loading.mjs";
import {
  availabilityManifest,
  entry,
  secondVersion,
  summary,
} from "./registry-fixture.mjs";

const ID = "PALOMAR-2026-07-29-000123";

function jsonResponse(value, status = 200, statusText = status === 404 ? "Not Found" : "OK") {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    async json() {
      return structuredClone(value);
    },
  };
}

function productionLocation(page = "entry.html") {
  return {
    href: `https://palomar-registry.org/${page}`,
    search: "",
  };
}

function routedFetch(routes, calls = []) {
  return async (value, options = {}) => {
    const url = new URL(value);
    calls.push({ url, signal: options.signal });
    const route = routes.get(url.pathname);
    if (!route) throw new Error(`unexpected fixture request: ${url.href}`);
    return typeof route === "function" ? route(url, options) : route;
  };
}

test("the loader composes every loopback endpoint through the security selectors", () => {
  const search =
    "?database=%2Ffixtures%2Fdatabase%2F&render-base=%2Ffixtures%2Frenders%2F" +
    "&availability=%2Ffixtures%2Favailability.json";
  const loader = createRegistryLoader({
    fetch: assert.fail,
    location: {
      href: `http://127.0.0.1:4173/entry.html${search}`,
      search,
    },
    warn: assert.fail,
  });

  const selected = loader.dataSource();
  assert.equal(selected.databaseBase.href, "http://127.0.0.1:4173/fixtures/database/");
  assert.equal(selected.renderBase.href, "http://127.0.0.1:4173/fixtures/renders/");
  assert.equal(
    selected.availabilityUrl.href,
    "http://127.0.0.1:4173/fixtures/availability.json",
  );
});

test("JSON transport preserves the abort signal and status of a failed response", async () => {
  const signal = AbortSignal.abort(new Error("fixture abort"));
  let receivedSignal;
  const loader = createRegistryLoader({
    fetch: async (_url, options) => {
      receivedSignal = options.signal;
      return jsonResponse({}, 503, "Service Unavailable");
    },
    location: productionLocation(),
    warn: assert.fail,
  });

  await assert.rejects(
    loader.fetchJson(new URL("https://data.example/record.json"), { signal }),
    (error) => error.message === "503 Service Unavailable" && error.status === 503,
  );
  assert.equal(receivedSignal, signal);
});

test("bounded availability caches absence but retries a transient failure", async () => {
  const url = new URL("https://data.palomar-registry.org/source-availability.json");
  let transientReads = 0;
  const warnings = [];
  const fresh = new Date(Math.floor(Date.now() / 1_000) * 1_000)
    .toISOString()
    .replace(".000Z", "Z");
  const transientLoader = createRegistryLoader({
    fetch: async () => {
      transientReads += 1;
      return transientReads === 1
        ? jsonResponse({}, 503, "Service Unavailable")
        : jsonResponse(availabilityManifest([], { generated_at: fresh }));
    },
    location: productionLocation("index.html"),
    warn: (message) => warnings.push(message),
  });

  assert.equal(await transientLoader.loadAvailabilityBounded(url), null);
  const recovered = await transientLoader.loadAvailabilityBounded(url);
  assert.equal(recovered.generated_at, fresh);
  assert.equal(transientReads, 2);
  assert.deepEqual(warnings, ["Source availability is unavailable: 503 Service Unavailable"]);

  let absentReads = 0;
  const absentLoader = createRegistryLoader({
    fetch: async () => {
      absentReads += 1;
      return jsonResponse({}, 404);
    },
    location: productionLocation("index.html"),
    warn: assert.fail,
  });
  assert.equal(await absentLoader.loadAvailabilityBounded(url), null);
  assert.equal(await absentLoader.loadAvailabilityBounded(url), null);
  assert.equal(absentReads, 1);
});

test("an unversioned entry read resolves and validates the current immutable record", async () => {
  const record = secondVersion();
  const versions = {
    schema_version: 1,
    id: ID,
    entries: [
      summary(),
      summary({
        version: 2,
        title: record.title,
        path: `entries/${ID}-v2.json`,
      }),
    ],
  };
  const calls = [];
  const routes = new Map([
    [`/versions/${ID}.json`, jsonResponse(versions)],
    [`/entries/${ID}-v2.json`, jsonResponse(record)],
    ["/source-availability.json", jsonResponse({}, 404)],
  ]);
  const warnings = [];
  const loader = createRegistryLoader({
    fetch: routedFetch(routes, calls),
    location: productionLocation(),
    warn: (message) => warnings.push(message),
  });

  const loaded = await loader.loadEntry(ID, null);

  assert.equal(loaded.entry.version, 2);
  assert.equal(loaded.currentVersion, 2);
  assert.deepEqual(loaded.versions, versions.entries);
  assert.equal(
    loaded.canonicalUrl.href,
    `https://data.palomar-registry.org/entries/${ID}-v2.json`,
  );
  assert.equal(loaded.databaseBase.href, "https://data.palomar-registry.org/");
  assert.equal(loaded.renderBase.href, "https://data.palomar-registry.org/");
  assert.equal(loaded.availability, null);
  assert.deepEqual(warnings, ["Source availability is unavailable: 404 Not Found"]);
  assert.deepEqual(calls.map(({ url }) => url.pathname).sort(), [
    `/entries/${ID}-v2.json`,
    "/source-availability.json",
    `/versions/${ID}.json`,
  ].sort());
});

test("an inactive exact version resolves only through its validated tombstone", async () => {
  const versions = { schema_version: 1, id: ID, entries: [summary()] };
  const tombstone = { id: ID, version: 2, taken_down_on: "2026-08-08" };
  const calls = [];
  const routes = new Map([
    [`/versions/${ID}.json`, jsonResponse(versions)],
    [`/tombstones/${ID}-v2.json`, jsonResponse(tombstone)],
    ["/source-availability.json", jsonResponse({}, 404)],
  ]);
  const loader = createRegistryLoader({
    fetch: routedFetch(routes, calls),
    location: productionLocation(),
    warn: () => {},
  });

  assert.deepEqual(await loader.loadEntry(ID, 2), { tombstone });
  assert.equal(calls.some(({ url }) => url.pathname.startsWith("/entries/")), false);
});

test("an absent version index and tombstone produce the one public not-found error", async () => {
  const routes = new Map([
    [`/versions/${ID}.json`, jsonResponse({}, 404)],
    [`/tombstones/${ID}-v9.json`, jsonResponse({}, 404)],
    ["/source-availability.json", jsonResponse({}, 404)],
  ]);
  const loader = createRegistryLoader({
    fetch: routedFetch(routes),
    location: productionLocation(),
    warn: () => {},
  });

  await assert.rejects(loader.loadEntry(ID, 9), /entry not found/);
  await assert.rejects(loader.loadEntry(ID, null), /entry not found/);
});

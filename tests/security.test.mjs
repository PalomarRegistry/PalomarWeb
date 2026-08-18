import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { htmlFiles } from "../scripts/build-site.mjs";
import {
  COMMIT,
  DIGEST,
  availabilityEndpoint,
  availabilityManifest,
  availabilityRow,
  entry,
  recent,
  recentRenders,
  recentRow,
  renderRow,
  secondVersion,
  summary,
} from "./registry-fixture.mjs";

import {
  AVAILABILITY_MAX_AGE_MS,
  AVAILABILITY_MAX_CLOCK_SKEW_MS,
  BROWSE_SCHEMA_VERSION,
  DEFAULT_DATABASE,
  DEFAULT_AVAILABILITY,
  ENTRY_SCHEMA_VERSION,
  DEFAULT_RENDER_BASE,
  databaseBaseFor,
  availabilityRecord,
  RESULT_ORIGIN_LABELS,
  REPOSITORY_ROLE_LABELS,
  RECENT_SCHEMA_VERSION,
  VERSIONS_SCHEMA_VERSION,
  entryRecordUrl,
  isLoopbackHostname,
  safeDataUrl,
  safeExternalUrl,
  safeInternalUrl,
  selectDatabaseUrl,
  selectAvailabilityUrl,
  selectRenderBase,
  recentRenderRow,
  recentRendersUrl,
  recentUrl,
  tombstoneUrl,
  validateEntry,
  validateAvailability,
  validateBrowseHead,
  validateBrowsePage,
  validateBrowseYear,
  SUBJECT_SCHEMA_VERSION,
  subjectHeadUrl,
  subjectPageUrl,
  subjectYearUrl,
  validateSubjectHead,
  validateSubjectPage,
  validateSubjectYear,
  validateRecent,
  validateRecentRenders,
  validateTombstone,
  validateVersions,
  versionsUrl,
  postingRecordUrl,
  searchHeadUrl,
  searchPageUrl,
  searchTerms,
  stopwordsUrl,
  validateSearchHead,
  validateSearchPage,
  validateStopwords,
} from "../assets/security.mjs";

// The website's own origin, for the cross-origin assertion below.
const CANONICAL_WEB_BASE_FOR_TEST = "https://palomar-registry.org/";

/**
 * The sibling PalomarDatabase checkout, as a filesystem path.
 *
 * `new URL(...).pathname` is a URL component, not a path: on Windows it is
 * `/c:/Users/...`, which git rejects outright. That reached `git -C` at the
 * source-availability contract below, and its catch reported a stale checkout
 * for what was a malformed argument -- a confident wrong diagnosis that only
 * ever appears off CI, since CI is Linux and the two spellings agree there.
 */
function databaseCheckout() {
  return (
    process.env.PALOMAR_DATABASE_CHECKOUT
    ?? fileURLToPath(new URL("../../PalomarDatabase/", import.meta.url))
  );
}

test("production ignores every database query override", () => {
  for (const override of [
    "https://attacker.invalid/index.json",
    "javascript:alert(1)",
    "data:application/json,{}",
  ]) {
    assert.equal(
      selectDatabaseUrl(
        "https://data.palomar-registry.org/PalomarWeb/",
        `?database=${encodeURIComponent(override)}`,
      ).href,
      DEFAULT_DATABASE,
    );
  }
});

test("production also pins the rendered-Challenge origin", () => {
  assert.equal(
    selectRenderBase(
      "https://data.palomar-registry.org/PalomarWeb/",
      "?render-base=https://attacker.invalid/",
      "https://attacker.invalid/database/",
    ).href,
    DEFAULT_RENDER_BASE,
  );
  assert.equal(
    selectRenderBase(
      "http://127.0.0.1:8000/",
      "?render-base=/fixtures/renders/",
      "http://127.0.0.1:8000/fixtures/",
    ).href,
    "http://127.0.0.1:8000/fixtures/renders/",
  );
});

test("production pins availability while loopback can select a fixture", () => {
  assert.equal(
    selectAvailabilityUrl(
      "https://palomar-registry.org/",
      "?availability=https://attacker.invalid/status.json",
      "https://attacker.invalid/database/",
    ).href,
    DEFAULT_AVAILABILITY,
  );
  assert.equal(
    selectAvailabilityUrl(
      "http://127.0.0.1:8000/",
      "?availability=/fixtures/status.json",
      "http://127.0.0.1:8000/database/",
    ).href,
    "http://127.0.0.1:8000/fixtures/status.json",
  );
});

test("loopback development can select an HTTP fixture", () => {
  assert.equal(isLoopbackHostname("localhost"), true);
  assert.equal(isLoopbackHostname("127.9.8.7"), true);
  assert.equal(isLoopbackHostname("[::1]"), true);
  assert.equal(isLoopbackHostname("127.0.0.999"), false);
  assert.equal(
    selectDatabaseUrl("http://127.0.0.1:8000/", "?database=/fixtures/").href,
    "http://127.0.0.1:8000/fixtures/",
  );
  assert.throws(
    () => selectDatabaseUrl("http://localhost:8000/", "?database=javascript:alert(1)"),
    /must use an HTTP\(S\) URL/,
  );
});

test("index entry paths are exact descendants of the database prefix", () => {
  const base = databaseBaseFor("https://example.test/database/");
  assert.equal(
    entryRecordUrl(summary(), base).href,
    "https://example.test/database/entries/PALOMAR-2026-07-29-000123-v1.json",
  );
  for (const path of [
    "../PALOMAR-2026-07-29-000123-v1.json",
    "/entries/PALOMAR-2026-07-29-000123-v1.json",
    "https://attacker.invalid/PALOMAR-2026-07-29-000123-v1.json",
    "entries-evil/PALOMAR-2026-07-29-000123-v1.json",
    "entries/PALOMAR-2026-07-29-000123-v1.json?raw=1",
  ]) {
    assert.throws(() => entryRecordUrl(summary({ path }), base), /entry path must be/);
  }
});

test("what is new is read from the database prefix and nowhere else", () => {
  assert.equal(
    recentUrl(databaseBaseFor("https://example.test/database/")).href,
    "https://example.test/database/recent.json",
  );
  assert.equal(
    recentRendersUrl(databaseBaseFor("https://example.test/database/")).href,
    "https://example.test/database/recent-renders.json",
  );
});

test("recent validation rejects unsupported, rejected, and malformed rows", () => {
  assert.throws(() => validateRecent(recent([], { schema_version: 2 })), /unsupported recent/);
  assert.throws(
    () => validateRecent(recent([recentRow({ status: "draft" })])),
    /status is not accepted/,
  );
  assert.throws(
    () => validateRecent(recent([recentRow({ published_at: "yesterday" })])),
    /published_at is malformed/,
  );
  // A date, not an instant. Every row carries the record's `registered_at`,
  // which the schema requires of every version, and a date read as an instant
  // is midnight: such a row would sort ahead of everything registered that day
  // and no reader could tell why.
  assert.throws(
    () => validateRecent(recent([recentRow({ published_at: "2026-07-29" })])),
    /published_at is malformed/,
  );
  assert.equal(validateRecent(recent()).entries.length, 1);
});

test("recent validation accepts the Database-owned landing-card fixture", async () => {
  // This is the same mandatory cross-repository contract mechanism used for
  // canonical schemas below. Locally it reads PalomarDatabase's checked
  // fixture; CI supplies the published producer output at the same path.
  const checkout = databaseCheckout();
  const fixture = JSON.parse(
    await readFile(join(checkout, "tests", "fixtures", "recent.json"), "utf8"),
  );
  assert.ok(fixture.entries.length > 0, "the external contract fixture must exercise a row");
  assert.equal(validateRecent(fixture), fixture);
});

test("an empty recent registry is valid", () => {
  assert.deepEqual(validateRecent(recent([])).entries, []);
});

test("the render companion is one exact closed shape", () => {
  assert.deepEqual(validateRecentRenders(recentRenders([])).renders, []);

  for (const mutate of [
    (document) => { document.entries = []; },
    (document) => { document.schema_version = 2; },
    (document) => { delete document.renders[0].version; },
    (document) => { document.renders[0].artifact_path = "renders/"; },
    (document) => { document.renders[0].id = "PALOMAR-2026-07-29-00012"; },
    (document) => { document.renders[0].version = 0; },
    (document) => { document.renders[0].version = 1.5; },
    (document) => { document.renders[0].artifact_tree_sha256 = "a".repeat(63); },
    (document) => { document.renders[0].artifact_tree_sha256 = "A".repeat(64); },
    (document) => { document.renders = Array(201).fill(renderRow()); },
  ]) {
    const document = recentRenders();
    mutate(document);
    assert.throws(() => validateRecentRenders(document), /invalid registry data/);
  }
});

test("the render companion names each result once, in one order", () => {
  const first = renderRow();
  const second = renderRow({ id: "PALOMAR-2026-07-29-000124" });

  assert.ok(validateRecentRenders(recentRenders([first, second])));
  assert.throws(
    () => validateRecentRenders(recentRenders([second, first])),
    /increasing identifier order/,
  );
  assert.throws(
    () => validateRecentRenders(recentRenders([first, renderRow({ version: 2 })])),
    /increasing identifier order/,
  );
});

test("a rejected render companion leaves no row usable", () => {
  const document = recentRenders([renderRow(), renderRow({ id: "nope" })]);
  assert.throws(() => validateRecentRenders(document), /invalid registry data/);
  assert.throws(() => recentRenderRow(document, renderRow().id), /was not validated/);
});

test("recent is one exact complete projection, not a legacy summary shape", () => {
  assert.throws(
    () => validateRecent({ schema_version: 1, entries: [summary()] }),
    /invalid shape/,
  );

  for (const mutate of [
    (page) => { page.legacy_entries = []; },
    (page) => { delete page.entries[0].abstract; },
    (page) => { page.entries[0].registered_at = page.entries[0].published_at; },
    (page) => { delete page.entries[0].source.project_path; },
    (page) => { page.entries[0].authors[0].github = "somebody"; },
    (page) => { page.entries[0].preservation = null; },
    (page) => { page.entries[0].preservation.repositories = []; },
  ]) {
    const page = recent();
    mutate(page);
    assert.throws(
      () => validateRecent(page),
      /invalid shape|preservation must be an object|must contain one source mapping/,
    );
  }
});

test("recent validates every projected card field and source mapping", () => {
  const duplicateClassifications = recent();
  duplicateClassifications.entries[0].classification.arxiv.push("math.CO");
  assert.throws(() => validateRecent(duplicateClassifications), /distinct values/);

  const missingTheorems = recent();
  missingTheorems.entries[0].formalization.theorem_names = [];
  assert.throws(() => validateRecent(missingTheorems), /non-empty array/);

  const mismatchedPreservation = recent();
  mismatchedPreservation.entries[0].preservation.repositories[0].commit = "2".repeat(40);
  assert.throws(() => validateRecent(mismatchedPreservation), /does not match source/);
});

test("recent applies the canonical producer's cheap presentation bounds", () => {
  for (const [field, maximum] of [["title", 300], ["abstract", 10_000]]) {
    const atBound = recent();
    atBound.entries[0][field] = "x".repeat(maximum);
    assert.equal(validateRecent(atBound), atBound);

    const overBound = recent();
    overBound.entries[0][field] = "x".repeat(maximum + 1);
    assert.throws(() => validateRecent(overBound), new RegExp(`longer than ${maximum}`));
  }

  const classifications = recent();
  classifications.entries[0].classification.arxiv = ["math.CO", "math.NT"];
  classifications.entries[0].classification.msc2020 = Array.from(
    { length: 8 },
    (_unused, position) => `10A${String(position + 1).padStart(2, "0")}`,
  );
  assert.equal(validateRecent(classifications), classifications);
  classifications.entries[0].classification.arxiv.push("cs.DM");
  assert.throws(() => validateRecent(classifications), /more than 2 codes/);
  classifications.entries[0].classification.arxiv.pop();
  classifications.entries[0].classification.msc2020.push("10A09");
  assert.throws(() => validateRecent(classifications), /more than 8 codes/);
});

test("a record must say when the version was registered, and agree with its result date", () => {
  // The two are one fact written twice, in two repositories. `accepted_at` is
  // the result's date: the identifier carries it, browsing pages by it, and
  // every later version inherits it. `registered_at` is the version's own
  // instant and is what the landing page, the feeds and the subject pages
  // order by. A record where they have come apart is well formed and renders,
  // and is browsed under one day while being ordered under another.
  const missing = entry();
  delete missing.registered_at;
  assert.throws(() => validateEntry(missing, summary()), /entry\.registered_at/);

  assert.throws(
    () => validateEntry(entry({ registered_at: "2026-07-29" }), summary()),
    /entry\.registered_at is malformed/,
  );
  assert.throws(
    () => validateEntry(entry({ registered_at: "2026-07-30T09:14:07Z" }), summary()),
    /accepted_at is not the day version 1 was registered/,
  );
  assert.throws(
    () => validateEntry(entry({ registered_at: "2026-07-28T09:14:07Z" }), summary()),
    /accepted_at is not the day version 1 was registered/,
  );

  // A later version brings its own instant and inherits its result's date,
  // which is what keeps it on its v1's browse page while sorting it as news.
  const secondSummary = summary({
    version: 2,
    path: "entries/PALOMAR-2026-07-29-000123-v2.json",
  });
  const second = secondVersion({ registered_at: "2027-04-01T09:00:00Z" });
  assert.equal(validateEntry(second, secondSummary), second);

  // And it cannot be older than the result it supersedes. That row would sort
  // behind rows for versions it replaced, on every page that carries it.
  assert.throws(
    () => validateEntry(secondVersion({ registered_at: "2026-07-28T09:00:00Z" }), secondSummary),
    /registered_at is before the result entered the registry/,
  );
});

test("a recent summary's publication instant matches the entry it orders", () => {
  const record = entry();
  assert.equal(validateEntry(record, recentRow()), record);
  assert.throws(
    () => validateEntry(record, recentRow({ published_at: "2026-07-29T09:14:08Z" })),
    /registered_at does not match summary\.published_at/,
  );

  // Version indexes and search postings do not order cards by publication
  // time, so their summaries deliberately do not carry this field.
  assert.equal(validateEntry(record, summary()), record);
});

test("what recent claims is coverage and ordering, so both are checked", () => {
  // The rows would render perfectly well in any order, and a result listed
  // twice under two versions is two well-formed rows. Nothing else on this
  // side would notice either, which is exactly why this does.
  const older = recentRow({
    id: "PALOMAR-2026-07-29-000124",
    path: "entries/PALOMAR-2026-07-29-000124-v1.json",
    published_at: "2026-07-01T00:00:00Z",
  });
  const newer = recentRow({ published_at: "2026-08-01T00:00:00Z" });
  assert.throws(() => validateRecent(recent([older, newer])), /newest-first/);
  assert.equal(validateRecent(recent([newer, older])).entries.length, 2);
  assert.throws(
    () => validateRecent(recent([recentRow(), recentRow({ version: 2, path: "entries/PALOMAR-2026-07-29-000123-v2.json" })])),
    /more than once/,
  );
});

test("recent breaks equal publication timestamps by descending identifier", () => {
  const lower = recentRow();
  const higher = recentRow({
    id: "PALOMAR-2026-07-29-000124",
    path: "entries/PALOMAR-2026-07-29-000124-v1.json",
  });
  assert.deepEqual(validateRecent(recent([higher, lower])).entries, [higher, lower]);
  assert.throws(() => validateRecent(recent([lower, higher])), /newest-first/);
});

test("recent is bounded, because the document it replaced was the registry", () => {
  // A reader that accepted an unbounded page would let the whole-registry
  // document come back under another name with nothing failing to say so.
  const page = recent(
    Array.from({ length: 201 }, (_unused, position) => {
      const serial = String(100000 + position);
      return recentRow({
        id: `PALOMAR-2026-07-29-${serial}`,
        path: `entries/PALOMAR-2026-07-29-${serial}-v1.json`,
      });
    }),
  );
  assert.throws(() => validateRecent(page), /more rows than it may/);
});

test("exact tombstones are closed, date-only, and bound to their URL", () => {
  const base = databaseBaseFor("https://example.test/database/");
  const id = "PALOMAR-2026-07-29-000123";
  assert.equal(
    tombstoneUrl(id, 2, base).href,
    `https://example.test/database/tombstones/${id}-v2.json`,
  );
  assert.deepEqual(
    validateTombstone({ id, version: 2, taken_down_on: "2026-08-06" }, id, 2),
    { id, version: 2, taken_down_on: "2026-08-06" },
  );
  assert.throws(
    () => validateTombstone({ id, version: 2, taken_down_on: "2026-02-30" }, id, 2),
    /date is malformed/,
  );
  assert.throws(
    () => validateTombstone({ id, version: 2, taken_down_on: "2026-08-06", reason: "secret" }, id, 2),
    /unexpected fields/,
  );
});

test("active-content and insecure data-derived links are never allowed", () => {
  for (const value of [
    "javascript:alert(1)",
    "data:text/html,hostile",
    "blob:https://example.test/id",
    "http://github.com/example/project",
    "https://user:secret@example.test/",
  ]) {
    assert.throws(() => safeExternalUrl(value), /must use HTTPS/);
  }
  assert.equal(safeExternalUrl("https://example.test/path").href, "https://example.test/path");
  assert.equal(
    safeDataUrl("http://127.0.0.1:8000/entry.json", "http://127.0.0.1:8000/entry.html").href,
    "http://127.0.0.1:8000/entry.json",
  );
  assert.throws(
    () => safeDataUrl("http://127.0.0.1:9000/entry.json", "http://127.0.0.1:8000/"),
    /same-origin HTTP/,
  );
  assert.throws(
    () => safeInternalUrl("https://attacker.invalid/", "https://palomar.example/"),
    /escaped the Palomar origin/,
  );
});

test("a canonical accepted record validates", () => {
  assert.equal(validateEntry(entry(), summary()).id, "PALOMAR-2026-07-29-000123");
});

test("preservation must cover every immutable source", () => {
  const missing = entry();
  missing.preservation.repositories.pop();
  assert.throws(() => validateEntry(missing, summary()), /does not exactly cover/);

  const moving = entry();
  moving.preservation.repositories[0].ref = "refs/tags/latest";
  assert.throws(() => validateEntry(moving, summary()), /ref is not canonical/);
});

test("availability applies the inclusive freshness boundaries to each endpoint", () => {
  const now = Date.parse("2026-08-08T12:00:00Z");
  const stamp = (offset) => new Date(now + offset).toISOString().replace(".000Z", "Z");
  const recordAt = (checkedAt) => availabilityRecord(validateAvailability(availabilityManifest([
    availabilityRow({
      original: availabilityEndpoint({ status: "missing", checked_at: checkedAt }),
    }),
  ])), "example/challenge", COMMIT, now).original;

  assert.equal(recordAt(stamp(-AVAILABILITY_MAX_AGE_MS)).status, "missing");
  const stale = recordAt(stamp(-AVAILABILITY_MAX_AGE_MS - 1_000));
  assert.equal(stale.status, "unknown");
  assert.equal(
    stale.checked_at,
    stamp(-AVAILABILITY_MAX_AGE_MS - 1_000),
    "valid stale evidence is retained after its answer loses authority",
  );
  assert.equal(recordAt(stamp(AVAILABILITY_MAX_CLOCK_SKEW_MS)).status, "missing");
  assert.equal(recordAt(stamp(AVAILABILITY_MAX_CLOCK_SKEW_MS + 1_000)).status, "unknown");
});

test("validated availability uses one private index for every later lookup", () => {
  const rows = Array.from({ length: 12 }, (_, position) => availabilityRow({
    source_repository: `example/repository-${position}`,
    fork_repository: `PalomarArchive/example--repository-${position}`,
  }));
  const manifest = validateAvailability(availabilityManifest(rows));
  const serialized = JSON.stringify(manifest);
  let rowReads = 0;
  manifest.repositories = new Proxy(manifest.repositories, {
    get(target, property, receiver) {
      if (typeof property === "string" && /^[0-9]+$/.test(property)) rowReads += 1;
      return Reflect.get(target, property, receiver);
    },
  });

  for (let repetition = 0; repetition < 50; repetition += 1) {
    assert.equal(
      availabilityRecord(
        manifest,
        "EXAMPLE/repository-11",
        COMMIT,
        Date.parse("2026-08-08T12:00:00Z"),
      ).source_repository,
      "example/repository-11",
    );
  }

  assert.equal(rowReads, 0, "accepted availability rows are never traversed by lookup");
  assert.equal(JSON.stringify(manifest), serialized, "the private index does not alter JSON");
});

test("availability lookup uses the accepted snapshot rather than later row mutation", () => {
  const now = Date.parse("2026-08-08T12:00:00Z");
  const manifest = validateAvailability(availabilityManifest([
    availabilityRow({
      original: availabilityEndpoint({
        status: "missing",
        checked_at: "2026-08-08T12:00:00Z",
      }),
    }),
  ], { generated_at: "2026-08-08T12:00:00Z" }));
  const acceptedFork = manifest.repositories[0].fork_repository;

  manifest.generated_at = "2026-08-08T13:00:00Z";
  manifest.repositories[0].fork_repository = "PalomarArchive/example--changed";
  manifest.repositories[0].original.status = "available";
  manifest.repositories[0].original.checked_at = "2026-08-08T11:30:00Z";

  const first = availabilityRecord(manifest, "example/challenge", COMMIT, now);
  assert.equal(first.fork_repository, acceptedFork);
  assert.equal(first.original.status, "missing");
  assert.equal(first.original.checked_at, "2026-08-08T12:00:00Z");

  // Lookup also must not expose its private endpoint snapshot for mutation.
  first.original.status = "available";
  assert.equal(
    availabilityRecord(manifest, "example/challenge", COMMIT, now).original.status,
    "missing",
  );
});

test("availability lookup refuses raw and ambiguous documents", () => {
  assert.throws(
    () => availabilityRecord(availabilityManifest([availabilityRow()]), "example/challenge", COMMIT),
    /availability document was not validated/,
  );
  assert.throws(
    () => validateAvailability(availabilityManifest([availabilityRow(), availabilityRow()])),
    /is duplicated/,
  );
});

test("one malformed endpoint cannot hide its fresh sibling or unrelated rows", () => {
  const now = Date.parse("2026-08-08T12:00:00Z");
  const manifest = validateAvailability(availabilityManifest([
    availabilityRow({
      original: availabilityEndpoint({ status: "missing", checked_at: 123 }),
      archive: availabilityEndpoint({
        status: "available",
        checked_at: "2026-08-08T12:00:00Z",
        last_attempt_at: null,
      }),
    }),
    availabilityRow({
      source_repository: "example/fresh",
      original: availabilityEndpoint({ status: "missing" }),
      archive: availabilityEndpoint({ status: "available" }),
    }),
  ]));

  const mixed = availabilityRecord(manifest, "EXAMPLE/challenge", COMMIT, now);
  assert.equal(mixed.original.status, "unknown", "malformed checked_at is not evidence");
  assert.equal(mixed.original.checked_at, null);
  assert.equal(mixed.archive.status, "available", "the fresh sibling remains authoritative");
  assert.equal(mixed.archive.last_attempt_at, null, "never-attempted endpoints are valid");
  assert.deepEqual(
    [
      availabilityRecord(manifest, "example/fresh", COMMIT, now).original.status,
      availabilityRecord(manifest, "example/fresh", COMMIT, now).archive.status,
    ],
    ["missing", "available"],
  );
});

test("availability normalizes every malformed endpoint timestamp without rejecting the document", () => {
  const now = Date.parse("2026-08-08T12:00:00Z");
  for (const checkedAt of ["not-a-timestamp", 123, {}, []]) {
    const malformed = validateAvailability(availabilityManifest([
      availabilityRow({
        original: availabilityEndpoint({ status: "missing", checked_at: checkedAt }),
        archive: availabilityEndpoint({ status: "unknown", checked_at: checkedAt }),
      }),
    ]));
    const row = availabilityRecord(malformed, "example/challenge", COMMIT, now);
    assert.deepEqual(
      [row.original.status, row.original.checked_at, row.archive.status, row.archive.checked_at],
      ["unknown", null, "unknown", null],
    );
  }
});

test("availability keeps whole-document freshness inclusive and fail-closed", () => {
  const now = Date.parse("2026-08-08T12:00:00Z");
  const recordAt = (generatedAt) => availabilityRecord(
    validateAvailability(availabilityManifest([availabilityRow()], { generated_at: generatedAt })),
    "example/challenge",
    COMMIT,
    now,
  );
  assert.ok(recordAt("2026-08-07T18:00:00Z"));
  assert.equal(recordAt("2026-08-07T17:59:59Z"), null);
  assert.ok(recordAt("2026-08-08T12:05:00Z"));
  assert.equal(recordAt("2026-08-08T12:05:01Z"), null);
  assert.throws(
    () => validateAvailability(availabilityManifest([], { generated_at: "2026-02-30T00:00:00Z" })),
    /generated_at is malformed/,
  );
  assert.throws(
    () => validateAvailability(availabilityManifest([], {
      coverage: { freshness_max_age_seconds: 86_400 },
    })),
    /freshness_max_age_seconds disagrees/,
  );
  const noCoverage = availabilityManifest([]);
  delete noCoverage.coverage;
  assert.throws(() => validateAvailability(noCoverage), /availability.coverage must be an object/);
  assert.throws(
    () => validateAvailability(availabilityManifest([
      availabilityRow({ original: availabilityEndpoint({ last_attempt_at: "never" }) }),
    ])),
    /last_attempt_at is malformed/,
  );
});

test("availability accepts the deployed handoff and public-writer contracts", async () => {
  const checkout = databaseCheckout();
  // Schema 1 is the live deployment handoff. It remains readable until the
  // first successful public refresh replaces the object with schema 2.
  let deployed;
  try {
    deployed = JSON.parse(await readFile(
      join(checkout, "tests", "fixtures", "source-availability.json"),
      "utf8",
    ));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    deployed = availabilityManifest([availabilityRow()], {
      schema_version: 1,
      database_commit: COMMIT,
    });
    delete deployed.targets_sha256;
    delete deployed.publication_revision;
  }
  assert.ok(deployed.repositories.length > 0, "the deployed contract must exercise a row");
  assert.equal(
    deployed.coverage?.freshness_max_age_seconds,
    AVAILABILITY_MAX_AGE_MS / 1_000,
    "the deployed producer and consumer must share the freshness policy",
  );
  validateAvailability(deployed);

  // Schema 2 is owned by public PalomarDatabaseTools CI and binds the result
  // to the exact separately published target set.
  const produced = availabilityManifest([
    availabilityRow({
      original: availabilityEndpoint({
        status: "unknown",
        checked_at: null,
      }),
      archive: availabilityEndpoint({
        checked_at: "2026-08-08T12:05:00Z",
        last_attempt_at: null,
      }),
    }),
  ]);

  const consumed = validateAvailability(produced);
  const row = availabilityRecord(
    consumed,
    "example/challenge",
    COMMIT,
    Date.parse("2026-08-08T12:00:00Z"),
  );
  assert.equal(row.original.status, "unknown");
  assert.equal(row.archive.status, "available");
  assert.equal(row.archive.last_attempt_at, null);
  assert.equal(consumed.coverage.freshness_max_age_seconds, AVAILABILITY_MAX_AGE_MS / 1_000);
});

test("withdrawn palomar-indexed provenance is rejected", () => {
  const trust = {
    ...entry().trust,
    level: "qualified",
    challenge_dependencies: [
      { repository: "example/dependency", provenance: "palomar-indexed" },
    ],
  };
  assert.throws(
    () => validateEntry(entry({ trust }), summary()),
    /provenance is unsupported/,
  );

  trust.challenge_dependencies = [
    {
      repository: "example/dependency",
      provenance: "allowlisted",
      palomar_id: "PALOMAR-2026-07-29-000123",
    },
  ];
  assert.throws(
    () => validateEntry(entry({ trust }), summary()),
    /palomar_id is forbidden/,
  );
});

test("entry schema, acceptance state, verdict, and selected identity fail closed", () => {
  const unsupportedSchemas = [
    entry({ schema_version: 1 }),
    entry({ schema_version: 3 }),
    entry({ schema_version: true }),
    entry({ schema_version: "2" }),
  ];
  const missingSchema = entry();
  delete missingSchema.schema_version;
  unsupportedSchemas.push(missingSchema);
  for (const record of unsupportedSchemas) {
    assert.throws(() => validateEntry(record, summary()), /unsupported entry schema_version/);
  }
  assert.throws(() => validateEntry(entry({ status: "draft" }), summary()), /not accepted/);
  const rejected = entry();
  rejected.review.verdict = "reject";
  assert.throws(() => validateEntry(rejected, summary()), /verdict is not accept/);
  assert.throws(
    () => validateEntry(entry(), summary({ id: "PALOMAR-2026-07-29-000124", path: "entries/PALOMAR-2026-07-29-000124-v1.json" })),
    /identity does not match/,
  );
  assert.throws(
    () => validateEntry(entry(), summary({ version: 2, path: "entries/PALOMAR-2026-07-29-000123-v2.json" })),
    /identity does not match/,
  );
});

test("a record carrying review scores is refused, not rendered", () => {
  // A record is served exactly as it was committed, and a committed record
  // has no scores. While the release tooling stripped them on the way out,
  // one forgotten call would have put them on the page; now the last thing
  // between the numbers and a reader is this check.
  const leaked = entry();
  leaked.review.scores = { clarity: 5 };
  assert.throws(
    () => validateEntry(leaked, summary()),
    /entry\.review\.scores is not published/,
  );
  const clean = entry();
  assert.equal(validateEntry(clean, summary()), clean);
});

test("record evidence links must agree with their canonical values", () => {
  const wrongDate = entry({ accepted_at: "2026-07-30" });
  assert.throws(() => validateEntry(wrongDate, summary()), /ID date does not match/);

  const wrongSubmissionId = entry();
  wrongSubmissionId.submission.submission_id = "not-an-id";
  assert.throws(() => validateEntry(wrongSubmissionId, summary()), /submission_id is malformed/);

  const wrongTree = entry();
  wrongTree.source.tree_url = `https://github.com/attacker/wrong/tree/${COMMIT}`;
  assert.throws(() => validateEntry(wrongTree, summary()), /tree_url is not derived/);

  // The run URL is derived from the recorded repository and run id, so a link
  // pointing anywhere else is a disagreement inside the record itself.
  const activeWorkflow = entry();
  activeWorkflow.verification.workflow_url = "javascript:alert(1)";
  assert.throws(() => validateEntry(activeWorkflow, summary()), /not derived from the recorded run/);

  const foreignRun = entry();
  foreignRun.verification.workflow_url =
    "https://github.com/attacker/PalomarSubmission/actions/runs/12345";
  assert.throws(() => validateEntry(foreignRun, summary()), /not derived from the recorded run/);

  const foreignRepository = entry();
  foreignRepository.verification.repository = "attacker/PalomarSubmission";
  foreignRepository.verification.workflow_url =
    "https://github.com/attacker/PalomarSubmission/actions/runs/12345";
  assert.throws(
    () => validateEntry(foreignRepository, summary()),
    /not the Palomar verification repository/,
  );

  const relabelledRun = entry();
  relabelledRun.verification.run_id = 99999;
  assert.throws(() => validateEntry(relabelledRun, summary()), /not derived from the recorded run/);
});

test("a published record never carries the submitter", () => {
  // Keeping the submitter private is the whole point of a private intake, and
  // the schema has no field for one. A record that grew one is not displayed.
  for (const field of ["submitter", "issue"]) {
    const leaky = entry();
    leaky.submission[field] = "example";
    assert.throws(() => validateEntry(leaky, summary()), /a field this schema does not have/);
  }
});

test("the archived review is cited by digest, not by a public link", () => {
  const badDigest = entry();
  badDigest.review.report = { sha256: "not a digest" };
  assert.throws(() => validateEntry(badDigest, summary()), /report.sha256 is not a SHA-256/);

  const activeSource = entry();
  activeSource.review.report = { sha256: "e".repeat(64), source_url: "javascript:alert(1)" };
  assert.throws(() => validateEntry(activeSource, summary()));
});

test("unsafe source paths and malformed displayed digests fail closed", () => {
  const traversal = entry();
  traversal.formalization.challenge_path = "../Challenge.lean";
  assert.throws(() => validateEntry(traversal, summary()), /not a safe relative path/);

  const badDigest = entry();
  badDigest.verification.challenge_sha256 = "not a digest";
  assert.throws(() => validateEntry(badDigest, summary()), /challenge_sha256 is not a SHA-256/);

  const badNanodaPin = entry();
  badNanodaPin.verification.nanoda_commit = "not a commit";
  assert.throws(
    () => validateEntry(badNanodaPin, summary()),
    /nanoda_commit is not a full lowercase commit/,
  );

  const missingNanodaPin = entry();
  delete missingNanodaPin.verification.nanoda_commit;
  assert.throws(
    () => validateEntry(missingNanodaPin, summary()),
    /nanoda_commit is not a full lowercase commit/,
  );
});

test("every HTML entry point carries the restrictive CSP", async () => {
  for (const name of htmlFiles) {
    const html = await readFile(new URL(`../${name}`, import.meta.url), "utf8");
    assert.match(html, /Content-Security-Policy/);
    assert.match(html, /default-src 'none'/);
    assert.match(html, /script-src 'self'/);
    assert.match(html, /frame-src 'self' https:\/\/data\.palomar-registry\.org/);
    // The render origin is fetched as well as framed: app.js reads
    // challenge-metadata.json from it. While the site and the renders shared
    // an origin, connect-src 'self' covered that silently. It does not now,
    // and omitting it fails only in the browser console.
    assert.match(html, /connect-src 'self' https:\/\/data\.palomar-registry\.org/);
    assert.doesNotMatch(html, /raw\.githubusercontent\.com/);
    assert.match(html, /object-src 'none'/);
  }
});

test("the render origin is a different origin from the site", () => {
  // The iframe sandbox omits allow-same-origin, but that should not be the
  // only thing separating a submitter's rendered output from the registry.
  const site = new URL(CANONICAL_WEB_BASE_FOR_TEST);
  const renders = new URL(DEFAULT_RENDER_BASE);
  assert.notStrictEqual(renders.origin, site.origin);
  assert.strictEqual(renders.protocol, "https:");
});

test("every page sends submitters to the submission server", async () => {
  // The issue form is gone. A link to it would send a submitter to a 404, and
  // worse, would suggest submissions are still public by default.
  for (const name of htmlFiles) {
    const html = await readFile(new URL(`../${name}`, import.meta.url), "utf8");
    assert.doesNotMatch(html, /PalomarSubmission\/issues/, `${name} links to the deleted issue form`);
  }
  const guide = await readFile(new URL("../how-to-submit.html", import.meta.url), "utf8");
  assert.match(guide, /https:\/\/submit\.palomar-registry\.org\//);
  assert.match(guide, /Not public unless you register/);
  assert.match(guide, /Nothing is registered until you ask for it/);
  assert.doesNotMatch(guide, /GitHub issue/i);
});

test("About, How to submit, and Statement remain distinct public pages", async () => {
  const about = await readFile(new URL("../about.html", import.meta.url), "utf8");
  const guide = await readFile(new URL("../how-to-submit.html", import.meta.url), "utf8");
  const statement = await readFile(new URL("../statement.html", import.meta.url), "utf8");

  assert.doesNotMatch(about, /<section id="(?:getting-ready|how-to-submit)">/);
  assert.match(guide, /<section id="getting-ready">/);
  assert.match(guide, /<section id="how-to-submit">/);
  assert.match(statement, /Palomar: a registry of Lean-verified mathematics\./);
  assert.match(statement, /Since the start of 2026/);
  assert.match(statement, /Jeremy Avigad, Matthew Ballard, Jaume De Dios/);
});

test("the public documentation describes the current review and version contracts", async () => {
  const about = await readFile(new URL("../about.html", import.meta.url), "utf8");
  const guide = await readFile(new URL("../how-to-submit.html", import.meta.url), "utf8");
  assert.match(about, /Palomar addresses only limited\s+aspects\s+of these criteria/);
  assert.match(about, /This is not a substitute for\s+expert review/);
  assert.match(guide, /Corrections and dependency updates may be registered as new versions/);
  assert.match(guide, /A new mathematical result receives a new ID/);
  assert.match(guide, /Acceptance is not\s+registration/);
  assert.doesNotMatch(guide, /durable-evidence schema \(version 5\)/);
  assert.match(guide, /review-failed/);
  assert.match(guide, /operational fault, not a decision/);
  assert.match(guide, /canonical history, which is\s+append-only in ordinary operation/);
  assert.match(guide, /Moderator may exceptionally\s+retract one exact version/);
  assert.doesNotMatch(guide, /registered record is never removed/);
  // The append-only rule is Palomar's own, and About may not state it as
  // though it outranked the law: an unqualified "permanent" would promise a
  // submitter something the lawful-request process can override.
  assert.match(guide, /does not do is override a\s+legal obligation/);
  assert.match(guide, /href="\/privacy#after-registration"/);
  assert.doesNotMatch(guide, /Registration is permanent/);
});

test("About publishes the three distinct governance rosters", async () => {
  const about = await readFile(new URL("../about.html", import.meta.url), "utf8");
  const prose = about.replace(/\s+/g, " ");
  assert.match(about, /PalomarPolicy\/blob\/main\/docs\/governance\.md/);
  assert.match(
    about,
    /Technical Maintainers[\s\S]*Terence Tao, Matthew Ballard, Nestor Guillen, and Jaume de Dios/,
  );
  for (const name of [
    "Jeremy Avigad",
    "Matthew Ballard",
    "Jaume de Dios",
    "Nestor Guillen",
    "Bryna Kra",
    "Kim Morrison",
    "Terence Tao",
    "Ravi Vakil",
    "Akshay Venkatesh",
  ]) {
    const appearances = prose.split(name).length - 1;
    assert.ok(appearances >= 2, `${name} must appear on the Moderator and Board rosters`);
  }
  assert.match(about, /Board membership carries no operational duty\s+or repository authority by itself/);
  assert.doesNotMatch(about, /override the AI/i);
});

test("user documentation names current examples and iframe height units", async () => {
  const about = await readFile(new URL("../about.html", import.meta.url), "utf8");
  const guide = await readFile(new URL("../how-to-submit.html", import.meta.url), "utf8");
  assert.match(about, /https:\/\/github\.com\/robsimmons\/nanoda_lib/);
  assert.doesNotMatch(about, /github\.com\/ammkrn\/nanoda_lib/);
  assert.match(guide, /href="https:\/\/palomar-registry\.org\/"/);
  assert.match(guide, /current registry/);
  assert.doesNotMatch(guide, /first registered result/);
  assert.doesNotMatch(guide, /entry\.html\?id=PALOMAR-2026-07-29-000001/);

  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const presentation = await readFile(
    new URL("../assets/challenge-presentation.mjs", import.meta.url),
    "utf8",
  );
  const bounds = /minHeight = (\d+),\s*\n\s*maxHeight = (\d+),/.exec(presentation);
  assert.notEqual(bounds, null, "iframe height policy must remain explicit");
  assert.match(readme, new RegExp(`clamped\\s+between ${bounds[1]} and ${bounds[2]} pixels`));
  assert.doesNotMatch(readme, /between 10rem and 42rem/);

  // The preview overrides those defaults, so its own bounds are a second
  // policy and are documented as one rather than left to be inferred.
  const preview = await readFile(
    new URL("../assets/statement-preview.mjs", import.meta.url),
    "utf8",
  );
  const previewBounds = /MIN_HEIGHT = (\d+);\nconst MAX_HEIGHT = (\d+);/.exec(preview);
  assert.notEqual(previewBounds, null, "preview height policy must remain explicit");
  assert.match(
    readme,
    new RegExp(`clamped between ${previewBounds[1]}\\s+and ${previewBounds[2]} pixels`),
  );
  assert.doesNotMatch(readme, /PALOMAR-2026-07-29-000001/);
});

test("the extra-axioms FAQ names the standard three Lean axioms", async () => {
  const about = await readFile(new URL("../how-to-submit.html", import.meta.url), "utf8");
  const section = /<h3 id="extra-axioms">[\s\S]*?<h3 id="formalization-yaml">/.exec(
    about,
  );
  assert.notEqual(section, null);
  assert.match(section[0], /standard three Lean axioms/);
  assert.match(section[0], /propext/);
  assert.match(section[0], /Classical\.choice/);
  assert.match(section[0], /Quot\.sound/);
  assert.doesNotMatch(section[0], /comparator-configuration|current/i);
});

test("the public documentation says what registration publishes, and what it does not", async () => {
  // About said the submitter's identity becomes public on registration. It
  // does not, the schema has no field for it, and that is the direction of
  // error nobody reports. It also promised the "full review", which is not
  // what is published either.
  const about = await readFile(new URL("../about.html", import.meta.url), "utf8");
  const guide = await readFile(new URL("../how-to-submit.html", import.meta.url), "utf8");
  assert.match(guide, /the registry record has no field for the person who sent a\s+submission/);
  assert.doesNotMatch(about, /full review are\s+publicly visible/);
  assert.match(about, /The published review is redacted/);
  assert.match(about, /scored 5 and then 4 on one axis/);
  assert.match(about, /PalomarPolicy\/blob\/main\/docs\/specification\.md#editorial-review/);
  assert.match(guide, /PalomarPolicy\/blob\/main\/docs\/specification\.md#submission-lifecycle-and-privacy/);
});

test("both pages say the authorization evidence is public from verification", async () => {
  // The dispatch that starts mechanical verification runs in the public
  // submission repository, and the Server puts the declared relationship, the
  // free-text evidence and any corrected identifier into its inputs, where a
  // run page shows them to anyone. A draft of the privacy policy said the
  // evidence stayed private until registration, which is the reassuring
  // direction to be wrong in and the one a submitter acts on: the form warns
  // about it precisely because writing a name there publishes the name. The
  // notes field is the one that really is withheld, so the two must not drift
  // into each other.
  const about = await readFile(new URL("../how-to-submit.html", import.meta.url), "utf8");
  const privacy = await readFile(new URL("../privacy.html", import.meta.url), "utf8");
  assert.match(about, /Public from verification onward:[\s\S]{0,220}approval evidence you wrote/);
  assert.match(privacy, /public early, not on registration/);
  assert.match(privacy, /authorization\s+evidence if you wrote any/);
  for (const [name, html] of [["how-to-submit.html", about], ["privacy.html", privacy]]) {
    assert.doesNotMatch(
      html,
      /evidence[^.]{0,80}(?:not (?:sent|public)|stays private|is private)[^.]{0,60}until you register/i,
      `${name} claims the authorization evidence is withheld until registration`,
    );
  }
  // The notes are the field that is genuinely kept out of the public dispatch.
  assert.match(privacy, /deliberately kept out of the public verification\s+dispatch/);
});

test("publication rests on legitimate interests, and the objection right is stated", async () => {
  // The first published version of this page based publishing a registry
  // record on the submitter's consent while also saying the record keeps
  // being served afterwards. Those cannot both hold: consent must be as easy
  // to withdraw as to give, withdrawal has to stop the processing, and a
  // controller cannot move that same processing onto another basis once the
  // consent fails. Withdrawal exists only while a submission is open, so
  // consent stops there and publication is a legitimate-interests case that has
  // to name its interest and carry the Article 21 right that comes with it.
  // A page can regress here silently, because nothing else in the site reads
  // this section.
  const privacy = await readFile(new URL("../privacy.html", import.meta.url), "utf8");
  const section = /<section id="lawful-bases">[\s\S]*?<\/section>/.exec(privacy);
  assert.notEqual(section, null, "the privacy policy must keep its basis mapping");
  const bases = section[0];
  assert.match(bases, /Serving a registered record, and keeping it for as long as\s+the registry exists,<\/strong>\s+rest on legitimate interests/);
  assert.doesNotMatch(
    bases,
    /Publishing a registry record<\/strong> rests on your consent/,
    "publication may not be based on the submitter's consent",
  );
  // The interest has to be named rather than asserted, and the Article 21
  // right has to say that an objection is decided and where to send it.
  assert.match(bases, /permanence of a\s+certification record/);
  assert.match(bases, /cannot support that claim\s+about the entries it still has/);
  assert.match(bases, /Article 21/);
  assert.match(bases, /An objection is decided, not automatic/);
  assert.match(bases, /compelling legitimate grounds/);
  assert.match(bases, /mailto:privacy@palomar-registry\.org/);
  assert.match(bases, /PalomarPolicy\/blob\/main\/docs\/lawful-requests\.md/);
  // Consent keeps the part where withdrawal really does stop the workflow,
  // and the page has to say plainly that registration ends that.
  assert.match(bases, /Withdrawing stops that ongoing consent-based workflow/);
  assert.match(bases, /After registration you cannot take it back yourself/);
  assert.match(bases, /no button that unpublishes it/);
  // No balancing assessment exists as a separate document, so the page must
  // not send anyone looking for one.
  assert.match(bases, /There is\s+no separate balancing document/);
  assert.doesNotMatch(bases, /legitimate interests assessment is available/i);
  // Rights and retention must not drift back into describing publication as
  // consent-based once this section stops doing so.
  assert.doesNotMatch(privacy, /withdraw consent at any\s+time, which stops future processing/);
});

test("consent is scoped to the submitter's own live submission", async () => {
  // "Everything before registration rests on your consent" is the tidy
  // sentence and the wrong one, in the direction that flatters the page. A
  // submitter cannot consent for the co-authors and committers a record names,
  // so their data is on legitimate interests from collection and never moves.
  // Two more things outlive the consent: the dispatched verification run,
  // which Palomar does not delete and withdrawal does not reach, and the
  // retained audit history. Leaving those inside a consent that has been
  // withdrawn would describe processing with no basis at all, which is the
  // failure this whole section exists to avoid.
  const privacy = await readFile(new URL("../privacy.html", import.meta.url), "utf8");
  const bases = /<section id="lawful-bases">[\s\S]*?<\/section>/.exec(privacy)[0];
  assert.doesNotMatch(
    bases,
    /Everything before registration rests on your\s+consent/,
    "consent may not be claimed over everything before registration",
  );
  assert.match(bases, /because a\s+submitter cannot consent for them/);
  assert.match(bases, /Personal data about anyone other than the submitter<\/strong>\s+rests on legitimate interests from the moment it is collected/);
  assert.match(bases, /It is never on consent, at any\s+stage/);
  assert.match(bases, /Keeping the public verification run public afterwards<\/strong>\s+rests on legitimate interests, and did from the moment it was\s+dispatched/);
  assert.match(bases, /Palomar does not delete runs/);
  assert.match(bases, /rests on\s+legitimate interests: a decision nobody can reconstruct/);
  assert.match(bases, /not one Palomar reaches for when a consent ends/);
});

test("the page describes withdrawal from the states that actually allow it", async () => {
  // PalomarServer refuses POST /withdraw for the four statuses in CLOSED, so
  // "any state before registration" is wrong twice over: it promises the scrub
  // to submissions that failed verification or were asked for changes, and it
  // hides that Palomar's own faults deliberately keep withdrawal available.
  // A submission can therefore close unregistered and unscrubbed, and the page
  // has to say what is left for that person instead of implying a button.
  const privacy = await readFile(new URL("../privacy.html", import.meta.url), "utf8");
  const bases = /<section id="lawful-bases">[\s\S]*?<\/section>/.exec(privacy)[0];
  assert.doesNotMatch(privacy, /withdraw from any state before\s+registration/);
  assert.doesNotMatch(privacy, /Until you register, you can withdraw/);
  assert.match(bases, /registered,\s+already\s+withdrawn,\s+failed\s+mechanical\s+verification,\s+or\s+a\s+review\s+that\s+asked\s+for\s+changes/);
  assert.match(bases, /a dispatch it lost, a review it could\s+not run, a registration that stalled/);
  assert.match(bases, /a\s+submission\s+can\s+end\s+without\s+your\s+ever\s+having\s+been\s+offered\s+the\s+scrub/);
});

test("the objection right is scoped to personal data about the objector", async () => {
  // Article 21 covers processing of personal data concerning the objector, on
  // grounds relating to their situation. Described as a right over the record,
  // it becomes a submitter takedown route the law does not provide, which is
  // especially wrong here: the record names no submitter, so a submitter's own
  // objection reaches comparatively little of it. Suppression is a thing an
  // upheld objection can produce, not the extent of what may be objected to.
  const privacy = await readFile(new URL("../privacy.html", import.meta.url), "utf8");
  const bases = /<section id="lawful-bases">[\s\S]*?<\/section>/.exec(privacy)[0];
  assert.match(bases, /object to the processing of personal\s+data concerning them/);
  assert.match(bases, /It is a right over\s+your own personal data, not over a record/);
  assert.match(bases, /objecting does not give you a veto over what a record says about\s+mathematics/);
  assert.match(bases, /it\s+is\s+an\s+outcome\s+the\s+decision\s+may\s+reach,\s+not\s+the\s+measure\s+of\s+the\s+right/);
  assert.match(bases, /Nor is the objection right a submitter’s takedown\s+route by another name/);
  assert.match(privacy, /which part of the material\s+is about you/);
  assert.doesNotMatch(
    privacy,
    /Article 21 objection to a record being served/,
    "the objection right is not a right over a whole record",
  );
});

test("the balancing account weighs each kind of published personal data", async () => {
  // Calling the published data bibliography-like covers the declared authors
  // and nothing else. The commit addresses in a preserved fork, the evidence a
  // submitter typed about somebody who never saw the submission, and generated
  // review comments that can repeat a private note are all published personal
  // data of quite different weight, and a balance that averages them is not a
  // balance anybody could check.
  const privacy = await readFile(new URL("../privacy.html", import.meta.url), "utf8");
  const bases = /<section id="lawful-bases">[\s\S]*?<\/section>/.exec(privacy)[0];
  assert.match(bases, /published personal data is of three\s+different kinds/);
  assert.match(bases, /name and email address in every commit of the preserved fork/);
  assert.match(bases, /nobody puts an email address in a commit in order to be\s+catalogued by a registry/);
  assert.match(bases, /the authorization relationship\s+and the free-text evidence beside it/);
  assert.match(bases, /A warning to one person is not consent from another/);
  assert.match(bases, /can repeat back what a submitter put in the private notes\s+field/);
  assert.doesNotMatch(
    bases,
    /What a record does carry about people is the kind of\s+thing a paper/,
    "the whole record may not be described as bibliography-like",
  );
});

test("How to submit describes both ways push access is proved", async () => {
  // A sign-in and the agent's tag-and-gist do not establish the same thing,
  // and step 3 used to name only the first.
  const about = await readFile(new URL("../how-to-submit.html", import.meta.url), "utf8");
  assert.match(about, /There are two ways to prove that write access/);
  assert.match(about, /not provably the same\s+account/);
  assert.match(about, /Neither is proof of\s+authorship/);
});

test("the public documentation states the repository licence boundary", async () => {
  const about = await readFile(new URL("../about.html", import.meta.url), "utf8");
  const guide = await readFile(new URL("../how-to-submit.html", import.meta.url), "utf8");
  assert.match(about, /root licence file, SPDX identifier, and checksum/);
  assert.match(about, /reused formalizations, and\s+dependencies retain their own licences/);
  assert.match(guide, /repository root is the default project directory/);
  assert.match(guide, /licence file remains at repository root/);
});

test("every provenance value the schema allows has an explicit label", async () => {
  // The renderer once used a binary fallback, so a value nobody stated was
  // displayed as a positive claim about someone's work. Anything the
  // validator accepts must have a label of its own.
  // The authoritative schema lives in PalomarDatabase. CI checks it out and
  // sets PALOMAR_DATABASE_CHECKOUT; locally a sibling clone is assumed. This
  // test exists because the site drifting from the schema is what took the
  // registry down, so an unavailable schema is a failure, not a skip.
  const checkout = databaseCheckout();
  const schema = JSON.parse(
    await readFile(join(checkout, "schema-v2.json"), "utf8"),
  );
  const provenance = schema.properties.provenance.properties;
  for (const [field, labels] of [
    ["result_origin", RESULT_ORIGIN_LABELS],
    ["repository_role", REPOSITORY_ROLE_LABELS],
  ]) {
    assert.deepStrictEqual(
      Object.keys(labels).sort(),
      [...provenance[field].enum].sort(),
      `${field} labels must cover exactly the schema's values`,
    );
  }
});

test("the site requires the Database entry version and exact preservation shape", async () => {
  const checkout = databaseCheckout();
  const schema = JSON.parse(
    await readFile(join(checkout, "schema-v2.json"), "utf8"),
  );
  assert.strictEqual(schema.properties.schema_version.const, ENTRY_SCHEMA_VERSION);
  assert.ok(schema.required.includes("preservation"));
  const preservation = schema.properties.preservation;
  assert.equal(preservation.type, "object");
  assert.equal(preservation.additionalProperties, false);
  assert.deepEqual(
    [...preservation.required].sort(),
    ["archive_owner", "archived_at", "receipt_sha256", "repositories"].sort(),
  );
  assert.deepEqual(
    Object.keys(preservation.properties).sort(),
    ["archive_owner", "archived_at", "receipt_sha256", "repositories"].sort(),
  );
  assert.equal(preservation.properties.archive_owner.const, "PalomarArchive");
  const repositories = preservation.properties.repositories;
  assert.equal(repositories.type, "array");
  assert.equal(repositories.minItems, 1);
  assert.equal(repositories.items.type, "object");
  assert.equal(repositories.items.additionalProperties, false);
  assert.deepEqual(
    [...repositories.items.required].sort(),
    ["source_repository", "commit", "fork_repository", "ref"].sort(),
  );
  assert.deepEqual(
    Object.keys(repositories.items.properties).sort(),
    ["source_repository", "commit", "fork_repository", "ref"].sort(),
  );
});

test("the favicon ships with the site and every page asks for it", async () => {
  // The build copies a fixed list, so an asset that is not on it is simply
  // absent from the deployment however correct the markup is.
  const build = await readFile(new URL("../scripts/build-site.mjs", import.meta.url), "utf8");
  assert.match(build, /"favicon\.svg"/);
  for (const name of htmlFiles) {
    const html = await readFile(new URL(`../${name}`, import.meta.url), "utf8");
    // 404.html asks for it from the root, because it is served at addresses
    // that are not its own; the rest ask for it beside themselves.
    assert.match(html, /rel="icon" href="\/?favicon\.svg"/, `${name} does not ask for the favicon`);
  }
  const icon = await readFile(new URL("../favicon.svg", import.meta.url), "utf8");
  // One flat colour per scheme, and nothing that a strict policy would refuse.
  assert.match(icon, /prefers-color-scheme: dark/);
  assert.doesNotMatch(icon, /<script|xlink:href|href="http/);
});

test("a version index must be every version of the result it names", () => {
  // The document claims to be complete for one identifier. A row belonging to
  // another would show one result's history under another result's name, and
  // the row validator alone would not notice: the rows are well formed.
  const id = "PALOMAR-2026-07-29-000123";
  const row = (version) => ({
    id,
    version,
    title: "A result",
    status: "accepted",
    path: `entries/${id}-v${version}.json`,
  });
  const document = { schema_version: 1, id, entries: [row(1), row(2)] };
  assert.equal(validateVersions(structuredClone(document), id).entries.length, 2);

  assert.throws(() => validateVersions({ ...document, id: "PALOMAR-2026-07-29-000999" }, id),
    /different result/);
  assert.throws(() => validateVersions(document, "PALOMAR-2026-07-29-000999"),
    /different result/);
  assert.throws(
    () => validateVersions({ ...document, entries: [row(2), row(1)] }, id),
    /increasing version order/,
  );
  assert.throws(() => validateVersions({ ...document, entries: [] }, id), /carries no versions/);
  assert.throws(() => validateVersions({ ...document, schema_version: 2 }, id), /schema_version/);

  const foreign = { id: "PALOMAR-2026-07-29-000999", version: 3, title: "t", status: "accepted",
    path: "entries/PALOMAR-2026-07-29-000999-v3.json" };
  assert.throws(() => validateVersions({ ...document, entries: [row(1), foreign] }, id),
    /is a different result/);
});

test("a version index URL cannot leave the database origin", () => {
  const base = "https://data.example.org/";
  assert.equal(versionsUrl("PALOMAR-2026-07-29-000123", base).href,
    "https://data.example.org/versions/PALOMAR-2026-07-29-000123.json");
  assert.throws(() => versionsUrl("../../etc/passwd", base), /malformed/);
  assert.throws(() => versionsUrl("PALOMAR-2026-07-29-00012", base), /malformed/);
});

test("browse enumerates every schema-v1 history row without becoming an entry schema", () => {
  assert.equal(RECENT_SCHEMA_VERSION, 1);
  assert.equal(VERSIONS_SCHEMA_VERSION, 1);
  assert.equal(BROWSE_SCHEMA_VERSION, 1);
  const row = {
    id: "PALOMAR-2026-07-29-000123",
    version: 1,
    title: "A result",
    status: "accepted",
    path: "entries/PALOMAR-2026-07-29-000123-v1.json",
  };
  const yearRow = { year: "2026", days: 1, results: 1, versions: 1 };
  const head = {
    schema_version: 1,
    results: 1,
    versions: 1,
    year_path: "browse/{year}.json",
    years: [yearRow],
  };
  const dayRow = {
    day: "2026-07-29",
    first_page: 1,
    last_page: 1,
    results: 1,
    versions: 1,
  };
  const year = {
    schema_version: 1,
    year: "2026",
    page_path: "browse/{day}/{page}.json",
    days: [dayRow],
  };
  const page = { schema_version: 1, day: dayRow.day, page: 1, entries: [row] };
  assert.equal(validateBrowseHead(head), head);
  assert.equal(validateBrowseYear(year, yearRow), year);
  assert.equal(validateBrowsePage(page, dayRow.day, 1), page);

  assert.throws(
    () => validateBrowseHead({ ...head, versions: 2 }),
    /counts do not equal/,
  );
  assert.throws(
    () => validateBrowseYear({ ...year, year: "2027" }, yearRow),
    /different year/,
  );
  assert.throws(
    () => validateBrowsePage({ ...page, page: 2 }, dayRow.day, 1),
    /identity does not match/,
  );
  assert.throws(
    () => validateBrowsePage({ ...page, schema_version: 2 }, dayRow.day, 1),
    /schema_version/,
  );
});

test("the producer-supplied browse head, year, and page keep Web's exact contract", async () => {
  // CI overwrites these checked snapshots from the live producer before this
  // test. Keeping the three levels legible here makes an exactObject failure
  // name the producer/consumer surface that drifted, rather than leaving that
  // shape implicit inside the complete public traversal.
  const fixture = (name) => new URL(`fixtures/public-browse/${name}.json`, import.meta.url);
  const head = JSON.parse(await readFile(fixture("index"), "utf8"));
  const expectedYear = head.years.at(-1);
  assert.ok(expectedYear, "the producer browse head has no year to exercise");
  const year = JSON.parse(await readFile(fixture("year"), "utf8"));
  const expectedDay = year.days.at(-1);
  assert.ok(expectedDay, "the producer browse year has no day to exercise");
  const page = JSON.parse(await readFile(fixture("page"), "utf8"));

  assert.equal(validateBrowseHead(head), head);
  assert.equal(validateBrowseYear(year, expectedYear), year);
  assert.equal(validateBrowsePage(page, expectedDay.day, expectedDay.first_page), page);
  // The producer's own templates, expanded against the producer's own rows,
  // are the paths CI fetched these three snapshots from. Checking that here is
  // what makes them a statement about where the documents are rather than two
  // strings nothing compares to anything.
  assert.equal(head.year_path.replace("{year}", expectedYear.year), "browse/2026.json");
  assert.equal(
    year.page_path.replace("{day}", expectedDay.day).replace("{page}", expectedDay.first_page),
    `browse/${page.day}/${page.page}.json`,
  );
});

test("the path a collection publishes for the level below is the one this reader knows", () => {
  // These templates exist for a reader that has the document and not the
  // grammar. This reader has the grammar, so the only question it can usefully
  // ask is whether the producer is telling everybody else the same thing --
  // and asking it by equality is also what stops a template being a path the
  // data origin chooses and this consumer follows.
  const yearRow = { year: "2026", days: 1, results: 1, versions: 1 };
  const head = {
    schema_version: 1,
    results: 1,
    versions: 1,
    year_path: "browse/{year}.json",
    years: [yearRow],
  };
  const year = {
    schema_version: 1,
    year: "2026",
    page_path: "browse/{day}/{page}.json",
    days: [{ day: "2026-07-29", first_page: 1, last_page: 1, results: 1, versions: 1 }],
  };

  assert.equal(validateBrowseHead(head), head);
  assert.equal(validateBrowseYear(year, yearRow), year);

  for (const wrong of [
    "browse/{year}.JSON",
    "browse/{yyyy}.json",
    "https://elsewhere.example/browse/{year}.json",
    "../{year}.json",
    "subjects/arxiv/math.CO/{year}.json",
    "",
  ]) {
    assert.throws(() => validateBrowseHead({ ...head, year_path: wrong }), /year_path must be/);
  }
  for (const wrong of [
    "browse/{day}/{page}",
    "browse/{page}/{day}.json",
    "https://elsewhere.example/browse/{day}/{page}.json",
    "subjects/arxiv/math.CO/{day}/{page}.json",
    "",
  ]) {
    assert.throws(
      () => validateBrowseYear({ ...year, page_path: wrong }, yearRow),
      /page_path must be/,
    );
  }

  const { year_path: _absent, ...headless } = head;
  const { page_path: _missing, ...yearless } = year;
  assert.throws(() => validateBrowseHead(headless), /invalid shape/);
  assert.throws(() => validateBrowseYear(yearless, yearRow), /invalid shape/);
});

function subjectRow(overrides = {}) {
  return {
    id: "PALOMAR-2026-07-29-000123",
    version: 1,
    title: "A result",
    status: "accepted",
    path: "entries/PALOMAR-2026-07-29-000123-v1.json",
    published_at: "2026-07-29T09:14:07Z",
    classification: { arxiv: ["math.CO"], msc2020: ["05C10"] },
    abstract: "An abstract.",
    ...overrides,
  };
}

function subjectFixture() {
  const front = subjectRow();
  const older = subjectRow({
    id: "PALOMAR-2026-07-28-000001",
    path: "entries/PALOMAR-2026-07-28-000001-v1.json",
    published_at: "2026-07-28T09:14:07Z",
  });
  const { abstract: _dropped, ...archived } = front;
  const yearRow = { year: "2026", days: 2, results: 2, versions: 2 };
  return {
    front,
    older,
    archived,
    yearRow,
    head: {
      schema_version: 1,
      kind: "arxiv",
      code: "math.CO",
      entries: [front, older],
      results: 2,
      versions: 2,
      year_path: "subjects/arxiv/math.CO/{year}.json",
      years: [yearRow],
    },
    year: {
      schema_version: 1,
      year: "2026",
      page_path: "subjects/arxiv/math.CO/{day}/{page}.json",
      days: [
        { day: "2026-07-28", first_page: 1, last_page: 1, results: 1, versions: 1 },
        { day: "2026-07-29", first_page: 1, last_page: 1, results: 1, versions: 1 },
      ],
    },
    page: { schema_version: 1, day: "2026-07-29", page: 1, entries: [archived] },
  };
}

test("a code's archive names its own pages and never the registry's", () => {
  // The same layout under a different directory, so the templates have to be
  // that code's own. A subject document carrying browsing's templates would
  // send a reader who followed them to the whole registry under the code's
  // heading, which is the one thing a well-formed subject document can still
  // get wrong here.
  const { head, year, yearRow } = subjectFixture();

  assert.equal(head.year_path, "subjects/arxiv/math.CO/{year}.json");
  assert.equal(year.page_path, "subjects/arxiv/math.CO/{day}/{page}.json");
  assert.equal(validateSubjectYear(year, yearRow, "arxiv", "math.CO"), year);

  assert.throws(
    () => validateSubjectHead({ ...head, year_path: "browse/{year}.json" }, "arxiv", "math.CO"),
    /year_path must be subjects\/arxiv\/math\.CO/,
  );
  assert.throws(
    () => validateSubjectYear(
      { ...year, page_path: "browse/{day}/{page}.json" }, yearRow, "arxiv", "math.CO",
    ),
    /page_path must be subjects\/arxiv\/math\.CO/,
  );
  // The templates a different code publishes are also the wrong ones, so the
  // check is against the code that was asked for and not merely against the
  // shape of a subject path.
  assert.throws(
    () => validateSubjectYear(year, yearRow, "msc", "05C10"),
    /page_path must be subjects\/msc\/05C10/,
  );
  assert.throws(
    () => validateSubjectYear(year, yearRow, "arxiv", "../../etc/passwd"),
    /malformed/,
  );
});

test("a subject URL cannot leave its own directory or name a code that is not one", () => {
  const base = "https://data.example.org/";
  assert.equal(
    subjectHeadUrl("arxiv", "math.CO", base).href,
    "https://data.example.org/subjects/arxiv/math.CO.json",
  );
  assert.equal(
    subjectYearUrl("msc", "05C10", "2026", base).href,
    "https://data.example.org/subjects/msc/05C10/2026.json",
  );
  assert.equal(
    subjectPageUrl("msc", "11-02", "2026-07-29", 3, base).href,
    "https://data.example.org/subjects/msc/11-02/2026-07-29/3.json",
  );
  assert.throws(() => subjectHeadUrl("feeds", "math.CO", base), /unknown classification scheme/);
  assert.throws(() => subjectHeadUrl("arxiv", "../../etc/passwd", base), /malformed/);
  assert.throws(() => subjectHeadUrl("msc", "math.CO", base), /malformed/);
  assert.throws(() => subjectYearUrl("arxiv", "math.CO", "20xx", base), /year is malformed/);
  assert.throws(
    () => subjectPageUrl("arxiv", "math.CO", "2026-07-29", 0, base),
    /outside the identifier page range/,
  );
});

test("a subject document is refused unless it is about the code that was asked for", () => {
  assert.equal(SUBJECT_SCHEMA_VERSION, 1);
  const { head, year, yearRow, page, front, archived } = subjectFixture();

  assert.deepEqual(validateSubjectHead(head, "arxiv", "math.CO").entries.map((row) => row.id), [
    front.id,
    "PALOMAR-2026-07-28-000001",
  ]);
  assert.equal(validateSubjectYear(year, yearRow, "arxiv", "math.CO"), year);
  assert.deepEqual(
    validateSubjectPage(page, "arxiv", "math.CO", "2026-07-29", 1).entries.map((row) => row.id),
    [archived.id],
  );

  assert.throws(
    () => validateSubjectHead(head, "arxiv", "math.MG"),
    /is for a different classification code/,
  );
  assert.throws(
    () => validateSubjectHead({ ...head, schema_version: 2 }, "arxiv", "math.CO"),
    /schema_version/,
  );
  // A row that is a perfectly good row, under a heading it has nothing to do
  // with. Without the classification on the row there would be nothing here
  // able to tell.
  const foreign = subjectRow({ classification: { arxiv: ["math.MG"], msc2020: ["05C10"] } });
  assert.throws(
    () => validateSubjectHead({ ...head, entries: [foreign], results: 1, versions: 1,
      years: [{ ...yearRow, days: 1, results: 1, versions: 1 }] }, "arxiv", "math.CO"),
    /is not classified math\.CO/,
  );
  assert.throws(
    () => validateSubjectHead({ ...head, entries: [head.entries[1], head.entries[0]] },
      "arxiv", "math.CO"),
    /are not newest first/,
  );
  // The front page is the whole of the code or the publisher's cap on it, and
  // every row is one current version of a distinct result.
  assert.throws(
    () => validateSubjectHead({ ...head, entries: [front] }, "arxiv", "math.CO"),
    /does not carry the rows it says it has/,
  );
  assert.throws(
    () => validateSubjectHead({ ...head, results: 1 }, "arxiv", "math.CO"),
    /counts a result that is not one current version/,
  );
  assert.throws(
    () => validateSubjectHead({ ...head, entries: [front, front] }, "arxiv", "math.CO"),
    /repeats a result already on this page/,
  );
  assert.throws(
    () => validateSubjectPage({ ...page, entries: [archived, archived] },
      "arxiv", "math.CO", "2026-07-29", 1),
    /not in increasing identity order/,
  );
  // A shape that is a grammar and not a moment. It reaches a date formatter,
  // which throws on what it cannot format, so it is refused here instead.
  assert.throws(
    () => validateSubjectHead(
      { ...head, entries: [subjectRow({ published_at: "2026-02-30T00:00:00Z" }), head.entries[1]] },
      "arxiv",
      "math.CO",
    ),
    /published_at is malformed/,
  );
  // The front page carries abstracts and the archive pages do not, and each is
  // refused the other's shape rather than tolerating both.
  assert.throws(
    () => validateSubjectPage({ ...page, entries: [front] }, "arxiv", "math.CO", "2026-07-29", 1),
    /invalid shape/,
  );
  assert.throws(
    () => validateSubjectHead({ ...head, entries: [archived, head.entries[1]] },
      "arxiv", "math.CO"),
    /invalid shape/,
  );
  assert.throws(
    () => validateSubjectPage(page, "arxiv", "math.CO", "2026-07-28", 1),
    /identity does not match/,
  );
  // The day in the identifier is the day of the page, so a row that belongs on
  // another day cannot be served on this one whatever the document says.
  assert.throws(
    () => validateSubjectPage(
      { ...page, day: "2026-07-28", entries: [archived] },
      "arxiv",
      "math.CO",
      "2026-07-28",
      1,
    ),
    /does not belong on this page/,
  );
});

const SEARCH_BASE = "https://data.example.test/";

function searchHead(overrides = {}) {
  return {
    schema_version: 1,
    term: "ring",
    page_size: 128,
    pages: 2,
    results: 130,
    ...overrides,
  };
}

test("a query becomes a path only when every word could be one", () => {
  // There is no dictionary to check a word against before asking for it: a
  // document naming every known word would grow with the registry and be
  // rewritten on every publication. So the grammar is the whole defence, and
  // it has to refuse everything a word cannot be.
  assert.equal(
    searchHeadUrl("ring", SEARCH_BASE).href,
    "https://data.example.test/search/t/ring/head.json",
  );
  assert.equal(
    searchPageUrl("ring", 17, SEARCH_BASE).href,
    "https://data.example.test/search/t/ring/17.json",
  );
  for (const hostile of ["", "a", "Ring", "ring!", "../entries/x", "ring/0", "r".repeat(33), 7]) {
    assert.throws(() => searchHeadUrl(hostile, SEARCH_BASE), /search term/, String(hostile));
  }
  for (const page of [-1, 1.5, 2048, Number.MAX_SAFE_INTEGER, "0"]) {
    assert.throws(() => searchPageUrl("ring", page, SEARCH_BASE), /page number/, String(page));
  }
});

test("the words of a query are folded exactly as the indexer folded them", () => {
  // Three steps in one order: decompose, drop the combining marks, lowercase.
  // A query folded any other way asks for a word that was never written, which
  // from here is indistinguishable from no results.
  assert.deepEqual(searchTerms("Erdős–Kähler rings"), ["erdos", "kahler", "rings"]);
  assert.deepEqual(searchTerms("../../etc/passwd %2e%2e"), ["etc", "passwd", "2e", "2e"]);
  // Nothing is stemmed: `ring` and `rings` are different questions in a
  // registry of mathematics.
  assert.deepEqual(searchTerms("ring rings"), ["ring", "rings"]);
  // Dropped rather than escaped, so nothing outside the grammar can reach a path.
  assert.deepEqual(searchTerms("a \u{1f600} <script>"), ["script"]);
  assert.deepEqual(searchTerms("x".repeat(33)), []);
});

test("a postings head must account for the pages it sends a reader after", () => {
  // The head is an instruction, not data: its numbers become the next requests.
  // One claiming more pages than its sequence has sends a reader after pages
  // that are not there; one claiming fewer hides results while staying a
  // perfectly well-formed document.
  assert.equal(validateSearchHead(searchHead(), "ring").results, 130);
  assert.equal(validateSearchHead(searchHead({ pages: 0, results: 0 }), "ring").pages, 0);

  assert.throws(() => validateSearchHead(searchHead(), "field"), /different word/);
  assert.throws(() => validateSearchHead(searchHead({ pages: 3 }), "ring"), /does not cover/);
  assert.throws(() => validateSearchHead(searchHead({ pages: 1 }), "ring"), /does not cover/);
  assert.throws(
    () => validateSearchHead(searchHead({ page_size: 1, pages: 2049, results: 2049 }), "ring"),
    /more pages/,
  );
  assert.throws(() => validateSearchHead(searchHead({ page_size: 1025 }), "ring"), /page_size/);
  assert.throws(() => validateSearchHead(searchHead({ schema_version: 2 }), "ring"), /schema_version/);
});

test("a postings page must be the page it was asked for, in order, and no longer", () => {
  const head = searchHead({ page_size: 4, pages: 2, results: 8 });
  const page = (postings, overrides = {}) => ({
    schema_version: 1,
    term: "ring",
    page: 1,
    postings,
    ...overrides,
  });
  const rows = [
    "PALOMAR-2026-07-29-000001-v1",
    "PALOMAR-2026-07-29-000002-v1",
  ];
  assert.equal(validateSearchPage(page(rows), "ring", 1, head).postings.length, 2);

  assert.throws(() => validateSearchPage(page(rows), "field", 1, head), /different word/);
  assert.throws(() => validateSearchPage(page(rows), "ring", 0, head), /not the page/);
  assert.throws(() => validateSearchPage(page(rows, { page: 2 }), "ring", 2, head), /past the end/);
  // A page that repeated a posting, or padded itself with the same result over
  // and over, would be a well-formed page that showed one reader the same work
  // several times under a search it may not match at all.
  assert.throws(
    () => validateSearchPage(page([rows[1], rows[0]]), "ring", 1, head),
    /increasing order/,
  );
  assert.throws(() => validateSearchPage(page([rows[0], rows[0]]), "ring", 1, head), /increasing order/);
  assert.throws(
    () => validateSearchPage(page([...rows, ...rows.map((row) => row.replace("-v1", "-v2"))
      .concat("PALOMAR-2026-07-29-000003-v1")]), "ring", 1, head),
    /longer than the head allows/,
  );
  assert.throws(() => validateSearchPage(page(["PALOMAR-2026-07-29-000001"]), "ring", 1, head),
    /malformed/);
  assert.throws(() => validateSearchPage(page(rows, { schema_version: 2 }), "ring", 1, head),
    /schema_version/);
});

test("a posting resolves straight to the record it names", () => {
  // The whole reason postings carry the identifier rather than a position:
  // there is no second surface between a hit and the record.
  assert.equal(
    postingRecordUrl("PALOMAR-2026-07-29-000123-v2", SEARCH_BASE).href,
    "https://data.example.test/entries/PALOMAR-2026-07-29-000123-v2.json",
  );
  for (const hostile of ["PALOMAR-2026-07-29-000123", "../index", "PALOMAR-2026-07-29-000123-v0", 1]) {
    assert.throws(() => postingRecordUrl(hostile, SEARCH_BASE), /posting is malformed/);
  }
});

test("the published stopword list is read, and refused if it becomes a dictionary", () => {
  // The one document in this surface that names words. It is not the term
  // dictionary the index exists without: a fixed editorial choice of function
  // words is the same size at a hundred thousand results, where a document
  // naming every known word grows with the vocabulary and is rewritten on
  // every publication. So the bound is what keeps the two apart, and it is
  // checked here rather than assumed.
  assert.equal(
    stopwordsUrl(SEARCH_BASE).href,
    "https://data.example.test/search/stopwords.json",
  );
  const dropped = validateStopwords({ schema_version: 1, stopwords: ["the", "of"] });
  assert.ok(dropped.has("the") && !dropped.has("ring"));

  assert.throws(
    () => validateStopwords({ schema_version: 1, stopwords: ["The"] }),
    /not a word/,
  );
  assert.throws(
    () => validateStopwords({ schema_version: 1, stopwords: [7] }),
    /must be a non-empty string/,
  );
  assert.throws(
    () => validateStopwords({
      schema_version: 1,
      stopwords: Array.from({ length: 2001 }, (_unused, index) => `w${index}`),
    }),
    /term dictionary/,
  );
  assert.throws(
    () => validateStopwords({ schema_version: 2, stopwords: [] }),
    /schema_version/,
  );
});

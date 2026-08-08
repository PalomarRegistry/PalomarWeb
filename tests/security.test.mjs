import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { htmlFiles } from "../scripts/build-site.mjs";
import {
  COMMIT,
  DIGEST,
  availabilityEndpoint,
  availabilityManifest,
  availabilityRow,
  entry,
  recent,
  recentRow,
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
  pinnedSourceDirectoryUrl,
  pinnedSourceFileUrl,
  safeDataUrl,
  safeExternalUrl,
  safeInternalUrl,
  selectDatabaseUrl,
  selectAvailabilityUrl,
  selectRenderBase,
  recentUrl,
  tombstoneUrl,
  validateEntry,
  validateAvailability,
  validateBrowseHead,
  validateBrowsePage,
  validateBrowseYear,
  validateRecent,
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
const AVAILABILITY_PRODUCER_COMMIT = "7e446fda08d26b5c1290a9e3ec0947ece0c4994e";

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
  const checkout = process.env.PALOMAR_DATABASE_CHECKOUT
    ?? new URL("../../PalomarDatabase/", import.meta.url).pathname;
  const fixture = JSON.parse(
    await readFile(new URL("tests/fixtures/recent.json", `file://${checkout}/`), "utf8"),
  );
  assert.ok(fixture.entries.length > 0, "the external contract fixture must exercise a row");
  assert.equal(validateRecent(fixture), fixture);
});

test("an empty recent registry is valid", () => {
  assert.deepEqual(validateRecent(recent([])).entries, []);
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
  assert.equal(
    pinnedSourceFileUrl(entry(), "Challenge.lean").href,
    `https://github.com/example/challenge/blob/${COMMIT}/Challenge.lean`,
  );
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

test("availability agrees with the Database producer contract", async () => {
  const checkout = process.env.PALOMAR_DATABASE_CHECKOUT
    ?? new URL("../../PalomarDatabase/", import.meta.url).pathname;
  const executable = new URL("tools/source_availability_contract.py", `file://${checkout}/`);
  try {
    await readFile(executable, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    // CI cannot read the private canonical repository, so the existing
    // cross-repository mechanism supplies the producer's published object at
    // the same checkout root. This remains a mandatory exercised contract,
    // not a skip; local development invokes the exact executable below.
    const fixture = JSON.parse(await readFile(
      new URL("tests/fixtures/source-availability.json", `file://${checkout}/`),
      "utf8",
    ));
    assert.ok(fixture.repositories.length > 0, "the deployed contract must exercise a row");
    assert.equal(
      fixture.coverage?.freshness_max_age_seconds,
      AVAILABILITY_MAX_AGE_MS / 1_000,
      "the deployed producer and consumer must share the freshness policy",
    );
    assert.deepEqual(validateAvailability(fixture), fixture);
    return;
  }
  try {
    execFileSync(
      "git",
      ["-C", checkout, "merge-base", "--is-ancestor", AVAILABILITY_PRODUCER_COMMIT, "HEAD"],
    );
  } catch {
    assert.fail(
      `PalomarDatabase checkout ${checkout} is older than the required ` +
        `source-availability contract ${AVAILABILITY_PRODUCER_COMMIT}; fetch current main`,
    );
  }
  const raw = availabilityManifest([
    availabilityRow({
      original: availabilityEndpoint({
        status: "missing",
        checked_at: "2026-08-07T17:59:59Z",
      }),
      archive: availabilityEndpoint({
        checked_at: "2026-08-08T12:05:00Z",
        last_attempt_at: null,
      }),
    }),
  ]);
  const script = [
    "import datetime as dt, json, pathlib, sys",
    `sys.path.insert(0, str(pathlib.Path(${JSON.stringify(checkout)}) / 'tools'))`,
    "from source_availability_contract import normalize_manifest",
    "value = normalize_manifest(json.load(sys.stdin), as_of=dt.datetime(2026, 8, 8, 12, tzinfo=dt.UTC))",
    "json.dump(value, sys.stdout, sort_keys=True)",
  ].join("; ");
  const produced = JSON.parse(execFileSync("python3", ["-c", script], {
    encoding: "utf8",
    input: JSON.stringify(raw),
  }));

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
  const about = await readFile(new URL("../about.html", import.meta.url), "utf8");
  assert.match(about, /https:\/\/submit\.palomar-registry\.org\//);
  assert.match(about, /Not public unless you register/);
  assert.match(about, /Nothing is registered until you ask for it/);
  assert.doesNotMatch(about, /GitHub issue/i);
});

test("About describes the current review and version contracts", async () => {
  const about = await readFile(new URL("../about.html", import.meta.url), "utf8");
  assert.match(about, /Palomar addresses only limited\s+aspects\s+of these criteria/);
  assert.match(about, /This is not a substitute for\s+expert review/);
  assert.match(about, /Corrections and dependency updates may be registered as new versions/);
  assert.match(about, /A new mathematical result receives a new ID/);
  assert.match(about, /Acceptance is not\s+registration/);
  assert.doesNotMatch(about, /durable-evidence schema \(version 5\)/);
  assert.match(about, /review-failed/);
  assert.match(about, /operational fault, not a decision/);
});

test("About says what registration publishes, and what it does not", async () => {
  // About said the submitter's identity becomes public on registration. It
  // does not, the schema has no field for it, and that is the direction of
  // error nobody reports. It also promised the "full review", which is not
  // what is published either.
  const about = await readFile(new URL("../about.html", import.meta.url), "utf8");
  assert.match(about, /the registry record has no field for the person who sent a\s+submission/);
  assert.doesNotMatch(about, /full review are\s+publicly visible/);
  assert.match(about, /The published review is redacted/);
  assert.match(about, /scored 5 and then 4 on one axis/);
  for (const anchor of ["#editorial-review", "#submission-lifecycle-and-privacy"]) {
    assert.match(
      about,
      new RegExp(`PalomarPolicy/blob/main/docs/specification\\.md${anchor}`),
      `About should link the specification at ${anchor} rather than restate it`,
    );
  }
});

test("About describes both ways push access is proved", async () => {
  // A sign-in and the agent's tag-and-gist do not establish the same thing,
  // and step 3 used to name only the first.
  const about = await readFile(new URL("../about.html", import.meta.url), "utf8");
  assert.match(about, /There are two ways to prove that write access/);
  assert.match(about, /not provably the same\s+account/);
  assert.match(about, /Neither is proof of\s+authorship/);
});

test("About states the repository licence boundary", async () => {
  const about = await readFile(new URL("../about.html", import.meta.url), "utf8");
  assert.match(about, /root licence file, SPDX identifier, and checksum/);
  assert.match(about, /reused formalizations, and\s+dependencies retain their own licences/);
  assert.match(about, /repository root is the default project directory/);
  assert.match(about, /licence file remains at repository root/);
});

test("every provenance value the schema allows has an explicit label", async () => {
  // The renderer once used a binary fallback, so a value nobody stated was
  // displayed as a positive claim about someone's work. Anything the
  // validator accepts must have a label of its own.
  // The authoritative schema lives in PalomarDatabase. CI checks it out and
  // sets PALOMAR_DATABASE_CHECKOUT; locally a sibling clone is assumed. This
  // test exists because the site drifting from the schema is what took the
  // registry down, so an unavailable schema is a failure, not a skip.
  const checkout = process.env.PALOMAR_DATABASE_CHECKOUT
    ?? new URL("../../PalomarDatabase/", import.meta.url).pathname;
  const schema = JSON.parse(
    await readFile(new URL("schema-v2.json", `file://${checkout}/`), "utf8"),
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
  const checkout = process.env.PALOMAR_DATABASE_CHECKOUT
    ?? new URL("../../PalomarDatabase/", import.meta.url).pathname;
  const schema = JSON.parse(
    await readFile(new URL("schema-v2.json", `file://${checkout}/`), "utf8"),
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
    assert.match(html, /rel="icon" href="favicon\.svg"/, `${name} does not ask for the favicon`);
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
  const head = { schema_version: 1, results: 1, versions: 1, years: [yearRow] };
  const dayRow = {
    day: "2026-07-29",
    first_page: 1,
    last_page: 1,
    results: 1,
    versions: 1,
  };
  const year = { schema_version: 1, year: "2026", days: [dayRow] };
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

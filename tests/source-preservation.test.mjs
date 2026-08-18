import assert from "node:assert/strict";
import test from "node:test";

import {
  createSourceAvailabilityBinding,
  decorateCardSet,
  sourceDirectoryUrl,
  sourceFileUrl,
  sourceLocation,
  topSourceLocation,
} from "../assets/source-preservation.mjs";
import { validateAvailability, validateEntry, validateRecent } from "../assets/security.mjs";
import {
  COMMIT,
  availabilityEndpoint,
  availabilityManifest,
  availabilityRow,
  entry,
  recent,
  recentRow,
  summary,
} from "./registry-fixture.mjs";

const CHECKED_AT = new Date(Math.floor(Date.now() / 1_000) * 1_000)
  .toISOString()
  .replace(".000Z", "Z");

function manifest({
  original = "available",
  archive = "available",
  forkRepository = "PalomarArchive/example--challenge--fixture",
} = {}) {
  return validateAvailability(availabilityManifest([
    availabilityRow({
      fork_repository: forkRepository,
      original: availabilityEndpoint({ status: original, checked_at: CHECKED_AT }),
      archive: availabilityEndpoint({ status: archive, checked_at: CHECKED_AT }),
    }),
  ], { generated_at: CHECKED_AT }));
}

function acceptedEntry(mutate = () => {}) {
  const record = entry();
  mutate(record);
  return validateEntry(record, summary());
}

function fakeCard() {
  let missing = null;
  const repositoryLink = {
    href: "",
    textContent: "Recorded repository",
    focus() {
      document.activeElement = this;
    },
  };
  const archiveLink = {
    hidden: false,
    href: "",
    insertAdjacentElement(position, element) {
      assert.equal(position, "afterend");
      missing = element;
      element.remove = () => {
        missing = null;
      };
    },
  };
  return {
    archiveLink,
    element: {
      querySelector(selector) {
        if (selector === ".repo-link") return repositoryLink;
        if (selector === ".archive-link") return archiveLink;
        if (selector === ".source-status.missing") return missing;
        return null;
      },
    },
    get missing() {
      return missing;
    },
    repositoryLink,
  };
}

function withFakeDocument(run) {
  const previousDocument = globalThis.document;
  const previousWarn = console.warn;
  const warnings = [];
  globalThis.document = {
    activeElement: null,
    createElement(tag) {
      assert.equal(tag, "span");
      return { className: "", textContent: "" };
    },
  };
  console.warn = (message) => warnings.push(message);
  try {
    run(warnings);
  } finally {
    console.warn = previousWarn;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
}

test("source location switches only from a confirmed missing original to its recorded archive", () => {
  const record = acceptedEntry();
  const availability = manifest({ original: "missing", archive: "available" });
  const location = sourceLocation(
    record,
    availability,
    record.source.repository,
    record.source.commit,
  );

  assert.deepEqual(location, {
    repository: "PalomarArchive/example--challenge--fixture",
    originalRepository: "example/challenge",
    archiveRepository: "PalomarArchive/example--challenge--fixture",
    commit: COMMIT,
    originalStatus: "missing",
    archiveStatus: "available",
    checkedAt: CHECKED_AT,
    useArchive: true,
  });
  assert.equal(
    sourceFileUrl(record, "Challenge.lean", availability).href,
    `https://github.com/PalomarArchive/example--challenge--fixture/blob/${COMMIT}/Challenge.lean`,
  );
  assert.equal(
    sourceDirectoryUrl(record, "Palomar", availability).href,
    `https://github.com/PalomarArchive/example--challenge--fixture/tree/${COMMIT}/Palomar`,
  );
});

test("availability bindings publish once to current and late source controls", async () => {
  let release;
  const warnings = [];
  const binding = createSourceAvailabilityBinding(
    new Promise((resolve) => {
      release = resolve;
    }),
    (message) => warnings.push(message),
  );
  const published = [];
  binding.whenReady((value) => published.push(value));
  assert.equal(binding.current, null);

  const availability = manifest();
  release(availability);
  assert.equal(await binding.ready, availability);
  assert.equal(binding.current, availability);
  assert.deepEqual(published, [availability]);
  let late = null;
  binding.whenReady((value) => {
    late = value;
  });
  assert.equal(late, availability);
  assert.deepEqual(warnings, []);
});

test("one broken availability control cannot block its siblings", async () => {
  const warnings = [];
  const binding = createSourceAvailabilityBinding(
    Promise.resolve(manifest()),
    (message) => warnings.push(message),
  );
  let siblingUpdated = false;
  binding.whenReady(() => {
    throw new Error("broken control");
  });
  binding.whenReady(() => {
    siblingUpdated = true;
  });

  await binding.ready;
  assert.equal(siblingUpdated, true);
  assert.deepEqual(warnings, [
    "Entry source availability could not be applied: broken control",
  ]);
});

test("source location does not switch when both original and archive are missing", () => {
  const location = topSourceLocation(
    acceptedEntry(),
    manifest({ original: "missing", archive: "missing" }),
  );
  assert.equal(location.repository, "example/challenge");
  assert.equal(location.originalStatus, "missing");
  assert.equal(location.archiveStatus, "missing");
  assert.equal(location.useArchive, false);
});

test("source location ignores availability for a different preserved fork", () => {
  const location = topSourceLocation(
    acceptedEntry(),
    manifest({
      original: "missing",
      forkRepository: "PalomarArchive/example--challenge--other",
    }),
  );
  assert.equal(location.repository, "example/challenge");
  assert.equal(location.originalStatus, "unknown");
  assert.equal(location.archiveStatus, "unknown");
  assert.equal(location.checkedAt, null);
});

test("source location rejects a repository revision absent from the preservation receipt", () => {
  assert.throws(
    () => sourceLocation(acceptedEntry(), null, "example/other", COMMIT),
    /entry has no preserved copy of example\/other@/,
  );
});

test("source location rejects raw records and receipts changed after validation", () => {
  assert.throws(
    () => topSourceLocation(entry(), null),
    /source record was not validated/,
  );

  const missing = acceptedEntry();
  delete missing.preservation;
  assert.throws(
    () => topSourceLocation(missing, null),
    /preservation receipt changed/,
  );

  const replaced = acceptedEntry();
  replaced.preservation = {
    ...replaced.preservation,
    repositories: [...replaced.preservation.repositories],
  };
  assert.throws(
    () => topSourceLocation(replaced, null),
    /preservation receipt changed/,
  );
});

test("validation's one receipt traversal serves every later source lookup", () => {
  const record = entry();
  const rows = record.preservation.repositories;
  let rowReads = 0;
  record.preservation.repositories = new Proxy(rows, {
    get(target, property, receiver) {
      if (typeof property === "string" && /^[0-9]+$/.test(property)) rowReads += 1;
      return Reflect.get(target, property, receiver);
    },
  });
  validateEntry(record, summary());
  assert.equal(rowReads, rows.length, "validation traverses the receipt exactly once");
  const serialized = JSON.stringify(record);
  rowReads = 0;

  for (let repetition = 0; repetition < 25; repetition += 1) {
    sourceLocation(record, null, record.source.repository, record.source.commit);
    sourceLocation(
      record,
      null,
      record.formalization.project_dependencies[0].repository,
      record.formalization.project_dependencies[0].revision,
    );
  }

  assert.equal(rowReads, 0, "presentation never traverses the receipt after validation");
  assert.equal(JSON.stringify(record), serialized, "the private index does not alter serialized data");
});

test("post-validation receipt-row mutation cannot change the validated mapping", () => {
  const record = acceptedEntry();
  const acceptedFork = record.preservation.repositories[0].fork_repository;
  record.preservation.repositories[0].source_repository = "example/changed";
  record.preservation.repositories[0].commit = "b".repeat(40);
  record.preservation.repositories[0].fork_repository = "PalomarArchive/example--changed";
  record.preservation.repositories.push({ ...record.preservation.repositories[0] });

  assert.equal(topSourceLocation(record, null).archiveRepository, acceptedFork);
  assert.throws(
    () => sourceLocation(record, null, "example/changed", "b".repeat(40)),
    /has no preserved copy/,
  );
});

test("recent presentation also uses the mapping captured by validation", () => {
  const projection = validateRecent(recent([recentRow()]));
  const record = projection.entries[0];
  const acceptedFork = record.preservation.repositories[0].fork_repository;
  record.preservation.repositories[0].fork_repository = "PalomarArchive/example--changed";

  assert.equal(topSourceLocation(record, null).archiveRepository, acceptedFork);
});

test("a rejected recent document leaves its earlier rows unusable", () => {
  const first = recentRow();
  assert.throws(
    () => validateRecent(recent([first, recentRow()])),
    /more than once/,
  );
  assert.throws(
    () => topSourceLocation(first, null),
    /was not validated/,
  );
});

test("card decoration isolates a malformed entry and still decorates its peer", () => {
  withFakeDocument((warnings) => {
    const bad = acceptedEntry();
    bad.source = {
      ...bad.source,
      repository: "example/unpreserved",
      repository_url: "https://github.com/example/unpreserved",
    };
    const cards = [fakeCard(), fakeCard()];

    decorateCardSet(
      cards.map((card) => card.element),
      [bad, acceptedEntry()],
      manifest({ original: "missing", archive: "available" }),
      "Fixture card",
    );

    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /entry has no preserved copy of example\/unpreserved@/);
    assert.equal(cards[0].repositoryLink.textContent, "Recorded repository");
    assert.equal(cards[1].repositoryLink.textContent, "Palomar preserved copy");
    assert.equal(cards[1].archiveLink.hidden, true);
    assert.equal(cards[1].missing.textContent, "Original unavailable");
  });
});

test("card decoration reports length mismatches without throwing in its error handler", () => {
  withFakeDocument((warnings) => {
    const cards = [fakeCard(), fakeCard()];
    assert.doesNotThrow(() => decorateCardSet(
      cards.map((card) => card.element),
      [acceptedEntry()],
      manifest({ original: "missing", archive: "available" }),
      "Fixture card",
    ));

    assert.equal(warnings.length, 2);
    assert.match(warnings[0], /received 2 cards for 1 entries/);
    assert.match(warnings[1], /Fixture card source availability could not be applied to card 2:/);
    assert.equal(cards[0].repositoryLink.textContent, "Palomar preserved copy");
  });
});

test("card decoration transfers focus before hiding the archive link", () => {
  withFakeDocument((warnings) => {
    const card = fakeCard();
    document.activeElement = card.archiveLink;

    decorateCardSet(
      [card.element],
      [acceptedEntry()],
      manifest({ original: "missing", archive: "available" }),
      "Fixture card",
    );

    assert.deepEqual(warnings, []);
    assert.equal(card.archiveLink.hidden, true);
    assert.equal(document.activeElement, card.repositoryLink);
  });
});

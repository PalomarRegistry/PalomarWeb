import assert from "node:assert/strict";
import test from "node:test";

import {
  decorateCardSet,
  sourceDirectoryUrl,
  sourceFileUrl,
  sourceLocation,
  topSourceLocation,
} from "../assets/source-preservation.mjs";
import { validateAvailability } from "../assets/security.mjs";
import {
  COMMIT,
  availabilityEndpoint,
  availabilityManifest,
  availabilityRow,
  entry,
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
  const record = entry();
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

test("source location does not switch when both original and archive are missing", () => {
  const location = topSourceLocation(
    entry(),
    manifest({ original: "missing", archive: "missing" }),
  );
  assert.equal(location.repository, "example/challenge");
  assert.equal(location.originalStatus, "missing");
  assert.equal(location.archiveStatus, "missing");
  assert.equal(location.useArchive, false);
});

test("source location ignores availability for a different preserved fork", () => {
  const location = topSourceLocation(
    entry(),
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
    () => sourceLocation(entry(), null, "example/other", COMMIT),
    /entry has no preserved copy of example\/other@/,
  );
});

test("source location rejects a missing preservation receipt instead of falling back", () => {
  const record = entry();
  delete record.preservation;
  assert.throws(
    () => topSourceLocation(record, null),
    /no canonical source preservation receipt/,
  );
});

test("card decoration isolates a malformed entry and still decorates its peer", () => {
  withFakeDocument((warnings) => {
    const bad = entry();
    bad.source = {
      ...bad.source,
      repository: "example/unpreserved",
      repository_url: "https://github.com/example/unpreserved",
    };
    const cards = [fakeCard(), fakeCard()];

    decorateCardSet(
      cards.map((card) => card.element),
      [bad, entry()],
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
      [entry()],
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
      [entry()],
      manifest({ original: "missing", archive: "available" }),
      "Fixture card",
    );

    assert.deepEqual(warnings, []);
    assert.equal(card.archiveLink.hidden, true);
    assert.equal(document.activeElement, card.repositoryLink);
  });
});

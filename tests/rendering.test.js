import assert from "node:assert/strict";
import test from "node:test";

import {
  challengeArtifactUrl,
  challengeMetadataUrl,
  challengeSourceUrl,
  isInlineChallenge,
  renderArtifactUrl,
} from "../assets/rendering.js";

function entry(overrides = {}) {
  const value = {
    id: "PALOMAR-2026-07-29-000123",
    version: 1,
    source: {
      repository: "example/challenge",
      repository_url: "https://github.com/example/challenge",
      commit: "1".repeat(40),
    },
    preservation: {
      repositories: [
        {
          source_repository: "example/challenge",
          commit: "1".repeat(40),
          fork_repository: "PalomarArchive/challenge",
        },
      ],
    },
    formalization: {
      challenge_path: "Challenge.lean",
      theorem_names: ["Example.theorem"],
      definition_names: [],
    },
    trust: { challenge_lines: 100, challenge_bytes: 32 * 1024 },
    challenge_render: {
      format: "verso-html",
      artifact_path: `renders/PALOMAR-2026-07-29-000123-v1/${"a".repeat(64)}/`,
      entrypoint: "Challenge/index.html",
      artifact_tree_sha256: "a".repeat(64),
    },
  };
  return Object.assign(value, overrides);
}

test("inline policy is based only on the statement line count", () => {
  assert.equal(isInlineChallenge(entry()), true);
  assert.equal(isInlineChallenge(entry({ trust: { challenge_lines: 101, challenge_bytes: 1 } })), false);
  assert.equal(
    isInlineChallenge(entry({ trust: { challenge_lines: 1, challenge_bytes: 32 * 1024 + 1 } })),
    true,
  );
  const two = entry();
  two.formalization.definition_names.push("Example.definition");
  assert.equal(isInlineChallenge(two), true);
});

test("artifact URL is derived only from the content-addressed registry fields", () => {
  assert.equal(
    challengeArtifactUrl(entry(), "https://data.palomar-registry.org/").href,
    `https://data.palomar-registry.org/renders/PALOMAR-2026-07-29-000123-v1/${"a".repeat(64)}/Challenge/index.html`,
  );
  const traversal = entry();
  traversal.challenge_render.artifact_path = "renders/../../attacker/";
  assert.throws(() => challengeArtifactUrl(traversal, "https://example.test/"), /invalid/);
});

test("a maintainer correction reuses its baseline version's content-addressed render", () => {
  const corrected = entry({
    version: 2,
    registry_correction: { based_on: { version: 1 } },
  });
  assert.equal(
    challengeArtifactUrl(corrected, "https://data.palomar-registry.org/").href,
    `https://data.palomar-registry.org/renders/PALOMAR-2026-07-29-000123-v1/${"a".repeat(64)}/Challenge/index.html`,
  );

  for (const version of [0, 2, 3, 1.5]) {
    corrected.registry_correction.based_on.version = version;
    assert.throws(
      () => challengeArtifactUrl(corrected, "https://data.palomar-registry.org/"),
      /invalid Palomar identifier or version/,
    );
  }
});

test("a content address alone resolves to the same rendering a record does", () => {
  const record = entry();
  assert.equal(
    renderArtifactUrl(
      record.id,
      record.version,
      record.challenge_render.artifact_tree_sha256,
      "https://data.palomar-registry.org/",
    ).href,
    challengeArtifactUrl(record, "https://data.palomar-registry.org/").href,
  );
});

test("a content address is refused rather than encoded when it is not one", () => {
  const base = "https://data.palomar-registry.org/";
  const hash = "a".repeat(64);
  for (const [id, version, treeHash, reason] of [
    ["../../attacker", 1, hash, /identifier or version/],
    ["PALOMAR-2026-07-29-000123", 0, hash, /identifier or version/],
    ["PALOMAR-2026-07-29-000123", 1.5, hash, /identifier or version/],
    ["PALOMAR-2026-07-29-000123", 1, "../attacker", /artifact tree hash/],
    ["PALOMAR-2026-07-29-000123", 1, `${hash}/..`, /artifact tree hash/],
    ["PALOMAR-2026-07-29-000123", 1, "A".repeat(64), /artifact tree hash/],
  ]) {
    assert.throws(() => renderArtifactUrl(id, version, treeHash, base), reason);
  }
  assert.throws(
    () => renderArtifactUrl("PALOMAR-2026-07-29-000123", 1, hash, "javascript:alert(1)"),
    /HTTP or HTTPS/,
  );
});

test("artifact metadata URL stays inside the content-addressed bundle", () => {
  assert.equal(
    challengeMetadataUrl(entry(), "https://data.palomar-registry.org/").href,
    `https://data.palomar-registry.org/renders/PALOMAR-2026-07-29-000123-v1/${"a".repeat(64)}/challenge-metadata.json`,
  );
});

test("source URL is always the immutable canonical GitHub file", () => {
  assert.equal(
    challengeSourceUrl(entry()),
    `https://github.com/example/challenge/blob/${"1".repeat(40)}/Challenge.lean`,
  );
  const moving = entry();
  moving.source.commit = "main";
  assert.throws(() => challengeSourceUrl(moving), /canonical/);

  const nested = entry();
  nested.formalization.challenge_path = "project/Comparator/Task.lean";
  assert.equal(
    challengeSourceUrl(nested),
    `https://github.com/example/challenge/blob/${"1".repeat(40)}/project/Comparator/Task.lean`,
  );
  assert.equal(
    challengeSourceUrl(entry(), "PalomarArchive/challenge"),
    `https://github.com/PalomarArchive/challenge/blob/${"1".repeat(40)}/Challenge.lean`,
  );

  const unpreserved = entry();
  delete unpreserved.preservation;
  assert.throws(() => challengeSourceUrl(unpreserved), /no canonical source preservation metadata/);

  const traversal = entry();
  traversal.formalization.challenge_path = "../Task.lean";
  assert.throws(() => challengeSourceUrl(traversal), /canonical/);

  const controlCharacter = entry();
  controlCharacter.formalization.challenge_path = "project/Task\n.lean";
  assert.throws(() => challengeSourceUrl(controlCharacter), /canonical/);
});

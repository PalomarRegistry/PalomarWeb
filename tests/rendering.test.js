import assert from "node:assert/strict";
import test from "node:test";

import {
  challengeArtifactUrl,
  challengeMetadataUrl,
  challengeSourceUrl,
  entryRecordPath,
  isInlineChallenge,
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

test("inline policy includes both size limits and exactly one declaration", () => {
  assert.equal(isInlineChallenge(entry()), true);
  assert.equal(isInlineChallenge(entry({ trust: { challenge_lines: 101, challenge_bytes: 1 } })), false);
  assert.equal(
    isInlineChallenge(entry({ trust: { challenge_lines: 1, challenge_bytes: 32 * 1024 + 1 } })),
    false,
  );
  const two = entry();
  two.formalization.definition_names.push("Example.definition");
  assert.equal(isInlineChallenge(two), false);
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

test("index paths cannot redirect entry fetching", () => {
  assert.equal(
    entryRecordPath("PALOMAR-2026-07-29-000123", 1, "entries/PALOMAR-2026-07-29-000123-v1.json"),
    "entries/PALOMAR-2026-07-29-000123-v1.json",
  );
  assert.throws(
    () => entryRecordPath("PALOMAR-2026-07-29-000123", 1, "https://attacker.invalid/entry.json"),
    /invalid entry path/,
  );
});

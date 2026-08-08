export const INLINE_CHALLENGE_MAX_LINES = 100;
export const INLINE_CHALLENGE_MAX_BYTES = 32 * 1024;

const ID = /^PALOMAR-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{6}$/;
const SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function isInlineChallenge(entry) {
  const formalization = entry?.formalization;
  const trust = entry?.trust;
  const theoremNames = formalization?.theorem_names;
  const definitionNames = formalization?.definition_names;
  if (!Array.isArray(theoremNames) || !Array.isArray(definitionNames)) return false;
  return (
    theoremNames.length + definitionNames.length === 1 &&
    Number.isInteger(trust?.challenge_lines) &&
    trust.challenge_lines >= 0 &&
    trust.challenge_lines <= INLINE_CHALLENGE_MAX_LINES &&
    Number.isInteger(trust?.challenge_bytes) &&
    trust.challenge_bytes >= 0 &&
    trust.challenge_bytes <= INLINE_CHALLENGE_MAX_BYTES
  );
}

export function challengeSourceUrl(entry, repositoryOverride = null) {
  const repository = entry?.source?.repository;
  const repositoryUrl = entry?.source?.repository_url?.replace(/\/+$/, "");
  const commit = entry?.source?.commit;
  const challengePath = entry?.formalization?.challenge_path;
  try {
    safeRepositoryPath(challengePath, "Challenge source path");
  } catch {
    throw new Error("entry has invalid canonical Challenge source metadata");
  }
  if (!REPOSITORY.test(repository || "") ||
      repositoryUrl !== `https://github.com/${repository}` ||
      !SHA.test(commit || "")) {
    throw new Error("entry has invalid canonical Challenge source metadata");
  }
  const selectedRepository = repositoryOverride || repository;
  const repositories = entry?.preservation?.repositories;
  if (!Array.isArray(repositories)) {
    throw new Error("entry has no canonical source preservation metadata");
  }
  const sourceMapping = repositories.find(
    (row) => typeof row?.source_repository === "string" &&
      row.source_repository.toLowerCase() === repository.toLowerCase() &&
      row.commit === commit,
  );
  if (!sourceMapping ||
      (selectedRepository !== repository && sourceMapping.fork_repository !== selectedRepository)) {
    throw new Error("entry has invalid preserved Challenge source metadata");
  }
  return pinnedRepositoryFileUrl(selectedRepository, commit, challengePath).href;
}

export function challengeArtifactUrl(entry, renderBase) {
  const id = entry?.id;
  const version = entry?.version;
  const render = entry?.challenge_render;
  if (!ID.test(id || "") || !Number.isInteger(version) || version < 1) {
    throw new Error("entry has an invalid Palomar identifier or version");
  }
  const treeHash = render?.artifact_tree_sha256;
  const expectedPath = `renders/${id}-v${version}/${treeHash}/`;
  if (
    render?.format !== "verso-html" ||
    render?.entrypoint !== "Challenge/index.html" ||
    !SHA256.test(treeHash || "") ||
    render?.artifact_path !== expectedPath
  ) {
    throw new Error("entry has invalid Challenge render metadata");
  }
  const base = new URL(renderBase);
  if (!['http:', 'https:'].includes(base.protocol)) {
    throw new Error("Challenge render base must use HTTP or HTTPS");
  }
  return new URL(`${expectedPath}${render.entrypoint}`, base);
}

export function challengeMetadataUrl(entry, renderBase) {
  return new URL("../challenge-metadata.json", challengeArtifactUrl(entry, renderBase));
}

export function entryRecordPath(id, version, path) {
  const expected = `entries/${id}-v${version}.json`;
  if (!ID.test(id || "") || !Number.isInteger(version) || version < 1 || path !== expected) {
    throw new Error("registry index contains an invalid entry path");
  }
  return expected;
}
import { pinnedRepositoryFileUrl, safeRepositoryPath } from "./security.mjs";

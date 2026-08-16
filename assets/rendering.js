export const INLINE_CHALLENGE_MAX_LINES = 100;

// A constant of the render format rather than a field to read. A record still
// declares it, and is refused below if it declares anything else.
const CHALLENGE_ENTRYPOINT = "Challenge/index.html";

const ID = /^PALOMAR-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{6}$/;
const SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function isInlineChallenge(entry) {
  const trust = entry?.trust;
  return (
    Number.isInteger(trust?.challenge_lines) &&
    trust.challenge_lines >= 0 &&
    trust.challenge_lines <= INLINE_CHALLENGE_MAX_LINES
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

/**
 * Where one result's Verso rendering is served, from its content address.
 *
 * The path a record carries is derivable from exactly these three, and the
 * record's own `artifact_path` is checked against the derivation rather than
 * followed. So this is where the derivation lives, and both the record below
 * and the landing page's bounded companion document resolve through it: two
 * routes to the same rendering that agreed by inspection would eventually stop
 * agreeing.
 */
export function renderArtifactUrl(id, version, treeHash, renderBase) {
  if (!ID.test(id || "") || !Number.isInteger(version) || version < 1) {
    throw new Error("render target has an invalid Palomar identifier or version");
  }
  if (!SHA256.test(treeHash || "")) {
    throw new Error("render target has an invalid artifact tree hash");
  }
  const base = new URL(renderBase);
  if (!['http:', 'https:'].includes(base.protocol)) {
    throw new Error("Challenge render base must use HTTP or HTTPS");
  }
  return new URL(
    `renders/${id}-v${version}/${treeHash}/${CHALLENGE_ENTRYPOINT}`,
    base,
  );
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
    render?.entrypoint !== CHALLENGE_ENTRYPOINT ||
    !SHA256.test(treeHash || "") ||
    render?.artifact_path !== expectedPath
  ) {
    throw new Error("entry has invalid Challenge render metadata");
  }
  return renderArtifactUrl(id, version, treeHash, renderBase);
}

export function challengeMetadataUrl(entry, renderBase) {
  return new URL("../challenge-metadata.json", challengeArtifactUrl(entry, renderBase));
}
import { pinnedRepositoryFileUrl, safeRepositoryPath } from "./security.mjs";

import {
  availabilityRecord,
  pinnedRepositoryDirectoryUrl,
  pinnedRepositoryFileUrl,
} from "./security.mjs";

/** Resolve one immutable repository revision to its recorded or preserved copy. */
export function sourceLocation(entry, availability, repository, commit) {
  const repositories = entry?.preservation?.repositories;
  if (!Array.isArray(repositories)) {
    throw new Error("entry has no canonical source preservation receipt");
  }
  const mapping = repositories.find(
    (row) => row.source_repository.toLowerCase() === repository.toLowerCase() &&
      row.commit === commit,
  );
  if (!mapping) throw new Error(`entry has no preserved copy of ${repository}@${commit}`);
  const observed = availabilityRecord(availability, repository, commit);
  const status = observed &&
      observed.fork_repository.toLowerCase() === mapping.fork_repository.toLowerCase()
    ? observed
    : null;
  const originalStatus = status?.original.status || "unknown";
  const archiveStatus = status?.archive.status || "unknown";
  const useArchive = originalStatus === "missing" && archiveStatus !== "missing";
  return {
    repository: useArchive ? mapping.fork_repository : repository,
    originalRepository: repository,
    archiveRepository: mapping.fork_repository,
    commit,
    originalStatus,
    archiveStatus,
    checkedAt: status?.original.checked_at || null,
    useArchive,
  };
}

export function topSourceLocation(entry, availability) {
  return sourceLocation(entry, availability, entry.source.repository, entry.source.commit);
}

export function sourceFileUrl(entry, path, availability) {
  const location = topSourceLocation(entry, availability);
  return pinnedRepositoryFileUrl(location.repository, entry.source.commit, path);
}

export function sourceDirectoryUrl(entry, path, availability) {
  const location = topSourceLocation(entry, availability);
  return pinnedRepositoryDirectoryUrl(location.repository, entry.source.commit, path);
}

function decorateCardAvailability(card, entry, availability) {
  const location = topSourceLocation(entry, availability);
  const repositoryLink = card.querySelector(".repo-link");
  if (!repositoryLink) throw new Error("card has no repository link");
  repositoryLink.textContent = location.useArchive
    ? "Palomar preserved copy"
    : entry.source.repository;
  repositoryLink.href = pinnedRepositoryDirectoryUrl(
    location.repository,
    entry.source.commit,
  ).href;

  const archiveLink = card.querySelector(".archive-link");
  if (!archiveLink) return;
  const archiveWasFocused = document.activeElement === archiveLink;
  archiveLink.href = pinnedRepositoryDirectoryUrl(
    location.archiveRepository,
    entry.source.commit,
  ).href;
  archiveLink.hidden = location.useArchive;
  let missing = card.querySelector(".source-status.missing");
  if (location.useArchive && !missing) {
    missing = document.createElement("span");
    missing.className = "source-status missing";
    missing.textContent = "Original unavailable";
    archiveLink.insertAdjacentElement("afterend", missing);
  }
  if (!location.useArchive) missing?.remove();
  if (archiveWasFocused && location.useArchive) repositoryLink.focus();
}

/** Decorate existing cards in place without making one malformed card abort its peers. */
export function decorateCardSet(cards, entries, availability, context) {
  if (availability === null) return;
  if (cards.length !== entries.length) {
    console.warn(
      `${context} source availability received ${cards.length} cards for ` +
        `${entries.length} entries`,
    );
  }
  for (const [position, card] of cards.entries()) {
    const entry = entries[position];
    try {
      decorateCardAvailability(card, entry, availability);
    } catch (error) {
      const identity = entry?.id && entry?.version
        ? `${entry.id} v${entry.version}`
        : `card ${position + 1}`;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `${context} source availability could not be applied to ` +
          `${identity}: ${message}`,
      );
    }
  }
}

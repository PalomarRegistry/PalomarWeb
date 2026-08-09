import {
  assertValidatedSourceRecord,
  availabilityRecord,
  pinnedRepositoryDirectoryUrl,
  pinnedRepositoryFileUrl,
  safeExternalUrl,
} from "./security.mjs";

const receiptIndexes = new WeakMap();

function receiptIndex(entry) {
  assertValidatedSourceRecord(entry);
  if (receiptIndexes.has(entry)) return receiptIndexes.get(entry);

  const index = new Map();
  for (const row of entry.preservation.repositories) {
    const key = `${row.source_repository.toLowerCase()}\0${row.commit}`;
    // Validation already rejects duplicates. Keep this last check because an
    // in-place mutation before first presentation must not make Map insertion
    // silently choose one of two receipts.
    if (index.has(key)) {
      throw new Error(
        `entry has an ambiguous source preservation receipt for ` +
          `${row.source_repository}@${row.commit}`,
      );
    }
    // Copy the three consumed fields so later presentation never observes an
    // in-place mutation of the accepted receipt row.
    index.set(key, {
      source_repository: row.source_repository,
      commit: row.commit,
      fork_repository: row.fork_repository,
    });
  }
  receiptIndexes.set(entry, index);
  return index;
}

/**
 * Publish one fail-soft availability result to source controls as it arrives.
 *
 * Entry content is correct with the canonical preservation receipt alone, so
 * consumers render against `current === null` immediately and subscribe only
 * their source controls. A slow health document can then update those controls
 * in place without holding verified registry content behind an ancillary read.
 */
export function createSourceAvailabilityBinding(
  availabilityPromise,
  warn = (message) => console.warn(message),
) {
  let current = null;
  let listeners = [];

  function report(error) {
    const message = error instanceof Error ? error.message : String(error);
    warn(`Entry source availability could not be applied: ${message}`);
  }

  function settle(value) {
    current = value;
    const pending = listeners;
    listeners = null;
    for (const listener of pending) {
      try {
        listener(value);
      } catch (error) {
        report(error);
      }
    }
    return value;
  }

  const ready = Promise.resolve(availabilityPromise).then(
    settle,
    (error) => {
      report(error);
      return settle(null);
    },
  );

  return {
    get current() {
      return current;
    },
    ready,
    whenReady(listener) {
      if (typeof listener !== "function") throw new TypeError("listener must be a function");
      if (listeners !== null) {
        listeners.push(listener);
        return;
      }
      try {
        listener(current);
      } catch (error) {
        report(error);
      }
    },
  };
}

/** Update one existing source link when the ancillary availability read settles. */
export function bindSourceControl(link, sourceAvailability, resolve) {
  if (typeof resolve !== "function") throw new TypeError("resolve must be a function");
  const apply = (availability) => {
    const reference = resolve(availability);
    link.href = safeExternalUrl(reference.url).href;
    if (reference.text !== undefined) link.textContent = reference.text;
  };
  apply(sourceAvailability?.current ?? null);
  sourceAvailability?.whenReady(apply);
  return link;
}

/** Build the one entry-level source notice and update that node in place. */
export function createSourceAvailabilityNotice(
  entry,
  sourceAvailability,
  { el, externalLink },
) {
  const notice = el("section", "source-availability");
  notice.hidden = true;
  notice.setAttribute("role", "status");

  function apply(availability) {
    const location = topSourceLocation(entry, availability);
    const original = externalLink(
      "Recorded original location",
      pinnedRepositoryDirectoryUrl(
        location.originalRepository,
        location.commit,
        entry.source.project_path || ".",
      ),
    );
    original.dataset.sourceLocation = "original";
    const archived = externalLink(
      "Recorded Palomar copy",
      pinnedRepositoryDirectoryUrl(
        location.archiveRepository,
        location.commit,
        entry.source.project_path || ".",
      ),
    );
    archived.dataset.sourceLocation = "archive";
    notice.className = "source-availability";
    notice.hidden = false;
    if (location.originalStatus === "missing" && location.archiveStatus === "missing") {
      notice.classList.add("unrecoverable");
      notice.replaceChildren(
        el("strong", "", "No working preserved source location"),
        el("p", "", "Both the recorded original and Palomar's preserved copy are currently unavailable."),
        original,
        " · ",
        archived,
      );
    } else if (location.originalStatus === "missing") {
      notice.classList.add("original-missing");
      const checked = location.checkedAt ? ` (checked ${location.checkedAt})` : "";
      archived.textContent = "Palomar preserved copy";
      notice.replaceChildren(
        el("strong", "", "Original source unavailable"),
        el("p", "", `Source links on this page now use Palomar's preserved copy${checked}.`),
        archived,
        " · ",
        original,
      );
    } else if (location.archiveStatus === "missing") {
      notice.classList.add("archive-missing");
      const originalConfirmed = location.originalStatus === "available";
      original.textContent = originalConfirmed ? "Original source" : "Recorded original location";
      notice.replaceChildren(
        el("strong", "", "Source preservation degraded"),
        el(
          "p",
          "",
          originalConfirmed
            ? "The original source still works, but Palomar's preserved copy is unavailable."
            : "Palomar's preserved copy is unavailable. The recorded original location remains " +
              "linked, but its current availability has not been confirmed.",
        ),
        original,
        " · ",
        archived,
      );
    } else {
      notice.classList.add("preserved");
      archived.textContent = "Palomar preserved copy";
      notice.replaceChildren(
        el("strong", "", "Source preserved by Palomar"),
        " ",
        archived,
      );
    }
  }

  sourceAvailability.whenReady(apply);
  return notice;
}

/** Resolve one immutable repository revision to its recorded or preserved copy. */
export function sourceLocation(entry, availability, repository, commit) {
  const mapping = receiptIndex(entry).get(`${repository.toLowerCase()}\0${commit}`);
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

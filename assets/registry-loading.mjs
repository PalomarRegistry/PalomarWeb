import { loadSettledBounded } from "./loading.mjs";
import {
  databaseBaseFor,
  entryRecordUrl,
  recentUrl,
  selectAvailabilityUrl,
  selectDatabaseUrl,
  selectRenderBase,
  tombstoneUrl,
  validateAvailability,
  validateEntry,
  validateRecent,
  validateTombstone,
  validateVersions,
  versionsUrl,
} from "./security.mjs";

const AVAILABILITY_TIMEOUT_MS = 30_000;

/**
 * Bind registry transport and entry loading to the current page environment.
 *
 * Security owns endpoint and document validation, loading.mjs owns bounded
 * concurrency, and entry-pages.mjs owns route state. This boundary composes
 * those contracts into the reads shared by the app's page controllers.
 */
export function createRegistryLoader({
  fetch,
  location,
  warn = () => {},
  availabilityTimeoutMs = AVAILABILITY_TIMEOUT_MS,
}) {
  function dataSource() {
    const databaseBase = databaseBaseFor(
      selectDatabaseUrl(location.href, location.search),
    );
    const renderBase = selectRenderBase(location.href, location.search, databaseBase);
    const availabilityUrl = selectAvailabilityUrl(
      location.href,
      location.search,
      databaseBase,
    );
    return { databaseBase, renderBase, availabilityUrl };
  }

  async function fetchJson(url, { signal } = {}) {
    const response = await fetch(url, { signal });
    if (!response.ok) {
      const error = new Error(`${response.status} ${response.statusText}`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  async function fetchAvailability(url, { signal } = {}) {
    return validateAvailability(await fetchJson(url, { signal }));
  }

  // Page controllers can need the same manifest. Share a successful bounded
  // read, but never make one temporary failure or timeout the page's answer
  // for the rest of its lifetime.
  const availabilityLoads = new Map();
  function loadAvailabilityBounded(url) {
    const key = url.href;
    if (!availabilityLoads.has(key)) {
      const loading = loadSettledBounded(
        [url],
        (selected, signal) => fetchAvailability(selected, { signal }),
        { concurrency: 1, timeoutMs: availabilityTimeoutMs },
      ).then(([loaded]) => {
        if (loaded.status === "fulfilled") return loaded.value;
        // A missing manifest is a stable absence for this page load. A
        // timeout, transport error, or invalid document may recover, so only
        // those outcomes are evicted and retried by the next consumer.
        if (loaded.reason?.status !== 404) {
          availabilityLoads.delete(key);
          warn(
            `Source availability is unavailable: ` +
              `${loaded.reason?.message || String(loaded.reason)}`,
          );
        }
        return null;
      });
      availabilityLoads.set(key, loading);
    }
    return availabilityLoads.get(key);
  }

  async function loadRecent(databaseBase) {
    return validateRecent(await fetchJson(recentUrl(databaseBase)));
  }

  async function loadEntry(id, requestedVersion) {
    const { databaseBase, renderBase, availabilityUrl } = dataSource();
    // The versions of this one result, not the whole registry. Reading a
    // whole-registry index here meant fetching every record ever registered to
    // render one page, and paying for it again every time anyone else published.
    let versions = [];
    try {
      versions = validateVersions(await fetchJson(versionsUrl(id, databaseBase)), id).entries;
    } catch (error) {
      // Absent means no active version of this result, which is either an
      // unknown identifier or one withdrawn entirely. Both are answered below,
      // by the tombstone if there is one and by "not found" if there is not.
      if (error.status !== 404) throw error;
    }
    const currentVersion = versions.length ? versions.at(-1).version : null;
    const version = requestedVersion ?? currentVersion;
    const summary = versions.find((item) => item.version === version);
    if (!summary) {
      if (requestedVersion === null || requestedVersion === undefined) {
        throw new Error("entry not found");
      }
      try {
        const tombstone = validateTombstone(
          await fetchJson(tombstoneUrl(id, requestedVersion, databaseBase)),
          id,
          requestedVersion,
        );
        return { tombstone };
      } catch (error) {
        if (error.status === 404) throw new Error("entry not found");
        throw error;
      }
    }
    // Availability is ancillary health information for active content. Start
    // its bounded read in parallel with the immutable entry record, but return
    // that verified record without awaiting it. Unknown and withdrawn records
    // make no availability request because they have no source controls.
    const availabilityPromise = loadAvailabilityBounded(availabilityUrl);
    const canonicalUrl = entryRecordUrl(summary, databaseBase);
    const entry = validateEntry(await fetchJson(canonicalUrl), summary);
    return {
      entry,
      canonicalUrl,
      renderBase,
      versions,
      currentVersion,
      availabilityPromise,
      databaseBase,
    };
  }

  return { dataSource, fetchJson, loadAvailabilityBounded, loadRecent, loadEntry };
}

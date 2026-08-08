import { loadSettledBounded } from "./loading.mjs";
import {
  postingRecordUrl,
  searchHeadUrl,
  searchPageUrl,
  searchTerms,
  stopwordsUrl,
  validateEntry,
  validateSearchHead,
  validateSearchPage,
  validateStopwords,
} from "./security.mjs";

// These are request bounds, not guesses about how large the registry will be.
// A query can therefore be rejected or become incomplete, but it cannot make
// browser work grow without limit through many words, a common word, or a large
// result set.
export const SEARCH_TERM_LIMIT = 20;
export const SEARCH_PAGE_BUDGET = 16;
export const SEARCH_RESULT_LIMIT = 20;
export const SEARCH_CANDIDATE_LIMIT = 60;
export const SEARCH_IO_CONCURRENCY = 8;
export const SEARCH_TIMEOUT_MS = 30_000;

const POSTING_RE = /^(PALOMAR-\d{4}-\d{2}-\d{2}-\d{6})-v([1-9]\d*)$/;

/**
 * The summary a fetched record is checked against.
 *
 * A posting claims only that a version carries one word. It does not carry the
 * mutable facts a card might otherwise want, such as whether that version is
 * current or how many active versions the result has. Those must not be
 * invented here.
 */
function postingSummary(posting, entry) {
  const match = POSTING_RE.exec(posting);
  return {
    id: match[1],
    version: Number(match[2]),
    title: entry.title,
    status: entry.status,
    path: `entries/${posting}.json`,
  };
}

/** Group postings by result under one record-read budget, newest version first. */
function candidateGroups(postings, limit) {
  const groups = new Map();
  for (const [position, posting] of postings.entries()) {
    const match = POSTING_RE.exec(posting);
    const id = match[1];
    const version = Number(match[2]);
    if (!groups.has(id)) groups.set(id, { id, position, postings: new Map() });
    groups.get(id).postings.set(version, posting);
  }
  const available = [...groups.values()]
    .reduce((count, group) => count + group.postings.size, 0);
  const selected = [];
  let remaining = limit;
  for (const group of [...groups.values()].sort((left, right) => left.position - right.position)) {
    if (!remaining) break;
    const candidates = [...group.postings.entries()]
      .sort(([left], [right]) => right - left)
      .slice(0, remaining)
      .map(([, posting]) => posting);
    selected.push({ ...group, postings: candidates });
    remaining -= candidates.length;
  }
  return { groups: selected, complete: available <= limit };
}

/** Whether a record really carries every word of the query. */
function carriesEveryTerm(entry, terms) {
  const words = new Set([
    ...searchTerms(entry.title),
    ...searchTerms(entry.abstract),
    ...entry.authors.flatMap((author) => searchTerms(author.name)),
  ]);
  return terms.every((term) => words.has(term));
}

/**
 * Build the page's registry search around its JSON transport.
 *
 * Heads, posting pages and records each load concurrently through the same
 * bounded loader used by the landing page. Every stage shares one deadline,
 * so a sequence of slow stages cannot each claim a fresh timeout. Fulfilled
 * values retain publisher order even when requests complete out of order. A
 * caller signal joins that deadline so a new UI query can stop the old one.
 */
export function createRegistrySearch(
  fetchJson,
  {
    concurrency = SEARCH_IO_CONCURRENCY,
    timeoutMs = SEARCH_TIMEOUT_MS,
    pageBudget = SEARCH_PAGE_BUDGET,
    resultLimit = SEARCH_RESULT_LIMIT,
    candidateLimit = SEARCH_CANDIDATE_LIMIT,
  } = {},
) {
  if (typeof fetchJson !== "function") throw new TypeError("fetchJson must be a function");
  for (const [name, value] of [
    ["pageBudget", pageBudget],
    ["resultLimit", resultLimit],
    ["candidateLimit", candidateLimit],
  ]) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`${name} must be a positive integer`);
    }
  }

  // One editorial constant per selected data origin. A failed read is not
  // cached, so a later query can recover without reloading the page.
  const stopwordsByBase = new Map();

  return async function searchRegistry(query, databaseBase, { signal = null } = {}) {
    if (signal !== null && !(signal instanceof AbortSignal)) {
      throw new TypeError("signal must be an AbortSignal");
    }
    const asked = [...new Set(searchTerms(query))];
    if (asked.length > SEARCH_TERM_LIMIT) {
      throw new RangeError(
        `Search queries may contain at most ${SEARCH_TERM_LIMIT} distinct words.`,
      );
    }
    const problems = [];
    const deadlineController = new AbortController();
    const deadlineError = new Error(`search deadline of ${timeoutMs}ms expired`);
    deadlineError.name = "TimeoutError";
    const timer = setTimeout(() => deadlineController.abort(deadlineError), timeoutMs);
    const abortFromCaller = () => deadlineController.abort(signal.reason);
    if (signal?.aborted) abortFromCaller();
    else signal?.addEventListener("abort", abortFromCaller, { once: true });
    const baseKey = new URL(databaseBase).href;
    const settle = (items, load) => loadSettledBounded(items, load, {
      concurrency,
      timeoutMs,
      signal: deadlineController.signal,
    });
    const note = (stage, item, reason) => problems.push({ stage, item, reason });
    const result = (fields) => ({
      problems,
      timedOut: deadlineController.signal.reason === deadlineError,
      ...fields,
    });

    try {
      let dropping = stopwordsByBase.get(baseKey);
      if (!dropping) {
        const [loaded] = await settle(
          [baseKey],
          async (_base, signal) =>
            validateStopwords(await fetchJson(stopwordsUrl(databaseBase), { signal })),
        );
        if (loaded.status === "fulfilled") {
          dropping = loaded.value;
          stopwordsByBase.set(baseKey, dropping);
        } else if (loaded.reason?.status === 404) {
          // Legacy data origins did not publish the editorial list. Keeping
          // every word is conservative: records still have to match exactly.
          dropping = new Set();
          stopwordsByBase.set(baseKey, dropping);
        } else {
          dropping = new Set();
          note("stopwords", "search/stopwords.json", loaded.reason);
        }
      }

      const dropped = asked.filter((term) => dropping.has(term));
      const terms = asked.filter((term) => !dropping.has(term));
      if (!terms.length) {
        return result({ terms, dropped, entries: [], whole: !problems.length, missing: [] });
      }

      // Input order is retained by the loader. The explicit position tie-break
      // below makes the rarest-word selection independent of completion order.
      const headResults = await settle(terms, async (term, signal) => {
        try {
          return validateSearchHead(
            await fetchJson(searchHeadUrl(term, databaseBase), { signal }),
            term,
          );
        } catch (error) {
          if (error.status === 404) return null;
          throw error;
        }
      });
      const heads = [];
      const missing = [];
      for (const [position, loaded] of headResults.entries()) {
        const term = terms[position];
        if (loaded.status === "rejected") note("head", term, loaded.reason);
        else if (loaded.value?.results > 0) heads.push({ term, head: loaded.value, position });
        else missing.push(term);
      }

      // A successfully read missing head proves the intersection empty. Failed
      // independent requests are still reported, rather than being presented
      // as a clean search.
      if (missing.length || !heads.length) {
        return result({
          terms,
          dropped,
          entries: [],
          whole: Boolean(missing.length) && !problems.length,
          missing,
        });
      }

      heads.sort((left, right) =>
        left.head.results - right.head.results || left.position - right.position,
      );

      // Choose the same bounded intersection plan as the former serial reader,
      // then fetch the chosen pages together. Only a complete secondary
      // sequence may narrow the driver; intersecting against half a sequence
      // would silently remove genuine matches.
      let budget = pageBudget;
      const groups = [];
      for (const item of heads) {
        if (groups.length && item.head.pages > budget) break;
        const wanted = Math.min(item.head.pages, budget);
        if (wanted === 0) break;
        const first = item.head.pages - wanted;
        const pages = [];
        for (let number = item.head.pages - 1; number >= first; number -= 1) {
          pages.push({ ...item, number });
        }
        groups.push({ ...item, first, wanted, pages });
        budget -= wanted;
        if (budget === 0) break;
      }
      const requestedPages = groups.flatMap((group) => group.pages);
      const pageResults = await settle(requestedPages, async (request, signal) =>
        validateSearchPage(
          await fetchJson(searchPageUrl(request.term, request.number, databaseBase), { signal }),
          request.term,
          request.number,
          request.head,
        ),
      );

      let offset = 0;
      let postings = null;
      let driverWhole = false;
      for (const group of groups) {
        const loaded = pageResults.slice(offset, offset + group.pages.length);
        offset += group.pages.length;
        const complete = loaded.every((page) => page.status === "fulfilled");
        const pulled = [];
        for (const [position, page] of loaded.entries()) {
          if (page.status === "fulfilled") pulled.push(...[...page.value.postings].reverse());
          else note("page", `${group.term}/${group.pages[position].number}`, page.reason);
        }
        if (!pulled.length) continue;
        if (postings === null) {
          postings = pulled;
          driverWhole = complete && group.first === 0;
        } else if (complete) {
          const carried = new Set(pulled);
          postings = postings.filter((posting) => carried.has(posting));
        }
      }

      if (postings === null) {
        return result({ terms, dropped, entries: [], whole: false, missing });
      }

      // Group the bounded page data before applying the record-read cap. That
      // finds the numerically newest candidate even when v10 does not sort
      // after v9 lexically, while the sum of every group's fallbacks remains
      // capped at `candidateLimit`.
      const candidatePlan = candidateGroups(postings, candidateLimit);
      const candidates = candidatePlan.groups;
      const entries = [];
      let next = 0;
      let position = 0;
      const pending = new Map();
      const start = (index) => {
        const group = candidates[index];
        pending.set(index, settle([group], async (selected, loadSignal) => {
          // Usually only the newest candidate is read. An older version is a
          // fallback only when the newer valid record does not carry every
          // term that could not safely be intersected from complete postings.
          const failures = [];
          for (const posting of selected.postings) {
            try {
              const record = await fetchJson(postingRecordUrl(posting, databaseBase), {
                signal: loadSignal,
              });
              const entry = validateEntry(record, postingSummary(posting, record));
              if (carriesEveryTerm(entry, terms)) return { entry, failures };
            } catch (reason) {
              failures.push({ posting, reason });
              if (loadSignal.aborted) break;
            }
          }
          return { entry: null, failures };
        }).then(([loaded]) => loaded));
        next += 1;
      };
      while (next < Math.min(concurrency, candidates.length, resultLimit)) start(next);
      while (position < candidates.length && entries.length < resultLimit) {
        const loaded = await pending.get(position);
        pending.delete(position);
        if (loaded.status === "rejected") {
          note("record", candidates[position].postings[0], loaded.reason);
        } else {
          for (const failure of loaded.value.failures) {
            note("record", failure.posting, failure.reason);
          }
          if (loaded.value.entry) entries.push(loaded.value.entry);
        }
        position += 1;
        // Keep at most `concurrency - 1` speculative groups ahead of the
        // deterministic output cursor. Unlike fixed waves, one settled prefix
        // position immediately admits the next candidate.
        if (entries.length < resultLimit) {
          while (next < candidates.length && next < position + concurrency) start(next);
        }
        if (deadlineController.signal.aborted) break;
      }
      if (entries.length === resultLimit && pending.size) {
        deadlineController.abort(new Error("search result limit satisfied"));
      }

      return result({
        terms,
        dropped,
        entries,
        missing,
        whole: driverWhole && candidatePlan.complete &&
          position === candidates.length && !problems.length,
      });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abortFromCaller);
    }
  };
}

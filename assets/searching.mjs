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
// A query can therefore become incomplete, but it cannot make browser work grow
// without limit with either a common word or a large result set.
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
 * values retain publisher order even when requests complete out of order.
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

  return async function searchRegistry(query, databaseBase) {
    const asked = [...new Set(searchTerms(query))];
    const problems = [];
    const deadlineController = new AbortController();
    const deadlineError = new Error(`search deadline of ${timeoutMs}ms expired`);
    deadlineError.name = "TimeoutError";
    const timer = setTimeout(() => deadlineController.abort(deadlineError), timeoutMs);
    const baseKey = new URL(databaseBase).href;
    const settle = (items, load) => loadSettledBounded(items, load, {
      concurrency,
      timeoutMs,
      signal: deadlineController.signal,
    });
    const note = (stage, item, reason) => problems.push({ stage, item, reason });
    const result = (fields) => ({
      asked,
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
        return result({ terms, dropped, entries: [], whole: !problems.length, examined: 0, missing: [] });
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
          examined: 0,
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
        return result({ terms, dropped, entries: [], whole: false, examined: 0, missing });
      }

      const candidates = postings.slice(0, candidateLimit);
      const recordResults = await settle(candidates, async (posting, signal) => {
        const record = await fetchJson(postingRecordUrl(posting, databaseBase), { signal });
        return validateEntry(record, postingSummary(posting, record));
      });
      const entries = [];
      let examined = 0;
      for (const [position, loaded] of recordResults.entries()) {
        if (entries.length >= resultLimit) break;
        examined += 1;
        if (loaded.status === "rejected") {
          note("record", candidates[position], loaded.reason);
        } else if (carriesEveryTerm(loaded.value, terms)) {
          entries.push(loaded.value);
        }
      }

      return result({
        terms,
        dropped,
        entries,
        missing,
        whole: driverWhole && examined === postings.length && !problems.length,
        examined,
      });
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Retirement notice for an already-cached app.js. No postings engine remains.
 * Keep the named imports loadable so cached entry pages can still render. */
export const SEARCH_RESULT_LIMIT = 20;
export const SEARCH_TERM_LIMIT = 20;
export function validateSearchQuery(query) {
  if (!query.trim()) return [];
  throw new Error("Search has changed. Reload this page to search the whole registry.");
}
export function createRegistrySearch() {
  return async () => { throw new Error("Search has changed. Reload this page."); };
}

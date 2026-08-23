/**
 * Is the site people can see the site this repository describes?
 *
 * On 2026-08-06 a GitHub Pages outage left the registry serving a build from
 * seven hours earlier. Everything had merged, every workflow that mattered was
 * green, and the only thing that noticed was a person reading the page and
 * asking why their change was not there. A publish step that fails silently is
 * indistinguishable from one that did not run.
 *
 * The build already stamps the commit it came from into every asset URL, so
 * the check is a comparison rather than new machinery.
 */

import { readFile } from "node:fs/promises";

import { shippedFiles } from "./build-site.mjs";
import {
  entryRecordUrl,
  recentValidationIssues,
  subjectHeadUrl,
  validateBrowseHead,
  validateBrowsePage,
  validateBrowseYear,
  validateEntry,
  validateRecent,
  validateRecentRenders,
  validateSubjectHead,
  validateVersions,
  versionsUrl,
} from "../assets/security.mjs";

const STAMP = /assets\/app\.js\?v=([A-Za-z0-9._-]+)/;

/** The commit a served page was built from, or null if it carries no stamp. */
export function publishedVersion(html) {
  return STAMP.exec(String(html ?? ""))?.[1] ?? null;
}

/**
 * What to say about a served page, given the commit it should have been built
 * from. An unstamped page counts as stale: it is either older than stamping or
 * not the page we think it is, and neither is a thing to pass over.
 */
export function publishState(html, expected) {
  const published = publishedVersion(html);
  if (published === null) {
    return { fresh: false, published, reason: "the served page carries no build stamp" };
  }
  if (published !== expected) {
    return {
      fresh: false,
      published,
      reason: `serving ${published.slice(0, 12)}, expected ${String(expected).slice(0, 12)}`,
    };
  }
  return { fresh: true, published, reason: `serving ${published.slice(0, 12)}` };
}

/**
 * Can the current website contract load every active public entry permalink?
 *
 * The browser normally reads one bounded surface at a time. Deployment and
 * published-site health deliberately do the linear whole-public-tree check it
 * should not make a visitor do: browse head to years to pages, every per-ID
 * version index, then every active entry. Counts and row equality reconcile
 * every row the producer advertises; they are not an independent proof that
 * the producer omitted nothing. `recent.json` is also checked against each
 * current history head and entry, because it is the landing page's separate
 * exact projection, and `recent-renders.json` against both, because it and the
 * page are one projection published as two documents and only a reader who
 * hovers would otherwise discover they had drifted apart.
 */
const PUBLIC_DATA_CONCURRENCY = 8;
const PUBLIC_REQUEST_POLICY = Object.freeze({
  attempts: 3,
  backoffMs: 200,
  timeoutMs: 5_000,
});

async function mapBounded(items, task) {
  const values = [...items];
  const results = new Array(values.length);
  let next = 0;
  const worker = async () => {
    while (next < values.length) {
      const position = next;
      next += 1;
      results[position] = await task(values[position], position);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(PUBLIC_DATA_CONCURRENCY, values.length) },
      () => worker(),
    ),
  );
  return results;
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fetchJson(url, fetcher, policy) {
  let lastError;
  for (let attempt = 1; attempt <= policy.attempts; attempt += 1) {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`${url} timed out after ${policy.timeoutMs}ms`);
        controller.abort(error);
        reject(error);
      }, policy.timeoutMs);
    });
    try {
      const response = await Promise.race([
        fetcher(url, { cache: "no-store", signal: controller.signal }),
        timeout,
      ]);
      if (!response.ok) {
        const error = new Error(`${url} responded ${response.status}`);
        error.retryable = response.status === 408 || response.status === 425 ||
          response.status === 429 || response.status >= 500;
        throw error;
      }
      return await Promise.race([response.json(), timeout]);
    } catch (error) {
      lastError = error;
      if (error.retryable === false || attempt === policy.attempts) throw error;
    } finally {
      clearTimeout(timer);
    }
    await wait(policy.backoffMs * (2 ** (attempt - 1)));
  }
  throw lastError;
}

const PUBLIC_VALIDATORS = {
  recentValidationIssues,
  validateBrowseHead,
  validateBrowsePage,
  validateBrowseYear,
  validateEntry,
  validateRecent,
  validateRecentRenders,
  validateSubjectHead,
  validateVersions,
};

export async function publicDataState(
  databaseUrl,
  fetcher = fetch,
  validators = PUBLIC_VALIDATORS,
  requestPolicy = PUBLIC_REQUEST_POLICY,
) {
  const base = new URL(databaseUrl.endsWith("/") ? databaseUrl : `${databaseUrl}/`);
  const policy = { ...PUBLIC_REQUEST_POLICY, ...requestPolicy };
  try {
    const recent = validators.validateRecent(
      await fetchJson(new URL("recent.json", base), fetcher, policy),
    );
    if (validators.recentValidationIssues) {
      const issues = validators.recentValidationIssues(recent);
      if (issues.omitted) {
        throw new Error(`recent.json contains ${issues.omitted} unusable rows`);
      }
    }
    const recentRenders = validators.validateRecentRenders(
      await fetchJson(new URL("recent-renders.json", base), fetcher, policy),
    );
    const browse = validators.validateBrowseHead(
      await fetchJson(new URL("browse/index.json", base), fetcher, policy),
    );
    const years = await mapBounded(browse.years, async (year) => validators.validateBrowseYear(
      await fetchJson(new URL(`browse/${year.year}.json`, base), fetcher, policy),
      year,
    ));
    const pageTasks = years.flatMap((year) => year.days.flatMap((day) =>
      Array.from(
        { length: day.last_page - day.first_page + 1 },
        (_unused, offset) => ({ day, page: day.first_page + offset }),
      )));
    const pages = await mapBounded(pageTasks, async ({ day, page }) => ({
      day,
      document: validators.validateBrowsePage(
        await fetchJson(new URL(`browse/${day.day}/${page}.json`, base), fetcher, policy),
        day.day,
        page,
      ),
    }));

    const byDay = new Map();
    for (const { day, document } of pages) {
      const rows = byDay.get(day.day) ?? [];
      rows.push(...document.entries);
      byDay.set(day.day, rows);
    }
    for (const year of years) {
      for (const day of year.days) {
        const rows = byDay.get(day.day) ?? [];
        if (rows.length !== day.versions || new Set(rows.map((row) => row.id)).size !== day.results) {
          throw new Error(`browse counts do not equal the rows served for ${day.day}`);
        }
      }
    }

    const summaries = pages.flatMap(({ document }) => document.entries);
    const identifiers = [...new Set(summaries.map((summary) => summary.id))].sort();
    if (summaries.length !== browse.versions || identifiers.length !== browse.results) {
      throw new Error("browse index counts do not equal the complete page traversal");
    }
    const paths = new Set(summaries.map((summary) => summary.path));
    if (paths.size !== summaries.length) throw new Error("browse pages repeat an entry permalink");

    const browsedById = new Map(identifiers.map((id) => [id, []]));
    for (const summary of summaries) browsedById.get(summary.id).push(summary);
    const histories = await mapBounded(identifiers, async (id) => {
      const history = validators.validateVersions(
        await fetchJson(versionsUrl(id, base), fetcher, policy),
        id,
      );
      const browsed = browsedById.get(id);
      const summariesEqual = history.entries.length === browsed.length &&
        history.entries.every((row, position) => {
          const other = browsed[position];
          return row.id === other.id && row.version === other.version &&
            row.title === other.title && row.status === other.status && row.path === other.path;
        });
      if (!summariesEqual) {
        throw new Error(`version index for ${id} does not equal its browse history`);
      }
      return history;
    });

    const fetchedEntries = await mapBounded(
      histories.flatMap((history) => history.entries),
      async (summary) => {
        const entry = await fetchJson(entryRecordUrl(summary, base), fetcher, policy);
        validators.validateEntry(entry, summary);
        return [summary.path, entry];
      },
    );
    const entriesByPath = new Map(fetchedEntries);
    const historiesById = new Map(histories.map((history) => [history.id, history.entries]));
    const rendersById = new Map(recentRenders.renders.map((row) => [row.id, row]));
    for (const summary of recent.entries) {
      const history = historiesById.get(summary.id);
      const current = history?.at(-1);
      if (!current || summary.version !== current.version || summary.title !== current.title ||
          summary.status !== current.status || summary.path !== current.path ||
          summary.versions !== history.length) {
        throw new Error(`recent row for ${summary.id} does not equal its current version history`);
      }
      const entry = entriesByPath.get(summary.path);
      if (!entry || summary.published_at !== entry.registered_at) {
        throw new Error(`recent row for ${summary.id} does not match its entry registered_at`);
      }
      // The two are one projection published as two documents, so a page row
      // without its hash, or with the hash of another version or of a render
      // the record does not claim, is drift between them. A reader who hovers
      // is the one who finds out, which is exactly what this check exists to
      // do first.
      const render = rendersById.get(summary.id);
      if (!render || render.version !== summary.version) {
        throw new Error(`recent row for ${summary.id} has no render hash of its version`);
      }
      if (render.artifact_tree_sha256 !== entry.challenge_render.artifact_tree_sha256) {
        throw new Error(`recent render hash for ${summary.id} is not its entry's`);
      }
    }
    if (recentRenders.renders.length !== recent.entries.length) {
      throw new Error("recent renders names results the landing page does not");
    }
    // The subject pages the website now links every classification code to.
    // Bounded by the classification vocabulary of the newest rows rather than
    // by the registry, and checked against the records the traversal above
    // already proved: a subject front page naming something that is not a
    // current version, or carrying a code the record does not, would show a
    // result under a heading it has nothing to do with.
    const currentByPath = new Map();
    for (const entries of historiesById.values()) {
      const current = entries.at(-1);
      currentByPath.set(current.path, current);
    }
    // Every code any current version carries, not only the codes of the newest
    // two hundred. A result outside `recent.json` links to its subject page
    // from its own entry page, and a health check that never asked for that
    // document would not notice it had stopped being served.
    const codes = new Map();
    for (const path of currentByPath.keys()) {
      const { arxiv, msc2020 } = entriesByPath.get(path).classification;
      for (const code of arxiv) codes.set(`arxiv/${code}`, ["arxiv", code]);
      for (const code of msc2020) codes.set(`msc/${code}`, ["msc", code]);
    }
    await mapBounded([...codes.values()], async ([kind, code]) => {
      const head = validators.validateSubjectHead(
        await fetchJson(subjectHeadUrl(kind, code, base), fetcher, policy),
        kind,
        code,
      );
      for (const row of head.entries) {
        const current = currentByPath.get(row.path);
        if (!current || current.version !== row.version || current.title !== row.title) {
          throw new Error(`subject ${kind}/${code} names ${row.path}, which is not a current version`);
        }
        // Every field the subject page shows, against the record it claims to
        // be showing. A row that reads correctly and says something its record
        // does not is the failure this surface can still have: the abstract and
        // the sibling codes are rendered, and the instant is what orders them.
        const entry = entriesByPath.get(row.path);
        const declared = entry.classification;
        const carried = kind === "arxiv" ? declared.arxiv : declared.msc2020;
        if (!carried.includes(code)) {
          throw new Error(`subject ${kind}/${code} carries ${row.path}, whose record does not`);
        }
        if (row.published_at !== entry.registered_at || row.abstract !== entry.abstract ||
            row.classification.arxiv.join(" ") !== declared.arxiv.join(" ") ||
            row.classification.msc2020.join(" ") !== declared.msc2020.join(" ")) {
          throw new Error(`subject ${kind}/${code} projects ${row.path} as something its record is not`);
        }
      }
      return head;
    });

    return {
      healthy: true,
      reason: `the website contract accepts all ${browse.versions} active entry versions ` +
        `across ${browse.results} results and ${codes.size} classification codes`,
    };
  } catch (error) {
    return { healthy: false, reason: `public registry data is incompatible: ${error.message}` };
  }
}

// Stops at the delimiters a URL is written between: quotes and angle brackets
// in markup, a semicolon in the CSP's source list, a bracket in CSS.
const DATA_URL = /https:\/\/data\.palomar-registry\.org[^\s"'`<>();,]*/g;
const POLICY_DOCUMENT_URL =
  /https:\/\/github\.com\/PalomarRegistry\/PalomarPolicy\/blob\/main\/CONTRIBUTING\.md(?:#[A-Za-z0-9._-]+)?/g;

/**
 * Every registry document the shipped site sends a reader to, plus the mutable
 * Policy document to which About explicitly delegates mechanical requirements.
 *
 * A URL ending in `/` names a prefix the code builds a document out of rather
 * than a document, and the bare origin appears in each page's content policy;
 * neither is something to request. A fragment names a section within a
 * document; its exact value is pinned inside About by a unit test but cannot be
 * validated by an HTTP request. Health checks the document once without it.
 */
export function monitoredLinkedDocuments(sources) {
  const found = new Map();
  for (const [name, text] of sources) {
    for (const pattern of [DATA_URL, POLICY_DOCUMENT_URL]) {
      for (const [href] of String(text).matchAll(pattern)) {
        const target = new URL(href);
        if (target.pathname === "/" || target.pathname.endsWith("/")) continue;
        target.hash = "";
        if (!found.has(target.href)) found.set(target.href, name);
      }
    }
  }
  return found;
}

/** The shipped files, as `check-published.mjs` and the build both see them. */
export async function shippedSources(root = new URL("..", import.meta.url)) {
  return Promise.all(
    shippedFiles.map(async (name) => [name, await readFile(new URL(name, root), "utf8")]),
  );
}

/**
 * Do the owners still serve every document selected for continuous link health?
 *
 * `index.json` was removed from the public data service, and seven links to it
 * survived the removal: the landing page's machine-readable index, both
 * noscript fallbacks and four footers, each answering 404 to whoever followed
 * it. Nothing noticed, because nothing had ever asked the service whether the
 * documents this site names are documents it will answer for. Asking it is the
 * only check that cannot drift from it. The same check also proves that the
 * selected Policy owner still serves the document to which About delegates its
 * mutable Comparator rules.
 */
export async function linkedDocumentState(sources, fetcher = fetch) {
  const documents = monitoredLinkedDocuments(sources);
  const dead = [];
  await Promise.all([...documents].map(async ([href, name]) => {
    try {
      const response = await fetcher(href, { method: "HEAD", cache: "no-store" });
      if (!response.ok) dead.push(`${name} links ${href}, which responded ${response.status}`);
    } catch (error) {
      dead.push(`${name} links ${href}, which could not be fetched: ${error.message}`);
    }
  }));
  if (dead.length) return { healthy: false, reason: dead.sort().join("; ") };
  return {
    healthy: true,
    reason: `all ${documents.size} monitored linked documents resolve`,
  };
}

async function main(argv) {
  const options = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    options.set(argv[index].replace(/^--/, ""), argv[index + 1]);
  }
  const url = options.get("url");
  const expected = options.get("expect");
  const data = options.get("data");
  if (data && !url && !expected) {
    const state = await publicDataState(data);
    console.log(`${data}: ${state.reason}`);
    return state.healthy ? 0 : 1;
  }
  if (options.has("links") && !url && !expected) {
    const state = await linkedDocumentState(await shippedSources());
    console.log(state.reason);
    return state.healthy ? 0 : 1;
  }
  if (!url || !expected) {
    console.error(
      "usage: check-published.mjs --url <site> --expect <commit> | --data <registry-data>"
        + " | --links",
    );
    return 2;
  }
  const page = new URL("index.html", url.endsWith("/") ? url : `${url}/`);
  let html;
  try {
    const response = await fetch(page, { cache: "no-store" });
    if (!response.ok) {
      console.error(`${page} responded ${response.status}`);
      return 1;
    }
    html = await response.text();
  } catch (error) {
    console.error(`${page} could not be fetched: ${error.message}`);
    return 1;
  }
  const state = publishState(html, expected);
  console.log(`${page}: ${state.reason}`);
  return state.fresh ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main(process.argv.slice(2));
}

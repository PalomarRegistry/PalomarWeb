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

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { shippedFiles } from "./build-site.mjs";
import {
  entryRecordUrl,
  validateBrowseHead,
  validateBrowsePage,
  validateBrowseYear,
  validateEntry,
  validateRecent,
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
 * version index, then every active entry. Counts and row equality make that a
 * coverage proof rather than a sample. `recent.json` is also checked against
 * each current history head, because it is the landing page's separate exact
 * projection.
 */
const PUBLIC_DATA_CONCURRENCY = 8;

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

async function fetchJson(url, fetcher) {
  const response = await fetcher(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url} responded ${response.status}`);
  return response.json();
}

const PUBLIC_VALIDATORS = {
  validateBrowseHead,
  validateBrowsePage,
  validateBrowseYear,
  validateEntry,
  validateRecent,
  validateVersions,
};

export async function publicDataState(
  databaseUrl,
  fetcher = fetch,
  validators = PUBLIC_VALIDATORS,
) {
  const base = new URL(databaseUrl.endsWith("/") ? databaseUrl : `${databaseUrl}/`);
  try {
    const recent = validators.validateRecent(
      await fetchJson(new URL("recent.json", base), fetcher),
    );
    const browse = validators.validateBrowseHead(
      await fetchJson(new URL("browse/index.json", base), fetcher),
    );
    const years = await mapBounded(browse.years, async (year) => validators.validateBrowseYear(
      await fetchJson(new URL(`browse/${year.year}.json`, base), fetcher),
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
        await fetchJson(new URL(`browse/${day.day}/${page}.json`, base), fetcher),
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
        await fetchJson(versionsUrl(id, base), fetcher),
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

    const historiesById = new Map(histories.map((history) => [history.id, history.entries]));
    for (const summary of recent.entries) {
      const history = historiesById.get(summary.id);
      const current = history?.at(-1);
      if (!current || summary.version !== current.version || summary.title !== current.title ||
          summary.status !== current.status || summary.path !== current.path ||
          summary.versions !== history.length) {
        throw new Error(`recent row for ${summary.id} does not equal its current version history`);
      }
    }

    await mapBounded(histories.flatMap((history) => history.entries), async (summary) => {
      validators.validateEntry(
        await fetchJson(entryRecordUrl(summary, base), fetcher),
        summary,
      );
    });
    return {
      healthy: true,
      reason: `the website contract accepts all ${browse.versions} active entry versions ` +
        `across ${browse.results} results`,
    };
  } catch (error) {
    return { healthy: false, reason: `public registry data is incompatible: ${error.message}` };
  }
}

/**
 * Does a canonical Database checkout contain only the entry contract Web ships?
 *
 * Public CI cannot clone the private canonical repository, so its mandatory
 * gate is `publicDataState`. This companion is the local producer-branch gate:
 * no alternate schema document, and every historical canonical entry through
 * the same validator the deployed browser uses.
 */
export async function canonicalDataState(databaseRoot, validator = validateEntry) {
  const root = resolve(databaseRoot);
  try {
    const rootNames = await readdir(root);
    const schemas = rootNames.filter((name) => /^schema-v[1-9][0-9]*\.json$/.test(name)).sort();
    if (JSON.stringify(schemas) !== JSON.stringify(["schema-v2.json"])) {
      throw new Error(`canonical Database entry schemas are ${schemas.join(", ") || "missing"}`);
    }
    const schema = JSON.parse(await readFile(resolve(root, "schema-v2.json"), "utf8"));
    const preservation = schema?.properties?.preservation;
    const mapping = preservation?.properties?.repositories?.items;
    const exactNames = (value, expected) => Array.isArray(value) &&
      value.length === expected.length && expected.every((name) => value.includes(name));
    if (schema?.properties?.schema_version?.const !== 2 ||
        !schema?.required?.includes("preservation") || preservation?.type !== "object" ||
        preservation?.additionalProperties !== false ||
        !exactNames(preservation?.required, [
          "archive_owner", "archived_at", "receipt_sha256", "repositories",
        ]) || preservation?.properties?.archive_owner?.const !== "PalomarArchive" ||
        preservation?.properties?.repositories?.type !== "array" ||
        preservation?.properties?.repositories?.minItems !== 1 || mapping?.type !== "object" ||
        mapping?.additionalProperties !== false || !exactNames(mapping?.required, [
          "source_repository", "commit", "fork_repository", "ref",
        ]) || !exactNames(Object.keys(mapping?.properties ?? {}), [
          "source_repository", "commit", "fork_repository", "ref",
        ])) {
      throw new Error("schema-v2.json does not require the preservation-backed entry contract");
    }
    const entryRoot = resolve(root, "entries");
    const entries = (await readdir(entryRoot)).filter((name) => name.endsWith(".json")).sort();
    if (!entries.length) throw new Error("canonical Database contains no entry to exercise");
    await mapBounded(entries, async (name) => {
      const record = JSON.parse(await readFile(resolve(entryRoot, name), "utf8"));
      if (record.schema_version !== 2 || !record.preservation) {
        throw new Error(`${name} is not a preservation-backed schema-v2 entry`);
      }
      const expectedName = `${record.id}-v${record.version}.json`;
      if (name !== expectedName) throw new Error(`${name} does not match its entry identity`);
      validator(record, {
        id: record.id,
        version: record.version,
        title: record.title,
        status: record.status,
        path: `entries/${name}`,
        published_at: record.registered_at,
      });
    });
    return {
      healthy: true,
      reason: `the website contract accepts all ${entries.length} canonical historical entries`,
    };
  } catch (error) {
    return { healthy: false, reason: `canonical Database is incompatible: ${error.message}` };
  }
}

// Stops at the delimiters a URL is written between: quotes and angle brackets
// in markup, a semicolon in the CSP's source list, a bracket in CSS.
const DATA_URL = /https:\/\/data\.palomar-registry\.org[^\s"'`<>();,]*/g;

/**
 * Every registry document the shipped site sends a reader to.
 *
 * A URL ending in `/` names a prefix the code builds a document out of rather
 * than a document, and the bare origin appears in each page's content policy;
 * neither is something to request.
 */
export function linkedDataDocuments(sources) {
  const found = new Map();
  for (const [name, text] of sources) {
    for (const [href] of String(text).matchAll(DATA_URL)) {
      const { pathname } = new URL(href);
      if (pathname === "/" || pathname.endsWith("/")) continue;
      if (!found.has(href)) found.set(href, name);
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
 * Does the registry still serve every document the site links to?
 *
 * `index.json` was removed from the public data service, and seven links to it
 * survived the removal: the landing page's machine-readable index, both
 * noscript fallbacks and four footers, each answering 404 to whoever followed
 * it. Nothing noticed, because nothing had ever asked the service whether the
 * documents this site names are documents it will answer for. Asking it is the
 * only check that cannot drift from it.
 */
export async function linkedDataState(sources, fetcher = fetch) {
  const documents = linkedDataDocuments(sources);
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
    reason: `the registry serves all ${documents.size} documents the site links to`,
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
  const canonical = options.get("canonical");
  if (canonical && !data && !url && !expected) {
    const state = await canonicalDataState(canonical);
    console.log(`${canonical}: ${state.reason}`);
    return state.healthy ? 0 : 1;
  }
  if (data && !url && !expected) {
    const state = await publicDataState(data);
    console.log(`${data}: ${state.reason}`);
    return state.healthy ? 0 : 1;
  }
  if (options.has("links") && !url && !expected) {
    const state = await linkedDataState(await shippedSources());
    console.log(state.reason);
    return state.healthy ? 0 : 1;
  }
  if (!url || !expected) {
    console.error(
      "usage: check-published.mjs --url <site> --expect <commit> | --data <registry-data>"
        + " | --canonical <Database checkout> | --links",
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

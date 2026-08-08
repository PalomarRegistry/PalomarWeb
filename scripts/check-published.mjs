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
import { validateEntry, validateRecent } from "../assets/security.mjs";

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
 * Can the current website contract load what the landing page shows?
 *
 * This deliberately uses the same validators, and now the same document, as
 * the browser. It catches a valid publication whose shape has drifted away
 * from what the UI accepts. It asked about every active entry while there was
 * a document naming them all; there is not one any more, and asking about the
 * page a visitor actually loads is both the check that matters and the only
 * one whose cost does not grow with the registry.
 */
export async function publicDataState(
  databaseUrl,
  fetcher = fetch,
  validators = { validateRecent, validateEntry },
) {
  const base = new URL(databaseUrl.endsWith("/") ? databaseUrl : `${databaseUrl}/`);
  const pageUrl = new URL("recent.json", base);
  try {
    const pageResponse = await fetcher(pageUrl, { cache: "no-store" });
    if (!pageResponse.ok) {
      return { healthy: false, reason: `${pageUrl} responded ${pageResponse.status}` };
    }
    const recent = validators.validateRecent(await pageResponse.json());
    await Promise.all(recent.entries.map(async (summary) => {
      const entryUrl = new URL(summary.path, base);
      const response = await fetcher(entryUrl, { cache: "no-store" });
      if (!response.ok) throw new Error(`${entryUrl} responded ${response.status}`);
      validators.validateEntry(await response.json(), summary);
    }));
    return {
      healthy: true,
      reason: `the website contract accepts all ${recent.entries.length} entries the landing page shows`,
    };
  } catch (error) {
    return { healthy: false, reason: `public registry data is incompatible: ${error.message}` };
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

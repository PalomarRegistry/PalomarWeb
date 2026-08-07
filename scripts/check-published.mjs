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

import { validateEntry, validateIndex } from "../assets/security.mjs";

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
 * Can the current website contract load every active public registry entry?
 * This deliberately uses the same validators as the browser. It catches a
 * valid publication whose shape has drifted away from what the UI accepts.
 */
export async function publicDataState(
  databaseUrl,
  fetcher = fetch,
  validators = { validateIndex, validateEntry },
) {
  const base = new URL(databaseUrl.endsWith("/") ? databaseUrl : `${databaseUrl}/`);
  const indexUrl = new URL("index.json", base);
  try {
    const indexResponse = await fetcher(indexUrl, { cache: "no-store" });
    if (!indexResponse.ok) {
      return { healthy: false, reason: `${indexUrl} responded ${indexResponse.status}` };
    }
    const index = validators.validateIndex(await indexResponse.json());
    await Promise.all(index.entries.map(async (summary) => {
      const entryUrl = new URL(summary.path, base);
      const response = await fetcher(entryUrl, { cache: "no-store" });
      if (!response.ok) throw new Error(`${entryUrl} responded ${response.status}`);
      validators.validateEntry(await response.json(), summary);
    }));
    return {
      healthy: true,
      reason: `the website contract accepts all ${index.entries.length} public entries`,
    };
  } catch (error) {
    return { healthy: false, reason: `public registry data is incompatible: ${error.message}` };
  }
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
  if (!url || !expected) {
    console.error(
      "usage: check-published.mjs --url <site> --expect <commit> | --data <registry-data>",
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

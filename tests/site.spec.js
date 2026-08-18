import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  SEARCH_QUERY_CHARACTER_LIMIT,
  SEARCH_TERM_LIMIT,
} from "../assets/searching.mjs";

const database = encodeURIComponent("http://127.0.0.1:4173/database/");
const missingAvailability = encodeURIComponent(
  "http://127.0.0.1:4173/database/source-availability-missing.json",
);
const previousRef = process.env.PALOMAR_PREVIOUS_REF;
const currentIndex = readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8");

function fileAtPreviousDeployment(path) {
  return execFileSync("git", ["show", `${previousRef}:${path}`], { encoding: "utf8" });
}

/**
 * Ask the registry a deliberate question and do not wait out the typing pause.
 *
 * The value is set rather than typed on purpose. Typing schedules the debounced
 * search, which would race the Enter below and make the request counts these
 * tests assert on depend on how fast the machine is. Enter is still a real key
 * press, because the form no longer has a button and that is the only way in.
 * The tests that cover typing itself type.
 */
async function startSearch(page, query) {
  await page.locator("#query").evaluate((input, value) => { input.value = value; }, query);
  await page.locator("#query").press("Enter");
}

/**
 * Ask, and wait until the registry rather than the page has answered.
 *
 * While a search runs the page stands in the entries it already holds, drawn
 * exactly like the cards that will replace them. Counting cards therefore
 * cannot tell the two apart, and the spinner is what can.
 */
async function runSearch(page, query) {
  await startSearch(page, query);
  await expect(page.locator("#search-spinner")).toBeHidden();
}

/**
 * Which entry schema the previous deployment's validator would accept.
 *
 * Cached JavaScript can only be compatible with records it can read. When the
 * published schema changes, cached JavaScript is deliberately incompatible,
 * and asserting otherwise would only be satisfiable by never changing it.
 */
function entrySchemaAtPreviousDeployment() {
  const source = fileAtPreviousDeployment("assets/security.mjs");
  const single = /ENTRY_SCHEMA_VERSION = ([0-9]+)/.exec(source);
  return single ? Number(single[1]) : null;
}

const currentEntrySchema = Number(
  /ENTRY_SCHEMA_VERSION = ([0-9]+)/.exec(
    readFileSync(fileURLToPath(new URL("../assets/security.mjs", import.meta.url)), "utf8"),
  )[1],
);

test("the registry follows the browser's light and dark preference", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`/?database=${database}`);
  await expect(page.locator("html")).toHaveCSS("background-color", "rgb(16, 18, 22)");
  await expect(page.locator("body")).toHaveCSS("color", "rgb(232, 234, 238)");
  await expect(page.locator(".toolbar")).toHaveCSS("background-color", "rgb(28, 32, 39)");
  await expect(page.locator(".filter:not(.active)").first()).toHaveCSS(
    "background-color", "rgb(36, 41, 51)",
  );
  await expect(page.locator(".filter.active")).toHaveCSS("background-color", "rgb(16, 18, 22)");

  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.locator("body")).toHaveCSS("color", "rgb(17, 17, 17)");
  await expect(page.locator(".toolbar")).toHaveCSS("background-color", "rgb(242, 242, 242)");
  await expect(page.locator(".filter:not(.active)").first()).toHaveCSS(
    "background-color", "rgb(232, 232, 232)",
  );
  await expect(page.locator(".filter.active")).toHaveCSS("background-color", "rgb(255, 255, 255)");
});

test("the render frame lands on the same paper as the page around it", async ({ page }) => {
  // The framed render is a separate document on a separate origin, so the page
  // cannot reach in and theme it, and does not try: the frame reads
  // prefers-color-scheme itself. That only looks right if the two palettes
  // agree, which is what is asserted on both sides of the boundary here.
  const paper = { dark: "rgb(16, 18, 22)", light: "rgb(255, 255, 255)" };
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`/render.html?id=PALOMAR-2026-07-29-000123&version=1&database=${database}`);
  const frame = page.locator(".challenge-presentation iframe");
  for (const scheme of ["dark", "light"]) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect(page.locator("html")).toHaveCSS("background-color", paper[scheme]);
    await expect(frame).toHaveCSS("background-color", paper[scheme]);
    await expect(
      page.frameLocator(".challenge-presentation iframe").locator("body"),
    ).toHaveCSS("background-color", paper[scheme]);
  }
});

test("submission-guide headings expose hoverable links that copy their section URL", async ({ context, page }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/how-to-submit.html");

  const sectionHeading = page.locator("#getting-ready h2");
  const sectionAnchor = sectionHeading.getByRole("link", { name: "Copy link to Getting ready to submit" });
  await expect(sectionAnchor).toHaveCSS("opacity", "0");
  await sectionAnchor.focus();
  await expect(sectionAnchor).toHaveCSS("opacity", "1");
  await page.locator("body").click({ position: { x: 0, y: 0 } });
  await expect(sectionAnchor).toHaveCSS("opacity", "0");
  await sectionHeading.hover();
  await expect(sectionAnchor).toHaveCSS("opacity", "1");

  await sectionAnchor.click();
  await expect(page).toHaveURL(/how-to-submit\.html#getting-ready$/);
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(
    /how-to-submit\.html#getting-ready$/,
  );
  await expect(page.getByRole("status")).toHaveText("Copied link to Getting ready to submit");
  await expect(sectionAnchor).toHaveClass(/copied/);
  await expect(sectionAnchor.locator("path")).toHaveCSS("fill", "rgb(23, 111, 44)");

  const headings = page.locator("main.about h2, main.about h3");
  await expect(page.locator("main.about .heading-anchor")).toHaveCount(await headings.count());

  await expect(page.locator("#formalization-yaml .heading-anchor")).toHaveAttribute(
    "href",
    "#formalization-yaml",
  );
  await expect(page.locator("#ready-to-submit .heading-anchor")).toHaveAttribute(
    "href",
    "#ready-to-submit",
  );
});

test("every formalization.yaml mention in the submission guide links to its standard", async ({ page }) => {
  await page.goto("/how-to-submit.html");
  const standard = "https://github.com/mathlib-initiative/formalization.yaml";
  const result = await page.locator("main").evaluate((main, expected) => {
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    const unlinked = [];
    let mentions = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const count = node.textContent.split("formalization.yaml").length - 1;
      mentions += count;
      if (count && node.parentElement.closest("a")?.href !== expected) {
        unlinked.push(node.textContent.trim());
      }
    }
    return { mentions, unlinked };
  }, standard);
  expect(result.mentions).toBeGreaterThan(0);
  expect(result.unlinked).toEqual([]);
});

test("landing cards show the registration date and dated identifier", async ({ page }) => {
  const dynamicRequests = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/database/")) dynamicRequests.push(path);
  });
  // A landing record read is a regression even if its result happens to be
  // valid, so make one fail loudly instead of letting it hide in the fixture.
  await page.route("**/database/entries/*.json", (route) => route.abort());
  await page.goto(`/?database=${database}`);
  const first = page.locator(".entry-card").first();
  await expect(first.locator(".entry-id")).toContainText("PALOMAR-2026-07-29-");
  await expect(first.locator(".entry-id")).toContainText("v2 · current");
  // The card is dated by the version it shows, so the current version of this
  // result is dated by its own registration and not by its v1's day. The page
  // is ordered by the same instant, so the visible dates run in page order.
  await expect(first.locator(".entry-date")).toHaveText("Registered 2 August 2026");
  await expect(first.locator(".trust-badge")).toHaveText("Statement dependencies: Mathlib only");
  await expect(first.getByRole("link", { name: "2 versions" })).toHaveAttribute(
    "href",
    /entry\.html\?.*version=2.*#version-history$/,
  );
  await expect(first.locator(".version-history-link")).toHaveAttribute(
    "aria-label",
    "2 versions of PALOMAR-2026-07-29-000123",
  );
  await expect(page.locator(".entry-card")).toHaveCount(2);
  await expect(first.locator(".card-subjects")).toContainText("math.CO");
  await expect(first.locator(".card-subjects")).toContainText("MSC 05C10");
  await expect(first.locator(".card-project")).toContainText("Project directory");
  await expect(first.locator(".card-project")).toContainText("project");
  await expect(first.locator("h3")).toContainText("version 2");
  await expect(first.locator(".card-abstract")).toContainText("quasicoherent behaviour");
  await expect(first.locator(".card-meta")).toContainText("Example");
  await expect(first.locator(".card-meta")).toContainText("Example.theorem");
  await expect(first.locator(".repo-link")).toHaveAttribute(
    "href",
    /github\.com\/example\/challenge\/tree\/1{40}$/,
  );
  await expect(first.locator(".archive-link")).toHaveAttribute(
    "href",
    /github\.com\/PalomarArchive\/example--challenge\/tree\/1{40}$/,
  );
  await expect(page.locator("#metric-results")).toHaveText("2");
  await expect(page.locator("#metric-projects")).toHaveText("1");
  await expect(page.getByRole("button", { name: "Mathlib only" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Additional libraries" })).toBeVisible();
  await expect.poll(() => [...dynamicRequests].sort()).toEqual([
    "/database/recent.json",
    "/database/source-availability.json",
  ]);
  await page.waitForTimeout(100);
  expect(dynamicRequests.filter((path) => path.startsWith("/database/entries/"))).toEqual([]);
  expect(dynamicRequests).toHaveLength(2);
});

test("card metadata is on the card, not behind a toggle", async ({ page }) => {
  await page.goto(`/?database=${database}`);
  const card = page.locator(".entry-card").first();

  // Titles in this registry are repository names, so the authors and the
  // theorem are what make a row identifiable while scanning the list. They
  // are read without opening anything, and there is nothing to open.
  await expect(card.locator(".card-meta")).toBeVisible();
  await expect(card.locator(".card-meta")).toContainText("Example");
  await expect(card.locator(".card-meta")).toContainText("Example.theorem");
  await expect(card.locator(".card-subjects")).toContainText("math.CO");
  await expect(card.locator(".card-project")).toContainText("Project directory");
  await expect(card.locator("details")).toHaveCount(0);
});

test("landing cards preserve the publisher's newest-first order", async ({ page }) => {
  const registeredAt = new Map([
    ["PALOMAR-2026-07-29-000124", "2026-07-29T23:00:00Z"],
    ["PALOMAR-2026-07-29-000123", "2026-07-29T22:00:00Z"],
  ]);
  await page.route("**/database/recent.json", async (route) => {
    const response = await route.fetch();
    const recent = await response.json();
    expect(recent.entries).toHaveLength(registeredAt.size);
    const rows = new Map(recent.entries.map((row) => [row.id, row]));
    recent.entries = [...registeredAt].map(([id, publishedAt]) => ({
      ...rows.get(id),
      published_at: publishedAt,
    }));
    await route.fulfill({ response, json: recent });
  });
  await page.goto(`/?database=${database}`);

  // Recency and identifier order deliberately disagree. The DOM must follow
  // recent.json, whose order has already been validated as newest-first.
  await expect(page.locator("#entry-grid .entry-card .entry-id")).toHaveText([
    "PALOMAR-2026-07-29-000124 v1 · current",
    "PALOMAR-2026-07-29-000123 v2 · current",
  ]);
});

test("old, partial, and malformed recent summaries fail closed before rendering", async ({ page }) => {
  let variant = "old";
  const entryRequests = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/database/entries/")) entryRequests.push(path);
  });
  await page.route("**/database/recent.json", async (route) => {
    const response = await route.fetch();
    const document = await response.json();
    if (variant === "old") {
      document.entries = document.entries.map((row) => ({
        id: row.id,
        version: row.version,
        title: row.title,
        status: row.status,
        path: row.path,
        published_at: row.published_at,
        versions: row.versions,
      }));
    } else if (variant === "partial") {
      delete document.entries[0].abstract;
    } else {
      document.entries[0].preservation.repositories[0].commit = "2".repeat(40);
    }
    await route.fulfill({ response, json: document });
  });

  for (const selected of ["old", "partial", "malformed"]) {
    variant = selected;
    await page.goto(`/?database=${database}&contract-case=${selected}`);
    await expect(page.locator("#entry-grid .entry-card")).toHaveCount(0);
    await expect(page.locator("#status")).toHaveClass(/error/);
    await expect(page.locator("#status")).toContainText("The registry could not be loaded");
  }
  expect(entryRequests).toEqual([]);
});

test("an unavailable recent summary reports failure instead of emptiness", async ({ page }) => {
  await page.route("**/database/recent.json", (route) =>
    route.fulfill({ status: 503, body: "temporarily unavailable" }),
  );

  await page.goto(`/?database=${database}`);

  await expect(page.locator("#status")).toContainText("The registry could not be loaded: 503");
  await expect(page.locator("#entry-grid .entry-card")).toHaveCount(0);
  await expect(page.locator("#status")).toHaveClass(/error/);
  await expect(page.locator("#status")).not.toContainText("No entries have been published");
});

test("registry entries can be filtered by arXiv and MSC classifications", async ({ page }) => {
  await page.goto(`/?database=${database}`);
  await expect(page.locator("#arxiv-query")).toBeVisible();
  await expect(page.locator("#msc-query")).toBeVisible();
  await expect(page.locator('#arxiv-options option[value="math.NT"]')).toHaveCount(1);
  await expect(page.locator('#msc-options option[value="05C10"]')).toHaveCount(1);

  await page.locator("#arxiv-query").fill("math.NT");
  await expect(page.locator(".entry-card:visible")).toHaveCount(1);
  await expect(page.locator(".entry-card:visible")).toContainText("000124");

  await page.locator("#arxiv-query").fill("");
  await page.locator("#msc-query").fill("05C10");
  await expect(page.locator(".entry-card:visible")).toHaveCount(1);
  await expect(page.locator(".entry-card:visible")).toContainText("000123");

  await page.locator("#arxiv-query").fill("  math.CO  ");
  await expect(page.locator(".entry-card:visible")).toHaveCount(1);
  await expect(page.locator(".entry-card:visible")).toContainText("000123");
});

test("classification filters apply from a deep link", async ({ page }) => {
  await page.goto(`/?database=${database}&arxiv=math.NT`);
  await expect(page.locator("#arxiv-query")).toBeVisible();
  await expect(page.locator("#arxiv-query")).toHaveValue("math.NT");
  await expect(page.locator(".entry-card:visible")).toHaveCount(1);
  await expect(page.locator(".entry-card:visible")).toContainText("000124");
});

test("absent classifications produce a useful empty result", async ({ page }) => {
  await page.goto(`/?database=${database}&arxiv=math.AG`);
  await expect(page.locator("#arxiv-query")).toHaveValue("math.AG");
  await expect(page.locator(".entry-card:visible")).toHaveCount(0);
  await expect(page.locator("#status")).toHaveText(
    "No registry entries match the current filters. Classification query: arXiv math.AG.",
  );

  await page.locator("#arxiv-query").fill("");
  await expect(page.locator(".entry-card:visible")).toHaveCount(2);
  await expect(page.locator("#status")).toBeHidden();

  await page.locator("#msc-query").fill("14Q05");
  await expect(page.locator(".entry-card:visible")).toHaveCount(0);
  await expect(page.locator("#status")).toContainText("Classification query: MSC2020 14Q05.");

  await page.locator("#arxiv-query").fill("math.AG");
  await expect(page.locator("#status")).toContainText(
    "Classification query: arXiv math.AG, MSC2020 14Q05.",
  );
});

test("malformed classification parameters are bounded and identified", async ({ page }) => {
  await page.goto(`/?database=${database}&arxiv=${encodeURIComponent("not a code".repeat(20))}`);
  await expect(page.locator("#arxiv-query")).toHaveValue("not a codenot a codenot a codeno");
  await expect(page.locator(".entry-card:visible")).toHaveCount(0);
  await expect(page.locator("#status")).toHaveText(
    "No registry entries match the current filters. Invalid classification code format: arXiv.",
  );
});

test("an unversioned entry link resolves to the current immutable URL", async ({ page }) => {
  await page.goto(
    `/entry.html?id=PALOMAR-2026-07-29-000123&database=${database}#version-history`,
  );

  await expect(page.locator(".entry-heading h1")).toHaveText(
    "Fixture PALOMAR-2026-07-29-000123 version 2",
  );
  await expect(page.locator(".entry-heading .trust-badge")).toHaveText(
    "Statement dependencies: Mathlib only",
  );
  await expect(page.locator(".entry-classification")).toContainText("math.CO");
  await expect(page.locator(".entry-classification")).toContainText("05C10");
  // A classification is a way to find the neighbours, so the code itself is
  // the link, and it goes to the subject page for it: every current version
  // carrying the code, not the handful the landing page happens to hold. The
  // feeds it used to link to were never published, so every one was a 404.
  await expect(page.locator(".entry-classification").getByRole("link", { name: "RSS" })).toHaveCount(0);
  const mscLink = page.locator(".entry-classification .category-link", { hasText: "05C10" });
  await expect(mscLink).toHaveAttribute("href", /subject\.html\?kind=msc&code=05C10/);
  await expect(
    page.locator(".entry-classification .category-link", { hasText: "math.CO" }),
  ).toHaveAttribute("href", /subject\.html\?kind=arxiv&code=math\.CO/);
  // And a code nobody can read is glossed with what it means, in both
  // taxonomies: math.MG does not announce itself as metric geometry either.
  await expect(mscLink).toHaveAttribute("title", /05C10 — .+/);
  await expect(
    page.locator(".entry-classification .category-link", { hasText: "math.CO" }),
  ).toHaveAttribute("title", "math.CO — Combinatorics");
  await expect(page).toHaveURL(/entry\.html\?id=PALOMAR-2026-07-29-000123&version=2&database=/);
  await expect(page).toHaveURL(/#version-history$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://palomar-registry.org/entry.html?id=PALOMAR-2026-07-29-000123&version=2",
  );
});

test("an entry answers its reader's first three questions first", async ({ page }) => {
  await page.goto(`/entry.html?id=PALOMAR-2026-07-29-000123&database=${database}`);
  await expect(page.locator(".entry-evidence")).toBeVisible();

  // The statement, then what was checked about it, then what it rests on. An
  // entry is about a theorem, and the theorem does not go below the paperwork
  // that certifies it. These used to be sixth, fifth and seventh, behind the
  // version history and the subject classification.
  const order = await page.evaluate(() =>
    [...document.querySelectorAll("main section")]
      .map((section) => section.className.split(" ")[0])
      .filter(Boolean));
  const position = (name) => order.indexOf(name);
  // First, except for notices. A warning that the pinned source has moved or
  // gone is the one thing that outranks the statement itself.
  const NOTICES = ["source-availability", "version-notice"];
  expect(order.slice(0, position("challenge-presentation")).every((name) => NOTICES.includes(name)))
    .toBe(true);
  expect(position("challenge-presentation")).toBeLessThan(position("entry-evidence"));
  expect(position("entry-evidence")).toBeLessThan(position("entry-trust"));
  expect(position("entry-trust")).toBeLessThan(position("entry-classification"));
  expect(position("entry-trust")).toBeLessThan(position("entry-provenance"));
  expect(position("source-availability")).toBeGreaterThan(position("entry-editorial"));
  expect(position("source-availability") + 1).toBe(position("version-history"));

  // The dependencies are further down this page, so following the link scrolls
  // rather than loading anything. (The href is absolute either way, so what is
  // worth asserting is where it lands.) The dense sections start collapsed, so
  // the fragment link has to open the section before the browser scrolls to it.
  await expect(page.locator("#statement-dependencies .section-collapse")).not.toHaveAttribute(
    "open",
    "",
  );
  const before = page.url();
  await page
    .locator(".challenge-links")
    .getByRole("link", { name: "Inspect statement dependencies" })
    .click();
  await expect(page.locator("#statement-dependencies")).toBeInViewport();
  await expect(page.locator("#statement-dependencies .section-collapse")).toHaveAttribute(
    "open",
    "",
  );
  expect(page.url().split("#")[0]).toBe(before.split("#")[0]);
});

test("a hash that arrives without a click still opens its section", async ({ page }) => {
  await page.goto(`/entry.html?id=PALOMAR-2026-07-29-000123&database=${database}`);
  await expect(page.locator("#statement-dependencies")).toBeVisible();
  await expect(page.locator("#statement-dependencies .section-collapse")).not.toHaveAttribute(
    "open",
    "",
  );

  // What the address bar and the history buttons do: the fragment changes on a
  // page that is already loaded, with no link to intercept.
  await page.evaluate(() => {
    window.location.hash = "#statement-dependencies";
  });
  await expect(page.locator("#statement-dependencies .section-collapse")).toHaveAttribute(
    "open",
    "",
  );
  await expect(page.locator("#statement-dependencies")).toBeInViewport();
});

test("the licence caveat travels with the licence evidence it qualifies", async ({ page }) => {
  await page.goto(`/entry.html?id=PALOMAR-2026-07-29-000123&database=${database}`);
  const collapse = page.locator(".entry-evidence .section-collapse");

  // A page that says this licence evidence covers the snapshot only, while the
  // licence row is folded away, is a caveat about nothing on the page.
  await expect(collapse).toBeVisible();
  await expect(collapse.locator(".licence-boundary")).toHaveCount(1);
  await expect(page.locator(".licence-boundary")).toBeHidden();

  await collapse.locator("summary").click();
  await expect(collapse).toHaveAttribute("open", "");
  await expect(page.locator(".licence-boundary")).toBeVisible();
  await expect(collapse.locator("dl.details")).toContainText("Repository licence");
});

test("the subject filters share the toolbar's line, ending at its right edge", async ({ page }) => {
  await page.goto(`/?database=${database}`);
  const card = page.locator(".entry-card").first();

  const toolbar = await page.locator(".toolbar").boundingBox();
  const trust = await page.locator(".filters").boundingBox();
  const inputs = await page.locator(".category-filters").boundingBox();
  const listed = await card.boundingBox();

  // One line: the subject inputs start after the trust filters end, and their
  // vertical centres agree.
  expect(inputs.x).toBeGreaterThan(trust.x + trust.width);
  expect(Math.abs((inputs.y + inputs.height / 2) - (trust.y + trust.height / 2)))
    .toBeLessThan(4);
  // Justified right, and still clear of the list below.
  expect(Math.abs((inputs.x + inputs.width) - (toolbar.x + toolbar.width)))
    .toBeLessThan(16);
  expect(inputs.y + inputs.height).toBeLessThanOrEqual(listed.y);
});

test("a thin wrapper says where the mathematics is before anything else", async ({ page }) => {
  // validateEntry requires the substantive formalization to be one of the
  // immutable sources already covered by the record's preservation receipt.
  const repository = "example/dependency";
  const commit = "3".repeat(40);
  await page.route(
    "**/database/entries/PALOMAR-2026-07-29-000123-v2.json",
    async (route) => {
      const response = await route.fetch();
      const entry = await response.json();
      entry.provenance.repository_role = "thin-wrapper";
      entry.provenance.substantive_formalization = {
        repository,
        repository_url: `https://github.com/${repository}`,
        commit,
        tree_url: `https://github.com/${repository}/tree/${commit}`,
      };
      await route.fulfill({ response, json: entry });
    },
  );

  await page.goto(`/entry.html?id=PALOMAR-2026-07-29-000123&database=${database}`);
  const rows = page.locator(".entry-provenance .provenance-details .detail-row dt");
  await expect(rows.first()).toHaveText("Substantive formalization");
  await expect(page.getByRole("link", { name: `${repository}@${commit.slice(0, 12)}`, includeHidden: true }))
    .toHaveAttribute("href", `https://github.com/${repository}/tree/${commit}`);
});

test("entry and render content do not wait for a never-settling availability read", async ({ page }) => {
  const pending = [];
  await page.route("**/database/source-availability.json", async (route) => {
    let release;
    const blocked = new Promise((resolve) => {
      release = resolve;
    });
    pending.push({ release });
    await blocked;
    await route.abort("failed");
  });

  await page.goto(
    `/entry.html?id=PALOMAR-2026-07-29-000123&version=1&database=${database}`,
  );
  await expect(page.locator(".entry-heading h1")).toBeVisible();
  await expect(page.locator(".entry-evidence")).toBeVisible();
  await expect(page.locator(".source-availability")).toBeHidden();
  await expect(page.locator("#status")).toBeHidden();
  await expect.poll(() => pending.length).toBe(1);
  pending[0].release();

  await page.goto(
    `/render.html?id=PALOMAR-2026-07-29-000123&version=1&database=${database}`,
  );
  await expect(page.locator(".entry-heading h1")).toBeVisible();
  await expect(page.locator(".challenge-metadata")).toBeVisible();
  await expect(page.locator("#status")).toBeHidden();
  await expect.poll(() => pending.length).toBe(2);
  pending[1].release();
});

test("late availability updates source links in place without taking focus", async ({ page }) => {
  let releaseAvailability;
  let availabilityRequested;
  const requested = new Promise((resolve) => {
    availabilityRequested = resolve;
  });
  await page.route("**/database/source-availability-missing.json", async (route) => {
    const response = await route.fetch();
    availabilityRequested();
    await new Promise((resolve) => {
      releaseAvailability = resolve;
    });
    await route.fulfill({ response });
  });

  await page.goto(
    `/entry.html?id=PALOMAR-2026-07-29-000123&version=1&database=${database}` +
      `&availability=${missingAvailability}`,
  );
  await requested;
  const source = page.getByRole("link", { name: /View full pinned statement file/ });
  await expect(source).toHaveAttribute(
    "href",
    /github\.com\/example\/challenge\/blob\/1{40}\//,
  );
  await source.focus();
  await expect(source).toBeFocused();

  releaseAvailability();
  await expect(source).toHaveAttribute(
    "href",
    /github\.com\/PalomarArchive\/example--challenge\/blob\/1{40}\//,
  );
  await expect(source).toBeFocused();
  await expect(page.locator(".source-availability.original-missing")).toBeVisible();
});

test("a settled manifest reports two unavailable source copies without delaying content", async ({ page }) => {
  await page.route("**/database/source-availability-missing.json", async (route) => {
    const response = await route.fetch();
    const availability = await response.json();
    const fresh = new Date().toISOString().replace(/\.[0-9]{3}Z$/, "Z");
    availability.generated_at = fresh;
    for (const row of availability.repositories) {
      row.original.status = "missing";
      row.original.checked_at = fresh;
      row.original.last_attempt_at = fresh;
      row.archive.status = "missing";
      row.archive.checked_at = fresh;
      row.archive.last_attempt_at = fresh;
    }
    await route.fulfill({ response, json: availability });
  });

  await page.goto(
    `/entry.html?id=PALOMAR-2026-07-29-000123&database=${database}` +
      `&availability=${missingAvailability}`,
  );

  await expect(page.locator(".entry-heading h1")).toBeVisible();
  const notice = page.getByRole("status").filter({ hasText: "No working preserved source location" });
  await expect(notice).toHaveClass(/unrecoverable/);
  await expect(notice.getByRole("link", { name: "Recorded original location" })).toBeVisible();
  await expect(notice.getByRole("link", { name: "Recorded Palomar copy" })).toBeVisible();
});

test("a missing original automatically switches source links to the Palomar copy", async ({ page }) => {
  await page.goto(
    `/entry.html?id=PALOMAR-2026-07-29-000123&database=${database}` +
      `&availability=${missingAvailability}`,
  );
  const notice = page.locator(".source-availability.original-missing");
  await expect(notice).toContainText("Original source unavailable");
  await expect(notice.getByRole("link", { name: "Palomar preserved copy" })).toHaveAttribute(
    "href",
    /github\.com\/PalomarArchive\/example--challenge\/tree\/1{40}\/project$/,
  );
  await expect(
    page.getByRole("link", { name: /View full pinned statement file/ }),
  ).toHaveAttribute(
    "href",
    /github\.com\/PalomarArchive\/example--challenge\/blob\/1{40}\/project\/Comparator\/Task\.lean$/,
  );
  await page.locator(".entry-solution .section-collapse > summary").click();
  await page.locator("details.solution-dependencies > summary").click();
  await expect(page.getByRole("link", { name: "example/dependency (Palomar copy)" })).toHaveAttribute(
    "href",
    /github\.com\/PalomarArchive\/example--dependency\/tree\/3{40}$/,
  );
});

test("entry rendering demotes a stale original without discarding a fresh archive result", async ({ page }) => {
  await page.route("**/database/source-availability-missing.json", async (route) => {
    const response = await route.fetch();
    const availability = await response.json();
    const now = new Date();
    now.setMilliseconds(0);
    const stale = new Date(now.getTime() - 18 * 60 * 60 * 1000 - 1_000)
      .toISOString().replace(".000Z", "Z");
    const fresh = now.toISOString().replace(".000Z", "Z");
    availability.generated_at = fresh;
    for (const row of availability.repositories) {
      row.original.status = "missing";
      row.original.checked_at = stale;
      row.original.last_attempt_at = null;
      row.archive.status = "missing";
      row.archive.checked_at = fresh;
      row.archive.last_attempt_at = fresh;
    }
    await route.fulfill({ response, json: availability });
  });

  await page.goto(
    `/entry.html?id=PALOMAR-2026-07-29-000123&database=${database}` +
      `&availability=${missingAvailability}`,
  );

  const notice = page.locator(".source-availability.archive-missing");
  await expect(notice).toContainText(
    "Source preservation degraded",
  );
  await expect(notice).toContainText("its current availability has not been confirmed");
  await expect(notice).not.toContainText("still works");
  await expect(notice.getByRole("link", { name: "Recorded original location" })).toBeVisible();
  await expect(page.locator(".source-availability.original-missing")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /View full pinned statement file/ })).toHaveAttribute(
    "href",
    /github\.com\/example\/challenge\/blob\/1{40}\/project\/Comparator\/Task\.lean$/,
  );
});

test("an archive warning says the original works only after a fresh confirmation", async ({ page }) => {
  await page.route("**/database/source-availability.json", async (route) => {
    const response = await route.fetch();
    const availability = await response.json();
    const fresh = new Date().toISOString().replace(/\.[0-9]{3}Z$/, "Z");
    availability.generated_at = fresh;
    for (const row of availability.repositories) {
      row.original.status = "available";
      row.original.checked_at = fresh;
      row.archive.status = "missing";
      row.archive.checked_at = fresh;
    }
    await route.fulfill({ response, json: availability });
  });

  await page.goto(`/entry.html?id=PALOMAR-2026-07-29-000123&database=${database}`);

  const notice = page.locator(".source-availability.archive-missing");
  await expect(notice).toContainText("The original source still works");
  await expect(notice).not.toContainText("has not been confirmed");
  await expect(notice.getByRole("link", { name: "Original source" })).toBeVisible();
});

test("entry schema v1 fails closed before rendering", async ({ page }) => {
  await page.route("**/entries/PALOMAR-2026-07-29-000123-v1.json", async (route) => {
    const response = await route.fetch();
    const obsolete = await response.json();
    obsolete.schema_version = 1;
    await route.fulfill({ response, json: obsolete });
  });
  await page.goto(
    `/entry.html?id=PALOMAR-2026-07-29-000123&version=1&database=${database}`,
  );

  await expect(page.locator(".entry-heading")).toHaveCount(0);
  await expect(page.locator("#status")).toHaveClass(/error/);
  await expect(page.locator("#status")).toContainText("unsupported entry schema_version 1");
});

test("a recent row without the required preservation mapping fails closed", async ({ page }) => {
  await page.route("**/database/recent.json", async (route) => {
    const response = await route.fetch();
    const recent = await response.json();
    recent.entries[0].preservation = null;
    await route.fulfill({ response, json: recent });
  });
  await page.goto(`/?database=${database}`);

  await expect(page.locator(".entry-card")).toHaveCount(0);
  await expect(page.locator("#status")).toHaveClass(/error/);
  await expect(page.locator("#status")).toContainText("preservation must be an object");
});

test("a card says the original is unavailable exactly when the manifest says so", async ({ page }) => {
  let releaseAvailability;
  let noteAvailabilityRequest;
  const availabilityRequested = new Promise((resolve) => { noteAvailabilityRequest = resolve; });
  await page.route("**/database/source-availability-missing.json", async (route) => {
    noteAvailabilityRequest();
    await new Promise((resolve) => { releaseAvailability = resolve; });
    await route.continue();
  });
  await page.goto(`/?database=${database}&availability=${missingAvailability}`);
  const card = page.locator(".entry-card").first();
  await expect(card).toHaveCount(1);
  await availabilityRequested;
  await page.locator("#arxiv-query").fill("math.CO");
  await expect(page.locator(".entry-card:visible")).toHaveCount(1);
  await page.locator("#arxiv-query").evaluate((input) => input.focus());
  await card.evaluate((node) => { node.dataset.progressiveFixture = "same-card"; });
  // Cards and filters are usable while availability is still pending.
  await expect(card.locator(".repo-link")).toHaveText("example/challenge");
  releaseAvailability();
  await expect(card.locator(".source-status.missing")).toHaveText("Original unavailable");
  await expect(card.locator(".repo-link")).toHaveText("Palomar preserved copy");
  await expect(card).toHaveAttribute("data-progressive-fixture", "same-card");
  await expect(page.locator("#arxiv-query")).toBeFocused();
  await expect(page.locator("#arxiv-query")).toHaveValue("math.CO");
  await expect(page.locator(".entry-card:visible")).toHaveCount(1);

  await page.goto(`/?database=${database}`);
  await expect(page.locator(".entry-card .source-status")).toHaveCount(0);
});

test("progressive cards never apply a stale missing claim", async ({ page }) => {
  let releaseAvailability;
  let noteAvailabilityRequest;
  const availabilityRequested = new Promise((resolve) => { noteAvailabilityRequest = resolve; });
  await page.route("**/database/source-availability-missing.json", async (route) => {
    noteAvailabilityRequest();
    const response = await route.fetch();
    const availability = await response.json();
    const now = new Date();
    now.setMilliseconds(0);
    availability.generated_at = now.toISOString().replace(".000Z", "Z");
    const stale = new Date(now.getTime() - 18 * 60 * 60 * 1000 - 1_000)
      .toISOString().replace(".000Z", "Z");
    for (const row of availability.repositories) {
      row.original.checked_at = stale;
      row.original.last_attempt_at = null;
    }
    await new Promise((resolve) => { releaseAvailability = resolve; });
    await route.fulfill({ response, json: availability });
  });

  await page.goto(`/?database=${database}&availability=${missingAvailability}`);
  const card = page.locator(".entry-card").first();
  await expect(card).toHaveCount(1);
  await availabilityRequested;
  await card.evaluate((node) => { node.dataset.progressiveFixture = "same-card"; });
  await card.locator(".repo-link").focus();
  releaseAvailability();

  await expect(card.locator(".repo-link")).toHaveText("example/challenge");
  await expect(card.locator(".source-status.missing")).toHaveCount(0);
  await expect(card.locator(".archive-link")).toBeVisible();
  await expect(card).toHaveAttribute("data-progressive-fixture", "same-card");
  await expect(card.locator(".repo-link")).toBeFocused();
});

test("entry pages list immutable versions and flag superseded snapshots", async ({ page }) => {
  await page.goto(
    `/entry.html?id=PALOMAR-2026-07-29-000123&version=1&database=${database}`,
  );

  const notice = page.locator(".version-notice");
  await expect(notice.getByRole("heading", { name: "Newer version available" })).toBeVisible();
  await expect(notice).toContainText("Newer version available");
  await expect(notice).toContainText("Version 2 is the current version");
  await expect(notice.getByRole("link", { name: "View current version 2" })).toHaveAttribute(
    "href",
    /entry\.html\?.*version=2/,
  );

  const history = page.locator("#version-history");
  await expect(history.getByRole("heading", { name: "Versions" })).toBeVisible();
  await expect(history.locator("li")).toHaveCount(2);
  await expect(history.locator("li").nth(0)).toContainText("Version 2");
  await expect(history.locator("li").nth(0)).toContainText("Current");
  await expect(history.locator("li").nth(1)).toContainText("Version 1");
  await expect(history.locator("li").nth(1)).toContainText("Superseded");
  await expect(history.locator("li").nth(1)).toContainText("Viewing");
  await expect(page.locator(".entry-heading h1")).toHaveText(
    "Fixture PALOMAR-2026-07-29-000123 version 1",
  );
  await expect(page.locator(".machine-record")).toHaveCount(0);
  const fullRecord = page.locator(".entry-evidence .detail-row", {
    has: page.getByText("Full registry record", { exact: true }),
  });
  await expect(fullRecord.getByRole("link", { includeHidden: true })).toHaveText(
    "PALOMAR-2026-07-29-000123-v1.json",
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://palomar-registry.org/entry.html?id=PALOMAR-2026-07-29-000123&version=1",
  );
});

test("a single current version has no supersession treatment", async ({ page }) => {
  await page.goto(`/?database=${database}`);
  const card = page.locator(".entry-card").nth(1);
  await expect(card.locator(".version-history-link")).toHaveCount(0);

  await page.goto(
    `/entry.html?id=PALOMAR-2026-07-29-000124&version=1&database=${database}`,
  );
  await expect(page.locator(".version-notice")).toHaveCount(0);
  await expect(page.locator("#version-history li")).toHaveCount(1);
});

test("entries display repository licence evidence and its boundary", async ({ page }) => {
  await page.goto(
    `/entry.html?id=PALOMAR-2026-07-29-000124&version=1&database=${database}`,
  );

  const evidence = page.locator(".entry-evidence");
  // One row, not four: the licence, the file, and the digest. Declared and
  // detected are the same fact when they agree, which is the ordinary case.
  await expect(evidence).toContainText("Repository licence");
  await expect(evidence.getByRole("link", { name: "LICENSE.md", includeHidden: true })).toHaveAttribute(
    "href",
    `https://github.com/example/challenge/blob/${"1".repeat(40)}/LICENSE.md`,
  );
  await expect(evidence).toContainText("Apache-2.0");
  await expect(evidence.locator(".detail-note").last()).toHaveAttribute(
    "title",
    /^[0-9a-f]{64}$/,
  );
  await expect(evidence).toContainText("Cited papers, reused formalizations, and dependencies retain their own licences");
});

test("detail routes reject malformed parameters before registry I/O", async ({ page }) => {
  const dataRequests = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/database/")) dataRequests.push(path);
  });
  await page.goto(
    `/entry.html?id=PALOMAR-2026-07-29-000123&version=2.0&database=${database}`,
  );
  await expect(page.locator("#status")).toContainText("missing or invalid Palomar ID or version");
  await expect(page.locator("#entry-content")).toBeHidden();

  await page.goto(
    `/render.html?id=PALOMAR-2026-07-29-000123&version=02&database=${database}`,
  );
  await expect(page.locator("#status")).toContainText("missing a valid Palomar ID and version");
  await expect(page.locator("#render-content")).toBeHidden();
  await page.waitForLoadState("networkidle");
  expect(dataRequests).toEqual([]);
});

test("an exact unavailable entry shows only its target and public date", async ({ page }) => {
  const id = "PALOMAR-2026-07-29-000125";
  await page.goto(`/entry.html?id=${id}&version=1&database=${database}`);

  await expect(page.locator(".tombstone-record h1")).toHaveText(`${id} v1`);
  await expect(page.locator(".tombstone-record p")).toHaveText("6 August 2026");
  await expect(page.locator("a:visible")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(/reason|takedown|withdraw/i);
});

test("an exact unavailable render uses the same minimal disclosure", async ({ page }) => {
  const id = "PALOMAR-2026-07-29-000125";
  await page.goto(`/render.html?id=${id}&version=1&database=${database}`);

  await expect(page.locator(".tombstone-record h1")).toHaveText(`${id} v1`);
  await expect(page.locator(".tombstone-record p")).toHaveText("6 August 2026");
  await expect(page.locator("a:visible")).toHaveCount(0);
});

test("unknown exact versions remain generic not-found pages", async ({ page }) => {
  await page.goto(
    `/entry.html?id=PALOMAR-2026-07-29-999999&version=1&database=${database}`,
  );
  await expect(page.locator("#status")).toContainText("entry not found");
  await expect(page.locator(".tombstone-record")).toHaveCount(0);
});

test("the index version-history link reaches history loaded at runtime", async ({ page }) => {
  await page.goto(`/?database=${database}`);
  await page.locator(".entry-card").first().getByRole("link", { name: "2 versions" }).click();

  await expect(page).toHaveURL(/#version-history$/);
  await expect(page.locator("#version-history")).toBeInViewport();
});

test("optional metric markup cannot take down the registry", async ({ page }) => {
  const withoutProjectMetric = currentIndex.replace(
    /\s*<span><strong id="metric-projects">.*?<\/strong> source projects<\/span>/,
    "",
  );
  expect(withoutProjectMetric).not.toEqual(currentIndex);
  await page.route(/^http:\/\/127\.0\.0\.1:4173\/(?:\?.*)?$/, (route) => route.fulfill({
    body: withoutProjectMetric,
    contentType: "text/html; charset=utf-8",
  }));

  await page.goto(`/?database=${database}`);
  await expect(page.locator(".entry-card")).toHaveCount(2);
  await expect(page.locator("#status")).not.toContainText("could not be loaded");
});

test("eligible Challenge renders inline without origin privilege", async ({ page }) => {
  await page.goto(`/entry.html?id=PALOMAR-2026-07-29-000123&version=1&database=${database}`);
  await expect(page.locator(".entry-heading .trust-badge")).toHaveText(
    "Statement dependencies: Mathlib only",
  );

  const source = page.locator(".challenge-presentation .challenge-source");
  await expect(
    page.getByRole("heading", { name: "Named compared declarations" }),
  ).toBeVisible();
  await expect(page.locator(".challenge-surface-disclosure")).toContainText(
    "declarations named in this entry's comparator configuration",
  );
  await expect(page.locator(".challenge-surface-disclosure")).toContainText(
    "statement and dependency surface for inspection",
  );
  await expect(source).toHaveAttribute(
    "href",
    `https://github.com/example/challenge/blob/${"1".repeat(40)}/project/Comparator/Task.lean`,
  );
  await expect(source).toHaveText("View full pinned statement file (Task.lean)");
  const playground = page.getByRole("link", { name: "Open in Lean Playground" });
  await expect(playground).toHaveAttribute(
    "href",
    `https://live.lean-lang.org/#url=https%3A%2F%2Fraw.githubusercontent.com%2Fexample%2Fchallenge%2F${
      "1".repeat(40)
    }%2Fproject%2FComparator%2FTask.lean`,
  );
  await expect(playground).toHaveAttribute("target", "_blank");
  await expect(playground).toHaveAttribute("rel", "noopener");
  await expect(playground).toHaveText("Lean ↗");
  await expect(playground).toHaveCSS("opacity", "0");
  const frameShell = page.locator(".challenge-frame-shell");
  await frameShell.hover({ position: { x: 4, y: 4 } });
  await expect(playground).toHaveCSS("opacity", "1");
  await page.mouse.move(0, 0);
  await playground.focus();
  await expect(playground).toHaveCSS("opacity", "1");
  await expect(
    page.getByRole("link", { name: "Inspect statement dependencies" }),
  ).toHaveAttribute("href", /#statement-dependencies$/);
  await expect(
    page.getByRole("link", { name: "View comparator configuration (settings.json)" }),
  ).toHaveAttribute(
    "href",
    `https://github.com/example/challenge/blob/${"1".repeat(40)}/project/Comparator/settings.json`,
  );
  await expect(page.getByRole("link", { name: "Open formatted statement" })).toHaveCount(0);
  const iframe = page.locator(".challenge-presentation iframe");
  await expect(iframe).toHaveAttribute("sandbox", "allow-scripts");
  await expect(iframe).toHaveAttribute("referrerpolicy", "no-referrer");
  await expect(iframe).toHaveAttribute("scrolling", "auto");
  await expect(iframe).toHaveAttribute(
    "src",
    `http://127.0.0.1:4173/database/renders/PALOMAR-2026-07-29-000123-v1/${"a".repeat(64)}/Challenge/index.html`,
  );
  const body = page.frameLocator(".challenge-presentation iframe").locator("body");
  await expect(body).toHaveAttribute("data-script-ran", "true");
  await expect(body).toHaveAttribute("data-top-access", "blocked");
  await expect(body).toHaveAttribute("data-storage-access", "blocked");
  await expect(page.locator("body")).not.toHaveAttribute("data-compromised", "true");
  await expect(page.locator(".challenge-metadata")).toContainText("Libraries imported by the statement");
  await expect(page.locator(".challenge-metadata code")).toHaveText("Mathlib");
  await expect(page.locator(".challenge-module-doc summary")).toHaveText("Notes from the statement file");
  await page.locator(".challenge-module-doc summary").click();
  await expect(page.locator(".challenge-module-doc pre")).toContainText("Parsed outside the Verso renderer");
  const rendered = page.frameLocator(".challenge-presentation iframe");
  await expect(rendered.locator(".docstring")).toHaveText("The theorem doc-string.");
  await expect(rendered.locator(".skip-link")).toHaveCount(0);
  await expect(rendered.locator("body")).not.toContainText("Fixture module");
  await expect(iframe).toHaveAttribute("data-height-adjusted", "true");
  const box = await iframe.boundingBox();
  expect(box.height).toBe(672);
  await expect(page.locator(".acceptance-callout")).toContainText("Registered on");
  await expect(page.locator(".acceptance-callout")).toContainText("29 July 2026");
  await expect(page.locator(".acceptance-callout")).toContainText("Mechanical assurance");
  await expect(page.locator(".acceptance-callout")).toContainText(
    "Editorial assurance",
  );
  await expect(page.locator(".acceptance-callout")).toContainText("AI-mediated review");
  const mechanicalAssurance = page.locator(".acceptance-callout p", {
    hasText: "Mechanical assurance",
  });
  await expect(mechanicalAssurance.locator("code")).toHaveText([
    "Solution.lean",
    "Challenge.lean",
  ]);
  const editorialAssurance = page.locator(".acceptance-callout p", {
    hasText: "Editorial assurance",
  });
  await expect(editorialAssurance.locator("code")).toHaveText("Challenge.lean");
  await expect(page.getByRole("link", { name: "Archived mechanical report" })).toBeVisible();
  await expect(page.locator(".entry-evidence")).toContainText("Verification workflow commit");
  await expect(page.getByRole("link", { name: "Archived editorial review" })).toBeVisible();
  await expect(page.getByRole("link", { name: "project/Comparator/Answer.lean", includeHidden: true }).first()).toHaveAttribute(
    "href",
    `https://github.com/example/challenge/blob/${"1".repeat(40)}/project/Comparator/Answer.lean`,
  );
  const sourceFiles = page.locator(
    '.entry-evidence .detail-row a[href*="github.com/example/challenge/blob/"]',
  );
  await expect(sourceFiles).toHaveText([
    "project/Comparator/Task.lean",
    "project/Comparator/Answer.lean",
    "project/formalization.yaml",
    "project/lakefile.lean",
    "LICENSE.md",
  ]);
  await expect(sourceFiles.nth(2)).toHaveAttribute(
    "href",
    `https://github.com/example/challenge/blob/${"1".repeat(40)}/project/formalization.yaml`,
  );
  await expect(page.locator(".entry-evidence")).toContainText("Project directory");
  await expect(page.locator(".entry-evidence")).toContainText("project");
  await expect(page.locator(".entry-solution .token-list code")).toHaveText("ExampleDependency");
  await page.locator(".entry-solution .section-collapse > summary").click();
  await page.locator(".solution-dependencies summary").click();
  await expect(page.locator(".dependency-list")).toContainText("example/dependency");
  await expect(page.getByRole("link", { name: "shared" })).toHaveAttribute(
    "href",
    `https://github.com/example/challenge/tree/${"1".repeat(40)}/shared`,
  );
  // A wheel is hit-tested against the compositor's last committed frame, so
  // one sent immediately after hover() has scrolled the frame into view can
  // still be aimed at where the page used to be and scroll the page instead:
  // the frame stays at 0 and never moves again, because nothing sends a
  // second wheel. Re-aim and send until the end of the frame's own document
  // is visible. Waiting only for a nonzero scroll position can finish while
  // Chromium is still applying the first wheel, before it has reached the
  // theorem ending. What is being asserted is that a wheel over the frame
  // scrolls the frame rather than the page around it, not how many events that
  // takes. Chromium latches a wheel gesture to one scroller, so the frame
  // absorbs the whole of the wheel that reaches it and stops at its own end.
  await expect.poll(async () => {
    await iframe.hover();
    await page.mouse.wheel(0, 2000);
    return rendered.locator("#theorem-end").evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      return bounds.top >= 0 && bounds.bottom <= window.innerHeight;
    });
  }).toBe(true);
  // The poll above checks the frame's viewport directly. Playwright's
  // toBeInViewport also intersects that with the parent page's viewport,
  // coupling this assertion to how many lines of controls precede the frame.
});

test("a missing formatted Challenge leaves the accepted entry and pinned source usable", async ({ page }) => {
  await page.route("**/challenge-metadata.json", (route) =>
    route.fulfill({ status: 404, body: "not published" }));

  await page.goto(`/entry.html?id=PALOMAR-2026-07-29-000123&version=1&database=${database}`);

  await expect(page.locator(".entry-heading h1")).toBeVisible();
  await expect(page.locator(".entry-evidence")).toBeVisible();
  await expect(page.locator(".challenge-fallback")).toContainText(
    "The formatted statement is not available for this entry yet",
  );
  await expect(page.locator(".challenge-presentation iframe")).toHaveCount(0);
  await expect(page.locator(".challenge-source")).toHaveAttribute(
    "href",
    `https://github.com/example/challenge/blob/${"1".repeat(40)}/project/Comparator/Task.lean`,
  );
  const playground = page.getByRole("link", { name: "Open in Lean Playground" });
  await expect(playground).toBeVisible();
  await expect(playground).toHaveText("Open in Lean Playground");
  await expect(playground).not.toHaveClass(/challenge-playground-button/);
  await expect(page.locator("#status")).toBeHidden();
});

test("the playground overlay remains visible without hover", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: false });
  const page = await context.newPage();
  await page.goto(`/entry.html?id=PALOMAR-2026-07-29-000123&version=1&database=${database}`);

  const playground = page.getByRole("link", { name: "Open in Lean Playground" });
  await expect(playground).toHaveClass(/challenge-playground-button/);
  await expect(playground).toHaveCSS("opacity", "1");
  await expect(playground).toHaveCSS("pointer-events", "auto");
  await context.close();
});

test("larger Challenge falls back to the dedicated wrapper", async ({ page }) => {
  await page.goto(`/entry.html?id=PALOMAR-2026-07-29-000124&version=1&database=${database}`);
  await expect(page.locator("#statement-dependencies")).toContainText(
    "leanprover-community/mathlib4",
  );
  await expect(page.locator("#statement-dependencies")).toContainText(
    "TauCetiProject/TauCeti",
  );
  await expect(page.getByRole("link", { name: "Open in Lean Playground" })).toHaveCount(0);
  await expect(page.locator(".challenge-presentation iframe")).toHaveCount(0);
  await expect(page.locator(".challenge-fallback")).toBeVisible();
  await expect(page.locator(".challenge-fallback")).toContainText(
    "This statement is too large to display here",
  );
  await page.getByRole("link", { name: "Open formatted statement" }).click();
  await expect(page).toHaveURL(/render\.html\?id=PALOMAR-2026-07-29-000124/);
  await expect(page.locator(".challenge-presentation iframe")).toHaveAttribute(
    "sandbox",
    "allow-scripts",
  );
  await expect(page.locator(".challenge-source")).toHaveAttribute(
    "href",
    `https://github.com/example/challenge/blob/${"1".repeat(40)}/Challenge.lean`,
  );
  await page.getByRole("link", { name: "Inspect statement dependencies" }).click();
  await expect(page).toHaveURL(/entry\.html\?.*#statement-dependencies$/);
  await expect(page.locator("#statement-dependencies")).toBeInViewport();
});

test("qualified statement and proof dependencies retain their distinct presentation", async ({ page }) => {
  await page.goto(`/entry.html?id=PALOMAR-2026-07-29-000124&version=1&database=${database}`);

  const statement = page.locator("#statement-dependencies");
  await expect(statement.getByRole("heading", { name: "Depends on additional libraries" }))
    .toBeVisible();
  await expect(statement.locator(".plain-list li")).toHaveText([
    "leanprover-community/mathlib4",
    "TauCetiProject/TauCeti",
  ]);
  await expect(statement.locator(".reason-list li")).toHaveText("Challenge imports Tau Ceti");

  const proof = page.locator(".entry-solution");
  await expect(proof.getByRole("heading", { name: "Verified proof" })).toBeVisible();
  await expect(proof.locator(".solution-dependencies summary")).toHaveText(
    "1 project dependencies used by the proof",
  );
  await proof.locator(".section-collapse > summary").click();
  await proof.locator(".solution-dependencies summary").click();
  await expect(proof.getByRole("link", { name: "example/dependency" })).toHaveAttribute(
    "href",
    `https://github.com/example/dependency/tree/${"3".repeat(40)}`,
  );
  await expect(proof.getByRole("link", { name: "Palomar preserved copy" })).toHaveAttribute(
    "href",
    `https://github.com/PalomarArchive/example--dependency/tree/${"3".repeat(40)}`,
  );
});

test("current HTML remains compatible with cached JavaScript from the previous deployment", async ({ page }) => {
  test.skip(!previousRef, "PALOMAR_PREVIOUS_REF is only set in deployment and pull-request CI");
  test.skip(
    entrySchemaAtPreviousDeployment() !== currentEntrySchema,
    "the published entry schema changed, so cached JavaScript cannot read current records",
  );
  await page.route("**/assets/app.js", (route) => route.fulfill({
    body: fileAtPreviousDeployment("assets/app.js"),
    contentType: "text/javascript; charset=utf-8",
  }));
  await page.route("**/assets/rendering.js", (route) => route.fulfill({
    body: fileAtPreviousDeployment("assets/rendering.js"),
    contentType: "text/javascript; charset=utf-8",
  }));
  // Pin only these cached entry points by intent. Their imports resolve to the
  // fresh shared modules, which is the adjacent Pages deployment boundary this
  // regression exercises.

  await page.goto(`/?database=${database}`);
  await expect(page.locator(".entry-card")).toHaveCount(2);
  await expect(page.locator("#status")).not.toContainText("could not be loaded");

  await page.goto(
    `/entry.html?id=PALOMAR-2026-07-29-000123&version=1&database=${database}`,
  );
  await expect(page.locator(".version-notice")).toHaveCount(1);
  await expect(page.locator("#version-history li")).toHaveCount(2);
  await expect(page.locator("#status")).not.toContainText("could not be loaded");
});

test("current JavaScript preserves represented deep links with cached HTML", async ({ page }) => {
  test.skip(!previousRef, "PALOMAR_PREVIOUS_REF is only set in deployment and pull-request CI");
  await page.route("**/*", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.resourceType() === "document" && url.pathname === "/") {
      return route.fulfill({
        body: fileAtPreviousDeployment("index.html"),
        contentType: "text/html; charset=utf-8",
      });
    }
    return route.continue();
  });

  await page.goto(`/?database=${database}&arxiv=math.NT`);
  await expect(page.locator("#arxiv-query, #arxiv-filter")).toHaveValue("math.NT");
  await expect(page.locator(".entry-card:visible")).toHaveCount(1);
  await expect(page.locator(".entry-card:visible")).toContainText("000124");
  await expect(page.locator("#status")).not.toContainText("could not be loaded");
});

test("classification codes are spaced, and their descriptions are hovers", async ({ page }) => {
  await page.goto(`/entry.html?id=PALOMAR-2026-07-29-000123&database=${database}`);
  const section = page.locator(".entry-classification");
  await expect(section).toBeVisible();

  // Codes ran together as "math.COcs.DM" when they were appended with nothing
  // between them, and the row had no styling because the class had been
  // renamed away from the one that was styled.
  const gaps = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll(".entry-classification .category-list").forEach((list) => {
      const links = [...list.querySelectorAll(".category-link")];
      for (let i = 1; i < links.length; i += 1) {
        const a = links[i - 1].getBoundingClientRect();
        const b = links[i].getBoundingClientRect();
        if (Math.abs(a.top - b.top) < 2) out.push(b.left - a.right);
      }
    });
    return out;
  });
  expect(gaps.length).toBeGreaterThan(0);
  for (const gap of gaps) expect(gap).toBeGreaterThan(4);

  // The description is a hover, not a second column: the codes are a compact
  // row and the descriptions are long enough to swamp them.
  const msc = section.locator(".category-link", { hasText: "05C10" });
  await expect(msc).toHaveAttribute("title", /^05C10 — .+/);
  const visible = await page.evaluate(() => {
    const section = document.querySelector(".entry-classification");
    return [...section.querySelectorAll("*")]
      .filter((node) => !node.classList.contains("visually-hidden"))
      .filter((node) => node.children.length === 0)
      .map((node) => node.textContent)
      .join(" ");
  });
  expect(visible).not.toContain("Planar graphs");
});

test("a card's classifications are muted links, glossed on hover", async ({ page }) => {
  await page.goto(`/?database=${database}`);
  const card = page.locator(".entry-card", { hasText: "PALOMAR-2026-07-29-000123" });
  const arxiv = card.locator(".category-token", { hasText: "math.CO" });
  const msc = card.locator(".category-token", { hasText: "MSC 05C10" });

  // The whole registry under that code, not the two hundred rows this page
  // happens to hold. Both taxonomies are glossed, so a row is not half live.
  await expect(arxiv).toHaveAttribute("href", /subject\.html\?kind=arxiv&code=math\.CO/);
  await expect(msc).toHaveAttribute("href", /subject\.html\?kind=msc&code=05C10/);
  await expect(arxiv).toHaveAttribute("title", "math.CO — Combinatorics");
  await expect(msc).toHaveAttribute("title", /^05C10 — Planar graphs/);
  // The description is a hover, not a second line: a card has no room for it
  // beside the code. It is still in the accessibility tree as text, because a
  // title attribute alone reaches nobody who is not holding a mouse.
  const visible = await card.evaluate((node) =>
    [...node.querySelectorAll("*")]
      .filter((child) => !child.classList.contains("visually-hidden"))
      .filter((child) => child.children.length === 0)
      .map((child) => child.textContent)
      .join(" "));
  expect(visible).not.toContain("Combinatorics");
  await expect(card.locator(".visually-hidden", { hasText: "Combinatorics" })).toHaveCount(1);

  // Muted, and it says it is a link only when you are on it. The link colour
  // would make the smallest thing on a card the loudest thing on it, so a code
  // is the colour of the metadata around it and not the colour of a link.
  const meta = await card.locator(".card-meta").evaluate((node) =>
    getComputedStyle(node).color);
  const link = await card.locator(".repo-link").evaluate((node) =>
    getComputedStyle(node).color);
  await expect(arxiv).toHaveCSS("color", meta);
  expect(meta).not.toBe(link);
  await expect(arxiv).toHaveCSS("text-decoration-line", "none");
  await arxiv.hover();
  await expect(arxiv).toHaveCSS("text-decoration-line", "underline");
  await expect(arxiv).toHaveCSS("text-decoration-style", "dotted");
  // And by keyboard too, which a hover-only affordance would never reach.
  await arxiv.focus();
  await expect(arxiv).toHaveCSS("text-decoration-line", "underline");
});

test("a subject page lists every current version under one code, newest first", async ({ page }) => {
  await page.goto(`/subject.html?kind=arxiv&code=math.AG&database=${database}`);

  await expect(page.locator(".subject-heading h1")).toHaveText("math.AG");
  await expect(page.locator(".subject-gloss")).toHaveText("Algebraic Geometry");
  await expect(page.locator(".subject-counts")).toContainText("60 results, 60 current versions");
  await expect(page).toHaveTitle("math.AG — Palomar");

  // The front page is the newest fifty and says so by carrying exactly that
  // many; the rest is the archive behind it.
  const rows = page.locator(".subject-row");
  await expect(rows).toHaveCount(50);
  await expect(rows.first()).toContainText("PALOMAR-2026-06-03-000020");
  await expect(rows.first().locator("h2 a")).toHaveAttribute(
    "href",
    /entry\.html\?id=PALOMAR-2026-06-03-000020&version=1/,
  );
  await expect(rows.last()).toContainText("PALOMAR-2026-06-01-000011");

  // One click walks back through the days it has already shown without
  // repeating a row, and the button goes when the count is met.
  const more = page.locator("#subject-more");
  await expect(more).toBeVisible();
  await more.click();
  await expect(rows).toHaveCount(60);
  await expect(rows.last()).toContainText("PALOMAR-2026-06-01-000001");
  await expect(more).toBeHidden();
  await expect(page.locator("#subject-more-status")).toBeHidden();
});

test("a code with nothing current under it answers, and one never used does not", async ({ page }) => {
  // Seeded and empty. PalomarDatabase keeps a page for every code the registry
  // has ever used, so a code whose last classifier was superseded is an empty
  // answer rather than a URL that started to 404 under a reader.
  await page.route(/\/database\/subjects\/msc\/05C10\.json$/, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      schema_version: 1,
      kind: "msc",
      code: "05C10",
      entries: [],
      results: 0,
      versions: 0,
      year_path: "subjects/msc/05C10/{year}.json",
      years: [],
    }),
  }));
  await page.goto(`/subject.html?kind=msc&code=05C10&database=${database}`);
  await expect(page.locator(".subject-heading h1")).toHaveText("05C10");
  await expect(page.locator(".subject-row")).toHaveCount(0);
  await expect(page.locator("#subject-content")).toContainText("No current version is classified");
  await expect(page.locator("#subject-more")).toBeHidden();

  await page.goto(`/subject.html?kind=msc&code=99Z99&database=${database}`);
  await expect(page.locator("#status")).toHaveText(
    "No result has ever been classified 99Z99.",
  );
  await expect(page.locator("#subject-content")).toBeHidden();

  await page.goto(`/subject.html?kind=feeds&code=math.CO&database=${database}`);
  await expect(page.locator("#status")).toContainText("missing or invalid classification scheme");
});

test("an entry shows the decision and the comments, never the scores", async ({ page }) => {
  await page.goto(`/entry.html?id=PALOMAR-2026-07-29-000123&database=${database}`);
  const editorial = page.locator(".entry-editorial");
  await expect(editorial).toBeVisible();

  // The scores decide acceptance and stay beside the database. Not shown, and
  // as of the record-is-the-committed-file change, not served at all:
  // the same repository at the same commit scored 5 and then 4 on the same
  // axis across two runs, and a number that moves like that reads as a
  // judgement it cannot support.
  await expect(editorial).not.toContainText("/5");
  for (const axis of ["statement alignment", "definition fidelity", "notability", "literature"]) {
    await expect(editorial).not.toContainText(axis);
  }
  await expect(page.locator(".score-grid")).toHaveCount(0);

  // What is shown is the decision, and the comments under one heading.
  await expect(editorial.locator(".decision")).toBeVisible();
  const commentary = editorial.locator("h3", { hasText: "AI review comments" });
  const none = editorial.locator(".no-warnings");
  expect(await commentary.count() + await none.count()).toBeGreaterThan(0);
  await expect(editorial).not.toContainText("Permanent warnings");
});

test("what was checked is compressed without losing what it said", async ({ page }) => {
  await page.goto(`/entry.html?id=PALOMAR-2026-07-29-000123&database=${database}`);
  const evidence = page.locator(".entry-evidence");
  await expect(evidence).toBeVisible();

  // Both kinds of assurance are named, and the names stand out from the prose.
  await expect(evidence.locator("strong", { hasText: "Mechanical assurance" })).toBeVisible();
  await expect(evidence.locator("strong", { hasText: "Editorial assurance" })).toBeVisible();

  const labels = await evidence.locator(".details .detail-row dt").allTextContents();

  // One date, to the minute. Acceptance and Lean verification were always the
  // same day, so the second row said nothing the first did not.
  expect(labels).toContain("Verified and accepted");
  expect(labels).not.toContain("Acceptance date");
  expect(labels).not.toContain("Lean verification date");
  await expect(evidence).toContainText("UTC");

  // A digest belongs with its file, not in a row two lines below it.
  expect(labels).not.toContain("Challenge SHA-256");
  expect(labels).not.toContain("Solution SHA-256");
  expect(labels).not.toContain("Licence file SHA-256");
  const notes = evidence.locator(".detail-note");
  expect(await notes.count()).toBeGreaterThan(0);
  await expect(notes.first()).toHaveAttribute("title", /^[0-9a-f]{64}$/);

  // One licence row, not four.
  expect(labels).toContain("Repository licence");
  expect(labels).not.toContain("Declared repository licence");
  expect(labels).not.toContain("Detected SPDX licence");

  // And the project directory only when the project is somewhere.
  const project = labels.filter((label) => label === "Project directory");
  const rootOnly = await evidence.locator(".detail-row", { hasText: "Repository root" }).count();
  expect(rootOnly).toBe(0);
  expect(project.length).toBeLessThanOrEqual(1);
});

test("a search reads one postings sequence per word and confirms every hit", async ({ page }) => {
  const asked = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/database/")) asked.push(path);
  });
  await page.goto(`/?database=${database}`);
  await expect(page.locator(".entry-card")).toHaveCount(2);

  asked.length = 0;
  await runSearch(page, "quasicoherent 000124");

  await expect(page.locator("#search-results .entry-card")).toHaveCount(1);
  await expect(page.locator("#search-results .entry-card")).toContainText("000124");
  // A posting names an immutable version, but does not claim that it is
  // current or say how many active versions the result has. Search cards omit
  // both claims until the public search contract publishes them.
  await expect(page.locator("#search-results .entry-id")).not.toContainText("current");
  await expect(page.locator("#search-results .version-history-link")).toHaveCount(0);
  // The listing is a different question, and answering both at once would show
  // one reader two sets of results with nothing saying which was which.
  await expect(page.locator("#entry-grid")).toBeHidden();
  // Two words, two heads, and the pages of each; the rarer word drives, and
  // the pages are walked newest first.
  expect(asked).toContain("/database/search/t/quasicoherent/head.json");
  expect(asked.filter((path) => path.startsWith("/database/search/t/000124/")))
    .toEqual(["/database/search/t/000124/head.json", "/database/search/t/000124/0.json"]);
  expect(asked.filter((path) => /quasicoherent\/[0-9]/.test(path)))
    .toEqual([
      "/database/search/t/quasicoherent/1.json",
      "/database/search/t/quasicoherent/0.json",
    ]);
  // One record, because the intersection settled the rest. The record is
  // fetched to be shown, and checking that it really carries every word costs
  // nothing on top of that.
  expect(asked.filter((path) => path.startsWith("/database/entries/")))
    .toEqual(["/database/entries/PALOMAR-2026-07-29-000124-v1.json"]);
});

test("runtime data reads reuse a fresh HTTP response", async ({ page }) => {
  const headUrl = "http://127.0.0.1:4173/database/search/t/cacheprobe/head.json";
  const timings = () => page.evaluate((url) =>
    performance.getEntriesByName(url).map((entry) => ({
      decodedBodySize: entry.decodedBodySize,
      transferSize: entry.transferSize,
    })), headUrl);

  await page.goto(`/?database=${database}`);
  await page.evaluate(() => performance.clearResourceTimings());
  await runSearch(page, "cacheprobe");
  await expect(page.locator("#search-results .entry-card")).toHaveCount(1);
  await expect.poll(async () => (await timings()).length).toBe(1);

  // The fixture gives this otherwise ordinary postings document max-age=60.
  // Submitting the same search still calls fetch, but the browser should
  // satisfy it from its HTTP cache rather than transferring it again.
  await page.locator("#query").press("Enter");
  await expect.poll(async () => (await timings()).length).toBe(2);
  const [network, cached] = await timings();
  expect(network.transferSize).toBeGreaterThan(0);
  expect(network.decodedBodySize).toBeGreaterThan(0);
  expect(cached.transferSize).toBe(0);
  expect(cached.decodedBodySize).toBe(network.decodedBodySize);
});

test("an over-limit term count is an accessible warning and can be corrected", async ({ page }) => {
  const query = Array.from(
    { length: SEARCH_TERM_LIMIT + 1 },
    (_unused, index) => `word${String(index).padStart(2, "0")}`,
  ).join(" ");
  const asked = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/database/")) asked.push(path);
  });

  await page.goto(`/?database=${database}&q=${encodeURIComponent(query)}`);
  await expect(page.locator("#query")).toHaveValue(query);
  await expect(page.locator("#search-status")).toHaveText(
    `Use at most ${SEARCH_TERM_LIMIT} distinct normalized words; ` +
      `this search has ${SEARCH_TERM_LIMIT + 1}. Common words count toward this limit.`,
  );
  await expect(page.locator("#search-status")).toHaveClass(/warning/);
  await expect(page.locator("#search-status")).not.toHaveClass(/error/);
  await expect(page.locator("#query")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#query")).toHaveAttribute("aria-describedby", "search-status");
  await page.waitForTimeout(100);
  expect(asked.filter((path) => path.includes("/database/search/"))).toEqual([]);
  expect(asked.filter((path) => path === "/database/recent.json")).toEqual([]);
  await expect(page.locator("#entry-grid")).toBeHidden();

  await page.goto(`/?database=${database}`);
  await expect(page.locator("#entry-grid .entry-card")).toHaveCount(2);
  asked.length = 0;
  await runSearch(page, query);
  await expect(page.locator("#query")).toHaveValue(query);
  await expect(page.locator("#search-status")).toHaveText(
    `Use at most ${SEARCH_TERM_LIMIT} distinct normalized words; ` +
      `this search has ${SEARCH_TERM_LIMIT + 1}. Common words count toward this limit.`,
  );
  await page.waitForTimeout(100);
  expect(asked.filter((path) => path.includes("/database/search/"))).toEqual([]);

  await runSearch(page, "synthetically");
  await expect(page.locator("#search-results .entry-card")).toHaveCount(1);
  await expect(page.locator("#query")).not.toHaveAttribute("aria-invalid");
  await expect(page.locator("#query")).not.toHaveAttribute("aria-describedby");

  await runSearch(page, "");
  await expect(page.locator("#entry-grid")).toBeVisible();
  await expect(page.locator("#search-status")).toBeHidden();
});

test("huge few-distinct linked and typed queries fail before I/O or history", async ({ page }) => {
  const query = "echo ".repeat(Math.ceil((SEARCH_QUERY_CHARACTER_LIMIT + 1) / 5));
  const asked = [];
  const pageErrors = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/database/")) asked.push(path);
  });
  page.on("pageerror", (error) => pageErrors.push(error));

  await page.goto(`/?database=${database}&q=${encodeURIComponent(query)}`);
  await expect(page.locator("#search-status")).toContainText(
    `Shorten the search to at most ${SEARCH_QUERY_CHARACTER_LIMIT} characters`,
  );
  await expect(page.locator("#query")).toHaveAttribute(
    "maxlength",
    String(SEARCH_QUERY_CHARACTER_LIMIT),
  );
  await expect(page.locator("#query")).toHaveAttribute("aria-invalid", "true");
  await page.waitForTimeout(100);
  expect(asked.filter((path) => path.startsWith("/database/search/"))).toEqual([]);
  expect(asked.filter((path) => path === "/database/recent.json")).toEqual([]);
  expect(pageErrors).toEqual([]);

  await page.goto(`/?database=${database}`);
  await expect(page.locator("#entry-grid .entry-card")).toHaveCount(2);
  const before = page.url();
  asked.length = 0;
  await page.locator("#query").evaluate((input, value) => { input.value = value; }, query);
  await page.locator("#registry-search").evaluate((form) => {
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
  });
  await expect(page.locator("#search-status")).toContainText(
    `Shorten the search to at most ${SEARCH_QUERY_CHARACTER_LIMIT} characters`,
  );
  await page.waitForTimeout(100);
  expect(page.url()).toBe(before);
  expect(asked.filter((path) => path.startsWith("/database/search/"))).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("search cards retain posting order when posting pages finish out of order", async ({ page }) => {
  await page.route("**/database/search/t/quasicoherent/*.json", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/1.json")) await new Promise((resolve) => setTimeout(resolve, 100));
    if (path.endsWith("/0.json")) await new Promise((resolve) => setTimeout(resolve, 5));
    await route.continue();
  });

  await page.goto(`/?database=${database}&q=quasicoherent`);

  await expect(page.locator("#search-results .entry-card")).toHaveCount(2);
  await expect(page.locator("#search-results .entry-id")).toHaveText([
    "PALOMAR-2026-07-29-000124 v1",
    "PALOMAR-2026-07-29-000123 v2",
  ]);
});

test("a failed posting page leaves validated search cards and reports degradation", async ({ page }) => {
  await page.route("**/database/search/t/quasicoherent/1.json", (route) =>
    route.fulfill({ status: 503, body: "temporarily unavailable" }),
  );

  await page.goto(`/?database=${database}&q=quasicoherent`);

  await expect(page.locator("#search-results .entry-card")).toHaveCount(1);
  await expect(page.locator("#search-results .entry-id")).toHaveText([
    "PALOMAR-2026-07-29-000123 v2",
  ]);
  await expect(page.locator("#search-status")).toContainText(
    "Showing 1 verified result. The search is incomplete because 1 data request failed.",
  );
  await expect(page.locator("#search-status")).toHaveClass(/warning/);
});

test("search availability decorates the existing focused card in place", async ({ page }) => {
  let releaseAvailability;
  let noteAvailabilityRequest;
  const availabilityRequested = new Promise((resolve) => { noteAvailabilityRequest = resolve; });
  await page.route("**/database/source-availability-missing.json", async (route) => {
    noteAvailabilityRequest();
    await new Promise((resolve) => { releaseAvailability = resolve; });
    await route.continue();
  });

  await page.goto(
    `/?database=${database}&availability=${missingAvailability}&q=synthetically`,
  );
  const card = page.locator("#search-results .entry-card");
  await expect(card).toHaveCount(1);
  await availabilityRequested;
  await card.evaluate((node) => { node.dataset.progressiveFixture = "same-card"; });
  await card.locator(".repo-link").focus();
  await expect(card.locator(".repo-link")).toHaveText("example/challenge");

  releaseAvailability();
  await expect(card.locator(".repo-link")).toHaveText("Palomar preserved copy");
  await expect(card.locator(".source-status.missing")).toHaveText("Original unavailable");
  await expect(card).toHaveAttribute("data-progressive-fixture", "same-card");
  await expect(card.locator(".repo-link")).toBeFocused();
});

test("search cards do not publish a stale source-unavailable claim", async ({ page }) => {
  await page.route("**/database/source-availability-missing.json", async (route) => {
    const response = await route.fetch();
    const availability = await response.json();
    const now = new Date();
    now.setMilliseconds(0);
    availability.generated_at = now.toISOString().replace(".000Z", "Z");
    const stale = new Date(now.getTime() - 18 * 60 * 60 * 1000 - 1_000)
      .toISOString().replace(".000Z", "Z");
    for (const row of availability.repositories) row.original.checked_at = stale;
    await route.fulfill({ response, json: availability });
  });

  await page.goto(
    `/?database=${database}&availability=${missingAvailability}&q=synthetically`,
  );
  const card = page.locator("#search-results .entry-card");
  await expect(card.locator(".repo-link")).toHaveText("example/challenge");
  await expect(card.locator(".source-status.missing")).toHaveCount(0);
  await expect(card.locator(".archive-link")).toBeVisible();
});

test("transient and invalid availability responses are both retried", async ({ page }) => {
  let availabilityRequests = 0;
  let releaseFirst;
  let noteFirstRequest;
  const firstRequest = new Promise((resolve) => { noteFirstRequest = resolve; });
  const firstFailureLogged = page.waitForEvent("console", {
    predicate: (message) => message.text().includes("Source availability is unavailable"),
  });
  await page.route("**/database/source-availability-missing.json", async (route) => {
    availabilityRequests += 1;
    if (availabilityRequests === 1) {
      noteFirstRequest();
      await new Promise((resolve) => { releaseFirst = resolve; });
      await route.fulfill({ status: 503, body: "temporarily unavailable" });
      return;
    }
    if (availabilityRequests === 2) {
      await route.fulfill({ status: 200, json: { schema_version: 1 } });
      return;
    }
    await route.continue();
  });

  await page.goto(
    `/?database=${database}&availability=${missingAvailability}&q=synthetically`,
  );

  const card = page.locator("#search-results .entry-card");
  await expect(card).toHaveCount(1);
  await firstRequest;
  // The decorative manifest is still blocked, but the verified record is not.
  await expect(card.locator(".repo-link")).toHaveText("example/challenge");
  await expect(card.locator(".entry-id")).toHaveText("PALOMAR-2026-07-29-000124 v1");
  releaseFirst();
  await firstFailureLogged;

  const invalidLogged = page.waitForEvent("console", {
    predicate: (message) => message.text().includes("Source availability is unavailable"),
  });
  await page.locator("#query").press("Enter");
  await expect.poll(() => availabilityRequests).toBe(2);
  await invalidLogged;
  await expect(card.locator(".repo-link")).toHaveText("example/challenge");

  await page.locator("#query").press("Enter");
  await expect.poll(() => availabilityRequests).toBe(3);
  await expect(card.locator(".repo-link")).toHaveText("Palomar preserved copy");
  await expect(card.locator(".source-status.missing")).toHaveText("Original unavailable");
  await expect(card.locator(".version-history-link")).toHaveCount(0);
});

test("a missing availability manifest is cached for the page", async ({ page }) => {
  let availabilityRequests = 0;
  await page.route("**/database/no-source-availability.json", async (route) => {
    availabilityRequests += 1;
    await route.fulfill({ status: 404, body: "not published" });
  });
  const absentAvailability = encodeURIComponent(
    "http://127.0.0.1:4173/database/no-source-availability.json",
  );

  await page.goto(
    `/?database=${database}&availability=${absentAvailability}&q=synthetically`,
  );
  await expect(page.locator("#search-results .entry-card")).toHaveCount(1);
  await expect.poll(() => availabilityRequests).toBe(1);
  await page.locator("#query").press("Enter");
  await expect(page.locator("#search-results .entry-card")).toHaveCount(1);
  await page.waitForTimeout(50);
  expect(availabilityRequests).toBe(1);
});

test("a superseded slow search cannot repaint a newer query", async ({ page }) => {
  let slowHeadRequests = 0;
  await page.route("**/database/search/t/quasicoherent/head.json", async (route) => {
    slowHeadRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.continue().catch(() => {});
  });
  await page.goto(`/?database=${database}`);

  await startSearch(page, "quasicoherent");
  await expect.poll(() => slowHeadRequests).toBe(1);
  await runSearch(page, "synthetically");

  await expect(page.locator("#search-results .entry-id")).toHaveText(
    "PALOMAR-2026-07-29-000124 v1",
  );
  await page.waitForTimeout(300);
  await expect(page.locator("#search-results .entry-id")).toHaveText(
    "PALOMAR-2026-07-29-000124 v1",
  );
  await expect(page).toHaveURL(/q=synthetically/);
});

test("a linked search hides landing DOM and retries one failed landing load", async ({ page }) => {
  let recentRequests = 0;
  let releaseFirstRecent;
  let noteFirstRecent;
  const firstRecent = new Promise((resolve) => { noteFirstRecent = resolve; });
  await page.route("**/database/recent.json", async (route) => {
    recentRequests += 1;
    if (recentRequests === 1) {
      noteFirstRecent();
      await new Promise((resolve) => { releaseFirstRecent = resolve; });
      await route.fulfill({ status: 503, body: "temporarily unavailable" });
      return;
    }
    await route.continue();
  });

  await page.goto(`/?database=${database}&q=synthetically`);
  await expect(page.locator("#search-results .entry-card")).toHaveCount(1);
  expect(recentRequests).toBe(0);
  expect(await page.evaluate(() => ({
    grid: document.querySelector("#entry-grid").hidden,
    status: document.querySelector("#status").hidden,
    toolbar: document.querySelector(".toolbar").hidden,
  }))).toEqual({ grid: true, status: true, toolbar: true });
  await expect(page.locator("#entry-grid .entry-card")).toHaveCount(0);

  await runSearch(page, "");
  await firstRecent;
  expect(await page.evaluate(() => ({
    grid: document.querySelector("#entry-grid").hidden,
    status: document.querySelector("#status").hidden,
    toolbar: document.querySelector(".toolbar").hidden,
  }))).toEqual({ grid: false, status: false, toolbar: false });

  // Clearing again while the first landing request is pending shares it.
  await page.locator("#query").press("Enter");
  await page.waitForTimeout(50);
  expect(recentRequests).toBe(1);
  releaseFirstRecent();
  await expect(page.locator("#status")).toContainText("could not be loaded");

  // Once that attempt has settled as failed, clearing retries it.
  await page.locator("#query").press("Enter");
  await expect(page.locator("#entry-grid .entry-card")).toHaveCount(2);
  expect(recentRequests).toBe(2);
});

test("a search runs from a link, and says so when nothing carries the words", async ({ page }) => {
  await page.goto(`/?database=${database}&q=quasicoherent`);
  await expect(page.locator("#search-results .entry-card")).toHaveCount(2);

  await runSearch(page, "quasicoherent unobtainium");
  await expect(page.locator("#search-results .entry-card")).toHaveCount(0);
  // The words with no postings are named rather than guessed about. They are
  // words nothing carries and not words the indexer drops, because the dropped
  // ones left the query before it was asked.
  await expect(page.locator("#search-status")).toContainText("Nothing is indexed under unobtainium");
  await expect(page).toHaveURL(/q=quasicoherent\+unobtainium/);
});

test("a hostile query cannot construct a path outside the postings grammar", async ({ page }) => {
  const asked = [];
  page.on("request", (request) => asked.push(new URL(request.url()).pathname));
  await page.goto(`/?database=${database}`);

  asked.length = 0;
  await runSearch(page, "../../etc/passwd?x=1 <script>");
  await expect(page.locator("#search-status")).toContainText("No result carries all of");

  // The stopword list is at a fixed path and is the only request under
  // `/search/` that the query has no part in building. Every other one is
  // constructed from what somebody typed, with no dictionary to check it
  // against first, which is why the grammar is the whole defence.
  const searched = asked.filter(
    (path) => path.includes("/search/") && path !== "/database/search/stopwords.json",
  );
  expect(searched.length).toBeGreaterThan(0);
  for (const path of searched) {
    expect(path).toMatch(/^\/database\/search\/t\/[a-z0-9]{2,32}\/(?:head|[0-9]{1,4})\.json$/);
  }
});

test("a query with no word in it leaves the listing alone", async ({ page }) => {
  await page.goto(`/?database=${database}`);
  await runSearch(page, "a !");
  await expect(page.locator("#entry-grid")).toBeVisible();
  await expect(page.locator("#search-status")).toBeHidden();
});

test("a word the indexer drops leaves the query instead of failing it", async ({ page }) => {
  // The hole the published list closes. "the" has no head, which from a
  // browser is indistinguishable from a word nothing carries, so a query
  // containing it used to be answered against each record's own text -- and
  // this record's text does not contain "the". Fetching the list is what turns
  // that from a wrong answer nobody could diagnose into no question at all.
  const asked = [];
  page.on("request", (request) => asked.push(new URL(request.url()).pathname));
  await page.goto(`/?database=${database}`);

  asked.length = 0;
  await runSearch(page, "the quasicoherent sheaves");

  await expect(page.locator("#search-results .entry-card")).toHaveCount(1);
  await expect(page.locator("#search-results .entry-card")).toContainText("000124");
  expect(asked).toContain("/database/search/stopwords.json");
  expect(asked.filter((path) => path.startsWith("/database/search/t/the/"))).toEqual([]);
});

test("a search made only of words the indexer drops says which they were", async ({ page }) => {
  // Otherwise this is a registry that appears to hold nothing.
  await page.goto(`/?database=${database}`);
  await runSearch(page, "the of and");

  await expect(page.locator("#search-status")).toContainText("too common to be indexed");
  await expect(page.locator("#search-status")).toContainText("the");
  await expect(page.locator("#search-results .entry-card")).toHaveCount(0);
  await expect(page.locator("#search-spinner")).toBeHidden();
});

/** Hold one head request open, and hand back the way to let it go. */
async function holdSearchHead(page, term) {
  let release;
  let noteRequest;
  const requested = new Promise((resolve) => { noteRequest = resolve; });
  await page.route(`**/database/search/t/${term}/head.json`, async (route) => {
    noteRequest();
    await new Promise((resolve) => { release = resolve; });
    await route.continue().catch(() => {});
  });
  return { requested, release: () => release() };
}

test("typing runs one search at the pause, not one per keystroke", async ({ page }) => {
  const heads = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/head.json")) heads.push(path);
  });
  await page.goto(`/?database=${database}`);
  await expect(page.locator("#entry-grid .entry-card")).toHaveCount(2);

  // There is no button to press, so the pause is the whole of the instruction.
  await page.locator("#query").pressSequentially("quasicoherent", { delay: 10 });
  await expect(page.locator("#search-spinner")).toBeVisible();
  await expect(page.locator("#search-spinner")).toBeHidden();
  await expect(page.locator("#search-results")).not.toHaveClass(/preview/);
  await expect(page.locator("#search-results .entry-card")).toHaveCount(2);

  expect(heads).toEqual(["/database/search/t/quasicoherent/head.json"]);
  await expect(page).toHaveURL(/q=quasicoherent/);
});

test("a keystroke abandons the answer to the query it just replaced", async ({ page }) => {
  // The gap the generation counter alone does not close: it turns over when a
  // search starts, and the next one does not start until the pause. Between
  // the two, an answer to what the reader has already typed past would arrive
  // verified and undimmed under a box that says something else.
  const held = await holdSearchHead(page, "quasicoherent");
  await page.goto(`/?database=${database}`);
  await expect(page.locator("#entry-grid .entry-card")).toHaveCount(2);

  await startSearch(page, "quasicoherent");
  await held.requested;
  await expect(page.locator("#search-results .entry-card")).toHaveCount(2);

  // One real keystroke, and then the old answer is let go immediately -- well
  // inside the pause that would otherwise still be running.
  await page.locator("#query").press("End");
  await page.locator("#query").press("x");
  await expect(page.locator("#query")).toHaveValue("quasicoherentx");
  held.release();
  await page.waitForTimeout(150);

  // Nothing the abandoned query found may be standing here, verified or not.
  // Nothing in hand carries "quasicoherentx" either, so the page is honestly
  // empty rather than showing the two cards the old query had just confirmed.
  await expect(page.locator("#search-results .entry-card")).toHaveCount(0);
  await expect(page.locator("#search-results")).toHaveAttribute("aria-busy", "true");
  await expect(page.locator("#search-spinner")).toBeVisible();
  await expect(page.locator("#search-status")).toContainText("Searching the registry");

  await expect(page.locator("#search-spinner")).toBeHidden();
  await expect(page.locator("#search-status")).toContainText("No result carries all of");
});

test("confirming a result keeps the reader on the card they were standing on", async ({ page }) => {
  // The provisional cards are replaced wholesale, so without this the reader's
  // focus goes with the node that carried it and lands on the document.
  const held = await holdSearchHead(page, "quasicoherent");
  await page.goto(`/?database=${database}`);
  await expect(page.locator("#entry-grid .entry-card")).toHaveCount(2);

  await startSearch(page, "quasicoherent");
  await held.requested;
  const card = (id) => page.locator(`#search-results .entry-card[data-id="${id}"]`);
  await expect(page.locator("#search-results .entry-card").first())
    .toHaveAttribute("data-id", "PALOMAR-2026-07-29-000123");
  await card("PALOMAR-2026-07-29-000123").locator("h3 a").focus();

  held.release();
  await expect(page.locator("#search-spinner")).toBeHidden();
  // Verified results come back in posting order, so this result is no longer
  // the first card. Focus follows the result, not the position.
  await expect(page.locator("#search-results .entry-card").first())
    .toHaveAttribute("data-id", "PALOMAR-2026-07-29-000124");
  await expect(card("PALOMAR-2026-07-29-000123").locator("h3 a")).toBeFocused();
});

test("a pause shows the entries already loaded, marked as not yet the answer", async ({ page }) => {
  const held = await holdSearchHead(page, "quasicoherent");
  await page.goto(`/?database=${database}`);
  await expect(page.locator("#entry-grid .entry-card")).toHaveCount(2);

  await startSearch(page, "quasicoherent");
  await held.requested;
  await expect(page.locator("#search-results")).toHaveClass(/preview/);
  await expect(page.locator("#search-results")).toHaveAttribute("aria-busy", "true");
  await expect(page.locator("#search-results .entry-card")).toHaveCount(2);
  // Set apart by ground, not by fading: these are cards a reader reads and may
  // click, so the text stays at full contrast.
  await expect(page.locator("#search-results .entry-card").first())
    .toHaveCSS("background-color", "rgb(242, 242, 242)");
  await expect(page.locator("#search-results .entry-card").first()).toHaveCSS("opacity", "1");
  await expect(page.locator("#search-status")).toContainText("while the registry search runs");
  await expect(page.locator("#search-status")).toContainText("newest 2 entries");
  await expect(page.locator("#search-spinner")).toBeVisible();
  // A provisional card claims no more than the search card replacing it will.
  await expect(page.locator("#search-results .entry-id").first()).not.toContainText("current");

  held.release();
  await expect(page.locator("#search-spinner")).toBeHidden();
  await expect(page.locator("#search-results")).not.toHaveClass(/preview/);
  await expect(page.locator("#search-results")).not.toHaveAttribute("aria-busy", "true");
  await expect(page.locator("#search-results .entry-card")).toHaveCount(2);
  await expect(page.locator("#search-results .entry-card").first())
    .toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
});

test("nothing loaded to show leaves the wait to the spinner alone", async ({ page }) => {
  const held = await holdSearchHead(page, "synthetically");
  // A linked search never reads the landing selection, so there is nothing in
  // hand to show, and the status must not claim otherwise.
  await page.goto(`/?database=${database}&q=synthetically`);
  await held.requested;
  await expect(page.locator("#search-spinner")).toBeVisible();
  await expect(page.locator("#search-status")).toHaveText("Searching the registry…");
  await expect(page.locator("#search-results .entry-card")).toHaveCount(0);

  held.release();
  await expect(page.locator("#search-results .entry-card")).toHaveCount(1);
  await expect(page.locator("#search-spinner")).toBeHidden();
});

test("a provisional match the index does not confirm is taken away", async ({ page }) => {
  // What the dimming is for. "quasi" sits inside a word the newest entries
  // carry, so it is in hand at once, but the index knows whole words and holds
  // nothing under it. The cards go and the reader is told why.
  await page.goto(`/?database=${database}`);
  await expect(page.locator("#entry-grid .entry-card")).toHaveCount(2);

  await runSearch(page, "quasi");
  await expect(page.locator("#search-status")).toContainText("No result carries all of: quasi");
  await expect(page.locator("#search-results .entry-card")).toHaveCount(0);
  await expect(page.locator("#search-results")).not.toHaveClass(/preview/);
  await expect(page.locator("#search-spinner")).toBeHidden();
});

test("emptying the box gives the listing and its filters back", async ({ page }) => {
  await page.goto(`/?database=${database}`);
  // Set before searching, because a search takes the toolbar off the page.
  await page.locator("#arxiv-query").fill("math.CO");
  await expect(page.locator(".entry-card:visible")).toHaveCount(1);

  await runSearch(page, "quasicoherent");
  await expect(page.locator("#search-results .entry-card")).toHaveCount(2);
  await expect(page.locator("body")).toHaveClass(/registry-searching/);

  await runSearch(page, "");
  await expect(page.locator("body")).not.toHaveClass(/registry-searching/);
  await expect(page.locator(".toolbar")).toBeVisible();
  await expect(page.locator("#search-spinner")).toBeHidden();
  await expect(page.locator("#arxiv-query")).toHaveValue("math.CO");
  await expect(page.locator(".entry-card:visible")).toHaveCount(1);
});

/**
 * Every run of text on the page, measured as a reader's eye receives it.
 *
 * `appearance.test.js` reads the palette and checks the pairs named in it,
 * which cannot see what compositing does: an `opacity` below one fades text
 * and its ground together toward whatever is behind them, and a colour carrying
 * its own alpha does the same, so both leave the declared pair intact and the
 * seen pair failing. This runs in a browser and asks the rendered tree, so it
 * answers for whatever the page actually puts on the screen.
 *
 * Not a replacement for the palette test. That one is fast, runs without a
 * browser, and names the pairs it protects; this one covers what is drawn.
 */
const CONTRAST_AUDIT = `(() => {
  const parse = (value) => {
    const parts = value.match(/[\\d.]+/g);
    if (!parts || value === "transparent") return [0, 0, 0, 0];
    const [r, g, b, a = 1] = parts.map(Number);
    return [r, g, b, a];
  };
  const over = (top, bottom, alpha) =>
    bottom.map((channel, index) => channel + (top[index] - channel) * alpha);
  const channelLuminance = (value) => {
    const scaled = value / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  const luminance = ([r, g, b]) =>
    0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
  const contrast = (a, b) => {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
  };
  // Opacity applies to an element and its whole subtree as one group, so it
  // multiplies down the ancestor chain and reaches the text through it.
  const opacityAt = (node) => {
    let product = 1;
    for (let at = node; at && at.nodeType === 1; at = at.parentElement) {
      product *= Number(getComputedStyle(at).opacity);
    }
    return product;
  };
  // What is behind this text, built from the canvas up: each ancestor's ground
  // laid down in turn, faded by whatever opacity applies to it.
  const groundUnder = (node) => {
    const chain = [];
    for (let at = node; at; at = at.parentElement) chain.unshift(at);
    let ground = [255, 255, 255];
    for (const at of chain) {
      const [r, g, b, alpha] = parse(getComputedStyle(at).backgroundColor);
      const effective = alpha * opacityAt(at);
      if (effective > 0) ground = over([r, g, b], ground, effective);
    }
    return ground;
  };
  const describe = (node) => {
    const id = node.id ? "#" + node.id : "";
    const classes = typeof node.className === "string" && node.className
      ? "." + node.className.trim().split(/\\s+/).join(".")
      : "";
    return node.tagName.toLowerCase() + id + classes;
  };

  const failures = [];
  let read = 0;
  for (const node of document.querySelectorAll("body *")) {
    const owns = [...node.childNodes]
      .some((child) => child.nodeType === 3 && child.textContent.trim());
    if (!owns) continue;
    const style = getComputedStyle(node);
    if (style.visibility === "hidden" || style.display === "none") continue;
    const box = node.getBoundingClientRect();
    // Anything this small is clipped away from sight rather than read: the
    // visually-hidden runs the page gives to assistive technology are 1px.
    if (box.width < 2 || box.height < 2) continue;
    const seen = opacityAt(node);
    if (seen === 0) continue;

    read += 1;
    const ground = groundUnder(node);
    const [r, g, b, alpha] = parse(style.color);
    const ink = over([r, g, b], ground, alpha * seen);
    const size = Number.parseFloat(style.fontSize);
    const weight = Number(style.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const needed = large ? 3 : 4.5;
    const ratio = contrast(ink, ground);
    if (ratio + 0.005 < needed) {
      failures.push(
        describe(node) + " reads " + ratio.toFixed(2) + ":1, needs " + needed +
        " (text " + ink.map(Math.round).join(",") + " on " + ground.map(Math.round).join(",") + ")",
      );
    }
  }
  return { failures, read };
})()`;

async function readableTextOnly(page, where, least) {
  const { failures, read } = await page.evaluate(CONTRAST_AUDIT);
  expect(failures, `${where}: text below WCAG AA once composited`).toEqual([]);
  // A check that has stopped finding text passes for the wrong reason. The
  // floors are well under what each state carries, so they answer "is this
  // still looking at the page" without breaking every time the copy changes.
  expect(read, `${where}: only ${read} runs of text were read`)
    .toBeGreaterThanOrEqual(least);
}

for (const scheme of ["light", "dark"]) {
  test(`${scheme} text stays readable once opacity and grounds are composited`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });

    await page.goto(`/?database=${database}`);
    await expect(page.locator("#entry-grid .entry-card")).toHaveCount(2);
    await readableTextOnly(page, `${scheme} listing`, 40);

    await expect(page.locator("#arxiv-query")).toBeVisible();
    await readableTextOnly(page, `${scheme} listing with the subject filters`, 40);

    // The state this check exists for. The provisional cards are drawn on their
    // own ground, and the first attempt at setting them apart faded them.
    const held = await holdSearchHead(page, "quasicoherent");
    await startSearch(page, "quasicoherent");
    await held.requested;
    await expect(page.locator("#search-results")).toHaveClass(/preview/);
    await readableTextOnly(page, `${scheme} provisional matches`, 25);

    held.release();
    await expect(page.locator("#search-spinner")).toBeHidden();
    await readableTextOnly(page, `${scheme} verified results`, 25);

    await page.goto(
      `/entry.html?id=PALOMAR-2026-07-29-000123&version=2&database=${database}`,
    );
    await expect(page.locator("h1")).toBeVisible();
    await readableTextOnly(page, `${scheme} entry`, 25);
  });
}
test("resting on a landing title raises the result's rendering over the listing", async ({ page }) => {
  const asked = [];
  page.on("request", (request) => asked.push(new URL(request.url()).pathname));
  await page.goto(`/?database=${database}`);
  const title = page.locator(".entry-card h3 > a").first();
  const identifier = await page.locator(".entry-card .entry-id").first().textContent();
  const versioned = /(PALOMAR-[0-9-]+) v([0-9]+)/.exec(identifier);

  // Nothing is read for a listing nobody has rested on.
  expect(asked).not.toContain("/database/recent-renders.json");

  await title.hover();
  const panel = page.locator(".statement-preview");
  await expect(panel).toBeVisible();
  const frame = panel.locator("iframe");
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  await expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
  await expect(frame).toHaveAttribute(
    "src",
    `http://127.0.0.1:4173/database/renders/${versioned[1]}-v${versioned[2]}/${"a".repeat(64)}/Challenge/index.html`,
  );
  expect(asked).toContain("/database/recent-renders.json");
  // The card is a landing row, so this must not have become a record read.
  expect(asked.filter((path) => path.startsWith("/database/entries/"))).toEqual([]);

  // The rendering runs, and is as unprivileged inside the panel as it is on an
  // entry page.
  const body = page.frameLocator(".statement-preview iframe").locator("body");
  await expect(body).toHaveAttribute("data-script-ran", "true");
  await expect(body).toHaveAttribute("data-top-access", "blocked");
  await expect(page.locator("body")).not.toHaveAttribute("data-compromised", "true");

  await page.mouse.move(5, 5);
  await expect(panel).toHaveCount(0);
});

test("a search result previews from the record it already holds", async ({ page }) => {
  await page.goto(`/?database=${database}`);
  // Runs on the typing pause now, and the provisional cards it stands in are
  // drawn like the verified ones, so wait for the spinner rather than counting.
  await runSearch(page, "quasicoherent");
  await expect(page.locator("#search-results .entry-card").first()).toBeVisible();

  const asked = [];
  page.on("request", (request) => asked.push(new URL(request.url()).pathname));
  await page.locator("#search-results .entry-card h3 > a").first().hover();

  await expect(page.locator(".statement-preview iframe")).toHaveAttribute(
    "src",
    /\/Challenge\/index\.html$/,
  );
  expect(asked).not.toContain("/database/recent-renders.json");
});

test("a preview survives the pointer crossing into it", async ({ page }) => {
  await page.goto(`/?database=${database}`);
  await page.locator(".entry-card h3 > a").first().hover();
  const panel = page.locator(".statement-preview");
  await expect(panel).toBeVisible();

  const box = await panel.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(500);

  await expect(panel).toBeVisible();
});

test("an absent or unusable render companion leaves the listing usable", async ({ page }) => {
  for (const body of ["", '{"schema_version":1,"renders":[{"id":"nope"}]}']) {
    await page.route("**/database/recent-renders.json", (route) =>
      body
        ? route.fulfill({ status: 200, contentType: "application/json", body })
        : route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
    await page.goto(`/?database=${database}`);
    const title = page.locator(".entry-card h3 > a").first();
    await title.hover();
    await page.waitForTimeout(600);

    await expect(page.locator(".statement-preview")).toHaveCount(0);
    // The listing is what matters, and it is untouched.
    await expect(page.locator(".entry-card")).not.toHaveCount(0);
    await expect(title).toBeVisible();
  }
});

test("previews are not raised where a pointer cannot rest", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: false });
  const page = await context.newPage();
  await page.emulateMedia({ media: "screen", forcedColors: "none" });
  await page.goto(`/?database=${database}`);
  // The controller asks `(hover: hover)`; a coarse pointer answers no, and the
  // stylesheet refuses to show a panel even if one were somehow raised.
  const hides = await page.evaluate(() =>
    [...document.styleSheets]
      .flatMap((sheet) => [...sheet.cssRules])
      .some((rule) => rule.conditionText === "(hover: none)"
        && [...rule.cssRules].some((inner) => inner.selectorText === ".statement-preview")));
  expect(hides).toBe(true);
  await context.close();
});

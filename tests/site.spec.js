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

test("about headings expose hoverable links that copy their section URL", async ({ context, page }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/about.html");

  const sectionHeading = page.locator("#what-is-palomar h2");
  const sectionAnchor = sectionHeading.getByRole("link", { name: "Copy link to What is Palomar?" });
  await expect(sectionAnchor).toHaveCSS("opacity", "0");
  await sectionAnchor.focus();
  await expect(sectionAnchor).toHaveCSS("opacity", "1");
  await page.locator("body").click({ position: { x: 0, y: 0 } });
  await expect(sectionAnchor).toHaveCSS("opacity", "0");
  await sectionHeading.hover();
  await expect(sectionAnchor).toHaveCSS("opacity", "1");

  await sectionAnchor.click();
  await expect(page).toHaveURL(/about\.html#what-is-palomar$/);
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(
    /about\.html#what-is-palomar$/,
  );
  await expect(page.getByRole("status")).toHaveText("Copied link to What is Palomar?");
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

test("every formalization.yaml mention on the About page links to its standard", async ({ page }) => {
  await page.goto("/about.html");
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
  // the link, and it goes to the entries that share it. The feeds it used to
  // link to were never published, so every one of them was a 404.
  await expect(page.locator(".entry-classification").getByRole("link", { name: "RSS" })).toHaveCount(0);
  const mscLink = page.locator(".entry-classification .category-link", { hasText: "05C10" });
  await expect(mscLink).toHaveAttribute("href", /index\.html\?msc=05C10/);
  await expect(
    page.locator(".entry-classification .category-link", { hasText: "math.CO" }),
  ).toHaveAttribute("href", /index\.html\?arxiv=math\.CO/);
  // And a code nobody can read is glossed with what it means.
  await expect(mscLink).toHaveAttribute("title", /05C10 — .+/);
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
  // worth asserting is where it lands.)
  const before = page.url();
  await page
    .locator(".challenge-links")
    .getByRole("link", { name: "Inspect statement dependencies" })
    .click();
  await expect(page.locator("#statement-dependencies")).toBeInViewport();
  expect(page.url().split("#")[0]).toBe(before.split("#")[0]);
});

test("a thin wrapper says where the mathematics is before anything else", async ({ page }) => {
  await page.goto(`/entry.html?id=PALOMAR-2026-07-29-000123&database=${database}`);
  const rows = page.locator(".entry-provenance .provenance-details .detail-row dt");
  const labels = await rows.allTextContents();
  if (labels.includes("Substantive formalization")) {
    expect(labels[0]).toBe("Substantive formalization");
  }
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
  await page.locator("#search").fill("000123");
  await expect(page.locator(".entry-card:visible")).toHaveCount(1);
  await page.locator("#search").evaluate((input) => input.focus());
  await card.evaluate((node) => { node.dataset.progressiveFixture = "same-card"; });
  // Cards and filters are usable while availability is still pending.
  await expect(card.locator(".repo-link")).toHaveText("example/challenge");
  releaseAvailability();
  await expect(card.locator(".source-status.missing")).toHaveText("Original unavailable");
  await expect(card.locator(".repo-link")).toHaveText("Palomar preserved copy");
  await expect(card).toHaveAttribute("data-progressive-fixture", "same-card");
  await expect(page.locator("#search")).toBeFocused();
  await expect(page.locator("#search")).toHaveValue("000123");
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
  await expect(fullRecord.getByRole("link")).toHaveText(
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
  await expect(evidence.getByRole("link", { name: "LICENSE.md" })).toHaveAttribute(
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

test("entry version parameters use canonical positive-integer spelling", async ({ page }) => {
  await page.goto(
    `/entry.html?id=PALOMAR-2026-07-29-000123&version=2.0&database=${database}`,
  );
  await expect(page.locator("#status")).toContainText("missing or invalid Palomar ID or version");
  await expect(page.locator("#entry-content")).toBeHidden();
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
  await expect(page.getByRole("link", { name: "Archived mechanical report" })).toBeVisible();
  await expect(page.getByText("Verification workflow commit")).toBeVisible();
  await expect(page.getByRole("link", { name: "Archived editorial review" })).toBeVisible();
  await expect(page.getByRole("link", { name: "project/Comparator/Answer.lean" }).first()).toHaveAttribute(
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
  await page.locator(".solution-dependencies summary").click();
  await expect(page.locator(".dependency-list")).toContainText("example/dependency");
  await expect(page.getByRole("link", { name: "shared" })).toHaveAttribute(
    "href",
    `https://github.com/example/challenge/tree/${"1".repeat(40)}/shared`,
  );
  await iframe.hover();
  await page.mouse.wheel(0, 2000);
  await expect.poll(() => rendered.locator("html").evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await expect(rendered.locator("#theorem-end")).toBeInViewport();
});

test("larger Challenge falls back to the dedicated wrapper", async ({ page }) => {
  await page.goto(`/entry.html?id=PALOMAR-2026-07-29-000124&version=1&database=${database}`);
  await expect(page.locator("#statement-dependencies")).toContainText(
    "leanprover-community/mathlib4",
  );
  await expect(page.locator("#statement-dependencies")).toContainText(
    "TauCetiProject/TauCeti",
  );
  await expect(page.locator(".challenge-presentation iframe")).toHaveCount(0);
  await expect(page.locator(".challenge-fallback")).toBeVisible();
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

test("current HTML remains compatible with cached JavaScript from the previous deployment", async ({ page }) => {
  test.skip(!previousRef, "PALOMAR_PREVIOUS_REF is only set in deployment and pull-request CI");
  test.skip(
    entrySchemaAtPreviousDeployment() !== currentEntrySchema,
    "the published entry schema changed, so cached JavaScript cannot read current records",
  );
  // The same reasoning, one level up: a bundle that reads a document the
  // registry no longer serves cannot render whatever else it gets right. The
  // landing page moved off `index.json` and onto `recent.json`, and the
  // published `index.json` is gone, so the deployment before that one is
  // reading something that answers 404.
  //
  // This is a deliberate one-time break, taken pre-launch and worth naming.
  // Assets are versioned, so fresh HTML always fetches fresh JavaScript; what
  // breaks is a tab left open across the deployment, until it is reloaded. The
  // skip clears itself once a deployment carrying this change is the previous
  // one, which is the same way the schema guard above clears.
  test.skip(
    fileAtPreviousDeployment("assets/app.js").includes("index.json"),
    "the previous deployment reads index.json, which is no longer served",
  );
  await page.route("**/assets/app.js", (route) => route.fulfill({
    body: fileAtPreviousDeployment("assets/app.js"),
    contentType: "text/javascript; charset=utf-8",
  }));
  await page.route("**/assets/rendering.js", (route) => route.fulfill({
    body: fileAtPreviousDeployment("assets/rendering.js"),
    contentType: "text/javascript; charset=utf-8",
  }));

  await page.goto(`/?database=${database}`);
  await expect(page.locator(".entry-card")).toHaveCount(2);
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
  await page.locator("#query").fill("quasicoherent 000124");
  await page.getByRole("button", { name: "Search" }).click();

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
  await page.locator("#query").fill("cacheprobe");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.locator("#search-results .entry-card")).toHaveCount(1);
  await expect.poll(async () => (await timings()).length).toBe(1);

  // The fixture gives this otherwise ordinary postings document max-age=60.
  // Submitting the same search still calls fetch, but the browser should
  // satisfy it from its HTTP cache rather than transferring it again.
  await page.getByRole("button", { name: "Search" }).click();
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
  await page.locator("#query").fill(query);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.locator("#query")).toHaveValue(query);
  await expect(page.locator("#search-status")).toHaveText(
    `Use at most ${SEARCH_TERM_LIMIT} distinct normalized words; ` +
      `this search has ${SEARCH_TERM_LIMIT + 1}. Common words count toward this limit.`,
  );
  await page.waitForTimeout(100);
  expect(asked.filter((path) => path.includes("/database/search/"))).toEqual([]);

  await page.locator("#query").fill("synthetically");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.locator("#search-results .entry-card")).toHaveCount(1);
  await expect(page.locator("#query")).not.toHaveAttribute("aria-invalid");
  await expect(page.locator("#query")).not.toHaveAttribute("aria-describedby");

  await page.locator("#query").fill("");
  await page.getByRole("button", { name: "Search" }).click();
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
  await page.getByRole("button", { name: "Search" }).click();
  await expect.poll(() => availabilityRequests).toBe(2);
  await invalidLogged;
  await expect(card.locator(".repo-link")).toHaveText("example/challenge");

  await page.getByRole("button", { name: "Search" }).click();
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
  await page.getByRole("button", { name: "Search" }).click();
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

  await page.locator("#query").fill("quasicoherent");
  await page.getByRole("button", { name: "Search" }).click();
  await expect.poll(() => slowHeadRequests).toBe(1);
  await page.locator("#query").fill("synthetically");
  await page.getByRole("button", { name: "Search" }).click();

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

  await page.locator("#query").fill("");
  await page.getByRole("button", { name: "Search" }).click();
  await firstRecent;
  expect(await page.evaluate(() => ({
    grid: document.querySelector("#entry-grid").hidden,
    status: document.querySelector("#status").hidden,
    toolbar: document.querySelector(".toolbar").hidden,
  }))).toEqual({ grid: false, status: false, toolbar: false });

  // Clearing again while the first landing request is pending shares it.
  await page.getByRole("button", { name: "Search" }).click();
  await page.waitForTimeout(50);
  expect(recentRequests).toBe(1);
  releaseFirstRecent();
  await expect(page.locator("#status")).toContainText("could not be loaded");

  // Once that attempt has settled as failed, clearing retries it.
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.locator("#entry-grid .entry-card")).toHaveCount(2);
  expect(recentRequests).toBe(2);
});

test("a search runs from a link, and says so when nothing carries the words", async ({ page }) => {
  await page.goto(`/?database=${database}&q=quasicoherent`);
  await expect(page.locator("#search-results .entry-card")).toHaveCount(2);

  await page.locator("#query").fill("quasicoherent unobtainium");
  await page.getByRole("button", { name: "Search" }).click();
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
  await page.locator("#query").fill("../../etc/passwd?x=1 <script>");
  await page.getByRole("button", { name: "Search" }).click();
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
  await page.locator("#query").fill("a !");
  await page.getByRole("button", { name: "Search" }).click();
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
  await page.locator("#query").fill("the quasicoherent sheaves");
  await page.getByRole("button", { name: "Search" }).click();

  await expect(page.locator("#search-results .entry-card")).toHaveCount(1);
  await expect(page.locator("#search-results .entry-card")).toContainText("000124");
  expect(asked).toContain("/database/search/stopwords.json");
  expect(asked.filter((path) => path.startsWith("/database/search/t/the/"))).toEqual([]);
});

test("a search made only of words the indexer drops says which they were", async ({ page }) => {
  // Otherwise this is a registry that appears to hold nothing.
  await page.goto(`/?database=${database}`);
  await page.locator("#query").fill("the of and");
  await page.getByRole("button", { name: "Search" }).click();

  await expect(page.locator("#search-status")).toContainText("too common to be indexed");
  await expect(page.locator("#search-status")).toContainText("the");
  await expect(page.locator("#search-results .entry-card")).toHaveCount(0);
});

import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const database = encodeURIComponent("http://127.0.0.1:4173/database/index.json");
const missingAvailability = encodeURIComponent(
  "http://127.0.0.1:4173/database/source-availability-missing.json",
);
const previousRef = process.env.PALOMAR_PREVIOUS_REF;
const currentIndex = readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8");

function fileAtPreviousDeployment(path) {
  return execFileSync("git", ["show", `${previousRef}:${path}`], { encoding: "utf8" });
}

/**
 * Which entry schemas the previous deployment's validator would accept.
 *
 * Cached JavaScript can only be compatible with records it can read. When the
 * published schema changes, cached JavaScript is deliberately incompatible,
 * and asserting otherwise would only be satisfiable by never changing it.
 */
function entrySchemasAtPreviousDeployment() {
  const source = fileAtPreviousDeployment("assets/security.mjs");
  const set = /ENTRY_SCHEMA_VERSIONS = new Set\(\[([0-9,\s]*)\]\)/.exec(source);
  if (set) return new Set(set[1].split(",").map((n) => Number(n.trim())));
  const single = /ENTRY_SCHEMA_VERSION = ([0-9]+)/.exec(source);
  return single ? new Set([Number(single[1])]) : new Set();
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

test("landing cards show the acceptance date and dated identifier", async ({ page }) => {
  await page.route("**/entries/PALOMAR-2026-07-29-000123-v1.json", (route) => route.abort());
  await page.goto(`/?database=${database}`);
  const first = page.locator(".entry-card").first();
  await expect(first.locator(".entry-id")).toContainText("PALOMAR-2026-07-29-");
  await expect(first.locator(".entry-id")).toContainText("v2 · current");
  await expect(first.locator(".entry-date")).toHaveText("Accepted 29 July 2026");
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
  await expect(page.getByRole("button", { name: "Mathlib only" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Additional libraries" })).toBeVisible();
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

test("an entry accepted before source archiving explains the limitation as a warning", async ({ page }) => {
  await page.route("**/entries/PALOMAR-2026-07-29-000123-v1.json", async (route) => {
    const response = await route.fetch();
    const legacy = await response.json();
    legacy.schema_version = 1;
    delete legacy.preservation;
    await route.fulfill({ response, json: legacy });
  });
  await page.goto(
    `/entry.html?id=PALOMAR-2026-07-29-000123&version=1&database=${database}`,
  );

  const notice = page.locator(".source-availability.legacy");
  await expect(notice).toContainText("Palomar has no preservation copy of this source");
  await expect(notice).toContainText("before Palomar began archiving source repositories");
  await expect(notice).toContainText("may stop working if that repository is removed");
  await expect(notice.getByRole("link", { name: "Open the reviewed source" })).toHaveAttribute(
    "href",
    /github\.com\/example\/challenge\/tree\/1{40}\/project$/,
  );
  await expect(notice).toHaveCSS("background-color", "rgb(255, 248, 223)");
  await expect(notice).toHaveCSS("padding-left", "20px");
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
  await expect(evidence).toContainText("Repository licence file");
  await expect(evidence.getByRole("link", { name: "LICENSE.md" })).toHaveAttribute(
    "href",
    `https://github.com/example/challenge/blob/${"1".repeat(40)}/LICENSE.md`,
  );
  await expect(evidence).toContainText("Declared repository licence");
  await expect(evidence).toContainText("Detected SPDX licence");
  await expect(evidence).toContainText("Apache-2.0");
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
  await expect(page.locator(".acceptance-callout")).toContainText("Accepted");
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
    !entrySchemasAtPreviousDeployment().has(currentEntrySchema),
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

test("an entry shows the decision and the comments, never the scores", async ({ page }) => {
  await page.goto(`/entry.html?id=PALOMAR-2026-07-29-000123&database=${database}`);
  const editorial = page.locator(".entry-editorial");
  await expect(editorial).toBeVisible();

  // The scores decide acceptance and stay with the record. They are not shown:
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

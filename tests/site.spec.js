import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const database = encodeURIComponent("http://127.0.0.1:4173/database/index.json");
const previousRef = process.env.PALOMAR_PREVIOUS_REF;
const currentIndex = readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8");

function fileAtPreviousDeployment(path) {
  return execFileSync("git", ["show", `${previousRef}:${path}`], { encoding: "utf8" });
}

test("landing cards show the acceptance date and dated identifier", async ({ page }) => {
  await page.route("**/entries/PALOMAR-2026-07-29-000123-v1.json", (route) => route.abort());
  await page.goto(`/?database=${database}`);
  const first = page.locator(".entry-card").first();
  await expect(first.locator(".entry-id")).toContainText("PALOMAR-2026-07-29-");
  await expect(first.locator(".entry-id")).toContainText("current version 2");
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
  await expect(page.getByRole("button", { name: "Mathlib only" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Additional libraries" })).toBeVisible();
});

test("an unversioned entry link resolves to the current immutable URL", async ({ page }) => {
  await page.goto(
    `/entry.html?id=PALOMAR-2026-07-29-000123&database=${database}#version-history`,
  );

  await expect(page.locator(".entry-heading h1")).toHaveText(
    "Fixture PALOMAR-2026-07-29-000123 version 2",
  );
  await expect(page).toHaveURL(/entry\.html\?id=PALOMAR-2026-07-29-000123&version=2&database=/);
  await expect(page).toHaveURL(/#version-history$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://kim-em.github.io/PalomarWeb/entry.html?id=PALOMAR-2026-07-29-000123&version=2",
  );
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
  await expect(page.locator(".machine-record a")).toHaveText(
    "Open PALOMAR-2026-07-29-000123-v1.json",
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://kim-em.github.io/PalomarWeb/entry.html?id=PALOMAR-2026-07-29-000123&version=1",
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

test("entry version parameters use canonical positive-integer spelling", async ({ page }) => {
  await page.goto(
    `/entry.html?id=PALOMAR-2026-07-29-000123&version=2.0&database=${database}`,
  );
  await expect(page.locator("#status")).toContainText("missing or invalid Palomar ID or version");
  await expect(page.locator("#entry-content")).toBeHidden();
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
  await page.route("http://127.0.0.1:4173/", (route) => route.fulfill({
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
  await expect(source).toHaveAttribute(
    "href",
    `https://github.com/example/challenge/blob/${"1".repeat(40)}/Challenge.lean`,
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
  await expect(page.locator(".acceptance-callout")).toContainText("recorded proof against the recorded statement");
  await expect(page.locator(".acceptance-callout")).toContainText(
    "Every required check passed, so Palomar accepted the submission",
  );
  await expect(page.getByRole("link", { name: "Solution.lean" }).first()).toHaveAttribute(
    "href",
    `https://github.com/example/challenge/blob/${"1".repeat(40)}/Solution.lean`,
  );
  await expect(page.locator(".entry-solution .token-list code")).toHaveText("ExampleDependency");
  await page.locator(".solution-dependencies summary").click();
  await expect(page.locator(".dependency-list")).toContainText("example/dependency");
  await iframe.hover();
  await page.mouse.wheel(0, 2000);
  await expect.poll(() => rendered.locator("html").evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await expect(rendered.locator("#theorem-end")).toBeInViewport();
});

test("larger Challenge falls back to the dedicated wrapper", async ({ page }) => {
  await page.goto(`/entry.html?id=PALOMAR-2026-07-29-000124&version=1&database=${database}`);
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
});

test("current HTML remains compatible with cached JavaScript from the previous deployment", async ({ page }) => {
  test.skip(!previousRef, "PALOMAR_PREVIOUS_REF is only set in deployment and pull-request CI");
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

test("current JavaScript remains compatible with cached HTML from the previous deployment", async ({ page }) => {
  test.skip(!previousRef, "PALOMAR_PREVIOUS_REF is only set in deployment and pull-request CI");
  await page.route("http://127.0.0.1:4173/", (route) => route.fulfill({
    body: fileAtPreviousDeployment("index.html"),
    contentType: "text/html; charset=utf-8",
  }));

  await page.goto(`/?database=${database}`);
  await expect(page.locator(".entry-card")).toHaveCount(2);
  await expect(page.locator("#status")).not.toContainText("could not be loaded");
});

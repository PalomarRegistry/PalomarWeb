import { expect, test } from "@playwright/test";

const database = encodeURIComponent("http://127.0.0.1:4173/database/index.json");

test("landing cards show the acceptance date and dated identifier", async ({ page }) => {
  await page.goto(`/?database=${database}`);
  const first = page.locator(".entry-card").first();
  await expect(first.locator(".entry-id")).toContainText("PALOMAR-2026-07-29-");
  await expect(first.locator(".entry-date")).toHaveText("Accepted 29 July 2026");
  await expect(page.locator(".entry-card")).toHaveCount(2);
});

test("legacy identifiers redirect to the dated permanent identifier", async ({ page }) => {
  await page.goto(`/entry.html?id=PALOMAR-000123&version=1&database=${database}`);
  await expect(page).toHaveURL(/id=PALOMAR-2026-07-29-000123/);
  await expect(page.locator(".entry-heading .entry-id")).toContainText(
    "PALOMAR-2026-07-29-000123",
  );
});

test("eligible Challenge renders inline without origin privilege", async ({ page }) => {
  await page.goto(`/entry.html?id=PALOMAR-2026-07-29-000123&version=1&database=${database}`);

  const source = page.locator(".challenge-presentation .challenge-source");
  await expect(source).toHaveAttribute(
    "href",
    `https://github.com/example/challenge/blob/${"1".repeat(40)}/Challenge.lean`,
  );
  await expect(page.getByRole("link", { name: "Open rendered Challenge" })).toHaveCount(0);
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
  await expect(page.locator(".challenge-metadata")).toContainText("Direct imports");
  await expect(page.locator(".challenge-metadata code")).toHaveText("Mathlib");
  await expect(page.locator(".challenge-module-doc summary")).toHaveText("Module documentation");
  await page.locator(".challenge-module-doc summary").click();
  await expect(page.locator(".challenge-module-doc pre")).toContainText("Parsed outside the Verso surface");
  const rendered = page.frameLocator(".challenge-presentation iframe");
  await expect(rendered.locator(".docstring")).toHaveText("The theorem doc-string.");
  await expect(rendered.locator(".skip-link")).toHaveCount(0);
  await expect(rendered.locator("body")).not.toContainText("Fixture module");
  await expect(iframe).toHaveAttribute("data-height-adjusted", "true");
  const box = await iframe.boundingBox();
  expect(box.height).toBe(672);
  await expect(page.locator(".acceptance-callout")).toContainText("Accepted");
  await expect(page.locator(".acceptance-callout")).toContainText("29 July 2026");
  await expect(page.locator(".acceptance-callout")).toContainText("matched every advertised declaration");
  await expect(page.locator(".acceptance-callout")).toContainText(
    "Every required check passed; Palomar accepted the submission",
  );
  await expect(page.getByRole("link", { name: "Open Solution.lean" }).first()).toHaveAttribute(
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
  await page.getByRole("link", { name: "Open rendered Challenge" }).click();
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

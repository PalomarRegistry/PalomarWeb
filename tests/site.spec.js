import { expect, test } from "@playwright/test";

const database = encodeURIComponent("http://127.0.0.1:4173/database/index.json");

test("eligible Challenge renders inline without origin privilege", async ({ page }) => {
  await page.goto(`/entry.html?id=PALOMAR-000123&version=1&database=${database}`);

  const source = page.locator(".challenge-presentation .challenge-source");
  await expect(source).toHaveAttribute(
    "href",
    `https://github.com/example/challenge/blob/${"1".repeat(40)}/Challenge.lean`,
  );
  const iframe = page.locator(".challenge-presentation iframe");
  await expect(iframe).toHaveAttribute("sandbox", "allow-scripts");
  await expect(iframe).toHaveAttribute("referrerpolicy", "no-referrer");
  await expect(iframe).toHaveAttribute("scrolling", "auto");
  await expect(iframe).toHaveAttribute(
    "src",
    `http://127.0.0.1:4173/database/renders/PALOMAR-000123-v1/${"a".repeat(64)}/Challenge/index.html`,
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
  const box = await iframe.boundingBox();
  expect(box.height).toBeLessThanOrEqual(672);
  await iframe.hover();
  await page.mouse.wheel(0, 2000);
  await expect.poll(() => rendered.locator("html").evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await expect(rendered.locator("#theorem-end")).toBeInViewport();
});

test("larger Challenge falls back to the dedicated wrapper", async ({ page }) => {
  await page.goto(`/entry.html?id=PALOMAR-000124&version=1&database=${database}`);
  await expect(page.locator(".challenge-presentation iframe")).toHaveCount(0);
  await expect(page.locator(".challenge-fallback")).toBeVisible();
  await page.getByRole("link", { name: "Open rendered Challenge" }).click();
  await expect(page).toHaveURL(/render\.html\?id=PALOMAR-000124/);
  await expect(page.locator(".challenge-presentation iframe")).toHaveAttribute(
    "sandbox",
    "allow-scripts",
  );
  await expect(page.locator(".challenge-source")).toHaveAttribute(
    "href",
    `https://github.com/example/challenge/blob/${"1".repeat(40)}/Challenge.lean`,
  );
});

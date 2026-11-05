import { expect, test } from "@playwright/test";

const origin = "http://127.0.0.1:4173/database/";
const home = `/?database=${encodeURIComponent(origin)}`;
async function fixture(page) {
  return (await (await page.request.get(origin + "api/v1/results")).json());
}
async function settled(page) {
  await expect(page.locator("#entry-grid")).toHaveAttribute("aria-busy", "false");
}

test("one bounded results request supplies the listing and previews", async ({ page }) => {
  const reads = [];
  page.on("request", request => { if (request.url().includes("/database/")) reads.push(request.url()); });
  await page.goto(home);
  await settled(page);
  await expect(page.locator(".entry-row")).not.toHaveCount(0);
  expect(reads).toHaveLength(1);
  expect(reads[0]).toContain("/api/v1/results");
  await page.getByRole("button", { name: "Cards", exact: true }).click();
  await expect(page.locator(".entry-card")).not.toHaveCount(0);
  expect(reads).toHaveLength(1);
  await page.locator(".entry-card h3 a").first().hover();
  await expect(page.locator(".statement-preview iframe")).toBeVisible();
  expect(reads.some(url => /recent|availability|\/entries\//.test(url))).toBe(false);
});

test("an August result beyond 200 newer registrations remains reachable", async ({ page }) => {
  const base = await fixture(page);
  const rows = Array.from({ length: 250 }, (_, n) => ({ ...base.entries[0],
    id: `PALOMAR-2026-09-22-${String(n + 1).padStart(6, "0")}`,
    path: `entries/PALOMAR-2026-09-22-${String(n + 1).padStart(6, "0")}-v1.json`,
    version: 1, versions: 1, published_at: "2026-09-22T12:00:00Z",
    preview: { ...base.entries[0].preview, version: 1 }, title: `New result ${n}`,
  }));
  const old = { ...rows[0], id: "PALOMAR-2026-08-27-000005", path: "entries/PALOMAR-2026-08-27-000005-v2.json",
    title: "elliotglazer/nf-not-wpp", version: 2, versions: 2, published_at: "2026-08-27T12:00:00Z",
    authors: [{ name: "Elliot Glazer" }], preview: { ...rows[0].preview, version: 2 },
  };
  rows.push(old);
  await page.route("**/database/api/v1/results?*", answer);
  await page.route("**/database/api/v1/results", answer);
  async function answer(route) {
    const p = new URL(route.request().url()).searchParams;
    const filtered = rows.filter(row => (!p.get("to") || row.published_at.slice(0, 10) <= p.get("to")) &&
      (!p.get("q") || `${row.title} ${row.authors[0].name}`.toLowerCase().includes(p.get("q").toLowerCase())));
    const offset = p.has("cursor") ? Number(Buffer.from(p.get("cursor"), "base64").toString()) : 0;
    await route.fulfill({ json: { ...base, totals: { results: rows.length, projects: 1 }, entries: filtered.slice(offset, offset + 25),
      previous: offset ? Buffer.from(String(offset - 25)).toString("base64") : null,
      next: offset + 25 < filtered.length ? Buffer.from(String(offset + 25)).toString("base64") : null,
    } });
  }
  await page.goto(home);
  await settled(page);
  await expect(page.locator("#metric-results")).toHaveText("251");
  for (let i = 0; i < 10; i++) {
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await settled(page);
  }
  await expect(page.locator(".entry-row")).toHaveCount(1);
  await expect(page.locator(".entry-row")).toContainText("nf-not-wpp");
  await page.locator("#date-to").fill("2026-08-31");
  await expect(page).not.toHaveURL(/cursor=/);
  await settled(page);
  await expect(page.locator(".entry-row")).toHaveCount(1);
  await page.locator("#query").fill("Elliot Glazer");
  await page.locator("#query").press("Enter");
  await settled(page);
  await expect(page.locator(".toolbar")).toBeVisible();
  await expect(page.locator(".entry-row")).toContainText("nf-not-wpp");
});

test("query errors retain visibly stale content and refresh preserves filters", async ({ page }) => {
  const base = await fixture(page);
  let fail = false;
  await page.route("**/database/api/v1/results**", route => fail
    ? route.fulfill({ status: 409, json: { error: "registry_changed", message: "The registry changed. Refresh these results to continue." } })
    : route.fulfill({ json: base }));
  await page.goto(home + "&msc=05");
  await settled(page);
  const count = await page.locator(".entry-row").count();
  fail = true;
  await page.locator("#query").fill("group");
  await page.locator("#query").press("Enter");
  await expect(page.locator("#status")).toContainText("Previously loaded results");
  await expect(page.locator(".entry-row")).toHaveCount(count);
  fail = false;
  await page.getByRole("button", { name: "Refresh results", exact: true }).click();
  await settled(page);
  await expect(page.locator("#msc-query")).toHaveValue("05");
  await expect(page.locator("#query")).toHaveValue("group");
  await page.goBack();
  await settled(page);
  await expect(page.locator("#query")).toHaveValue("");
});

test("malformed and oversized responses fail the page without dropping rows behind a cursor", async ({ page }) => {
  const base = await fixture(page);
  await page.route("**/database/api/v1/results**", route => route.fulfill({ json: { ...base, entries: [...base.entries, base.entries[0]] } }));
  await page.goto(home);
  await expect(page.locator("#status")).toContainText("duplicate");
  await expect(page.locator("#registry-next")).toBeDisabled();
  await page.unroute("**/database/api/v1/results**");
  await page.route("**/database/api/v1/results**", route => route.fulfill({ body: "x".repeat(512 * 1024 + 1) }));
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator("#status")).toContainText("byte limit");
});

test("typing invalidates a slow response and keeps combined filters on clear", async ({ page }) => {
  const base = await fixture(page);
  let release;
  const held = new Promise(resolve => { release = resolve; });
  await page.route("**/database/api/v1/results**", async route => {
    if (new URL(route.request().url()).searchParams.get("q") === "older") {
      await held;
      await route.fulfill({ json: { ...base, entries: [] } }).catch(() => {});
    } else await route.fulfill({ json: base });
  });
  await page.goto(home + "&msc=05");
  await settled(page);
  await page.locator("#query").fill("older");
  await page.locator("#query").press("Enter");
  await page.locator("#query").fill("newer");
  await page.locator("#query").press("Enter");
  await settled(page);
  release();
  await expect(page.locator(".entry-row")).toHaveCount(base.entries.length);
  await page.locator("#query").fill("");
  await page.locator("#query").press("Enter");
  await settled(page);
  await expect(page.locator("#msc-query")).toHaveValue("05");
  await expect(page).toHaveURL(/msc=05/);
  await expect(page).not.toHaveURL(/[?&]q=/);
});

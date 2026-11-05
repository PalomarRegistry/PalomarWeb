import assert from "node:assert/strict";
import test from "node:test";
import { validateQueryPage } from "../assets/security.mjs";
import { createRegistryLoader } from "../assets/registry-loading.mjs";
import { recentRow, DIGEST } from "./registry-fixture.mjs";

function page() {
  const row = recentRow();
  return { schema_version: 1, revision: 1, release: "a".repeat(64),
    totals: { results: 1, projects: 1 }, previous: null, next: null,
    entries: [{ ...row, abbreviated: false, source_omitted: false,
      preview: { version: row.version, artifact_tree_sha256: DIGEST } }], dropped: [], message: null };
}

test("query validation accepts bounded abbreviated summaries and rejects a whole corrupt page", () => {
  const valid = page();
  assert.equal(validateQueryPage(valid), valid);
  const abbreviated = page();
  Object.assign(abbreviated.entries[0], { abbreviated: true, source_omitted: true, source: null, preservation: null });
  assert.equal(validateQueryPage(abbreviated), abbreviated);
  for (const mutate of [
    value => { value.entries.push(value.entries[0]); },
    value => { value.entries[0].abstract = "é".repeat(9000); },
    value => { value.entries[0].preview.version = value.entries[0].version + 1; },
    value => { value.next = "x".repeat(1025); },
    value => { value.entries[0].source.repository = "../../escape"; },
    value => { value.entries = Array(26).fill(value.entries[0]); },
  ]) {
    const malformed = page();
    mutate(malformed);
    assert.throws(() => validateQueryPage(malformed));
  }
});

test("query transport cancels oversized streams and propagates cursor errors", async () => {
  let cancelled = false;
  const loader = createRegistryLoader({
    location: { href: "https://palomar-registry.org/", search: "" },
    fetch: async () => new Response(new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(128 * 1024)); },
      cancel() { cancelled = true; },
    })),
  });
  await assert.rejects(loader.loadResults(new URLSearchParams()), /byte limit/);
  assert.equal(cancelled, true);
  const changed = createRegistryLoader({
    location: { href: "https://palomar-registry.org/", search: "" },
    fetch: async () => Response.json({ error: "registry_changed", message: "Refresh results" }, { status: 409 }),
  });
  await assert.rejects(changed.loadResults(new URLSearchParams()), error => error.status === 409 && error.code === "registry_changed");
});

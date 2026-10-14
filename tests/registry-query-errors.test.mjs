import assert from "node:assert/strict";
import test from "node:test";
import { createRegistryLoader } from "../assets/registry-loading.mjs";

for (const payload of [null, 0, "temporarily unavailable", []]) {
  test(`registry errors retain HTTP status for ${JSON.stringify(payload)}`, async () => {
    const loader = createRegistryLoader({
      location: { href: "https://palomar-registry.org/", search: "" },
      fetch: async () => new Response(JSON.stringify(payload), { status: 503 }),
    });
    await assert.rejects(loader.loadResults(new URLSearchParams()), error => {
      assert.equal(error.status, 503);
      assert.equal(error.message, "Registry is temporarily unavailable");
      assert.equal(error.code, undefined);
      return true;
    });
  });
}

test("registry-changed errors retain their retry code and bounded message", async () => {
  const loader = createRegistryLoader({
    location: { href: "https://palomar-registry.org/", search: "" },
    fetch: async () => new Response(JSON.stringify({ error: "registry_changed", message: "x".repeat(600) }), { status: 409 }),
  });
  await assert.rejects(loader.loadResults(new URLSearchParams()), error => {
    assert.equal(error.status, 409);
    assert.equal(error.code, "registry_changed");
    assert.equal(error.message.length, 512);
    return true;
  });
});

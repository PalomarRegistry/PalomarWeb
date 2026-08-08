import assert from "node:assert/strict";
import test from "node:test";

import { loadSettledBounded } from "../assets/loading.mjs";

test("bounded loads settle independently and retain input order", async () => {
  let active = 0;
  let maximumActive = 0;
  const results = await loadSettledBounded(
    [30, 5, 15, 1],
    async (delay) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, delay));
      active -= 1;
      if (delay === 15) throw new Error("malformed record");
      return delay;
    },
    { concurrency: 2, timeoutMs: 500 },
  );

  assert.equal(maximumActive, 2);
  assert.deepEqual(
    results.map((result) => result.status),
    ["fulfilled", "fulfilled", "rejected", "fulfilled"],
  );
  assert.deepEqual(
    results.filter((result) => result.status === "fulfilled").map((result) => result.value),
    [30, 5, 1],
  );
  assert.match(results[2].reason.message, /malformed record/);
});

test("one shared deadline aborts hung requests and bounds queued work", async () => {
  const started = [];
  const before = Date.now();
  const results = await loadSettledBounded(
    [0, 1, 2, 3],
    (item, signal) => new Promise((resolve, reject) => {
      started.push(item);
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
    { concurrency: 2, timeoutMs: 30 },
  );

  assert.ok(Date.now() - before < 500, "the loader exceeded its shared deadline");
  assert.deepEqual(started, [0, 1]);
  assert.deepEqual(results.map((result) => result.status), Array(4).fill("rejected"));
  for (const result of results) assert.match(result.reason.message, /deadline of 30ms expired/);
});

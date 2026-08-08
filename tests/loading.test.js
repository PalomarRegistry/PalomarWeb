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

test("the deadline settles a load that ignores its abort signal", async () => {
  const before = Date.now();
  const results = await loadSettledBounded(
    ["never"],
    () => new Promise(() => {}),
    { concurrency: 1, timeoutMs: 30 },
  );

  assert.ok(Date.now() - before < 500, "an abort-ignoring load hung the loader");
  assert.equal(results[0].status, "rejected");
  assert.match(results[0].reason.message, /deadline of 30ms expired/);
});

test("a parent deadline is shared across a sequence of bounded loads", async () => {
  const controller = new AbortController();
  const reason = new Error("overall search deadline expired");
  const timer = setTimeout(() => controller.abort(reason), 30);
  const before = Date.now();
  try {
    const first = await loadSettledBounded(
      ["quick"],
      async (value) => value,
      { concurrency: 1, timeoutMs: 500, signal: controller.signal },
    );
    assert.equal(first[0].status, "fulfilled");

    const second = await loadSettledBounded(
      ["hung", "queued"],
      () => new Promise(() => {}),
      { concurrency: 1, timeoutMs: 500, signal: controller.signal },
    );
    assert.ok(Date.now() - before < 500, "the parent deadline did not bound both stages");
    assert.deepEqual(second.map((result) => result.status), ["rejected", "rejected"]);
    assert.equal(second[0].reason, reason);
    assert.equal(second[1].reason, reason);
  } finally {
    clearTimeout(timer);
  }
});

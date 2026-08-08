/**
 * Run independent loads without allowing either their concurrency or their
 * total wait to grow with the number of items.
 *
 * Results occupy their input positions, like Promise.allSettled. Each load
 * receives a signal that aborts at the shared deadline. A shared deadline is
 * important here: giving every queued request a fresh timeout would let a
 * page of unavailable records wait for `items / concurrency` timeouts.
 */
export async function loadSettledBounded(
  items,
  load,
  { concurrency, timeoutMs },
) {
  if (!Array.isArray(items)) throw new TypeError("items must be an array");
  if (typeof load !== "function") throw new TypeError("load must be a function");
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new RangeError("concurrency must be a positive integer");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("timeoutMs must be positive");
  }

  const results = new Array(items.length);
  const controller = new AbortController();
  const deadlineError = new Error(`load deadline of ${timeoutMs}ms expired`);
  const timer = setTimeout(() => controller.abort(deadlineError), timeoutMs);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const position = next;
      next += 1;
      if (controller.signal.aborted) {
        results[position] = {
          status: "rejected",
          reason: controller.signal.reason,
        };
        continue;
      }

      try {
        results[position] = {
          status: "fulfilled",
          value: await load(items[position], controller.signal),
        };
      } catch (reason) {
        results[position] = { status: "rejected", reason };
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  try {
    await Promise.all(workers);
  } finally {
    clearTimeout(timer);
  }
  return results;
}

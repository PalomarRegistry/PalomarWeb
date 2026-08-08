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
  { concurrency, timeoutMs, signal = null },
) {
  if (!Array.isArray(items)) throw new TypeError("items must be an array");
  if (typeof load !== "function") throw new TypeError("load must be a function");
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new RangeError("concurrency must be a positive integer");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("timeoutMs must be positive");
  }
  if (signal !== null && !(signal instanceof AbortSignal)) {
    throw new TypeError("signal must be an AbortSignal");
  }

  const results = new Array(items.length);
  const controller = new AbortController();
  const deadlineError = new Error(`load deadline of ${timeoutMs}ms expired`);
  const timer = setTimeout(() => controller.abort(deadlineError), timeoutMs);
  const abortFromParent = () => controller.abort(signal.reason);
  if (signal?.aborted) abortFromParent();
  else signal?.addEventListener("abort", abortFromParent, { once: true });
  let next = 0;

  /**
   * Settle when the load settles or the one shared deadline expires.
   *
   * The load is not trusted to observe its signal. The abort listener is the
   * loader's own enforcement, and is removed as soon as a load settles so a
   * long but healthy page does not accumulate listeners. Both load outcomes
   * are handled even after the deadline wins, preventing late rejections from
   * becoming unhandled.
   */
  function beforeDeadline(loadPromise) {
    return new Promise((resolve, reject) => {
      if (controller.signal.aborted) {
        reject(controller.signal.reason);
        return;
      }
      const onAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", onAbort, { once: true });
      loadPromise.then(
        (value) => {
          controller.signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (reason) => {
          controller.signal.removeEventListener("abort", onAbort);
          reject(reason);
        },
      );
    });
  }

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
        const loadPromise = Promise.resolve().then(
          () => load(items[position], controller.signal),
        );
        results[position] = {
          status: "fulfilled",
          value: await beforeDeadline(loadPromise),
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
    signal?.removeEventListener("abort", abortFromParent);
  }
  return results;
}

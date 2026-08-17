import assert from "node:assert/strict";
import test from "node:test";

import {
  challengePlaygroundUrl,
  createChallengePresentation,
  validateChallengeMetadata,
} from "../assets/challenge-presentation.mjs";
import { createSourceAvailabilityBinding } from "../assets/source-preservation.mjs";
import { validateAvailability, validateEntry } from "../assets/security.mjs";
import {
  availabilityEndpoint,
  availabilityManifest,
  availabilityRow,
  entry,
  summary,
} from "./registry-fixture.mjs";

function acceptedEntry() {
  return validateEntry(entry(), summary());
}

function renderMetadata(overrides = {}) {
  return {
    schema_version: 2,
    declarations: ["Example.theorem"],
    imports: ["Mathlib"],
    solution_imports: [],
    module_doc: "A module note.",
    ...overrides,
  };
}

test("playground URL loads the immutable source through Lean Web", () => {
  const record = acceptedEntry();
  assert.equal(
    challengePlaygroundUrl(record).href,
    `https://live.lean-lang.org/#url=https%3A%2F%2Fraw.githubusercontent.com%2Fexample%2Fchallenge%2F${record.source.commit}%2FChallenge.lean`,
  );
  record.formalization.challenge_path = "project/Comparator/Task.lean";
  assert.equal(
    challengePlaygroundUrl(record, "PalomarArchive/example--challenge--fixture").href,
    `https://live.lean-lang.org/#url=https%3A%2F%2Fraw.githubusercontent.com%2FPalomarArchive%2Fexample--challenge--fixture%2F${record.source.commit}%2Fproject%2FComparator%2FTask.lean`,
  );
});

function fakeBrowser(href = "http://127.0.0.1:4173/entry.html") {
  const listeners = new Map();
  function createElement(tag) {
    return {
      attributes: new Map(),
      children: [],
      className: "",
      contentWindow: tag === "iframe" ? {} : undefined,
      dataset: {},
      href: "",
      style: {},
      tagName: tag.toUpperCase(),
      textContent: "",
      append(...children) {
        this.children.push(...children);
      },
      setAttribute(name, value) {
        this.attributes.set(name, String(value));
      },
      getAttribute(name) {
        return this.attributes.get(name) ?? null;
      },
    };
  }
  return {
    document: { createElement },
    listeners,
    window: {
      location: { href },
      addEventListener(name, listener) {
        const registered = listeners.get(name) || [];
        registered.push(listener);
        listeners.set(name, registered);
      },
    },
  };
}

function descendants(root) {
  const found = [];
  const visit = (value) => {
    if (!value || typeof value !== "object" || !Array.isArray(value.children)) return;
    found.push(value);
    value.children.forEach(visit);
  };
  visit(root);
  return found;
}

function byClass(root, className) {
  return descendants(root).filter((node) =>
    String(node.className).split(" ").includes(className));
}

test("render metadata must correspond exactly to the accepted entry", async (t) => {
  const record = acceptedEntry();
  const current = renderMetadata();
  assert.equal(validateChallengeMetadata(record, current), current);
  const versionOne = renderMetadata({ schema_version: 1 });
  delete versionOne.solution_imports;
  assert.equal(validateChallengeMetadata(record, versionOne), versionOne);

  for (const [name, mutate, message] of [
    ["boolean schema", (value) => { value.schema_version = true; }, /does not match/],
    ["future schema", (value) => { value.schema_version = 3; }, /does not match/],
    ["different declaration", (value) => { value.declarations = ["Other.theorem"]; }, /does not match/],
    ["different import", (value) => { value.imports = ["Batteries"]; }, /does not match/],
    ["oversized module note", (value) => { value.module_doc = "x".repeat(256 * 1024 + 1); }, /does not match/],
    ["missing Solution imports", (value) => { delete value.solution_imports; }, /invalid Solution imports/],
    ["non-string Solution import", (value) => { value.solution_imports = [true]; }, /invalid Solution imports/],
  ]) {
    await t.test(name, () => {
      const malformed = renderMetadata();
      mutate(malformed);
      assert.throws(() => validateChallengeMetadata(record, malformed), message);
    });
  }
});

test("an inline presentation keeps links confined and accepts height only from its frame", async () => {
  const browser = fakeBrowser();
  const record = acceptedEntry();
  const metadata = renderMetadata({ module_doc: null });
  let fetched = null;
  const present = createChallengePresentation({
    ...browser,
    fetchJson: async (url) => {
      fetched = url;
      return metadata;
    },
    localPageUrl: () => assert.fail("the inline entry view should not build another page URL"),
  });

  const result = await present(
    record,
    new URL("http://127.0.0.1:4173/database/"),
    { dependenciesOnThisPage: true },
  );

  assert.equal(
    fetched.href,
    `http://127.0.0.1:4173/database/${record.challenge_render.artifact_path}challenge-metadata.json`,
  );
  assert.equal(result.metadata, metadata);
  assert.equal(byClass(result.section, "challenge-metadata").length, 1);
  assert.equal(byClass(result.section, "challenge-no-module-doc").length, 1);
  assert.equal(byClass(result.section, "challenge-fallback").length, 0);
  const [frame] = byClass(result.section, "challenge-frame");
  const [shell] = byClass(result.section, "challenge-frame-shell");
  assert.ok(frame);
  assert.deepEqual(shell.children, [frame, byClass(result.section, "challenge-playground")[0]]);
  assert.equal(frame.getAttribute("sandbox"), "allow-scripts");
  assert.equal(frame.getAttribute("scrolling"), "auto");
  assert.equal(frame.referrerPolicy, "no-referrer");
  assert.equal(
    frame.src,
    `http://127.0.0.1:4173/database/${record.challenge_render.artifact_path}Challenge/index.html`,
  );
  const [source] = byClass(result.section, "challenge-source");
  assert.equal(
    source.href,
    `https://github.com/example/challenge/blob/${record.source.commit}/Challenge.lean`,
  );
  const [playground] = byClass(result.section, "challenge-playground");
  assert.equal(byClass(result.section, "challenge-playground-button").length, 1);
  assert.equal(byClass(byClass(result.section, "challenge-links")[0], "challenge-playground").length, 0);
  assert.equal(playground.textContent, "Lean ↗");
  assert.equal(playground.getAttribute("aria-label"), "Open in Lean Playground");
  assert.equal(playground.getAttribute("title"), "Open in Lean Playground");
  assert.equal(playground.getAttribute("target"), "_blank");
  assert.equal(playground.getAttribute("rel"), "noopener");
  assert.equal(
    playground.href,
    `https://live.lean-lang.org/#url=https%3A%2F%2Fraw.githubusercontent.com%2Fexample%2Fchallenge%2F${record.source.commit}%2FChallenge.lean`,
  );

  const [onMessage] = browser.listeners.get("message");
  onMessage({ source: {}, data: { type: "palomar-render-height", height: 500 } });
  assert.equal(frame.style.height, undefined);
  const contentWindow = frame.contentWindow;
  frame.contentWindow = null;
  onMessage({ source: null, data: { type: "palomar-render-height", height: 500 } });
  assert.equal(frame.style.height, undefined);
  frame.contentWindow = contentWindow;
  onMessage({ source: frame.contentWindow, data: { type: "palomar-render-height", height: 100 } });
  assert.equal(frame.style.height, "160px");
  assert.equal(frame.dataset.heightAdjusted, "true");
  onMessage({ source: frame.contentWindow, data: { type: "palomar-render-height", height: 1_000 } });
  assert.equal(frame.style.height, "672px");
});

test("late availability updates statement source controls in place", async () => {
  const browser = fakeBrowser();
  const record = acceptedEntry();
  let releaseAvailability;
  const sourceAvailability = createSourceAvailabilityBinding(new Promise((resolve) => {
    releaseAvailability = resolve;
  }));
  const present = createChallengePresentation({
    ...browser,
    fetchJson: async () => renderMetadata(),
    localPageUrl: () => assert.fail("the inline entry view should not build another page URL"),
  });

  const result = await present(
    record,
    new URL("http://127.0.0.1:4173/database/"),
    { dependenciesOnThisPage: true, sourceAvailability },
  );
  const [source] = byClass(result.section, "challenge-source");
  const [comparator] = byClass(result.section, "comparator-source");
  const [playground] = byClass(result.section, "challenge-playground");
  assert.match(source.href, /github\.com\/example\/challenge\/blob\//);
  assert.match(comparator.href, /github\.com\/example\/challenge\/blob\//);
  assert.match(playground.href, /raw\.githubusercontent\.com%2Fexample%2Fchallenge%2F/);

  const checkedAt = new Date(Math.floor(Date.now() / 1_000) * 1_000)
    .toISOString()
    .replace(".000Z", "Z");
  const missing = availabilityEndpoint({ status: "missing", checked_at: checkedAt });
  releaseAvailability(validateAvailability(availabilityManifest([
    availabilityRow({ original: missing }),
  ], { generated_at: checkedAt })));
  await sourceAvailability.ready;

  assert.match(source.href, /github\.com\/PalomarArchive\/example--challenge--fixture\/blob\//);
  assert.match(
    comparator.href,
    /github\.com\/PalomarArchive\/example--challenge--fixture\/blob\//,
  );
  assert.match(
    playground.href,
    /raw\.githubusercontent\.com%2FPalomarArchive%2Fexample--challenge--fixture%2F/,
  );
});

test("qualified entries do not offer the Mathlib playground", async () => {
  const browser = fakeBrowser();
  const record = acceptedEntry();
  record.trust.level = "qualified";
  const present = createChallengePresentation({
    ...browser,
    fetchJson: async () => renderMetadata(),
    localPageUrl: () => new URL("http://127.0.0.1:4173/entry.html"),
  });

  const result = await present(record, new URL("http://127.0.0.1:4173/database/"));

  assert.equal(byClass(result.section, "challenge-playground").length, 0);
});

test("a missing large entry render keeps its source controls and uses the missing-artifact fallback", async () => {
  const browser = fakeBrowser();
  const record = acceptedEntry();
  record.trust.challenge_lines = 101;
  const pageCalls = [];
  const missing = new Error("404 Not Found");
  missing.status = 404;
  const present = createChallengePresentation({
    ...browser,
    fetchJson: async () => { throw missing; },
    localPageUrl: (page, selected) => {
      pageCalls.push([page, selected]);
      return new URL(`http://127.0.0.1:4173/${page}?id=${selected.id}&version=${selected.version}`);
    },
  });

  const result = await present(record, new URL("http://127.0.0.1:4173/database/"));

  assert.equal(result.metadata, null);
  assert.equal(byClass(result.section, "challenge-frame").length, 0);
  assert.equal(byClass(result.section, "challenge-metadata").length, 0);
  const [fallback] = byClass(result.section, "challenge-fallback");
  assert.match(fallback.textContent, /formatted statement is not available/);
  assert.deepEqual(pageCalls.map(([page]) => page), ["entry.html", "render.html"]);
  assert.ok(byClass(result.section, "challenge-source")[0].href.startsWith("https://github.com/"));
  const [playground] = byClass(result.section, "challenge-playground");
  assert.equal(playground.textContent, "Open in Lean Playground");
  assert.equal(byClass(result.section, "challenge-playground-button").length, 0);
  assert.equal(byClass(byClass(result.section, "challenge-links")[0], "challenge-playground").length, 1);
});

test("transport and correspondence failures remain fatal to the containing route", async (t) => {
  const record = acceptedEntry();
  for (const [name, failure] of [
    ["transport", Object.assign(new Error("503 Unavailable"), { status: 503 })],
    ["correspondence", renderMetadata({ declarations: ["Other.theorem"] })],
  ]) {
    await t.test(name, async () => {
      const browser = fakeBrowser();
      const present = createChallengePresentation({
        ...browser,
        fetchJson: async () => {
          if (failure instanceof Error) throw failure;
          return failure;
        },
        localPageUrl: () => new URL("http://127.0.0.1:4173/entry.html"),
      });
      await assert.rejects(
        present(record, new URL("http://127.0.0.1:4173/database/")),
        failure instanceof Error ? /503 Unavailable/ : /does not match/,
      );
    });
  }
});

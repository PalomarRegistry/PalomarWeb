import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { init, parse } from "es-module-lexer";

import {
  buildSite,
  shippedFiles,
  versionBrowserImports,
} from "../scripts/build-site.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

test("deployment build versions coupled browser assets", async () => {
  const output = `.site-test-${process.pid}`;
  const destination = path.join(root, output);
  try {
    await buildSite({ output, version: "0123456789abcdef" });
    const index = await readFile(path.join(destination, "index.html"), "utf8");
    const about = await readFile(path.join(destination, "about.html"), "utf8");
    const app = await readFile(path.join(destination, "assets", "app.js"), "utf8");
    const challengePresentation = await readFile(
      path.join(destination, "assets", "challenge-presentation.mjs"),
      "utf8",
    );
    const entryHistoryPresentation = await readFile(
      path.join(destination, "assets", "entry-history-presentation.mjs"),
      "utf8",
    );
    const formalizationPresentation = await readFile(
      path.join(destination, "assets", "formalization-presentation.mjs"),
      "utf8",
    );
    await readFile(path.join(destination, "assets", "entry-pages.mjs"), "utf8");
    const preservation = await readFile(
      path.join(destination, "assets", "source-preservation.mjs"),
      "utf8",
    );
    const rendering = await readFile(
      path.join(destination, "assets", "rendering.js"),
      "utf8",
    );
    const registryLoading = await readFile(
      path.join(destination, "assets", "registry-loading.mjs"),
      "utf8",
    );
    const searching = await readFile(
      path.join(destination, "assets", "searching.mjs"),
      "utf8",
    );
    assert.match(index, /assets\/style\.css\?v=0123456789abcdef/);
    assert.match(index, /assets\/app\.js\?v=0123456789abcdef/);
    assert.match(about, /assets\/style\.css\?v=0123456789abcdef/);
    assert.match(about, /assets\/about\.js\?v=0123456789abcdef/);
    await readFile(path.join(destination, "assets", "about.js"), "utf8");
    assert.match(app, /\.\/challenge-presentation\.mjs\?v=0123456789abcdef/);
    assert.match(app, /\.\/entry-history-presentation\.mjs\?v=0123456789abcdef/);
    assert.match(app, /\.\/entry-pages\.mjs\?v=0123456789abcdef/);
    assert.match(app, /\.\/formalization-presentation\.mjs\?v=0123456789abcdef/);
    assert.match(app, /\.\/security\.mjs\?v=0123456789abcdef/);
    assert.match(app, /\.\/registry-loading\.mjs\?v=0123456789abcdef/);
    assert.match(app, /\.\/searching\.mjs\?v=0123456789abcdef/);
    assert.match(app, /\.\/source-preservation\.mjs\?v=0123456789abcdef/);
    assert.match(preservation, /\.\/security\.mjs\?v=0123456789abcdef/);
    assert.match(rendering, /\.\/security\.mjs\?v=0123456789abcdef/);
    assert.match(registryLoading, /\.\/loading\.mjs\?v=0123456789abcdef/);
    assert.match(registryLoading, /\.\/security\.mjs\?v=0123456789abcdef/);
    assert.match(challengePresentation, /\.\/rendering\.js\?v=0123456789abcdef/);
    assert.match(challengePresentation, /\.\/security\.mjs\?v=0123456789abcdef/);
    assert.match(entryHistoryPresentation, /\.\/security\.mjs\?v=0123456789abcdef/);
    assert.match(
      challengePresentation,
      /\.\/source-preservation\.mjs\?v=0123456789abcdef/,
    );
    assert.match(formalizationPresentation, /\.\/security\.mjs\?v=0123456789abcdef/);
    assert.match(
      formalizationPresentation,
      /\.\/source-preservation\.mjs\?v=0123456789abcdef/,
    );
    assert.match(searching, /\.\/loading\.mjs\?v=0123456789abcdef/);
    assert.match(searching, /\.\/security\.mjs\?v=0123456789abcdef/);
    await readFile(path.join(destination, "assets", "loading.mjs"), "utf8");
    await readFile(path.join(destination, "assets", "security.mjs"), "utf8");

    await init;
    const browserModules = shippedFiles.filter(
      (file) => file.startsWith("assets/") && /\.(?:js|mjs)$/.test(file),
    );
    const browserModulePaths = new Set(browserModules.map((file) => `/${file}`));
    const intentionalExternalImports = new Set();
    for (const file of browserModules) {
      const source = await readFile(path.join(destination, file), "utf8");
      for (const imported of parse(source, file)[0]) {
        if (typeof imported.n === "string") {
          const resolved = new URL(
            imported.n,
            new URL(`/${file}`, "https://browser.invalid/"),
          );
          if (resolved.origin !== "https://browser.invalid" ||
              !browserModulePaths.has(resolved.pathname)) {
            assert.ok(
              intentionalExternalImports.has(imported.n),
              `${file} has an undeclared external or package import: ${imported.n}`,
            );
            continue;
          }
          assert.equal(
            resolved.searchParams.get("v"),
            "0123456789abcdef",
            `${file} retains an unversioned shipped-module import: ${imported.n}`,
          );
        }
      }
    }
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
});

test("module versioning changes imports rather than lookalike strings or packages", async () => {
  const source = [
    'import helpers from "./security.mjs";',
    'import rootHelpers from "/assets/rendering.js";',
    'import parentHelpers from "../assets/searching.mjs";',
    'const description = \'from "./loading.mjs";\';',
    'import packageValue from "package-name";',
    'const lazy = import("./loading.mjs");',
  ].join("\n");
  const versioned = await versionBrowserImports(source, "app.js", "release-1");

  assert.match(versioned, /from "\.\/security\.mjs\?v=release-1"/);
  assert.match(versioned, /from "\/assets\/rendering\.js\?v=release-1"/);
  assert.match(versioned, /from "\.\.\/assets\/searching\.mjs\?v=release-1"/);
  assert.match(versioned, /import\("\.\/loading\.mjs\?v=release-1"\)/);
  assert.match(versioned, /const description = 'from "\.\/loading\.mjs";'/);
  assert.match(versioned, /from "package-name"/);
  await assert.rejects(
    versionBrowserImports('import "/assets/not-shipped.mjs";', "app.js", "release-1"),
    /not-shipped\.mjs resolves to \/assets\/not-shipped\.mjs/,
  );
});

test("published-health metadata import does not resolve npm dependencies", () => {
  const build = new URL("../scripts/build-site.mjs?dependency-free-health-test", import.meta.url);
  const program = [
    'import { registerHooks } from "node:module";',
    'registerHooks({ resolve(specifier, context, nextResolve) {',
    '  if (!specifier.startsWith("node:") && !specifier.startsWith("file:") &&',
    '      !specifier.startsWith(".") && !specifier.startsWith("/")) {',
    '    throw new Error(`unexpected package resolution: ${specifier}`);',
    '  }',
    '  return nextResolve(specifier, context);',
    '} });',
    `const module = await import(${JSON.stringify(build.href)});`,
    'if (!module.shippedFiles.includes("assets/app.js")) process.exitCode = 2;',
  ].join("\n");
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", program],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(child.status, 0, child.stderr || child.stdout);
});

test("deployment build refuses to remove a directory outside the repository", async () => {
  await assert.rejects(
    buildSite({ output: "../outside", version: "test" }),
    /output must be \.site or a \.site-test-/,
  );
  await assert.rejects(
    buildSite({ output: ".git", version: "test" }),
    /output must be \.site or a \.site-test-/,
  );
});

test("the MSC descriptions shown to readers are readable", async () => {
  // Vendored from PalomarSubmission, which validates against it. A '?' inside
  // a description is a character that did not survive an encoding step, not
  // punctuation: the first record in the registry is classified 52C10, whose
  // description names Erdős.
  const codes = JSON.parse(
    await readFile(new URL("../assets/data/msc2020-codes.json", import.meta.url), "utf8"),
  );
  const broken = Object.entries(codes).filter(([, text]) => text.includes("?"));
  assert.deepEqual(broken, []);
  assert.equal(codes["52C10"], "Erdős problems and related topics of discrete geometry");
});

test("the app graph writes down no data origin the database override cannot redirect", async () => {
  // `?database=` names the endpoint every read surface is resolved against, so
  // a fixture directory can stand in for the live service. A data URL spelled
  // out in a consumer module is outside that arrangement by construction.
  // `FEED_BASE` and the `categoryFeedBase()` that read it were the last of
  // those: they outlived the category feed links, which were removed when
  // every one of them answered 404, and went on naming a `feeds/` directory
  // that nothing fetched and no reader could reach. The canonical web origin
  // is a different thing and stays in the history presenter, because an
  // entry's canonical link has to point at the official URL even when the page
  // is being read from a fixture.
  const entryHistory = await readFile(
    new URL("../assets/entry-history-presentation.mjs", import.meta.url),
    "utf8",
  );
  // security.mjs owns the canonical DEFAULT_* endpoints that the loopback
  // override selects away from. Every consumer must resolve against that
  // selected endpoint rather than spelling out the production data origin.
  for (const file of shippedFiles.filter((name) => /^assets\/.*\.m?js$/.test(name))) {
    if (file === "assets/security.mjs") continue;
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.equal(
      source.includes("data.palomar-registry.org"),
      false,
      `${file} names the data origin directly instead of resolving against the chosen endpoint`,
    );
  }
  assert.match(
    entryHistory,
    /const CANONICAL_WEB_BASE = "https:\/\/palomar-registry\.org\/";/,
  );
});

test("everything the pages fetch at runtime is actually shipped", async () => {
  // The MSC table was added under assets/data/ and never added to the build's
  // copy list, so it was absent from the deployed site while the hover that
  // needs it failed silently by design. Anything the site fetches from its own
  // origin has to be in the artifact.
  const output = ".site-test-shipped";
  await buildSite({ output, version: "test" });
  try {
    const app = await readFile(path.join(output, "assets", "app.js"), "utf8");
    const referenced = [...app.matchAll(/new URL\("(assets\/[^"]+)"/g)].map((m) => m[1]);
    assert.ok(referenced.length, "no same-origin asset URLs were found in app.js");
    for (const asset of new Set(referenced)) {
      await readFile(path.join(output, asset));
    }
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

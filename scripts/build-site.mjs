import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
export const htmlFiles = ["404.html", "about.html", "entry.html", "index.html", "render.html"];
const publicFiles = [...htmlFiles, "site.webmanifest", "favicon.svg"];
const browserModuleFiles = [
  "about.js",
  "app.js",
  "entry-pages.mjs",
  "loading.mjs",
  "rendering.js",
  "searching.mjs",
  "security.mjs",
  "source-preservation.mjs",
];
const browserModulePaths = new Set(browserModuleFiles.map((file) => `/assets/${file}`));
const assetFiles = [
  ...browserModuleFiles,
  "style.css",
];
// Copied verbatim into assets/, keeping their subdirectory. Listed separately
// because they are data rather than code: no version query, no rewriting.
const assetDataFiles = ["data/msc2020-codes.json"];
/**
 * Every file the deployment carries, as paths from the repository root.
 *
 * Exported because "what is shipped" is a question something other than the
 * build asks: `check-published.mjs` reads these to find the registry documents
 * the site sends readers to, and a file absent from this list is absent from
 * the deployment however correct its markup is.
 */
export const shippedFiles = [
  ...publicFiles,
  ...assetFiles.map((name) => `assets/${name}`),
  ...assetDataFiles.map((name) => `assets/${name}`),
];

function options(args) {
  const result = {
    output: ".site",
    version: process.env.PALOMAR_ASSET_VERSION || "",
  };
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (name === "--output" || name === "--version") {
      if (!args[index + 1]) throw new Error(`${name} requires a value`);
      result[name.slice(2)] = args[index + 1];
      index += 1;
    } else {
      throw new Error(`unknown argument: ${name}`);
    }
  }
  return result;
}

let browserModuleParser = null;

async function parseBrowserModule(source, filename) {
  browserModuleParser ||= import("es-module-lexer").then(async ({ init, parse }) => {
    await init;
    return parse;
  });
  return (await browserModuleParser)(source, filename)[0];
}

/** Add the deployment version to every relative edge in the shipped module graph. */
export async function versionBrowserImports(source, filename, version) {
  const imports = await parseBrowserModule(source, filename);
  const replacements = [];
  for (const imported of imports) {
    const specifier = imported.n;
    if (typeof specifier !== "string") {
      continue;
    }
    const pathLike = specifier.startsWith("./") || specifier.startsWith("../") ||
      specifier.startsWith("/");
    if (!pathLike) continue;
    const resolved = new URL(
      specifier,
      new URL(`/assets/${filename}`, "https://browser.invalid/"),
    );
    // Absolute and protocol-relative URLs are external dependencies, not
    // deployment assets. Bare package imports are likewise left to the browser.
    if (resolved.origin !== "https://browser.invalid") continue;
    if (resolved.search || resolved.hash) {
      throw new Error(`${filename} has an already-qualified local import: ${specifier}`);
    }
    if (!browserModulePaths.has(resolved.pathname)) {
      throw new Error(
        `${filename} imports a local browser module that is not shipped: ` +
          `${specifier} resolves to ${resolved.pathname}`,
      );
    }
    const versioned = `${specifier}?v=${version}`;
    replacements.push({
      start: imported.s,
      end: imported.e,
      value: imported.d === -1 ? versioned : JSON.stringify(versioned),
    });
  }

  let output = source;
  for (const replacement of replacements.reverse()) {
    output = output.slice(0, replacement.start) + replacement.value +
      output.slice(replacement.end);
  }
  return output;
}

export async function buildSite({ output, version }) {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(version)) {
    throw new Error("asset version must contain only letters, digits, dots, underscores, or hyphens");
  }

  const destination = path.resolve(root, output);
  const relative = path.relative(root, destination);
  if (!(relative === ".site" || /^\.site-test-[A-Za-z0-9._-]+$/.test(relative))) {
    throw new Error("output must be .site or a .site-test-* directory");
  }

  await rm(destination, { recursive: true, force: true });
  await mkdir(path.join(destination, "assets"), { recursive: true });

  for (const file of publicFiles) {
    await copyFile(path.join(root, file), path.join(destination, file));
  }
  for (const file of assetFiles) {
    await copyFile(path.join(root, "assets", file), path.join(destination, "assets", file));
  }
  for (const file of assetDataFiles) {
    const target = path.join(destination, "assets", file);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(root, "assets", file), target);
  }

  for (const file of htmlFiles) {
    const target = path.join(destination, file);
    const source = await readFile(target, "utf8");
    const versioned = source
      .replaceAll('href="assets/style.css"', `href="assets/style.css?v=${version}"`)
      .replaceAll('src="assets/about.js"', `src="assets/about.js?v=${version}"`)
      .replaceAll('src="assets/app.js"', `src="assets/app.js?v=${version}"`);
    await writeFile(target, versioned);
  }

  for (const file of browserModuleFiles) {
    const target = path.join(destination, "assets", file);
    const source = await readFile(target, "utf8");
    await writeFile(target, await versionBrowserImports(source, file, version));
  }
  await writeFile(path.join(destination, ".nojekyll"), "");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const settings = options(process.argv.slice(2));
  await buildSite(settings);
  console.log(`Built ${settings.output} with asset version ${settings.version}`);
}

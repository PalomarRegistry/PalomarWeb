import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
export const htmlFiles = ["404.html", "about.html", "entry.html", "faq.html", "index.html", "render.html"];
const publicFiles = [...htmlFiles, "site.webmanifest"];
const assetFiles = ["app.js", "rendering.js", "security.mjs", "style.css"];

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

  for (const file of htmlFiles) {
    const target = path.join(destination, file);
    const source = await readFile(target, "utf8");
    const versioned = source
      .replaceAll('href="assets/style.css"', `href="assets/style.css?v=${version}"`)
      .replaceAll('src="assets/app.js"', `src="assets/app.js?v=${version}"`);
    await writeFile(target, versioned);
  }

  const appTarget = path.join(destination, "assets", "app.js");
  const app = await readFile(appTarget, "utf8");
  const versionedImport = app
    .replace('from "./rendering.js";', `from "./rendering.js?v=${version}";`)
    .replace('from "./security.mjs";', `from "./security.mjs?v=${version}";`);
  if (
    !versionedImport.includes(`from "./rendering.js?v=${version}";`) ||
    !versionedImport.includes(`from "./security.mjs?v=${version}";`)
  ) {
    throw new Error("could not version coupled browser imports");
  }
  await writeFile(appTarget, versionedImport);
  await writeFile(path.join(destination, ".nojekyll"), "");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const settings = options(process.argv.slice(2));
  await buildSite(settings);
  console.log(`Built ${settings.output} with asset version ${settings.version}`);
}

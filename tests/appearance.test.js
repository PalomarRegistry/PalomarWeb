import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { htmlFiles } from "../scripts/build-site.mjs";

function expandHex(hex) {
  const raw = hex.slice(1);
  if (raw.length === 3) return [...raw].map((channel) => channel.repeat(2)).join("");
  if (raw.length === 6) return raw;
  throw new Error(`unsupported colour ${hex}`);
}

function luminance(hex) {
  const channels = expandHex(hex).match(/../g).map((pair) => {
    const value = parseInt(pair, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

function palette(css, index) {
  const blocks = [...css.matchAll(/:root\s*\{([^}]*)\}/g)];
  const values = {};
  for (const [, name, value] of blocks[index][1].matchAll(/(--[a-z-]+):\s*(#[^;\s]+)/gi)) {
    if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) {
      throw new Error(`${name} uses unsupported colour ${value}`);
    }
    values[name] = value;
  }
  return values;
}

// This reads the palette, so it answers for the colours as declared. What
// compositing then does to them -- an `opacity` below one fading text and its
// ground together, a colour carrying its own alpha -- leaves every pair here
// intact and can still put the result under the ratio a reader is owed. The
// browser suite measures the rendered tree for that; see "text stays readable
// once opacity and grounds are composited" in `site.spec.js`.
const css = await readFile(new URL("../assets/style.css", import.meta.url), "utf8");
const light = palette(css, 0);
const dark = { ...light, ...palette(css, 1) };

for (const [mode, colours] of [["light", light], ["dark", dark]]) {
  test(`${mode} text colours meet WCAG AA`, () => {
    for (const [foreground, background] of [
      ["--ink", "--paper"], ["--muted", "--paper"], ["--faint", "--paper"],
      ["--link", "--paper"], ["--visited", "--paper"], ["--hover", "--paper"],
      ["--caution", "--notice-paper"], ["--warning", "--paper"],
      ["--copied", "--paper"], ["--success", "--success-paper"],
      ["--missing", "--missing-paper"], ["--unrecoverable", "--unrecoverable-paper"],
      ["--ink", "--shade"], ["--ink", "--notice-paper"],
    ]) {
      const ratio = contrast(colours[foreground], colours[background]);
      assert.ok(
        ratio >= 4.5,
        `${mode} ${foreground} on ${background} is ${ratio.toFixed(2)}:1, needs 4.5`,
      );
    }
  });

  test(`${mode} non-text indicators retain contrast`, () => {
    for (const token of ["--field", "--available"]) {
      const ratio = contrast(colours[token], colours["--paper"]);
      assert.ok(ratio >= 3, `${mode} ${token} is ${ratio.toFixed(2)}:1 on paper, needs 3`);
    }
  });

  test(`${mode} acceptance mark meets text contrast`, () => {
    const ratio = contrast(colours["--paper"], colours["--success-mark"]);
    assert.ok(ratio >= 4.5, `${mode} acceptance mark is ${ratio.toFixed(2)}:1, needs 4.5`);
  });

  test(`${mode} filter states retain text contrast`, () => {
    for (const background of ["--control", "--control-hover", "--paper"]) {
      const ratio = contrast(colours["--ink"], colours[background]);
      assert.ok(ratio >= 4.5, `${mode} filter on ${background} is ${ratio.toFixed(2)}:1, needs 4.5`);
    }
  });
}

test("all page colours are palette variables", () => {
  const rules = css.slice(css.indexOf("* {"));
  const literals = [...rules.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((match) => match[0]);
  assert.deepEqual(literals, []);
});

// Driven by the build manifest rather than a list written here: a page added
// to the deployment and forgotten by this test is exactly the page that ships
// without the chrome colours, and `subject.html` had already been missed once.
for (const file of htmlFiles) {
  test(`${file} advertises browser-selected light and dark chrome colours`, async () => {
    const html = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(html, /name="theme-color" content="#ffffff" media="\(prefers-color-scheme: light\)"/);
    assert.match(html, /name="theme-color" content="#101216" media="\(prefers-color-scheme: dark\)"/);
  });
}

// The privacy policy is only useful if it can be found from wherever a reader
// happens to be standing, which is the finding that produced it.
test("every shipped page carries a footer link to the privacy policy", async () => {
  for (const file of htmlFiles) {
    const html = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    const footer = html.slice(html.indexOf("<footer>"), html.indexOf("</footer>"));
    assert.ok(footer, `${file} has no footer to carry the privacy link`);
    assert.match(
      footer,
      /<a href="\/?privacy\.html">Privacy<\/a>/,
      `${file} does not link the privacy policy from its footer`,
    );
  }
});

// GitHub Pages answers every address it cannot resolve with this one file, so
// it is read at `/entry/missing/thing` as readily as at `/404.html`. A relative
// href there resolves against the directory the reader was aiming at: the
// stylesheet becomes a second 404, and the two links out of the page land one
// level up from home. Every local reference on this page must therefore be
// root-absolute, and only this page has that requirement.
test("404.html addresses everything from the site root", async () => {
  const html = await readFile(new URL("../404.html", import.meta.url), "utf8");
  const references = [...html.matchAll(/(?:href|src)="([^"]*)"/g)].map((match) => match[1]);
  assert.ok(references.length >= 6, "404.html was expected to carry links and assets");
  const relative = references.filter((reference) =>
    !/^(?:https?:|mailto:|data:|#|\/)/.test(reference));
  assert.deepEqual(
    relative,
    [],
    `404.html has references that break when it answers a nested address: ${relative.join(", ")}`,
  );
  assert.match(html, /href="\/assets\/style\.css"/);
  assert.match(html, /<a href="\/">Return to the registry<\/a>/);
  assert.match(html, /<a href="\/privacy\.html">Privacy<\/a>/);
});

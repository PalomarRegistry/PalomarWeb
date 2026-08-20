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

  test(`${mode} registration mark meets text contrast`, () => {
    const ratio = contrast(colours["--paper"], colours["--success-mark"]);
    assert.ok(ratio >= 4.5, `${mode} registration mark is ${ratio.toFixed(2)}:1, needs 4.5`);
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
      /<a href="\/privacy">Privacy<\/a>/,
      `${file} does not link the privacy policy from its footer`,
    );
  }
});

// /llms.txt is the machine map of this origin. A page that ships without it
// is how palomar-registry.org/llms.txt stayed a 404 while the submission
// host already had one: agents start here, not at submit.
test("every shipped page carries a footer link to llms.txt", async () => {
  for (const file of htmlFiles) {
    const html = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    const footer = html.slice(html.indexOf("<footer>"), html.indexOf("</footer>"));
    assert.ok(footer, `${file} has no footer to carry the llms.txt link`);
    assert.match(
      footer,
      /<a href="\/llms\.txt">llms\.txt<\/a>/,
      `${file} does not link llms.txt from its footer`,
    );
  }
});

test("shipped navigation exposes routes rather than HTML filenames", async () => {
  for (const file of htmlFiles) {
    const html = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    const implementationLinks = hrefs.filter((href) => {
      const target = new URL(href, "https://palomar-registry.org/");
      return target.origin === "https://palomar-registry.org" &&
        /\.html$/.test(target.pathname);
    });
    assert.deepEqual(
      implementationLinks,
      [],
      `${file} exposes HTML filenames in public links`,
    );
  }
});

test("fixed public pages declare extensionless canonical URLs", async () => {
  const routes = new Map([
    ["index.html", "/"],
    ["about.html", "/about"],
    ["how-to-submit.html", "/how-to-submit"],
    ["privacy.html", "/privacy"],
    ["statement.html", "/statement"],
  ]);
  for (const [file, route] of routes) {
    const html = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(
      html,
      new RegExp(`<link rel="canonical" href="https://palomar-registry\\.org${route}">`),
    );
  }
});

// This page claimed for a while that GitHub processed for Palomar under the
// GitHub Data Protection Agreement, which GitHub does not offer on the Free
// plan Palomar is on. The correction is a disclosure of a real exposure, and a
// disclosure an unrelated edit can quietly drop is not one, so the claim is
// pinned here rather than left to the prose.
test("privacy.html discloses that GitHub Free carries no data protection agreement", async () => {
  const html = await readFile(new URL("../privacy.html", import.meta.url), "utf8");
  const text = html.replace(/\s+/g, " ");

  const opening = text.indexOf("<strong>GitHub</strong> hosts this site");
  assert.ok(opening >= 0, "privacy.html no longer describes GitHub's role");
  const entry = text.slice(opening, text.indexOf("</li>", opening));
  assert.match(entry, /no processor contract covers it/);
  assert.match(entry, /Palomar runs on a GitHub Free organization account/);
  assert.match(entry, /GitHub does not offer its/);
  assert.match(entry, /no data protection agreement governing how GitHub handles/);
  assert.doesNotMatch(entry, /it acts for Palomar/);

  // The consequence, and the data it applies to, not only the missing paper.
  assert.match(text, /access-controlled submission state/);
  assert.match(text, /private ledger/);
  assert.match(text, /sparse clone of the private database/);
  assert.match(text, /no processor agreement standing behind it/);

  // The absence is stated and left standing. Reassurance that it is fine, or a
  // view on what should be bought instead, are both out of this page's scope.
  assert.doesNotMatch(text, /settled arrangement/);
  assert.doesNotMatch(text, /gap waiting to close/);

  // The transfers section must not re-import the agreement it just disclaimed,
  // nor overcorrect: GitHub's terms do take the Privacy Statement in, and its
  // clauses are scoped to GitHub's own controller processing, so what Palomar
  // can say about Palomar's uploads is that it does not know.
  assert.match(text, /take the Privacy Statement in as part of the agreement/);
  assert.match(text, /scopes itself to the personal data GitHub handles as its own controller/);
  assert.match(text, /a question the statement does not answer/);
  assert.doesNotMatch(
    text,
    /relies on the transfer terms in each provider’s published data protection agreement/,
  );

  // GitHub retired this address; it now redirects to the policy index.
  assert.doesNotMatch(text, /site-policy\/privacy-policies\/github-data-protection-agreement/);
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
  assert.match(html, /<a href="\/privacy">Privacy<\/a>/);
});

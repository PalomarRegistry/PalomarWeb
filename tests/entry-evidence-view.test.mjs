import assert from "node:assert/strict";
import test from "node:test";

import { createEntryEvidenceView } from "../assets/entry-evidence-view.mjs";
import { COMMIT, entry, toolchainEntry } from "./registry-fixture.mjs";

function fakeDocument() {
  return {
    createElement(tag) {
      const node = {
        attributes: {},
        children: [],
        className: "",
        href: "",
        id: "",
        open: false,
        rel: "",
        tagName: tag.toUpperCase(),
        textContent: "",
        append(...children) {
          this.children.push(...children);
        },
        setAttribute(name, value) {
          this.attributes[name] = String(value);
        },
        getAttribute(name) {
          return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null;
        },
      };
      return node;
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

function textOf(root) {
  return descendants(root).map((node) => node.textContent).filter(Boolean).join("\n");
}

function sectionFor(record) {
  const { evidenceSection } = createEntryEvidenceView({ document: fakeDocument() });
  return evidenceSection(record);
}

test("an exact record shows its own evidence and keeps statement and proof dependencies apart", () => {
  const record = entry();
  record.trust.challenge_imports = ["Mathlib", "OtherLib"];
  record.trust.challenge_dependencies = [{ repository: "example/other", provenance: "allowlisted" }];
  const section = sectionFor(record);
  const disclosure = descendants(section).find((node) => node.tagName === "DETAILS");
  const summary = disclosure.children[0];

  assert.equal(section.id, "recorded-evidence");
  assert.equal(disclosure.className.includes("section-collapse"), true);
  assert.equal(disclosure.open, false);
  assert.equal(summary.tagName, "SUMMARY");
  assert.equal(summary.getAttribute("tabindex"), null);

  const statement = textOf(byClass(section, "evidence-statement-dependencies")[0]);
  const proof = textOf(byClass(section, "evidence-proof-dependencies")[0]);
  assert.match(statement, /Imported modules/);
  assert.match(statement, /Mathlib/);
  assert.match(statement, /OtherLib/);
  assert.match(statement, /example\/other/);
  assert.doesNotMatch(statement, /leanprover-community\/mathlib4/);
  assert.match(proof, /mathlib: leanprover-community\/mathlib4@1{40}/);
  assert.doesNotMatch(proof, /example\/other/);
  assert.doesNotMatch(textOf(section), /entail|implies|Example\.theorem/);

  const kernelText = textOf(byClass(section, "evidence-kernels")[0]);
  assert.match(kernelText, /not recorded/);
  assert.doesNotMatch(kernelText, /nanoda/);

  const pins = byClass(section, "evidence-source-pins")[0];
  const pinHrefs = descendants(pins).map((node) => node.href).filter(Boolean);
  assert.ok(pinHrefs.includes(`https://github.com/example/challenge/tree/${COMMIT}`));
  assert.ok(pinHrefs.includes(`https://github.com/leanprover-community/mathlib4/tree/${COMMIT}`));

  const preserved = byClass(section, "evidence-preservation-links")[0];
  const preservedHrefs = descendants(preserved).map((node) => node.href).filter(Boolean);
  assert.ok(preservedHrefs.includes(
    `https://github.com/PalomarArchive/example--challenge--fixture/tree/${COMMIT}`,
  ));
  assert.ok(preservedHrefs.includes(
    `https://github.com/PalomarArchive/mathlib4--fixture/tree/${COMMIT}`,
  ));
});

test("recorded kernels are named and missing evidence stays not recorded", () => {
  const recorded = toolchainEntry();
  const shown = sectionFor(recorded);
  const kernelText = textOf(byClass(shown, "evidence-kernels")[0]);
  assert.match(kernelText, /nanoda/);
  assert.match(kernelText, /con-ron/);
  assert.doesNotMatch(kernelText, /\/toolchain\/bin/);

  const sparse = entry();
  delete sparse.trust;
  delete sparse.formalization.project_dependencies;
  delete sparse.source;
  delete sparse.preservation;
  const hidden = sectionFor(sparse);
  for (const className of [
    "evidence-statement-dependencies",
    "evidence-proof-dependencies",
    "evidence-kernels",
    "evidence-source-pins",
    "evidence-preservation-links",
  ]) {
    const block = textOf(byClass(hidden, className)[0]);
    assert.match(block, /not recorded/);
    assert.doesNotMatch(block, /unavailable|failed|none listed|nanoda/);
  }
});

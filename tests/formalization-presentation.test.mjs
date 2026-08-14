import assert from "node:assert/strict";
import test from "node:test";

import { createFormalizationPresentation } from "../assets/formalization-presentation.mjs";
import { createSourceAvailabilityBinding } from "../assets/source-preservation.mjs";
import { validateAvailability, validateEntry } from "../assets/security.mjs";
import {
  COMMIT,
  availabilityEndpoint,
  availabilityManifest,
  availabilityRow,
  entry,
  summary,
} from "./registry-fixture.mjs";

const CHECKED_AT = new Date(Math.floor(Date.now() / 1_000) * 1_000)
  .toISOString()
  .replace(".000Z", "Z");

function acceptedEntry(mutate = () => {}) {
  const record = entry();
  mutate(record);
  return validateEntry(record, summary());
}

function fakeDocument() {
  const document = {
    activeElement: null,
    createElement(tag) {
      return {
        attributes: {},
        children: [],
        className: "",
        href: "",
        hidden: false,
        id: "",
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
        focus() {
          document.activeElement = this;
        },
      };
    },
  };
  return document;
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

function byTag(root, tagName) {
  return descendants(root).filter((node) => node.tagName === tagName.toUpperCase());
}

function texts(root, tagName) {
  return byTag(root, tagName).map((node) => node.textContent);
}

test("the trust badge and statement dependency section present the accepted trust record", () => {
  const presentation = createFormalizationPresentation({ document: fakeDocument() });
  const high = entry();
  assert.equal(
    presentation.trustBadge(high).textContent,
    "Statement dependencies: Mathlib only",
  );
  const highSection = presentation.statementDependencies(high);
  assert.equal(highSection.id, "statement-dependencies");
  assert.ok(texts(highSection, "h2").includes("Depends only on Mathlib"));
  // The heading sits inside a summary, so the section carries its own name:
  // a reader whose browser flattens the summary still has a landmark here.
  const highHeading = byTag(highSection, "h2")[0];
  assert.equal(highSection.getAttribute("aria-labelledby"), highHeading.id);
  assert.equal(highHeading.textContent, "Depends only on Mathlib");
  assert.deepEqual(texts(highSection, "code"), ["Mathlib"]);
  assert.equal(byClass(highSection, "reason-list").length, 0);

  const singleLibrary = entry();
  singleLibrary.trust = {
    ...singleLibrary.trust,
    challenge_dependencies: [{ repository: "leanprover-community/mathlib4" }],
  };
  const merged = presentation.statementDependencies(singleLibrary);
  assert.deepEqual(
    byClass(merged, "statement-import-line")[0].children.map((node) => node.textContent),
    ["Mathlib", " · leanprover-community/mathlib4"],
  );
  assert.ok(!texts(merged, "h3").includes("Source repositories"));
  assert.equal(byClass(merged, "plain-list").length, 0);
  assert.equal(byClass(merged, "token-list").length, 0);

  const qualified = entry();
  qualified.trust = {
    ...qualified.trust,
    level: "qualified",
    challenge_imports: ["Mathlib", "TauCeti"],
    challenge_dependencies: [{ repository: "TauCetiProject/TauCeti" }],
    reasons: ["The statement uses a domain-specific definition."],
  };
  assert.equal(
    presentation.trustBadge(qualified).textContent,
    "Statement dependencies: additional libraries",
  );
  const section = presentation.statementDependencies(qualified);
  assert.ok(texts(section, "h2").includes("Depends on additional libraries"));
  assert.deepEqual(texts(section, "code"), ["Mathlib", "TauCeti"]);
  assert.deepEqual(texts(byClass(section, "plain-list")[0], "li"), [
    "TauCetiProject/TauCeti",
  ]);
  assert.deepEqual(texts(byClass(section, "reason-list")[0], "li"), [
    "The statement uses a domain-specific definition.",
  ]);
});

test("the proof section presents imports and every preserved dependency kind", () => {
  const { solutionMetadata } = createFormalizationPresentation({ document: fakeDocument() });
  const record = acceptedEntry((value) => {
    value.formalization.project_dependencies.unshift({ name: "shared", path: "shared" });
  });
  const section = solutionMetadata(
    record,
    { schema_version: 2, solution_imports: ["ExampleDependency"] },
    null,
  );

  assert.equal(section.className, "entry-solution");
  assert.deepEqual(texts(section, "code"), [
    "ExampleDependency",
    "shared",
    COMMIT.slice(0, 12),
  ]);
  assert.ok(texts(section, "summary").includes("2 project dependencies used by the proof"));
  const links = byTag(section, "a");
  assert.deepEqual(links.map((link) => link.textContent), [
    "Solution.lean",
    "shared",
    "leanprover-community/mathlib4",
    "Palomar preserved copy",
  ]);
  assert.equal(
    links[0].href,
    `https://github.com/example/challenge/blob/${COMMIT}/Solution.lean`,
  );
  assert.equal(
    links[1].href,
    `https://github.com/example/challenge/tree/${COMMIT}/shared`,
  );
  assert.equal(
    links[3].href,
    `https://github.com/PalomarArchive/mathlib4--fixture/tree/${COMMIT}`,
  );
});

test("confirmed missing originals switch the proof and dependency links to their copies", async () => {
  const document = fakeDocument();
  const { solutionMetadata } = createFormalizationPresentation({ document });
  const record = acceptedEntry();
  const missing = availabilityEndpoint({ status: "missing", checked_at: CHECKED_AT });
  const availability = validateAvailability(availabilityManifest([
    availabilityRow({ original: missing }),
    availabilityRow({
      source_repository: "leanprover-community/mathlib4",
      fork_repository: "PalomarArchive/mathlib4--fixture",
      original: missing,
    }),
  ], { generated_at: CHECKED_AT }));
  let releaseAvailability;
  const sourceAvailability = createSourceAvailabilityBinding(new Promise((resolve) => {
    releaseAvailability = resolve;
  }));
  const section = solutionMetadata(record, { schema_version: 1 }, sourceAvailability);
  const initialLinks = byTag(section, "a");
  assert.deepEqual(initialLinks.map((link) => link.textContent), [
    "Solution.lean",
    "leanprover-community/mathlib4",
    "Palomar preserved copy",
  ]);
  initialLinks.at(-1).focus();

  releaseAvailability(availability);
  await sourceAvailability.ready;
  const links = byTag(section, "a").filter((link) => !link.hidden);

  assert.deepEqual(texts(section, "code"), [COMMIT.slice(0, 12)]);
  assert.deepEqual(links.map((link) => link.textContent), [
    "Solution.lean",
    "leanprover-community/mathlib4 (Palomar copy)",
  ]);
  assert.equal(
    links[0].href,
    `https://github.com/PalomarArchive/example--challenge--fixture/blob/${COMMIT}/Solution.lean`,
  );
  assert.equal(
    links[1].href,
    `https://github.com/PalomarArchive/mathlib4--fixture/tree/${COMMIT}`,
  );
  assert.equal(document.activeElement, links[1]);
  assert.equal(byClass(section, "source-archive-separator")[0].hidden, true);
});

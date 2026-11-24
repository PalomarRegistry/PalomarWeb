import { pinnedRepositoryDirectoryUrl } from "./security.mjs";

const NOT_RECORDED = "not recorded";

/**
 * A focused disclosure of the evidence already written on one exact record.
 *
 * Statement dependencies and proof-package dependencies stay in separate
 * groups when the record stores them as separate fields. Kernels, source
 * pins, and preservation links are copied from fields that are present. A
 * field the record does not have is "not recorded"; this view does not infer
 * a kernel from a toolchain commit, and it does not draw entailment edges
 * between theorems.
 *
 * The disclosure is a native `details` element, so Enter and Space on its
 * summary open and close it.
 */
export function createEntryEvidenceView({ document }) {
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function missing(text = NOT_RECORDED) {
    return el("p", "not-recorded", text);
  }

  function stringList(values) {
    if (!Array.isArray(values)) return missing();
    if (values.length === 0) return missing("none listed");
    const list = el("ul", "plain-list");
    for (const value of values) {
      list.append(el("li", "", typeof value === "string" && value ? value : NOT_RECORDED));
    }
    return list;
  }

  function statementDependencies(entry) {
    const block = el("div", "evidence-view-block evidence-statement-dependencies");
    block.append(el("h3", "", "Statement dependencies"));
    const trust = entry?.trust;
    const recorded = trust && typeof trust === "object";
    const hasImports = recorded && Object.hasOwn(trust, "challenge_imports");
    const hasRepositories = recorded && Object.hasOwn(trust, "challenge_dependencies");
    if (!hasImports && !hasRepositories) {
      block.append(missing());
      return block;
    }
    if (hasImports) {
      block.append(el("h4", "", "Imported modules"));
      block.append(stringList(trust.challenge_imports));
    } else {
      block.append(missing("Imported modules: not recorded"));
    }
    if (hasRepositories) {
      block.append(el("h4", "", "Statement source repositories"));
      const dependencies = trust.challenge_dependencies;
      if (!Array.isArray(dependencies)) block.append(missing());
      else if (dependencies.length === 0) block.append(missing("none listed"));
      else {
        const list = el("ul", "plain-list");
        for (const dependency of dependencies) {
          const repository = dependency && typeof dependency.repository === "string"
            ? dependency.repository
            : "";
          list.append(el("li", "", repository || NOT_RECORDED));
        }
        block.append(list);
      }
    } else {
      block.append(missing("Statement source repositories: not recorded"));
    }
    return block;
  }

  function proofDependencies(entry) {
    const block = el("div", "evidence-view-block evidence-proof-dependencies");
    block.append(el("h3", "", "Proof-package dependencies"));
    const formalization = entry?.formalization;
    if (!formalization || typeof formalization !== "object" ||
        !Object.hasOwn(formalization, "project_dependencies")) {
      block.append(missing());
      return block;
    }
    const dependencies = formalization.project_dependencies;
    if (!Array.isArray(dependencies)) {
      block.append(missing());
      return block;
    }
    if (dependencies.length === 0) {
      block.append(missing("none listed"));
      return block;
    }
    const list = el("ul", "plain-list");
    for (const dependency of dependencies) {
      if (!dependency || typeof dependency !== "object") {
        list.append(el("li", "", NOT_RECORDED));
        continue;
      }
      if (typeof dependency.path === "string") {
        const name = typeof dependency.name === "string" ? dependency.name : NOT_RECORDED;
        list.append(el("li", "", `${name}: ${dependency.path}`));
        continue;
      }
      if (typeof dependency.repository === "string" && typeof dependency.revision === "string") {
        const name = typeof dependency.name === "string" ? dependency.name : dependency.repository;
        list.append(el("li", "", `${name}: ${dependency.repository}@${dependency.revision}`));
        continue;
      }
      list.append(el("li", "", NOT_RECORDED));
    }
    block.append(list);
    return block;
  }

  function kernels(entry) {
    const block = el("div", "evidence-view-block evidence-kernels");
    block.append(el("h3", "", "Successful kernels"));
    const verification = entry?.verification;
    if (!verification || typeof verification !== "object" || !Object.hasOwn(verification, "kernels")) {
      block.append(missing());
      return block;
    }
    const recorded = verification.kernels;
    if (!Array.isArray(recorded)) {
      block.append(missing());
      return block;
    }
    const names = [];
    for (const kernel of recorded) {
      if (kernel && typeof kernel.name === "string" && kernel.name) names.push(kernel.name);
      else names.push(NOT_RECORDED);
    }
    block.append(stringList(names));
    return block;
  }

  function linkedList(items) {
    if (items === NOT_RECORDED) return missing();
    if (!Array.isArray(items)) return missing();
    if (items.length === 0) return missing("none listed");
    const list = el("ul", "plain-list");
    for (const item of items) {
      const row = el("li");
      if (item.href) {
        const link = el("a", "", item.text);
        link.href = item.href;
        link.rel = "noreferrer";
        row.append(link);
      } else {
        row.textContent = item.text;
      }
      if (item.note) row.append(el("span", "detail-note", ` ${item.note}`));
      list.append(row);
    }
    return list;
  }

  function pin(repository, revision, path = ".") {
    const url = pinnedRepositoryDirectoryUrl(repository, revision, path);
    const suffix = path && path !== "." ? `/${path}` : "";
    return { text: `${repository}@${revision}${suffix}`, href: url.href };
  }

  function sourcePins(entry) {
    const block = el("div", "evidence-view-block evidence-source-pins");
    block.append(el("h3", "", "Source pins"));
    const source = entry?.source;
    if (!source || typeof source.repository !== "string" || typeof source.commit !== "string") {
      block.append(missing());
      return block;
    }
    const pins = [];
    try {
      pins.push(pin(source.repository, source.commit, source.project_path || "."));
    } catch {
      block.append(missing());
      return block;
    }
    const dependencies = entry?.formalization?.project_dependencies;
    if (Array.isArray(dependencies)) {
      for (const dependency of dependencies) {
        if (!dependency || typeof dependency !== "object") continue;
        if (typeof dependency.repository === "string" && typeof dependency.revision === "string") {
          try {
            pins.push(pin(dependency.repository, dependency.revision));
          } catch {
            pins.push({ text: NOT_RECORDED });
          }
        }
      }
    }
    block.append(linkedList(pins));
    return block;
  }

  function preservationLinks(entry) {
    const block = el("div", "evidence-view-block evidence-preservation-links");
    block.append(el("h3", "", "Preservation links"));
    const repositories = entry?.preservation?.repositories;
    if (!Array.isArray(repositories)) {
      block.append(missing());
      return block;
    }
    if (repositories.length === 0) {
      block.append(missing("none listed"));
      return block;
    }
    const links = [];
    for (const row of repositories) {
      if (!row || typeof row.fork_repository !== "string" || typeof row.commit !== "string") {
        links.push({ text: NOT_RECORDED });
        continue;
      }
      try {
        const url = pinnedRepositoryDirectoryUrl(row.fork_repository, row.commit);
        const label = typeof row.source_repository === "string"
          ? `${row.source_repository} preserved at ${row.fork_repository}@${row.commit}`
          : `${row.fork_repository}@${row.commit}`;
        links.push({
          text: label,
          href: url.href,
          ...(typeof row.ref === "string" ? { note: row.ref } : {}),
        });
      } catch {
        links.push({ text: NOT_RECORDED });
      }
    }
    block.append(linkedList(links));
    return block;
  }

  function evidenceSection(entry) {
    const section = el("section", "entry-evidence-view");
    section.id = "recorded-evidence";
    const disclosure = el("details", "section-collapse");
    const summary = el("summary");
    const heading = el("div", "section-heading");
    const title = el("div");
    const sectionHeading = el("h2", "", "Recorded evidence");
    sectionHeading.id = "recorded-evidence-heading";
    section.setAttribute("aria-labelledby", sectionHeading.id);
    title.append(el("div", "eyebrow", "Exact version"), sectionHeading);
    heading.append(title);
    summary.append(heading);
    disclosure.append(summary);
    disclosure.append(
      el(
        "p",
        "evidence-view-note",
        "Only fields present on this version of the public record are shown.",
      ),
      statementDependencies(entry),
      proofDependencies(entry),
      kernels(entry),
      sourcePins(entry),
      preservationLinks(entry),
    );
    section.append(disclosure);
    return section;
  }

  return { evidenceSection };
}

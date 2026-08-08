import {
  pinnedRepositoryDirectoryUrl,
  safeExternalUrl,
} from "./security.mjs";
import {
  sourceDirectoryUrl,
  sourceFileUrl,
  sourceLocation,
} from "./source-preservation.mjs";

/**
 * Bind the statement and proof dependency presentation to its DOM adapter.
 *
 * Entry validation, source preservation, URL confinement, artifact metadata,
 * and page composition remain in their existing modules. This boundary owns
 * only the trust label and the statement/proof dependency DOM presented from
 * those accepted inputs.
 */
export function createFormalizationPresentation({ document }) {
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function externalLink(text, href) {
    const node = el("a", "", text);
    node.href = safeExternalUrl(href).href;
    return node;
  }

  function detailRow(label, value) {
    const row = el("div", "detail-row");
    row.append(el("dt", "", label), el("dd", "", String(value)));
    return row;
  }

  function trustBadge(entry) {
    const high = entry.trust.level === "high";
    const badge = el("span", `trust-badge ${high ? "high" : "qualified"}`);
    badge.textContent = high
      ? "Statement dependencies: Mathlib only"
      : "Statement dependencies: additional libraries";
    return badge;
  }

  function statementDependencies(entry) {
    const section = el("section", "entry-trust");
    section.id = "statement-dependencies";
    const heading = el("div", "section-heading");
    const title = el("div");
    title.append(
      el("div", "eyebrow", "Statement dependencies"),
      el(
        "h2",
        "",
        entry.trust.level === "high"
          ? "Depends only on Mathlib"
          : "Depends on additional libraries",
      ),
    );
    heading.append(title, trustBadge(entry));
    section.append(heading);
    const imports = el("div", "token-list");
    for (const item of entry.trust.challenge_imports) imports.append(el("code", "", item));
    section.append(el("h3", "", "Libraries imported by the statement"), imports);
    if (entry.trust.challenge_dependencies.length) {
      section.append(el("h3", "", "Source repositories"));
      const dependencies = el("ul", "plain-list");
      for (const dependency of entry.trust.challenge_dependencies) {
        dependencies.append(el("li", "", dependency.repository));
      }
      section.append(dependencies);
    }
    if (entry.trust.reasons.length) {
      section.append(el("h3", "", "Why additional libraries are needed"));
      const reasons = el("ul", "reason-list");
      for (const reason of entry.trust.reasons) reasons.append(el("li", "", reason));
      section.append(reasons);
    }
    return section;
  }

  function solutionMetadata(entry, renderMetadata, availability) {
    const section = el("section", "entry-solution");
    const heading = el("div", "section-heading");
    const title = el("div");
    title.append(el("div", "eyebrow", "Accepted proof"), el("h2", "", "Verified proof"));
    heading.append(title, el("span", "decision accepted-decision", "Accepted"));
    section.append(heading);
    section.append(
      el(
        "p",
        "solution-summary",
        "Lean checked the accepted proof using the exact versions of the source files and libraries listed below.",
      ),
    );

    const details = el("dl", "details solution-details");
    const proofRow = el("div", "detail-row");
    proofRow.append(el("dt", "", "Proof file"));
    const proofValue = el("dd");
    proofValue.append(
      externalLink(
        entry.formalization.solution_path,
        sourceFileUrl(entry, entry.formalization.solution_path, availability),
      ),
    );
    proofRow.append(proofValue);
    details.append(
      proofRow,
      detailRow("Proof file checksum (SHA-256)", entry.verification.solution_sha256),
    );
    if (renderMetadata?.schema_version >= 2) {
      const row = el("div", "detail-row");
      row.append(el("dt", "", "Libraries imported by the proof"));
      const value = el("dd", "token-list");
      for (const item of renderMetadata.solution_imports) value.append(el("code", "", item));
      row.append(value);
      details.append(row);
    }
    section.append(details);

    const dependencies = entry.formalization.project_dependencies;
    const closure = el("details", "solution-dependencies");
    closure.append(
      el(
        "summary",
        "",
        `${dependencies.length} project dependencies used by the proof`,
      ),
    );
    const list = el("ul", "dependency-list");
    for (const dependency of dependencies) {
      const item = el("li");
      if (dependency.path !== undefined) {
        item.append(
          externalLink(
            dependency.name,
            sourceDirectoryUrl(entry, dependency.path, availability),
          ),
          el("code", "", dependency.path),
        );
      } else {
        const location = sourceLocation(
          entry,
          availability,
          dependency.repository,
          dependency.revision,
        );
        item.append(
          externalLink(
            location.useArchive
              ? `${dependency.repository} (Palomar copy)`
              : dependency.repository,
            pinnedRepositoryDirectoryUrl(location.repository, dependency.revision),
          ),
          el("code", "", dependency.revision.slice(0, 12)),
        );
        if (!location.useArchive) {
          item.append(
            " · ",
            externalLink(
              "Palomar preserved copy",
              pinnedRepositoryDirectoryUrl(location.archiveRepository, dependency.revision),
            ),
          );
        }
      }
      list.append(item);
    }
    closure.append(list);
    section.append(closure);
    return section;
  }

  return { solutionMetadata, statementDependencies, trustBadge };
}

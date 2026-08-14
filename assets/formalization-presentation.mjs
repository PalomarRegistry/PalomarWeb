import {
  pinnedRepositoryDirectoryUrl,
  safeExternalUrl,
} from "./security.mjs";
import {
  bindSourceControl,
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

  function sourceLink(text, sourceAvailability, urlForAvailability, textForAvailability) {
    const current = sourceAvailability?.current ?? null;
    return bindSourceControl(
      externalLink(
        textForAvailability ? textForAvailability(current) : text,
        urlForAvailability(current),
      ),
      sourceAvailability,
      (availability) => ({
        url: urlForAvailability(availability),
        ...(textForAvailability ? { text: textForAvailability(availability) } : {}),
      }),
    );
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
    const disclosure = el("details", "section-collapse");
    const heading = el("div", "section-heading");
    const title = el("div");
    // Named from its own heading, so the section is a landmark even where a
    // summary's contents are flattened into its accessible name and the
    // heading inside it is not exposed as one.
    const sectionHeading = el(
      "h2",
      "",
      entry.trust.level === "high"
        ? "Depends only on Mathlib"
        : "Depends on additional libraries",
    );
    sectionHeading.id = "statement-dependencies-heading";
    section.setAttribute("aria-labelledby", sectionHeading.id);
    title.append(el("div", "eyebrow", "Statement dependencies"), sectionHeading);
    heading.append(title);
    const summary = el("summary");
    summary.append(heading);
    disclosure.append(summary);
    section.append(disclosure);
    const imports = entry.trust.challenge_imports;
    const dependencies = entry.trust.challenge_dependencies;
    disclosure.append(el("h3", "", "Imported libraries"));
    if (imports.length === 1 && dependencies.length === 1) {
      const line = el("p", "statement-import-line");
      line.append(el("code", "", imports[0]), el("span", "", ` · ${dependencies[0].repository}`));
      disclosure.append(line);
    } else {
      const importList = el("div", "token-list");
      for (const item of imports) importList.append(el("code", "", item));
      disclosure.append(importList);
      if (dependencies.length) {
        disclosure.append(el("h3", "", "Source repositories"));
        const dependencyList = el("ul", "plain-list");
        for (const dependency of dependencies) {
          dependencyList.append(el("li", "", dependency.repository));
        }
        disclosure.append(dependencyList);
      }
    }
    if (entry.trust.reasons.length) {
      disclosure.append(el("h3", "", "Why additional libraries are needed"));
      const reasons = el("ul", "reason-list");
      for (const reason of entry.trust.reasons) reasons.append(el("li", "", reason));
      disclosure.append(reasons);
    }
    return section;
  }

  function solutionMetadata(entry, renderMetadata, sourceAvailability = null) {
    const section = el("section", "entry-solution");
    const disclosure = el("details", "section-collapse");
    const heading = el("div", "section-heading");
    const title = el("div");
    const sectionHeading = el("h2", "", "Verified proof");
    sectionHeading.id = "proof-heading";
    section.setAttribute("aria-labelledby", sectionHeading.id);
    title.append(el("div", "eyebrow", "Accepted proof"), sectionHeading);
    heading.append(title, el("span", "decision accepted-decision", "Accepted"));
    const summary = el("summary");
    summary.append(heading);
    disclosure.append(summary);
    section.append(disclosure);
    disclosure.append(
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
      sourceLink(
        entry.formalization.solution_path,
        sourceAvailability,
        (availability) => sourceFileUrl(
          entry,
          entry.formalization.solution_path,
          availability,
        ),
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
    disclosure.append(details);

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
          sourceLink(
            dependency.name,
            sourceAvailability,
            (availability) => sourceDirectoryUrl(entry, dependency.path, availability),
          ),
          el("code", "", dependency.path),
        );
      } else {
        const locationFor = (availability) => sourceLocation(
          entry,
          availability,
          dependency.repository,
          dependency.revision,
        );
        const location = locationFor(sourceAvailability?.current ?? null);
        const primary = externalLink(
          dependency.repository,
          pinnedRepositoryDirectoryUrl(location.repository, dependency.revision),
        );
        const archive = externalLink(
          "Palomar preserved copy",
          pinnedRepositoryDirectoryUrl(location.archiveRepository, dependency.revision),
        );
        const archiveSeparator = el("span", "source-archive-separator", " · ");
        const applyAvailability = (availability) => {
          const selected = locationFor(availability);
          const useArchive = selected.useArchive;
          primary.href = safeExternalUrl(
            pinnedRepositoryDirectoryUrl(selected.repository, dependency.revision),
          ).href;
          primary.textContent = useArchive
            ? `${dependency.repository} (Palomar copy)`
            : dependency.repository;
          const archiveWasFocused = document.activeElement === archive;
          archive.hidden = useArchive;
          archiveSeparator.hidden = useArchive;
          if (archiveWasFocused && useArchive && typeof primary.focus === "function") {
            primary.focus();
          }
        };
        applyAvailability(sourceAvailability?.current ?? null);
        sourceAvailability?.whenReady(applyAvailability);
        item.append(
          primary,
          el("code", "", dependency.revision.slice(0, 12)),
        );
        item.append(archiveSeparator, archive);
      }
      list.append(item);
    }
    closure.append(list);
    disclosure.append(closure);
    return section;
  }

  return { solutionMetadata, statementDependencies, trustBadge };
}

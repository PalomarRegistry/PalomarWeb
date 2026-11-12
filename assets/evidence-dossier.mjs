import { availabilityRecord, pinnedRepositoryDirectoryUrl } from "./security.mjs";
import { challengeSourceUrl } from "./rendering.js";

export const DOSSIER_LIMITATION =
  "This is a copy of the public record, not a new certification.";

/**
 * A portable copy of one exact public record.
 *
 * Markdown and JSON carry the same fields in the same order. Text that came
 * from the record is escaped in Markdown. A field the record does not have is
 * left out, so a missing kernel or preservation observation is not written up
 * as a failed check. Nothing here re-checks the proof.
 */
export function evidenceDossier(entry, availability = null) {
  if (!entry || typeof entry !== "object") {
    throw new TypeError("dossier entry must be a record");
  }
  const model = {};
  if (typeof entry.id === "string") model.id = entry.id;
  if (Number.isInteger(entry.version)) model.version = entry.version;
  if (typeof entry.title === "string") model.title = entry.title;
  assign(model, "statement", statementLink(entry));
  assign(model, "source", sourceLink(entry));
  assign(model, "assumptions", recordedAssumptions(entry));
  assign(model, "checker_evidence", checkerEvidence(entry));
  assign(model, "source_revisions", sourceRevisions(entry));
  assign(model, "preservation", preservation(entry, availability));
  model.limitation = DOSSIER_LIMITATION;
  return {
    basename: basename(entry),
    markdown: renderMarkdown(model),
    json: `${JSON.stringify(model, null, 2)}\n`,
    model,
  };
}

export function createEvidenceDossier({ document, window }) {
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function download(filename, contents, type) {
    const blob = new Blob([contents], { type });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
  }

  function exportButton(entry, availability) {
    const button = el("button", "evidence-dossier-export", "Export evidence dossier");
    button.type = "button";
    button.addEventListener("click", () => {
      const current = typeof availability === "function" ? availability() : availability;
      const files = evidenceDossier(entry, current);
      download(`${files.basename}.md`, files.markdown, "text/markdown;charset=utf-8");
      download(`${files.basename}.json`, files.json, "application/json;charset=utf-8");
    });
    return button;
  }

  return { exportButton };
}

function assign(target, key, value) {
  if (value !== undefined) target[key] = value;
}

function basename(entry) {
  const id = /^PALOMAR-\d{4}-\d{2}-\d{2}-\d{6}$/.test(entry.id || "") ? entry.id : "entry";
  const version = Number.isInteger(entry.version) ? String(entry.version) : "unknown";
  return `${id}-v${version}-dossier`;
}

function statementLink(entry) {
  const path = entry.formalization?.challenge_path;
  if (typeof path !== "string") return undefined;
  const statement = { path };
  try {
    statement.url = challengeSourceUrl(entry);
  } catch {
    // The path stays. An unbuildable URL is omitted rather than invented.
  }
  return statement;
}

function sourceLink(entry) {
  const source = entry.source;
  if (!source || typeof source.repository !== "string" || typeof source.commit !== "string") {
    return undefined;
  }
  const body = { repository: source.repository, commit: source.commit };
  try {
    body.url = pinnedRepositoryDirectoryUrl(
      source.repository,
      source.commit,
      source.project_path || ".",
    ).href;
  } catch {
    // The identifiers stay.
  }
  return body;
}

function recordedAssumptions(entry) {
  if (Array.isArray(entry.assumptions)) return entry.assumptions.filter((item) => typeof item === "string");
  const formalization = entry.formalization;
  if (!formalization || typeof formalization !== "object") return undefined;
  if (Array.isArray(formalization.assumptions)) {
    return formalization.assumptions.filter((item) => typeof item === "string");
  }
  if (Object.hasOwn(formalization, "permitted_axioms") && Array.isArray(formalization.permitted_axioms)) {
    return formalization.permitted_axioms.filter((item) => typeof item === "string");
  }
  return undefined;
}

function checkerEvidence(entry) {
  const verification = entry.verification;
  if (!verification || typeof verification !== "object") return undefined;
  const evidence = {};
  if (typeof verification.verified_at === "string") evidence.verified_at = verification.verified_at;
  if (Object.hasOwn(verification, "kernels") && Array.isArray(verification.kernels)) {
    evidence.kernels = verification.kernels
      .map((kernel) => (kernel && typeof kernel.name === "string" ? kernel.name : null))
      .filter((name) => name);
  }
  for (const key of [
    "challenge_sha256",
    "solution_sha256",
    "evidence_tree_sha256",
    "evidence_path",
    "mechanical_report_sha256",
    "workflow_url",
  ]) {
    if (typeof verification[key] === "string") evidence[key] = verification[key];
  }
  return Object.keys(evidence).length ? evidence : undefined;
}

function sourceRevisions(entry) {
  const revisions = [];
  const source = entry.source;
  if (source && typeof source.repository === "string" && typeof source.commit === "string") {
    revisions.push({
      repository: source.repository,
      revision: source.commit,
      role: "submitted-source",
    });
  }
  const dependencies = entry.formalization?.project_dependencies;
  if (Array.isArray(dependencies)) {
    for (const dependency of dependencies) {
      if (
        dependency &&
        typeof dependency.repository === "string" &&
        typeof dependency.revision === "string"
      ) {
        revisions.push({
          repository: dependency.repository,
          revision: dependency.revision,
          role: "project-dependency",
        });
      }
    }
  }
  return revisions.length ? revisions : undefined;
}

function preservation(entry, availability) {
  const recorded = entry.preservation;
  if (!recorded || typeof recorded !== "object") return undefined;
  const body = {};
  if (typeof recorded.archived_at === "string") body.archived_at = recorded.archived_at;
  if (Array.isArray(recorded.repositories)) {
    body.repositories = recorded.repositories.map((row) => repositoryRow(row, availability));
  }
  return Object.keys(body).length ? body : undefined;
}

function repositoryRow(row, availability) {
  const item = {};
  if (row && typeof row.source_repository === "string") item.source_repository = row.source_repository;
  if (row && typeof row.commit === "string") item.commit = row.commit;
  if (row && typeof row.fork_repository === "string") item.fork_repository = row.fork_repository;
  if (row && typeof row.ref === "string") item.ref = row.ref;
  if (typeof item.fork_repository === "string" && typeof item.commit === "string") {
    try {
      item.fork_url = pinnedRepositoryDirectoryUrl(item.fork_repository, item.commit).href;
    } catch {
      // Identifiers stay. No synthetic link and no synthetic failure.
    }
  }
  const observed = observation(availability, item.source_repository, item.commit);
  if (observed?.original) copyObservation(item, "original", observed.original);
  if (observed?.archive) copyObservation(item, "archive", observed.archive);
  return item;
}

function observation(availability, repository, commit) {
  if (!availability || typeof availability.then === "function") return null;
  if (typeof repository !== "string" || typeof commit !== "string") return null;
  try {
    return availabilityRecord(availability, repository, commit);
  } catch {
    return null;
  }
}

function copyObservation(item, side, endpoint) {
  if (!endpoint || typeof endpoint.status !== "string" || !endpoint.status) return;
  item[`${side}_status`] = endpoint.status;
  if (typeof endpoint.checked_at === "string" && endpoint.checked_at) {
    item[`${side}_observed_at`] = endpoint.checked_at;
  }
}

function escapeMarkdown(value) {
  return String(value)
    .replace(/\r\n|\n|\r/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_{}\[\]()#!|]/g, (character) => `\\${character}`);
}

function markdownLink(label, href) {
  if (typeof href !== "string" || !/^https:\/\/github\.com\/[^\s<>()]+$/.test(href)) {
    return escapeMarkdown(label);
  }
  return `[${escapeMarkdown(label)}](${href})`;
}

function renderMarkdown(model) {
  const lines = ["# Evidence dossier", ""];
  if (model.id !== undefined) lines.push(`Identifier: ${escapeMarkdown(model.id)}`);
  if (model.version !== undefined) lines.push(`Version: ${model.version}`);
  if (model.title !== undefined) lines.push(`Title: ${escapeMarkdown(model.title)}`);
  lines.push("");
  if (model.statement) {
    lines.push("## Statement", "", markdownLink(model.statement.path, model.statement.url), "");
  }
  if (model.source) {
    const label = `${model.source.repository}@${model.source.commit}`;
    lines.push("## Source", "", markdownLink(label, model.source.url), "");
  }
  if (model.assumptions) {
    lines.push("## Recorded assumptions", "");
    if (model.assumptions.length === 0) {
      lines.push("The record's permitted-axiom list is empty.", "");
    } else {
      for (const assumption of model.assumptions) lines.push(`- ${escapeMarkdown(assumption)}`);
      lines.push("");
    }
  }
  if (model.checker_evidence) {
    lines.push("## Accepted checker evidence", "");
    const evidence = model.checker_evidence;
    if (evidence.verified_at) lines.push(`- Verified at: ${escapeMarkdown(evidence.verified_at)}`);
    if (Object.hasOwn(evidence, "kernels")) {
      lines.push(`- Successful kernels: ${evidence.kernels.map(escapeMarkdown).join(", ")}`);
    }
    for (const [label, key] of [
      ["Challenge SHA-256", "challenge_sha256"],
      ["Solution SHA-256", "solution_sha256"],
      ["Evidence tree SHA-256", "evidence_tree_sha256"],
      ["Evidence path", "evidence_path"],
      ["Mechanical report SHA-256", "mechanical_report_sha256"],
      ["Workflow", "workflow_url"],
    ]) {
      if (evidence[key]) lines.push(`- ${label}: ${escapeMarkdown(evidence[key])}`);
    }
    lines.push("");
  }
  if (model.source_revisions) {
    lines.push("## Source revisions", "");
    for (const revision of model.source_revisions) {
      lines.push(
        `- ${escapeMarkdown(revision.role)}: ${escapeMarkdown(revision.repository)}@${escapeMarkdown(revision.revision)}`,
      );
    }
    lines.push("");
  }
  if (model.preservation) {
    lines.push("## Preservation", "");
    if (model.preservation.archived_at) {
      lines.push(`Archived at: ${escapeMarkdown(model.preservation.archived_at)}`, "");
    }
    for (const row of model.preservation.repositories || []) {
      const name = row.source_repository || row.fork_repository || "repository";
      lines.push(`- ${escapeMarkdown(name)}@${escapeMarkdown(row.commit || "")}`);
      if (row.fork_repository && row.fork_url) {
        lines.push(`  - Preserved copy: ${markdownLink(row.fork_repository, row.fork_url)}`);
      }
      if (row.ref) lines.push(`  - Tag: ${escapeMarkdown(row.ref)}`);
      if (row.original_status) lines.push(`  - Original status: ${escapeMarkdown(row.original_status)}`);
      if (row.original_observed_at) {
        lines.push(`  - Original observed: ${escapeMarkdown(row.original_observed_at)}`);
      }
      if (row.archive_status) lines.push(`  - Archive status: ${escapeMarkdown(row.archive_status)}`);
      if (row.archive_observed_at) {
        lines.push(`  - Archive observed: ${escapeMarkdown(row.archive_observed_at)}`);
      }
    }
    lines.push("");
  }
  lines.push(DOSSIER_LIMITATION, "");
  return lines.join("\n");
}

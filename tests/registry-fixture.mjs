export const COMMIT = "1".repeat(40);
export const DIGEST = "a".repeat(64);

export function summary(overrides = {}) {
  return {
    id: "PALOMAR-2026-07-29-000123",
    version: 1,
    title: "Fixture theorem",
    status: "accepted",
    path: "entries/PALOMAR-2026-07-29-000123-v1.json",
    ...overrides,
  };
}

/** The same record as a second version, with every path that names the version moved. */
export function secondVersion(overrides = {}) {
  const value = entry({ version: 2, ...overrides });
  value.challenge_render.artifact_path = `renders/${value.id}-v2/${DIGEST}/`;
  value.verification.evidence_path = `evidence/${value.id}-v2/${"c".repeat(64)}/`;
  for (const repository of value.preservation.repositories) {
    repository.ref = `refs/tags/palomar/${value.id}-v2/${repository.commit}`;
  }
  return value;
}

export function recentRow(overrides = {}) {
  const record = entry();
  const sourceMapping = record.preservation.repositories.find(
    (mapping) =>
      mapping.source_repository.toLowerCase() === record.source.repository.toLowerCase() &&
      mapping.commit === record.source.commit,
  );
  return {
    id: record.id,
    version: record.version,
    status: record.status,
    title: record.title,
    path: `entries/${record.id}-v${record.version}.json`,
    abstract: record.abstract,
    authors: record.authors.map(({ name }) => ({ name })),
    classification: structuredClone(record.classification),
    formalization: { theorem_names: [...record.formalization.theorem_names] },
    trust: { level: record.trust.level },
    source: {
      repository: record.source.repository,
      commit: record.source.commit,
      project_path: record.source.project_path ?? null,
    },
    preservation: {
      repositories: [{
        source_repository: sourceMapping.source_repository,
        commit: sourceMapping.commit,
        fork_repository: sourceMapping.fork_repository,
      }],
    },
    published_at: record.registered_at,
    versions: 1,
    ...overrides,
  };
}

export function recent(entries = [recentRow()], overrides = {}) {
  return { schema_version: 1, entries, ...overrides };
}

export function availabilityEndpoint(overrides = {}) {
  return {
    status: "available",
    checked_at: "2026-08-08T12:00:00Z",
    last_attempt_at: "2026-08-08T12:00:00Z",
    consecutive_missing: 0,
    last_error: null,
    ...overrides,
  };
}

export function availabilityManifest(repositories = [], overrides = {}) {
  return {
    schema_version: 1,
    generated_at: "2026-08-08T12:00:00Z",
    database_commit: "d".repeat(40),
    coverage: { freshness_max_age_seconds: 18 * 60 * 60 },
    repositories,
    ...overrides,
  };
}

export function availabilityRow(overrides = {}) {
  return {
    source_repository: "example/challenge",
    commit: COMMIT,
    fork_repository: "PalomarArchive/example--challenge--fixture",
    original: availabilityEndpoint(),
    archive: availabilityEndpoint(),
    ...overrides,
  };
}

export function entry(overrides = {}) {
  const evidenceTree = "c".repeat(64);
  const value = {
    schema_version: 2,
    id: "PALOMAR-2026-07-29-000123",
    accepted_at: "2026-07-29",
    registered_at: "2026-07-29T09:14:07Z",
    version: 1,
    status: "accepted",
    title: "Fixture theorem",
    abstract: "A security fixture.",
    authors: [{ name: "Example" }],
    classification: { arxiv: ["math.CO"], msc2020: ["05C10"] },
    submission: {
      submission_id: "a1b2c3d4e5f6",
      authorization: { relationship: "maintainer" },
    },
    provenance: {
      result_origin: "original",
      repository_role: "substantive-development",
      responsible_maintainers: [{ name: "Example" }],
      mathematical_sources: [],
      related_formalizations: [],
    },
    source: {
      repository: "example/challenge",
      repository_url: "https://github.com/example/challenge",
      commit: COMMIT,
      tree_url: `https://github.com/example/challenge/tree/${COMMIT}`,
      license: {
        path: "LICENSE",
        sha256: DIGEST,
        declared_identifier: "Apache-2.0",
        detected_identifier: "Apache-2.0",
      },
    },
    preservation: {
      archive_owner: "PalomarArchive",
      archived_at: "2026-07-29T09:01:00Z",
      receipt_sha256: "f".repeat(64),
      repositories: [
        {
          source_repository: "example/challenge",
          commit: COMMIT,
          fork_repository: "PalomarArchive/example--challenge--fixture",
          ref: `refs/tags/palomar/PALOMAR-2026-07-29-000123-v1/${COMMIT}`,
        },
        {
          source_repository: "leanprover-community/mathlib4",
          commit: COMMIT,
          fork_repository: "PalomarArchive/mathlib4--fixture",
          ref: `refs/tags/palomar/PALOMAR-2026-07-29-000123-v1/${COMMIT}`,
        },
      ],
    },
    formalization: {
      challenge_path: "Challenge.lean",
      solution_path: "Solution.lean",
      comparator_config_path: "comparator.json",
      formalization_metadata_path: "formalization.yaml",
      lakefile_path: "lakefile.toml",
      lean_toolchain: "leanprover/lean4:v4.31.0",
      theorem_names: ["Example.theorem"],
      definition_names: [],
      permitted_axioms: [],
      project_dependencies: [
        { name: "mathlib", repository: "leanprover-community/mathlib4", revision: COMMIT },
      ],
    },
    verification: {
      repository: "PalomarRegistry/PalomarSubmission",
      run_id: 12345,
      workflow_path: ".github/workflows/submission.yml",
      comparator_commit: "2".repeat(40),
      lean4export_commit: "3".repeat(40),
      landrun_commit: "4".repeat(40),
      nanoda_commit: "9".repeat(40),
      verified_at: "2026-07-29T08:46:32Z",
      workflow_url: "https://github.com/PalomarRegistry/PalomarSubmission/actions/runs/12345",
      workflow_commit: "8".repeat(40),
      workflow_run_attempt: 1,
      challenge_sha256: DIGEST,
      solution_sha256: "b".repeat(64),
      evidence_tree_sha256: evidenceTree,
      mechanical_report_sha256: "d".repeat(64),
      evidence_path: `evidence/PALOMAR-2026-07-29-000123-v1/${evidenceTree}/`,
    },
    trust: {
      level: "high",
      challenge_lines: 10,
      challenge_bytes: 200,
      challenge_imports: ["Mathlib"],
      challenge_dependencies: [],
      reasons: [],
    },
    review: {
      reviewed_at: "2026-07-29T08:53:02Z",
      policy_commit: "5".repeat(40),
      verdict: "accept",
      report: { sha256: "e".repeat(64) },
      reviewer_models: ["fixture:model"],
      warnings: [],
    },
    challenge_render: {
      format: "verso-html",
      artifact_path: `renders/PALOMAR-2026-07-29-000123-v1/${DIGEST}/`,
      entrypoint: "Challenge/index.html",
      artifact_tree_sha256: DIGEST,
      verso_commit: "6".repeat(40),
      renderer_commit: "7".repeat(40),
      landrun_commit: "8".repeat(40),
      rendered_at: "2026-07-29T09:00:00Z",
    },
  };
  return Object.assign(value, overrides);
}

/** A complete valid record with a different identity, for ordered-list tests. */
export function identifiedEntry(serial, overrides = {}) {
  const id = `PALOMAR-2026-07-29-${String(serial).padStart(6, "0")}`;
  const version = overrides.version ?? 1;
  const values = {
    id,
    title: `Search fixture ${serial}`,
    abstract: "Alpha beta searchable fixture.",
    ...overrides,
  };
  const value = version === 1 ? entry(values) : secondVersion(values);
  value.submission.submission_id = String(serial).padStart(12, "0");
  value.verification.evidence_path =
    `evidence/${id}-v${version}/${value.verification.evidence_tree_sha256}/`;
  value.challenge_render.artifact_path =
    `renders/${id}-v${version}/${value.challenge_render.artifact_tree_sha256}/`;
  for (const repository of value.preservation.repositories) {
    repository.ref = `refs/tags/palomar/${id}-v${version}/${repository.commit}`;
  }
  return value;
}

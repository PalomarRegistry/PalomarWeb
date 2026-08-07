#!/usr/bin/env python3
"""Serve the static site plus synthetic registry and hostile render fixtures."""

from __future__ import annotations

import datetime as dt
import json
import pathlib
import re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parents[1]
HOST = "127.0.0.1"
PORT = 4173
HASH = "a" * 64


def entry(identifier: str, lines: int, version: int = 1) -> dict:
    serial = int(identifier.rsplit("-", 1)[-1])
    submission_id = f"{serial:012x}".replace("x", "0")
    classification = (
        {"arxiv": ["math.CO", "cs.DM"], "msc2020": ["05C10"]}
        if identifier.endswith("000123")
        else {"arxiv": ["math.NT"], "msc2020": ["11N13"]}
    )
    record = {
        "schema_version": 2,
        "id": identifier,
        "accepted_at": "2026-07-29",
        "version": version,
        "status": "accepted",
        "title": f"Fixture {identifier} version {version}",
        "abstract": "A browser confinement fixture.",
        "authors": [{"name": "Example"}],
        "classification": classification,
        "provenance": {
            "result_origin": "original",
            "repository_role": "substantive-development",
            "responsible_maintainers": [{"name": "Example"}],
            "mathematical_sources": [],
            "related_formalizations": [],
        },
        "submission": {
            "submission_id": submission_id,
            "authorization": {"relationship": "maintainer"},
        },
        "source": {
            "repository": "example/challenge",
            "repository_url": "https://github.com/example/challenge",
            "commit": "1" * 40,
            "tree_url": f"https://github.com/example/challenge/tree/{'1' * 40}",
            "license": {
                "path": "LICENSE.md",
                "sha256": "d" * 64,
                "declared_identifier": "Apache-2.0",
                "detected_identifier": "Apache-2.0",
            },
        },
        "formalization": {
            "challenge_path": "Challenge.lean",
            "solution_path": "Solution.lean",
            "comparator_config_path": "comparator.json",
            "formalization_metadata_path": "formalization.yaml",
            "lakefile_path": "lakefile.toml",
            "theorem_names": ["Example.theorem"],
            "definition_names": [],
            "lean_toolchain": "leanprover/lean4:v4.31.0-rc2",
            "permitted_axioms": [],
            "project_dependencies": [
                {
                    "name": "exampleDependency",
                    "repository": "example/dependency",
                    "revision": "3" * 40,
                }
            ],
        },
        "verification": {
            "repository": "PalomarRegistry/PalomarSubmission",
            "run_id": 12345,
            "workflow_path": ".github/workflows/submission.yml",
            "comparator_commit": "2" * 40,
            "lean4export_commit": "3" * 40,
            "landrun_commit": "4" * 40,
            "nanoda_commit": "9" * 40,
            "workflow_url": "https://github.com/PalomarRegistry/PalomarSubmission/actions/runs/12345",
            "challenge_sha256": "b" * 64,
            "solution_sha256": "c" * 64,
            "verified_at": "2026-07-29T08:46:32Z",
            "workflow_commit": "9" * 40,
            "workflow_run_attempt": 1,
            "evidence_path": f"evidence/{identifier}-v{version}/{HASH}/",
            "evidence_tree_sha256": HASH,
            "mechanical_report_sha256": "d" * 64,
        },
        "trust": {
            "level": "high",
            "challenge_lines": lines,
            "challenge_bytes": 1024,
            "challenge_imports": ["Mathlib"],
            "challenge_dependencies": [],
            "reasons": [],
        },
        "review": {
            "reviewed_at": "2026-07-29T08:53:02Z",
            "policy_commit": "5" * 40,
            "verdict": "accept",
            "reviewer_models": ["fixture:model"],
            "warnings": [],
            "report": {"sha256": "e" * 64},
        },
        "challenge_render": {
            "format": "verso-html",
            "artifact_path": f"renders/{identifier}-v{version}/{HASH}/",
            "entrypoint": "Challenge/index.html",
            "artifact_tree_sha256": HASH,
            "verso_commit": "6" * 40,
            "renderer_commit": "7" * 40,
            "landrun_commit": "8" * 40,
            "rendered_at": "2026-07-29T09:00:00Z",
        },
    }
    if identifier.endswith("000123"):
        project = "project"
        record["source"]["project_path"] = project
        record["source"]["tree_url"] += f"/{project}"
        record["formalization"].update(
            {
                "challenge_path": f"{project}/Comparator/Task.lean",
                "solution_path": f"{project}/Comparator/Answer.lean",
                "comparator_config_path": f"{project}/Comparator/settings.json",
                "formalization_metadata_path": f"{project}/formalization.yaml",
                "lakefile_path": f"{project}/lakefile.lean",
                "project_dependencies": [
                    {"name": "shared", "path": "shared"},
                    *record["formalization"]["project_dependencies"],
                ],
            }
        )
    sources = [(record["source"]["repository"], record["source"]["commit"])]
    sources.extend(
        (dependency["repository"], dependency["revision"])
        for dependency in record["formalization"]["project_dependencies"]
        if "path" not in dependency
    )
    unique = {}
    for repository, commit in sources:
        unique.setdefault((repository.casefold(), commit), (repository, commit))
    record["preservation"] = {
        "archive_owner": "PalomarArchive",
        "archived_at": "2026-07-29T09:01:00Z",
        "receipt_sha256": "f" * 64,
        "repositories": [
            {
                "source_repository": repository,
                "commit": commit,
                "fork_repository": "PalomarArchive/" + repository.replace("/", "--"),
                "ref": f"refs/tags/palomar/{identifier}-v{version}/{commit}",
            }
            for repository, commit in sorted(
                unique.values(), key=lambda item: (item[0].casefold(), item[1])
            )
        ],
    }
    return record


ENTRIES = {
    ("PALOMAR-2026-07-29-000123", 1): entry(
        "PALOMAR-2026-07-29-000123", 100, 1
    ),
    ("PALOMAR-2026-07-29-000123", 2): entry(
        "PALOMAR-2026-07-29-000123", 100, 2
    ),
    ("PALOMAR-2026-07-29-000124", 1): entry(
        "PALOMAR-2026-07-29-000124", 101, 1
    ),
}
ENTRIES[("PALOMAR-2026-07-29-000124", 1)]["trust"].update(
    {
        "level": "qualified",
        "challenge_dependencies": [
            {
                "repository": "leanprover-community/mathlib4",
                "provenance": "allowlisted",
            },
            {
                "repository": "TauCetiProject/TauCeti",
                "provenance": "allowlisted",
            },
        ],
        "reasons": ["Challenge imports Tau Ceti"],
    }
)
def summary(item: dict) -> dict:
    """One index row, which every derived surface repeats."""
    return {
        "id": item["id"],
        "version": item["version"],
        "title": item["title"],
        "status": "accepted",
        "path": f"entries/{item['id']}-v{item['version']}.json",
    }


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_bytes(self, payload: bytes, content_type: str) -> None:
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:  # noqa: N802 - inherited HTTP method name
        path = self.path.split("?", 1)[0]
        if path in {
            "/database/source-availability.json",
            "/database/source-availability-missing.json",
        }:
            original_status = "missing" if path.endswith("-missing.json") else "available"
            mappings = {}
            for record in ENTRIES.values():
                for row in record["preservation"]["repositories"]:
                    key = (row["source_repository"].casefold(), row["commit"])
                    mappings.setdefault(key, row)
            checked_at = dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat().replace(
                "+00:00", "Z"
            )
            endpoint = lambda status: {
                "status": status,
                "checked_at": checked_at,
                "last_attempt_at": checked_at,
                "consecutive_missing": 2 if status == "missing" else 0,
                "last_error": None,
            }
            payload = {
                "schema_version": 1,
                "generated_at": checked_at,
                "repositories": [
                    {
                        "source_repository": row["source_repository"],
                        "commit": row["commit"],
                        "fork_repository": row["fork_repository"],
                        "original": endpoint(original_status),
                        "archive": endpoint("available"),
                    }
                    for row in mappings.values()
                ],
            }
            self.send_bytes(json.dumps(payload).encode(), "application/json")
            return
        if path == "/database/index.json":
            payload = {
                "schema_version": 3,
                "generated_at": "2026-07-29T09:00:00Z",
                "entries": [summary(item) for item in ENTRIES.values()],
            }
            self.send_bytes(json.dumps(payload).encode(), "application/json")
            return
        # The registry a shard at a time, which is what the landing page reads
        # instead of the index. Every shard exists, including the empty ones:
        # a reader has to be able to tell "nothing here" from "not published".
        if path == "/database/browse/index.json":
            held = {}
            for item in ENTRIES.values():
                held[item["id"][-2:]] = held.get(item["id"][-2:], 0) + 1
            self.send_bytes(
                json.dumps({
                    "schema_version": 1,
                    "shards": [
                        {
                            "shard": f"{number:02d}",
                            "path": f"browse/{number:02d}.json",
                            "count": held.get(f"{number:02d}", 0),
                        }
                        for number in range(100)
                    ],
                }).encode(),
                "application/json",
            )
            return
        shard = re.fullmatch(r"/database/browse/([0-9]{2})\.json", path)
        if shard:
            rows = [
                summary(item)
                for item in ENTRIES.values()
                if item["id"][-2:] == shard.group(1)
            ]
            self.send_bytes(
                json.dumps({
                    "schema_version": 1,
                    "shard": shard.group(1),
                    "entries": sorted(rows, key=lambda row: (row["id"], row["version"])),
                }).encode(),
                "application/json",
            )
            return
        # The versions of one result, which is what an entry page reads instead
        # of the whole index.
        versions = re.fullmatch(
            r"/database/versions/(PALOMAR-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{6})\.json",
            path,
        )
        if versions:
            identifier = versions.group(1)
            rows = [summary(item) for item in ENTRIES.values() if item["id"] == identifier]
            if not rows:
                self.send_error(404)
                return
            self.send_bytes(
                json.dumps({
                    "schema_version": 1,
                    "id": identifier,
                    "entries": sorted(rows, key=lambda row: row["version"]),
                }).encode(),
                "application/json",
            )
            return
        tombstone = re.fullmatch(
            r"/database/tombstones/(PALOMAR-2026-07-29-000125)-v(1)\.json",
            path,
        )
        if tombstone:
            self.send_bytes(
                json.dumps(
                    {
                        "id": tombstone.group(1),
                        "version": int(tombstone.group(2)),
                        "taken_down_on": "2026-08-06",
                    }
                ).encode(),
                "application/json",
            )
            return
        match = re.fullmatch(
            r"/database/entries/(PALOMAR-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{6})-v([1-9][0-9]*)\.json",
            path,
        )
        entry_key = (match.group(1), int(match.group(2))) if match else None
        if entry_key in ENTRIES:
            self.send_bytes(json.dumps(ENTRIES[entry_key]).encode(), "application/json")
            return
        if re.fullmatch(
            rf"/database/renders/PALOMAR-[0-9]{{4}}-[0-9]{{2}}-[0-9]{{2}}-[0-9]{{6}}-v[1-9][0-9]*/{HASH}/Challenge/index\.html",
            path,
        ):
            page = f"""<!doctype html>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'">
<title>Hostile render fixture</title>
<style>html, body {{ height: auto; overflow: auto; }} body {{ margin: 0; }}
.theorem {{ padding: 1rem; }} .theorem-lines {{ height: 70rem; }}</style>
<body><main><p class="docstring">The theorem doc-string.</p>
<div class="theorem"><pre>theorem Example.theorem :</pre><div class="theorem-lines"></div>
<pre id="theorem-end">  True := by trivial</pre></div>
</main><script defer src="../attack.js"></script></body>"""
            self.send_bytes(page.encode(), "text/html; charset=utf-8")
            return
        if re.fullmatch(
            rf"/database/renders/PALOMAR-[0-9]{{4}}-[0-9]{{2}}-[0-9]{{2}}-[0-9]{{6}}-v[1-9][0-9]*/{HASH}/challenge-metadata\.json",
            path,
        ):
            metadata = {
                "schema_version": 2,
                "imports": ["Mathlib"],
                "module_doc": "# Fixture module\n\nParsed outside the Verso renderer.",
                "declarations": ["Example.theorem"],
                "solution_imports": ["ExampleDependency"],
            }
            self.send_bytes(json.dumps(metadata).encode(), "application/json")
            return
        if re.fullmatch(
            rf"/database/renders/PALOMAR-[0-9]{{4}}-[0-9]{{2}}-[0-9]{{2}}-[0-9]{{6}}-v[1-9][0-9]*/{HASH}/attack\.js",
            path,
        ):
            script = """
document.body.dataset.scriptRan = "true";
try { top.document.body.dataset.compromised = "true"; }
catch (_) { document.body.dataset.topAccess = "blocked"; }
try { localStorage.setItem("palomar-attack", "true"); }
catch (_) { document.body.dataset.storageAccess = "blocked"; }
parent.postMessage({type: "palomar-render-height", height: Math.ceil(document.querySelector("main").getBoundingClientRect().height)}, "*");
"""
            self.send_bytes(script.encode(), "text/javascript; charset=utf-8")
            return
        super().do_GET()


if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()

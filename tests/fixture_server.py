#!/usr/bin/env python3
"""Serve the static site plus synthetic registry and hostile render fixtures."""

from __future__ import annotations

import json
import pathlib
import re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parents[1]
HOST = "127.0.0.1"
PORT = 4173
HASH = "a" * 64


def entry(identifier: str, lines: int, version: int = 1) -> dict:
    issue = int(identifier.rsplit("-", 1)[-1])
    return {
        "schema_version": 2,
        "id": identifier,
        "accepted_at": "2026-07-29",
        "version": version,
        "status": "accepted",
        "title": f"Fixture {identifier} version {version}",
        "abstract": "A browser confinement fixture.",
        "authors": [{"name": "Example"}],
        "submission": {
            "repository": "kim-em/PalomarSubmission",
            "issue": issue,
            "url": f"https://github.com/kim-em/PalomarSubmission/issues/{issue}",
            "submitter": "example",
        },
        "source": {
            "repository": "example/challenge",
            "repository_url": "https://github.com/example/challenge",
            "commit": "1" * 40,
            "tree_url": f"https://github.com/example/challenge/tree/{'1' * 40}",
        },
        "formalization": {
            "challenge_path": "Challenge.lean",
            "solution_path": "Solution.lean",
            "comparator_config_path": "comparator.json",
            "formalization_metadata_path": "formalization.yaml",
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
            "comparator_commit": "2" * 40,
            "lean4export_commit": "3" * 40,
            "landrun_commit": "4" * 40,
            "workflow_url": "https://github.com/kim-em/PalomarSubmission/actions/runs/12345",
            "challenge_sha256": "b" * 64,
            "solution_sha256": "c" * 64,
            "verified_at": "2026-07-29T08:46:32Z",
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
            "scores": {
                "statement_alignment": 5,
                "definition_fidelity": 5,
                "notability": 5,
                "literature": 5,
                "clarity": 5,
            },
            "warnings": [],
            "report_url": (
                "https://github.com/kim-em/PalomarSubmission/issues/"
                f"{issue}#issuecomment-456"
            ),
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
        if path == "/database/index.json":
            payload = {
                "schema_version": 2,
                "generated_at": "2026-07-29T09:00:00Z",
                "entries": [
                    {
                        "id": item["id"],
                        "version": item["version"],
                        "title": item["title"],
                        "status": "accepted",
                        "path": f"entries/{item['id']}-v{item['version']}.json",
                    }
                    for item in ENTRIES.values()
                ]
            }
            self.send_bytes(json.dumps(payload).encode(), "application/json")
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

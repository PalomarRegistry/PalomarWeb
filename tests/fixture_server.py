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


def entry(identifier: str, lines: int) -> dict:
    return {
        "id": identifier,
        "accepted_at": "2026-07-29",
        "version": 1,
        "title": f"Fixture {identifier}",
        "abstract": "A browser confinement fixture.",
        "authors": [{"name": "Example"}],
        "source": {
            "repository": "example/challenge",
            "repository_url": "https://github.com/example/challenge",
            "commit": "1" * 40,
            "tree_url": f"https://github.com/example/challenge/tree/{'1' * 40}",
        },
        "formalization": {
            "challenge_path": "Challenge.lean",
            "solution_path": "Solution.lean",
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
            "workflow_url": "https://example.test/run",
            "solution_sha256": "4" * 64,
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
            "scores": {"clarity": 5},
            "warnings": [],
            "report_url": "https://example.test/review",
            "reviewed_at": "2026-07-29T08:53:02Z",
        },
        "challenge_render": {
            "format": "verso-html",
            "artifact_path": f"renders/{identifier}-v1/{HASH}/",
            "entrypoint": "Challenge/index.html",
            "artifact_tree_sha256": HASH,
        },
    }


ENTRIES = {
    "PALOMAR-2026-07-29-000123": entry("PALOMAR-2026-07-29-000123", 100),
    "PALOMAR-2026-07-29-000124": entry("PALOMAR-2026-07-29-000124", 101),
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
                "entries": [
                    {
                        "id": item["id"],
                        "version": 1,
                        "path": f"entries/{item['id']}-v1.json",
                    }
                    for item in ENTRIES.values()
                ]
            }
            self.send_bytes(json.dumps(payload).encode(), "application/json")
            return
        match = re.fullmatch(
            r"/database/entries/(PALOMAR-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{6})-v1\.json",
            path,
        )
        if match and match.group(1) in ENTRIES:
            self.send_bytes(json.dumps(ENTRIES[match.group(1)]).encode(), "application/json")
            return
        if re.fullmatch(
            rf"/database/renders/PALOMAR-[0-9]{{4}}-[0-9]{{2}}-[0-9]{{2}}-[0-9]{{6}}-v1/{HASH}/Challenge/index\.html",
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
            rf"/database/renders/PALOMAR-[0-9]{{4}}-[0-9]{{2}}-[0-9]{{2}}-[0-9]{{6}}-v1/{HASH}/challenge-metadata\.json",
            path,
        ):
            metadata = {
                "schema_version": 2,
                "imports": ["Mathlib"],
                "module_doc": "# Fixture module\n\nParsed outside the Verso surface.",
                "declarations": ["Example.theorem"],
                "solution_imports": ["ExampleDependency"],
            }
            self.send_bytes(json.dumps(metadata).encode(), "application/json")
            return
        if re.fullmatch(
            rf"/database/renders/PALOMAR-[0-9]{{4}}-[0-9]{{2}}-[0-9]{{2}}-[0-9]{{6}}-v1/{HASH}/attack\.js",
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

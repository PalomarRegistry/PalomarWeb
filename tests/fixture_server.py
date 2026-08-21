#!/usr/bin/env python3
"""Serve the static site plus synthetic registry and hostile render fixtures."""

from __future__ import annotations

import collections
import datetime as dt
import json
import pathlib
import re
import unicodedata
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parents[1]
HOST = "127.0.0.1"
PORT = 4173
HASH = "a" * 64
# Small enough that the fixture has several pages per word, because a single
# page would exercise none of the walking the browser does.
SEARCH_PAGE_SIZE = 2
# The same three steps, in the same order, as `tools/build_search.py` in
# PalomarDatabase and `searchTerms` in assets/security.mjs. A fixture that
# tokenized differently would test the browser against an index nothing
# publishes.
SEARCH_STOPWORDS = {"an", "and", "for", "in", "of", "on", "the", "to", "with"}


def entry(identifier: str, lines: int, version: int = 1) -> dict:
    serial = int(identifier.rsplit("-", 1)[-1])
    submission_id = f"{serial:012x}".replace("x", "0")
    classification = (
        {"arxiv": ["math.CO", "cs.DM"], "msc2020": ["05C10"]}
        if identifier.endswith("000123")
        else {"arxiv": ["math.NT"], "msc2020": ["11N13"]}
    )
    record = {
        "schema_version": 3,
        "id": identifier,
        "first_registered_on": "2026-07-29",
        # The result's date is the day its version 1 was registered, and a
        # later version brings its own instant: a v2 is a new registration and
        # is news, where the result's date would file it beside its v1.
        "registered_at": (
            "2026-07-29T09:14:07Z" if version == 1 else f"2026-08-{version:02d}T09:14:07Z"
        ),
        "version": version,
        "status": "registered",
        "title": f"Fixture {identifier} version {version}",
        "abstract": "A browser confinement fixture for the registry, about the quasicoherent behaviour of a synthetic result.",
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
            "outcome": "neutral",
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


def recent_row(record: dict, versions: int) -> dict:
    """Project exactly the landing-card contract emitted by PalomarDatabase."""
    source = record["source"]
    mapping = next(
        (
            item
            for item in record["preservation"]["repositories"]
            if item["source_repository"].casefold() == source["repository"].casefold()
            and item["commit"] == source["commit"]
        ),
        None,
    )
    if mapping is None:
        raise ValueError(
            "browser fixture has no preservation mapping for "
            f"{source['repository']}@{source['commit']}"
        )
    return {
        "id": record["id"],
        "version": record["version"],
        "status": record["status"],
        "title": record["title"],
        "path": f"entries/{record['id']}-v{record['version']}.json",
        "abstract": record["abstract"],
        "authors": [{"name": author["name"]} for author in record["authors"]],
        "classification": record["classification"],
        "formalization": {
            "theorem_names": record["formalization"]["theorem_names"],
        },
        "trust": {"level": record["trust"]["level"]},
        "source": {
            "repository": source["repository"],
            "commit": source["commit"],
            "project_path": source.get("project_path"),
        },
        "preservation": {
            "repositories": [
                {
                    "source_repository": mapping["source_repository"],
                    "commit": mapping["commit"],
                    "fork_repository": mapping["fork_repository"],
                }
            ]
        },
        "published_at": record["registered_at"],
        "versions": versions,
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
SUBJECT_PAGE_ITEMS = 50
PAGE_SERIALS = 200
# A code with more current versions than one subject front page can carry, so
# that the archive walk has something to walk. These rows are deliberately not
# in ENTRIES: the landing, search and browse fixtures are sized for the
# assertions built on them, and this code exists only to make paging real.
ARCHIVE_CLASSIFICATION = {"arxiv": ["math.AG"], "msc2020": ["14A10"]}
ARCHIVE_DAYS = ("2026-06-01", "2026-06-02", "2026-06-03")
ARCHIVE_PER_DAY = 20


def subject_row(record: dict) -> dict:
    """One version as the subject surfaces carry it.

    The index row, plus the registration instant a page is ordered by and the
    classification that says the row belongs on it. Both are what a reader
    would otherwise have to open the record to check.
    """
    return {
        "id": record["id"],
        "version": record["version"],
        "title": record["title"],
        "status": "registered",
        "path": f"entries/{record['id']}-v{record['version']}.json",
        "published_at": record["registered_at"],
        "classification": record["classification"],
        "abstract": record["abstract"],
    }


def archive_rows() -> list[dict]:
    rows = []
    for day in ARCHIVE_DAYS:
        for serial in range(1, ARCHIVE_PER_DAY + 1):
            identifier = f"PALOMAR-{day}-{serial:06d}"
            rows.append({
                "id": identifier,
                "version": 1,
                "title": f"Archive fixture {identifier}",
                "registered_at": f"{day}T09:00:{serial:02d}Z",
                "classification": ARCHIVE_CLASSIFICATION,
                "abstract": "A paging fixture for one classification code.",
            })
    return rows


def codes_of(row: dict) -> list[tuple[str, str]]:
    return [("arxiv", code) for code in row["classification"]["arxiv"]] + [
        ("msc", code) for code in row["classification"]["msc2020"]
    ]


def coordinate(identifier: str) -> tuple[str, str, int]:
    day = identifier[len("PALOMAR-") : len("PALOMAR-") + 10]
    serial = int(identifier.rsplit("-", 1)[-1])
    return day[:4], day, (serial - 1) // PAGE_SERIALS + 1


def subject_documents() -> dict[str, dict]:
    """Every `subjects/` document, by the same rules as `build_subjects.py`.

    Seeded from every version and filled from the current ones, paged by the
    day and serial in the identifier, and nothing consulted to decide which
    page a row is on. A fixture that worked any of that out differently would
    test the browser against a surface the publisher does not write.
    """
    every = [subject_row(record) for record in ENTRIES.values()] + [
        subject_row(record) for record in archive_rows()
    ]
    latest: dict[str, dict] = {}
    for row in every:
        previous = latest.get(row["id"])
        if previous is None or row["version"] > previous["version"]:
            latest[row["id"]] = row
    current = sorted(
        latest.values(), key=lambda row: (row["published_at"], row["id"]), reverse=True
    )

    seeds: dict[tuple[str, str], set[str]] = {}
    for row in every:
        for code in codes_of(row):
            seeds.setdefault(code, set()).add(row["id"])
    selected: dict[tuple[str, str], list[dict]] = {code: [] for code in seeds}
    for row in current:
        for code in codes_of(row):
            selected[code].append(row)

    documents: dict[str, dict] = {}
    for (kind, code), rows in selected.items():
        directory = f"subjects/{kind}/{code}"
        pages: dict[tuple[str, str, int], list[dict]] = {
            coordinate(identifier): [] for identifier in seeds[(kind, code)]
        }
        for row in rows:
            archived = {key: value for key, value in row.items() if key != "abstract"}
            pages.setdefault(coordinate(row["id"]), []).append(archived)
        by_year: dict[str, dict[str, dict[int, list[dict]]]] = {}
        for (year, day, page), page_rows in sorted(pages.items()):
            ordered = sorted(page_rows, key=lambda row: (row["id"], row["version"]))
            documents[f"{directory}/{day}/{page}.json"] = {
                "schema_version": 2,
                "day": day,
                "page": page,
                "entries": ordered,
            }
            by_year.setdefault(year, {}).setdefault(day, {})[page] = ordered
        years = []
        for year, days in sorted(by_year.items()):
            day_rows = []
            for day, day_pages in sorted(days.items()):
                numbers = sorted(day_pages)
                flat = [row for number in numbers for row in day_pages[number]]
                day_rows.append({
                    "day": day,
                    "first_page": numbers[0],
                    "last_page": numbers[-1],
                    "results": len({row["id"] for row in flat}),
                    "versions": len(flat),
                })
            documents[f"{directory}/{year}.json"] = {
                "schema_version": 2,
                "year": year,
                "page_path": f"{directory}/{{day}}/{{page}}.json",
                "days": day_rows,
            }
            years.append({
                "year": year,
                "days": len(day_rows),
                "results": sum(row["results"] for row in day_rows),
                "versions": sum(row["versions"] for row in day_rows),
            })
        documents[f"{directory}.json"] = {
            "schema_version": 2,
            "kind": kind,
            "code": code,
            "entries": rows[:SUBJECT_PAGE_ITEMS],
            "results": sum(row["results"] for row in years),
            "versions": sum(row["versions"] for row in years),
            "year_path": f"{directory}/{{year}}.json",
            "years": years,
        }
    return documents


SUBJECTS = subject_documents()


def search_terms(text: str) -> list[str]:
    decomposed = unicodedata.normalize("NFKD", text)
    folded = "".join(
        character for character in decomposed if unicodedata.category(character) != "Mn"
    ).lower()
    return [word for word in re.split(r"[^a-z0-9]+", folded) if 2 <= len(word) <= 32]


def search_index(entries: dict) -> dict[str, list[str]]:
    """One postings sequence per word, in registration order.

    Built here rather than copied from a published snapshot so that the browser
    suite exercises the walking and the validators against an index it can
    reason about, including a word that is on every result and a word that is
    on one.
    """
    postings: dict[str, list[str]] = {}
    for (identifier, version), record in sorted(entries.items()):
        texts = [record["title"], record["abstract"]]
        texts.extend(author["name"] for author in record["authors"])
        words = {
            word
            for text in texts
            for word in search_terms(text)
            if word not in SEARCH_STOPWORDS
        }
        for word in sorted(words):
            postings.setdefault(word, []).append(f"{identifier}-v{version}")
    return postings


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
# One record whose text carries no function word at all, which is exactly the
# case the published stopword list exists for: a query containing "the" has to
# find it anyway, and inferring stopwords from a missing head could not.
ENTRIES[("PALOMAR-2026-07-29-000124", 1)]["abstract"] = (
    "Quasicoherent sheaves, synthetically. Cacheprobe."
)
SEARCH_INDEX = search_index(ENTRIES)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_bytes(
        self,
        payload: bytes,
        content_type: str,
        cache_control: str = "no-store",
    ) -> None:
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", cache_control)
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:  # noqa: N802 - inherited HTTP method name
        path = self.path.split("?", 1)[0]
        clean_pages = {
            "/about": "/about.html",
            "/entry": "/entry.html",
            "/how-to-submit": "/how-to-submit.html",
            "/privacy": "/privacy.html",
            "/render": "/render.html",
            "/statement": "/statement.html",
            "/subject": "/subject.html",
        }
        if path in clean_pages:
            query = self.path[len(path) :]
            self.path = clean_pages[path] + query
            path = clean_pages[path]
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
                "coverage": {"freshness_max_age_seconds": 18 * 60 * 60},
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
        # What is new, which is what the landing page reads. There is no
        # whole-registry document to serve here any more, and serving one would
        # let a browser test pass against a surface the origin does not have.
        if path == "/database/recent.json":
            current = {}
            for item in ENTRIES.values():
                previous = current.get(item["id"])
                if previous is None or item["version"] > previous["version"]:
                    current[item["id"]] = item
            versions = collections.Counter(item["id"] for item in ENTRIES.values())
            rows = [recent_row(item, versions[item["id"]]) for item in current.values()]
            # Newest first, ties broken by identifier descending, exactly as
            # `selection.latest_entries` orders them in the publisher.
            rows.sort(key=lambda row: (row["published_at"], row["id"]), reverse=True)
            self.send_bytes(
                json.dumps({"schema_version": 2, "entries": rows}).encode(),
                "application/json",
            )
            return
        # One classification code: its front page, its year documents, and the
        # pages of its archive. Looked up rather than parsed, so a path this
        # fixture was never asked to write is a 404 and not a guess.
        if path.startswith("/database/subjects/"):
            document = SUBJECTS.get(path[len("/database/") :])
            if document is None:
                self.send_error(404)
                return
            self.send_bytes(json.dumps(document).encode(), "application/json")
            return
        # The render hashes of exactly the results on that page, which the
        # landing page reads only when a reader asks to see one. Built from the
        # same current selection, so the two cannot disagree here either.
        if path == "/database/recent-renders.json":
            current = {}
            for item in ENTRIES.values():
                previous = current.get(item["id"])
                if previous is None or item["version"] > previous["version"]:
                    current[item["id"]] = item
            rows = [
                {
                    "id": item["id"],
                    "version": item["version"],
                    "artifact_tree_sha256": item["challenge_render"][
                        "artifact_tree_sha256"
                    ],
                }
                for item in current.values()
            ]
            rows.sort(key=lambda row: row["id"])
            self.send_bytes(
                json.dumps({"schema_version": 2, "renders": rows}).encode(),
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
            rows = [
                {
                    "id": item["id"],
                    "version": item["version"],
                    "title": item["title"],
                    "status": "registered",
                    "path": f"entries/{item['id']}-v{item['version']}.json",
                }
                for item in ENTRIES.values()
                if item["id"] == identifier
            ]
            if not rows:
                self.send_error(404)
                return
            self.send_bytes(
                json.dumps({
                    "schema_version": 2,
                    "id": identifier,
                    "entries": sorted(rows, key=lambda row: row["version"]),
                }).encode(),
                "application/json",
            )
            return
        # The words the indexer drops, which is the one list there is: a fixed
        # editorial choice, so it is constant in size and is nothing like the
        # document naming every known word that this index exists without.
        if path == "/database/search/stopwords.json":
            self.send_bytes(
                json.dumps(
                    {"schema_version": 2, "stopwords": sorted(SEARCH_STOPWORDS)}
                ).encode(),
                "application/json",
            )
            return
        # One word's postings. There is no document naming the words, by
        # design, so an unknown word is a 404 and the browser has to be able to
        # tell that apart from a broken index.
        search = re.fullmatch(r"/database/search/t/([a-z0-9]{2,32})/(head|[0-9]{1,4})\.json", path)
        if search:
            term, leaf = search.group(1), search.group(2)
            rows = SEARCH_INDEX.get(term)
            if rows is None:
                self.send_error(404)
                return
            pages = [
                sorted(rows[start : start + SEARCH_PAGE_SIZE])
                for start in range(0, len(rows), SEARCH_PAGE_SIZE)
            ]
            if leaf == "head":
                payload = {
                    "schema_version": 2,
                    "term": term,
                    "page_size": SEARCH_PAGE_SIZE,
                    "pages": len(pages),
                    "results": len(rows),
                }
            elif int(leaf) < len(pages):
                payload = {
                    "schema_version": 2,
                    "term": term,
                    "page": int(leaf),
                    "postings": pages[int(leaf)],
                }
            else:
                self.send_error(404)
                return
            self.send_bytes(
                json.dumps(payload).encode(),
                "application/json",
                cache_control=(
                    "public, max-age=60" if term == "cacheprobe" else "no-store"
                ),
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
<style id="palomar-declaration-style">
/* The two colours a real bundle's palette binds for the frame's own canvas.
   PalomarSubmission injects the whole palette; only these reach a browser
   here, because what this fixture is for is the boundary: the frame reads
   prefers-color-scheme for itself, and has to land on the paper the page
   around it is drawn on. If PalomarWeb's --paper moves and this does not,
   the frame is a rectangle of the wrong colour and the spec says so. */
:root {{ color-scheme: light dark; --palomar-paper: #ffffff; --palomar-ink: #24292e; }}
@media (prefers-color-scheme: dark) {{
  :root {{ --palomar-paper: #101216; --palomar-ink: #e8eaee; }}
}}
html, body {{ background: var(--palomar-paper); color: var(--palomar-ink); }}
</style>
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
                "schema_version": 3,
                "imports": ["Mathlib"],
                "module_doc": "# Fixture module\n\nParsed outside the Verso renderer.",
                "declarations": ["Example.theorem"],
                "solution_imports": ["ExampleDependency"],
                "audit_declarations": [
                    {
                        "name": "Example.theorem",
                        "declaration": (
                            "theorem Example.theorem : Eq Nat.zero Nat.zero"
                        ),
                    }
                ],
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

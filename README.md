# Palomar Web

The read-only human view of
[`kim-em/PalomarDatabase`](https://github.com/kim-em/PalomarDatabase).

The site is static and deployed with GitHub Pages. It fetches `index.json` and
entry records directly from the database repository at runtime, so publishing a
database PR does not require a coordinated website deployment or a server.
Registry cards display arXiv and MSC2020 classifications, and the toolbar can
filter the current records by either taxonomy.

Local preview:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>. Override the database endpoint for a fixture
served from that development origin with `?database=/fixtures/index.json`. The
matching render tree is resolved beside the fixture by default; use
`&render-base=/fixtures/render-root/` to override it. These overrides are
honored only when the site itself runs on localhost or another loopback address.
The deployed site always reads the canonical database and render origins.

Entry pages embed a rendered Challenge when the comparator names exactly one
declaration and `Challenge.lean` is at most 100 lines and 32 KiB. Larger
Challenges link to a dedicated rendered view. The pinned GitHub source link is
always present. Rendered HTML is loaded in a fixed-height iframe with
`sandbox="allow-scripts"` (deliberately without `allow-same-origin`) and no
referrer.

The website is a presentation layer only. Permanent data and schemas live in
PalomarDatabase; consumers should use that repository directly. A versioned ID
such as `PALOMAR-2026-07-29-000001-v1` names one immutable record. An ID without
a version means the latest record; later versions may change its theorem,
source, authors, or subject, so stable citations must include the version.

## RSS

The static database deployment generates a main RSS feed and separate feeds for
every arXiv and MSC2020 classification represented by a current entry. The web
site advertises the main feed with RSS autodiscovery and links the relevant
category feeds from each entry page. Static hosting is sufficient because feed
XML is regenerated whenever the append-only database changes.

## Version presentation

Palomar uses integer versions and treats the greatest registered version of a
permanent ID as current. Registry cards show only that version and link to its
history when older snapshots exist.

An entry URL with both `id` and `version` identifies one immutable snapshot:

```text
https://kim-em.github.io/PalomarWeb/entry.html?id=PALOMAR-2026-07-29-000001&version=1
```

Its HTML canonical link points to that same official, explicit version,
including when a newer version exists or the site is viewed through a mirror or
local fixture. An `id`-only entry URL is a floating convenience link: the site
resolves it to the current version and replaces the browser URL with the
explicit snapshot URL.

Entry pages list all registered versions. Older pages display a prominent link
to the current version. Each page renders the selected version's own authorship,
statement, proof, trust information, review, and warnings; information is never
borrowed from a newer record. The site provides links, not computed diffs.
PalomarDatabase does not yet define change summaries, withdrawal states, or
major/minor versions, so the website does not infer them. If a richer version
scheme is adopted later, it will require a new URL contract; existing integer
snapshot URLs remain permanent.

This remains a runtime-JSON site: JavaScript is required for registry and entry
content. The static entry shell explains this and links to the immutable JSON
records for no-JavaScript readers.

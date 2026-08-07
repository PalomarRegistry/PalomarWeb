# Palomar Web

The read-only human view of Palomar's machine-readable public registry.

The site is static and deployed with GitHub Pages. It fetches the filtered
`index.json` and entry records from <https://data.palomar-registry.org/> at
runtime, so publishing a database change does not require a coordinated website
deployment.
Each render also loads the current source-availability manifest. When an
original pinned commit has been confirmed missing and the recorded archive is
available, source links automatically switch to the `PalomarArchive` copy while
still displaying the original location. Missing archives are shown as degraded,
and a stale or unavailable manifest never makes an unverified claim that a
source is missing.
Registry cards display arXiv and MSC2020 classifications, and the toolbar can
filter the current records by either taxonomy. The classification fields suggest
codes represented by current entries but also accept any exact code, so a deep
link such as `?arxiv=math.AG` produces a useful empty result even before that
classification has an entry.

Local preview:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>. Override the database endpoint for a fixture
served from that development origin with `?database=/fixtures/index.json`. The
matching render tree is resolved beside the fixture by default; use
`&render-base=/fixtures/render-root/` to override it. These overrides are
honored only when the site itself runs on localhost or another loopback address.
Use `&availability=/fixtures/source-availability.json` to supply a local health
manifest.
The deployed site always reads the canonical public-data and render origins;
it never reads the private canonical database repository directly.

Entry pages embed a rendered Challenge when the comparator names exactly one
declaration and the recorded Challenge source is at most 100 lines and 32 KiB. Larger
Challenges link to a dedicated rendered view. The pinned GitHub source link is
always present. Rendered HTML is loaded in a fixed-height iframe with
`sandbox="allow-scripts"` (deliberately without `allow-same-origin`) and no
referrer.

The website is a presentation layer only. Public data and schemas live at the
machine-readable data origin. A versioned ID
such as `PALOMAR-2026-07-29-000001-v1` names one immutable record. An ID without
a version means the latest record; later versions may change its theorem,
source, authors, or subject, so stable citations must include the version.

## RSS

The filtered public-data deployment generates a main RSS feed and separate feeds for
every arXiv and MSC2020 classification represented by a current entry. The web
site advertises the main feed with RSS autodiscovery and links the relevant
category feeds from each entry page. Static hosting is sufficient because feed
XML is regenerated whenever the append-only database changes.

## Version presentation

Palomar uses integer versions and treats the greatest active version of a
permanent ID as current. Registry cards show only that version and link to its
active history when older snapshots exist.

An entry URL with both `id` and `version` identifies one immutable snapshot:

```text
https://palomar-registry.org/entry.html?id=PALOMAR-2026-07-29-000001&version=1
```

Its HTML canonical link points to that same official, explicit version,
including when a newer version exists or the site is viewed through a mirror or
local fixture. An `id`-only entry URL is a floating convenience link: the site
resolves it to the current version and replaces the browser URL with the
explicit snapshot URL.

Entry pages list all active versions. Older pages display a prominent link
to the current version. Each page renders the selected version's own authorship,
statement, proof, trust information, review, and warnings; information is never
borrowed from a newer record. The site provides links, not computed diffs.
The registry does not define change summaries or major/minor versions, so the
website does not infer them. If a richer version
scheme is adopted later, it will require a new URL contract; existing integer
snapshot URLs remain permanent.

This remains a runtime-JSON site: JavaScript is required for registry and entry
content. The static entry shell explains this and links to the immutable JSON
records for no-JavaScript readers.

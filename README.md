# Palomar Web

The read-only human view of Palomar's machine-readable public registry.

The site is static and deployed with GitHub Pages. It reads
<https://data.palomar-registry.org/> at runtime, so publishing a database change
does not require a coordinated website deployment. There is no whole-registry
document there any more, and the pages are shaped by that: the landing page
reads `recent.json`, an entry page reads `versions/<id>.json` and then the one
record it wants, a search reads `search/stopwords.json` and a word's postings,
and a withdrawn version reads its tombstone. Fetching the index and filtering it
in a browser meant every visitor paid for the whole registry to see a couple of
hundred rows, and paid more every time somebody else published anything.

The landing page and entry pages also load the current source-availability
manifest. When an original pinned commit has been confirmed missing and the
recorded archive is not itself known to be missing, source links automatically
switch to the `PalomarArchive` copy while still displaying the original
location. Missing archives are shown as degraded, and a stale or unavailable
manifest is discarded rather than believed.
Registry cards display arXiv and MSC2020 classifications, and the toolbar can
filter the rows the landing page holds by either taxonomy. The classification
fields suggest codes represented by those rows but also accept any exact code,
so a deep link such as `?arxiv=math.AG` produces a useful empty result even
before that classification has an entry. The filter is over `recent.json`, which
is the newest 200 current versions and not the registry, so it narrows what is
on the page rather than searching everything; the search box does the latter,
a word at a time, over titles, abstracts and author names.
Search heads, posting pages and records load with bounded concurrency under one
30-second deadline. A failed page or record leaves already validated results
visible with an incomplete-search warning. Posting rows currently carry only a
versioned identifier, so search cards do not call that version current or show
a version-history count they cannot verify; landing cards get both facts from
`recent.json`.

Local preview:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>. Note that a bare static server reads live
production data: the overrides below are what point it somewhere else. The
browser suite needs a different server, `python3 tests/fixture_server.py` on
port 4173, which `playwright.config.js` starts for it.

`?database=` overrides the endpoint, and it is an endpoint rather than a
document: `?database=/fixtures/` names the directory every read surface is
resolved against. The matching render tree is resolved beside it by default; use
`&render-base=/fixtures/render-root/` to override it. These overrides are
honored only when the site itself runs on localhost or another loopback address.
Use `&availability=/fixtures/source-availability.json` to supply a local health
manifest.
The deployed site always reads the canonical public-data and render origins;
it never reads the private canonical database repository directly.

Entry pages embed a rendered Challenge when the comparator names exactly one
declaration and the recorded Challenge source is at most 100 lines and 32 KiB. Larger
Challenges link to a dedicated rendered view. The pinned GitHub source link is
always present. Rendered HTML is loaded in an iframe with
`sandbox="allow-scripts"` (deliberately without `allow-same-origin`) and no
referrer. The frame sizes itself from a height the document posts back, clamped
between 10rem and 42rem, so an untrusted render can ask for a sensible height
without being able to take the page over.

A record that arrives carrying review scores is refused rather than rendered.
The scores are not published and are not in the record; a served record that had
them would mean something upstream had gone wrong, and displaying it would be
the worst moment to find out.

The website is a presentation layer only. Public data and schemas live at the
machine-readable data origin. A versioned ID
such as `PALOMAR-2026-07-29-000001-v1` names one immutable record. An ID without
a version means the latest record; later versions may change its theorem,
source, authors, or subject, so stable citations must include the version.

## RSS

The filtered public-data deployment generates a main RSS feed and separate feeds
for every arXiv and MSC2020 classification represented by a current entry. The
landing page and entry pages advertise the main feed with RSS autodiscovery. An
entry page links its classifications to the filtered listing rather than to the
category feed; the feed links were removed when they were all 404, and they have
not been put back. Static hosting is sufficient because feed XML is regenerated
whenever the append-only database changes.

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
statement, proof, trust information, and review comments; information is never
borrowed from a newer record. The site provides links, not computed diffs.
The registry does not define change summaries or major/minor versions, so the
website does not infer them. If a richer version
scheme is adopted later, it will require a new URL contract; existing integer
snapshot URLs remain permanent.

This remains a runtime-JSON site: JavaScript is required for registry and entry
content. The static shells explain this and point a no-JavaScript reader at the
machine-readable data. Those links, and the footer's, still name the
whole-registry `index.json` that the data service no longer serves, so they
currently answer 404; they want to be `recent.json` on the landing page and
`entries/<id>-v<n>.json` on an entry page.

# Palomar Web

The read-only human view of Palomar's machine-readable public registry.

The site is static and deployed with GitHub Pages. It reads
<https://data.palomar-registry.org/> at runtime, so publishing a database change
does not require a coordinated website deployment. There is no whole-registry
document there any more, and the pages are shaped by that: the landing page
reads one self-contained `recent.json` projection, an entry page reads
`versions/<id>.json` and then the one record it wants, a search reads
`search/stopwords.json` and a word's postings, and a withdrawn version reads its
tombstone. Fetching the index and filtering it in a browser meant every visitor
paid for the whole registry to see a couple of hundred rows, and paid more every
time somebody else published anything.

The landing page and entry pages also load the current source-availability
manifest. When an original pinned commit has been confirmed missing and the
recorded archive is not itself known to be missing, source links automatically
switch to the `PalomarArchive` copy while still displaying the original
location. Missing archives are shown as degraded; the notice says the original
still works only when its own observation confirms that, and otherwise describes
the recorded original neutrally. The manifest and every known endpoint
observation independently have an inclusive eighteen-hour maximum age and
five-minute future-clock allowance. The producer declares that maximum in
`coverage.freshness_max_age_seconds`, and the browser rejects a document that
disagrees. An endpoint whose `checked_at` is missing, malformed, too far in the
future, or one second older is treated as unknown without discarding fresh
sibling rows; a stale or unavailable whole manifest is likewise never believed.
`last_attempt_at` may be null when the bounded producer has never attempted that
endpoint.
Registry cards display arXiv and MSC2020 classifications, and the toolbar can
filter the rows the landing page holds by either taxonomy. The classification
fields suggest codes represented by those rows but also accept any exact code,
so a deep link such as `?arxiv=math.AG` produces a useful empty result even
before that classification has an entry. The filter is over `recent.json`, which
is the newest 200 current versions and not the registry, so it narrows what is
on the page rather than searching everything; the search box does the latter,
a word at a time, over titles, abstracts and author names.
Search accepts at most 4,096 characters and 20 distinct normalized words. The
word limit is checked before the stopword list is loaded, so common words that
the index later drops still count. An over-limit linked or typed query is
rejected before any registry-data request or browser-history update. At most 20
search heads, 16 posting pages and 60 candidate records are then read with
concurrency at most eight under one 30-second deadline. Including the stopword
list and optional source-availability manifest, that is at most 98 dynamic data
requests per search; at most 20 results are displayed. A failed page or record
leaves already validated results visible with an incomplete-search warning. The
record loader advances as a bounded sliding window, keeps publisher order
however requests finish, and stops at the result limit with at most seven
speculative result groups. Multiple matching versions of one Palomar ID collapse
to the newest matching version in the bounded candidate set, so a result is not
repeated. A posting still says neither that a version is current nor how many
active versions exist, so search cards make neither claim; landing cards get
both facts from `recent.json`.
Each `recent.json` row is the exact landing-card projection built from a
validated canonical entry: identity, current/history count, registration time,
title, abstract, authors, classifications, theorem names, trust, source commit
and project path, and the source's preservation mapping. The browser validates
that complete closed shape and renders it directly. A normal landing load is
therefore exactly two dynamic data requests—`recent.json` and the optional
source-availability manifest—with no per-card entry reads. Invalid or partial
projections fail closed before any card is rendered.
This is one exact closed producer/consumer contract, not an extensible summary:
a shape change must be published by PalomarDatabase first and followed by the
matching website deployment. The consumer deliberately has no old-row fallback
or per-entry recovery path.
Landing and verified search cards render before the source-availability
manifest; if it arrives, their existing source controls are decorated in place.
A linked `?q=` search does not also load the hidden recent listing; clearing the
search starts one landing attempt, and a failed attempt can be retried.

The browser code keeps the data boundary separate from presentation:
`security.mjs` validates registry and availability documents and owns endpoint
freshness, `source-preservation.mjs` matches validated manifest observations to
the preservation receipt before resolving repository locations and decorating
existing cards, and `app.js` composes the page-level views.

Runtime reads use the browser's normal HTTP cache behavior. The public data
service gives successful documents a 60-second browser/shared-cache lifetime,
so repeat reads can be reused for that interval; missing and error responses are
not stored. A withdrawn object can consequently remain visible from an already
populated client or shared cache for at most 60 seconds.

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

The site accepts the sole current entry contract, `schema_version: 2`, and
requires its source-preservation receipt. The unused pre-launch v1 draft has no
browser fallback; an obsolete or malformed record fails closed.
The deployed data already contains only v2 entries and preservation-backed
recent projections. The pre-launch removal therefore deploys this Web cleanup
first, so its workflows stop fetching `schema-v1.json`; Database can then stop
publishing and serving that obsolete document without breaking Web deployment.
That ordering is gated by a complete public traversal: CI and Pages deployment
walk the browse hierarchy, reconcile every per-result version index, and run the
Web entry validator over every active permalink before an artifact is uploaded.
The hourly published-site check repeats it. This is intentionally O(A) in
active versions and is deployment/monitoring cost, not visitor page-load cost.

This cleanup does not renumber unrelated documents. `recent.json`, per-result
version indexes, browse/search projections, and source availability remain
their existing `schema_version: 1` protocols, as do independent render and
evidence metadata formats. Only the accepted-entry contract is v2-only.

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
bounded newest-results or browse documents on the machine-readable data origin.

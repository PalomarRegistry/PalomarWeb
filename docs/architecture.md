# Architecture and data contracts

Reference for the contracts this site consumes, the budgets it holds itself to,
and the order in which a contract change has to be deployed. The
[README](../README.md) covers what the site is and how to run it.

## Reading surfaces

Each page reads only what it shows, because fetching a whole index and filtering
it in the browser meant every visitor paid for the whole registry to see a couple
of hundred rows, and paid more every time somebody else published anything.

A normal landing load is exactly two dynamic data requests, `recent.json` and the
optional source-availability manifest, with no per-card entry reads. Each
`recent.json` row projects the fields a landing card needs from a canonical
entry: identity, current and history count, registration time, title, abstract,
authors, classifications, theorem names, trust, source commit and project path,
and the source's preservation mapping. The browser checks the envelope and the
fields it needs to render and link safely, and leaves schema policy such as
classification cardinality to PalomarDatabase. An unusable row is omitted with a
visible count while its valid siblings render; transport and unsupported-schema
failures still fail the page.

Runtime reads use the browser's normal HTTP cache behavior. The public data
service gives successful documents a 60-second browser and shared-cache lifetime,
so repeat reads can be reused for that interval, and missing and error responses
are not stored. A withdrawn object can therefore remain visible from an already
populated cache for at most 60 seconds.

### The browse hierarchy

`browse/index.json`, `browse/<year>.json` and `browse/<day>/<page>.json` are an
exact, closed contract owned by PalomarDatabase and consumed here. The head
declares years and aggregate counts, each year declares its days and page ranges,
and each page carries exact entry-history rows. Changes to any of those three
shapes are producer-first contract changes, even though these documents stay at
`schema_version: 1`.

### Subject pages

A subject page reads `subjects/<kind>/<code>.json` and the day-paged archive
behind it, so it answers for the whole registry rather than for whatever one page
happens to hold. The front page is the newest 50 current versions under the code,
and "Show earlier results" walks the archive newest first, one day at a time,
skipping days it has already shown.

A page range is inclusive of its ends and not of everything between them, because
a code's pages are seeded by the results ever classified under it. An absent page
inside a range is read as empty, and each day is reconciled against the counts it
declares. A code the registry has ever used keeps answering after its last
classifier is superseded, so an empty page is an answer rather than a 404.

## Search budget

Search runs over titles, abstracts and author names, a word at a time, and
accepts at most 4,096 characters and 20 distinct normalized words. The word limit
is checked before the stopword list is loaded, so common words the index later
drops still count, and an over-limit query, typed or linked, is rejected before
any registry-data request or browser-history update.

At most 20 search heads, 16 posting pages and 60 candidate records are then read,
with concurrency at most eight, under one 30-second deadline. Including the
stopword list and the optional availability manifest, that is at most 98 dynamic
data requests per search. At most 20 results are displayed.

A failed page or record leaves already validated results visible with an
incomplete-search warning. The record loader advances as a bounded sliding
window, keeps publisher order however the requests finish, and stops at the
result limit with at most seven speculative result groups. Multiple matching
versions of one Palomar ID collapse to the newest matching version in the bounded
candidate set, so a result is not repeated.

A posting says neither that a version is current nor how many active versions
exist, so search results make neither claim. Landing rows get both facts from
`recent.json`.

The landing filters run over `recent.json`, which is the newest 200 current
versions rather than the registry, so they narrow what is on the page instead of
searching everything. A date range reaching back before the oldest row says so
rather than answering for days the page does not hold.

## Source availability

The landing page and entry pages load the current source-availability manifest.
When an original pinned commit has been confirmed missing and the recorded
archive is not itself known to be missing, source links switch to the
`PalomarArchive` copy while still displaying the original location. Missing
archives are shown as degraded. The notice says the original still works only
when its own observation confirms that, and otherwise describes the recorded
original neutrally.

### Freshness

The manifest and every known endpoint observation independently have an inclusive
eighteen-hour maximum age and a five-minute future-clock allowance. The producer
declares that maximum in `coverage.freshness_max_age_seconds`, and the browser
rejects a document that disagrees. An endpoint whose `checked_at` is missing,
malformed, too far in the future, or one second older is treated as unknown
without discarding fresh sibling rows, and a stale or unavailable whole manifest
is never believed. `last_attempt_at` may be null when the bounded producer has
never attempted that endpoint.

### Attempts and caching

Verified content and its recorded source links render immediately; a validated
availability result then updates only those source controls, in place. Each
active entry or named-declarations page makes exactly one availability attempt,
and an unknown or withdrawn record makes none. Landing and search consumers share
one in-flight or settled read, and each attempt has one 30-second deadline.

A 404 is a stable page-scoped absence. A timeout, transport failure or invalid
document is evicted instead, so a later explicit consumer attempt can issue one
retry.

A linked `?q=` search does not also load the hidden recent listing. Clearing the
search starts one landing attempt, and a failed attempt can be retried.

### Cost of decoration

Validation builds a private lookup for the `R` availability rows, and source
presentation builds one private lookup for each registered record's preservation
rows, `D` rows in total across the page. Decorating a page's source controls is
therefore `O(R + D)` work with constant-time repository and revision lookups
afterward, rather than a rescan of both arrays for every dependency.

These lookups and the exact fields they consume are captured in private `WeakMap`
receipts at successful validation, so later mutation cannot change validated
presentation data. They do not alter the public JSON and are available only to
documents that passed the current validators.

## Render metadata

Render-metadata schema v3 carries an `audit_declarations` row for every compared
declaration, in the same order as `declarations`. Each row has exactly `name` and
`declaration`, and the browser refuses a v3 document whose rows do not correspond
to the accepted entry. Historical v1 and v2 render metadata remains readable but
does not claim to provide an audit view.

The audit view closes author-defined notation and macro spoofing. It does not
expose misleading instances, inserted coercions, or definitions whose names hide
the wrong meaning. If Lean reaches a pretty-printer resource limit it marks the
omitted subterm with an ellipsis rather than silently inventing text.

A render-metadata version widening deploys Web first, and the Submission producer
may emit the new version only once that consumer is live. This is the reverse of
a closed projection's producer-first shape replacement, because the existing Web
consumer rejects a version it does not know.
`check-published.mjs --data` reads and validates every available render metadata
document in the advertised entry traversal before deployment.

## Entry contract and the review-language cutover

The site accepts the sole current entry contract, `schema_version: 3`, and
requires its source-preservation receipt. Superseded pre-launch drafts have no
browser fallback, and an obsolete or malformed record fails closed.

The review-language cutover deploys this strict consumer together with the
schema-v3 producer and rewritten public data. It does not infer an endorsement
from a legacy positive review value. It also moves `recent.json`, per-result
version indexes, and the browse, subject and search projections to schema
version 2. Source availability and the independent render and evidence metadata
keep their own versioned contracts. Only the registered-entry contract is
v3-only.

That ordering is gated by a complete traversal of what the producer advertises.
CI and Pages deployment walk the browse hierarchy, reconcile every advertised row
with its per-result version index, and run the Web entry validator over each
advertised active permalink before an artifact is uploaded. This catches drift
between those public surfaces; it is not an independent proof that the producer
omitted no row from all of them.

The hourly published-site check repeats it. That is intentionally `O(A)` in
active versions, and is deployment and monitoring cost rather than visitor
page-load cost. It uses at most eight concurrent reads, each read gets at most
three five-second attempts with short backoff, the hourly job has a fifteen-minute
ceiling, and a new observation supersedes an older queued or stuck one.

## RSS

The filtered public-data deployment generates a main RSS feed and separate feeds
for every arXiv and MSC2020 classification represented by a current entry. The
landing page and entry pages advertise the main feed with RSS autodiscovery.

A classification links to its subject page rather than to its category feed. The
feed links were removed when they were all 404, and they have not been put back
because nothing here has confirmed that they resolve. Static hosting is
sufficient because feed XML is regenerated whenever the append-only database
changes.

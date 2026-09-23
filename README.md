# Palomar Web

The read-only human view of Palomar's machine-readable public registry. The site
is static, deployed with GitHub Pages, and reads
<https://data.palomar-registry.org/> at runtime, so publishing a database change
needs no coordinated website deployment.

There is no whole-registry document to fetch. Each page reads only what it
shows: the landing page reads one `recent.json` projection, an entry page reads
`versions/<id>.json` and then the one record it wants, a search reads
`search/stopwords.json` and a word's postings. The machine-facing map of this
origin is [`/llms.txt`](https://palomar-registry.org/llms.txt).

JavaScript is required for registry and entry content. The static shells say so
and point a reader without it at the bounded newest-results or browse documents
on the data origin.

## Quickstart

```bash
npm install

# The tests read schema-v3.json and tests/fixtures/recent.json out of a
# PalomarDatabase checkout, found at $PALOMAR_DATABASE_CHECKOUT or at a sibling
# ../PalomarDatabase/. An unavailable contract is a hard failure rather than a
# skip, deliberately: these tests exist to show that this repository's
# validators agree with the Database outputs they read, and a version of them
# that quietly does nothing agrees with everything. Check this first.
npm test                 # node:test, unit and appearance suites
npm run test:browser     # Playwright, starts its own fixture server on 4173

# The asset version is required: it is what the build stamps onto every asset
# URL, so a deployment cannot serve a stale one from a cache. CI passes the
# commit SHA. Any short token works locally.
npm run build -- --version dev --output .site
```

To preview by hand:

```bash
python -m http.server 8000   # then open http://localhost:8000
```

A bare static server reads live production data. The overrides below are what
point it somewhere else, and they are honored only when the site itself is on
localhost or another loopback address. The deployed site always reads the
canonical public-data and render origins, and never the private database
repository.

| Parameter | Names | Example |
| --- | --- | --- |
| `?database=` | the endpoint every read surface resolves against, not a document | `?database=/fixtures/` |
| `&render-base=` | the render tree, which otherwise resolves beside the database | `&render-base=/fixtures/render-root/` |
| `&availability=` | a local source-availability manifest | `&availability=/fixtures/source-availability.json` |
| `&view=` | `table` or `cards` for the registry listing and the search results | `&view=cards` |

On NixOS, if Playwright's bundled Chromium cannot launch, see
[AGENTS.md](AGENTS.md) for the Nixpkgs browser invocation.

## What is where

The data boundary is kept separate from presentation.

| Module | Owns |
| --- | --- |
| `security.mjs` | validates registry and availability documents, endpoint freshness, private indexes of validated availability rows |
| `registry-loading.mjs` | endpoint composition, JSON transport, the page-scoped availability cache, recent/history/record/tombstone loading |
| `source-preservation.mjs` | preservation receipts, manifest matching, repository locations, decoration of existing source controls |
| `searching.mjs` | the bounded walk over search heads, posting pages and candidate records |
| `entry-pages.mjs` | entry-route input and page-state transitions |
| `entry-history-presentation.mjs` | canonical link, supersession notice, immutable version history |
| `formalization-presentation.mjs` | statement trust labels, statement and proof dependency presentation |
| `challenge-presentation.mjs` | artifact correspondence, source and playground controls, the audit disclosure |
| `statement-preview.mjs` | the hover preview raised from a result title |
| `registry-dates.mjs` | the two dates a result has, and the order and window a listing applies to them |
| `subject-pages.mjs` | subject routes and the day-paged archive walk behind them |
| `app.js` | the remaining page-level views |

Deeper contracts, request budgets, freshness rules and schema-version ordering
are in [docs/architecture.md](docs/architecture.md).

## Rendered statements

An entry page embeds a rendered Challenge when the comparator names exactly one
declaration and the recorded Challenge source is at most 100 lines and 32 KiB.
Larger Challenges link to a dedicated rendered view, and the pinned GitHub
source link is always present.

Rendered HTML loads in an iframe with `sandbox="allow-scripts"`, deliberately
without `allow-same-origin`, and no referrer. The frame sizes itself from a
height the document posts back, clamped between 160 and 672 pixels, so an
untrusted render can ask for a sensible height without taking the page over.

Resting the pointer on a result's title raises the same rendering in the same
kind of frame, clamped between 120 and 420 pixels, so a formal statement can be
read without leaving the list. The preview is pointer-only: on a keyboard or a
touch screen the result's own links remain the way to the statement. It frames
the immutable artifact at its published content address and does not repeat the
entry page's check that the render's declarations match the registered record,
so the entry page remains where a rendering is tied to its entry.

The frame follows the browser's light and dark preference without anything
crossing the origin boundary. A media query is answered by whichever browser
lays the document out, and that is the same browser either side of the frame, so
the render bundle carries its own palette. Renders published before that palette
existed are immutable and stay light, because a bundle's bytes are what its
recorded hash is of.

## Versions and citation

Palomar uses integer versions and treats the greatest active version of a
permanent ID as current. An entry URL carrying both `id` and `version` names one
immutable snapshot:

```text
https://palomar-registry.org/entry?id={permanent-ID}&version={integer-version}
```

An `id` without a version is a floating convenience link: the site resolves it to
the current version and replaces the browser URL with the explicit snapshot URL.
Later versions may change a result's theorem, source, authors or subject, so a
stable citation must include the version. The HTML canonical link always points
at the explicit version, including when a newer one exists and when the page is
read through a mirror or a local fixture.

Entry pages list all active versions, and an older page links prominently to the
current one. Each page renders its own version's authorship, statement, proof,
trust information and review comments; nothing is borrowed from a newer record.
The site provides links, not computed diffs. The registry defines no change
summaries and no major or minor versions, so the website infers none.

The website is a presentation layer only. Public data and schemas live at the
machine-readable data origin, and a record arriving with review scores is refused
rather than rendered: the scores are not published and are not in the record, so
a served record carrying them would mean something upstream had gone wrong.

## More

- [docs/architecture.md](docs/architecture.md), the data contracts and budgets
- [AGENTS.md](AGENTS.md), notes for working in this repository
- [`/llms.txt`](https://palomar-registry.org/llms.txt), the machine map

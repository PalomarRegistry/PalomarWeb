# Agent notes

- This repository is commonly developed on NixOS. If Playwright's bundled
  Chromium fails to launch because a shared library such as
  `libglib-2.0.so.0` is unavailable, do not leave the browser suite unrun. Use
  the Nixpkgs browser instead:

  ```sh
  nix shell nixpkgs#chromium -c bash -lc \
    'export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$(command -v chromium); npm run test:browser'
  ```

- `npm test` reads `schema-v2.json` and `tests/fixtures/recent.json` out of a
  PalomarDatabase checkout, from
  `PALOMAR_DATABASE_CHECKOUT` or a sibling `../PalomarDatabase/`. An
  unavailable contract is a failure rather than a skip, deliberately: the point
  of the tests is that this repository's validators agree with the Database
  outputs they read, and a version of those tests which quietly does nothing
  agrees with everything. Without a checkout you get hard failures and no hint
  why, so this is the first thing to check.

- `recent.json` is an exact closed producer/consumer contract. Shape changes
  require a coordinated producer-first deployment from PalomarDatabase before
  the matching Web deployment. Do not add an old-shape or per-entry fallback;
  invalid projections are supposed to fail closed.

- The subject surfaces—`subjects/<kind>/<code>.json`, its `<year>.json`, and its
  `<day>/<page>.json`—are the same closed contract, and are the same document
  family as browsing: PalomarDatabase writes both from
  `day_pages.write_collection`, so `security.mjs` reads their year and page
  levels with one shared validator and one shared schema constant. A subject row
  carries the classification and the registration instant on top of the index
  row, and both are checked: a row whose classification omits the code being
  asked for is a result under a heading it has nothing to do with, which is the
  one failure a well-formed row can still be. `check-published.mjs` validates
  the front page of every code the newest rows carry, bounded by the
  classification vocabulary rather than by the registry.

- The three browse surfaces—`browse/index.json`, `browse/<year>.json`, and
  `browse/<day>/<page>.json`—are also exact closed producer/consumer contracts.
  PalomarDatabase owns their head, year, page, count, and summary-row shapes;
  change those producer-first. A head and a year each publish the path of the
  level below as a template, `year_path` and `page_path`, for readers who have
  the document and not the grammar; a subject's are its own code's, because
  both collections derive them from the directory being written. This consumer
  has the grammar and requires the templates to equal it exactly. It never
  expands one to build a request: a template read as instructions is a path the
  data origin chooses. CI downloads one live head/year/page chain into
  the named producer-contract fixture test, then the predeploy check traverses
  every row the producer advertises. The traversal reconciles those surfaces;
  it cannot independently prove that their common producer omitted nothing.

- Entry records have one contract: `schema_version: 2` in `schema-v2.json`.
  Version 1 was an unused pre-launch draft; do not restore its validator,
  preservation fallback, public schema download, or legacy presentation.
  Deploy this consumer cleanup before the matching Database deletion: the live
  data already contains only v2 entries and preservation-backed recent rows,
  while the previous Web workflows still fetch `schema-v1.json` and would fail
  as soon as Database publication removed it. This consumer-first ordering is
  specific to deleting an artifact an old consumer still requests; shape
  changes to documents the browser reads remain producer-first as above.
  The consumer-first claim must be proved by `check-published.mjs --data`, which
  traverses every advertised browse page and per-ID version index and validates
  every advertised active entry before Pages artifact upload. A recent-only
  sample is not enough.
  `recent.json`, versions, browse/search, source availability, and independent
  render/evidence metadata intentionally retain their schema-v1 protocols;
  entry-schema cleanup must not rewrite them.

- `source-availability.json` is normalized by PalomarDatabase's executable
  source-availability contract and consumed under the same per-endpoint
  freshness rules here. A known answer is authoritative only from five minutes
  in the future through eighteen hours old, inclusively; malformed or older
  observations become unknown without hiding valid siblings. Contract changes
  are deployed producer-first and the cross-repository unit test is mandatory.
  With a canonical Database checkout the test invokes its executable contract;
  CI cannot read that private checkout, so it downloads the deployed object and
  requires the producer's declared freshness maximum to equal the consumer's.

- Keep availability parsing and endpoint-freshness authority in
  `assets/security.mjs`. It builds the private, non-serializing availability
  index only while accepting a validated document; lookup must refuse a raw
  object rather than scan its repositories. Both availability freshness and
  the fields lookup consumes are captured by value at validation, not reread
  from a mutable public row. `assets/source-preservation.mjs` consumes the
  private receipt index captured by the entry or recent validator, matches
  manifest observations, and owns repository resolution plus in-place card
  decoration.
  These indexes keep total source-decoration work `O(R + D)` for `R` manifest
  rows and `D` preservation rows; do not restore a scan for each dependency.
  `rendering.js` deliberately re-derives the single Challenge source mapping
  from the accepted receipt as an independent URL check; its `O(D)` scan runs a
  fixed number of times per page, not once per dependency, and remains inside
  the stated total bound;
  `assets/entry-pages.mjs` owns entry-route parameter validation, progressive
  visibility, immutable-URL replacement, fragment scrolling, tombstone
  dispatch, and route-level errors. `assets/challenge-presentation.mjs` owns the
  named-declarations render metadata's correspondence to the accepted entry,
  its source/dependency controls, inline-versus-wrapper presentation, iframe
  sandbox/height handling, and the missing-artifact fallback.
  `assets/formalization-presentation.mjs` owns statement trust labels plus the
  statement and accepted-proof dependency DOM, while continuing to consume
  source locations and confined URLs from their existing owners;
  `assets/entry-history-presentation.mjs` owns the entry page's canonical link,
  supersession notice, and immutable version-history section, while consuming
  validated records and the existing confined local-entry URL builder;
  `assets/subject-pages.mjs` owns the subject route's parameter validation,
  progressive visibility, route-level errors, and the archive walk's position,
  while `app.js` composes the heading and the rows and `security.mjs` keeps
  validation. The walk is bounded per click and holds no directory of pages:
  nothing published names every page of a code, deliberately, because such a
  document would be rewritten whenever the code changed;
  `assets/registry-loading.mjs` composes the selected endpoints, JSON
  transport, the one bounded page-scoped source-availability cache/retry
  policy, and exact recent/version/entry/tombstone reads without taking
  validation or route ownership. Entry and render content must consume that
  availability result progressively through `source-preservation.mjs`; an
  ancillary health request must never delay a verified record or render;
  `assets/statement-preview.mjs` owns the listing grids' hover preview: pointer
  intent and its delays, panel placement and lifetime, and resolving a card to
  its rendering from either a whole record or the bounded companion document.
  It consumes the confined artifact URL and the disposable sandboxed frame from
  their owners and must not acquire its own; `challenge-presentation.mjs` still
  owns the frame, and a surface that mounts and discards frames must dispose
  them, because the height listener is on `window` rather than on the frame.
  The preview is deliberately pointer-only and deliberately does not repeat the
  entry page's render-metadata correspondence check; it is a preview of an
  immutable artifact at a content address, and the entry page remains where a
  rendering is tied to its accepted record.
  `assets/app.js` owns remaining page composition and controller wiring. Do not
  duplicate registry-document validation, source resolution, or route
  orchestration across those modules; the route module still rejects malformed
  URL identifiers before asking the document loader to do any work.

- The browser suite needs `python3` on `PATH`, for the fixture server. Two of
  its tests want `PALOMAR_PREVIOUS_REF` and skip silently without it, which only
  CI sets.

- The hourly published-site health job imports `shippedFiles` from
  `scripts/build-site.mjs` without running `npm ci`. Keep build-only packages,
  including the module lexer, behind lazy imports so this metadata-only path
  remains dependency-free. The subprocess regression deliberately rejects npm
  package resolution while importing that module; do not weaken it by adding
  an install step to the health job.

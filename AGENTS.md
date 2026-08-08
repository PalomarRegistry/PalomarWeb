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

- The three browse surfaces—`browse/index.json`, `browse/<year>.json`, and
  `browse/<day>/<page>.json`—are also exact closed producer/consumer contracts.
  PalomarDatabase owns their head, year, page, count, and summary-row shapes;
  change those producer-first. CI downloads one live head/year/page chain into
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
  `assets/security.mjs`. `assets/source-preservation.mjs` consumes that
  validated contract, matches manifest observations to preservation-receipt
  mappings, and owns repository resolution plus in-place card decoration;
  `assets/entry-pages.mjs` owns entry-route parameter validation, progressive
  visibility, immutable-URL replacement, fragment scrolling, tombstone
  dispatch, and route-level errors. `assets/challenge-presentation.mjs` owns the
  named-declarations render metadata's correspondence to the accepted entry,
  its source/dependency controls, inline-versus-wrapper presentation, iframe
  sandbox/height handling, and the missing-artifact fallback.
  `assets/formalization-presentation.mjs` owns statement trust labels plus the
  statement and accepted-proof dependency DOM, while continuing to consume
  source locations and confined URLs from their existing owners;
  `assets/entry-history-presentation.mjs` owns canonical entry links,
  supersession notices, and the immutable version-history DOM, while consuming
  validated records and the existing confined local-entry URL builder;
  `assets/app.js` owns data loading and remaining page composition. Do not
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

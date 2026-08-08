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
  `assets/app.js` owns page composition. Do not duplicate validation across
  those modules.

- The browser suite needs `python3` on `PATH`, for the fixture server. Two of
  its tests want `PALOMAR_PREVIOUS_REF` and skip silently without it, which only
  CI sets.

- The hourly published-site health job imports `shippedFiles` from
  `scripts/build-site.mjs` without running `npm ci`. Keep build-only packages,
  including the module lexer, behind lazy imports so this metadata-only path
  remains dependency-free. The subprocess regression deliberately rejects npm
  package resolution while importing that module; do not weaken it by adding
  an install step to the health job.

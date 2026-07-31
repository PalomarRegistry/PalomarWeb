# Palomar Web

The read-only human view of
[`kim-em/PalomarDatabase`](https://github.com/kim-em/PalomarDatabase).

The site is static and deployed with GitHub Pages. It fetches `index.json` and
entry records directly from the database repository at runtime, so publishing a
database PR does not require a coordinated website deployment or a server.

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
such as `PALOMAR-000001-v1` names one immutable record. An ID without a version
means the latest record; later versions may change its theorem, source, authors,
or subject, so stable citations must include the version.

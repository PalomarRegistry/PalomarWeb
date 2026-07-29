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

Then open <http://localhost:8000>. Override the database endpoint for a local
fixture by adding `?database=https://example.test/index.json`.

The website is a presentation layer only. Permanent data and schemas live in
PalomarDatabase; consumers should use that repository directly.

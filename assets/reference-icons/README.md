# Reference site icons

These are locally bundled site icons, displayed beside the site's text label.
The original PNG, ICO, and SVG files are preserved without visual changes.

| File | Source |
| --- | --- |
| arxiv.png | https://arxiv.org/static/browse/0.3.4/images/icons/favicon-32x32.png |
| doi.png | https://www.doi.org/images/favicons/favicon-32x32.png |
| hexagon.svg | https://hexagonmath.org/favicon-neutral.svg |
| afp.ico | https://isa-afp.org/images/favicon.ico |
| mathoverflow.ico | https://mathoverflow.net/Content/Sites/mathoverflow/Img/favicon.ico |
| oeis.ico | https://oeis.org/favicon.ico |
| proofatlas.svg | https://www.proofatlas.ai/assets/favicon.svg |
| eudml.ico | https://eudml.org/assets/images/favicon.ico |
| erdosproblems.png | User-supplied Erdős Problems image, 2026-10-07 |
| euclid.png | User-supplied Project Euclid image, 2026-10-07 |
| zbmath.ico | User-supplied zbMATH icon, 2026-10-07 |

`assets/bibliography.mjs` selects icons from its fixed site table. The deployment
build copies each image through its explicit asset list in
`scripts/build-site.mjs`.

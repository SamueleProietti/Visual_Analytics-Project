# Report

`report.tex` — the project report, IEEE two-column conference format.

## Before submitting

- Check the access date on reference [2] (the EuRepoC dashboard) if you compile much
  later than September 2026.

## Compiling

**Overleaf** — upload `report.tex` and the `docs/img/` folder, keeping the relative
layout (`report.tex` expects the images one level up, in `../img/`). Set `report.tex` as
the main document and compile with pdfLaTeX. The bibliography is written inline with
`thebibliography`, so no BibTeX run is needed.

**Locally**, from this folder with a TeX distribution installed:

```
pdflatex report.tex
pdflatex report.tex
```

Twice, so the cross-references to figures and tables resolve.

## Length

Measured at roughly 4.5 of the 5 pages the rules allow: about 3,100 words, two figures
(one full width), one table and ten references. If a change pushes it over five pages,
the cheapest cut is Fig. 2 (Ukraine against Russia), whose numbers are all in the text.

## What it contains, against the exam requirements

| Requirement | Where |
|---|---|
| Related work, with the differences stated | Section II, and II-E for the differentiation |
| Data and the AS index | Section III |
| Visualizations and dimensionality reduction | Sections III-D and IV |
| Analytics | Section V |
| Coordinated views | Section IV |
| How the analytics is triggered visually | Section V, opening paragraph |
| Insights | Section VI, from `docs/insights.md` |
| Intended user | Section I |

Every figure in the report is one of the screenshots in `../img/`, and every number is
reproducible with `scripts/07_insights.py` or the four verification suites.

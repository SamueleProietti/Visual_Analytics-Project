# Presentation

`Threat-Shape.pptx` — 17 slides, 16:9, with speaker notes on every slide.

## What it covers, and what it deliberately does not

The rules ask the deck to describe the goal, the data structure and the chosen
visualizations, and say the user interaction belongs to the live demo instead. So the
deck ends on what the demo will show, and no slide walks through gestures.

| Slides | Content |
|---|---|
| 1–2 | The question: counting answers how much, never what kind. Intended user |
| 3–4 | The data, the AS index, and the standardize → PCA → t-SNE pipeline |
| 5 | The four coordinated views in one screenshot |
| 6–9 | One slide per view, with its encodings and the reason for each |
| 10–11 | The three analytics, their thresholds and refusals; the local re-projection |
| 12–14 | Three of the five insights from `docs/insights.md` |
| 15 | The verification suites and what they caught |
| 16–17 | Limitations, and what the demo will show |

## How it was made

Generated with `pptxgenjs` from the screenshots in `../img/`, cropped to single views.
The palette is the application's own — indigo chrome, the divergent red and blue of the
contrast panel, the green of the projection's intensity ramp — so the deck and the live
demo read as one thing.

Every figure is a real screenshot of the tool and every number is reproducible with
`scripts/07_insights.py` or the four verification suites.

## Before presenting

- Open it once in PowerPoint on the machine you will present from: the deck uses Cambria
  and Calibri, both shipped with Office, but a different machine may substitute them.
- The speaker notes carry the argument for each slide, not a script to read out.

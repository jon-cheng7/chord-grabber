# Training the style reharm

Pick a style, and the whole song is reharmonised in it. Each reharm is scored four ways:

- **style**: how natural each chord move is in that style, learned from real songs
- **distinct**: how much likelier each move is in that style than in all styles together. Without it every style drifts to I–IV–V, which is common to all and so reads as none
- **melody**: how well each chord suits what's sung over it, from your melody takes
- **faithful**: how much of the original each chord keeps

Four weights decide how much each counts. Training is two loops: the songs teach the style, and your ears set the weights.

## Once: the style tables

1. Download Chordonomicon's `chordonomicon_v2.csv` (264 MB) from
   https://huggingface.co/datasets/ailsntua/Chordonomicon into `data/`.
   It's CC BY-NC 4.0: fine for a non-commercial site, credited in the generated file.
2. `npm run corpus`

This writes `src/engine/style-data.ts`, the tables the app ships, and `data/heldout.json`, a fifth of the songs kept out for judging. Rerun it whenever the styles in `src/engine/styles.ts` change.

## Any time: your ears

On the dev server (`npm run dev`), open a song:

- **◆ STYLE** (bottom left): pick a style and how far it may stray. Two reharms of one passage, A and B: play each, answer "sounds better" and "more like the style". The next pair comes up on its own. **USE** writes one into the sheet.
- **● MELODY** (bottom right): press play and sing along, pause to finish. Nothing to answer.

Every so often, **EXPORT PICKS** into `data/prefs/` and **EXPORT** takes into `takes/`. Repeats across exports are fine.

## Then: tune and check

```
npm run evaluate
npm run tune
npm run tune -- --write
npm run evaluate
```

- **evaluate** scores every style on the same held-out songs and your takes, saves the run to `data/results/`, and shows the change since the last run.
- **tune** fits the weights to your picks and says how often they agree with you, before and after. `--write` keeps them.

A good change raises "reads as style" without the melody fit dropping.

## What the numbers mean

| | |
|---|---|
| judge knows | how often the judge names a song's own style right: the ceiling for "reads as style". Pop, rock and country share most of their chords, so expect it low there |
| reads as style | share of songs a judge, built from songs the tables never saw, names as that style. Before → after |
| distinct | per chord, how much more the style likes its moves than all styles do. Above 0 leans into the style |
| faithful | 1 is the original kept whole |
| changed | share of chords changed |
| melody fit | −0.5 is all clashes, 1 all chord notes. Before → after |
| agree with you | share of your picks the weights would make too |
| tables agree with your ear | how often the higher style score is the one you heard as more styled. Low means the tables, not the weights, need work |

Around 100 picks starts to steady the weights; a few hundred across several songs and styles is better.

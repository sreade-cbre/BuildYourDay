# Time Tower

A local, single-user, 3D time blocking app. One day is one tower. Each block of
time is a box whose height matches its duration, stacked from the ground up in
time order, with free time shown as hollow wireframe. The full design lives in
[`TIME_TOWER_SPEC.md`](TIME_TOWER_SPEC.md), and calls made along the way are in
[`DECISIONS.md`](DECISIONS.md).

## Status

| Milestone | Scope | State |
|---|---|---|
| M1 | Static tower: scene, sample day, labels, camera, totals | Done |
| M2 | Editing, persistence, settings, list view, dark theme | Not started |
| M3 | First build animation | Not started |
| M4 | Stacked builds and the other jobs | Not started |
| M5 | Living tower: now ring, weathering, idle orbit | Not started |

## Requirements

- Node 20.19 or later (Vite 8 needs it).
- A current Chrome, Edge, Safari, or Firefox with WebGL2.

## Run it

```sh
npm install
npm run dev
```

Then open http://localhost:5173. In development the app opens on today's date
with the sample day from spec section 20.

| Script | What it does |
|---|---|
| `npm run dev` | Starts the Vite dev server. |
| `npm run build` | Type checks, then builds a static site into `dist/`. |
| `npm run preview` | Serves the built site. |
| `npm test` | Runs the unit tests once. |
| `npm run test:watch` | Runs the unit tests on every change. |
| `npm run typecheck` | Type checks without building. |

The build has no network calls and no web fonts, so it works offline.

## Using it

- Drag on the scene to orbit the tower. The camera stays between 45 degrees
  and about 5 degrees above the horizon.
- Scroll to zoom.
- The top bar shows the date and how much of the day is stacked and free.

Editing, settings, and keyboard shortcuts arrive with M2; this section will
cover them then.

## Project layout

```
src/
  brand/tokens.ts   the only file allowed to contain hex colors
  core/             pure logic: model, time, layout, store, rng (no three, no DOM)
  scene/            three.js scene: SceneRoot, Ground, Tower, blocks, gaps, labels
  ui/               HTML overlay
  anim/             easing now; timelines and jobs from M3
tests/              Vitest unit tests for core logic and brand rules
```

## Brand rules

Colors come only from the Turner & Townsend tokens in `src/brand/tokens.ts`,
mirrored as CSS custom properties in `src/styles.css`. Headings use Georgia and
everything else uses Verdana. `tests/brand.test.ts` fails if a hex color appears
anywhere else in `src/`, if the CSS drifts from the tokens, or if an em dash or
en dash appears in the repo.

## Manual visual checklist

From spec section 22.2. Run through it before closing a milestone.

- Heights proportional across all slot sizes.
- Labels readable and non-overlapping on a 48 block day.
- Build sequence correct for 5 min, 60 min, and 3 hour blocks.
- Demolition rubble lands on the block below, not inside it.
- Crane cable never detaches from the hook.
- Workers never walk through the tower.
- Dark theme has no unreadable text.
- Strict palette: screenshot a build mid-phase and confirm every visible color
  is in section 5.1 or 5.2.

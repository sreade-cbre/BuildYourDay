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
| M2 | Editing, persistence, settings, list view, dark theme | Done |
| M3 | First build animation | Done |
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

Then open http://localhost:5173. The app opens on today's date. In
development, a first run with no saved data offers a "Load sample day" button
on the plot.

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

Every block keeps its own time: editing one block never moves another. A
resize stops at its neighbors, a moved block lands in the nearest free time,
and deleting a block leaves free time behind.

- **Add a block** with Add block, the N key, a click on a gap (it prefills
  that free time, up to two hours), or a click on the plot or the top roof.
- **Watch it build.** The first block on an empty day is built by a crew:
  survey, site prep, foundation, frame, scaffold, cladding, roof, and cleanup,
  about 6 seconds for an hour at speed 1. Skip in the status chip or Escape
  finishes it at once, as do opening settings and changing days. Other new
  blocks appear without animation until stacked builds arrive in M4. With
  reduced motion, the block fades in instead.
- **Select** a block by clicking it or its label. Click empty space or press
  Escape to deselect. Up and Down move the selection through the day.
- **Resize** a selected block by dragging its roof or base, by Shift and the
  mouse wheel over it (one slot per notch), or with the times in the inspector.
- **Move** a selected block by dragging its body. A blue ghost follows the
  pointer and the block shows where it will land. Move earlier and Move later
  in the inspector step one slot, swapping with a neighbor that touches.
- **Rename and recategorize** in the inspector. Titles and times commit on
  Enter or when you leave the field.
- **Demolish** with the inspector button or Delete. An Undo toast stays for
  six seconds.
- **Change days** with the arrows beside the date, the [ and ] keys, or
  Today.
- **Highlight a category** by clicking it in the legend; click again or press
  Escape to clear.
- **Orbit** by dragging empty space and zoom with the wheel. A drag that
  starts on a block never orbits. Reset view or R returns to the default view.
- **List view**: press Tab once on load to reveal Open list view, a plain
  table with the same edits. It is the whole page in browsers without WebGL2.

Plans and settings save to this browser's local storage under
`timetower.save`. The menu exports a JSON file and imports one (replacing all
data or merging in days you do not have), copies the previous planned day onto
an empty day, and clears the current day.

### Keyboard

| Key | Action |
|---|---|
| N | New block |
| Enter | Confirm the inspector |
| Escape | Cancel a drag, skip a build, close the inspector, deselect, or clear a highlight |
| Delete, Backspace | Demolish the selected block |
| Up, Down | Select the next or previous block |
| [ and ] | Previous or next day |
| T | Go to today |
| R | Reset view |
| , (comma) | Open settings |
| D | Show renderer statistics |
| Shift + wheel | Change the selected block's end by one slot |

### Settings

Open with the gear or the comma key. Changes preview at once; Save keeps them
and Cancel puts everything back.

| Setting | What it does |
|---|---|
| Day start, Day end | The planned window, 4 to 18 hours, on half hours. Blocks outside it are kept, drawn hatched. |
| Slot | 5, 10, 15, or 30 minutes. New edits snap to it. |
| Time format | 12h or 24h. |
| Categories | Up to 9, each with a name and one of nine brand colors. Removing one moves its blocks to the first category. |
| Animation speed | 0.5x to 3x for the build animation. At 2x a build takes half as long. |
| Reduced motion | System, On, or Off. On replaces the build with a quarter second fade. |
| Idle orbit | Slowly circles the tower when idle (arriving in M5). |
| Labels | Always, or only on hover. |
| Weather past blocks | Fades blocks that are done (arriving in M5). |
| Theme | Light or Dark. |
| Palette mode | Strict brand colors, or Accents, which adds grass green and hi-vis orange. |
| Data | Export JSON, Import JSON, Clear this day, Clear all data (type clear to confirm). |

## Project layout

```
src/
  brand/tokens.ts   the only file allowed to contain hex colors
  core/             pure logic: model, time, layout, store, rng (no three, no DOM)
  scene/            three.js scene: SceneRoot, Ground, Tower, blocks, gaps, labels
  scene/crew/       workers, machines, crane, scaffold, dust, and site props
  ui/               HTML overlay
  anim/             Timeline, Director, easing, paths, and jobs (build timing in jobs/schedule.ts)
tests/              Vitest unit tests for core logic, animation timing, and brand rules
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

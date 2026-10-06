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
| M4 | Stacked builds and the other jobs | Done |
| M5 | Living tower: now ring, weathering, idle orbit | Done |
| After M5 | Blocks build in real time, while their time runs | Done |

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
on the plot. Its seven blocks appear at once by the clock: the ones whose time
is up stand finished, the crew starts on the one under way, and the rest are
plans.

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
- **Watch it build, in real time.** A block is built over the whole of its
  time, the way a site would build it. Until its time starts it is a see
  through plan in its category color. The day's first block starts from
  grass: the foreman sets out the footprint and a worker drives the corner
  stakes, a bulldozer clears the plot, the excavator digs while a dump truck
  hauls the spoil, and the footings, rebar, and slab go in. A block on the
  tower gets a hoist, a guard rail on the roof below, and a floor pumped up
  and poured. Then the frame goes up floor by floor, with the crew bolting
  each piece in a shower of sparks and climbing deck to deck as the
  scaffold rises with them. A few floors behind, the facade closes band by
  band, so the block fills in steadily through its time. The roof cap goes
  on, and the scaffold comes down with the crew, who head home as the time
  runs out. The site is busy the whole time: the crane lifts every column,
  beam, deck bundle, and facade panel on slings from a stockyard by its
  base, and bundles of rebar, formwork, and scaffold between them; a
  slinger hooks each load on and a banksman signals it up; a hoist driver
  rides materials up the side of the tower; the racks run down and a
  flatbed truck backs in to restock them while a marshal waves it through
  the gate; and the mixer comes back to pour each floor. Up to ten work
  the block, each at their trade, and it all moves smoothly, frame by
  frame. The block's label names the trade at work, such as framing or
  cladding. Open the app at any moment and the site is where that moment
  puts it. Around it all is a fenced site with
  an entrance, cabins, toilets, a skip, and a lighting tower; once the plot
  is cleared, gravel roads, tire tracks, and materials laid down at its
  edges.
- **Edits animate too.** On finished blocks, a resize extends or shrinks the
  block, a move slides it or has the crane carry it, and Demolish brings in
  the wrecking ball, which takes down only the facade that has closed on the
  block under way. Plans slide and fade, with no crew. Adding more while one plays hurries
  it along. Skip in the status chip or Escape finishes everything at once, as
  do opening settings and changing days. With reduced motion there is no
  crew: each change is a quarter second fade or slide, and the block under
  way fills in with the ring.
- **Select** a block by clicking it or its label. Click empty space or press
  Escape to deselect. Up and Down move the selection through the day.
- **Resize** a selected block by dragging its roof or base, by Shift and the
  mouse wheel over it (one slot per notch), or with the times in the inspector.
  While you drag, a blue ghost shows the new size.
- **Move** a selected block by dragging its body. A blue ghost follows the
  pointer, and an outline marks where the block will land when that is
  somewhere else. The block moves when you let go. Move earlier and Move
  later in the inspector step one slot, swapping with a neighbor that touches.
- **Rename and recategorize** in the inspector. Titles and times commit on
  Enter or when you leave the field.
- **Demolish** with the inspector button or Delete. An Undo toast stays for
  six seconds; Undo brings the block back by the clock, a finished one
  fading in at triple speed.
- **Change days** with the arrows beside the date, the [ and ] keys, or
  Today. The new day appears at once, and its blocks warm from pale to their
  colors, bottom to top, in a short sunrise.
- **Watch the time.** On today, a blue ring marks the current time on the
  tower, with a "now" card beside it. It moves every 30 seconds and when you
  come back to the tab, and is hidden before the day starts and after it
  ends. Blocks that are done fade to a paler, matte finish and their labels
  say done; the block under way says building. This never changes your plan,
  and other days are never weathered: earlier days stand finished, later days
  are plans.
- **Leave it running.** After 20 seconds with no input the camera slowly
  circles the tower until you move the mouse, scroll, or press a key. It
  waits while a job plays, though not for the crew at work on the block under
  way. If the app is open past midnight, a toast
  offers the new day and the Today button returns, but the day you are
  viewing stays put.
- **Highlight a category** by clicking it in the legend; click again or press
  Escape to clear.
- **Look from any angle** by dragging empty space: all the way round, from
  straight above down to looking up from just above the ground, but never
  from beneath it. Zoom with the wheel, right in or far out, and pan round
  the site with the right button or a Shift drag. A drag that starts on a
  block never orbits. Reset view or R returns to the default view.
- **List view**: press Tab once on load to reveal Open list view, a plain
  table with the same edits. It is the whole page in browsers without WebGL2.

Plans and settings save to this browser's local storage under
`timetower.save`. The menu exports a JSON file and imports one (replacing all
data or merging in days you do not have), copies the previous planned day onto
an empty day, and clears the current day. A copied day and an import appear
at once, finished, under way, or planned by the clock. Files
from a newer version of the app are refused. If the browser cannot save (in
some private windows, or when storage is full), a "Not saving: storage
unavailable" chip stays on screen; edits keep working for the session, and
Export still saves a copy.

### Keyboard

| Key | Action |
|---|---|
| N | New block |
| Enter | Confirm the inspector |
| Escape | Cancel a drag, skip a build or the speed preview, close the inspector, deselect, or clear a highlight |
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
| Animation speed | 0.5x to 3x for every construction animation: the crew's walking, the machines, the crane's lifts, and every edit. The building itself always follows the clock. Preview builds a one hour block from start to finish on a plot beside the tower at the chosen speed, then clears it; Escape skips it. An undone deletion of a finished block always fades back in at 3x. |
| Reduced motion | System, On, or Off. On turns every construction animation into a quarter second fade or slide with no crew, stops the idle orbit, and moves the now ring without gliding. |
| Idle orbit | Slowly circles the tower after 20 seconds without input. |
| Labels | Always, or only on hover. |
| Weather past blocks | On today, blocks that are done fade to a paler, matte finish. |
| Theme | Light or Dark. |
| Palette mode | Strict brand colors (default), or Accents, which adds hi-vis orange for worker vests and site cones. Grass is green in either mode. |
| Data | Export JSON, Import JSON, Clear this day, Clear all data (type clear to confirm). |

## Project layout

```
src/
  brand/tokens.ts   the only file allowed to contain hex colors
  core/             pure logic: model, time, layout, store, rng, build progress by the clock (no three, no DOM)
  scene/            three.js scene: SceneRoot, Ground, the site yard, Tower, blocks, gaps, labels, now ring
  scene/crew/       workers, machines, crane, hoist, scaffold, rubble, dust, and site props
  ui/               HTML overlay
  anim/             Timeline, Director, easing, paths, the job planner (plan.ts), and the block under way (live.ts, liveBuild.ts, sitePlan.ts)
  anim/jobs/        build, extend, shrink, resize, demolish, relocate, settle, vanish, the speed preview, and their timing (schedule.ts)
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
- Block under way: step a fake clock through its time and check each phase,
  setting out to strike, in order, with the crew on the deck or planks they
  should be on and no one walking through the tower.
- At a block's end the site is clear and its roof is on; at the next block's
  start the crew arrives. Later blocks are plans until then.

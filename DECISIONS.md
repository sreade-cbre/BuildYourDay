# Decisions

Calls made during the build where the spec was silent, ambiguous, or in
conflict with itself or with the current version of three. Each entry says
what was decided and why. Section numbers refer to `TIME_TOWER_SPEC.md`.

## M1: Static tower

### Repository and tooling

1. **Spec in the repo.** The spec arrived as an attachment, so it is committed
   as `TIME_TOWER_SPEC.md` for later milestones and fresh sessions to read.
2. **Latest toolchain.** three 0.186, TypeScript 7.0 (the native compiler),
   Vite 8, and Vitest 5, the latest at install time. Dependencies are exactly
   the ones section 4 lists.
3. **Tests read files through Vite.** The brand and architecture tests load
   source text with `import.meta.glob` raw imports instead of `node:fs`, so no
   `@types/node` dev dependency is needed.
4. **Extra test files.** `tests/architecture.test.ts` enforces the core purity
   rule from section 19 (no three, no DOM, no scene or UI imports in `core/`).
   `tests/writing.test.ts` checks docs, config, and tests for em dashes and en
   dashes. `tests/rng.test.ts` covers the seeded generator. The brand test also
   checks that `styles.css` matches `tokens.ts` and that the derived tokens
   match their stated mixes. Vitest normally replaces CSS with empty strings,
   which would leave the CSS half of the brand scan looking at nothing, so
   `vitest.config.ts` turns CSS processing on and the tests fail on any empty
   file. Each guard was proven by planting a violation and watching it fail.
5. **Files beyond the listed structure.** `src/App.ts` wires the store, scene,
   and overlay; `src/scene/Foundation.ts` holds the slab and footing pads;
   `src/scene/canvasText.ts` holds shared canvas text helpers. `src/anim/easing.ts`
   arrived early because the camera framing tween uses it.

### Brand

6. **CSS custom properties use `rgb()`.** Section 5.2 asks for the tokens in
   `styles.css` as custom properties, but the brand test forbids hex literals
   anywhere in `src/` except `tokens.ts`. The properties keep the exact token
   names (`--navy`, `--navyLight`, and so on) with `rgb()` values, and a test
   fails if any value drifts from `tokens.ts`.
7. **Block edges on dark swatches.** Section 8.3 draws edges in the family's
   dark shade. On a block that already is that shade (for example `navyDark`)
   the edges would vanish, so those blocks get the family's light tint instead.

### Lighting and rendering

8. **Light intensities multiplied by pi.** three r155 and later use physical
   light units; the older convention scaled every light by pi internally. The
   spec's 0.9 and 1.4 match the older convention. Used as is, the white ground
   rendered mid gray and navy blocks came out near black. With the pi applied,
   the ground reads white and block colors land on the palette.
9. **Fog kept at the spec's 60 to 140.** The default camera sits about 78 units
   out, so the fog tints the tower slightly. Sampled pixels showed this helps:
   with fog, shaded faces match the base tokens closely (navy side
   40,74,124 against the token's 30,68,121; slate side 84,94,100 against
   80,90,96) and lit faces land near the Light tints. Without fog, ACES pushes
   them darker and oversaturated.
10. **`PCFShadowMap` instead of `PCFSoftShadowMap`.** r186 removed the soft
    variant; requesting it logs a warning and falls back to `PCFShadowMap`,
    which now does soft filtering itself.
11. **Sun placement.** The light keeps the direction of (12, 30, 18) but sits
    farther out along it, so the shadow camera stays above tall towers.

### Geometry

12. **Plot and slab heights.** Section 7.2 says the slab top (y = 0) is flush
    with the plot surface; section 8.2 puts the plot top at y = -0.3. The
    explicit numbers win: the plot top is at y = -0.3, the 0.2 thick slab
    spans y = -0.2 to 0, and the four 0.15 tall footing pads stand on the plot
    and carry the slab. The plot is a raised tile with the ground plane at its
    base.
13. **Depot orientation.** Section 8.2 says an "8 x 6 pad" centered at x = 8.
    Running 8 along x would overlap the plot by a unit, so the pad is 6 along x
    (meeting the plot edge exactly) and 8 along z. Its top sits 0.02 below the
    plot so the two side faces do not share a plane and flicker along the seam.
14. **Roof cap inside the block.** The 0.08 thick cap is set into the top of
    the block rather than stacked on it, so block heights stay exactly
    proportional to duration. Its 0.05 overhang reads as a band between blocks.
15. **Shared block geometry.** Every block uses one unit tall box scaled in y,
    with one shared edge geometry, instead of a `BoxGeometry` per block. Gap
    outlines are per gap because dashes are laid out in local units.
16. **Foundation and site prep follow the data.** A day with any block shows
    the slab and a prepared plot (bare earth with the bulldozer's strip
    cleared of grass); an empty day shows untouched grass and no slab.
17. **Site sign placement.** Front left of the plot as seen from the default
    camera, at (-3.6, 4.0), facing the camera.

### Camera

18. **Default view direction.** The spec leaves it open. The camera starts at
    azimuth -0.42 rad and polar angle 0.41 pi, so with the light at
    (12, 30, 18) one visible face is lit and the other shaded.
19. **Framing margin.** "15% margin top and bottom" is applied in screen space:
    the projected tower must fit within the middle 70% of the viewport height.
    With the target at 0.45 of the tower height, the top margin is exactly 15%
    and the bottom gets a little more, which leaves room for the plot.
20. **Max distance for long windows.** An 18 hour window cannot be framed
    within the 80 unit limit at fov 38. The limit stays at 80 unless the
    default framing needs more, in which case it grows to that distance.

### Labels

21. **Anchored to the camera, not to world x.** Section 8.5 says "offset +0.4
    in x". Labels follow the camera's right axis instead, so they stay to the
    right of the tower while the camera orbits.
22. **Fonts and colors.** Titles use Georgia bold 20 px (section 8.5) rather
    than Verdana (section 5.6); all label text is `slate` (section 5.6).
23. **Category in the label.** Section 17 requires the category in the label
    text, so line two reads "7:30 to 9:00 · 1h 30m · Deep work".
24. **Short times in 12h labels.** In-scene labels drop AM and PM, following
    the section 8.5 example "7:30 to 9:00". Overlay text keeps the full form.
25. **Legible size over the implied size.** Section 8.5's overlap rule implies
    labels about 0.6 units tall, which is unreadable at the default distance.
    Labels are sized so titles show at about 15 px at the default view. When
    labels would overlap, the shorter block's label steps out one column, as
    the spec says, with a leader line. On a dense day labels shrink to no less
    than 80% so the columns fit beside the tower. A 44 block day of 15 minute
    blocks fits at 1600 px wide. An extreme day, such as 48 blocks of 5 to 15
    minutes, still never overlaps, but its outer columns can run past the
    screen edge; hover labels (M2) are the intended mode there.
26. **A material per label.** Each label has its own `SpriteMaterial` because
    each has its own canvas texture. This is the one exception to "never a
    material per block"; label materials and textures are freed with the label.

### Core rules

27. **Totals count the in-window part of a block.** Planned plus free always
    equals the window length and category totals add up to the planned total,
    even when a settings change leaves a block partly outside the window.
28. **`canPlace` checks placement only.** It checks whole minutes, positive
    length, the window, and overlap. Slot alignment and minimum length are
    store rules, so the same check serves new blocks and edits.
29. **`nextFreeRange` prefers the top.** It returns the range above the last
    block when that range is long enough (matching the Add button's default in
    section 12.1), otherwise the earliest gap that fits, trimmed to slot
    boundaries. Null means the day is full.
30. **Edits after the slot gets coarser.** Only the edges an edit changes must
    fall on the current slot, a move keeps the block's duration, and a block
    may not shrink below one slot. Blocks made under a finer slot stay
    editable without being forced onto the new grid.
31. **Titles are trimmed and capped.** Leading and trailing spaces are removed
    and titles longer than 60 characters are cut to 60 rather than rejected.
32. **The app opens on today.** `lastViewedDate` is saved but, per section
    7.4, startup always shows today.
33. **Sample day loads automatically in M1.** There is no editing or saving
    yet, so development builds open on the section 20 sample day. Replaced in
    M2 by the "Load sample day" button (M2 decision 12).

## M2: Editing and persistence

### Fixed times

1. **Edits never move other blocks (your call, October 5, 2026).** The spec
   disagreed with itself: section 12.3 says a resize stops at the block above,
   while 12.3's "blocks above shift live", 12.4's "other blocks shifting out
   of the way", and the settle steps in 11.1 to 11.3 have neighbors moving.
   Chosen: a resize stops at its neighbors, a dragged block lands in the
   nearest free time that fits (the blue ghost follows the pointer, the block
   shows where it will land), deleting leaves free time, and only Move earlier
   and Move later change a neighbor, by swapping with one that touches. The
   settle animation in M4 will play only when a time really changes.
2. **Time selects only offer times that fit.** In the inspector and the list
   view, start and end choices stop at the neighbors, so a select cannot push
   anything either. A block made under a finer slot keeps its own off-grid
   times in the list.

### Persistence

3. **Storage is passed into core.** Section 19 lists `persist.ts` under
   `core/`, which has no DOM access. The module takes any object with
   getItem, setItem, and removeItem; `main.ts` hands it `window.localStorage`
   after a test write, and tests hand it a map.
4. **Migration keeps blocks outside the window.** Section 15.2 says to clamp
   blocks to the window, but section 6 keeps blocks that fall outside after a
   settings change so that changing back restores them. For the app's own
   version 1 saves, section 6 wins; clamping there would destroy those blocks
   on the next reload. Version 0 data, which carries no window, is clamped to
   the window. Every version snaps times to the 5 minute grid, clamps them to
   the 24 hour day, and drops blocks left with no time, overlaps, repeats, and
   anything past 48 blocks, reporting each change to the console.
5. **Unreadable saves are backed up once.** Bad JSON, a bad shape, or a newer
   version is copied to `timetower.save.corrupt.<timestamp>` and the main key
   is cleared, so the next start does not back it up again. If the copy
   fails, the original stays put.
6. **Writes flush on page hide.** Changes save 250 ms after they settle, and
   anything pending is written when the page is hidden, so closing the tab
   right after an edit loses nothing.
7. **Import merge and categories.** Merging adds only missing days and keeps
   current settings. A merged block's category is matched by id, then by name;
   if neither exists it is added when there is room, otherwise the block moves
   to the first category.

### Settings modal

8. **Live preview without touching data.** The store has a preview layer for
   unsaved settings, so the modal previews everything live (section 13.6)
   while blocks and saved settings stay untouched. Removing a category shows
   its blocks under the first category until Save, which then reassigns them.
   Previews are never written to storage.
9. **Data actions inside the modal apply at once.** Export, Clear this day,
   and Clear all data act immediately; Import first cancels unsaved settings
   and closes the modal, since the file may bring its own settings. Clear all
   data resets settings too and closes the modal.
10. **Preview button waits for animations.** The animation speed slider is
    wired, and its Preview button is shown unavailable until build animations
    exist; section 21 allows animation settings to do nothing in M2.

### Interactions

11. **Press, then drag.** A press on a block selects it. Dragging the roof or
    base zone of a selected block resizes it; dragging its body, or dragging an
    unselected block, moves it. Travel is measured from the press point. A
    drag that loses its pointer commits where it last was (section 18), and
    Escape cancels it.
12. **Sample day button.** Section 20's "Load sample day" button replaces the
    M1 automatic load. It shows over the plot in development builds while no
    data exists at all, and loads today's plan instantly; the animated build
    arrives in M5.
13. **Copy the previous day lands now, instantly.** Section 12.8 is part of
    section 12, which M2's acceptance covers, so the menu item works now; the
    rapid build animation arrives in M5. It is offered only on an empty day
    with an earlier planned day, and names that day when it is not yesterday.
14. **Clear this day uses Undo, not a confirmation.** Like Demolish (section
    12.6). The undo buffer holds the most recent deletion, one block or a whole
    day.
15. **The top block's roof.** Clicking the top face of the topmost block
    starts a new block (section 12.1); clicking its sides selects it.
16. **Shift and the wheel.** One standard wheel notch (100 px) changes the
    end by one slot, and smaller trackpad deltas add up to the same. Scrolling
    up lengthens. Over anything but the selected block, the wheel zooms.
17. **Arrow keys.** Up selects the next block in time, which is higher in the
    tower, and Down the previous; with nothing selected, Up starts at the
    earliest block and Down at the latest. On macOS, arrow keys open a closed
    select's menu instead of stepping its value, which is the platform's own
    behavior.
18. **Gap hover.** A hovered gap tints slightly blue so it reads as clickable.

### Display

19. **Blocks outside the window.** The part inside the window is drawn
    hatched in slateLight; a block wholly outside shows as a thin hatched band
    at the nearest window edge, slightly proud of the tower. Its label adds
    "outside window" and the inspector shows the warning line. Totals count
    only in-window time (M1 decision 27).
20. **Hover labels and the highlight.** In "On hover" mode only the hovered
    or selected block shows a label. A legend highlight dims other blocks, and
    their labels, to 40% opacity.
21. **Theme transition.** Background, fog, ground, and overlay colors fade
    over 0.4 s (section 14), and switch at once under reduced motion.

### Wording and accessibility

22. **Button names start with verbs.** The hidden list view button reads
    "Open list view" (the spec calls it "List view"), the list dialog closes
    with "Close list view", and the import prompt offers "Replace all data",
    "Merge days", and "Cancel". "Today" keeps its spec name on screen, with
    the accessible name "Go to today".
23. **Add block contrast.** Section 13.1 specifies white text on blue. That
    pair is about 3.5 to 1, which meets AA only for large text. It is kept as
    specified, in bold; blueDark would give about 6.4 to 1 if preferred. Dark
    theme links and the skip button use blueLight, since blue on navyDark
    misses AA.
24. **Unavailable controls stay focusable.** Add block on a full day, the
    move buttons at an edge, and similar controls use aria-disabled with the
    reason in the tooltip, because a disabled button cannot show a tooltip.

### Structure

25. **Extra UI modules.** Toasts, the shared modal dialog, keyboard
    shortcuts, UI state, DOM helpers, time choices, and the debug panel each
    have a file in `src/ui/`. The spec puts toasts in `Overlay.ts`; they moved
    out to keep that file to the top bar.
26. **Debug panel early.** The D key toggles the live geometry and texture
    counts from section 16 now, since they help check edits for leaks.
27. **Without WebGL2.** The list view is the page (section 17) with a notice;
    the inspector still opens from N or Add block, and everything else works.

## M3: First build animation

### Timing

1. **Phase lengths win over travel speeds.** Section 10.3 moves machines at
   2.5 units per second and section 10.2 walks workers at 1.2, but the
   bulldozer's pass is 14 units long and site prep lasts 0.6 s. Every move
   takes the time its phase allows, so the site reads as a time lapse.
   Machines still ease in and out.
2. **Dig cycles compressed.** Section 10.3 gives 1.2 s per dig cycle and
   phase 2 asks for two, but a 60 minute block's foundation lasts 0.8 s. Both
   cycles run in the middle half of the foundation phase.
3. **The phase table wins over Appendix A.** Appendix A's totals cannot come
   from the 9.4 table: its 15 minute total is 3.5 s, while the minimum
   durations alone add up to 5.1 s. The 9.4 table sets every length, with
   small overlaps from 9.5: prep starts at 90% of survey, foundation at 90% of
   prep, scaffold at 85% of frame, and cleanup at 90% of roof. Totals at speed
   1: 15 minutes 4.8 s, 60 minutes 5.74 s, 4 hours 8.86 s, 8 hours 11.44 s.
   Timing lives in `src/anim/jobs/schedule.ts`, away from three, so it is
   unit tested.
4. **Lifts, not floors, set the crane's pace.** Phase 3 batches beams two
   floors at a time above six floors, which still means 16 lifts in 3.4 s at
   8 hours, and a 30 minute block at 5 minute slots would get lifts of 0.14 s.
   The crane lifts one floor at a time where time allows, never more than six
   times, and never for less than 0.3 s; otherwise floors are grouped evenly.
   Section 18's "F capped for beam batching" points the same way. Cladding
   panels follow the same rule, one plate per group of floors.
5. **Panels land as the plane reaches them.** Each panel lift lands as the
   clipping plane reaches the bottom of its floors, and the plate fades as the
   plane passes. A lift never starts before the frame's last lift is done and
   always ends before the roof lift, so the crane never has two loads at once.
   A test checks this for every block length and slot size.

### Look

6. **Label at 45% while building.** Section 9.5 updates the label at the start
   of phase 0, while phase 7 fades it in. The label appears at once at 45%
   opacity and fades to full during cleanup.
7. **Planks on the faces the camera sees.** Phase 4 puts planks on the front
   and right faces, but the default camera looks at the front and left faces,
   so the planks and the workers on them go there.
8. **Up to three workers on the scaffold.** Phase 4 asks for three, but a crew
   of two or three has fewer builders besides the surveyor, so the scaffold
   gets as many as the crew has.
9. **One worker under 15 minutes.** Section 10.1's crew formula gives any
   short block two workers, while section 18 gives a 5 minute block one.
   Blocks under 15 minutes get one worker who surveys, screeds, and clads.
10. **Machines stay in view.** The bulldozer, excavator, and mixer park on the
    depot facing the plot between jobs. The mixer parks cab out so it can
    back toward the slab. The crane always stands at the depot's plot side.
11. **The bulldozer goes home behind the tower.** After its pass it returns
    along a lane behind the tower, so no machine path crosses the tower, the
    excavator, or the mixer.
12. **Worker proportions.** The parts in section 10.1 stack to 0.71 units, so
    the worker is built at that size and scaled to 0.55.
13. **The facade is a shell.** The clipped copy of the block draws its inner
    faces, so the cut reads as a building going up rather than a see-through
    box. The frame retires as the facade covers it: the block body draws with
    a polygon offset, which would let a beam slightly inside it show through at
    grazing angles.

### Director and interruptions

14. **Only the first block animates in M3.** Any other new block waits its
    turn and appears without animation, in order, until stacked builds arrive
    in M4. Undo, the sample day, copying a day, and imports appear at once.
15. **What finishes a build.** Renaming the block leaves the build running.
    Any other edit to the day, opening settings, changing days, loading data,
    and returning to a hidden tab finish it at once (9.6).
16. **Status chip.** While a job runs, a chip at the bottom center names it,
    with a Skip button. The storage notice moved to the top to make room.
    Escape cancels a drag first, then skips a running job, then does what it
    did before.
17. **Reframing.** When a new roof would be out of view, the camera tweens to
    the standard framing over the job's first second (9.5).

### Performance

18. **Shaders compile at startup.** Cloning materials per job made every
    build compile five shaders mid animation, one frame taking up to 31 ms.
    The facade and panel materials now live as long as the site and are
    recolored per job, a hidden label keeps the label shader alive on days
    with no blocks, and the renderer compiles every material, hidden ones
    included, once the scene is built. A build compiles nothing after that,
    except the shadow variant of the clipped facade on the first build, which
    three compiles only when it is first drawn.
19. **Measured frame time.** Section 16's target is a 2020 integrated GPU
    laptop at 1920 × 1080. Measured on an Apple M1 Pro in headless Chrome at
    1920 × 1080: 95th percentile 3.4 to 3.9 ms, worst 12.8 ms (the one shadow
    compile). With the CPU slowed four times: 95th percentile 8.0 ms, worst
    13.9 ms. The GPU could not be slowed, so the target hardware itself is
    untested.

## M4: Stacked builds and the other jobs

### Fixed times and the jobs

1. **Nothing settles after a deletion.** M4's acceptance has the blocks above
   a deleted block settle into place. Under M2 decision 1 a deletion leaves
   free time and the blocks above keep their times, so they are already in
   place and stay put. Settle plays only when a time really changes: Move
   earlier and Move later, and moves by drag or by the inspector.
2. **How moves animate.** A move that lands on or beside where the block was
   slides there (settle); a longer one is carried by the crane (relocate),
   as spec 12.4 says. In a swap from Move earlier or Move later, the block
   that jumps its neighbor is relocated and the neighbor settles while it is
   out of the way, so the two never pass through each other. When both moves
   are the same length, the selected block is the one relocated.
3. **Relocate goes around the tower, not up through it.** Spec 11.3 lifts the
   block straight up, but blocks standing above it would be in the way and
   the crane's cable would pass through them. The block slides out of the
   tower behind its left side, where the jib reaches and the default camera
   can see it, rides to its new height there, and slides back in. Its label
   steps aside while it is outside, so it never crosses the labels it passes.
4. **Previews are ghosts.** During a drag or an unsaved inspector time edit,
   the block now stays where it is and a blue ghost shows the new times. A
   move also shows an outline where the block will land when that is not
   under the pointer. M2 drew the block at its new times instead, but then
   every animation would begin with the block jumping back. This changes
   only how M2 decision 1 is drawn, not the fixed times rule.
5. **Bulk changes stay instant.** Clear this day, undoing a cleared day, the
   sample day, copying a day, imports, and settings show at once. The spec
   animates single edits; dozens of demolitions in a row would only be in the
   way. The rapid builds for the sample day and copy day remain in M5.
6. **Undo speed is absolute.** Spec 12.6's "fast build at speed 3" uses the
   animation speed setting's scale, so an undone deletion rebuilds at 3x
   whatever the setting is.

### Stacked builds

7. **First means nothing standing.** A build is a first build when no other
   block stands on the day as the build is queued; blocks still waiting for
   their own builds do not count. The first build takes the site, so the plot
   keeps its grass until the bulldozer clears it.
8. **A stacked block's foundation is a poured floor.** Phase 2 describes only
   a first block's foundation. For a stacked block the mixer backs in with
   its drum turning, a thin floor rises on the roof below, and the two
   workers who rode the hoist up screed it. The excavator stays parked, and
   the mixer leaves before the frame so the side lane is clear.
9. **Workers ride the hoist both ways.** In phase 1 two workers carry planks
   to the hoist and ride it up, as specified. At the strike, the scaffold
   crew walks the planks to the hoist and rides it down, since a block high
   on the tower has no other way down. Builds near the ground step down as
   in M3.
10. **Side delivery under other blocks.** When blocks stand over the slot,
    for example a block added in a gap, nothing can drop in from overhead
    without passing through them. The crane lowers beams and the roof cap
    beside the tower on the depot side and slides them in at their own
    height, panels hang outside the scaffold, clear of the roofs above, and
    the scaffold strikes before the cap slides in.
11. **Rail and hoist placement.** The guard rail stands right outside the roof
    cap's overhang on the roof below the new block. The hoist stands at the
    tower's rear left edge (spec 10.3), outside the scaffold line.

### Extend, shrink, and demolish

12. **Extend timing.** Spec 11.2 gives shrink a length (0.9 s plus 0.2 s a
    floor, at most 2 s) but not extend. An extend's frame and cladding scale
    like a build's, with 0.6 s minimums, plus taking the roof cap off and
    putting it back at the roof: about 2.7 s for 15 minutes and 4 s for an
    hour at the roof, less at the base. The crane folds away and the mast
    settles inside that time, so a shrink keeps exactly the spec's length.
13. **Where the cap waits.** During an extend the crane needs its hook for
    the new beams, so it sets the roof cap on the depot stack and brings it
    back at the end. During a shrink there is nothing else to lift, so it
    holds the cap on the hook. With blocks standing above, the cap slides
    out to the side first.
14. **No panels in an extend.** The crane's lifts go to the beams and the
    cap; the facade still reveals floor by floor with dust at each floor.
15. **Demolition timing.** The ball lands at 0.4 s and the rubble is down
    and gone by 1.1 s, as specified. The dump truck needs until 1.45 s to
    drive off with its load.
16. **The ball swings in from the front.** The crane hangs the ball in front
    of the block, outside the tower, so its cable stays clear of any blocks
    above, and swings it into the upper third of the front face.
17. **Rubble lands on what is below.** Cubes come to rest on the highest
    roof below the block, or on the slab; cubes thrown past the tower's edge
    land on the plot. With a block standing right above, no cube hops up
    into it.
18. **The last block clears the site.** Demolishing a day's last block ends
    with the slab sinking and the grass growing back, mirroring site prep,
    rather than switching to grass at once.

### Reduced motion

19. **Every job has a short version.** Builds fade in and demolitions fade
    out (spec 9.7). Settles slide linearly for 0.25 s, and extends and
    shrinks change size the same way. A relocated block fades out and back
    in at its new time, since sliding there could cut through the blocks in
    between.

### Under the hood

20. **Claims.** Each job claims the blocks it touches when it is queued, in
    queue order. The first claim decides what a block shows, hidden or
    posed, so a queued job never shows its final state early, and a block
    passes from one job to the next without a flash. Gap outlines in a
    job's ranges stay hidden until it is done. This is how spec 19's rule,
    that only the Director moves a block during a job, is kept.
21. **A rounding bug in the M3 timeline.** A step ending exactly at the
    timeline's end could reach 0.999999999999999 progress and never
    complete, which left its job running forever. Steps now complete within
    a nanosecond of their end; tests/timeline.test.ts covers it.
22. **The mast settles when the site is quiet.** M3 parked the crane at the
    last tower height it knew, which was stale after a build, so the jib sat
    level with the new roof. Jobs now tween the mast, and once everything is
    idle it stands 3 units over the tower top (spec 10.4).
23. **Measured frame time.** On an Apple M1 Pro in headless Chrome at
    1920 × 1080, with the GPU finishing each frame: stacked build 8.8 ms at
    worst (95th percentile 4.7 ms), a 384 cube demolition 5.9 ms, extend
    3.9 ms, relocate 2.7 ms. With the CPU slowed four times, the worst frame
    was 10.9 ms. The 2020 laptop target itself is untested.

## M5: Living tower

### Time passing

1. **After midnight the title keeps naming the day on screen.** Section 18
   updates the date title to the new day while the viewed date stays put,
   but the title names the tower under it. So the title stays, the Today
   button appears, and a toast names the new day ("It is now Tuesday,
   October 6.") with Go to today. The ring hides and the old day's blocks
   lose their weathering, since that day is no longer today (section 11.4).
2. **The ring's card.** The "now 10:40" card sits on the camera's left of
   the ring, away from the block labels on the right, and follows the camera
   around. It uses the chosen time format. Ring and card show from day start
   to day end, on today only.
3. **When a block fades.** A block that becomes done while its day is on
   screen cross-fades over 2 s, as does one whose build ends after its end
   time, and turning Weather past blocks on fades every done block. After a
   load, an import, or a day change, done blocks are weathered at once; the
   sunrise covers that change. The block under way is already weathered
   below the ring, so when it ends it changes without a fade.
4. **Hatched and dimmed blocks.** A block outside the day window keeps its
   hatching, which asks for attention, and is not weathered. While a
   category highlight dims the block under way, it is drawn whole and fresh
   rather than split at the ring, since two translucent parts would draw
   darker where they meet, and dimmed blocks change without a fade. Labels
   of done blocks add "done", so weathering never relies on color alone
   (section 17).
5. **The sunrise plays under reduced motion.** Section 9.7 does not mention
   it, and it is a 0.4 s color change with nothing moving. Each block fades
   over 0.2 s, starting as the sweep reaches its base, so the lowest block
   is first and the top block ends the sweep.
6. **Day start slides the tower as one.** Section 14 tweens every block and
   gap over 0.6 s when the day start changes. They all move by the same
   amount, so the tower slides as one piece while the slab stays on the plot
   and the camera reframes. Under reduced motion the tower and camera move
   at once.
7. **Idle orbit waits for quiet.** Besides section 8.7's rules, the orbit
   waits while a dialog is open, during a drag, and while the tab is hidden.
   Touch counts as input too.

### Sequences

8. **Copied days and the sample day build.** Copying a day builds its blocks
   at 3x and the sample day at 2.5x, in time order with one crew, after
   anything playing finishes. This replaces M2 decisions 12 and 13 and the
   end of M4 decision 5. Clearing a day, undoing a cleared day, imports, and
   settings stay instant.
9. **A sequence is one chain.** Builds in a sequence do not hurry each other
   and do not count toward the queue limit of eight (section 9.6), so a long
   copied day plays in full. A job from outside the chain, such as a new
   block, still hurries what is playing and the rest of the chain.
10. **Sequences overlap their phases more.** With M3's overlaps the sample
    day took 16.07 s at 2.5x, over section 20's 15 s. In a sequence each
    phase starts at 80% of the one before, and the roof at 90% of cladding,
    so the cap still lands after the facade is up. The sample day loads in
    14.3 s (14.33 s measured in the browser).
11. **No build runs past 9.8 s.** Section 18 gives an 8 hour block about
    9.8 s, where M3 decision 3's table gave 11.44 s. A build that would run
    longer at speed 1 shortens its foundation, frame, and cladding in
    proportion, so blocks from 5 hours 20 minutes up take 9.8 s. Shorter
    blocks keep their M3 lengths. This replaces the 8 hour total in M3
    decision 3.

### Speed preview

12. **Where the preview builds.** Section 14's Preview builds a 60 minute
    block in the first category on a bare side plot 26 units left of the
    tower, at the slider's unsaved speed. The crew moves over for it and the
    camera turns to it, while the settings modal steps aside without
    closing, so unsaved settings stay. When the block is done it fades, the
    slab sinks, and the grass grows back; then the camera, crew, and modal
    return, with focus on Preview. Skip or Escape ends it early.
13. **When Preview is unavailable.** Under reduced motion every build is a
    fade, and without WebGL2 there is no scene, so Preview is disabled with
    a note that says why.

### Checked, not changed

14. **Storage, palette, and imports.** Working in memory with the "Not
    saving: storage unavailable" chip, the accents palette, and refusing
    files from a newer version arrived with M2. M5 checked them against
    sections 5.3, 15, and 18 and changed nothing.

### Under the hood

15. **The crew can move.** Machine points such as the crane hook, the
    excavator bucket, and the truck bed are measured in the crew's own frame
    rather than the world's, so the whole crew can work on the side plot.
16. **Measured frame time.** On an Apple M1 Pro in headless Chrome at
    1920 × 1080, with the GPU finishing each frame, the ring up, and the
    block under way split at it: a stacked build 9.5 ms at worst (95th
    percentile 2.6 ms), the sunrise 2.6 ms, and the idle orbit 9.0 ms at
    worst while holding 60 frames a second. With the CPU slowed four times,
    a stacked build's worst frame was 13.7 ms. The 2020 laptop target itself
    is untested.
17. **Thirty minutes of use.** A scripted session made 635 random changes
    over 30 minutes: adds, demolitions, undos, moves, resizes, renames, day
    changes, settings changes, skips, idle spells with the orbit, and copied
    days, after one warm-up pass through every job. Read on an untouched
    reference day every 5 minutes, the geometry count stayed at 148 or 149,
    and the console stayed empty. Textures and shaders rose by one, once:
    blocks outside the day window use a hatched look that is made the first
    time one appears and then kept. Labels on hover lower the texture count
    while they are hidden. The first attempt stalled because headless Chrome
    on macOS repeats a synthetic key the page leaves unhandled thousands of
    times a second, so the script sends Escape only while a job plays.

## After M5: Building in real time

### The change

1. **Blocks build while their time runs (your call, October 6, 2026).** A
   block's build used to play in a few seconds when it was added. Now the
   crew starts a block when its time starts and builds it for the whole of
   its time, trade by trade, finishing as the time is up. This replaces spec
   9.1's build of a few seconds. The block still exists in data, with its
   label and totals, the moment it is added.
2. **The whole job over the block's time (your call, October 6, 2026).** A
   first version played survey to scaffold in a few seconds at the start
   and the roof in a second at the end, with only hammering between. Now
   the block's time is the job's program, in shares of its length. As on
   a real tower the trades overlap, so the building rises the whole time:
   groundworks are short, the scaffold climbs with the frame, and the facade
   closes a few floors behind it. A second version ran the trades one after
   another, which left the block looking like a plan for its first half,
   so at the default zoom it seemed nothing was being built (your report,
   October 6, 2026).

   | First block of the day | From | To | Stacked block | From | To |
   |---|---|---|---|---|---|
   | Setting out | 0% | 3% | Setting out | 0% | 3% |
   | Clearing | 3% | 7% | Setting up | 3% | 6% |
   | Digging | 7% | 12% | Floor pour | 6% | 12% |
   | Footings and slab | 12% | 18% | | | |
   | Frame, scaffold with it | 18% | 64% | Frame, scaffold with it | 12% | 62% |
   | Cladding | 30% | 92% | Cladding | 28% | 92% |
   | Roof | 92% | 95% | Roof | 92% | 95% |
   | Strike | 95% | 100% | Strike | 95% | 100% |

   A band of facade starts closing only once its floors are framed, so on a
   block of a floor or two the cladding waits for the frame. Every crane
   lift, beams, panels, and the roof cap, goes in one queue: a lift that
   would start before the crane is back from the last waits for it. The
   timing lives in `src/anim/sitePlan.ts`, away from three, so it is unit
   tested.
3. **What happens in each.** Setting out: the foreman sets up the tripod,
   the footprint outline draws, and a worker drives a flagged stake at each
   corner. Clearing: the bulldozer pushes across the plot in passes, blade
   down going in and up backing out, while the crew stands back and one
   signals. Digging: the excavator digs the pit, which widens, and the dump
   truck shuttles, loading over three dig cycles, driving off, and tipping
   at the depot. Footings and slab: formwork at each pad, a rebar mat tied
   across the pit, the mixer backing in to pour, and three screeding the
   slab. On a stacked block the hoist goes up, the crew carries planks to it
   and rides up, fixes the guard rail on the roof below, and screeds a floor
   the mixer pumps up a line beside the tower. Frame, a floor at a time:
   columns rise, the crane brings that floor's ring of beams, a deck goes
   down on it, and two of the crew bolt up and climb to the new deck, the
   scaffold rising with them. Cladding: for each band of floors the crane
   brings a panel and the facade closes behind the scaffold; on a crew of
   three or more the third starts cladding while the frame is still going
   up, and the other two join once it is done, everyone moving up a level
   as each band closes. Roof: two go up to fix the cap the crane sets.
   Strike: the scaffold comes down with the crew on it, they ride the hoist
   or step down, and everyone, foreman last, walks out before the time is
   up.
4. **A function of the clock.** Everything on the site is worked out from
   the time since the block started, so the site looks the same whether it
   has been watched all along or the app has just opened mid-block. Nothing
   needs to replay or catch up, and adding a block whose time is under way
   shows its site at its stage. Motion between moments plays at real paces:
   workers walk at 1.2 units a second (spec 10.2), machines drive at 2.5
   (spec 10.3) and push at 1.1, the hoist climbs 0.9 a second, a crane lift
   takes nine seconds and a dig cycle 3.2, all faster or slower with the
   animation speed. Moves that would not fit the time a phase allows, on
   very short blocks, hurry.
5. **The crew and their roles.** The crew size is spec 10.1's. The first
   worker is the foreman, up to three more work on the structure, and on a
   block of 90 minutes or more the rest are a ground crew: a banksman who
   signals at the stack while the crane picks, and a laborer carrying
   loads to the bay in front of the tower. Under 15 minutes one worker does
   everything. They walk a square road round the tower, never through it.
6. **A second set of site pieces.** The block under way has its own
   scaffold, guard rail, hoist, props, dust, and six workers, so a job on a
   finished block, which uses the crew's set, never takes the live site
   down. The live site is not a job: it has no length to skip or hurry, and
   no status chip.
7. **Lending the crane and machines.** Jobs now say what they borrow:
   moves and resizes the crane, a demolition and the speed preview the crane
   and machines. While one plays, the live site leaves those to it and
   carries on with everything else, then takes them back where its clock
   says. Slides and fades borrow nothing, and no longer park the machines.
8. **Plans are see through.** A block whose time has not come is drawn in
   its category color at 22% opacity with its edges and no roof, so the
   whole plan still reads at a glance (spec 2). Earlier days are all built
   and later days are all plans. The plot keeps its grass until the day's
   first block starts, so a day of plans floats over grass with no slab.
   The block under way is drawn as built up to where its facade has closed,
   as a shell like M3 decision 13, with its plan above, and gets its roof
   when the crane sets the cap.

### Edits by the clock

9. **Adding.** A block whose time is up fades in finished, since the crew
   is done with it (the reduced motion fade of spec 9.7). The block under
   way and a plan need no job: the site and the tower show them as they
   stand.
10. **Deleting.** A finished block is demolished as before. For the block
    under way the site clears at once and the wrecking ball takes down the
    facade that has closed, if a minute's worth has; before that, its plan
    fades out over a quarter second, as any plan's does. The toast still
    says Demolished, like the button.
11. **Resizing and moving.** Finished to finished animates as in M4. Plan to
    plan slides plainly, however far, since a plan is not solid and needs no
    crane. A plan moved into the past fades in finished. Any other crossing
    shows at once, and the site follows, set up again for the block's new
    times at their stage.
12. **Plans are not solid.** Loads pass through plans, rubble never lands on
    them, a block under plans is not "covered" (M4 decision 10), and the
    first block to start on a day prepares the site even with plans around
    it (M4 decision 7). The crane's lifts stay just above the block under
    way. The parked crane still clears the whole tower, plans included.
13. **Copied days and the sample day show at once.** Builds follow the
    clock, so the rapid sequences of M5 decisions 8 to 10 are gone, and with
    them the tighter phase overlaps. Undo brings a deleted block back by
    the clock too: done fades in at triple speed, the others need nothing.

### Look

14. **The block under way is fresh, not weathered.** M5 drew it weathered
    below the ring. Now the part that stands is the new facade, in full
    color; it weathers over 2 s once its time is up. A block an edit puts
    back under way drops that fade at once. Its label says what the crew is
    doing, such as "framing" or "cladding" (the frame leads while the two
    overlap), as done blocks add "done".
15. **Reduced motion.** No crew, machines, or crane: the building still goes
    up with the time, stage by stage, and what the crane would bring
    appears in place on time.
16. **Plans on the dark theme.** A plan in its own color at 22% vanishes
    against the navy sky, so on the dark theme plans take their family's
    light tint, with a stronger outline in the same tint. The light theme
    draws a plan's outline like a finished block's.
17. **The camera reframes for the new roof only.** Spec 9.5 moves the camera
    when the new block's top is out of view. The build used the top of
    everything standing, which with plans above would reframe needlessly.
18. **A block over free time.** A block with free time below it, the day's
    first or not, still stands where its time puts it, as before: its frame
    rises from its own base and the crew rides the hoist up to it. Its
    guard rail and poured floor sit at its base with nothing under them.

### The site round the tower

19. **A construction site at the base (your call, October 6, 2026).** The
    plot and depot now sit inside a site, built in `src/scene/SiteYard.ts`
    for the main site only, not the speed preview's side plot. Site set-up
    is always there, on every day: a mesh fence round the plot and depot
    with an entrance on the depot's front, its gates swung open to the road
    and cones beside them; signs reading "Site entrance", "Site office", and
    "Hard hats and hi-vis must be worn on site"; two stacked site cabins
    with an outside stair at the back of the depot; two toilets by the gate;
    a skip by the crane; and a lighting tower with its generator at the
    plot's back corner. Once the plot has been worked it also has a gravel
    ring road round the tower where the crew walks, a gravel haul road from
    the depot to where the machines work, tire tracks, a spoil heap, and
    materials laid down along the plot's back and left edges, clear of the
    ring road, the hoist, and the bulldozer's passes: pallets of blocks,
    timber, cement, rebar, pipes, formwork, and a pallet at the bay where the
    laborer drops loads. A day of plans keeps its grass and has none of
    these.
20. **The whole plot is cleared.** The bulldozer used to clear a strip
    across the plot's middle. Now its front clears the whole
    plot, as a site strips its topsoil, so the laydown stands on bare earth.
21. **Signs are text, and cones follow the vests.** The signs are canvas
    text, which spec 10 allows; there are no picture textures. Cones are
    blue in the strict palette and hi-vis orange in accents mode, like the
    workers' vests (spec 5.3).
22. **One mesh per material.** The yard is built from a few shared shapes
    and then merged into one mesh per material, so it costs 88 draw calls,
    shadows included, rather than about 270. Measured as in decision 25:
    95th percentile frame 6.2 ms with the yard and 5.6 ms without.

### Under the hood

23. **Shadows from the outer faces.** A facade drawn as a shell shaded its
    own outer faces in fine stripes once it stood for more than a moment.
    Its shadows now come from back faces only, as for any one sided
    material.
24. **A calm frame rate.** The crew at work keeps the scene animating all
    day, so when nothing else moves the live site runs at 30 frames a second.
    Anything else moving, a job, the camera, or the idle orbit, brings back
    the full rate.
25. **Measured.** On an Apple M1 Pro in headless Chrome at 1600 × 1000, with
    the GPU finishing each frame: a 3 hour block mid cladding at 30 frames
    a second, 95th percentile 4.5 ms, of which working out the site took
    0.7 ms. A scripted day from 6:55 to 18:05 in 30 second steps, with a 15
    minute, an hour, and a 3 hour block, a resize, a deletion of the block
    under way and its undo, a past block added, a plan moved, a demolition,
    and reduced motion and a new speed along the way, logged no console
    errors. The geometry count settled at 158 after the first demolition and
    held through the afternoon and a day change.

### A bustling site

26. **Always building (your call, October 6, 2026).** The site is a model
    of the building going up in real time, so something is always under way
    while the block's time runs. Measured over a 90 minute block on the
    tower, the crane is moving 85% of the time and rests longest, under two
    minutes, at the strike; no one on the tower stands still for more than
    44 seconds, and the banksman signals 82% of the time. On the day's first block of an hour the crane moves 76% of the
    time, and on a 4 hour block 85%. This takes over from parts of
    decisions 3 to 6, as below.
27. **Every piece is its own lift.** Each column, each beam, a bundle of
    deck sheets for each floor, each facade panel (four to a band), and the
    roof cap is one crane lift from the yard to where it goes. A lift takes
    up to 14 seconds at speed 1, not decision 4's nine; on a crowded
    program it shortens, down to 5, so a floor's nine frame lifts and the
    crane's swings back fill no more than 60% of the floor's time. Between pieces the crane brings bundles of rebar,
    formwork, and scaffold where the work is: into the pit, onto the roof
    below before its floor is started, onto the deck being framed, and onto
    the scaffold planks, and at the strike it takes the scaffold back down
    to the yard. Nothing is set on a pit being dug or a floor being poured,
    so then it stocks a laydown at the front of the site, beside the crew
    tying rebar, in two spots used in turn. A bundle set down is used 75
    seconds after it lands, as the crew starts on the floor it sits on, or
    when the next one is set down in its place.
28. **Loads hang on slings.** A load hangs from the hook block on sling
    legs: one strop on a column, two legs on a beam or a panel, four on a
    bundle or the roof cap. Each kind hangs at its own length, longer for
    wide loads so the legs stay steep, and the crane carries a load high
    enough that its foot clears the tower. Columns and panels hang upright,
    and stand on their rack as the hook takes them.
29. **A stocked yard.** A stockyard on the depot by the crane holds racks of
    columns, beams, deck sheets, and facade panels in the block's color,
    beside a pile of bundles. The racks open the block stocked and run down
    as the crane picks. Whenever a pick would take a rack below its reserve,
    a flatbed truck comes in time to top every rack up, and a last load
    after the final pick leaves the yard as it opened, so blocks back to
    back match. The truck comes along a street in front of the site, backs
    up a ramp through the gate, is unloaded by the laborer, and drives off;
    one truck is on site at a time, about every 20 minutes on a long block.

    | Rack | Opens and ends with | Reserve | Holds at most |
    |---|---|---|---|
    | Columns | 8 | 3 | 12 |
    | Beams | 8 | 3 | 12 |
    | Deck sheets, in bundles of two | 3 | 1 | 5 |
    | Facade panels | 6 | 2 | 8 |

    The crew's old pile of beams and panels by the crane now shows only on
    the speed preview's side plot.
30. **Up to eight on site, by trade.** Under 15 minutes four work the
    block, under 30 minutes six, and from 30 minutes eight: the foreman, two
    connectors who guide in and bolt the frame, two cladders who fit the
    panels, a banksman, a slinger who hooks each load on at the yard, and a
    laborer who unloads the trucks and carries to the bay. A crew of six
    has no laborer or second cladder, and a crew of four no banksman or
    second connector either. This takes over from decision 5. The block under way
    keeps a pool of ten workers, not decision 6's six.
31. **No standing about.** While the machines clear and dig, the crew along
    the front checks levels, ties rebar cages, and carries formwork boards
    from a laydown. On the tower they carry planks and load the hoist cage
    until it goes up, tie the mesh on the roof below, and work the concrete
    level as the pump pours. On the frame each connector guides a piece in
    and bolts it with sparks flying, a burst every 0.7 seconds, from small
    pooled emitters in white and pale blue. At the strike they unclip the
    scaffold at each level as it comes down. The banksman has a new signal
    pose, right arm up with the hand circling and left arm out to the load,
    held from the start of each lift until the crane is back over the yard,
    and while the mixer is in.
32. **The speed preview borrows the crane.** Decision 7 meant the preview
    to borrow the crane and machines, but its job never said so, so the
    live site kept driving the crane at the side plot. It now borrows what
    the build it plays borrows. A load on the hook when a job takes the
    crane goes where the clock puts it rather than hanging in the air.
33. **Measured.** As in decision 25: mid frame on a 90 minute block the
    scene draws 614 calls with shadows, up from 519; working out the site
    each frame takes under 0.1 ms; planning an 8 hour block, 1,090 lifts and
    22 deliveries, takes 15 to 25 ms once. Days with a first block, a block
    over free time, and blocks on the tower of 15 minutes, 90 minutes, 4
    hours, and 8 hours, in reduced motion and through the speed preview,
    logged no console errors.

### Smooth and busy

34. **Smooth motion (your report, October 6, 2026: "it looks really
    choppy").** The site read the clock in whole seconds, so everything on
    it moved in one second steps and a walk cycle barely changed between
    them; it now reads milliseconds. It also drew 30 frames a second when
    nothing else moved, under decision 24; it now draws every frame the
    display shows while a block is building, which takes over from
    decision 24. Measured in headless Chrome: a frame every 16.7 ms at 60
    a second.
35. **The crane glides.** The hook used to drop from the top of the tower
    to the yard in about two seconds, at up to 34 units a second. Now each
    lift overlaps its motions as a crane driver would: the hook rises and
    falls during the swing wherever it is clear of what stands, travels
    only as high as the frame and scaffold actually stand at that moment,
    not the finished block, and between lifts waits low over the yard
    rather than up at the jib. Each load's sideways reach is counted in
    clearing the tower. Over a 90 minute block the hook's 99th percentile
    speed is 7 units a second, and checking every carry found no load below
    the top of what stands while over the tower, other than a column's
    last half unit onto its corner and scaffold taken off the scaffold.
36. **No dashes, snaps, or jumps.** Machines, the delivery truck, the hoist
    cage, and climbers now pull away, hold a steady speed, and slow to a
    stop, rather than easing in and out, which tripled their speed midway.
    The mixer backs up at 1 unit a second, the truck has 12 seconds to
    drive in and reverses straight back before turning into the lane, and
    a crew member short of time hurries to at most twice a walk rather
    than dashing. The crew turns smoothly instead of flipping round in a
    frame. Screeding and carrying used to run on past their end, so the
    next move started from somewhere else and the worker jumped; they now
    end where the next move begins. Measured frame by frame at 30 a second
    over whole blocks: no worker faster than a jog, and no jump anywhere.
37. **Ten on site from an hour.** Blocks of an hour or more add two to
    decision 30's eight. A hoist driver runs materials up all through the
    frame and the facade: loads the cage from the road, rides up to the
    deck being worked, unloads, and rides back down, riding about two
    thirds of their time on site. Where there is no hoist, on the day's
    first block at ground level, they carry from the yard round to the
    tower instead. A traffic marshal sweeps the gateway and stands aside at
    the gate post to wave each truck in and out. The hoist now comes to
    anyone waiting for it before they step on.
38. **Busy to the last moment.** The crane brings scaffold down to the yard
    until near the end of the strike, then parks, and the foreman and the
    marshal walk out just as the time is up. Stepping through whole blocks
    a second at a time, something on site is moving all the way through
    but for a few seconds at the very end: the longest still moment is 6
    seconds on a 90 minute block, 3 on an hour, none on 15 minutes, and 19
    on 4 hours, where it used to be up to a minute. The crane is moving 81 to 87% of the time.

### Grass round the site

39. **A lawn round the site (your request, October 6, 2026: "add green
    grass around the construction site").** The main site now stands in a
    lawn. The ground is green right up to the fence and fades into the
    theme's ground, spec 5.8's white or slateDark, between 14 and 45 units
    out, so the far ground and the haze look as they did. About 6,000
    blades grow outside the fence, thickest along it and thinning out to 6
    units, kept off the street, the ramp, and the cones at the gate. On the
    dark theme the lawn darkens 55% of the way to slateDark, as the ground
    does, and a theme change tweens it with the rest. The street now runs
    the width of the ground into the haze both ways, where it used to stop
    in the open a few units past the fence. The speed preview's side plot
    has no lawn.
40. **Grass is green in either palette mode.** Spec 5.3 keeps green to the
    opt-in accents mode and draws strict mode's grass in slateLight. A green
    lawn round a slateLight plot would put a gray patch of grass inside a
    green field on every day of plans, so the plot's grass is green too,
    from the same `grass` token, and accents mode now adds only hi-vis
    orange, for the vests and cones. The settings note and the README say
    so. No new color comes in: `grass` is the token the spec already had.
41. **Measured.** The blades add one draw call and about 48,000 triangles,
    and cast no shadows. Mid build at 11:20 in headless Chrome, a frame
    every 16.7 ms, 95th percentile 16.8 ms, with no console errors through
    theme changes both ways.

### The view

39. **A free view (your call, October 6, 2026).** Spec 8.7 held the camera
    between 0.25 and 0.47 pi from straight overhead, between 12 and 80
    units away, and without panning. Now a drag on empty space turns the
    view to any angle above the ground, all the way round and from
    straight above down to looking up from just above the ground; the
    wheel zooms from 1 unit to 300, or three times the default framing on a
    very long day; and the right button or a Shift drag pans. A drag that starts on a block still moves or resizes it, and
    Shift with the wheel over the selected block still resizes it. Reset
    view, the idle orbit, and the reframing for a new roof work as before.
    So the site never fades away zoomed out, the fog of spec 8.8 starts 60
    and ends 140 units from the camera at the default framing and moves out
    as the view zooms past it, the camera's far plane grows with the zoom
    limit, and the ground plane is now 4,000 units across, so its edge
    never shows.

### Detailed grass

42. **Blades everywhere it is green (your request, October 6, 2026: "make
    the grass more detailed with more visible blades of grass everywhere it
    is green").** The cones of spec 8.2, and the 6,000 blades by the fence
    under "Grass round the site", are now tufts, built in
    `src/scene/Grass.ts`: six thin three sided blades leaning out from a
    root, dark at the root and light at the tip, each tuft turned, sized,
    and shaded its own way, a little warmer or cooler. They stand about 16 to the square unit wherever the grass is
    full, on the plot and across the whole lawn, about 1,550 on the plot
    and 55,000 in the lawn. As the lawn fades they thin out, shrink, and
    fade into the ground's color with it, so none stand out on the pale
    ground past it. The ground between them is darker than the blades, 62%
    of their color, so they show against it, and lighter and darker patches
    from a few units to about ten across run through the lawn's ground and
    its tufts alike. The bulldozer clears the plot tuft by tuft as it did
    blade by blade. The street is now 4,000 units long, as wide as the
    ground the free view brought in.
43. **Measured.** About a million triangles in one draw call for the lawn
    and one for the plot, casting no shadows. In headless Chrome at 1600 ×
    1000 with the GPU finishing each frame, a mid build frame takes 5.1 ms
    against 2.8 ms without the lawn at a pixel ratio of 1, and 7.2 ms
    against 4.4 ms at 2, 95th percentile 8.7 ms. No console errors in
    either theme.
44. **More pronounced blades (your request, October 6, 2026: "make the
    blades of grass a little more pronounced").** The blades are about a
    fifth taller, 0.16 to 0.27 units before each tuft's own sizing, and a
    quarter wider at the root, and the ground between the tufts is a
    little darker, 55% of the blades' color rather than 62%, so they show
    more against it. Same count and triangles as decision 43; a mid build
    frame at a pixel ratio of 2 costs 2.4 ms more with the lawn than
    without, about what it did.
45. **A street that holds steady (your report, October 6, 2026: "the
    road glitches out").** The street was a box 0.004 units thick laid on
    the ground plane, which is two triangles 4,000 units across. Their
    depths came so close that the ground showed through the street in jags
    that moved with the camera, worst low down along it, and zoomed out
    the lawn swallowed it almost whole. The ground plane's shader now
    paints the street and its center dashes itself (`STREET_GLSL` in
    `src/scene/SiteYard.ts`), with the edges smoothed over a pixel, so
    nothing lies on the ground to fight it. Checked low along the street,
    at a grazing angle, zoomed out, and in both themes: straight and solid
    every time. The ramp up to the gate is still its own slope.
46. **Labels on the left (your request, October 6, 2026: "make the tags on
    the left side so they dont block the crane").** Spec 8.5 puts each
    block's label on the right, where the tower crane stands at the default
    view, so the labels hid its mast and the loads going up. They now stand
    on the camera's left, mirrored in every other way: the same columns,
    leader lines, and room, which the centered framing makes the same on
    both sides. The hoist climbs the tower's left side, so the labels start
    1.1 units out from the tower rather than 0.4, and the now card 0.55 out
    from its ring rather than 0.25, both clear of the hoist's mast and cage.
    The now card stays on the left, where it does not cover the crane at
    the height it works; a label at the card's height steps out past it,
    on a leader line, and labels further out already clear it. Checked at
    the default view at 9:30 and 11:20, and on a day of 44 quarter hour
    blocks, the most the window holds: 45 cards, none overlapping, all on
    screen.
40. **Never beneath the ground (your call, October 6, 2026).** The first
    free view let the camera tilt under the ground and look up at the
    underside of the plot. The camera now stays at least 0.3 units above
    the plot's top: how far it can tilt under what it looks at is set each
    frame from how high that point stands and how far off the camera is,
    so close to the tower it can still look up from ground level. Panning
    also keeps what it looks at above the ground, no more than 40 units out
    from the tower, and no higher than the day's tower plus 10, so a pan
    can never lose the site in empty sky. Tried with real drags, pans, and
    zooms: the camera never went below the floor.

## After M5: Meetings from Outlook

On October 6, 2026 the user asked to connect the app to their Microsoft
Teams calendar and to have it update automatically. They chose Microsoft
Graph over a published calendar link, and a sign-in written by hand over
Microsoft's MSAL library, so three stays the only runtime dependency. This
lifts the spec 2 non-goal of calendar sync and network calls, for Outlook
only; the app still works offline when it is not connected.

### Sync

1. **The viewed day, while the app is open.** It is fetched when the app
   opens, every 5 minutes (checked every 30 seconds, skipped while the tab
   is hidden), on coming back to the tab after a minute or more, when the
   browser comes back online, and 0.4 seconds after a day change, so paging
   through days fetches only where it stops. Graph's change notifications
   need a server, so there are none.
2. **calendarView in UTC.** `/me/calendarView` from local midnight to local
   midnight, with `Prefer: outlook.timezone="UTC"`, so Graph expands
   recurring meetings into occurrences and no time zone table is needed. A
   reply in any other zone is refused rather than guessed. Pages are
   followed only on graph.microsoft.com, at most ten, so the token never
   goes anywhere else.
3. **Which events are meetings.** Timed events that are not canceled or
   declined and not marked free or working elsewhere. Tentative ones,
   unanswered invites, and out of office time are kept, since Outlook shows
   them as taken. All day events are left out.
4. **Placing.** Each meeting is clipped to the day window and widened to
   the slot grid (10:05 to 10:25 fills 10:00 to 10:30); if that runs into
   something, it takes the slots fully inside its time instead. The user's
   own blocks never give way (M2 decision 1): a meeting that would overlap
   one is left off and reported with what is in the way. Between meetings,
   accepted or organized ones go first, then tentative, then unanswered,
   then earlier, then longer. A meeting past the 48 block limit is left off
   too.
5. **Outlook owns time and title.** The store refuses any other change to a
   meeting's time or title, refuses to demolish it, and will not swap a
   block with one by Move earlier or later. The inspector and list view
   show them read only with a note, and a drag on a meeting only selects
   it. Its color stays the user's to pick, and a sync keeps it.
6. **Replanning without a fetch.** The last reply for each day is kept in
   memory, so the user's own edits, a saved settings change, an import, or
   Clear all data replan from it at once: free the time and a waiting
   meeting appears. A settings preview waits for Save or Cancel. The
   store announces applied meetings as their own change origin,
   `calendar`, so replanning never loops.
7. **The category.** Meetings go in the category picked under Meetings go
   in; by default the one named Meetings, else the default Meetings
   category by id, else the first. No category is created. Picking another
   moves the meetings in the old one.
8. **Clearing and copying.** Clear this day leaves meetings in place and
   undo restores the rest. Copying a day copies only the user's own blocks,
   onto a day with none of its own, and leaves out any that would overlap a
   meeting there; the toast says how many. A day with only meetings is not
   offered as a copy source.
9. **Shown at once.** Like imports (real time builds decision 13), synced
   changes finish whatever is playing and show at once; from then on a
   meeting builds by the clock like any block.
10. **Telling the user.** A meeting that overlaps a block, or does not fit a
    full day, raises a toast once per meeting in a tab, with Show opening
    Settings, where every meeting not on the tower is listed with its
    reason. Meetings outside the day window are only listed, since a short
    window is often on purpose.

### Sign-in

11. **The authorization code flow with PKCE, by hand.** The page goes to
    Microsoft and comes back with the code in the URL fragment (a redirect,
    not a popup, which could be blocked). The state is checked against
    session storage, the challenge is S256, and the code is cleared from
    the address bar at once. The scopes are `openid profile offline_access`
    and `Calendars.Read`, read only. The ID token is read only for the
    name shown in Settings, so its signature is not checked.
12. **Where the sign-in lives.** `timetower.outlook` in local storage holds
    the two ids, the category, the account, and the refresh token; the
    access token stays in memory. It is apart from `timetower.save`, so
    Export never writes out a sign-in and an import never brings one.
    Anyone with this browser profile could read the refresh token; it can
    only read the calendar and lasts 24 hours.
13. **The 24 hour limit.** Microsoft gives browser apps refresh tokens that
    end 24 hours after sign-in. When one has run out as the app opens and
    nothing has been touched yet, the page tries once per tab to sign in
    again without a prompt (`prompt=none` with the account as a hint),
    which works while the browser is signed in to Microsoft 365. Otherwise
    an "Outlook sign-in has expired" chip below the top bar offers
    Reconnect, and the meetings stay as they were.
14. **Errors explained.** Common sign-in errors become what to fix: a
    missing or web platform redirect URI, an unknown client or tenant, and
    admin consent. A Graph problem that needs the user (401 after a
    renewed token, 403, 404) shows a "Meetings from Outlook are not
    updating" chip with Details; anything that a later try may fix, such as
    being offline, is only noted in Settings.
15. **The ids.** Typed in Settings, or set as `VITE_OUTLOOK_CLIENT_ID` and
    `VITE_OUTLOOK_TENANT_ID` in `.env.local`, now ignored by git. The tenant
    may be its id or the organization's domain. The redirect URI is the
    page's own address, shown in Settings to copy, so it must be registered
    for each port the app is served from.
16. **Clear all data keeps the connection.** It erases plans and settings,
    but the connection is not plan data, and Disconnect sits right beside
    it, so meetings come back on the next replan.

### Data

17. **eventId without a new version.** A meeting's block carries an
    optional `eventId`. Files without one read as before, so no version 2
    and no migration step; migrate keeps a valid one and turns a broken one
    into an ordinary block, with a note. An older copy of the app reading a
    newer file drops the field and keeps the meeting as an ordinary block.
18. **Disconnect asks.** Keep the meetings as the user's own blocks, which
    makes them editable everywhere, or remove them.

### Checked

19. **Tests and a full run.** 256 unit tests, 45 of them new, cover placing,
    the store's rules, reading Graph, PKCE against the RFC 7636 example,
    the sign-in requests, and the error messages. The whole flow then ran
    in headless Chrome against the real app, with Microsoft's sign-in and
    Graph answered through the DevTools protocol: connect, redirect, code
    redemption, the first sync, conflicts, an edit that frees time, moved,
    renamed, canceled, and new meetings, a day change, the sign-in
    running out with the silent try, Reconnect, and Disconnect, 40 checks
    with no console errors, in both themes. Not yet run against Microsoft
    itself, which needs the app registration.

## After M5: A Mac app

On October 6, 2026 the user asked to make Time Tower a widget they can open
that sits somewhere on their computer. Desktop and Notification Center
widgets on macOS are still pictures and cannot run the 3D scene, so of two
ways to give it a window of its own, the user chose a small Mac app over
installing the page from Chrome. Nothing in `src/` changed.

### The app

1. **A Swift wrapper, no new packages.** `desktop/TimeTower.swift` is one
   file of AppKit and WebKit, compiled by `swiftc` from the Xcode command
   line tools. three stays the only runtime dependency; Electron would have
   added a large one and Tauri a Rust toolchain. The page is the same
   production build, copied into the app.
2. **Served from inside the app at `http://localhost:5199/`.** Saved plans
   belong to an origin, WebKit is unreliable with module scripts from file
   URLs, and a custom URL scheme cannot be a redirect URI for a single-page
   app in Entra ID, so a small server on the Network framework serves the
   app's web folder on a fixed port. It answers GET and HEAD on the
   loopback interface only, refuses Host headers other than its own (so a
   page that points its own name at this Mac gets a 403), refuses paths
   outside the folder, and sends no-cache. 5199 sits clear of Vite's 5173
   and up and of preview's 4173. If the port is taken, the app says so and
   quits rather than show another program's page.
3. **Its own plans.** WebKit keeps the app's storage apart from Chrome's,
   so plans move over once with Export JSON and Import JSON. Outlook needs
   `http://localhost:5199/` added as a second redirect URI.
4. **The window.** It opens 1100 by 760 and centered, then where it was last
   left; it can shrink to 480 by 360. Keep on top (Option Command T) puts
   it at the floating level, above other apps' windows. Show on every
   desktop joins all Spaces. Zoom in, Zoom out, and Actual size scale the
   page and are kept, which is how a small window fits a page designed for
   1100 px. Closing the window quits the app.
5. **Open at login** sits in the app menu, through SMAppService, and is off
   until chosen.
6. **What a browser does that WebKit leaves to the app.** An Edit menu, so
   copy and paste work in fields. Export goes through a save panel that
   starts in Downloads, Import through an open panel. Alerts and confirms
   become sheets. Links that ask for a new window open in the default
   browser. Reload (Command R) loads the page afresh, which is also the way
   back from any sign-in page, and a crashed page reloads by itself.
   Safari's Develop menu can inspect the page.
7. **The user agent names Safari.** WebKit's bare user agent leaves out
   Safari's version, and some sign-in pages turn away browsers they do not
   recognize.
8. **The icon is drawn at build time.** `desktop/MakeIcon.swift` draws
   three built blocks on a lawn with the next block a see through plan, in
   the standard macOS icon shape. Its colors come from `tokens.ts` through
   Node, so hex values stay in that one file.
9. **Signed ad hoc, installed to `~/Applications`.** `npm run desktop`
   builds and copies it, with no Apple developer account: Gatekeeper does
   not quarantine an app the Mac built itself. `bash desktop/build.sh`
   builds without installing.

### Checked

10. **A test build drove the real app.** `swiftc -D TESTING` adds hooks
    that run a script in the page, stand in for the save and open panels,
    click with real mouse events, and save a snapshot; the test copy had
    its own bundle id, storage, and port 5198. The server answered with the
    right types, empty HEAD bodies, 404 for missing files, folders, and
    `..` paths, 403 for another Host, 405 for POST, on IPv4 and IPv6, and
    refused connections to the Mac's network address. WebGL2 rendered the
    tower with no page errors. Export saved its file; Import, clicked with
    real mouse events since WebKit opens the file picker only for the
    user's own clicks, replaced the data with a five block day, which was
    still there after a quit and relaunch seconds later. Python holding the
    port, on 127.0.0.1 or on all addresses, brought up the alert instead of
    its page. Keep on top set the floating window level, and off set the
    normal one. A 640 by 520 window at 80% zoom fit the page without
    sideways scrolling. Not checked: the menus and panels by hand, Open at
    login, and Outlook sign-in inside the app, where company sign-in rules
    may treat the app's WebKit differently from a browser.

### Picking up new builds

11. **The open app takes up a new build by itself.** The user asked for main
    to reach the app without steps. `build.sh` leaves a stamp in the app: a
    hash of `index.html`, which names every asset by its content hash, a
    hash of `TimeTower.swift`, and the commit. The open app reads it every
    3 seconds and whenever it stops being the active app. A new page
    reloads it; new app code quits it and opens it again with `open -g`,
    behind whatever the user is in, once the old copy has let go of its
    port. It acts only while the user is in another app, so nothing reloads
    under the pointer or in the middle of an edit, and never while a
    Microsoft sign-in page is showing. It logs to the `timetower`
    subsystem.
12. **Installing is a swap.** `build.sh --install` moves the new bundle in
    with two renames instead of deleting and copying, so an open copy never
    serves from a half copied folder, and no second copy stays in
    `desktop/build` for Spotlight to offer. `TIMETOWER_APPS_DIR` changes
    where it goes, for tests.
13. **About shows the commit,** with "with changes" for a build made from
    edits not yet committed, which answers whether the app is current.
14. **Rebuilding on every change to main waits on the user.** A
    reference-transaction git hook, which fires however main moves, was to
    export the commit to a clean folder, run the tests, and install only if
    they pass. Claude Code's permission check stopped the script that
    installs the hook, as persistence, so that part is the user's call.
    Until then, `npm run desktop` after a change, and the open app does the
    rest.
15. **Checked with the test copy.** Started in the background with
    `open -g`, it left VS Code in front. A changed page stamp reloaded the
    page within one check, logged, in the same process. A changed app stamp
    while the test copy was the front app did nothing until VS Code came
    forward; then it quit, opened again, and served the page within
    seconds, with VS Code still in front. Two installs in a row into a
    scratch folder left one copy with a valid signature and nothing behind.

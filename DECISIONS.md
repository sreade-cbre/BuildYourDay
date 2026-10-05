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

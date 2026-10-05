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
    yet, so development builds open on the section 20 sample day. The "Load
    sample day" button replaces this in a later milestone.

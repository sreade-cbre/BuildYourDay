# Time Tower: Build Specification

Version 1.0, October 2026. Written for implementation by Claude Code running Opus 5.5.

---

## 0. How to use this document

1. Read the whole document before writing any code. Sections 5 through 11 define things that look independent but share constants and state.
2. Build in the milestone order given in section 21. Each milestone has acceptance criteria. Do not start the next milestone until the current one passes.
3. Where this spec says "default", implement the default and expose the setting. Where it says "fixed", do not expose a setting.
4. Section 23 lists open decisions. Each has a default. Use the default unless the user has told you otherwise in the conversation.
5. Writing rules for every string that reaches the screen (UI labels, tooltips, placeholder text, error messages, comments in exported files): no em dashes or en dashes, American spelling, sentence case. This also applies to code comments and commit messages.

---

## 1. Summary

Time Tower is a local, single-user, 3D time blocking app that runs in the browser from a Vite dev server or a static build. One day is one tower. Each time block is a box whose height is proportional to its duration, stacked in chronological order from the ground up. Free time between blocks is a hollow wireframe gap. A ring marks the current time and rises through the tower during the day.

The distinguishing feature is how blocks arrive. When the user adds a block, the top of the tower becomes a construction site. Miniature workers and machines survey the footprint, prepare the site, pour a foundation, raise a structural frame, wrap it in scaffolding, clad it, cap it, strike the scaffold, and clean up. The whole sequence runs in a few seconds and ends with the finished box sitting on the tower. The very first block of the day starts from a grass plot. Deleting a block triggers a demolition. Resizing a block triggers a partial build or partial demolition. Moving a block has a crane lift it into place.

Everything is styled in the Turner & Townsend brand palette: Navy, Blue, Slate, White, and light gray, with Georgia for headings and Verdana for everything else.

---

## 2. Goals and non-goals

### Goals

- Show at a glance how a day is divided. Height is duration. No number needs to be read to understand proportion.
- Make adding a block satisfying enough that the user wants to plan the day.
- Stay lightweight: one runtime dependency (three), no backend, no accounts, no build complexity beyond Vite.
- Persist locally and survive refresh.
- Respect user settings for the day window and slot size.
- Stay strictly on brand.

### Non-goals (v1)

- Multi-day views, week views, or recurring blocks.
- Calendar sync, notifications, reminders, or any network calls.
- Mobile layouts. Target is a desktop browser window 1100 px wide or more.
- Sound. Design the animation system so sound hooks can be added later, but ship silent.
- Real physics. All motion is tweened. No physics engine.
- Day windows that cross midnight.

---

## 3. Glossary

| Term | Meaning |
|---|---|
| Day window | The span the user plans, for example 07:00 to 18:00. Set in settings. |
| Slot | The smallest unit of time a block can snap to. Default 15 minutes. |
| Block | A planned span of time with a title and a category. Rendered as a box. |
| Gap | Unplanned time between blocks or at the ends of the day window. Rendered as a wireframe. |
| Tower | All blocks and gaps for one day, stacked chronologically from the ground. |
| Plot | The ground tile the tower sits on. Starts as grass. |
| Now ring | A thin ring around the tower at the current time's height. |
| Job | One construction, demolition, resize, or move animation for one block. |
| Director | The system that turns a job into a timeline of animated phases. |
| Phase | One stage of a job, for example "foundation" or "cladding". |
| Crew | The pool of worker characters and machines. |
| Depot | A pad beside the plot where machines park when idle. |

---

## 4. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript, strict mode | No `any` outside third-party typings. |
| Bundler and dev server | Vite | `npm run dev`, `npm run build`, `npm run preview`. |
| 3D | three (latest stable from npm) | Import addons from `three/addons/...`. OrbitControls from `three/addons/controls/OrbitControls.js`. |
| UI overlay | Plain HTML and CSS, DOM manipulated from TypeScript | No React, no UI framework. |
| Animation | Custom `Timeline` class (section 9.3) | No GSAP. The timeline is small and fully controlled. |
| Tests | Vitest | Pure logic only: time math, layout, store, migrations. |
| Persistence | `localStorage` | One key, versioned schema, JSON export and import. |
| Fonts | Georgia and Verdana as system fonts with fallbacks | No web font downloads. The app must work offline. |

Runtime dependencies: `three` only. Dev dependencies: `vite`, `typescript`, `vitest`, `@types/three`.

Browser targets: current Chrome, Edge, Safari, Firefox. WebGL2 required. Show a plain HTML message if WebGL2 is unavailable.

---

## 5. Brand and visual language

### 5.1 Palette

The base palette is fixed. These five colors are the only colors permitted in strict mode.

| Token | Hex | Role |
|---|---|---|
| `navy` | `#1E4479` | Primary. Headings, key borders, dark backgrounds, the default "deep work" category. |
| `blue` | `#0090DC` | Accent. Links, active states, the now ring, machine bodies, the default "meetings" category. |
| `slate` | `#505A60` | Secondary. Body text, metadata, structural frame members, the default "admin" category. |
| `white` | `#FFFFFF` | Neutral. Panels, hard hats, text on dark fills. |
| `lightGray` | `#F5F5F5` | Neutral. Page background in light theme, alternating rows, dust. |

### 5.2 Derived tokens

To shade 3D geometry and give depth without leaving the brand hues, the following tints and shades are derived from the base colors by mixing toward white or black. They keep the brand hue and vary only lightness. Treat them as the complete allowed set. Do not invent others.

| Token | Hex | Derivation |
|---|---|---|
| `navyLight` | `#788FAF` | navy mixed 40% toward white |
| `navyPale` | `#BCC7D7` | navy mixed 70% toward white |
| `navyDark` | `#153055` | navy mixed 30% toward black |
| `blueLight` | `#66BCEA` | blue mixed 40% toward white |
| `bluePale` | `#B2DEF4` | blue mixed 70% toward white |
| `blueDark` | `#00659A` | blue mixed 30% toward black |
| `slateLight` | `#969CA0` | slate mixed 40% toward white |
| `slatePale` | `#CACED0` | slate mixed 70% toward white |
| `slateDark` | `#383F43` | slate mixed 30% toward black |

Put all tokens in `src/brand/tokens.ts` as a single exported object and in `src/styles.css` as CSS custom properties with the same names. Nothing else in the codebase may contain a hex literal. A lint-style test in `tests/brand.test.ts` must grep `src/` (excluding `tokens.ts`) and fail if it finds a hex color literal.

### 5.3 Palette modes

Setting `paletteMode` has two values:

- `strict` (default): only the tokens above. Grass is rendered in `slateLight` with blade geometry so it reads as turf by shape rather than color. Workers wear `blue` vests and `white` hard hats. Machines are `blue` bodies with `navy` details and `slateDark` tracks and tires.
- `accents`: adds exactly two extra tokens, `grass` `#7FA86B` and `hiVis` `#F28C28`, used only for the grass plot and worker vests. This mode exists so the user can opt in to a more literal construction look. It must be explicitly chosen in settings and defaults off. See section 23.

### 5.4 Category colors

Categories pick a color from a fixed swatch list drawn from the tokens: `navy`, `navyLight`, `navyDark`, `blue`, `blueLight`, `blueDark`, `slate`, `slateLight`, `slateDark`. Users cannot enter arbitrary colors. Defaults:

| Category | Color |
|---|---|
| Deep work | `navy` |
| Meetings | `blue` |
| Admin | `slate` |

### 5.5 Typography (HTML overlay only)

| Use | Font stack |
|---|---|
| Headings, the date title, block titles in the inspector | `Georgia, 'Times New Roman', serif` |
| All other UI text: labels, times, buttons, settings, totals, tooltips | `Verdana, Geneva, sans-serif` |

Heading color is `navy`. Body text color is `slate`. Links and active controls are `blue`. Minimum font size 12 px. Two weights only: normal and bold.

### 5.6 In-scene text

Block labels in the 3D scene are rendered as `CanvasTexture` sprites using Verdana, `slate` on a `white` rounded card at 85% opacity, positioned to the right of each block at mid height, always facing the camera, scaled so text is legible at the default camera distance. The site sign on the plot uses Georgia for the date in `white` on a `navy` board.

### 5.7 Materials

Use `MeshStandardMaterial` for everything solid. Roughness 0.85, metalness 0 by default. Set `THREE.ColorManagement.enabled = true` and `renderer.outputColorSpace = THREE.SRGBColorSpace`. Create colors with `new THREE.Color(token)` so sRGB conversion is handled by three.

Finished blocks: category color, roughness 0.75.
Weathered (past) blocks: same color lerped 35% toward `slateLight`, roughness 1.0 (section 11.4).
Frame members and scaffold tubes: `slateDark`.
Scaffold planks: `slatePale`.
Foundation slab: `slatePale` with `slateLight` edges.
Gaps: `LineDashedMaterial` in `slateLight`, dash 0.25, gap 0.15, plus an inner box in `slateLight` at opacity 0.06.
Now ring: `MeshStandardMaterial` in `blue` with emissive `blue` at intensity 0.6.
Dust particles: `PointsMaterial` in `lightGray`, size 0.08, opacity animated.

### 5.8 Themes

Setting `theme` is `light` (default) or `dark`.

| Element | Light | Dark |
|---|---|---|
| Scene background and fog | `lightGray` | `navyDark` |
| Ground beyond the plot | `white` | `slateDark` |
| Overlay panels | `white` with `slatePale` hairline border | `navyDark` with `navyLight` hairline border |
| Overlay body text | `slate` | `slatePale` |
| Overlay headings | `navy` | `white` |

---

## 6. Data model

Define these in `src/core/model.ts`. All times are minutes from midnight local time, integers. Dates are ISO `YYYY-MM-DD` strings in local time.

```ts
export type CategoryId = string;
export type BlockId = string;
export type IsoDate = string; // "2026-10-05"

export interface Category {
  id: CategoryId;
  name: string;            // 1 to 24 chars
  color: SwatchToken;      // one of the nine allowed tokens
}

export type SwatchToken =
  | 'navy' | 'navyLight' | 'navyDark'
  | 'blue' | 'blueLight' | 'blueDark'
  | 'slate' | 'slateLight' | 'slateDark';

export interface Block {
  id: BlockId;
  title: string;           // 0 to 60 chars, empty allowed, shown as "Untitled"
  start: number;           // minutes from midnight, multiple of slot
  end: number;             // minutes from midnight, > start, multiple of slot
  categoryId: CategoryId;
  createdAt: number;       // epoch ms
}

export interface Settings {
  dayStart: number;        // minutes from midnight, default 420 (07:00)
  dayEnd: number;          // minutes from midnight, default 1080 (18:00)
  slotMinutes: 5 | 10 | 15 | 30;   // default 15
  timeFormat: '12h' | '24h';       // default '12h'
  categories: Category[];          // default three, min 1, max 9
  animationSpeed: number;          // 0.5 to 3, default 1
  reducedMotion: 'system' | 'on' | 'off'; // default 'system'
  idleOrbit: boolean;              // default true
  labelMode: 'always' | 'hover';   // default 'always'
  weatherPastBlocks: boolean;      // default true
  theme: 'light' | 'dark';         // default 'light'
  paletteMode: 'strict' | 'accents'; // default 'strict'
}

export interface DayPlan {
  date: IsoDate;
  blocks: Block[];         // sorted by start, non-overlapping
}

export interface SaveFile {
  version: 1;
  settings: Settings;
  days: Record<IsoDate, DayPlan>;
  lastViewedDate: IsoDate;
}
```

Invariants, enforced in `src/core/store.ts` and covered by tests:

- Blocks within a day never overlap. `end` of one is at most `start` of the next.
- Every block lies within `[dayStart, dayEnd]`. If settings change so a block falls outside, the block is kept in data and rendered with a hatched `slateLight` material and a warning badge in the inspector; it is not deleted. Changing settings back restores it.
- `start` and `end` are multiples of `slotMinutes`. If `slotMinutes` changes to a coarser value, existing blocks keep their times and are rendered as is; new edits snap to the new slot.
- `dayEnd - dayStart` is between 240 and 1080 minutes.
- Deleting a category that blocks reference reassigns those blocks to the first remaining category. Deleting the last category is not allowed.

---

## 7. Time model and geometry

### 7.1 Constants

Define in `src/core/layout.ts`:

```ts
export const UNITS_PER_MINUTE = 0.05;   // 60 min = 3.0 world units tall
export const BLOCK_FOOTPRINT = 4.0;      // x and z extent of every block
export const PLOT_SIZE = 10.0;           // grass plot is 10 x 10
export const DEPOT_OFFSET = 8.0;         // depot pad center is 8 units in +x from plot center
export const MIN_BLOCK_UNITS = 0.25;     // a 5 min block at slot 5 is 0.25 tall; still visible
```

### 7.2 Mapping

- World y = 0 is the top of the foundation slab of the first block, which sits flush with the plot surface.
- A block spanning `[start, end]` occupies y from `(start - dayStart) * UNITS_PER_MINUTE` to `(end - dayStart) * UNITS_PER_MINUTE`.
- A gap is any uncovered range in `[dayStart, dayEnd]`. Gaps are computed, never stored.
- The tower is centered at world x = 0, z = 0.
- Tower height for camera framing is `(dayEnd - dayStart) * UNITS_PER_MINUTE`, not the height of the topmost block, so the camera does not jump as blocks are added.

### 7.3 Pure functions (unit tested)

```ts
minutesToY(minutes: number, settings: Settings): number
yToMinutes(y: number, settings: Settings): number        // unsnapped
snapToSlot(minutes: number, settings: Settings): number  // nearest slot, clamped to window
computeGaps(blocks: Block[], settings: Settings): Array<{start: number; end: number}>
totals(blocks: Block[], settings: Settings): { plannedMinutes: number; freeMinutes: number; byCategory: Record<CategoryId, number> }
formatTime(minutes: number, settings: Settings): string  // "7:30 AM" or "07:30"
formatDuration(minutes: number): string                  // "1h 30m", "45m", "2h"
canPlace(blocks: Block[], candidate: Block, settings: Settings): boolean
nextFreeRange(blocks: Block[], settings: Settings, minMinutes: number): {start: number; end: number} | null
```

### 7.4 Dates

- The app opens on today's date in local time.
- Previous and next day arrows move `lastViewedDate`. Any date can be planned.
- Day keys are local ISO dates. Do not use UTC anywhere in date logic.

---

## 8. Scene composition

### 8.1 Scene graph

```
Scene
  ├── Lights (hemisphere + directional with shadow)
  ├── Ground (large plane, receives shadow)
  ├── Plot (10 x 10 tile: grass or bare after site prep)
  │     └── SiteSign (navy board on two posts, shows the date)
  ├── Depot (pad with parked machines)
  ├── Tower
  │     ├── BlockMesh[] (one per block, keyed by block id)
  │     ├── GapMesh[]  (recomputed when blocks change)
  │     └── Labels[]   (sprite per block)
  ├── NowRing
  ├── Crane (shared tower crane, parked at depot when idle)
  ├── Crew (pooled Workers and Machines, hidden when idle)
  └── Effects (dust Points, outline helper for selection)
```

### 8.2 Ground and plot

- Ground: `PlaneGeometry` 200 x 200, `white` in light theme, `slateDark` in dark theme, `receiveShadow`.
- Plot: a 10 x 10 slab 0.3 units thick with its top at y = -0.3 before the first foundation, so the first slab sits in it. In strict mode the plot top is `slateLight`. On top of it, an `InstancedMesh` of about 2,500 small cones (`ConeGeometry(0.03, 0.18, 4)`) in `slateLight` with random slight tilt and height jitter. These are the grass blades. In accents mode the plot and blades use `grass`.
- Site sign: at the plot's front left corner. Board 2.0 x 1.0 in `navy`, two posts in `slateDark`. A `CanvasTexture` shows the date as "Monday, October 5" in Georgia, white. Updates when the viewed date changes.
- Depot: an 8 x 6 pad in `slatePale` at x = +8, where machines park between jobs. Machines face the plot when parked.

### 8.3 Block mesh

- `BoxGeometry(BLOCK_FOOTPRINT, height, BLOCK_FOOTPRINT)` with the mesh origin at the block's base so scaling the mesh in y grows it upward. Achieve this by translating the geometry by `height / 2` in y, or by parenting under a group positioned at the base.
- Material per category, shared across blocks of that category (one material per swatch token, created once).
- Edges: `EdgesGeometry` with `LineBasicMaterial` in the category's dark variant (`navyDark`, `blueDark`, or `slateDark`), opacity 0.5. Gives the box a crisp read against neighbors of the same color.
- A thin "floor line" ring every slot? No. Keep faces clean. Duration is read from height and the label.
- `castShadow` and `receiveShadow` true.
- `userData.blockId` set for raycasting.

### 8.4 Gap mesh

- Same footprint as blocks, `EdgesGeometry` in `slateLight` with `LineDashedMaterial` (call `computeLineDistances()`), plus an inner `BoxMesh` at opacity 0.06 so the volume is faintly visible.
- Gaps shorter than one slot are not rendered.
- Gaps are not selectable except via the "add here" affordance (section 12.1).

### 8.5 Labels

- One sprite per block, anchored at the block's right face, mid height, offset +0.4 in x and facing the camera.
- Text: title on line one in Georgia bold 20 px, time range and duration on line two in Verdana 16 px, for example "Pay app review" / "7:30 to 9:00 · 1h 30m".
- Blocks shorter than 0.6 units show the label with a 0.25 unit leader line to the right so labels do not overlap. If two labels would still overlap, stagger the shorter block's label outward by one more step.
- `labelMode: 'hover'` hides all labels except the hovered or selected block.

### 8.6 Now ring

- `TorusGeometry` with radius `BLOCK_FOOTPRINT * 0.78`, tube 0.05, rotated to lie flat, at y = `minutesToY(nowMinutes)`.
- Shown only when the viewed date is today and `nowMinutes` is within the day window. Otherwise hidden.
- Updates every 30 seconds and on tab focus. Position tweens over 0.6 seconds when it moves.
- A small `CanvasTexture` sprite beside it reads "now 10:40" in Verdana, `blue` on `white`.

### 8.7 Camera

- `PerspectiveCamera`, fov 38, near 0.1, far 500.
- `OrbitControls` with `enableDamping` 0.08, `minPolarAngle` 0.25 pi, `maxPolarAngle` 0.47 pi, `minDistance` 12, `maxDistance` 80, `enablePan` false, `screenSpacePanning` false.
- Target is `(0, towerHeight * 0.45, 0)` where `towerHeight` is the full day window height. Default distance frames the whole window with 15% margin top and bottom. Compute from fov and tower height on load and when the day window setting changes; tween the camera over 0.8 seconds.
- Idle orbit: after 20 seconds with no pointer, wheel, or key input, `autoRotate` true at `autoRotateSpeed` 0.4. Any input stops it. Disabled while a job is playing so the user sees the build from a stable angle, and disabled when `idleOrbit` is false.
- "Reset view" button returns to the default framing.

### 8.8 Lighting and atmosphere

- `HemisphereLight(white, slatePale, 0.9)`.
- `DirectionalLight(white, 1.4)` at `(12, 30, 18)`, `castShadow`, shadow map 2048, orthographic shadow camera sized to the plot plus full tower height, `shadow.bias` -0.0004, `PCFSoftShadowMap`.
- `scene.fog = new THREE.Fog(background, 60, 140)` so the ground fades out.
- Tone mapping `ACESFilmic`, exposure 1.0.

---

## 9. Construction animation system

This is the heart of the app. Read this section with section 10.

### 9.1 Principles

- Every construction follows the same phase order so it reads as a ritual. Durations scale with block height, but order never changes.
- Fast by default. A 60 minute block builds in about 6 seconds at speed 1. A 15 minute block in about 3.5 seconds. A 3 hour block in about 9 seconds. Scale with the square root of block height so big blocks feel bigger without becoming tedious.
- The user never waits on the animation. The block exists in data the moment it is added. Totals, labels, and the inspector update immediately. Only the mesh is under construction.
- Interruptible. Adding another block, deleting, or navigating days while a job runs fast-forwards the current job (section 9.6).
- Deterministic. Given the same block and seed, the same choreography plays. Use a seeded random generator (`mulberry32`) seeded from the block id for any jitter.

### 9.2 Job types

| Job | Trigger | Summary |
|---|---|---|
| `build` | Block added | Full phase sequence, sections 9.4 and 9.5 |
| `extend` | Block end moved later, or start moved earlier | Frame and cladding phases only, for the added floors, with scaffold on the affected face |
| `shrink` | Block end moved earlier, or start moved later | Partial demolition of the removed floors |
| `demolish` | Block deleted | Section 11.1 |
| `relocate` | Block moved to a different time | Section 11.3 |
| `settle` | Blocks above a changed block shift up or down | Blocks above tween to their new y with a small overshoot and dust puff at their base |

A single user action may enqueue several jobs. Example: deleting a block in the middle enqueues `demolish` for it and `settle` for every block above. Jobs from one action play as one composite timeline so they can overlap (blocks above start settling while dust from the demolition is still falling).

### 9.3 Timeline class

Implement `src/anim/Timeline.ts`:

```ts
export type Ease = (t: number) => number;
export interface Step {
  at: number;                 // start time in seconds, relative to timeline start
  duration: number;           // seconds, 0 allowed for instant steps
  ease?: Ease;                // default easeInOutCubic
  update: (t: number) => void; // t in [0, 1], called every frame while active, and once with 1 when complete
  onStart?: () => void;
  onComplete?: () => void;
}
export class Timeline {
  add(step: Step): this;
  addSequence(steps: Omit<Step, 'at'>[], startAt?: number): this;  // chains steps end to end
  duration: number;           // computed from steps
  play(speed: number): void;
  tick(dtSeconds: number): void;
  seek(seconds: number): void;
  fastForwardTo(seconds: number, overSeconds: number): void;  // ramps speed so it reaches `seconds` in `overSeconds` wall time
  finish(): void;             // seek to end, fire all completes
  readonly done: boolean;
}
```

Easing library: `linear`, `easeOutCubic`, `easeInOutCubic`, `easeOutBack` (overshoot 1.4), `easeOutBounce`. Nothing else is needed.

The `Director` (`src/anim/Director.ts`) owns a queue of composite timelines, ticks the active one from the render loop with `dt * settings.animationSpeed`, and exposes `isBusy`, `skip()`, and `onIdle` callbacks.

### 9.4 Build phases

Let `H` be the block height in world units and `F = max(1, round(H / (slotMinutes * UNITS_PER_MINUTE)))` the number of floors (one floor per slot). Let `s = sqrt(H / 3.0)` so a 60 minute block has `s = 1`. Phase durations below are at speed 1 and scale as noted. "First block" means the tower has no other blocks on this day when the job starts.

| # | Phase | Duration (s) | What happens |
|---|---|---|---|
| 0 | Survey | 0.5 | A surveyor walks from the depot to the site. A tripod (three thin cylinders and a small box) appears at one corner. A dashed outline of the footprint draws itself on the surface over 0.3 s (animate `LineDashedMaterial.dashOffset` or scale a pre-drawn line from 0 to 1 along its length). |
| 1 | Site prep | 0.6 first block, 0.5 stacked | First block: a bulldozer drives in from the depot and crosses the plot; grass blades under its path scale to 0 and the plot top material cross-fades from `slateLight` grass to `slatePale` bare earth. Stacked: a guard rail (posts and two rails in `slateDark`) appears around the roof edge of the current top block, and two workers ride a hoist cage up the tower's side from ground to roof. |
| 2 | Foundation | 0.8 × s, min 0.6 | An excavator arrives, does two bucket cycles (boom down, stick out, bucket curl, swing 60 degrees, dump). Four footing pads (`BoxGeometry 0.6 × 0.15 × 0.6` in `slatePale`) pop in at the corners with `easeOutBack`. A mixer truck backs in, drum rotating. The slab (`4.2 × 0.2 × 4.2`, `slatePale`) rises from scale y 0 to 1 with a slight wobble. Two workers with screed boards walk the slab length. |
| 3 | Frame | 1.2 × s, min 0.8 | The crane swings into position (section 10.4). Four corner columns (`0.12 × 0.12` cross section, `slateDark`) rise floor by floor. After each floor's columns reach height, four perimeter beams for that floor drop in from the crane hook with `easeOutBounce`. The crane hook visibly carries each beam from the depot stack to its position. For F > 6, batch beams two floors at a time so the phase stays within its duration. |
| 4 | Scaffold | 0.5 | A scaffold cage wraps the block: vertical tubes every 1.0 unit around the perimeter at 0.35 offset from the faces, horizontal ledgers every floor, planks on the front and right faces. Build with two `InstancedMesh` objects (tubes, planks). It appears bottom to top over the duration. Three workers appear on the planks. |
| 5 | Cladding | 1.3 × s, min 0.9 | The real block mesh is added with a clipping plane at its base. The plane's constant animates upward so the finished box reveals floor by floor behind the scaffold. Workers on the scaffold run a hammer animation (section 10.2) timed so a swing lands as each floor completes. A small dust puff fires at each floor completion. The crane delivers a panel (a thin `4 × floorHeight × 0.1` plate in the category color) to the top of the revealed region once per floor and the plate fades out as the clip plane passes it, selling the idea that panels become the facade. |
| 6 | Roof and strike | 0.7 | The crane places a roof cap (`4.1 × 0.08 × 4.1`, category dark variant) on top with `easeOutBack`. Scaffold despawns top to bottom (reverse of phase 4) over 0.4 s. Guard rails from phase 1 are removed. Workers ride the hoist down. |
| 7 | Cleanup | 0.5 | Machines reverse out to the depot. The crane retracts its jib toward the depot if no other job is queued, otherwise it stays extended. The clipping plane is removed and the block's edges and label fade in over 0.3 s. A final dust puff at the base. The surveyor picks up the tripod and walks off. |

Total at speed 1 for a 60 minute block: approximately 0.5 + 0.5 + 0.8 + 1.2 + 0.5 + 1.3 + 0.7 + 0.5 = 6.0 s.

### 9.5 Overlaps and polish

- Phases may overlap by up to 20% of the earlier phase's duration where it reads naturally: the mixer truck can start backing in while the excavator is on its second cycle; scaffold can begin as the last beam lands.
- Each worker and machine has an entry path from the depot and an exit path back. Paths are straight lines with a quarter turn, never through the tower. Two workers never occupy the same waypoint at the same time: stagger arrivals by 0.1 s.
- Camera does not move during a job unless the new block's top is outside the current frame, in which case the target and distance tween to the standard framing over the job's first second.
- The block's label and the totals in the overlay update at the start of phase 0, not at the end of phase 7.

### 9.6 Interruptions and queueing

- If a new job is enqueued while one is playing, call `fastForwardTo(duration, 0.4)` on the active timeline so it completes in 0.4 s of wall time, then start the next. Visual continuity matters more than finishing the show.
- If the user navigates to another day during a job, `finish()` the job instantly, then render the other day without animation.
- A "Skip" control appears in the overlay while `Director.isBusy`. It calls `finish()`.
- Pressing Escape during a job also skips.
- When the tab is hidden, the render loop pauses. On return, any active job is finished instantly to avoid a burst of catch-up motion.
- Maximum queue depth 8. Beyond that, older queued jobs are finished instantly as new ones arrive.

### 9.7 Reduced motion

When reduced motion is active (`settings.reducedMotion === 'on'`, or `'system'` and `prefers-reduced-motion: reduce` matches):

- Build: block appears with a 0.25 s opacity fade and no crew.
- Demolish: block fades out over 0.25 s.
- Settle: blocks translate over 0.25 s with linear easing, no overshoot, no dust.
- Idle orbit is disabled regardless of `idleOrbit`.
- Now ring moves without tweening.

---

## 10. Workers and machines

All characters and machines are built from three primitives at runtime. No model files, no textures other than `CanvasTexture` for text. Each is a `THREE.Group` with named child groups at pivot points so animation is a matter of setting rotations and positions on those pivots.

### 10.1 Worker

Scale: 0.55 units tall, so a worker's head reaches about the midpoint of a 15 minute block at the default slot. This is deliberately small. The tower should feel like a building.

Parts (all `MeshStandardMaterial`):

| Part | Geometry | Color (strict) | Pivot |
|---|---|---|---|
| Torso | `CapsuleGeometry(0.08, 0.14, 4, 8)` | `blue` (vest) | root |
| Head | `SphereGeometry(0.07, 12, 10)` | `slateLight` | neck group at torso top |
| Hard hat | `SphereGeometry(0.08, 12, 8, 0, 2π, 0, π/2)` plus `CylinderGeometry(0.1, 0.1, 0.015, 16)` brim | `white` | child of head |
| Upper arm × 2 | `CylinderGeometry(0.022, 0.022, 0.12)` | `navy` | shoulder groups |
| Forearm × 2 | `CylinderGeometry(0.02, 0.02, 0.11)` | `slateLight` | elbow groups |
| Thigh × 2 | `CylinderGeometry(0.028, 0.028, 0.13)` | `navy` | hip groups |
| Shin × 2 | `CylinderGeometry(0.025, 0.025, 0.12)` | `slateDark` | knee groups |
| Boot × 2 | `BoxGeometry(0.06, 0.03, 0.09)` | `slateDark` | child of shin |

In accents mode the vest is `hiVis`.

Pool size: 8 workers, created once, hidden when unused. Crew size for a build is `min(6, 2 + floor(blockMinutes / 30))`.

### 10.2 Worker animations

Each animation is a function of a phase value `p` in `[0, 1)` that sets pivot rotations. Drive `p` from elapsed time at a per-animation cycle length.

| Animation | Cycle (s) | Description |
|---|---|---|
| `idle` | 2.0 | Slight torso bob (±0.005 y), arms hang with ±3 degree sway. |
| `walk` | 0.5 | Hips swing ±30 degrees out of phase, knees bend on the back swing, shoulders counter-swing ±20 degrees, torso bobs ±0.01 y twice per cycle. Position advances along the path at 1.2 units per second. Body faces travel direction with a 0.15 s turn. |
| `hammer` | 0.6 | Right shoulder raises to -80 degrees then snaps to +20 degrees with `easeOutCubic` in the last 25% of the cycle; a 0.12 unit "hammer" (`CylinderGeometry` handle and `BoxGeometry` head in `slateDark`) is parented to the right forearm. Left arm holds steady at +10 degrees. |
| `screed` | 1.2 | Both arms forward at -70 degrees holding a `1.2 × 0.03 × 0.08` board, torso tilted 12 degrees, feet shuffle sideways. |
| `survey` | 3.0 | Stands behind the tripod, bends 20 degrees to "look", straightens, waves the other arm once per cycle. |
| `carry` | 0.5 | Walk cycle with both arms forward at -60 degrees holding a plank or panel. |
| `ride` | n/a | Static pose on the hoist platform, one hand on the rail. |

Blend between animations over 0.15 s by lerping pivot rotations.

### 10.3 Machines

Each machine is a `Group` with wheel or track geometry, a body, and named pivots. Bodies are `blue`, cabs are `blueDark` with `bluePale` window boxes, hydraulic arms are `navy`, tracks and tires are `slateDark`, bucket and blade edges are `slatePale`. Wheels and tracks rotate while moving. All machines move along paths at 2.5 units per second with 0.3 s acceleration and deceleration.

| Machine | Used in | Parts and pivots |
|---|---|---|
| Bulldozer | Site prep, first block only | Two track boxes, body, cab, blade on a pivot that lowers 15 degrees during the pass and raises after. |
| Excavator | Foundation | Track base, rotating house (pivot `swing`), boom (pivot `boom`, range -40 to +30 degrees), stick (pivot `stick`, range 0 to 110 degrees), bucket (pivot `bucket`, range 0 to 150 degrees). One dig cycle: boom down, stick out, bucket curl, swing 60 degrees, bucket open, swing back. 1.2 s per cycle. |
| Mixer truck | Foundation | Cab, chassis, four wheels, drum (`CylinderGeometry` tapered, pivot `drum`) rotating at 1 rev per 1.5 s while on site, chute (small `BoxGeometry` angled toward the slab). |
| Hoist | Site prep and strike, stacked blocks only | A thin mast (`0.1 × towerHeight × 0.1`) fixed to the tower's rear left edge, and a cage (`0.6 × 0.7 × 0.6` wireframe box with a floor) that moves along it. Workers parent to the cage while riding. |
| Dump truck | Demolition | Cab, bed on a pivot `tilt` for dumping, four wheels. Receives rubble cubes (visually: cubes tween into the bed). |
| Wrecking crane | Demolition | Reuses the tower crane with a ball (`SphereGeometry 0.3`, `slateDark`) on the hook. |

### 10.4 Tower crane

One shared crane, parked at the depot with its mast extending to the current tower top plus 3 units. Parts: base (`1.0 × 0.3 × 1.0`), mast (`0.3 × h × 0.3`, `slateDark`), slewing unit with pivot `slew`, jib (`8.0 × 0.2 × 0.2` lattice look achieved with three thin boxes, `blue`), counter-jib (`2.5 × 0.2 × 0.2`) with a counterweight box (`navy`), trolley (`0.3 × 0.2 × 0.3`) that slides along the jib on pivot `trolley` (position along x), hook on a cable (`CylinderGeometry` radius 0.01, scaled in y) with pivot `hoist` (cable length), hook block (`0.15 × 0.2 × 0.15`, `slateDark`).

Mast height tweens when the tower top changes so the jib always clears the tower by at least 2 units.

Pick and place routine `craneMove(item, from, to, duration)`:
1. Slew and trolley to `from` (0.3 of duration).
2. Lower hook to item, parent item to hook (0.15).
3. Raise, slew and trolley to above `to` (0.35).
4. Lower, unparent item at `to`, apply the item's landing ease (0.2).

Cable length is always computed from hook world position so it never floats.

### 10.5 Effects

- Dust puff: a `Points` burst of 24 to 60 particles in `lightGray`, emitted at a position with upward and outward velocities, gravity -1.5, lifetime 0.6 s, opacity fades to 0, size shrinks from 0.1 to 0.03. Pool three emitters.
- Selection outline: a slightly larger (`+0.08`) wireframe box in `blue` around the selected block, pulsing opacity 0.5 to 0.9 at 1.5 s.
- Hover: block edges brighten to the swatch's light variant.

---

## 11. Other animations

### 11.1 Demolish

Duration 1.1 s at speed 1 regardless of height.

1. Guard rails appear on the roof of the block below (if any). 0.15 s.
2. The crane swings the wrecking ball into the block's upper third. On contact (0.4 s), the block mesh is swapped for an `InstancedMesh` of cubes (`0.4` edge, grid filling the block volume, capped at 400 instances; larger blocks use larger cubes) in the category color.
3. Cubes receive outward velocities from the impact point, tween with gravity, land on the surface below, bounce once with `easeOutBounce`, and fade over the last 0.3 s. Three dust puffs.
4. A dump truck arrives and the last 30% of cubes tween into its bed as they fade. It drives off. 0.3 s overlap with step 3.
5. `settle` jobs for the blocks above run from 0.6 s onward.

### 11.2 Extend and shrink

- Extend: scaffold appears only around the new floors. Frame phase runs for the new floors with the crane. Cladding reveals from the old top to the new top. Roof cap lifts off at the start and is replaced at the end. Blocks above settle up as soon as the frame phase starts, so the new floors visibly fill the space.
- Shrink: the roof cap lifts off, scaffold wraps the floors being removed, the clipping plane sweeps downward hiding them, two workers hammer on the scaffold during the sweep, the cap is replaced, scaffold strikes. Blocks above settle down during the sweep. Duration 0.9 s + 0.2 s per removed floor, capped at 2.0 s.
- Extending or shrinking from the start side (changing `start`) is implemented as a settle of the block itself plus an extend or shrink of the floors at its base. Visually the roof stays fixed and the base changes, so run the clipping plane from the top downward for the start side.

### 11.3 Relocate

When a block's start changes but its duration does not, and the move is not adjacent:

1. The crane hooks the whole block (cap included) and lifts it 2 units above the tallest point between its old and new positions. 0.5 s.
2. Blocks between old and new positions settle to close the gap. 0.4 s, overlapping.
3. The crane slews and trolleys (no horizontal movement is needed since the tower is a vertical stack; the crane only changes hook height) and lowers the block into its new slot with `easeOutBack`. 0.5 s.
4. Dust puff at the landing.

### 11.4 Weathering (time passing)

When `weatherPastBlocks` is true and the viewed date is today, any block whose `end` is at or before `nowMinutes` cross-fades over 2 s to the weathered material (section 5.7). A block containing the current time is weathered only below the now ring using a second clipping plane. Weathering is purely visual. It never changes data. On other dates nothing is weathered.

---

## 12. Interactions

All interactions work with mouse and keyboard. Pointer events are handled on the canvas; a `Raycaster` tests against block meshes, gap meshes, and the plot.

### 12.1 Add a block

Three entry points, all producing the same result:

- **Add button** in the overlay. Opens the inspector in "new block" mode with `start` set to the end of the last block (or `dayStart` if none), `end` set to `start + 60` clamped to the window and to the next block, and the first category selected. Title field focused. Enter or "Build" confirms.
- **Click a gap** in the scene. The inspector opens prefilled to that gap's full range, capped at 120 minutes if the gap is longer.
- **Click the plot or the roof of the top block.** Same as the Add button.

If no free range of at least one slot exists, the Add button is disabled with the tooltip "The day is full."

On confirm: validate with `canPlace`, insert into the store (sorted), enqueue a `build` job, close the inspector, select the new block.

### 12.2 Select

Click a block to select it. The inspector opens for that block. Click empty space or press Escape to deselect. Arrow up and down move selection to the next and previous block in time.

### 12.3 Resize

- **Drag the roof** of a selected block up or down. The pointer's y projected onto the tower's vertical axis maps through `yToMinutes` and snaps to slot. Live preview: the block mesh scales immediately (no crew during the drag), the label updates, and blocks above shift live. On release, the data commits and an `extend` or `shrink` job plays for the difference. If the drag would overlap the block above, it stops at that boundary.
- **Drag the base** of a selected block does the same for `start`.
- **Inspector fields**: editing start or end times commits on blur or Enter and plays the appropriate job.
- **Scroll wheel over a selected block** with Shift held changes `end` by one slot per notch.
- Minimum size is one slot.

### 12.4 Move

- **Drag the body** of a selected block up or down. A translucent ghost (`blue` at opacity 0.35, same size) follows the pointer snapped to slot boundaries, and the live layout shows where the block would land, with other blocks shifting out of the way. Release commits and plays `relocate` (or `settle` if adjacent).
- **Inspector**: "Move earlier" and "Move later" buttons move by one slot, swapping with a neighbor if needed.

### 12.5 Rename and recategorize

In the inspector. Title commits on blur or Enter. Category changes cross-fade the block material over 0.4 s and swap the edge color and cap.

### 12.6 Delete

Inspector "Demolish" button or the Delete and Backspace keys with a block selected. No confirmation dialog; instead an "Undo" toast appears for 6 seconds. Undo restores the block from an in-memory copy and plays a fast build at speed 3.

### 12.7 Day navigation

Left and right arrow buttons beside the date, and the keyboard shortcuts `[` and `]`. A "Today" button appears when the viewed date is not today. Switching days renders the full tower instantly, then plays a 0.4 s "sunrise" where blocks fade from `slatePale` to their colors bottom to top. No crew.

### 12.8 Copy previous day

Overlay menu item "Copy yesterday's blocks" (label uses the actual previous date if it is not yesterday). Only enabled when the current day is empty and the previous planned day has blocks. Copies blocks with new ids and plays a rapid build sequence at speed 3 with one shared crew.

### 12.9 Keyboard reference

| Key | Action |
|---|---|
| `N` | New block |
| `Enter` | Confirm inspector |
| `Escape` | Close inspector, deselect, or skip animation |
| `Delete`, `Backspace` | Demolish selected |
| `Up`, `Down` | Select next or previous block |
| `[`, `]` | Previous or next day |
| `T` | Go to today |
| `R` | Reset view |
| `,` | Open settings |
| `Shift + wheel` | Resize selected block end by one slot |

### 12.10 Camera input

Orbit with left drag on empty space, zoom with wheel on empty space. Dragging that begins on a block never orbits the camera.

---

## 13. UI overlay

A fixed-position HTML layer over the canvas, pointer-events none by default, with pointer-events auto on its panels. All text follows section 5.5.

### 13.1 Top bar (left to right)

- Previous day button, date title in Georgia 22 px `navy` ("Monday, October 5"), next day button, "Today" button when applicable.
- Totals in Verdana 14 px `slate`: "7h 30m stacked · 3h 30m free". Updates immediately on data change.
- Right side: "Add block" button (`blue` fill, `white` text), menu button (copy yesterday, export JSON, import JSON, clear this day), settings gear.

### 13.2 Inspector (right side panel, 320 px)

Appears when a block is selected or being created. Contains:

- Title input (Georgia 18 px).
- Start and end time inputs. Use two `<select>` elements listing slot-aligned times within the window, filtered so end is always after start. Show the resulting duration beside them.
- Category: a row of swatch buttons with the category name on hover and the selected one outlined in `blue`.
- "Move earlier" and "Move later" buttons.
- "Demolish" button in `slate` text with a `slatePale` border. In new block mode this is "Cancel" and the primary button is "Build".
- A warning line in `slate` italic when the block falls outside the current day window.

### 13.3 Legend (bottom left)

One row per category: 10 px swatch, name, total minutes for that category today. Clicking a legend row toggles a highlight that dims all other categories' blocks to 40% opacity until clicked again or Escape.

### 13.4 Status chip (bottom center)

While a job plays: "Building Pay app review..." with a "Skip" link. Hidden when idle.

### 13.5 Toasts (bottom right)

Undo delete, import success, import error, "Settings saved". 6 s auto-dismiss, hover pauses.

### 13.6 Settings modal

Centered modal, 560 px wide, Georgia heading "Settings", sections below. Save and Cancel buttons; changes preview live in the scene but revert on Cancel.

---

## 14. Settings detail

| Setting | Control | Validation and effect |
|---|---|---|
| Day start | Time select in 30 min steps, 00:00 to 23:00 | Must be at least 4 hours before day end. Changes rebuild the tower geometry (y positions) with a 0.6 s tween of every block and gap and a camera reframe. |
| Day end | Time select in 30 min steps, 01:00 to 24:00 | Must be at most 18 hours after start and within the same calendar day. |
| Slot | 5, 10, 15, 30 | Affects snapping for new edits only. Also changes floor count in animations. |
| Time format | 12h, 24h | Labels, inspector, now ring text. |
| Categories | Editable list: name field, swatch picker, remove button; "Add category" up to 9 | Names 1 to 24 chars, unique. Removing a category with blocks shows the count and reassigns on confirm. |
| Animation speed | Slider 0.5 to 3.0, step 0.25, with a "Preview" button that builds a temporary 60 minute block on an empty side plot and removes it | Multiplies timeline tick rate. |
| Reduced motion | System, On, Off | Section 9.7. |
| Idle orbit | Toggle | Section 8.7. |
| Labels | Always, On hover | Section 8.5. |
| Weather past blocks | Toggle | Section 11.4. |
| Theme | Light, Dark | Section 5.8. Transition background and materials over 0.4 s. |
| Palette mode | Strict, Accents | Section 5.3. Accents option shows a one line note: "Adds grass green and hi-vis orange outside the brand palette." |
| Data | Export JSON, Import JSON, Clear this day, Clear all data | Clear all data requires typing "clear" to confirm. |

---

## 15. Persistence

### 15.1 Storage

- Single `localStorage` key: `timetower.save`.
- Value is `JSON.stringify(SaveFile)`.
- Write on every committed change, debounced 250 ms. Never write mid-drag.
- Read once on startup. If parsing fails, back up the raw string to `timetower.save.corrupt.<timestamp>` and start fresh with a toast: "Saved data could not be read. A backup was kept."
- Settings changes also write to `timetower.save`. There is no separate settings key.

### 15.2 Migrations

`SaveFile.version` is 1. Implement `migrate(raw: unknown): SaveFile` in `src/core/migrate.ts` that validates shape, fills missing settings with defaults, drops blocks that fail invariants after attempting to repair them (snap times, clamp to window, drop zero-length), and logs what it changed to the console. Add a `version: 0` path that treats any object with a `blocks` array as a single day for today, so the migration path is exercised by a test from day one.

### 15.3 Export and import

- Export downloads `timetower-YYYY-MM-DD.json` containing the full `SaveFile`.
- Import accepts a file via `<input type="file">`, runs `migrate`, then asks "Replace all data or merge days?" Merge adds days not present and leaves existing days untouched. Replace overwrites everything.
- Import never triggers construction animations.

---

## 16. Performance

Targets: 60 fps on a 2020 integrated GPU laptop at 1920 × 1080 with a 48 block day during a build job. Idle scene under 3 ms of frame time.

Rules:

- `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))`.
- One shared material per swatch token, one per structural role. Never create a material per block.
- Grass blades, scaffold tubes, scaffold planks, and rubble cubes are `InstancedMesh`.
- Dispose geometries and materials of removed objects. Keep a count of live geometries in a debug overlay toggled by `D` and confirm it returns to baseline after a build and demolish cycle.
- Pause the render loop when `document.hidden`. Resume with a single frame to settle.
- The render loop runs continuously only while a job is active, the camera is damping, idle orbit is on, or a tween is live. Otherwise render on demand (on input, on now ring update). Implement a `needsRender` flag.
- Shadow map 2048 max. Directional shadow camera bounds fit the plot and tower only.
- Max 48 blocks per day enforced in the store with the message "A day can hold up to 48 blocks."
- Labels: regenerate a label's canvas only when its text changes, not every frame.

---

## 17. Accessibility

- Every overlay control is keyboard reachable with a visible `blue` focus ring (2 px outline, 2 px offset).
- The canvas has `aria-label="Time tower for Monday, October 5. 6 blocks, 7 hours 30 minutes planned."` updated on change.
- A hidden "List view" button (visible on focus) opens a plain HTML table of the day's blocks with the same edit controls as the inspector, so the app is usable without the 3D view. This also serves as the fallback when WebGL2 is unavailable.
- Reduced motion per section 9.7.
- Color is never the only carrier of meaning: category is also in the label text and legend; weathered blocks also show "done" in their label.
- Minimum contrast: `slate` on `white` and `white` on `navy` both pass AA. Do not place `blueLight` text on `white`.

---

## 18. Edge cases

| Case | Behavior |
|---|---|
| App opened before day start | Now ring hidden. Totals normal. |
| App left open across midnight | On the first render after local midnight, the date title updates to the new day, the now ring resets, and a toast offers "Go to today". The viewed date does not change automatically. |
| Day window changed so blocks fall outside | Blocks kept, rendered hatched, inspector warning. See section 6. |
| Block created at exactly `dayEnd` | Not allowed. `nextFreeRange` returns null and the Add button disables. |
| Two blocks adjacent with no gap | No gap mesh. Edges still separate them visually. |
| Drag resize released outside the canvas | Treat as release at the last valid pointer position. |
| Window resized during a job | Update camera aspect and renderer size. The job continues. |
| Very short block, 5 min at slot 5 | 0.25 units tall. Build plays with F = 1, minimum durations apply, one worker. |
| Very long block, 8 hours | F capped for beam batching, duration about 9.8 s. Crew 6. |
| 48 blocks | Add disabled with message. |
| Import of a future schema version | Refuse with toast "This file was made with a newer version." |
| localStorage full or unavailable (private mode) | Work in memory, show a persistent chip "Not saving: storage unavailable", keep export working. |

---

## 19. Project structure

```
time-tower/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
├── README.md                    (how to run, settings overview, keyboard reference)
├── src/
│   ├── main.ts                  (bootstraps App, handles WebGL2 check)
│   ├── styles.css               (brand tokens as CSS vars, overlay styles)
│   ├── brand/
│   │   └── tokens.ts            (the only file allowed to contain hex literals)
│   ├── core/
│   │   ├── model.ts             (types from section 6)
│   │   ├── defaults.ts          (default Settings, default categories)
│   │   ├── time.ts              (format and snap helpers)
│   │   ├── layout.ts            (minutesToY, computeGaps, totals, canPlace)
│   │   ├── store.ts             (state, invariants, change events, undo buffer)
│   │   ├── persist.ts           (localStorage read/write, export/import)
│   │   ├── migrate.ts
│   │   └── rng.ts               (mulberry32)
│   ├── scene/
│   │   ├── SceneRoot.ts         (renderer, camera, controls, lights, render loop, needsRender)
│   │   ├── Ground.ts            (ground plane, plot, grass instancing, depot, site sign)
│   │   ├── Tower.ts             (owns BlockMesh, GapMesh, Label instances; diffs against store)
│   │   ├── BlockMesh.ts
│   │   ├── GapMesh.ts
│   │   ├── Label.ts
│   │   ├── NowRing.ts
│   │   ├── Picker.ts            (raycasting, hover, drag state machine)
│   │   ├── materials.ts         (shared materials per token and role)
│   │   └── crew/
│   │       ├── Worker.ts
│   │       ├── workerAnims.ts
│   │       ├── Crane.ts
│   │       ├── Excavator.ts
│   │       ├── Bulldozer.ts
│   │       ├── MixerTruck.ts
│   │       ├── DumpTruck.ts
│   │       ├── Hoist.ts
│   │       ├── Scaffold.ts
│   │       ├── Dust.ts
│   │       └── Crew.ts          (pooling, paths, waypoint staggering)
│   ├── anim/
│   │   ├── Timeline.ts
│   │   ├── easing.ts
│   │   ├── Director.ts
│   │   └── jobs/
│   │       ├── build.ts
│   │       ├── extend.ts
│   │       ├── shrink.ts
│   │       ├── demolish.ts
│   │       ├── relocate.ts
│   │       └── settle.ts
│   └── ui/
│       ├── Overlay.ts           (top bar, totals, menu, toasts, status chip)
│       ├── Inspector.ts
│       ├── Legend.ts
│       ├── SettingsModal.ts
│       └── ListView.ts
└── tests/
    ├── layout.test.ts
    ├── time.test.ts
    ├── store.test.ts
    ├── migrate.test.ts
    ├── timeline.test.ts
    └── brand.test.ts            (no hex literals outside tokens.ts, no em dashes in src)
```

Architecture rules:

- `core/` has no three imports and no DOM access. It is pure and fully tested.
- `scene/` reads from the store and never writes to it. All writes go through `store` methods called from `ui/` or `Picker`.
- `Tower.ts` reconciles meshes against store state by block id: add missing, remove orphaned, update changed. Jobs are enqueued by the store's change events carrying a change type (`added`, `removed`, `resized`, `moved`, `retitled`, `recategorized`) so `Director` can pick the job.
- `Director` is the only thing that mutates mesh transforms during a job. `Tower` applies final transforms when a job completes or is skipped, so the two never fight.

---

## 20. Seed data for development

When the store is empty on first run in development mode only (`import.meta.env.DEV`), offer a "Load sample day" button on the empty plot. It creates today's plan with:

| Start | End | Title | Category |
|---|---|---|---|
| 07:30 | 09:00 | Pay app review | Deep work |
| 09:00 | 09:30 | Email and admin | Admin |
| 10:00 | 11:00 | Project standup | Meetings |
| 11:00 | 12:30 | Cost reconciliation | Deep work |
| 12:30 | 13:30 | Lunch | Admin |
| 15:00 | 16:00 | Client call | Meetings |
| 16:00 | 17:00 | Skill bank docs | Deep work |

Build them in sequence at speed 2.5 with one shared crew so the sample loads in under 15 seconds.

---

## 21. Milestones and acceptance criteria

Work through these in order. Commit at the end of each.

### M1: Static tower

Scope: project scaffold, brand tokens, `core/` with tests, `SceneRoot`, `Ground` (plot and grass, sign, depot pad), `Tower` rendering blocks, gaps, and labels from seed data, camera framing, top bar with totals, theme light only.

Accept when:
- `npm run dev` opens a scene with the sample day rendered correctly; heights match durations by inspection (the 90 minute blocks are visibly 3 times the 30 minute block).
- All `core/` tests pass, including gap computation on empty, full, and adjacent cases.
- `brand.test.ts` passes.
- Camera orbits within clamps and the whole day window is framed on load.
- Resizing the window keeps aspect correct.

### M2: Editing and persistence

Scope: `Picker`, inspector, add, select, resize by drag, move by drag, rename, recategorize, delete with undo, day navigation, legend, settings modal with all settings wired (animation settings may be no-ops yet), `persist`, `migrate`, export, import, list view, dark theme.

Accept when:
- Every interaction in section 12 works with instant (non-animated) mesh updates.
- Reload preserves data and settings.
- Changing the day window re-lays out the tower and reframes the camera.
- Import of the exported file round-trips identically.
- Keyboard-only use can create, edit, and delete a block.
- No hex literals outside `tokens.ts`.

### M3: First build animation

Scope: `Timeline`, `Director`, `build` job for the first block only: survey, site prep with bulldozer and grass removal, foundation with excavator and mixer, frame with crane, scaffold, cladding with clipping plane, roof and strike, cleanup. Workers with `walk`, `idle`, `hammer`, `screed`, `survey`. Dust.

Accept when:
- Adding the first block to an empty day plays the full sequence in 5.5 to 6.5 s at speed 1 for a 60 minute block.
- Phase order and visuals match section 9.4 by inspection.
- Skip and Escape finish the job cleanly with the final block in place.
- Animation speed setting changes duration proportionally.
- Reduced motion replaces the sequence with the fade.
- Frame time stays under 16 ms during the build on the target hardware.

### M4: Stacked builds and the rest of the jobs

Scope: stacked `build` with hoist and guard rails, `extend`, `shrink`, `demolish` with rubble and dump truck, `relocate`, `settle`, interruption and queueing, crane mast growth, undo plays a fast build.

Accept when:
- Adding five blocks in quick succession produces five correct builds with fast-forwarding and no visual glitches or leaked geometry (debug counter returns to baseline).
- Deleting a middle block plays the demolition and the blocks above settle into place.
- Drag resize previews live and plays extend or shrink on release.
- Drag move shows the ghost and plays relocate.
- Day navigation mid-job finishes the job and renders the other day instantly.

### M5: Living tower

Scope: now ring with tweened movement, weathering with per-block clipping, idle orbit, sunrise on day change, copy yesterday, sample day loader, midnight rollover, storage unavailable handling, palette accents mode, settings preview button.

Accept when:
- At the current time the ring sits at the correct height and past blocks are weathered.
- All items in section 18 behave as specified.
- README documents setup, settings, and the keyboard reference.
- A full session of 30 minutes of normal use shows no console errors and no growth in geometry count.

---

## 22. Testing

### 22.1 Unit (Vitest)

- `layout`: `minutesToY` round trip, `computeGaps` with 0, 1, many blocks, adjacent blocks, blocks touching window ends; `totals` by category; `canPlace` overlap and boundary cases; `nextFreeRange` when full.
- `time`: snapping at every slot size, clamping, 12h and 24h formatting including noon and midnight, duration formatting for 5, 45, 60, 90, 135, 480 minutes.
- `store`: insert keeps sort order, overlap rejected, category deletion reassigns, last category deletion refused, undo buffer restores an identical block, 48 block cap.
- `migrate`: version 0 shape, missing settings, out of window blocks repaired, future version refused.
- `timeline`: steps fire in order, `seek` is idempotent, `fastForwardTo` reaches the end within tolerance, `finish` fires every `onComplete` exactly once.
- `brand`: scans `src/**/*.ts` and `src/**/*.css` excluding `tokens.ts` for `#[0-9a-fA-F]{3,8}\b` and for the characters em dash and en dash; both must find nothing.

### 22.2 Manual visual checklist (keep in `README.md`)

- Heights proportional across all slot sizes.
- Labels readable and non-overlapping on a 48 block day.
- Build sequence correct for 5 min, 60 min, and 3 hour blocks.
- Demolition rubble lands on the block below, not inside it.
- Crane cable never detaches from the hook.
- Workers never walk through the tower.
- Dark theme has no unreadable text.
- Strict palette: screenshot a build mid-phase and confirm every visible color is in section 5.1 or 5.2.

---

## 23. Open decisions and defaults

| Decision | Default | Alternative |
|---|---|---|
| Grass and vest colors | Strict palette. Grass is `slateLight` by shape, vests are `blue`. | `accents` mode adds `#7FA86B` grass and `#F28C28` hi-vis. The setting exists; default is off. The user may ask for the default to flip. |
| Sound | None | Hook points exist in `Director` at each phase start. Not implemented. |
| Block footprint | Fixed 4 × 4 for all blocks | Could vary by category later. Do not implement. |
| Minimum day window | 4 hours | None. |
| Day crossing midnight | Not supported | None in v1. |
| Multi-day | Not supported | None in v1. |

---

## Appendix A: Phase timing table

Speed 1. `s = sqrt(H / 3.0)`. Minimum durations apply where noted in section 9.4.

| Block | H (units) | s | Floors at slot 15 | Total build (s) |
|---|---|---|---|---|
| 15 min | 0.75 | 0.50 | 1 | 3.5 |
| 30 min | 1.50 | 0.71 | 2 | 4.6 |
| 60 min | 3.00 | 1.00 | 4 | 6.0 |
| 90 min | 4.50 | 1.22 | 6 | 6.9 |
| 2 h | 6.00 | 1.41 | 8 | 7.5 |
| 3 h | 9.00 | 1.73 | 12 | 8.6 |
| 8 h | 24.0 | 2.83 | 32 | 9.8 (beams batched) |

## Appendix B: Default settings JSON

```json
{
  "dayStart": 420,
  "dayEnd": 1080,
  "slotMinutes": 15,
  "timeFormat": "12h",
  "categories": [
    { "id": "deep", "name": "Deep work", "color": "navy" },
    { "id": "meet", "name": "Meetings", "color": "blue" },
    { "id": "admin", "name": "Admin", "color": "slate" }
  ],
  "animationSpeed": 1,
  "reducedMotion": "system",
  "idleOrbit": true,
  "labelMode": "always",
  "weatherPastBlocks": true,
  "theme": "light",
  "paletteMode": "strict"
}
```

## Appendix C: Writing rules for all user-facing text

- No em dashes or en dashes anywhere, including code comments and the README. Use a colon, a comma, or two sentences.
- American spelling.
- Sentence case for every label, button, and heading.
- No exclamation marks in system text.
- No "please", no "simply", no "just".
- Buttons start with a verb: "Build", "Demolish", "Move later", "Save".
- Errors say what happened and what to do next in one sentence.

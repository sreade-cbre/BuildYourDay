// The schedule of a real-time build: how a block's time divides between the
// trades, the way a construction programme would, and when each floor and
// band of facade is done. Times are seconds from the block's start. Free of
// three, so it is unit tested.
//
// As on a real tower, the trades overlap so the building rises the whole
// time: setting out and groundworks are short, the frame starts early with
// the scaffold climbing with it, and the facade closes a few floors behind
// the frame, so how much of the block stands follows how much of its time
// has gone.

export type PhaseName = 'setOut' | 'clear' | 'excavate' | 'foundation' | 'mobilize' | 'deck' | 'frame' | 'clad' | 'roof' | 'strike';

export interface Span {
  start: number;
  end: number;
}

/**
 * Each phase as shares of the block's time. The day's first block starts
 * from grass: setting out, clearing, digging, and footings with a poured
 * slab. A block on the tower gets a hoist and a guard rail instead, and its
 * floor is pumped up and poured. From the frame on, both run the same.
 */
const FIRST: ReadonlyArray<readonly [PhaseName, number, number]> = [
  ['setOut', 0, 0.03],
  ['clear', 0.03, 0.07],
  ['excavate', 0.07, 0.12],
  ['foundation', 0.12, 0.18],
  ['frame', 0.18, 0.64],
  ['clad', 0.3, 0.92],
  ['roof', 0.92, 0.95],
  ['strike', 0.95, 1],
];

const STACKED: ReadonlyArray<readonly [PhaseName, number, number]> = [
  ['setOut', 0, 0.03],
  ['mobilize', 0.03, 0.06],
  ['deck', 0.06, 0.12],
  ['frame', 0.12, 0.62],
  ['clad', 0.28, 0.92],
  ['roof', 0.92, 0.95],
  ['strike', 0.95, 1],
];

export type Phases = Partial<Record<PhaseName, Span>> & Record<'setOut' | 'frame' | 'clad' | 'roof' | 'strike', Span>;

/** The phases of a block `seconds` long. The frame and the cladding overlap. */
export function sitePhases(seconds: number, first: boolean): Phases {
  const phases: Partial<Record<PhaseName, Span>> = {};
  for (const [name, from, to] of first ? FIRST : STACKED) phases[name] = { start: from * seconds, end: to * seconds };
  return phases as Phases;
}

/** The phase names in the order they start. */
export function phaseOrder(first: boolean): PhaseName[] {
  return (first ? FIRST : STACKED).map(([name]) => name);
}

/** A time a share of the way through a span. */
export function at(span: Span, share: number): number {
  return span.start + (span.end - span.start) * share;
}

/** How far through a span a time is, clamped to [0, 1]. */
export function progress(span: Span, t: number): number {
  const length = span.end - span.start;
  return length <= 0 ? (t >= span.end ? 1 : 0) : Math.min(1, Math.max(0, (t - span.start) / length));
}

/** A span cut into equal parts. */
export function split(span: Span, parts: number): Span[] {
  const length = (span.end - span.start) / parts;
  return Array.from({ length: parts }, (_, i) => ({ start: span.start + i * length, end: span.start + (i + 1) * length }));
}

/** Scaffold levels and facade bands both group floors on very tall blocks (Scaffold's limit). */
export const MAX_LEVELS = 24;

export function levelsFor(floors: number): number {
  return Math.max(1, Math.min(floors, MAX_LEVELS));
}

// Real-time paces at speed 1, from spec 10.2 and 10.3 where it gives them.

/** Workers walk 1.2 units a second (spec 10.2). */
export const WALK_SPEED = 1.2;
/** Machines drive 2.5 units a second (spec 10.3); a dozer pushing earth goes slower. */
export const DRIVE_SPEED = 2.5;
export const PUSH_SPEED = 1.1;
/** The hoist cage climbs this many units a second. */
export const RIDE_SPEED = 0.9;
/** Workers climb between levels at this many units a second. */
export const CLIMB_SPEED = 0.8;
/** One crane pick and place. */
export const LIFT_SECONDS = 9;
/** The crane swings back to wait over the depot after a lift. */
export const CRANE_RETURN_SECONDS = 3;
/** One excavator dig cycle (spec 10.3 gives 1.2 s for its time lapse). */
export const DIG_SECONDS = 3.2;
/** A facade band starts closing no sooner than this share of the block after its floors are framed. */
const CLAD_LAG = 0.01;

export interface SiteSchedule {
  seconds: number;
  phases: Phases;
  floors: number;
  /** Each floor of the frame, and when the crane lands its ring of beams. */
  frame: Array<Span & { lands: number }>;
  /** Each band of facade: when its panel lands, and when it closes from bottom to top. */
  bands: Array<Span & { lands: number; closes: Span }>;
  /** When the crane sets the roof cap. */
  roofLands: number;
}

/**
 * The whole schedule of a block: the phases, the frame floor by floor, the
 * facade band by band, and every crane lift. A band closes only once its
 * floors are framed. Lifts never overlap: one that would start before the
 * crane is back from the last waits for it. `lift` and `crane return` are
 * the seconds those take at the chosen animation speed.
 */
export function siteSchedule(seconds: number, first: boolean, floors: number, lift = LIFT_SECONDS, craneReturn = CRANE_RETURN_SECONDS): SiteSchedule {
  const phases = sitePhases(seconds, first);
  const frameSteps = split(phases.frame, floors);
  const levels = levelsFor(floors);
  // When the top floor of each band of facade is framed.
  const framed = (band: number) => frameSteps[Math.min(floors, Math.ceil(((band + 1) * floors) / levels)) - 1]!.end;
  const lag = CLAD_LAG * seconds;
  const cladStart = Math.max(phases.clad.start, framed(0) + lag);
  const bandLength = (phases.clad.end - cladStart) / levels;
  const bandSpans = Array.from({ length: levels }, (_, b) => ({ start: cladStart + b * bandLength, end: cladStart + (b + 1) * bandLength }));

  // Every lift where it would like to land, then in time order, each waiting for the one before.
  const wanted: Array<{ kind: 'ring' | 'panel' | 'roof'; index: number; lands: number }> = [
    ...frameSteps.map((step, index) => ({ kind: 'ring' as const, index, lands: at(step, 0.55) })),
    ...bandSpans.map((band, index) => ({ kind: 'panel' as const, index, lands: Math.max(cladStart, band.start - 0.1 * bandLength) })),
    { kind: 'roof' as const, index: 0, lands: at(phases.roof, 0.3) },
  ].sort((a, b) => a.lands - b.lands || (a.kind === 'ring' ? -1 : 1));
  let free = -Infinity;
  for (const item of wanted) {
    item.lands = Math.max(item.lands, free + lift);
    free = item.lands + craneReturn + 0.5;
  }
  const landed = (kind: 'ring' | 'panel' | 'roof', index: number) => wanted.find((w) => w.kind === kind && w.index === index)!.lands;

  return {
    seconds,
    phases,
    floors,
    frame: frameSteps.map((step, index) => ({ ...step, lands: landed('ring', index) })),
    bands: bandSpans.map((band, index) => ({ ...band, lands: landed('panel', index), closes: { start: at(band, 0.05), end: at(band, 0.97) } })),
    roofLands: landed('roof', 0),
  };
}

/** The share of the block's height its facade covers at `t`. */
export function facadeShare(schedule: SiteSchedule, t: number): number {
  if (t >= schedule.phases.clad.end) return 1;
  return schedule.bands.reduce((sum, band) => sum + progress(band.closes, t), 0) / schedule.bands.length;
}

/** The share of the block's height the frame has reached at `t`. */
export function frameShare(schedule: SiteSchedule, t: number): number {
  const { frame } = schedule;
  let done = 0;
  for (const step of frame) done += progress({ start: at(step, 0.04), end: at(step, 0.4) }, t);
  return done / frame.length;
}

/**
 * What the crew is doing at `t`, in a word or two for the block's label.
 * While the frame and the facade overlap, the frame leads.
 */
export function activity(schedule: SiteSchedule, t: number): string {
  const { phases } = schedule;
  const within = (span: Span | undefined) => span !== undefined && t >= span.start && t < span.end;
  if (within(phases.strike)) return 'striking';
  if (within(phases.roof)) return 'roofing';
  if (within(phases.frame)) return 'framing';
  if (t >= phases.frame.end && t < phases.clad.end) return 'cladding';
  if (within(phases.deck)) return 'floor pour';
  if (within(phases.mobilize)) return 'setting up';
  if (within(phases.foundation)) return 'footings';
  if (within(phases.excavate)) return 'digging';
  if (within(phases.clear)) return 'clearing';
  return 'setting out';
}

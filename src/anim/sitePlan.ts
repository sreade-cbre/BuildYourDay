// The schedule of a real-time build: how a block's time divides between the
// trades, the way a construction programme would, and when each floor and
// band of facade is done. Times are seconds from the block's start. Free of
// three, so it is unit tested.

export type PhaseName =
  | 'setOut'
  | 'clear'
  | 'excavate'
  | 'foundation'
  | 'mobilize'
  | 'deck'
  | 'frame'
  | 'scaffold'
  | 'clad'
  | 'roof'
  | 'strike';

export interface Span {
  start: number;
  end: number;
}

/**
 * Shares of the block's time. The day's first block starts from grass:
 * setting out, clearing, digging, and footings with a poured slab. A block
 * on the tower gets a hoist and a guard rail instead, and its floor is
 * pumped up and poured. From the frame on, both run the same.
 */
const FIRST: ReadonlyArray<readonly [PhaseName, number]> = [
  ['setOut', 0.06],
  ['clear', 0.08],
  ['excavate', 0.1],
  ['foundation', 0.12],
  ['frame', 0.24],
  ['scaffold', 0.07],
  ['clad', 0.21],
  ['roof', 0.05],
  ['strike', 0.07],
];

const STACKED: ReadonlyArray<readonly [PhaseName, number]> = [
  ['setOut', 0.06],
  ['mobilize', 0.06],
  ['deck', 0.12],
  ['frame', 0.28],
  ['scaffold', 0.08],
  ['clad', 0.25],
  ['roof', 0.06],
  ['strike', 0.09],
];

export type Phases = Partial<Record<PhaseName, Span>> & Record<'setOut' | 'frame' | 'scaffold' | 'clad' | 'roof' | 'strike', Span>;

/** The phases of a block `seconds` long, end to end, in order. */
export function sitePhases(seconds: number, first: boolean): Phases {
  const phases: Partial<Record<PhaseName, Span>> = {};
  let at = 0;
  for (const [name, share] of first ? FIRST : STACKED) {
    const end = at + share * seconds;
    phases[name] = { start: at, end };
    at = end;
  }
  return phases as Phases;
}

/** The phase names in order, for a first block or a stacked one. */
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

/** When the crane lands each floor's ring of beams during the frame. */
export function frameSteps(phases: Phases, floors: number): Array<Span & { lands: number }> {
  return split(phases.frame, floors).map((step) => ({ ...step, lands: at(step, 0.55) }));
}

/**
 * The facade bands during cladding: each band's panel lands near the start
 * of its slot, then the facade closes from its bottom to its top.
 */
export function cladBands(phases: Phases, floors: number): Array<Span & { lands: number; closes: Span }> {
  return split(phases.clad, levelsFor(floors)).map((band) => ({
    ...band,
    lands: at(band, 0.12),
    closes: { start: at(band, 0.15), end: at(band, 0.97) },
  }));
}

/** The share of the block's height its facade covers at `t`. */
export function facadeShare(phases: Phases, floors: number, t: number): number {
  if (t >= phases.clad.end) return 1;
  const bands = cladBands(phases, floors);
  return bands.reduce((sum, band) => sum + progress(band.closes, t), 0) / bands.length;
}

/** When the crane sets the roof cap. */
export function roofLands(phases: Phases): number {
  return at(phases.roof, 0.3);
}

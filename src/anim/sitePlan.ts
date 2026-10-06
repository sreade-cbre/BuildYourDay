// The schedule of a real-time build: how a block's time divides between the
// trades, the way a construction schedule would, and when each piece of the
// building goes in. Times are seconds from the block's start. Free of three,
// so it is unit tested.
//
// As on a real tower, the trades overlap so the building rises the whole
// time: setting out and groundworks are short, the frame starts early with
// the scaffold climbing with it, and the facade closes a few floors behind
// the frame. The crane is the heart of the site: every column, beam, deck
// bundle, and facade panel is its own lift, and between them it brings up
// bundles of rebar, formwork, and scaffold, so it is hardly ever idle. A
// flatbed truck restocks the yard the crane lifts from, and the mixer comes
// back to pour each floor's deck.

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
/** One crane pick and place, at most; a crowded program lifts faster. */
export const LIFT_SECONDS = 14;
/** The quickest lift, for very crowded programs. */
export const MIN_LIFT_SECONDS = 5;
/** The crane swings back to wait over the yard after a lift. */
export const CRANE_RETURN_SECONDS = 4;
/** One excavator dig cycle (spec 10.3 gives 1.2 s for its time lapse). */
export const DIG_SECONDS = 3.2;
/** A delivery: driving in, unloading, and driving out. */
export const DELIVERY = { drive: 12, unload: 22 };
/** A mixer visit to pour a deck: driving in and out, and pouring at least this long. */
export const POUR = { drive: 6, least: 18 };
/** A facade band starts closing no sooner than this share of the block after its floors are framed. */
const CLAD_LAG = 0.01;
/** Pieces of each floor's frame, in the order they go in. */
export const COLUMNS = 4;
export const BEAMS = 4;
/** Panels per band of facade: two on each face the scaffold works from. */
export const PANELS = 4;

export type PieceKind = 'column' | 'beam' | 'deck' | 'panel' | 'roof' | 'bundle' | 'scaffold';

/** The pieces that wait on racks in the yard. */
export type StockKind = 'column' | 'beam' | 'deck' | 'panel';

/**
 * The yard's racks: what each opens and ends the block with, the least it
 * runs down to before the truck tops it up, and the most it holds. Deck
 * counts are bundles of two sheets.
 */
export const YARD: Readonly<Record<StockKind, { opening: number; reserve: number; capacity: number }>> = {
  column: { opening: 8, reserve: 3, capacity: 12 },
  beam: { opening: 8, reserve: 3, capacity: 12 },
  deck: { opening: 3, reserve: 1, capacity: 5 },
  panel: { opening: 6, reserve: 2, capacity: 8 },
};

/** How far into a lift the hook takes the load off the rack. */
export const PICK = 0.45;

export interface PlannedLift {
  kind: PieceKind;
  /** The frame floor or facade band it belongs to; -1 for the roof. */
  floor: number;
  /** Which piece of its floor or band. */
  index: number;
  start: number;
  /** When it has landed. */
  lands: number;
  /** Bundles the crane brings between pieces: where they go. Scaffold coming down goes from the tower to the yard. */
  to?: 'pit' | 'roofBelow' | 'deck' | 'planks' | 'yard' | 'front';
}

export interface FloorPlan extends Span {
  /** When each column lands, front right round to back right. */
  columns: number[];
  /** When each beam lands: front, right, back, left. */
  beams: number[];
  /** When the deck bundle lands, and when its sheets are down. */
  deck: number;
  laid: number;
  /** When the floor's concrete is poured, if there is time. */
  pour: Span | null;
}

export interface BandPlan extends Span {
  /** When each panel lands. */
  panels: number[];
  /** When the facade closes over the band, from bottom to top. */
  closes: Span;
}

export interface Delivery {
  arrives: number;
  unload: Span;
  leaves: number;
  /** How many of each piece it brings. */
  pieces: Partial<Record<StockKind, number>>;
}

export interface SiteSchedule {
  seconds: number;
  phases: Phases;
  floors: number;
  levels: number;
  /** Seconds one lift takes on this program. */
  lift: number;
  craneReturn: number;
  frame: FloorPlan[];
  bands: BandPlan[];
  roofLands: number;
  /** Every crane lift, in time order. None overlap. */
  lifts: PlannedLift[];
  deliveries: Delivery[];
  /** Mixer visits, each with the floor it pours. */
  pours: Array<{ floor: number; visit: Span; span: Span }>;
}

/** The crane's diary: lifts booked so far, kept in time order. */
class Crane {
  readonly booked: PlannedLift[] = [];

  constructor(private readonly lift: number, private readonly back: number) {}

  /** Books the next lift after everything booked so far, landing no sooner than `wanted`. */
  queue(lift: Omit<PlannedLift, 'start' | 'lands'>, wanted: number): PlannedLift {
    const last = this.booked.at(-1);
    const start = Math.max(wanted - this.lift, last ? last.lands + this.back : 0, 0);
    const booked = { ...lift, start, lands: start + this.lift };
    this.booked.push(booked);
    return booked;
  }

  /** Books a lift in the first gap it fits, landing no sooner than `wanted`. */
  fit(lift: Omit<PlannedLift, 'start' | 'lands'>, wanted: number): PlannedLift {
    let start = Math.max(0, wanted - this.lift);
    for (const other of this.booked) {
      if (start + this.lift + this.back <= other.start) break;
      if (start < other.lands + this.back) start = other.lands + this.back;
    }
    const booked = { ...lift, start, lands: start + this.lift };
    this.booked.push(booked);
    this.booked.sort((a, b) => a.start - b.start);
    return booked;
  }

  /** Gaps between lifts inside a span long enough for another, with room either side. */
  gaps(span: Span): Span[] {
    const gaps: Span[] = [];
    let free = span.start;
    for (const lift of this.booked) {
      if (lift.lands + this.back <= span.start) continue;
      if (lift.start >= span.end) break;
      if (lift.start > free) gaps.push({ start: free, end: Math.min(lift.start, span.end) });
      free = Math.max(free, lift.lands + this.back);
    }
    if (free < span.end) gaps.push({ start: free, end: span.end });
    return gaps;
  }
}

/**
 * The whole schedule of a block: the phases, the frame piece by piece, the
 * facade panel by panel, every crane lift, the deliveries that restock the
 * yard, and the deck pours. A band of facade closes only once its floors are
 * framed. `lift` and `craneReturn` are the seconds those take at the chosen
 * animation speed; a crowded program lifts faster.
 */
export function siteSchedule(seconds: number, first: boolean, floors: number, lift = LIFT_SECONDS, craneReturn = CRANE_RETURN_SECONDS): SiteSchedule {
  const phases = sitePhases(seconds, first);
  const steps = split(phases.frame, floors);
  const stepLength = steps[0]!.end - steps[0]!.start;
  const pieces = COLUMNS + BEAMS + 1;
  // Room enough for every piece of a floor, with the crane busy about two thirds of the time.
  const length = Math.min(lift, Math.max(MIN_LIFT_SECONDS, (0.6 * stepLength) / pieces - craneReturn));
  const back = Math.min(craneReturn, length * 0.4);
  const crane = new Crane(length, back);

  // The frame first: it leads, so it gets the crane when it wants it.
  const frame: FloorPlan[] = steps.map((step, floor) => {
    const s = (share: number) => at(step, share);
    const columns = Array.from({ length: COLUMNS }, (_, index) => crane.queue({ kind: 'column', floor, index }, s(0.08 + 0.09 * index)).lands);
    const beams = Array.from({ length: BEAMS }, (_, index) => crane.queue({ kind: 'beam', floor, index }, s(0.44 + 0.09 * index)).lands);
    const deck = crane.queue({ kind: 'deck', floor, index: 0 }, s(0.82)).lands;
    return { ...step, columns, beams, deck, laid: deck + Math.min(8, 0.06 * stepLength), pour: null };
  });

  // The mixer pours each deck once its sheets are down, a visit at a time.
  const pours: SiteSchedule['pours'] = [];
  let mixerFree = phases.frame.start;
  frame.forEach((floor, index) => {
    const next = frame[index + 1];
    const start = Math.max(floor.laid + 2, mixerFree + POUR.drive);
    const end = Math.max(start + POUR.least, Math.min(floor.laid + 0.3 * stepLength, next ? next.columns[0]! : floor.end + stepLength * 0.3));
    if (end > phases.frame.end + stepLength) return;
    floor.pour = { start, end };
    pours.push({ floor: index, visit: { start: start - POUR.drive, end: end + POUR.drive }, span: floor.pour });
    mixerFree = end + POUR.drive;
  });

  // The facade, a band at a time once its floors are framed, panels fitted between the frame's lifts.
  const levels = levelsFor(floors);
  const framed = (band: number) => frame[Math.min(floors, Math.ceil(((band + 1) * floors) / levels)) - 1]!.laid;
  const lag = CLAD_LAG * seconds;
  const cladStart = Math.max(phases.clad.start, framed(0) + lag);
  const bandLength = (phases.clad.end - cladStart) / levels;
  const bands: BandPlan[] = Array.from({ length: levels }, (_, band) => {
    const span = { start: cladStart + band * bandLength, end: cladStart + (band + 1) * bandLength };
    const earliest = Math.max(span.start, framed(band) + lag);
    const panels = Array.from({ length: PANELS }, (_, index) => crane.fit({ kind: 'panel', floor: band, index }, Math.max(earliest, at(span, 0.04 + 0.2 * index))).lands);
    // The facade closes as the panels go on, finished a little after the last.
    const closes = { start: panels[0]! + 1, end: Math.max(panels.at(-1)! + Math.max(6, 0.15 * bandLength), at(span, 0.97)) };
    return { ...span, panels, closes };
  });
  // Bands close in order, each after the one below.
  for (let b = 1; b < bands.length; b++) {
    const below = bands[b - 1]!.closes;
    const band = bands[b]!;
    band.closes = { start: Math.max(band.closes.start, below.end), end: Math.max(band.closes.end, below.end + 1) };
  }
  const roofLands = crane.fit({ kind: 'roof', floor: -1, index: 0 }, Math.max(at(phases.roof, 0.3), bands.at(-1)!.closes.end + 1)).lands;

  // Between pieces the crane brings bundles where the work is, and takes the
  // scaffold back down at the end, so it is never idle for long.
  const where = (t: number): PlannedLift['to'] | null => {
    if (t >= phases.strike.start && t < at(phases.strike, 0.93)) return 'yard';
    if (t >= phases.frame.start && t < phases.frame.end) return 'deck';
    if (t >= phases.frame.end && t < phases.roof.start) return 'planks';
    // Into the pit, or onto the roof below, only until the crew starts on the floor there.
    if (phases.foundation && t >= phases.foundation.start && t < at(phases.foundation, 0.55)) return 'pit';
    if (phases.deck && t < phases.deck.start) return 'roofBelow';
    // While the machines dig or the floor is poured, the crane stocks the laydown at the front of the site.
    if (t < phases.frame.start) return 'front';
    return null;
  };
  const filler = length + back + 2;
  let bundle = 0;
  const busy = { start: at(phases.setOut, 0.1), end: at(phases.strike, 0.93) };
  for (const gap of crane.gaps(busy)) {
    for (let t = gap.start + 1.5; t + filler <= gap.end; t += filler + 2.5) {
      const to = where(t + length);
      if (!to) continue;
      crane.fit({ kind: to === 'yard' ? 'scaffold' : 'bundle', floor: -1, index: bundle++, to }, t + length);
    }
  }

  // The yard opens stocked. Whenever a pick would run a rack down past its
  // reserve, the truck comes in time to top every rack up, and a last load
  // after the final pick leaves the yard as it opened, ready for the next block.
  const deliveries: Delivery[] = [];
  const kinds = Object.keys(YARD) as StockKind[];
  const picks = {} as Record<StockKind, number[]>;
  for (const kind of kinds) picks[kind] = crane.booked.filter((l) => l.kind === kind).map((l) => l.start + PICK * length);
  const visit = DELIVERY.drive * 2 + DELIVERY.unload;
  const count = (times: number[], t: number) => times.filter((p) => p < t).length;
  const onHand = (kind: StockKind, t: number) =>
    YARD[kind].opening + deliveries.reduce((sum, d) => sum + (t >= d.unload.end ? (d.pieces[kind] ?? 0) : 0), 0) - count(picks[kind], t);
  const order = (arrives: number): Delivery => {
    const unload = { start: arrives + DELIVERY.drive, end: arrives + DELIVERY.drive + DELIVERY.unload };
    const pieces: Delivery['pieces'] = {};
    for (const kind of kinds) {
      const now = onHand(kind, unload.end);
      const still = picks[kind].length - count(picks[kind], unload.end);
      const n = Math.min(YARD[kind].capacity - now, still + YARD[kind].opening - now);
      if (n > 0) pieces[kind] = n;
    }
    return { arrives, unload, leaves: arrives + visit, pieces };
  };
  for (;;) {
    const last = deliveries.at(-1);
    const after = last ? last.unload.end : -Infinity;
    let due = Infinity;
    for (const kind of kinds) {
      const short = picks[kind].find((p) => p >= after && onHand(kind, p) - 1 < YARD[kind].reserve);
      if (short !== undefined) due = Math.min(due, short);
    }
    if (due === Infinity) break;
    deliveries.push(order(Math.max(last?.leaves ?? 0, due - 2 - DELIVERY.unload - DELIVERY.drive)));
  }
  const lastPick = Math.max(0, ...kinds.flatMap((kind) => picks[kind]));
  const restock = order(Math.max(deliveries.at(-1)?.leaves ?? 0, lastPick + 2));
  if (Object.keys(restock.pieces).length > 0 && restock.leaves <= seconds - 2) deliveries.push(restock);

  return { seconds, phases, floors, levels, lift: length, craneReturn: back, frame, bands, roofLands, lifts: crane.booked, deliveries, pours };
}

/** The share of the block's height its facade covers at `t`. */
export function facadeShare(schedule: SiteSchedule, t: number): number {
  if (t >= schedule.phases.clad.end && t >= schedule.bands.at(-1)!.closes.end) return 1;
  return schedule.bands.reduce((sum, band) => sum + progress(band.closes, t), 0) / schedule.bands.length;
}

/** How many floors' columns stand at `t`, counting a floor once its last column is in. */
export function floorsFramed(schedule: SiteSchedule, t: number): number {
  return schedule.frame.filter((floor) => t >= floor.columns.at(-1)!).length;
}

/** How many of each piece the yard holds at `t`: what it opened with and was delivered so far, less what the crane has picked up. */
export function stock(schedule: SiteSchedule, kind: StockKind, t: number): number {
  let delivered = YARD[kind].opening;
  for (const delivery of schedule.deliveries) {
    const n = delivery.pieces[kind] ?? 0;
    delivered += Math.floor(n * progress(delivery.unload, t));
  }
  const picked = schedule.lifts.filter((lift) => lift.kind === kind && t >= lift.start + PICK * schedule.lift).length;
  return Math.max(0, delivered - picked);
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

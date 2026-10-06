// Timing for the build job (spec 9.4 and 9.5), kept free of three so it can
// be tested on its own.

/** Shortest crane lift in seconds; quicker phases group more floors per lift. */
export const MIN_TRIP = 0.3;
/** Shortest time a delivered panel has to fade before the plane passes it. */
export const MIN_FADE = 0.1;
/** The roof lift sets off this long before the roof phase starts. */
export const ROOF_LEAD = 0.1;
/** Length of the roof lift. */
export const ROOF_LIFT = 0.55;

/** Phase lengths at speed 1 (spec 9.4), for a block H units tall. */
export function phaseDurations(height: number, first: boolean) {
  const s = Math.sqrt(height / 3);
  return {
    survey: 0.5,
    prep: first ? 0.6 : 0.5,
    foundation: Math.max(0.6, 0.8 * s),
    frame: Math.max(0.8, 1.2 * s),
    scaffold: 0.5,
    cladding: Math.max(0.9, 1.3 * s),
    roof: 0.7,
    cleanup: 0.5,
  };
}

/** No build runs longer than this at speed 1; spec 18 has an 8 hour block take about 9.8 s. */
export const MAX_BUILD_SECONDS = 9.8;

type Durations = ReturnType<typeof phaseDurations>;

/**
 * How far each phase runs before the next begins (spec 9.5 allows up to 20%
 * overlap): a little, where it reads naturally. The roof waits until the
 * facade is done.
 */
const OVERLAP = { survey: 0.9, prep: 0.9, foundation: 1, frame: 0.85, scaffold: 1, cladding: 1, roof: 0.9 } as const;

function layout(d: Durations) {
  const o = OVERLAP;
  const survey = 0;
  const prep = survey + d.survey * o.survey;
  const foundation = prep + d.prep * o.prep;
  const frame = foundation + d.foundation * o.foundation;
  const scaffold = frame + d.frame * o.frame;
  const cladding = scaffold + d.scaffold * o.scaffold;
  const roof = cladding + d.cladding * o.cladding;
  const cleanup = roof + d.roof * o.roof;
  return { d, at: { survey, prep, foundation, frame, scaffold, cladding, roof, cleanup }, total: cleanup + d.cleanup };
}

/**
 * Phase start times and the total. Very long blocks compress their
 * foundation, frame, and cladding so no build passes MAX_BUILD_SECONDS.
 */
export function phaseSchedule(height: number, first: boolean) {
  const d = phaseDurations(height, first);
  const schedule = layout(d);
  if (schedule.total <= MAX_BUILD_SECONDS) return schedule;
  const o = OVERLAP;
  const scaled = d.foundation * o.foundation + d.frame * o.frame + d.cladding * o.cladding;
  const k = (MAX_BUILD_SECONDS - (schedule.total - scaled)) / scaled;
  return layout({ ...d, foundation: d.foundation * k, frame: d.frame * k, cladding: d.cladding * k });
}

/** Crew size from spec 10.1; a block under 15 minutes gets one worker (spec 18). */
export function crewSize(minutes: number): number {
  return minutes < 15 ? 1 : Math.min(6, 2 + Math.floor(minutes / 30));
}

/**
 * Floors per crane lift over a phase: one floor a lift where time allows,
 * never more than six lifts, and none shorter than MIN_TRIP.
 */
export function craneBatch(floors: number, seconds: number): number {
  const lifts = Math.max(1, Math.min(6, floors, Math.floor(seconds / MIN_TRIP)));
  return Math.ceil(floors / lifts);
}

export type BuildSchedule = ReturnType<typeof phaseSchedule>;

export interface PanelLift {
  /** First floor of the band the panel covers. */
  r0: number;
  /** One past the band's last floor. */
  r1: number;
  /** When the crane sets off for the stack. */
  start: number;
  /** When the panel is in place in front of its band. */
  lands: number;
  /** When the clipping plane passes the band's top. */
  passes: number;
}

/**
 * When the crane brings each band of floors its panel during cladding (spec
 * 9.4 phase 5). Each lift lands as the plane reaches its band, starts no
 * earlier than the frame's last lift ends, and is done before the roof lift.
 */
export function panelLifts(floors: number, schedule: BuildSchedule): PanelLift[] {
  const { d, at } = schedule;
  const batch = craneBatch(floors, d.cladding);
  const floorTime = d.cladding / floors;
  const trip = batch * floorTime;
  const lifts: PanelLift[] = [];
  let free = at.frame + d.frame;
  for (let r0 = 0; r0 < floors; r0 += batch) {
    const r1 = Math.min(floors, r0 + batch);
    const reaches = at.cladding + r0 * floorTime;
    const passes = at.cladding + r1 * floorTime;
    const start = Math.max(free, reaches - trip);
    const lands = Math.min(Math.max(reaches, start + MIN_TRIP), passes - MIN_FADE, at.roof - ROOF_LEAD);
    lifts.push({ r0, r1, start, lands, passes });
    free = lands;
  }
  return lifts;
}

// M4 jobs

/** Most rubble cubes one demolition draws (spec 11.1). */
export const RUBBLE_MAX = 400;
/** Rubble cube edge for blocks small enough to fill at this size. */
export const RUBBLE_EDGE = 0.4;

/**
 * Rubble cubes that fill a block's volume (spec 11.1): 0.4 cubes where 400
 * of them are enough, larger cubes for larger blocks.
 */
export function rubbleGrid(height: number, footprint = 4): { edge: number; across: number; up: number; count: number } {
  let edge = RUBBLE_EDGE;
  for (;;) {
    const across = Math.max(1, Math.round(footprint / edge));
    const up = Math.max(1, Math.round(height / edge));
    const count = across * across * up;
    if (count <= RUBBLE_MAX) return { edge, across, up, count };
    edge *= 1.04;
  }
}

/**
 * Demolition beats in seconds (spec 11.1): rails up by 0.15, the ball lands
 * at 0.4, rubble is down and gone by 1.1. The dump truck drives off after.
 */
export const DEMOLISH = {
  rails: 0.15,
  contact: 0.4,
  fadeStart: 0.8,
  rubbleEnd: 1.1,
  truckGone: 1.45,
} as const;

/** Shrink length (spec 11.2): 0.9 s plus 0.2 s per removed floor, at most 2 s. */
export function shrinkDuration(removedFloors: number): number {
  return Math.min(2.0, 0.9 + 0.2 * Math.max(1, removedFloors));
}

/**
 * Extend phases (spec 11.2) for floors of total height H added at the top or
 * the base: the frame and cladding scale like a build's, with shorter
 * minimums, and the roof cap comes off and goes back on only at the top.
 */
export function extendSchedule(addedHeight: number, top: boolean) {
  const s = Math.sqrt(addedHeight / 3);
  const d = {
    capOff: top ? 0.5 : 0,
    frame: Math.max(0.6, 1.2 * s),
    cladding: Math.max(0.6, 1.3 * s),
    roof: top ? 0.55 : 0,
    strike: 0.35,
    cleanup: 0.4,
  };
  const scaffold = 0.05;
  const frame = Math.max(0.25, d.capOff);
  const cladding = frame + d.frame;
  const roof = cladding + d.cladding - 0.1;
  const strike = top ? roof + d.roof - 0.15 : cladding + d.cladding;
  const cleanup = strike + d.strike - 0.1;
  return { d, at: { scaffold, frame, cladding, roof, strike, cleanup }, total: cleanup + d.cleanup };
}

/** Settle (spec 9.2): blocks slide to their new height. */
export const SETTLE_SECONDS = 0.4;
/** Under reduced motion every move is a plain slide of this length (spec 9.7). */
export const CALM_SECONDS = 0.25;

/**
 * Relocate beats (spec 11.3): the block slides out of the tower to where the
 * crane can hook it, travels to its new height outside the tower, and
 * slides back in. Longer trips take a little longer.
 */
export function relocateSchedule(distance: number) {
  const out = 0.3;
  const travel = Math.min(0.9, 0.45 + 0.02 * distance);
  const back = 0.35;
  const at = { hook: 0, out: 0.1, travel: 0.1 + out, back: 0.1 + out + travel, park: 0.1 + out + travel + back };
  return { out, travel, back, at, total: at.park + 0.3 };
}

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

/** Phase start times, with the small overlaps from spec 9.5, and the total. */
export function phaseSchedule(height: number, first: boolean) {
  const d = phaseDurations(height, first);
  const survey = 0;
  const prep = survey + d.survey * 0.9;
  const foundation = prep + d.prep * 0.9;
  const frame = foundation + d.foundation;
  const scaffold = frame + d.frame * 0.85;
  const cladding = scaffold + d.scaffold;
  const roof = cladding + d.cladding;
  const cleanup = roof + d.roof * 0.9;
  return { d, at: { survey, prep, foundation, frame, scaffold, cladding, roof, cleanup }, total: cleanup + d.cleanup };
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

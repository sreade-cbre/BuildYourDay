import * as THREE from 'three';
import { BLOCK_FOOTPRINT, UNITS_PER_MINUTE } from '../core/layout';
import type { Block } from '../core/model';
import { rngFromString } from '../core/rng';
import { HOOK_HANG, type CranePose } from '../scene/crew/Crane';
import { CRANE_PARK, HOMES, SITE_Y, STACK, WORKER_GATE, WORK_SPOTS, type Spot as Home } from '../scene/crew/Crew';
import { ARM_REST, type ArmPose } from '../scene/crew/Excavator';
import type { LiveKit } from '../scene/crew/LiveKit';
import { BEAM_SIZE, DECK_THICKNESS, type BundleKind } from '../scene/crew/props';
import type { ScaffoldFace } from '../scene/crew/Scaffold';
import type { Worker } from '../scene/crew/Worker';
import type { WorkerAnim } from '../scene/crew/workerAnims';
import { PAD_OFFSET, PLOT_TOP_Y } from '../scene/Foundation';
import { DEPOT_TOP_Y, GROUND_Y } from '../scene/Ground';
import { RAMP, ROAD_Z } from '../scene/SiteYard';
import { easeInOutCubic, easeOutBack, easeOutBounce, easeOutCubic, type Ease } from './easing';
import { Path, angleBetween, type Point2 } from './path';
import type { JobScene } from './jobs/scene';
import * as plan from './sitePlan';

// A block built in real time, the way a construction site would build it,
// over the block's whole time (see sitePlan.ts for the program). Everything
// here is a function of the time since the block started: where each worker
// is and what they are doing, where each machine is, what the crane carries,
// and how far every part of the building has got. So the site can be shown
// as it stands at any moment, whether it has been watched all along or the
// app has just opened, and the motion between those moments plays at a real
// pace: workers walk at 1.2 units a second, the crane takes nine seconds a
// lift, and hammers keep their own rhythm.
//
// The day's first block starts from grass. The surveyor sets out the
// footprint and a worker drives a stake at each corner, a bulldozer clears
// the plot in passes, the excavator digs the pit while a dump truck hauls the
// spoil away, and the footings, rebar, and slab go in, the mixer pouring and
// the crew screeding. A block on the tower gets a hoist and a guard rail on
// the roof below, and its floor is pumped up and poured. Then, floor by
// floor, the columns rise, the crane brings the beams, a deck goes down, and
// the crew bolts up and climbs to the next deck. The scaffold goes up around
// the frame, the crane brings each band of facade panels and the facade
// closes behind the scaffold, the roof cap goes on, and the scaffold comes
// down with the crew, who head home as the time runs out.

const TAU = Math.PI * 2;
const deg = (d: number) => (d * Math.PI) / 180;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Panels hang just in front of the front face, inside the scaffold. */
const PANEL_Z = BLOCK_FOOTPRINT / 2 + 0.07;
/** The ring road the crew walks round the tower, clear of it and the scaffold. */
const RING = 3.1;
/** Inside the scaffold on the left face, toward the hoist. */
const PLANK_X = -2.18;
/** The crew waits here on the plot, out of the machines' way. */
const WAIT_SPOTS: Point2[] = [{ x: -1.7, z: 4.25 }, { x: -0.6, z: 4.35 }, { x: 0.5, z: 4.25 }, { x: 1.5, z: 4.35 }];
/** On a deck, by the edge whose beams each worker bolts. */
const DECK_SPOTS = [
  { x: -1.25, z: 1.35, heading: 0 },
  { x: 1.35, z: 0.85, heading: Math.PI / 2 },
  { x: -1.35, z: -1.0, heading: -Math.PI / 2 },
  { x: 0.9, z: -1.3, heading: Math.PI },
];
const ROOF_SPOTS = [
  { x: -1.1, z: 1.05, heading: 0 },
  { x: 1.05, z: -0.55, heading: Math.PI / 2 },
];
/** On the roof below a stacked block, fixing the guard rail. */
const RAIL_SPOTS = [
  { x: -1.5, z: 1.85, heading: 0 },
  { x: 1.8, z: 0.8, heading: Math.PI / 2 },
  { x: -1.8, z: -0.4, heading: -Math.PI / 2 },
  { x: 0.9, z: -1.85, heading: Math.PI },
];
/** Screed lanes across a slab or floor. */
const SCREED_X = [-1.2, 1.2, -0.4, 0.4];
/** Where each of the crew ties the mesh on the roof below before a stacked floor's pour: two spots each. */
const MESH_SPOTS: ReadonlyArray<readonly [Place, Place]> = [
  [{ x: -1.0, y: 0, z: 1.0, heading: 0 }, { x: -1.0, y: 0, z: -0.2, heading: Math.PI }],
  [{ x: 1.0, y: 0, z: 1.0, heading: 0 }, { x: 1.0, y: 0, z: -0.2, heading: Math.PI }],
  [{ x: -0.9, y: 0, z: -1.2, heading: Math.PI / 2 }, { x: -0.2, y: 0, z: -0.6, heading: -Math.PI / 2 }],
  [{ x: 0.35, y: 0, z: -1.5, heading: -Math.PI / 2 }, { x: 0.3, y: 0, z: 0.4, heading: Math.PI / 2 }],
];
/** The formwork run along the front while the machines dig: from the laydown at the left end to the cages. */
const FORMWORK_RUN = { laydown: { x: -3.1, z: 4.7 }, cages: { x: 0.5, z: 4.7 } };
/** Where the crane sets bundles down at the front of the site, beside the rebar tiers and in its reach. */
const FRONT_LAYDOWN = { x: 2.3, z: 4.6 };
/** The banksman watches the yard while the crane picks from it, clear of the mixer's lane. */
const BANKSMAN = { x: 6.1, z: -1.6 };
/** A laborer carries from the yard to the bay in front of the tower. */
const STACK_PICK = { x: 6.6, z: -1.75 };
const BAY = { x: 1.9, z: 3.2 };
/** Where each of the crew on the building stands on the scaffold at the start of the strike. */
const SCAFFOLD_SPOTS: ReadonlyArray<readonly [ScaffoldFace, number]> = [['front', -0.45], ['left', 0.35], ['front', 0.55], ['left', -0.45]];
/** The facade panels of a band: two on the front face and two on the left, where the scaffold has planks. */
const PANEL_SPOTS: ReadonlyArray<readonly [ScaffoldFace, number]> = [['front', -0.51], ['front', 0.51], ['left', 0.51], ['left', -0.51]];
const PANELS_PER_BAND = PANEL_SPOTS.length;
/** Each panel covers half a face. */
const PANEL_WIDTH = BLOCK_FOOTPRINT / 2 - 0.02;
/** Panels on hand at once: a band closing and the next arriving. */
const PANEL_SLOTS = 8;
/** Bundle props: the last is the deck bundle, the rest the crane's other loads. */
const DECK_BUNDLE = 7;
/** A bundle's height: its lifting point sits this far above its base. */
const BUNDLE_TOP = 0.21;
const FILLER_BUNDLES = 7;
/** Corner columns stand just inside the footprint. */
const COLUMN_INSET = BLOCK_FOOTPRINT / 2 - 0.07;
const COLUMNS_PER_FLOOR = 4;
/** Beams go in front, right, back, left: slots as SiteProps.setBeam numbers them. */
const BEAM_SLOTS = [0, 2, 1, 3];
/** Where the slinger stands to hook on a load at each rack of the yard. */
const SLING_SPOTS: Record<'column' | 'beam' | 'deck' | 'panel' | 'bundle', Point2> = {
  column: { x: 6.75, z: -2.05 },
  beam: { x: 7.7, z: -2.0 },
  deck: { x: 8.6, z: -1.5 },
  panel: { x: 7.3, z: -1.35 },
  bundle: { x: 9.4, z: -1.45 },
};
/** The delivery truck's way in: along the street, back in through the gate, and park by the yard. */
const TRUCK = { street: ROAD_Z, lane: 6.7, park: 1.25 };
/** The footprint's corners, front right first, round to the back right. */
const CORNERS: Point2[] = [{ x: 1, z: 1 }, { x: -1, z: 1 }, { x: -1, z: -1 }, { x: 1, z: -1 }];
/** Dozer lanes across the plot. */
const LANES = [0.4, -1.5, 2.1];
/** A screed pass along a lane takes this long at speed 1. */
const SCREED_PASS = 6;
/** The crane lowers loads from this far above where they land (as in choreography.ts). */
const DROP = 0.25;

type Run = (u: number, t: number) => void;

interface Segment {
  t0: number;
  t1: number;
  run: Run;
}

/**
 * What one object does over the block, as segments in time order that never
 * overlap. Between segments it stays as the last one left it.
 */
class Track {
  private readonly segments: Segment[] = [];

  constructor(private readonly before: (t: number) => void) {}

  add(t0: number, t1: number, run: Run): void {
    const start = Math.max(t0, this.end);
    this.segments.push({ t0: start, t1: Math.max(start, t1), run });
  }

  get end(): number {
    return this.segments.at(-1)?.t1 ?? -Infinity;
  }

  apply(t: number): void {
    let lo = 0;
    let hi = this.segments.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.segments[mid]!.t0 <= t) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (found < 0) {
      this.before(t);
      return;
    }
    const s = this.segments[found]!;
    s.run(s.t1 > s.t0 ? clamp01((t - s.t0) / (s.t1 - s.t0)) : 1, t);
  }
}

interface Place {
  x: number;
  y: number;
  z: number;
  heading: number;
}

/**
 * The square road round the tower. A route from one point outside the tower
 * to another goes to the road, along it the short way round, and off again.
 */
function ringRoute(from: Point2, to: Point2): Point2[] {
  const perimeter = 8 * RING;
  // The nearest point on the road, and how far round it is from the front right corner.
  const project = (p: Point2): { point: Point2; along: number } => {
    const x = Math.min(RING, Math.max(-RING, p.x));
    const z = Math.min(RING, Math.max(-RING, p.z));
    const sides = [
      { point: { x, z: RING }, along: RING - x, d: Math.abs(p.z - RING) },
      { point: { x: -RING, z }, along: 3 * RING - z, d: Math.abs(p.x + RING) },
      { point: { x, z: -RING }, along: 5 * RING + x, d: Math.abs(p.z + RING) },
      { point: { x: RING, z }, along: 7 * RING + z, d: Math.abs(p.x - RING) },
    ];
    const best = sides.reduce((a, b) => (b.d < a.d ? b : a));
    return { point: best.point, along: best.along % perimeter };
  };
  const corners = [
    { point: { x: RING, z: RING }, along: 0 },
    { point: { x: -RING, z: RING }, along: 2 * RING },
    { point: { x: -RING, z: -RING }, along: 4 * RING },
    { point: { x: RING, z: -RING }, along: 6 * RING },
  ];
  const a = project(from);
  const b = project(to);
  const ahead = (b.along - a.along + perimeter) % perimeter;
  const forward = ahead <= perimeter / 2;
  const distance = forward ? ahead : perimeter - ahead;
  const between = corners
    .map((c) => ({ point: c.point, d: forward ? (c.along - a.along + perimeter) % perimeter : (a.along - c.along + perimeter) % perimeter }))
    .filter(({ d }) => d > 1e-6 && d < distance - 1e-6)
    .sort((p, q) => p.d - q.d);
  return dedupe([from, a.point, ...between.map(({ point }) => point), b.point, to]);
}

function dedupe(points: Point2[]): Point2[] {
  const out: Point2[] = [];
  for (const p of points) {
    const last = out.at(-1);
    if (!last || Math.hypot(last.x - p.x, last.z - p.z) > 1e-4) out.push(p);
  }
  return out;
}

/** One worker's day on the site. */
class Crewman {
  readonly track: Track;
  /** Where they will be once their last segment ends; null off site. */
  place: Place | null = null;

  constructor(readonly worker: Worker, private readonly pace: number) {
    this.track = new Track(() => worker.hide());
  }

  get free(): number {
    return this.track.end;
  }

  private span(length: number, speed: number, start: number, by?: number): number {
    const natural = length / (speed * this.pace);
    return by === undefined ? natural : Math.max(0.3, Math.min(natural, by - start));
  }

  /** Arrives at the first point and walks the rest. */
  enter(at: number, points: Point2[], y: number, options: { face?: number; by?: number; anim?: WorkerAnim } = {}): number {
    this.place = { x: points[0]!.x, y, z: points[0]!.z, heading: 0 };
    return this.walk(at, points.slice(1), options);
  }

  /** Walks a route on one level from where they stand. Returns when they arrive. */
  walk(at: number, points: Point2[], options: { y?: number; face?: number; by?: number; anim?: WorkerAnim } = {}): number {
    const from = this.place!;
    const y = options.y ?? from.y;
    const route = dedupe([{ x: from.x, z: from.z }, ...points]);
    const start = Math.max(at, this.free);
    if (route.length < 2) {
      if (options.face !== undefined) this.place = { ...from, y, heading: options.face };
      return start;
    }
    const path = new Path(route);
    const duration = this.span(path.length, plan.WALK_SPEED, start, options.by);
    const anim = options.anim ?? 'walk';
    const face = options.face;
    const end = route.at(-1)!;
    const lastHeading = path.atFraction(1).heading;
    const worker = this.worker;
    const pace = this.pace;
    this.track.add(start, start + duration, (u, t) => {
      worker.show();
      const p = path.atFraction(u, 0.25);
      worker.place(p.x, y, p.z, u >= 1 && face !== undefined ? face : p.heading);
      worker.setAnimationAt(u >= 1 ? 'idle' : anim, (t - start) * pace);
    });
    this.place = { x: end.x, y, z: end.z, heading: face ?? lastHeading };
    return start + duration;
  }

  /** Stays where they are at a task until `until`. */
  work(until: number, anim: WorkerAnim, options: { offset?: number; face?: number } = {}): void {
    const p = this.place!;
    const start = this.free;
    const heading = options.face ?? p.heading;
    this.place = { ...p, heading };
    if (until <= start) return;
    const worker = this.worker;
    const pace = this.pace;
    const offset = options.offset ?? 0;
    this.track.add(start, until, (_u, t) => {
      worker.show();
      worker.place(p.x, p.y, p.z, heading);
      worker.setAnimationAt(anim, (t - start) * pace + offset);
    });
  }

  /** Stays put with an animation picked moment by moment, like a banksman who signals only during lifts. */
  watch(until: number, animAt: (t: number) => WorkerAnim): void {
    const p = this.place!;
    const start = this.free;
    if (until <= start) return;
    const worker = this.worker;
    const pace = this.pace;
    this.track.add(start, until, (_u, t) => {
      worker.show();
      worker.place(p.x, p.y, p.z, p.heading);
      worker.setAnimationAt(animAt(t), (t - start) * pace);
    });
  }

  /** Climbs straight up or down to `y`. */
  climb(at: number, y: number, by?: number): number {
    const p = this.place!;
    const start = Math.max(at, this.free);
    const duration = this.span(Math.abs(y - p.y), plan.CLIMB_SPEED, start, by);
    const worker = this.worker;
    const pace = this.pace;
    this.track.add(start, start + duration, (u, t) => {
      worker.show();
      worker.place(p.x, p.y + (y - p.y) * easeInOutCubic(u), p.z, p.heading);
      worker.setAnimationAt(u >= 1 ? 'idle' : 'walk', (t - start) * pace);
    });
    this.place = { ...p, y };
    return start + duration;
  }

  /** Rides the hoist cage, standing where they are on it, to `y`. */
  ride(start: number, end: number, y: number): void {
    const p = this.place!;
    const worker = this.worker;
    this.track.add(start, end, (u) => {
      worker.show();
      worker.place(p.x, p.y + (y - p.y) * easeInOutCubic(u), p.z, Math.PI / 2);
      worker.setAnimationAt('ride', u);
    });
    this.place = { ...p, y, heading: Math.PI / 2 };
  }

  /** Screeds up and down a lane, pulling the board, until `until`. */
  screed(until: number, x: number, y: number): void {
    const start = Math.max(this.free, 0);
    if (until <= start) return;
    const worker = this.worker;
    const pace = this.pace;
    this.track.add(start, until, (_u, t) => {
      const passes = ((t - start) * pace) / SCREED_PASS;
      const leg = passes % 2;
      const back = leg > 1;
      const s = back ? leg - 1 : leg;
      // Walking backward along the lane, the board in front.
      const z = back ? -1.6 + 3.2 * s : 1.6 - 3.2 * s;
      worker.show();
      worker.place(x, y, z, back ? Math.PI : 0);
      worker.setAnimationAt('screed', (t - start) * pace);
    });
    this.place = { x, y, z: 1.6, heading: 0 };
  }

  /**
   * Carries loads from one place to another and walks back for more, round
   * the ring road unless `direct`, until `until`; ends back at the first place.
   */
  carry(until: number, pick: Point2, drop: Point2, direct = false): void {
    const start = Math.max(this.free, 0);
    const path = new Path(direct ? [pick, drop] : ringRoute(pick, drop));
    const trip = path.length / (plan.WALK_SPEED * this.pace);
    const pause = 2 / this.pace;
    const cycle = 2 * (trip + pause);
    const loops = Math.floor((until - start) / cycle);
    if (loops < 1) {
      this.work(until, 'idle');
      return;
    }
    const end = start + loops * cycle;
    const worker = this.worker;
    const pace = this.pace;
    this.track.add(start, end, (_u, t) => {
      const local = (t - start) % cycle;
      worker.show();
      if (local < pause) {
        worker.place(pick.x, SITE_Y, pick.z, path.atFraction(0).heading);
        worker.setAnimationAt('idle', local);
      } else if (local < pause + trip) {
        const p = path.atFraction((local - pause) / trip, 0.25);
        worker.place(p.x, SITE_Y, p.z, p.heading);
        worker.setAnimationAt('carry', (t - start) * pace);
      } else if (local < 2 * pause + trip) {
        worker.place(drop.x, SITE_Y, drop.z, path.atFraction(1).heading);
        worker.setAnimationAt('idle', local);
      } else {
        const p = path.atFraction(1 - (local - 2 * pause - trip) / trip, 0.25);
        worker.place(p.x, SITE_Y, p.z, p.heading + Math.PI);
        worker.setAnimationAt('walk', (t - start) * pace);
      }
    });
    this.place = { x: pick.x, y: SITE_Y, z: pick.z, heading: 0 };
    this.work(until, 'idle');
  }

  /** Walks off site by the gate and is gone. */
  leave(at: number, by: number): void {
    const p = this.place!;
    const route = p.y > SITE_Y + 0.05 ? [] : ringRoute({ x: p.x, z: p.z }, WORKER_GATE).slice(1);
    const end = this.walk(at, route, { by });
    const worker = this.worker;
    this.track.add(end, end, () => worker.hide());
    this.place = null;
  }
}

interface Drive {
  x: number;
  z: number;
  heading: number;
}

/** One machine's day: drives between home and its work, and what its parts do there. */
class Rig {
  readonly track: Track;
  private at: Drive;
  private rolled = 0;

  constructor(
    private readonly move: (state: Drive & { distance: number }) => void,
    readonly home: Home,
    private readonly rest: () => void,
    private readonly pace: number,
  ) {
    this.at = { ...home };
    this.track = new Track(() => {
      move({ ...home, distance: 0 });
      rest();
    });
  }

  get free(): number {
    return this.track.end;
  }

  /** Drives a route; reversing keeps the heading it started with. Returns when it arrives. */
  drive(at: number, points: Point2[], options: { reverse?: boolean; face?: number; speed?: number; by?: number; parts?: (t: number) => void } = {}): number {
    const path = new Path(dedupe([{ x: this.at.x, z: this.at.z }, ...points]));
    const start = Math.max(at, this.free);
    const natural = path.length / ((options.speed ?? plan.DRIVE_SPEED) * this.pace);
    const duration = options.by === undefined ? natural : Math.max(0.5, Math.min(natural, options.by - start));
    const rolled = this.rolled;
    const sign = options.reverse ? -1 : 1;
    const parts = options.parts ?? this.rest;
    const face = options.face;
    this.track.add(start, start + duration, (u, t) => {
      const e = easeInOutCubic(u);
      const p = path.atFraction(e, 0.6);
      let heading = options.reverse ? p.heading + Math.PI : p.heading;
      if (face !== undefined && u > 0.85) heading += angleBetween(heading, face) * ((u - 0.85) / 0.15);
      this.move({ x: p.x, z: p.z, heading, distance: rolled + sign * e * path.length });
      parts(t);
    });
    const end = path.atFraction(1);
    this.at = { x: end.x, z: end.z, heading: face ?? (options.reverse ? end.heading + Math.PI : end.heading) };
    this.rolled = rolled + sign * path.length;
    return start + duration;
  }

  /** Stays where it is until `until`, its parts moving as `parts` says. */
  idle(until: number, parts?: (t: number) => void): void {
    const start = this.free;
    if (until <= start) return;
    const state = { ...this.at, distance: this.rolled };
    const run = parts ?? this.rest;
    this.track.add(start, until, (_u, t) => {
      this.move(state);
      run(t);
    });
  }
}

/** What the crane carries: shown on the hook, then set down where it goes. */
/** A load on the hook, placed by its lifting point: the middle of its top. */
interface Cargo {
  place(at: THREE.Vector3): void;
  /** Where the sling legs take hold, for a load whose lifting point is at `at`. */
  rig(at: THREE.Vector3): THREE.Vector3[];
}

interface Lift {
  plan: plan.PlannedLift;
  start: number;
  length: number;
  /** The load's lifting point as the hook takes it, given when the lift began, since the racks run down. */
  from: (start: number) => THREE.Vector3;
  /** The load's lifting point once it is set down. */
  to: THREE.Vector3;
  /** How far the load hangs below the hook on its slings, and how far it reaches below its lifting point. */
  sling: number;
  reach: number;
  cargo: Cargo;
  landing: Ease;
  /** For a bundle set down where the work is, when it has been used. */
  used: number;
}

interface Puff {
  t: number;
  /** Where it rises; a function for one that follows a machine. */
  at: THREE.Vector3 | (() => THREE.Vector3 | null);
  count: number;
  spread: number;
  /** Sparks rather than dust. */
  sparks?: boolean;
}

/** Excavator arm through one dig cycle (spec 10.3), c in [0, 1). */
function digPose(c: number): ArmPose {
  const k = (from: number, to: number, a: number, b: number) =>
    c <= a ? from : c >= b ? to : from + (to - from) * easeInOutCubic((c - a) / (b - a));
  const boom = c < 0.4 ? k(deg(-30), deg(25), 0, 0.25) : k(deg(25), deg(-30), 0.25, 0.42);
  const stick = c < 0.5 ? k(deg(40), deg(95), 0, 0.25) : k(deg(95), deg(40), 0.75, 1);
  const bucket = c < 0.6 ? k(deg(30), deg(140), 0.25, 0.4) : k(deg(140), deg(30), 0.6, 0.75);
  const swing = c < 0.6 ? k(0, deg(-60), 0.42, 0.6) : k(deg(-60), 0, 0.75, 1);
  return { swing, boom, stick, bucket };
}

function blendPose(a: CranePose, b: CranePose, t: number): CranePose {
  return {
    slew: a.slew + angleBetween(a.slew, b.slew) * t,
    trolley: a.trolley + (b.trolley - a.trolley) * t,
    hookY: a.hookY + (b.hookY - a.hookY) * t,
  };
}

/** The last item in a list sorted by `key` whose key is at most `t`, or -1. */
function lastAtOrBefore<T>(items: readonly T[], t: number, key: (item: T) => number): number {
  let lo = 0;
  let hi = items.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (key(items[mid]!) <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

export interface SiteOptions {
  /** Nothing else is built or under way on the day, so the site starts from grass. */
  first: boolean;
  /** Animation speed. */
  pace: number;
  /** Reduced motion: the building goes up with the time, with no crew, machines, or crane. */
  calm: boolean;
}

/** What the live site may move right now; a job may have borrowed the crane or machines. */
export interface SiteParts {
  crane: boolean;
  machines: boolean;
}

/** Who does what on the site. */
interface Roles {
  foreman: Crewman;
  /** Bolt up the frame from the decks. */
  connectors: Crewman[];
  /** Fix the facade from the scaffold. */
  cladders: Crewman[];
  banksman: Crewman | null;
  /** Hooks loads on at the yard. */
  slinger: Crewman | null;
  /** Carries, and unloads the deliveries. */
  laborer: Crewman | null;
  /** Everyone who works up on the building, in scaffold order. */
  elevated: Crewman[];
}

/** How many come to work on a block: the bigger the job, the bigger the crew. */
export function liveCrewSize(minutes: number): number {
  return minutes < 15 ? 4 : minutes < 30 ? 6 : 8;
}

/** A crew member's next piece of work on the building. */
interface Assignment {
  /** When the piece lands; they guide it in, then fix it. */
  lands: number;
  /** How long they fix it for, at most. */
  fix: number;
  /** Where they stand. */
  spot: Place;
  /** On a deck, or on the scaffold. */
  on: 'deck' | 'plank';
  /** Where the sparks fly. */
  joint: THREE.Vector3;
}

const BOLT_SECONDS = 16;
const SPARK_EVERY = 0.7;
/** A filler bundle stays where it was set down this long before it is used up. */
const BUNDLE_STAYS = 75;

export class SiteScript {
  readonly first: boolean;
  readonly baseY: number;
  readonly height: number;
  readonly top: number;
  readonly floors: number;
  readonly levels: number;
  /** Seconds the block lasts. */
  readonly seconds: number;
  readonly phases: plan.Phases;
  private readonly schedule: plan.SiteSchedule;
  private readonly floorHeight: number;
  private readonly crewmen: Crewman[] = [];
  private readonly rigs: Rig[] = [];
  private readonly truck: Track;
  private readonly lifts: Lift[] = [];
  private readonly puffs: Puff[] = [];
  private readonly cage: Track;
  private readonly rng: () => number;
  private readonly stand: Place;
  private readonly tripod: Point2;
  private tripodUp = Infinity;
  private tripodDown = Infinity;
  private readonly stakeTimes: Array<{ from: number; to: number }> = [];
  private readonly frame: plan.FloorPlan[];
  private readonly bands: plan.BandPlan[];
  private readonly roofLands: number;
  private hoistUp: plan.Span | null = null;
  private hoistDown: plan.Span | null = null;
  private dozerPasses: Array<{ t0: number; t1: number; from: number; to: number; extra: number }> = [];
  private digSpan: plan.Span | null = null;
  private readonly mixerVisits: plan.Span[] = [];
  /** Whether the site has the crane this frame, rather than a job. */
  private craneOurs = true;
  private readonly cache = new Map<string, string>();
  private readonly v = new THREE.Vector3();

  constructor(
    private readonly scene: JobScene,
    readonly block: Block,
    private readonly kit: LiveKit,
    private readonly options: SiteOptions,
  ) {
    const { tower } = scene;
    const pose = tower.poseFor(block);
    this.first = options.first;
    this.baseY = pose.baseY;
    this.height = pose.height;
    this.top = pose.baseY + pose.height;
    this.floors = Math.max(1, Math.round(pose.height / (scene.settings().slotMinutes * UNITS_PER_MINUTE)));
    this.floorHeight = pose.height / this.floors;
    this.levels = plan.levelsFor(this.floors);
    this.seconds = (block.end - block.start) * 60;
    this.schedule = plan.siteSchedule(this.seconds, this.first, this.floors, plan.LIFT_SECONDS / options.pace, plan.CRANE_RETURN_SECONDS / options.pace);
    this.phases = this.schedule.phases;
    this.frame = this.schedule.frame;
    this.bands = this.schedule.bands;
    this.roofLands = this.schedule.roofLands;
    this.rng = rngFromString(block.id);
    const jitter = (this.rng() - 0.5) * 0.1;
    this.tripod = { x: 2.45 + jitter, z: 2.45 - jitter };
    this.stand = { x: this.tripod.x + 0.33, y: SITE_Y, z: this.tripod.z + 0.33, heading: Math.atan2(-1, -1) };

    const { props, scaffold, hoist, stockyard, flatbed } = kit;
    kit.park();
    props.setup(scene.token(block), this.baseY, this.height);
    props.setFloorCount(this.floors);
    stockyard.setToken(scene.token(block));
    scaffold.layout(this.baseY, this.height, this.floors);
    this.cage = new Track(() => hoist.setCage(SITE_Y));
    this.truck = new Track(() => flatbed.hide());

    if (options.calm) {
      this.planStructureOnly();
    } else {
      this.planCrew();
      this.planMachines();
      this.planDeliveries();
    }
    this.planLifts();
    this.planBundlesUsed();
    this.puffs.sort((a, b) => a.t - b.t);
  }

  // Planning

  /** Reduced motion: every piece appears in place on time, with nothing to carry it. */
  private planStructureOnly(): void {
    const { phases } = this;
    if (this.first) {
      CORNERS.forEach((_, k) => {
        const at = plan.at(phases.setOut, 0.45 + 0.13 * k);
        this.stakeTimes.push({ from: at, to: at });
      });
      this.planDozer(true);
      this.digSpan = { start: phases.excavate!.start, end: phases.excavate!.end };
    }
  }

  /** The crew for a block of this length, each with their trade. */
  private makeRoles(): Roles {
    const pace = this.options.pace;
    const count = liveCrewSize(this.block.end - this.block.start);
    const crew = this.kit.workers.slice(0, count).map((worker) => new Crewman(worker, pace));
    this.crewmen.push(...crew);
    const [foreman, ...rest] = crew;
    const take = () => rest.shift() ?? null;
    const connectors = [take()!];
    if (count >= 6) connectors.push(take()!);
    const cladders = [take()!];
    if (count >= 8) cladders.push(take()!);
    const banksman = count >= 6 ? take() : null;
    const slinger = take();
    const laborer = take();
    return { foreman: foreman!, connectors, cladders, banksman, slinger, laborer, elevated: [...connectors, ...cladders] };
  }

  private planCrew(): void {
    const roles = this.makeRoles();
    const { foreman, elevated } = roles;
    const { phases, first } = this;
    const strike = phases.strike;

    // The foreman sets up the tripod, sets out the footprint, and keeps an
    // eye on the job, walking down to the tower now and then, until the
    // strike, then packs up and goes.
    foreman.enter(phases.setOut.start, [WORKER_GATE, { x: this.stand.x, z: WORKER_GATE.z }, this.stand], SITE_Y, { face: this.stand.heading });
    this.tripodUp = foreman.free + 0.4;
    const pack = plan.at(strike, 0.8);
    this.tripodDown = pack + 0.8;
    foreman.work(plan.at(phases.setOut, 0.9), 'survey');
    this.patrol(foreman, pack);
    foreman.work(pack + 1, 'idle');
    foreman.leave(pack + 1, plan.at(strike, 0.96));

    if (first) this.planGroundworks(elevated);
    else this.planMobilize(elevated);
    this.planFrame(roles);
    this.planEnvelope(roles);
    this.planStrike(elevated);
    this.planGroundCrew(roles);
  }

  /** The foreman's rounds: at the tripod, then down to the tower and back. */
  private patrol(man: Crewman, until: number): void {
    const look = { x: 1.3, z: 3.75 };
    const round = 150 / this.options.pace;
    for (let t = man.free; t + round <= until; t += round) {
      man.work(t + round * 0.55, 'survey');
      man.walk(t + round * 0.55, ringRoute(this.stand, look).slice(1), { face: Math.PI });
      man.work(man.free + 12 / this.options.pace, 'idle');
      man.walk(man.free, ringRoute(look, this.stand).slice(1), { face: this.stand.heading });
    }
    man.work(until, 'survey');
  }

  /** Setting out, clearing, digging, and the slab: the day's first block. */
  private planGroundworks(up: Crewman[]): void {
    const { phases } = this;
    const setOut = phases.setOut;
    const clear = phases.clear!;
    const foundation = phases.foundation!;

    // A stake at each corner, from the front right round to the back right.
    const staker = up[0]!;
    const window = { start: plan.at(setOut, 0.35), end: plan.at(setOut, 0.97) };
    staker.enter(window.start, [WORKER_GATE, { x: 2.5, z: WORKER_GATE.z }], SITE_Y);
    plan.split(window, 4).forEach((slot, k) => {
      const c = CORNERS[k]!;
      const stand = { x: c.x * 2.5, z: c.z * 2.5 };
      const stake = { x: c.x * 2.1, z: c.z * 2.1 };
      staker.walk(slot.start, [stand], { face: Math.atan2(stake.x - stand.x, stake.z - stand.z), by: plan.at(slot, 0.4) });
      const from = staker.free;
      staker.work(slot.end, 'hammer');
      this.stakeTimes.push({ from, to: from + Math.min(5, 0.5 * (slot.end - from)) });
      this.puffs.push({ t: from + Math.min(5, 0.5 * (slot.end - from)), at: new THREE.Vector3(stake.x, SITE_Y + 0.03, stake.z), count: 14, spread: 0.3 });
    });

    // The rest of the crew arrives as clearing starts and, clear of the
    // machines along the front, gets the footings ready: one checks levels,
    // two tie rebar cages, one carries formwork boards along from the laydown.
    up.forEach((man, j) => {
      const spot = WAIT_SPOTS[j]!;
      if (j === 0) man.walk(clear.start, ringRoute(man.place!, spot).slice(1), { face: Math.PI, by: plan.at(clear, 0.2) });
      else man.enter(clear.start + 0.4 * j, [WORKER_GATE, spot], SITE_Y, { face: Math.PI });
      if (j === 2) {
        man.walk(man.free, [FORMWORK_RUN.laydown], { by: man.free + 2 });
        man.carry(foundation.start - 2, FORMWORK_RUN.laydown, FORMWORK_RUN.cages, true);
        man.walk(man.free, [spot], { face: Math.PI });
        man.work(foundation.start, 'idle');
      } else man.work(foundation.start, j === 0 ? 'survey' : 'hammer', { offset: j * 0.7 });
    });

    // Footings: each pad's formwork, then the rebar mat, then the pour.
    const pads = [0, 1, 2, 3].map((i) => ({ x: (i === 1 || i === 2 ? 1 : -1) * PAD_OFFSET, z: (i >= 2 ? 1 : -1) * PAD_OFFSET }));
    up.forEach((man, j) => {
      const pad = pads[(j + 2) % 4]!;
      const spot = { x: pad.x * 0.6, z: pad.z * 0.6 };
      man.walk(plan.at(foundation, 0.02), [spot], { face: Math.atan2(pad.x - spot.x, pad.z - spot.z), by: plan.at(foundation, 0.1) });
      man.work(plan.at(foundation, 0.33), 'hammer', { offset: j * 0.25 });
      man.walk(plan.at(foundation, 0.33), [{ x: SCREED_X[j]!, z: 1.1 - j * 1.0 }], { by: plan.at(foundation, 0.36) });
      man.work(plan.at(foundation, 0.49), 'hammer', { offset: j * 0.3 });
      // Back to the slab edge while the concrete goes in.
      man.walk(plan.at(foundation, 0.49), [{ x: SCREED_X[j]!, z: 2.55 }], { face: Math.PI, by: plan.at(foundation, 0.53) });
      man.work(plan.at(foundation, 0.63), 'idle');
      man.walk(plan.at(foundation, 0.63), [{ x: SCREED_X[j]!, z: 2.25 }], { by: plan.at(foundation, 0.64) });
      man.climb(plan.at(foundation, 0.64), 0, plan.at(foundation, 0.65));
      man.walk(plan.at(foundation, 0.65), [{ x: SCREED_X[j]!, z: 1.6 }], { y: 0, face: 0, by: plan.at(foundation, 0.67) });
      man.screed(plan.at(foundation, 0.97), SCREED_X[j]!, 0);
    });
    this.puffs.push({ t: plan.at(foundation, 0.76), at: new THREE.Vector3(0, 0.02, 2.1), count: 48, spread: 0.8 });
  }

  /** A stacked block: the hoist, the crew up to the roof below, the rail, and the poured floor. */
  private planMobilize(up: Crewman[]): void {
    const { phases, baseY } = this;
    const setOut = phases.setOut;
    const mobilize = phases.mobilize!;
    const deck = phases.deck!;
    this.hoistUp = { start: plan.at(setOut, 0.15), end: plan.at(setOut, 0.15) + Math.min(6 / this.options.pace, 0.3 * (setOut.end - setOut.start)) };

    // The crew carries planks to the hoist and loads the cage until it goes up.
    up.forEach((man, j) => {
      const rider = this.kit.hoist.riderSpot(j);
      const road = { x: -RING, z: rider.z };
      man.enter(plan.at(setOut, 0.45) + 0.5 * j, ringRoute(WORKER_GATE, road), SITE_Y, { anim: 'carry', face: Math.PI / 2 });
      man.carry(plan.at(mobilize, 0.1), road, rider, true);
      man.work(plan.at(mobilize, 0.12), 'idle');
    });
    // Up together to the roof below, then out to fix the guard rail.
    const ride = this.rideHoist(up, plan.at(mobilize, 0.12), baseY, plan.at(mobilize, 0.4));
    up.forEach((man, j) => {
      const spot = RAIL_SPOTS[j]!;
      const rider = this.kit.hoist.riderSpot(j);
      man.walk(ride, [{ x: -1.7, z: rider.z }, spot], { face: spot.heading, by: plan.at(mobilize, 0.45) });
      man.work(deck.start, 'hammer', { offset: j * 0.3 });
      // They tie the mesh across the floor, then work the concrete level as the pump pours it.
      const y = baseY + 0.05;
      const [a, b] = MESH_SPOTS[j]!;
      man.walk(deck.start, [a], { y, face: a.heading, by: plan.at(deck, 0.03) });
      man.work(plan.at(deck, 0.08), 'hammer', { offset: j * 0.2 });
      man.walk(man.free, [b], { y, face: b.heading, by: plan.at(deck, 0.1) });
      man.work(plan.at(deck, 0.14), 'hammer', { offset: j * 0.2 });
      man.walk(man.free, [{ x: SCREED_X[j]!, z: 1.6 }], { y, face: 0, by: plan.at(deck, 0.17) });
      man.screed(plan.at(deck, 0.97), SCREED_X[j]!, y);
    });
    this.puffs.push({ t: plan.at(deck, 0.62), at: new THREE.Vector3(0, baseY + 0.06, 2.1), count: 36, spread: 0.6 });
  }

  /**
   * The crew rides the hoist together: each walks onto the cage, it goes
   * once everyone is on, and it arrives at `y`. Returns when it arrives.
   */
  private rideHoist(riders: Crewman[], at: number, y: number, by: number): number {
    let depart = at;
    riders.forEach((man, j) => {
      const rider = this.kit.hoist.riderSpot(j);
      depart = Math.max(depart, man.walk(at, [rider], { face: Math.PI / 2 }));
    });
    const from = riders[0]!.place!.y;
    const natural = Math.abs(y - from) / (plan.RIDE_SPEED * this.options.pace);
    const arrive = depart + Math.max(0.5, Math.min(natural, by - depart));
    for (const man of riders) man.ride(depart, arrive, y);
    this.cage.add(depart, arrive, (u) => this.kit.hoist.setCage(from + (y - from) * easeInOutCubic(u)));
    return arrive;
  }

  // Where things are

  /** The height the crew stands at while building a floor: the slab or floor, then each deck. */
  private standY(floor: number): number {
    if (floor === 0) return this.first && this.baseY <= 0.5 ? 0 : this.baseY + 0.05;
    return this.ringY(floor - 1);
  }

  /** The top of a floor, where its ring of beams sits. */
  private ringY(ring: number): number {
    return this.baseY + (ring + 1) * this.floorHeight;
  }

  private floorBase(floor: number): number {
    return this.baseY + floor * this.floorHeight;
  }

  /** The deck the crew works on at `t`, while the frame is going up, or the roof after. */
  private workDeckY(t: number): number {
    const k = lastAtOrBefore(this.frame, t, (f) => f.start);
    if (t >= this.phases.frame.end || k < 0) return k < 0 ? this.standY(0) : this.top;
    return this.standY(k);
  }

  /** Where a corner column stands. */
  private corner(i: number): Point2 {
    const c = CORNERS[i]!;
    return { x: c.x * COLUMN_INSET, z: c.z * COLUMN_INSET };
  }

  /** The center of a ring's beam in a slot: 0 front, 1 back, 2 right, 3 left. */
  private beamCenter(slot: number, y: number): THREE.Vector3 {
    const half = BLOCK_FOOTPRINT / 2 - BEAM_SIZE / 2 - 0.01;
    const [x, z] = [[0, half], [0, -half], [half, 0], [-half, 0]][slot]!;
    return new THREE.Vector3(x, y, z);
  }

  /** Where a crew member stands on the scaffold at a level. */
  private plank(j: number, level: number): Place {
    const [face, along] = SCAFFOLD_SPOTS[j % SCAFFOLD_SPOTS.length]!;
    return this.kit.scaffold.standPoint(face, level, along);
  }

  /** A facade panel's place: in front of its half of the front or left face, `level` up. */
  private panelPlace(level: number, index: number): { center: THREE.Vector3; turn: number; stand: Place } {
    const [face, along] = PANEL_SPOTS[index]!;
    const bandHeight = this.height / this.levels;
    const y = this.baseY + (level + 0.5) * bandHeight;
    const stand = this.kit.scaffold.standPoint(face, level, along);
    const center = face === 'front' ? new THREE.Vector3(stand.x, y, PANEL_Z) : new THREE.Vector3(-PANEL_Z, y, stand.z);
    return { center, turn: face === 'front' ? 0 : Math.PI / 2, stand };
  }

  /**
   * Moves a crew member on the building to a spot: across a deck, along the
   * scaffold's planks round the corner, or from a deck out onto the planks,
   * climbing where the height changes.
   */
  private go(man: Crewman, to: Place, on: 'deck' | 'plank', at: number, by: number): void {
    const p = man.place!;
    const inside = Math.abs(p.x) < 2.05 && Math.abs(p.z) < 2.05;
    const start = Math.max(at, man.free);
    const span = Math.max(0.9, by - start);
    if (on === 'deck') {
      if (Math.abs(p.y - to.y) > 1e-3) man.climb(start, to.y, start + span * 0.5);
      man.walk(man.free, [to], { face: to.heading, by: start + span });
      return;
    }
    if (inside) {
      // Over to the face, up or down inside the frame, and out onto the plank.
      const near = Math.abs(to.z - 2.16) < 0.1 ? { x: to.x, z: 1.75 } : { x: -1.75, z: to.z };
      man.walk(start, [near], { by: start + span * 0.3 });
      man.climb(man.free, to.y, start + span * 0.75);
      man.walk(man.free, [{ x: to.x, z: to.z }], { face: to.heading, by: start + span });
      return;
    }
    if (Math.abs(p.y - to.y) > 1e-3) man.climb(start, to.y, start + span * 0.5);
    const front = (q: Point2) => Math.abs(q.z - 2.16) < 0.1;
    const turn = front(p) !== front(to) ? [{ x: PLANK_X, z: 2.18 }] : [];
    man.walk(man.free, [...turn, { x: to.x, z: to.z }], { face: to.heading, by: start + span });
  }

  /** Works through a list of pieces: to each one, guide it in, then fix it with sparks flying. */
  private work(man: Crewman, jobs: Assignment[], until: number): void {
    jobs.sort((a, b) => a.lands - b.lands);
    jobs.forEach((job, n) => {
      const next = jobs[n + 1];
      const travel = Math.min(8, 3 / this.options.pace + 2);
      this.go(man, job.spot, job.on, Math.max(man.free, job.lands - travel - 2), job.lands - 1);
      man.work(job.lands, 'survey', { offset: n * 0.37 });
      const end = Math.max(job.lands + 1, Math.min(job.lands + job.fix, next ? next.lands - travel - 2 : until));
      man.work(end, 'hammer', { offset: n * 0.19 });
      for (let t = job.lands + 0.6; t < end; t += SPARK_EVERY) this.puffs.push({ t, at: job.joint, count: 0, spread: 0, sparks: true });
    });
  }

  /** The frame, floor by floor: each column and beam guided in and bolted, then the deck laid. */
  private planFrame(roles: Roles): void {
    const { connectors, elevated } = roles;
    const { phases, frame, first, baseY } = this;
    const floating = first && baseY > 0.5;
    if (floating) {
      // Nothing stands under it, so the hoist goes up for the climb.
      this.hoistUp = { start: phases.frame.start, end: phases.frame.start + Math.min(6, 0.04 * (phases.frame.end - phases.frame.start)) };
      elevated.forEach((man, j) => {
        const edge = { x: man.place!.x, z: 2.25 };
        man.walk(phases.frame.start, [edge], { by: plan.at(phases.frame, 0.008) });
        man.climb(plan.at(phases.frame, 0.008), SITE_Y, plan.at(phases.frame, 0.012));
        const rider = this.kit.hoist.riderSpot(j);
        man.walk(plan.at(phases.frame, 0.012), ringRoute(edge, { x: -RING, z: rider.z }).slice(1), { by: plan.at(phases.frame, 0.03) });
      });
      this.rideHoist(elevated, plan.at(phases.frame, 0.03), this.standY(0), plan.at(phases.frame, 0.05));
    }
    elevated.forEach((man, j) => {
      const spot = DECK_SPOTS[j % DECK_SPOTS.length]!;
      const from = man.place!;
      const route = floating ? [{ x: -1.7, z: from.z }, spot] : [spot];
      man.walk(phases.frame.start, route, { y: this.standY(0), face: spot.heading, by: Math.max(phases.frame.start + 2, frame[0]!.columns[0]! - 3) });
    });

    const n = connectors.length;
    const jobs = connectors.map(() => [] as Assignment[]);
    frame.forEach((floor, k) => {
      const y = this.standY(k);
      floor.columns.forEach((lands, i) => {
        const c = CORNERS[i]!;
        const spot = { x: c.x * 1.45, y, z: c.z * 1.45, heading: Math.atan2(c.x, c.z) };
        const corner = this.corner(i);
        jobs[i % n]!.push({ lands, fix: BOLT_SECONDS, spot, on: 'deck', joint: new THREE.Vector3(corner.x, this.floorBase(k) + 0.1, corner.z) });
      });
      floor.beams.forEach((lands, j) => {
        const slot = BEAM_SLOTS[j]!;
        const center = this.beamCenter(slot, this.ringY(k));
        const offset = (j % 2 ? 1 : -1) * 0.5;
        const heading = [0, Math.PI, Math.PI / 2, -Math.PI / 2][slot]!;
        const spot = slot < 2 ? { x: offset, y, z: Math.sign(center.z) * 1.45, heading } : { x: Math.sign(center.x) * 1.45, y, z: offset, heading };
        const joint = slot < 2 ? new THREE.Vector3(offset * 3.6, center.y, center.z) : new THREE.Vector3(center.x, center.y, offset * 3.6);
        jobs[j % n]!.push({ lands, fix: BOLT_SECONDS, spot, on: 'deck', joint });
      });
    });
    // The deck: up onto the new floor as its bundle lands, and lay the sheets.
    connectors.forEach((man, c) => {
      const mine = jobs[c]!;
      mine.sort((a, b) => a.lands - b.lands);
      let next = 0;
      frame.forEach((floor, k) => {
        const before = mine.filter((job) => job.lands < floor.deck);
        this.work(man, before.slice(next), floor.deck);
        next = before.length;
        const y = this.ringY(k);
        const sheet = { x: c === 0 ? -0.8 : 0.8, y, z: c === 0 ? 0.9 : -0.9, heading: c === 0 ? 0 : Math.PI };
        man.climb(Math.max(man.free, floor.deck + 0.5), y, floor.deck + 3);
        man.walk(man.free, [sheet], { face: sheet.heading, by: floor.laid });
        const nextFloor = frame[k + 1];
        const until = nextFloor ? nextFloor.columns[0]! - 6 : phases.frame.end;
        man.work(Math.max(man.free + 1, until), 'hammer', { offset: c * 0.3 });
        for (let t = floor.laid; t < until; t += SPARK_EVERY * 2) this.puffs.push({ t, at: new THREE.Vector3(sheet.x, y + 0.03, sheet.z), count: 0, spread: 0, sparks: true });
      });
    });
  }

  /**
   * The facade and the roof. The cladders fix each panel the crane brings,
   * walking the planks and climbing a level as each band closes; once the
   * frame is done the connectors join them. Then two go up to fix the roof.
   */
  private planEnvelope(roles: Roles): void {
    const { connectors, cladders } = roles;
    const { phases, levels, bands, top } = this;
    // Cladders help on the first deck until the facade can start.
    const shift = Math.min(12 / this.options.pace, 0.02 * this.seconds);
    cladders.forEach((man, j) => man.work(bands[0]!.panels[0]! - shift - 4 - j, 'hammer', { offset: 0.4 + j * 0.2 }));
    const jobs = new Map<Crewman, Assignment[]>();
    const freeAt = new Map<Crewman, number>();
    bands.forEach((band, b) => {
      band.panels.forEach((lands, i) => {
        const pool = lands >= phases.frame.end + shift ? [...cladders, ...connectors] : cladders;
        // Whoever has been free longest takes the next panel.
        const man = pool.reduce((best, m) => ((freeAt.get(m) ?? -Infinity) < (freeAt.get(best) ?? -Infinity) ? m : best));
        freeAt.set(man, lands);
        const { center, stand } = this.panelPlace(b, i);
        const list = jobs.get(man) ?? [];
        list.push({ lands, fix: 18, spot: stand, on: 'plank', joint: center.clone().setY(center.y - (this.height / this.levels) * 0.45) });
        jobs.set(man, list);
      });
    });
    for (const [man, list] of jobs) this.work(man, list, phases.roof.start);

    // Two go up onto the roof to fix the cap the crane brings; anyone else
    // keeps on at the top of the scaffold.
    const roof = phases.roof;
    roles.elevated.forEach((man, j) => {
      if (j >= ROOF_SPOTS.length) {
        if (man.place && man.place.y < this.plank(j, levels - 1).y - 1e-3) this.go(man, this.plank(j, levels - 1), 'plank', man.free, roof.start);
        man.work(roof.end, 'hammer', { offset: j * 0.21 });
        return;
      }
      const spot = ROOF_SPOTS[j]!;
      man.climb(Math.max(roof.start, man.free), top, plan.at(roof, 0.12));
      man.walk(man.free, [spot], { face: spot.heading, by: plan.at(roof, 0.22) });
      man.work(this.roofLands, 'idle');
      man.work(roof.end, 'hammer', { offset: j * 0.3 });
      for (let t = this.roofLands + 1; t < roof.end; t += SPARK_EVERY * 1.5) this.puffs.push({ t, at: new THREE.Vector3(spot.x * 1.6, top + 0.02, spot.z * 1.6), count: 0, spread: 0, sparks: true });
    });
    bands.forEach((band, b) => {
      this.puffs.push({ t: band.closes.end, at: new THREE.Vector3((this.rng() - 0.5) * 2, this.baseY + ((b + 1) * this.height) / levels, 2.25), count: 24, spread: 0.5 });
    });
    this.puffs.push({ t: this.roofLands, at: new THREE.Vector3(1.6, top, 2.0), count: 20, spread: 0.4 });
  }

  /** The strike: the scaffold comes down with the crew, who then go home. */
  private planStrike(up: Crewman[]): void {
    const { phases, levels, first, baseY } = this;
    const strike = phases.strike;
    const fall = { start: plan.at(strike, 0.05), end: plan.at(strike, 0.7) };
    up.forEach((man, j) => {
      if (j < ROOF_SPOTS.length) {
        const plank = this.plank(j, levels - 1);
        man.walk(Math.max(strike.start, man.free), [{ x: plank.x, z: plank.z }], { by: plan.at(strike, 0.03) });
        man.climb(man.free, plank.y, plan.at(strike, 0.05));
      }
    });
    for (let level = levels - 1; level >= 1; level--) {
      const gone = plan.at(fall, 1 - level / levels);
      // Unclipping the scaffold at each level as it comes down.
      up.forEach((man, j) => {
        man.work(gone, 'hammer', { offset: j * 0.3 });
        man.climb(gone, this.plank(j, level - 1).y);
      });
    }
    const off = plan.at(strike, 0.71);
    up.forEach((man) => man.work(off, 'idle'));
    if (first && baseY <= 0.5) {
      up.forEach((man, j) => {
        man.climb(off, SITE_Y, plan.at(strike, 0.74));
        man.work(off + 0.2 * j, 'idle');
        man.leave(off + 0.2 * j, plan.at(strike, 0.94));
      });
    } else {
      // Along the planks to the hoist, down, and away.
      up.forEach((man, j) => {
        const rider = this.kit.hoist.riderSpot(j);
        const corner = man.place && man.place.z > 2.0 ? [{ x: PLANK_X, z: 2.18 }] : [];
        man.walk(off, [...corner, { x: PLANK_X, z: rider.z }], { by: plan.at(strike, 0.75) });
      });
      const down = this.rideHoist(up, plan.at(strike, 0.75), SITE_Y, plan.at(strike, 0.86));
      up.forEach((man, j) => {
        man.work(down + 0.2 * j, 'idle');
        man.leave(down + 0.2 * j, plan.at(strike, 0.95));
      });
      this.hoistDown = { start: plan.at(strike, 0.9), end: plan.at(strike, 0.97) };
    }
    if (first && baseY > 0.5) this.hoistDown = { start: plan.at(strike, 0.9), end: plan.at(strike, 0.97) };
    this.puffs.push({ t: plan.at(strike, 0.97), at: new THREE.Vector3(1.6, baseY + 0.05, 2.2), count: 56, spread: 1.0 });
  }

  /** True from the start of each lift until the crane is back over the yard, and while the mixer is in, when the banksman signals. */
  private signaling(t: number): boolean {
    if (this.mixerVisits.some((visit) => t >= visit.start && t < visit.end)) return true;
    const i = lastAtOrBefore(this.schedule.lifts, t, (l) => l.start);
    if (i < 0) return false;
    const lift = this.schedule.lifts[i]!;
    return t < lift.start + this.schedule.lift + this.schedule.craneReturn;
  }

  /** The banksman, the slinger at the yard, and the laborer who unloads and carries. */
  private planGroundCrew(roles: Roles): void {
    const { banksman, slinger, laborer } = roles;
    const { phases, schedule } = this;
    const begins = phases.foundation?.start ?? phases.mobilize!.start;
    const ends = plan.at(phases.strike, 0.9);
    const length = schedule.lift;
    if (banksman) {
      banksman.enter(begins, [WORKER_GATE, { x: 5.9, z: 1.0 }, BANKSMAN], SITE_Y, { face: Math.atan2(7.4 - BANKSMAN.x, -2.2 - BANKSMAN.z), by: begins + 8 });
      banksman.watch(ends, (t) => (this.signaling(t) ? 'signal' : 'idle'));
      banksman.leave(ends, plan.at(phases.strike, 0.98));
    }
    if (slinger) {
      slinger.enter(begins, [WORKER_GATE, { x: 5.9, z: 1.0 }, SLING_SPOTS.column], SITE_Y, { by: begins + 8 });
      for (const lift of schedule.lifts) {
        if (lift.start > ends) break;
        if (lift.kind === 'scaffold') {
          // Unhooks the scaffold coming down at the yard.
          const spot = SLING_SPOTS.bundle;
          slinger.walk(Math.max(slinger.free, lift.lands - 6), [spot], { face: Math.PI, by: lift.lands - 1 });
          slinger.work(lift.lands, 'survey');
          slinger.work(lift.lands + 3, 'hammer');
          continue;
        }
        const kind = lift.kind === 'roof' ? 'panel' : lift.kind === 'bundle' ? 'bundle' : lift.kind;
        const spot = SLING_SPOTS[kind];
        const hook = lift.start + 0.3 * length;
        slinger.walk(Math.max(slinger.free, hook - 6), [spot], { face: Math.PI, by: hook });
        slinger.work(lift.start + plan.PICK * length, 'hammer');
        slinger.work(lift.start + 0.62 * length, 'survey');
      }
      slinger.leave(Math.max(slinger.free, ends), plan.at(phases.strike, 0.99));
    }
    if (laborer) {
      const unload = this.kit.stockyard.unloadPoint;
      const truckSide = { x: unload.x - 0.55, z: unload.z };
      const firstDelivery = schedule.deliveries[0];
      const enter = Math.min(phases.frame.start, firstDelivery ? firstDelivery.unload.start - 12 : Infinity);
      laborer.enter(Math.max(0, enter), [WORKER_GATE, { x: 5.9, z: 1.0 }, STACK_PICK], SITE_Y, { by: Math.max(0, enter) + 8 });
      for (const delivery of schedule.deliveries) {
        if (delivery.unload.start < laborer.free) continue;
        laborer.carry(delivery.unload.start - 10, STACK_PICK, BAY);
        laborer.walk(laborer.free, [truckSide], { by: delivery.unload.start });
        laborer.carry(delivery.unload.end, truckSide, STACK_PICK, true);
        laborer.walk(laborer.free, [STACK_PICK]);
      }
      const leaves = plan.at(phases.strike, 0.5);
      laborer.carry(leaves, STACK_PICK, BAY);
      laborer.leave(Math.max(laborer.free, leaves), plan.at(phases.strike, 0.9));
    }
  }

  private planMachines(): void {
    const { crew } = this.scene;
    const pace = this.options.pace;
    const { phases } = this;
    const mixer = new Rig((s) => crew.mixer.drive(s, SITE_Y), HOMES.mixer, () => crew.mixer.setDrum(0), pace);
    this.rigs.push(mixer);
    const drum = (t: number) => crew.mixer.setDrum(((t * pace) / 1.5) * TAU);
    const visit = (arrive: number, leave: number) => {
      this.mixerVisits.push({ start: arrive, end: leave + plan.POUR.drive });
      mixer.drive(arrive, [WORK_SPOTS.mixer], { reverse: true, parts: drum, by: arrive + plan.POUR.drive });
      mixer.idle(leave, drum);
      mixer.drive(leave, [HOMES.mixer], { parts: drum, by: leave + plan.POUR.drive });
    };
    if (this.first) {
      this.planDozer(false);
      this.planDig();
      const foundation = phases.foundation!;
      visit(plan.at(foundation, 0.42), plan.at(foundation, 0.86));
    } else {
      const deck = phases.deck!;
      visit(plan.at(deck, 0.02), plan.at(deck, 0.84));
    }
    // Then back for every deck of the frame.
    for (const pour of this.schedule.pours) visit(pour.visit.start, pour.span.end);
  }

  /** The flatbed truck: along the street, back in through the gate to the yard, unload, and away. */
  private planDeliveries(): void {
    const { flatbed } = this.kit;
    const pace = this.options.pace;
    const roadY = (z: number) => (z <= RAMP.start ? DEPOT_TOP_Y : z >= RAMP.end ? GROUND_Y : DEPOT_TOP_Y + ((z - RAMP.start) / (RAMP.end - RAMP.start)) * (GROUND_Y - DEPOT_TOP_Y));
    const leg = (start: number, end: number, points: Point2[], reverse: boolean, load: number, rolled: number): number => {
      const path = new Path(points);
      this.truck.add(start, end, (u) => {
        const e = easeInOutCubic(u);
        const p = path.atFraction(e, 0.6);
        flatbed.drive({ x: p.x, z: p.z, heading: reverse ? p.heading + Math.PI : p.heading, distance: rolled + (reverse ? -1 : 1) * e * path.length }, roadY(p.z));
        flatbed.setLoad(load);
      });
      return rolled + (reverse ? -1 : 1) * path.length;
    };
    const { street, lane, park } = TRUCK;
    for (const delivery of this.schedule.deliveries) {
      const inTime = Math.min(plan.DELIVERY.drive, (delivery.unload.start - delivery.arrives) || plan.DELIVERY.drive);
      const along = delivery.arrives + inTime * 0.55;
      let rolled = leg(delivery.arrives, along, [{ x: -10, z: street }, { x: lane + 1.6, z: street }], false, 1, 0);
      rolled = leg(along, delivery.unload.start, [{ x: lane + 1.6, z: street }, { x: lane, z: street - 1.0 }, { x: lane, z: park }], true, 1, rolled);
      const parked = rolled;
      this.truck.add(delivery.unload.start, delivery.unload.end, (u) => {
        flatbed.drive({ x: lane, z: park, heading: 0, distance: parked }, DEPOT_TOP_Y);
        flatbed.setLoad(1 - u);
      });
      const out = Math.min(delivery.leaves, delivery.unload.end + plan.DELIVERY.drive / pace);
      leg(delivery.unload.end, out, [{ x: lane, z: park }, { x: lane, z: street - 0.9 }, { x: lane - 1.4, z: street }, { x: -10, z: street }], false, 0, parked);
      this.truck.add(out, out, () => flatbed.hide());
    }
  }

  /** The bulldozer clears the plot in passes, blade down going in and up coming back. */
  private planDozer(plannedOnly: boolean): void {
    const clear = this.phases.clear!;
    const pace = this.options.pace;
    const home = HOMES.bulldozer;
    const crew = this.scene.crew;
    const east = 6.2;
    const westmost = -3.9;
    const inReserve = 6 / pace;
    const outReserve = 6 / pace;
    const passes = Math.max(2, Math.min(10, Math.floor((clear.end - clear.start) / 22)));
    const working = { start: clear.start + inReserve, end: clear.end - outReserve };
    const slots = plan.split(working, passes);
    let front = 6;
    this.dozerPasses = slots.map((slot, k) => {
      const to = east - (east - westmost) * ((k + 1) / passes);
      const forward = Math.min((east - to) / (plan.PUSH_SPEED * pace), 0.55 * (slot.end - slot.start));
      const pass = { t0: slot.start, t1: slot.start + forward, from: front, to: to - 0.85, extra: k === passes - 1 ? 1.3 : 0 };
      front = to - 0.85 - pass.extra;
      return pass;
    });
    if (plannedOnly) return;
    const dozer = new Rig((s) => crew.bulldozer.drive(s, SITE_Y), home, () => crew.bulldozer.setBlade(0), pace);
    this.rigs.push(dozer);
    dozer.drive(clear.start, [{ x: east, z: LANES[0]! }], { by: working.start });
    slots.forEach((slot, k) => {
      const lane = LANES[k % LANES.length]!;
      const next = LANES[(k + 1) % LANES.length]!;
      const pass = this.dozerPasses[k]!;
      const to = pass.to + 0.85;
      if (k > 0) dozer.drive(slot.start - 0.01, [{ x: east, z: lane }], { by: slot.start });
      const blade = (t: number) => crew.bulldozer.setBlade(clamp01(Math.min((t - pass.t0) / 0.6, (pass.t1 - t) / 0.6 + 0.2)));
      dozer.drive(slot.start, [{ x: to, z: lane }], { speed: plan.PUSH_SPEED, by: pass.t1, parts: blade });
      this.puffs.push({ t: plan.at({ start: pass.t0, end: pass.t1 }, 0.5), at: new THREE.Vector3((east + to) / 2 - 0.9, SITE_Y + 0.05, lane), count: 40, spread: 0.9 });
      // Back up the lane for the next pass, or home after the last.
      if (k < passes - 1) dozer.drive(pass.t1, [{ x: east, z: lane }, { x: east + 0.4, z: next }], { reverse: true, by: slots[k + 1]!.start - 0.02 });
    });
    dozer.drive(working.end, [{ x: east, z: LANES[(passes - 1) % LANES.length]! }, home], { reverse: true, face: home.heading, by: clear.end });
  }

  /** The excavator digs the pit while the dump truck shuttles the spoil away. */
  private planDig(): void {
    const excavate = this.phases.excavate!;
    const pace = this.options.pace;
    const crew = this.scene.crew;
    const excavator = new Rig((s) => crew.excavator.drive(s, SITE_Y), HOMES.excavator, () => crew.excavator.setArm(ARM_REST), pace);
    const truck = new Rig(
      (s) => crew.dumpTruck.drive(s, SITE_Y),
      HOMES.dump,
      () => {
        crew.dumpTruck.setTilt(0);
        crew.dumpTruck.setLoad(0);
      },
      pace,
    );
    this.rigs.push(excavator, truck);
    const arrived = excavator.drive(excavate.start, [WORK_SPOTS.excavator], { by: plan.at(excavate, 0.08) });
    const leave = excavate.end - 5 / pace;
    const cycle = plan.DIG_SECONDS / pace;
    this.digSpan = { start: arrived, end: leave };
    excavator.idle(leave, (t) => crew.excavator.setArm(digPose(((t - arrived) / cycle) % 1)));
    excavator.drive(leave, [HOMES.excavator], { reverse: true, by: excavate.end });
    for (let at = arrived + cycle * 0.25; at < leave; at += cycle) {
      this.puffs.push({ t: at, at: () => crew.excavator.bucketPoint(new THREE.Vector3()), count: 26, spread: 0.6 });
    }

    // Each trip: back in, load over three dig cycles, drive off, tip, and come back.
    const tripIn = 3.5 / pace;
    const load = 3 * cycle;
    const tip = 4 / pace;
    const trip = 2 * tripIn + load + tip + 4 / pace;
    for (let at = arrived + 2; at + trip < leave; at += trip) {
      const docked = truck.drive(at, [WORK_SPOTS.dump], { reverse: true, by: at + tripIn });
      truck.idle(docked + load, (t) => {
        crew.dumpTruck.setTilt(0);
        crew.dumpTruck.setLoad(clamp01((t - docked) / load));
      });
      const home = truck.drive(docked + load, [HOMES.dump], {
        by: docked + load + tripIn,
        parts: () => {
          crew.dumpTruck.setTilt(0);
          crew.dumpTruck.setLoad(1);
        },
      });
      truck.idle(home + tip, (t) => {
        const u = clamp01((t - home) / tip);
        crew.dumpTruck.setTilt(deg(50) * Math.sin(u * Math.PI));
        crew.dumpTruck.setLoad(clamp01(1 - u * 2));
      });
    }
  }

  /** The crane's lifts, each carrying its piece from the yard to where it goes. */
  private planLifts(): void {
    const { props, stockyard } = this.kit;
    const schedule = this.schedule;
    const length = schedule.lift;
    const fh = this.floorHeight;
    const bandHeight = this.height / this.levels;
    const bundleKinds: BundleKind[] = ['rebar', 'formwork', 'scaffold'];
    // The racks run down, so a lift picks from the top of the stack as it
    // stood when the lift began. A piece that hangs upright stands on the
    // rack as the hook takes it.
    const rack = (kind: plan.StockKind, stands = 0) => {
      let point: THREE.Vector3 | null = null;
      return (start: number) => {
        if (!point) {
          point = stockyard.pickPoint(kind, plan.stock(schedule, kind, start));
          point.y += stands;
        }
        return point;
      };
    };
    // Lifting points: one strop for a column, two legs along a beam or panel, four for a bundle or the roof.
    const along = (spread: number, turn: number) => (p: THREE.Vector3) => {
      const dx = Math.cos(turn) * spread;
      const dz = -Math.sin(turn) * spread;
      return [new THREE.Vector3(p.x - dx, p.y, p.z - dz), new THREE.Vector3(p.x + dx, p.y, p.z + dz)];
    };
    const corners = (sx: number, sz: number) => (p: THREE.Vector3) =>
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => new THREE.Vector3(p.x + a! * sx, p.y, p.z + b! * sz));
    const bundleAt = (p: THREE.Vector3) => p.clone().setY(p.y - BUNDLE_TOP);
    // The front laydown has two spots, used in turn.
    let fronts = 0;
    for (const lift of schedule.lifts) {
      const base = { plan: lift, start: lift.start, length, used: Infinity };
      switch (lift.kind) {
        case 'column': {
          const index = lift.floor * 4 + lift.index;
          const c = this.corner(lift.index);
          this.lifts.push({
            ...base,
            from: rack('column', fh),
            to: new THREE.Vector3(c.x, this.floorBase(lift.floor) + fh, c.z),
            sling: 0.05,
            reach: fh,
            landing: easeOutCubic,
            cargo: { place: (p) => props.setColumnPiece(index, p.x, p.y - fh, p.z, fh), rig: (p) => [p.clone()] },
          });
          break;
        }
        case 'beam': {
          const slot = BEAM_SLOTS[lift.index]!;
          const center = this.beamCenter(slot, this.ringY(lift.floor));
          this.lifts.push({
            ...base,
            from: rack('beam', BEAM_SIZE),
            to: center.clone().setY(center.y + BEAM_SIZE / 2),
            sling: 0.5,
            reach: BEAM_SIZE,
            landing: easeOutBounce,
            cargo: {
              place: (p) => props.setBeam(lift.floor, slot, p.x, p.y - BEAM_SIZE / 2, p.z),
              rig: along(0.7, slot >= 2 ? Math.PI / 2 : 0),
            },
          });
          break;
        }
        case 'deck': {
          this.lifts.push({
            ...base,
            from: rack('deck'),
            to: new THREE.Vector3(0, this.ringY(lift.floor) + BEAM_SIZE / 2 + BUNDLE_TOP, 1.72),
            sling: 0.15,
            reach: BUNDLE_TOP,
            landing: easeOutCubic,
            cargo: { place: (p) => props.setBundle(DECK_BUNDLE, bundleAt(p), 'formwork'), rig: corners(0.24, 0.15) },
          });
          break;
        }
        case 'panel': {
          const { center, turn } = this.panelPlace(lift.floor, lift.index);
          const slot = lift.floor * PANELS_PER_BAND + lift.index;
          this.lifts.push({
            ...base,
            from: rack('panel', bandHeight),
            to: center.clone().setY(center.y + bandHeight / 2),
            sling: 0.35,
            reach: bandHeight,
            landing: easeOutCubic,
            cargo: {
              place: (p) => props.setPanel(slot, p.x, p.y - bandHeight / 2, p.z, bandHeight, 1, PANEL_WIDTH, turn),
              rig: along(0.5, turn),
            },
          });
          break;
        }
        case 'roof': {
          this.lifts.push({
            ...base,
            from: () => stockyard.bundlePoint.clone().setY(stockyard.bundlePoint.y + 0.1),
            to: new THREE.Vector3(0, this.top + 0.002, 0),
            sling: 1.0,
            reach: 0.1,
            landing: easeOutBack,
            cargo: { place: (p) => props.setRoof(p), rig: corners(1.4, 1.4) },
          });
          break;
        }
        case 'bundle':
        case 'scaffold': {
          const slot = lift.index % FILLER_BUNDLES;
          const kind: BundleKind = lift.kind === 'scaffold' ? 'scaffold' : bundleKinds[lift.index % bundleKinds.length]!;
          const rest =
            lift.to === 'yard'
              ? stockyard.bundlePoint.clone().add(new THREE.Vector3(0, 0.05, 0.35))
              : lift.to === 'front'
                ? new THREE.Vector3(FRONT_LAYDOWN.x + 0.75 * (fronts++ % 2), SITE_Y, FRONT_LAYDOWN.z)
                : lift.to === 'pit'
                ? new THREE.Vector3(1.1, SITE_Y, -1.1)
                : lift.to === 'roofBelow'
                  ? new THREE.Vector3(1.1, this.baseY, -1.1)
                  : new THREE.Vector3(1.0, this.workDeckY(lift.lands), -1.0);
          // Scaffold comes down from the top corner of the scaffold as it stands.
          const from =
            lift.kind === 'scaffold'
              ? () => new THREE.Vector3(2.3, this.scaffoldTop(lift.start) - 0.2 + BUNDLE_TOP, 2.3)
              : () => stockyard.bundlePoint.clone().setY(stockyard.bundlePoint.y + BUNDLE_TOP);
          this.lifts.push({
            ...base,
            from,
            to: rest.clone().setY(rest.y + BUNDLE_TOP),
            sling: 0.15,
            reach: BUNDLE_TOP,
            landing: easeOutCubic,
            cargo: { place: (p) => props.setBundle(slot, bundleAt(p), kind), rig: corners(0.24, 0.15) },
          });
          break;
        }
      }
    }
  }

  // Reading the site at a moment

  /** How high the facade has closed at `t`, in world units. */
  reveal(t: number): number {
    return this.baseY + this.height * plan.facadeShare(this.schedule, t);
  }

  /** What the crew is doing at `t`, for the block's label. */
  activity(t: number): string {
    return plan.activity(this.schedule, t);
  }

  /** True once the roof cap is on. */
  roofOn(t: number): boolean {
    return t >= this.roofLands;
  }

  /** How high the frame's columns stand at `t`, for the scaffold to climb with them. */
  private frameTop(t: number): number {
    let top = this.baseY;
    this.frame.forEach((floor, k) => {
      const up = floor.columns.filter((lands) => t >= lands).length;
      if (up > 0) top = this.floorBase(k) + (up / COLUMNS_PER_FLOOR) * this.floorHeight;
    });
    return t >= this.phases.frame.end ? this.top : top;
  }

  /** The scaffold's top at `t`: climbing with the frame, then coming down at the strike. */
  private scaffoldTop(t: number): number {
    const { baseY, height } = this;
    const rise = t < this.phases.frame.start ? 0 : Math.min(1, (this.frameTop(t) - baseY + 0.05) / (height + 0.05));
    const fall = plan.progress({ start: plan.at(this.phases.strike, 0.05), end: plan.at(this.phases.strike, 0.7) }, t);
    return baseY + (height + 0.05) * rise * (1 - fall);
  }

  /** Whether the crane holds a load at `t`, so the load is the crane's to place; never while a job has the crane. */
  private carrying(lift: Lift, t: number): boolean {
    const u = (t - lift.start) / lift.length;
    return this.craneOurs && !this.options.calm && u >= plan.PICK && u < 1;
  }

  /**
   * Shows the site as it stands `t` seconds into the block. `parts` says
   * whether the crane and machines are the site's to move; `previous` is the
   * moment shown before, so dust and sparks that came in between fly.
   */
  apply(t: number, parts: SiteParts, previous: number | null): void {
    for (const man of this.crewmen) man.track.apply(t);
    if (parts.machines) for (const rig of this.rigs) rig.track.apply(t);
    this.truck.apply(t);
    this.craneOurs = parts.crane;
    if (parts.crane && !this.options.calm) this.applyCrane(t);
    this.applyStructure(t);
    if (previous !== null && t > previous && t - previous < 1.5) {
      for (let i = lastAtOrBefore(this.puffs, previous, (p) => p.t) + 1; i < this.puffs.length; i++) {
        const puff = this.puffs[i]!;
        if (puff.t > t) break;
        if (puff.sparks) {
          this.kit.sparks.burst(puff.at as THREE.Vector3, this.rng);
          continue;
        }
        const point = typeof puff.at === 'function' ? (parts.machines ? puff.at() : null) : puff.at;
        if (point) this.kit.dust.puff(point, this.rng, puff.count, puff.spread);
      }
    }
  }

  private applyCrane(t: number): void {
    const { crane } = this.scene.crew;
    const parked: CranePose = { ...CRANE_PARK, hookY: crane.hookCeiling };
    const i = lastAtOrBefore(this.lifts, t, (l) => l.start);
    const lift = i >= 0 ? this.lifts[i]! : null;
    const back = this.schedule.craneReturn;
    if (!lift || t >= lift.start + lift.length + back) {
      crane.setPose(parked);
      return;
    }
    const from = lift.from(lift.start);
    const to = lift.to;
    const pick = crane.aim(from.x, from.z);
    const drop = crane.aim(to.x, to.z);
    const below = HOOK_HANG + lift.sling;
    const pickHook = from.y + below;
    const releaseHook = to.y + DROP + below;
    // High enough that the load's foot clears the tower and the stack on the way over.
    const travelY = Math.min(crane.pivotY - 0.45, Math.max(this.top, STACK.top) + 0.35 + lift.reach + below);
    const overPick = { ...pick, hookY: travelY };
    const atPick = { ...pick, hookY: pickHook };
    const overDrop = { ...drop, hookY: travelY };
    const atRelease = { ...drop, hookY: releaseHook };
    // The crane swings straight on from one lift to the next; it waits over the yard only when there is time.
    const previous = i > 0 ? this.lifts[i - 1]! : null;
    const fromPose = previous && lift.start - (previous.start + previous.length) < back + 0.5 ? this.releasePose(previous) : parked;
    const u = (t - lift.start) / lift.length;
    const e = easeInOutCubic;
    if (u >= 1) {
      const next = this.lifts[i + 1];
      // With the next lift close behind, the hook heads for it rather than home.
      if (next && next.start - (lift.start + lift.length) < back + 0.5) {
        crane.setPose(atRelease);
        return;
      }
      crane.setPose(blendPose(atRelease, parked, e(clamp01((t - lift.start - lift.length) / back))));
      return;
    }
    if (u < 0.3) crane.setPose(blendPose(fromPose, overPick, e(u / 0.3)));
    else if (u < plan.PICK) crane.setPose(blendPose(overPick, atPick, e((u - 0.3) / 0.15)));
    else if (u < 0.8) {
      const s = e((u - plan.PICK) / 0.35);
      const p = blendPose(atPick, overDrop, Math.max(0, (s - 0.2) / 0.8));
      p.hookY = pickHook + (travelY - pickHook) * easeOutCubic(Math.min(1, s * 2.5));
      crane.setPose(p);
      this.hang(lift, this.load(lift));
    } else if (u < 0.9) {
      crane.setPose(blendPose(overDrop, atRelease, e((u - 0.8) / 0.1)));
      this.hang(lift, this.load(lift));
    } else {
      crane.setPose(atRelease);
      this.hang(lift, this.load(lift).lerp(to, lift.landing((u - 0.9) / 0.1)));
    }
  }

  /** The load's lifting point where it hangs on the hook now. */
  private load(lift: Lift): THREE.Vector3 {
    const point = this.scene.crew.crane.hookPoint(this.v);
    return point.setY(point.y - lift.sling);
  }

  /** Places the load and rigs the slings from the hook to it. */
  private hang(lift: Lift, at: THREE.Vector3): void {
    lift.cargo.place(at);
    this.scene.crew.crane.setSling(lift.cargo.rig(at));
  }

  /** Where the crane lets go of a lift's load. */
  private releasePose(lift: Lift): CranePose {
    const crane = this.scene.crew.crane;
    return { ...crane.aim(lift.to.x, lift.to.z), hookY: lift.to.y + DROP + HOOK_HANG + lift.sling };
  }

  /**
   * When each bundle the crane set down is used: a while after it lands, as
   * the crew starts on the floor it sits on, or once the next bundle is set
   * down in its place.
   */
  private planBundlesUsed(): void {
    const latest = new Map<string, Lift>();
    for (const lift of this.lifts) {
      if (lift.plan.kind !== 'bundle') continue;
      let gone = lift.plan.lands + BUNDLE_STAYS;
      if (lift.plan.to === 'pit') gone = Math.min(gone, plan.at(this.phases.foundation!, 0.62));
      if (lift.plan.to === 'roofBelow') gone = Math.min(gone, plan.at(this.phases.deck!, 0.14));
      lift.used = gone;
      const spot = `${Math.round(lift.to.x * 100)}:${Math.round(lift.to.y * 100)}:${Math.round(lift.to.z * 100)}`;
      const before = latest.get(spot);
      if (before) before.used = Math.min(before.used, lift.plan.lands);
      latest.set(spot, lift);
    }
  }

  /** Sets a piece only when its state changed since it was last set. */
  private changed(key: string, state: string): boolean {
    if (this.cache.get(key) === state) return false;
    this.cache.set(key, state);
    return true;
  }

  private applyStructure(t: number): void {
    const { props, scaffold, hoist, rail, stockyard } = this.kit;
    const { phases, baseY, height, top, first } = this;
    const reveal = this.reveal(t);
    const q = (x: number) => Math.round(x * 1000) / 1000;

    // Setting out: the tripod, the footprint outline, and the stakes.
    const tripod = t >= this.tripodUp && t < this.tripodDown;
    if (this.changed('tripod', String(tripod))) {
      props.tripod.visible = tripod;
      props.tripod.position.set(this.tripod.x, SITE_Y, this.tripod.z);
      props.tripod.scale.setScalar(1);
    }
    const outlineGone = first ? phases.excavate!.start : plan.at(phases.deck!, 0.18);
    const outline = t >= outlineGone ? 0 : plan.progress({ start: phases.setOut.start + 4, end: plan.at(phases.setOut, 0.5) }, t);
    if (this.changed('outline', String(q(outline)))) {
      props.setOutlineY((first ? PLOT_TOP_Y : baseY) + 0.012);
      props.setOutline(outline);
    }
    if (first) {
      const pulled = t >= phases.excavate!.start;
      this.stakeTimes.forEach((time, k) => {
        const c = CORNERS[k]!;
        const driven = pulled || t < time.from ? 0 : time.to > time.from ? clamp01((t - time.from) / (time.to - time.from)) : 1;
        if (this.changed(`stake${k}`, String(q(driven)))) props.setStake(k, c.x * 2.1, c.z * 2.1, SITE_Y, Math.max(0.05, driven) * (driven > 0 ? 1 : 0));
      });
      // Clearing: the grass goes behind the blade and the plot fades to earth.
      let front = 6;
      for (const pass of this.dozerPasses) {
        if (t < pass.t0) break;
        const u = clamp01((t - pass.t0) / (pass.t1 - pass.t0));
        front = Math.min(front, pass.from + (pass.to - pass.from) * easeInOutCubic(u) - pass.extra * u);
      }
      if (this.changed('front', String(Math.round(front * 50)))) this.scene.ground.setClearFront(front);
      const fade = plan.progress(phases.clear!, t);
      if (this.changed('fade', String(q(fade)))) this.scene.ground.setPrepFade(fade);
      const dig = this.digSpan ? plan.progress(this.digSpan, t) : 0;
      if (this.changed('pit', String(q(dig)))) props.setPit(dig);
      // Footings, rebar, and the slab.
      const foundation = phases.foundation!;
      const pads = [0, 1, 2, 3].map((i) => {
        const at = plan.at(foundation, 0.06 + 0.07 * i);
        return t < at ? 0 : easeOutBack(clamp01((t - at) / 1.0));
      });
      if (this.changed('pads', pads.map(q).join())) props.setPads(pads);
      const rebar = plan.progress({ start: plan.at(foundation, 0.3), end: plan.at(foundation, 0.48) }, t);
      if (this.changed('rebar', String(q(rebar)))) props.setRebar(rebar);
      const slab = plan.progress({ start: plan.at(foundation, 0.5), end: plan.at(foundation, 0.76) }, t);
      if (this.changed('slab', String(q(slab)))) props.setSlab(slab);
      if (baseY > 0.5) {
        const floor = plan.progress({ start: phases.frame.start, end: phases.frame.start + 4 }, t);
        if (this.changed('floor', String(q(floor)))) props.setFloor(baseY, floor);
      }
    } else {
      const deck = phases.deck!;
      const floor = plan.progress({ start: plan.at(deck, 0.18), end: plan.at(deck, 0.62) }, t);
      if (this.changed('floor', String(q(floor)))) props.setFloor(baseY, easeOutCubic(floor));
      const railUp = plan.progress({ start: plan.at(phases.mobilize!, 0.35), end: plan.at(phases.mobilize!, 0.85) }, t);
      const railDown = plan.progress({ start: plan.at(phases.strike, 0.8), end: plan.at(phases.strike, 0.88) }, t);
      const railRise = railUp * (1 - railDown);
      if (this.changed('rail', String(q(railRise)))) {
        if (railRise > 0) rail.show(baseY, easeOutCubic(railRise));
        else rail.hide();
      }
    }

    // The hoist mast, and its cage wherever the crew last rode it.
    const mast = (this.hoistUp ? plan.progress(this.hoistUp, t) : 0) * (this.hoistDown ? 1 - plan.progress(this.hoistDown, t) : 1);
    const hoistTop = Math.max(baseY + 1.2, top);
    if (this.changed('mast', String(q(mast)))) {
      if (mast > 0) hoist.setMast(SITE_Y, hoistTop, easeOutCubic(mast));
      else hoist.hide();
    }
    if (mast > 0) this.cage.apply(t);

    // The frame, piece by piece: each column and beam the crane's while it
    // carries it, then in place until the facade closes over it.
    const covered = (y: number) => y <= reveal + 1e-6 || reveal >= top - 1e-6;
    const fh = this.floorHeight;
    this.frame.forEach((floor, k) => {
      floor.columns.forEach((lands, i) => {
        const index = k * 4 + i;
        const lift = this.liftOf('column', k, i);
        if (lift && this.carrying(lift, t)) {
          this.cache.delete(`col${index}`);
          return;
        }
        const footing = this.floorBase(k);
        const state = t < lands ? 'none' : covered(footing + fh) ? 'covered' : 'placed';
        if (!this.changed(`col${index}`, state)) return;
        const c = this.corner(i);
        props.setColumnPiece(index, c.x, footing, c.z, fh, state === 'placed');
      });
      floor.beams.forEach((lands, j) => {
        const slot = BEAM_SLOTS[j]!;
        const lift = this.liftOf('beam', k, j);
        if (lift && this.carrying(lift, t)) {
          this.cache.delete(`beam${k}:${slot}`);
          return;
        }
        const y = this.ringY(k);
        const state = t < lands ? 'none' : covered(y + BEAM_SIZE / 2) ? 'covered' : 'placed';
        if (!this.changed(`beam${k}:${slot}`, state)) return;
        const center = this.beamCenter(slot, y);
        props.setBeam(k, slot, center.x, center.y, center.z, state === 'placed');
      });
      // The deck goes down in two sheets once its bundle lands, then the concrete is poured.
      const middle = (floor.deck + floor.laid) / 2;
      const sheets = [plan.progress({ start: floor.deck + 0.5, end: middle }, t), plan.progress({ start: middle, end: floor.laid }, t)];
      sheets.forEach((share, sheet) => {
        if (this.changed(`deck${k}:${sheet}`, String(q(share)))) props.setDeckSheet(k, sheet, this.ringY(k) - DECK_THICKNESS, easeOutCubic(share));
      });
      const poured = floor.pour ? plan.progress(floor.pour, t) : 0;
      if (this.changed(`concrete${k}`, String(q(poured)))) props.setConcrete(k, this.ringY(k), poured);
    });

    // The deck bundle on the hook, then on the beams until its sheets are down.
    const deckIndex = lastAtOrBefore(this.frame, t, (f) => f.deck - this.schedule.lift);
    const deckFloor = deckIndex >= 0 ? this.frame[deckIndex]! : null;
    const deckLift = deckFloor ? this.liftOf('deck', deckIndex, 0) : undefined;
    if (deckLift && this.carrying(deckLift, t)) {
      this.cache.delete('deckBundle');
    } else {
      const showing = deckFloor !== null && t >= deckFloor.deck && t < deckFloor.laid;
      if (this.changed('deckBundle', showing ? `${deckIndex}` : 'none')) props.setBundle(DECK_BUNDLE, showing && deckLift ? deckLift.to.clone().setY(deckLift.to.y - BUNDLE_TOP) : null, 'formwork');
    }

    // Bundles the crane brings between pieces stay where they are set down for a while.
    const slots: Array<'crane' | { at: THREE.Vector3; kind: BundleKind } | null> = Array.from({ length: FILLER_BUNDLES }, () => null);
    for (let i = lastAtOrBefore(this.lifts, t - BUNDLE_STAYS - this.schedule.lift, (l) => l.start) + 1; i < this.lifts.length; i++) {
      const lift = this.lifts[i]!;
      if (lift.start > t) break;
      if (lift.plan.kind !== 'bundle' && lift.plan.kind !== 'scaffold') continue;
      const slot = lift.plan.index % FILLER_BUNDLES;
      if (this.carrying(lift, t)) slots[slot] = 'crane';
      else if (t >= lift.plan.lands && lift.plan.kind === 'bundle' && t < lift.used && slots[slot] !== 'crane') {
        slots[slot] = { at: lift.to.clone().setY(lift.to.y - BUNDLE_TOP), kind: (['rebar', 'formwork', 'scaffold'] as const)[lift.plan.index % 3]! };
      }
    }
    slots.forEach((slot, i) => {
      if (slot === 'crane') {
        this.cache.delete(`bundle${i}`);
        return;
      }
      if (!this.changed(`bundle${i}`, slot ? `${q(slot.at.x)}:${q(slot.at.y)}:${slot.kind}` : 'none')) return;
      props.setBundle(i, slot ? slot.at : null, slot?.kind);
    });

    // The scaffold climbs with the frame and comes down during the strike.
    const scaffoldTop = this.scaffoldTop(t);
    if (this.changed('scaffold', String(q(scaffoldTop)))) {
      if (scaffoldTop > baseY + 1e-3) scaffold.revealTo(scaffoldTop);
      else scaffold.hide();
    }

    // Panels: the crane's while it carries them, then in front of their band
    // until the facade has closed over them. Eight are pooled, which covers
    // a band closing and the next arriving.
    const bandHeight = height / this.levels;
    const panels: Array<'crane' | { center: THREE.Vector3; turn: number; left: number } | null> = Array.from({ length: PANEL_SLOTS }, () => null);
    this.bands.forEach((band, b) => {
      if (t < band.panels[0]! - this.schedule.lift || t > band.closes.end + 1) return;
      const bottom = baseY + b * bandHeight;
      const left = clamp01((bottom + bandHeight - Math.max(reveal, bottom)) / bandHeight);
      band.panels.forEach((lands, i) => {
        const slot = (b * PANELS_PER_BAND + i) % PANEL_SLOTS;
        const lift = this.liftOf('panel', b, i);
        if (lift && this.carrying(lift, t)) panels[slot] = 'crane';
        else if (t >= lands && left > 0 && panels[slot] !== 'crane') panels[slot] = { ...this.panelPlace(b, i), left };
      });
    });
    panels.forEach((slot, i) => {
      if (slot === 'crane') {
        this.cache.delete(`panel${i}`);
        return;
      }
      if (!this.changed(`panel${i}`, slot ? `${q(slot.center.x)}:${q(slot.center.y)}:${q(slot.center.z)}:${q(slot.left)}` : 'none')) return;
      if (slot) props.setPanel(i, slot.center.x, slot.center.y, slot.center.z, bandHeight, slot.left, PANEL_WIDTH, slot.turn);
      else props.hidePanel(i);
    });

    // The roof cap: the crane's while it carries it; once on, the tower draws it.
    const capLift = this.liftOf('roof', -1, 0);
    if (!capLift || !this.carrying(capLift, t)) {
      if (this.changed('roof', String(this.roofOn(t)))) props.setRoof(null);
    } else {
      this.cache.delete('roof');
    }

    // The pump line goes up to a stacked block's floor, then to each deck, while it is poured.
    const pours: Array<{ y: number; span: plan.Span }> = this.schedule.pours.map((p) => ({ y: this.ringY(p.floor), span: p.span }));
    if (!first) pours.unshift({ y: baseY, span: { start: plan.at(phases.deck!, 0.14), end: plan.at(phases.deck!, 0.8) } });
    const pour = pours.find((p) => t >= p.span.start - 4 && t < p.span.end + 3);
    const rise = pour ? plan.progress({ start: pour.span.start - 4, end: pour.span.start }, t) * (1 - plan.progress({ start: pour.span.end, end: pour.span.end + 3 }, t)) : 0;
    if (this.changed('pump', pour ? `${q(pour.y)}:${q(rise)}` : 'none')) props.setPump(SITE_Y, pour ? pour.y : baseY, easeInOutCubic(rise));

    // What the yard holds.
    for (const kind of ['column', 'beam', 'deck', 'panel'] as const) stockyard.setCount(kind, plan.stock(this.schedule, kind, t));
  }

  /** The lift that carries a piece, if any. */
  private liftOf(kind: plan.PieceKind, floor: number, index: number): Lift | undefined {
    const key = `${kind}:${floor}:${index}`;
    if (!this.liftIndex) {
      this.liftIndex = new Map();
      for (const lift of this.lifts) this.liftIndex.set(`${lift.plan.kind}:${lift.plan.floor}:${lift.plan.index}`, lift);
    }
    return this.liftIndex.get(key);
  }

  private liftIndex: Map<string, Lift> | null = null;
}

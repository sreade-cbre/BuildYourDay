import * as THREE from 'three';
import { BLOCK_FOOTPRINT, UNITS_PER_MINUTE } from '../core/layout';
import type { Block } from '../core/model';
import { rngFromString } from '../core/rng';
import { HOOK_HANG, type CranePose } from '../scene/crew/Crane';
import { CRANE_PARK, HOMES, SITE_Y, STACK, WORKER_GATE, WORK_SPOTS, type Spot as Home } from '../scene/crew/Crew';
import { ARM_REST, type ArmPose } from '../scene/crew/Excavator';
import type { LiveKit } from '../scene/crew/LiveKit';
import { BEAM_SIZE, DECK_THICKNESS } from '../scene/crew/props';
import type { ScaffoldFace } from '../scene/crew/Scaffold';
import type { Worker } from '../scene/crew/Worker';
import type { WorkerAnim } from '../scene/crew/workerAnims';
import { PAD_OFFSET, PLOT_TOP_Y } from '../scene/Foundation';
import { easeInOutCubic, easeOutBack, easeOutBounce, easeOutCubic, type Ease } from './easing';
import { Path, angleBetween, type Point2 } from './path';
import { crewSize } from './jobs/schedule';
import { hasBlocksAbove, type JobScene } from './jobs/scene';
import * as plan from './sitePlan';

// A block built in real time, the way a construction site would build it,
// over the block's whole time (see sitePlan.ts for the programme). Everything
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
const WAIT_SPOTS: Point2[] = [{ x: -1.7, z: 4.25 }, { x: -0.6, z: 4.35 }, { x: 0.5, z: 4.25 }];
/** On a deck, by the edge whose beams each worker bolts. */
const DECK_SPOTS = [
  { x: -1.25, z: 1.35, heading: 0 },
  { x: 1.35, z: 0.85, heading: Math.PI / 2 },
  { x: -1.35, z: -1.0, heading: -Math.PI / 2 },
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
];
/** Screed lanes across a slab or floor. */
const SCREED_X = [-1.0, 1.0, 0];
/** The banksman watches the depot stack while the crane picks from it. */
const BANKSMAN = { x: 6.55, z: -1.15 };
/** A labourer carries from the stack to the bay in front of the tower. */
const STACK_PICK = { x: 6.9, z: -1.5 };
const BAY = { x: 1.9, z: 3.2 };
const SCAFFOLD_SPOTS: ReadonlyArray<readonly [ScaffoldFace, number]> = [['front', -0.45], ['left', 0.35], ['front', 0.55]];
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
   * the ring road, until `until`; ends back at the first place.
   */
  carry(until: number, pick: Point2, drop: Point2): void {
    const start = Math.max(this.free, 0);
    const path = new Path(ringRoute(pick, drop));
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

/** Something the crane carries. */
interface Cargo {
  pick(): void;
  carry(at: THREE.Vector3): void;
  land(from: THREE.Vector3, u: number): void;
}

interface Lift {
  start: number;
  length: number;
  to: THREE.Vector3;
  cargo: Cargo;
  landing: Ease;
}

interface Puff {
  t: number;
  /** Where it rises; a function for one that follows a machine. */
  at: THREE.Vector3 | (() => THREE.Vector3 | null);
  count: number;
  spread: number;
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
  private readonly lifts: Lift[] = [];
  private readonly puffs: Puff[] = [];
  private readonly cage: Track;
  private readonly rng: () => number;
  private readonly stand: Place;
  private readonly tripod: Point2;
  private tripodUp = Infinity;
  private tripodDown = Infinity;
  private readonly stakeTimes: Array<{ from: number; to: number }> = [];
  private readonly frame: Array<plan.Span & { lands: number }>;
  private readonly bands: Array<plan.Span & { lands: number; closes: plan.Span }>;
  private readonly roofLands: number;
  private hoistUp: plan.Span | null = null;
  private hoistDown: plan.Span | null = null;
  private dozerPasses: Array<{ t0: number; t1: number; from: number; to: number; extra: number }> = [];
  private digSpan: plan.Span | null = null;
  private readonly cache = new Map<string, string>();
  private readonly v = new THREE.Vector3();
  private readonly stackPoint = new THREE.Vector3(STACK.x, STACK.top + 0.08, STACK.z);

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

    const { props, scaffold, hoist } = kit;
    kit.park();
    props.setup(scene.token(block), this.baseY, this.height);
    props.setRingCount(this.floors);
    props.setDeckCount(this.floors);
    for (let ring = 0; ring < this.floors; ring++) props.hideRing(ring);
    scaffold.layout(this.baseY, this.height, this.floors);
    this.cage = new Track(() => hoist.setCage(SITE_Y));

    if (options.calm) {
      this.planStructureOnly();
    } else {
      this.planCrew();
      this.planMachines();
      this.planLifts();
    }
  }

  // Planning

  /** Reduced motion: lifts land in place on time with nothing to carry them. */
  private planStructureOnly(): void {
    const { phases } = this;
    if (!this.first) {
      this.hoistUp = null;
      this.hoistDown = null;
    }
    this.tripodUp = Infinity;
    if (this.first) {
      const setOut = phases.setOut;
      CORNERS.forEach((_, k) => {
        const at = plan.at(setOut, 0.45 + 0.13 * k);
        this.stakeTimes.push({ from: at, to: at });
      });
      this.planDozer(true);
      this.digSpan = { start: phases.excavate!.start, end: phases.excavate!.end };
    }
  }

  private get crewmenByRole(): { foreman: Crewman; up: Crewman[]; ground: Crewman[]; solo: boolean } {
    const all = this.crewmen;
    const solo = all.length === 1;
    return { foreman: all[0]!, up: solo ? [all[0]!] : all.slice(1, 4), ground: solo ? [] : all.slice(4), solo };
  }

  private planCrew(): void {
    const pace = this.options.pace;
    const count = crewSize(this.block.end - this.block.start);
    for (const worker of this.kit.workers.slice(0, count)) this.crewmen.push(new Crewman(worker, pace));
    const { foreman, up, ground, solo } = this.crewmenByRole;
    const { phases, first } = this;
    const strike = phases.strike;

    // The foreman sets up the tripod, sets out the footprint, and watches
    // over the job until the strike, then packs up and goes.
    foreman.enter(phases.setOut.start, [WORKER_GATE, { x: this.stand.x, z: WORKER_GATE.z }, this.stand], SITE_Y, { face: this.stand.heading });
    this.tripodUp = foreman.free + 0.4;
    const pack = plan.at(strike, 0.8);
    this.tripodDown = pack + 0.8;
    if (solo) {
      foreman.work(plan.at(phases.setOut, 0.45), 'survey');
    } else {
      foreman.work(pack, 'survey');
      foreman.work(pack + 1, 'idle');
      foreman.leave(pack + 1, plan.at(strike, 0.96));
    }

    if (first) this.planGroundworks(up, solo);
    else this.planMobilize(up, solo);
    this.planFrame(up, ground);
    this.planEnvelope(up);
    this.planStrike(up);
  }

  /** Setting out, clearing, digging, and the slab: the day's first block. */
  private planGroundworks(up: Crewman[], solo: boolean): void {
    const { phases } = this;
    const setOut = phases.setOut;
    const clear = phases.clear!;
    const foundation = phases.foundation!;

    // A stake at each corner, from the front right round to the back right.
    const staker = up[0]!;
    const window = { start: plan.at(setOut, solo ? 0.47 : 0.35), end: plan.at(setOut, 0.97) };
    if (solo) staker.walk(window.start, ringRoute(this.stand, { x: 2.5, z: 2.5 }).slice(1));
    else staker.enter(window.start, [WORKER_GATE, { x: 2.5, z: WORKER_GATE.z }], SITE_Y);
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

    // The rest of the crew arrives as clearing starts and stands back; one
    // of them signals the machines.
    up.forEach((man, j) => {
      const spot = WAIT_SPOTS[j]!;
      if (j === 0) man.walk(clear.start, ringRoute(man.place!, spot).slice(1), { face: Math.PI, by: plan.at(clear, 0.2) });
      else man.enter(clear.start + 0.4 * j, [WORKER_GATE, spot], SITE_Y, { face: Math.PI });
      man.work(foundation.start, j === 0 ? 'survey' : 'idle', { offset: j * 0.7 });
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
  private planMobilize(up: Crewman[], solo: boolean): void {
    const { phases, baseY } = this;
    const setOut = phases.setOut;
    const mobilize = phases.mobilize!;
    const deck = phases.deck!;
    this.hoistUp = { start: plan.at(setOut, 0.15), end: plan.at(setOut, 0.15) + Math.min(6 / this.options.pace, 0.3 * (setOut.end - setOut.start)) };

    // The crew carries planks to the hoist.
    up.forEach((man, j) => {
      const rider = this.kit.hoist.riderSpot(j);
      const route = ringRoute(solo ? man.place! : WORKER_GATE, { x: -RING, z: rider.z }).concat([rider]);
      if (solo) man.walk(plan.at(setOut, 0.47), route.slice(1), { anim: 'carry', face: Math.PI / 2 });
      else man.enter(plan.at(setOut, 0.45) + 0.5 * j, route, SITE_Y, { anim: 'carry', face: Math.PI / 2 });
      man.work(plan.at(mobilize, 0.12), 'idle');
    });
    // Up together to the roof below, then out to fix the guard rail.
    const ride = this.rideHoist(up, plan.at(mobilize, 0.12), baseY, plan.at(mobilize, 0.4));
    up.forEach((man, j) => {
      const spot = RAIL_SPOTS[j]!;
      const rider = this.kit.hoist.riderSpot(j);
      man.walk(ride, [{ x: -1.7, z: rider.z }, spot], { face: spot.heading, by: plan.at(mobilize, 0.45) });
      man.work(deck.start, 'hammer', { offset: j * 0.3 });
      // They stand by while the floor is poured, then screed it.
      man.work(plan.at(deck, 0.62), 'idle');
      man.walk(plan.at(deck, 0.62), [{ x: SCREED_X[j]!, z: 1.6 }], { y: baseY + 0.05, face: 0, by: plan.at(deck, 0.66) });
      man.screed(plan.at(deck, 0.97), SCREED_X[j]!, baseY + 0.05);
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

  /** The height the crew stands at while building a floor: the slab or floor, then each deck. */
  private standY(floor: number): number {
    if (floor === 0) return this.first && this.baseY <= 0.5 ? 0 : this.baseY + 0.05;
    return this.ringY(floor - 1);
  }

  private ringY(ring: number): number {
    return this.baseY + (ring + 1) * this.floorHeight;
  }

  /** The frame, floor by floor, with a ground crew at the depot. */
  private planFrame(up: Crewman[], ground: Crewman[]): void {
    const { phases, frame, first, baseY } = this;
    const floating = first && baseY > 0.5;
    if (floating) {
      // Nothing stands under it, so the hoist goes up for the climb.
      this.hoistUp = { start: phases.frame.start, end: phases.frame.start + Math.min(6, 0.04 * (phases.frame.end - phases.frame.start)) };
      up.forEach((man, j) => {
        // Off the slab at its front edge, then round to the hoist.
        const edge = { x: man.place!.x, z: 2.25 };
        man.walk(phases.frame.start, [edge], { by: plan.at(phases.frame, 0.008) });
        man.climb(plan.at(phases.frame, 0.008), SITE_Y, plan.at(phases.frame, 0.012));
        const rider = this.kit.hoist.riderSpot(j);
        man.walk(plan.at(phases.frame, 0.012), ringRoute(edge, { x: -RING, z: rider.z }).slice(1), { by: plan.at(phases.frame, 0.04) });
      });
      this.rideHoist(up, plan.at(phases.frame, 0.04), this.standY(0), plan.at(phases.frame, 0.08));
    }
    up.forEach((man, j) => {
      const spot = DECK_SPOTS[j]!;
      const from = man.place!;
      const route = floating ? [{ x: -1.7, z: from.z }, spot] : [spot];
      man.walk(phases.frame.start, route, { y: this.standY(0), face: spot.heading, by: frame[0]!.lands });
    });
    const { framers, cladder } = this.trades(up);
    frame.forEach((step, k) => {
      const climb = this.floorHeight / (plan.CLIMB_SPEED * this.options.pace);
      framers.forEach((man, j) => {
        const last = k === frame.length - 1;
        man.work(last ? step.end : step.end - climb, 'hammer', { offset: j * 0.21 });
        if (!last) man.climb(step.end - climb, this.standY(k + 1), step.end);
      });
    });
    // The cladder fixes the first floor until the facade can start.
    cladder?.work(this.bands[0]!.start - this.shiftSeconds(), 'hammer', { offset: 0.42 });

    // The ground crew arrives with the frame: a banksman for the crane's
    // picks and a labourer carrying to the bay, until the strike.
    const leaveAt = plan.at(phases.strike, 0.25);
    ground.forEach((man, j) => {
      if (j === 0) {
        man.enter(phases.frame.start + 1, [WORKER_GATE, { x: 6.3, z: 1.0 }, BANKSMAN], SITE_Y, { face: Math.atan2(STACK.x - BANKSMAN.x, STACK.z - BANKSMAN.z) });
        man.watch(leaveAt, (t) => (this.picking(t) ? 'survey' : 'idle'));
      } else {
        man.enter(phases.frame.start + 2, [WORKER_GATE, { x: 6.4, z: 1.0 }, STACK_PICK], SITE_Y);
        man.carry(leaveAt, STACK_PICK, BAY);
      }
      man.leave(leaveAt, plan.at(phases.strike, 0.5));
    });
  }

  /** True while the crane is down at the stack picking up a load. */
  private picking(t: number): boolean {
    return this.lifts.some((lift) => {
      const u = (t - lift.start) / lift.length;
      return u > 0.15 && u < 0.6;
    });
  }

  /** Where a scaffold crew member stands at a level. */
  private plank(j: number, level: number): Place {
    const [face, along] = SCAFFOLD_SPOTS[j]!;
    return this.kit.scaffold.standPoint(face, level, along);
  }

  /**
   * Who works which trade while the frame and the facade overlap: on a crew
   * of three or more the third clads, a few floors behind the other two.
   */
  private trades(up: Crewman[]): { framers: Crewman[]; cladder: Crewman | null } {
    return up.length >= 3 ? { framers: up.slice(0, 2), cladder: up[2]! } : { framers: up, cladder: null };
  }

  /** Seconds to allow a worker to move from a deck to the scaffold. */
  private shiftSeconds(): number {
    return Math.min(12 / this.options.pace, 0.02 * this.seconds);
  }

  /** From a deck to a scaffold level: to the face, climb, and out onto the plank. */
  private toPlank(man: Crewman, j: number, level: number, at: number, by: number): void {
    const plank = this.plank(j, level);
    const inside = SCAFFOLD_SPOTS[j]![0] === 'front' ? { x: plank.x, z: 1.75 } : { x: -1.75, z: plank.z };
    const third = (by - at) / 3;
    man.walk(at, [inside], { by: at + third });
    man.climb(at + third, plank.y, at + 2 * third);
    man.walk(at + 2 * third, [{ x: plank.x, z: plank.z }], { face: plank.heading, by });
  }

  /** The band of facade under way at `t`, or the last. */
  private bandAt(t: number): number {
    const index = this.bands.findIndex((band) => t < band.end);
    return index < 0 ? this.bands.length - 1 : index;
  }

  /**
   * Cladding, band by band from the bottom, the scaffold rising with the
   * frame, then the roof. The crew on the planks moves up a level as each
   * band closes; the framers join them once the frame is done.
   */
  private planEnvelope(up: Crewman[]): void {
    const { phases, levels, bands, top } = this;
    const { framers, cladder } = this.trades(up);
    const climb = (this.height / levels) / (plan.CLIMB_SPEED * this.options.pace);
    const clad = (man: Crewman, j: number, from: number) => {
      for (let b = from; b < bands.length; b++) {
        const band = bands[b]!;
        const last = b === bands.length - 1;
        man.work(last ? band.end : band.end - climb, 'hammer', { offset: j * 0.21 });
        if (!last) man.climb(band.end - climb, this.plank(j, b + 1).y, band.end);
      }
    };
    if (cladder) {
      const start = bands[0]!.start;
      this.toPlank(cladder, 2, 0, start - this.shiftSeconds(), start);
      clad(cladder, 2, 0);
    }
    const join = phases.frame.end;
    const from = this.bandAt(join + this.shiftSeconds());
    framers.forEach((man, j) => {
      this.toPlank(man, j, from, join, join + this.shiftSeconds());
      clad(man, j, from);
    });
    bands.forEach((band, b) => {
      this.puffs.push({ t: band.closes.end, at: new THREE.Vector3((this.rng() - 0.5) * 2, this.baseY + ((b + 1) * this.height) / levels, 2.25), count: 24, spread: 0.5 });
    });

    // Two go up onto the roof to fix the cap the crane brings; anyone else
    // keeps on at the top of the scaffold.
    const roof = phases.roof;
    up.forEach((man, j) => {
      if (j >= ROOF_SPOTS.length) {
        man.work(roof.end, 'hammer', { offset: j * 0.21 });
        return;
      }
      const spot = ROOF_SPOTS[j]!;
      man.climb(roof.start, top, plan.at(roof, 0.12));
      man.walk(plan.at(roof, 0.12), [spot], { face: spot.heading, by: plan.at(roof, 0.22) });
      man.work(this.roofLands, 'idle');
      man.work(roof.end, 'hammer', { offset: j * 0.3 });
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
        man.walk(strike.start, [{ x: plank.x, z: plank.z }], { by: plan.at(strike, 0.03) });
        man.climb(plan.at(strike, 0.03), plank.y, plan.at(strike, 0.05));
      }
    });
    for (let level = levels - 1; level >= 1; level--) {
      const gone = plan.at(fall, 1 - level / levels);
      up.forEach((man, j) => {
        man.work(gone, 'idle');
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
        const [face] = SCAFFOLD_SPOTS[j]!;
        const corner = face === 'front' ? [{ x: PLANK_X, z: 2.18 }] : [];
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

  private planMachines(): void {
    const { crew } = this.scene;
    const pace = this.options.pace;
    const { phases } = this;
    const mixer = new Rig((s) => crew.mixer.drive(s, SITE_Y), HOMES.mixer, () => crew.mixer.setDrum(0), pace);
    this.rigs.push(mixer);
    const drum = (t: number) => crew.mixer.setDrum(((t * pace) / 1.5) * TAU);
    if (this.first) {
      this.planDozer(false);
      this.planDig();
      const foundation = phases.foundation!;
      mixer.drive(plan.at(foundation, 0.42), [WORK_SPOTS.mixer], { reverse: true, parts: drum });
      mixer.idle(plan.at(foundation, 0.86), drum);
      mixer.drive(plan.at(foundation, 0.86), [HOMES.mixer], { parts: drum });
    } else {
      const deck = phases.deck!;
      mixer.drive(plan.at(deck, 0.02), [WORK_SPOTS.mixer], { reverse: true, parts: drum });
      mixer.idle(plan.at(deck, 0.84), drum);
      mixer.drive(plan.at(deck, 0.84), [HOMES.mixer], { parts: drum });
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

  /** The crane's lifts: each floor's beams, each band of panels, and the roof cap. */
  private planLifts(): void {
    const { props } = this.kit;
    const length = plan.LIFT_SECONDS / this.options.pace;
    this.frame.forEach((step, ring) => {
      const to = new THREE.Vector3(0, this.ringY(ring), 0);
      this.lifts.push({
        start: step.lands - length,
        length,
        to,
        landing: hasBlocksAbove(this.scene, this.block, this.block.id) ? easeOutCubic : easeOutBounce,
        cargo: {
          pick: () => {},
          carry: (p) => props.setRing(ring, p.x, p.y, p.z),
          land: (from, u) => props.setRing(ring, from.x * (1 - u), from.y + (to.y - from.y) * u, from.z * (1 - u)),
        },
      });
    });
    const bandHeight = this.height / this.levels;
    this.bands.forEach((band, b) => {
      const bottom = this.baseY + b * bandHeight;
      const to = new THREE.Vector3(0, bottom + bandHeight / 2, PANEL_Z);
      this.lifts.push({
        start: band.lands - length,
        length,
        to,
        landing: easeOutCubic,
        cargo: {
          pick: () => {},
          carry: (p) => props.setPanel(b, p.x, p.y - bandHeight / 2, p.z, bandHeight, 1),
          land: (from, u) => {
            const y = from.y - bandHeight / 2;
            props.setPanel(b, from.x + (to.x - from.x) * u, y + (to.y - y) * u, from.z + (to.z - from.z) * u, bandHeight, 1);
          },
        },
      });
    });
    const roofTo = new THREE.Vector3(0, this.top + 0.002, 0);
    this.lifts.push({
      start: this.roofLands - length,
      length,
      to: roofTo,
      landing: easeOutBack,
      cargo: {
        pick: () => {},
        carry: (p) => props.setRoof(p),
        land: (from, u) => props.setRoof(from.clone().lerp(roofTo, u)),
      },
    });
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

  /** Whether the crane holds a load at `t`, so the load is the crane's to place. */
  private carrying(lift: Lift, t: number): boolean {
    const u = (t - lift.start) / lift.length;
    return !this.options.calm && u >= 0.45 && u < 1;
  }

  /**
   * Shows the site as it stands `t` seconds into the block. `parts` says
   * whether the crane and machines are the site's to move; `fresh` is the
   * previous moment shown, when dust that rose in between should puff.
   */
  apply(t: number, parts: SiteParts, previous: number | null): void {
    for (const man of this.crewmen) man.track.apply(t);
    if (parts.machines) for (const rig of this.rigs) rig.track.apply(t);
    if (parts.crane && !this.options.calm) this.applyCrane(t);
    this.applyStructure(t);
    if (previous !== null && t > previous && t - previous < 1.5) {
      for (const puff of this.puffs) {
        if (puff.t <= previous || puff.t > t) continue;
        const point = typeof puff.at === 'function' ? (parts.machines ? puff.at() : null) : puff.at;
        if (point) this.kit.dust.puff(point, this.rng, puff.count, puff.spread);
      }
    }
  }

  private applyCrane(t: number): void {
    const { crane } = this.scene.crew;
    const parked: CranePose = { ...CRANE_PARK, hookY: crane.hookCeiling };
    const travelY = Math.min(crane.pivotY - 0.45, Math.max(this.top + 0.9, STACK.top + 1.2) + HOOK_HANG);
    let lift: Lift | null = null;
    for (const candidate of this.lifts) if (candidate.start <= t && (!lift || candidate.start > lift.start)) lift = candidate;
    if (!lift || t >= lift.start + lift.length + plan.CRANE_RETURN_SECONDS / this.options.pace) {
      crane.setPose(parked);
      return;
    }
    const from = this.stackPoint;
    const to = lift.to;
    const pick = crane.aim(from.x, from.z);
    const drop = crane.aim(to.x, to.z);
    const pickHook = from.y + HOOK_HANG;
    const releaseHook = to.y + DROP + HOOK_HANG;
    const overPick = { ...pick, hookY: travelY };
    const atPick = { ...pick, hookY: pickHook };
    const overDrop = { ...drop, hookY: travelY };
    const atRelease = { ...drop, hookY: releaseHook };
    const u = (t - lift.start) / lift.length;
    const e = easeInOutCubic;
    if (u >= 1) {
      const back = (t - lift.start - lift.length) / (plan.CRANE_RETURN_SECONDS / this.options.pace);
      crane.setPose(blendPose(atRelease, parked, e(clamp01(back))));
      return;
    }
    if (u < 0.3) crane.setPose(blendPose(parked, overPick, e(u / 0.3)));
    else if (u < 0.45) crane.setPose(blendPose(overPick, atPick, e((u - 0.3) / 0.15)));
    else if (u < 0.8) {
      const s = e((u - 0.45) / 0.35);
      const p = blendPose(atPick, overDrop, Math.max(0, (s - 0.2) / 0.8));
      p.hookY = pickHook + (travelY - pickHook) * easeOutCubic(Math.min(1, s * 2.5));
      crane.setPose(p);
      lift.cargo.carry(crane.hookPoint(this.v));
    } else if (u < 0.9) {
      crane.setPose(blendPose(overDrop, atRelease, e((u - 0.8) / 0.1)));
      lift.cargo.carry(crane.hookPoint(this.v));
    } else {
      crane.setPose(atRelease);
      const release = crane.hookPoint(this.v).clone();
      lift.cargo.land(release, lift.landing((u - 0.9) / 0.1));
    }
  }

  /** Sets a piece only when its state changed since it was last set. */
  private changed(key: string, state: string): boolean {
    if (this.cache.get(key) === state) return false;
    this.cache.set(key, state);
    return true;
  }

  private applyStructure(t: number): void {
    const { props, scaffold, hoist, rail } = this.kit;
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
      const pumpUp = plan.progress({ start: plan.at(deck, 0.1), end: plan.at(deck, 0.1) + 4 }, t);
      const pumpDown = plan.progress({ start: plan.at(deck, 0.8), end: plan.at(deck, 0.8) + 3 }, t);
      const pump = pumpUp * (1 - pumpDown);
      if (this.changed('pump', String(q(pump)))) props.setPump(SITE_Y, baseY, easeInOutCubic(pump));
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

    // The frame: columns rise floor by floor and the facade retires them.
    let columnTop = baseY;
    this.frame.forEach((step, k) => {
      if (t >= step.start) {
        const rise = plan.progress({ start: plan.at(step, 0.04), end: plan.at(step, 0.4) }, t);
        columnTop = baseY + (k + rise) * this.floorHeight;
      }
    });
    if (t >= phases.frame.end) columnTop = top;
    if (this.changed('columns', `${q(columnTop)}:${q(reveal)}`)) props.setColumns(Math.min(reveal, columnTop), columnTop);

    // Each ring of beams: the crane's while it carries it, then in place
    // until the facade covers it. Each deck follows its ring.
    this.frame.forEach((step, ring) => {
      const liftOf = this.lifts[ring];
      const landed = t >= step.lands;
      const y = this.ringY(ring);
      if (liftOf && this.carrying(liftOf, t)) {
        // The crane places it; if a job has the crane, it waits where it is.
        this.cache.delete(`ring${ring}`);
      } else {
        // The facade covers each ring as it closes past it, and the top one once it is whole.
        const covered = y + BEAM_SIZE / 2 <= reveal || reveal >= top - 1e-6;
        const state = !landed ? 'none' : covered ? 'covered' : 'placed';
        if (this.changed(`ring${ring}`, state)) {
          if (state === 'placed') props.setRing(ring, 0, y, 0);
          else props.hideRing(ring);
        }
      }
      // Decks lie flush with each floor level; the top floor's is the roof.
      const length = step.end - step.start;
      const roofLevel = ring === this.floors - 1;
      const laid = landed && !roofLevel ? easeOutCubic(plan.progress({ start: step.lands + 0.5, end: step.lands + Math.min(8, 0.2 * length) }, t)) : 0;
      if (this.changed(`deck${ring}`, String(q(laid)))) props.setDeck(ring, y - DECK_THICKNESS, laid);
    });

    // The scaffold climbs with the frame and comes down during the strike.
    const scaffoldRise = t < phases.frame.start ? 0 : Math.min(1, (columnTop - baseY + 0.05) / (height + 0.05));
    const scaffoldFall = plan.progress({ start: plan.at(phases.strike, 0.05), end: plan.at(phases.strike, 0.7) }, t);
    const scaffoldShare = scaffoldRise * (1 - scaffoldFall);
    if (this.changed('scaffold', String(q(scaffoldShare)))) {
      if (scaffoldShare > 0) scaffold.revealTo(baseY + (height + 0.05) * scaffoldShare);
      else scaffold.hide();
    }

    // Panels: the crane's while it carries them, then in front of their band
    // until the facade has closed over them.
    // Three panels are pooled, so each slot shows whichever band uses it now.
    const bandHeight = height / this.levels;
    const slots: Array<'crane' | { bottom: number; left: number } | null> = [null, null, null];
    this.bands.forEach((band, b) => {
      const liftOf = this.lifts[this.frame.length + b];
      if (liftOf && this.carrying(liftOf, t)) {
        slots[b % 3] = 'crane';
        return;
      }
      const bottom = baseY + b * bandHeight;
      const panelTop = bottom + bandHeight;
      if (t < band.lands || reveal >= panelTop - 1e-4) return;
      const left = clamp01((panelTop - Math.max(reveal, bottom)) / bandHeight);
      if (left > 0 && slots[b % 3] !== 'crane') slots[b % 3] = { bottom, left };
    });
    slots.forEach((slot, i) => {
      if (slot === 'crane') {
        this.cache.delete(`panel${i}`);
        return;
      }
      if (!this.changed(`panel${i}`, slot ? `${q(slot.bottom)}:${q(slot.left)}` : 'none')) return;
      if (slot) props.setPanel(i, 0, slot.bottom + bandHeight / 2, PANEL_Z, bandHeight, slot.left);
      else props.hidePanel(i);
    });

    // The roof cap: the crane's while it carries it; once on, the tower draws it.
    const capLift = this.lifts.at(-1);
    if (!capLift || !this.carrying(capLift, t)) {
      const on = this.roofOn(t);
      if (this.changed('roof', String(on))) props.setRoof(null);
    } else {
      this.cache.delete('roof');
    }
  }

}

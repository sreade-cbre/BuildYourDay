import * as THREE from 'three';
import { BLOCK_FOOTPRINT, UNITS_PER_MINUTE, minutesToY, spanHeight } from '../../core/layout';
import type { Block, Settings, SwatchToken } from '../../core/model';
import { rngFromString } from '../../core/rng';
import type { CranePose } from '../../scene/crew/Crane';
import { HOOK_HANG } from '../../scene/crew/Crane';
import {
  BACK_LANE_Z,
  CRANE_PARK,
  HOMES,
  SITE_Y,
  STACK,
  WORKER_GATE,
  WORK_SPOTS,
  type Crew,
} from '../../scene/crew/Crew';
import type { ArmPose } from '../../scene/crew/Excavator';
import { ARM_REST } from '../../scene/crew/Excavator';
import { BEAM_SIZE } from '../../scene/crew/props';
import type { ScaffoldFace } from '../../scene/crew/Scaffold';
import type { Worker } from '../../scene/crew/Worker';
import type { Ground } from '../../scene/Ground';
import type { Holds } from '../../scene/holds';
import { HELD_LABEL_OPACITY } from '../../scene/holds';
import type { Tower } from '../../scene/Tower';
import type { Job } from '../Director';
import { easeInOutCubic, easeOutBack, easeOutBounce, easeOutCubic, linear, type Ease } from '../easing';
import { Path, angleBetween, type Point2 } from '../path';
import { Timeline } from '../Timeline';
import { ROOF_LEAD, ROOF_LIFT, craneBatch, crewSize, panelLifts, phaseSchedule } from './schedule';

// The build job (spec 9.4): survey, site prep, foundation, frame, scaffold,
// cladding, roof and strike, cleanup, always in that order. Durations follow
// the phase table and scale with the square root of block height; phases
// overlap a little where it reads naturally (spec 9.5). Everything is driven
// by the timeline, so finishing early lands every piece in its final state.
//
// M3 builds the first block of a day. A block stacked on others appears
// through instantJob until stacked builds arrive in M4.

export interface JobScene {
  crew: Crew;
  tower: Tower;
  ground: Ground;
  holds: Holds;
  settings(): Readonly<Settings>;
  /** Whether another job is waiting; if so the crane stays out (spec 9.4 phase 7). */
  moreQueued(): boolean;
  /** Reframes the camera when a height is out of view (spec 9.5). */
  keepInFrame(topY: number): void;
  requestRender(): void;
}

/** Seconds per walk cycle while workers hurry around the time-lapse site. */
const WALK_CYCLE = 0.3;
/** How far a crane load drops from the hook at landing. */
const DROP = 0.25;
const deg = (d: number) => (d * Math.PI) / 180;
/** Panels hang 0.07 in front of the front face, inside the scaffold. */
const PANEL_Z = BLOCK_FOOTPRINT / 2 + 0.07;

interface Cargo {
  /** The load appears on the hook. */
  pick(): void;
  /** The load hangs at a world point under the hook. */
  carry(at: THREE.Vector3): void;
  /** The load drops from where the hook let go to its final place, t in [0, 1]. */
  land(from: THREE.Vector3, t: number): void;
}

/** Excavator arm through one dig cycle (spec 10.3), c in [0, 1). */
function digPose(c: number): ArmPose {
  const k = (from: number, to: number, a: number, b: number) =>
    c <= a ? from : c >= b ? to : from + (to - from) * easeInOutCubic((c - a) / (b - a));
  const boom = c < 0.4 ? k(deg(-30), deg(25), 0, 0.25) : k(deg(25), deg(-30), 0.25, 0.42);
  const stick = c < 0.5 ? k(deg(40), deg(95), 0, 0.25) : k(deg(95), deg(40), 0.75, 1);
  const bucket = c < 0.6 ? k(deg(30), deg(140), 0.25, 0.4) : k(deg(140), deg(30), 0.6, 0.75);
  // Swing 60 degrees away from the surveyor to dump, then back.
  const swing = c < 0.6 ? k(0, deg(-60), 0.42, 0.6) : k(deg(-60), 0, 0.75, 1);
  return { swing, boom, stick, bucket };
}

class Choreography {
  readonly tl = new Timeline();
  private readonly v = new THREE.Vector3();

  constructor(private readonly crew: Crew) {}

  step(at: number, duration: number, update: (t: number) => void, ease: Ease = easeInOutCubic): void {
    this.tl.add({ at, duration: Math.max(0, duration), update, ease });
  }

  /** Runs once at a time. */
  at(time: number, run: () => void): void {
    this.tl.add({ at: time, duration: 0, update: () => {}, onStart: run });
  }

  /** A worker walks a path at a steady pace, shown from the start. */
  walk(worker: Worker, points: Point2[], start: number, duration: number, options: { y?: number; face?: number; hide?: boolean } = {}): void {
    const path = new Path(points);
    const y = options.y ?? SITE_Y;
    this.step(
      start,
      duration,
      (t) => {
        worker.show();
        const p = path.atFraction(t, 0.25);
        const heading = options.face !== undefined && t >= 1 ? options.face : p.heading;
        worker.place(p.x, y, p.z, heading);
        worker.setAnimation(t >= 1 ? 'idle' : 'walk', (t * duration) / WALK_CYCLE);
        if (t >= 1 && options.hide) worker.hide();
      },
      linear,
    );
  }

  /** A worker holds a spot playing an animation. */
  hold(worker: Worker, anim: 'idle' | 'survey', start: number, duration: number, spot: { x: number; y: number; z: number; heading: number }): void {
    this.step(
      start,
      duration,
      (t) => {
        worker.show();
        worker.place(spot.x, spot.y, spot.z, spot.heading);
        worker.setAnimationAt(anim, t * duration);
      },
      linear,
    );
  }

  /** A machine drives a path; reverse gear keeps it facing the way it started. */
  drive(machine: { drive: Crew['excavator']['drive'] }, path: Path, start: number, duration: number, reverse = false, finalHeading?: number): void {
    this.step(start, duration, (t) => {
      const p = path.atFraction(t, 0.6);
      let heading = reverse ? p.heading + Math.PI : p.heading;
      if (finalHeading !== undefined && t > 0.85) heading += angleBetween(heading, finalHeading) * ((t - 0.85) / 0.15);
      machine.drive({ x: p.x, z: p.z, heading, distance: (reverse ? -1 : 1) * t * path.length }, SITE_Y);
    });
  }

  /**
   * One crane pick and place (spec 10.4): slew and trolley to the pickup
   * (0.3), lower and hook on (0.15), raise and swing over the target (0.35),
   * then lower and let go with the load's landing ease (0.2).
   */
  craneMove(from: THREE.Vector3, to: THREE.Vector3, start: number, duration: number, before: CranePose, travelY: number, cargo: Cargo, landing: Ease): CranePose {
    const crane = this.crew.crane;
    const pick = crane.aim(from.x, from.z);
    const drop = crane.aim(to.x, to.z);
    const pickHook = from.y + HOOK_HANG;
    const releaseHook = to.y + DROP + HOOK_HANG;
    const pose = (a: CranePose, b: CranePose, t: number): CranePose => ({
      slew: a.slew + angleBetween(a.slew, b.slew) * t,
      trolley: a.trolley + (b.trolley - a.trolley) * t,
      hookY: a.hookY + (b.hookY - a.hookY) * t,
    });
    const overPick: CranePose = { ...pick, hookY: travelY };
    const atPick: CranePose = { ...pick, hookY: pickHook };
    const overDrop: CranePose = { ...drop, hookY: travelY };
    const atRelease: CranePose = { ...drop, hookY: releaseHook };
    const release = new THREE.Vector3();
    const carryAtHook = () => {
      crane.hookWorld(this.v);
      cargo.carry(this.v);
    };

    this.step(start, duration * 0.3, (t) => crane.setPose(pose(before, overPick, t)));
    this.step(start + duration * 0.3, duration * 0.15, (t) => crane.setPose(pose(overPick, atPick, t)));
    this.at(start + duration * 0.45, () => cargo.pick());
    this.step(start + duration * 0.45, duration * 0.35, (t) => {
      // Lift straight up first, then swing across.
      const lift = Math.min(1, t * 2.5);
      const swing = Math.max(0, (t - 0.2) / 0.8);
      const p = pose(atPick, overDrop, swing);
      p.hookY = pickHook + (travelY - pickHook) * easeOutCubic(lift);
      crane.setPose(p);
      carryAtHook();
    });
    this.step(start + duration * 0.8, duration * 0.1, (t) => {
      crane.setPose(pose(overDrop, atRelease, t));
      carryAtHook();
      if (t >= 1) release.copy(this.v);
    });
    this.step(start + duration * 0.9, duration * 0.1, (t) => cargo.land(release, t), landing);
    return atRelease;
  }
}

/**
 * The animated build of a day's first block. Holds the block and the site
 * from the moment it is created, so the Tower shows neither until the job
 * hands them back.
 */
export function buildJob(scene: JobScene, block: Block, token: SwatchToken): Job {
  const { crew, holds } = scene;
  holds.hold(block.id);
  holds.site = true;
  let started = false;

  return {
    label: `Building ${block.title || 'Untitled'}`,
    start: () => {
      started = true;
      return createBuildTimeline(scene, block, token);
    },
    end: () => {
      if (started) crew.park();
      holds.release(block.id);
      holds.site = false;
      scene.tower.sync();
      scene.requestRender();
    },
  };
}

function createBuildTimeline(scene: JobScene, block: Block, token: SwatchToken): Timeline {
  const { crew, tower, ground } = scene;
  const { props, scaffold, crane, dust, bulldozer, excavator, mixer } = crew;
  const settings = scene.settings();
  const rng = rngFromString(block.id);
  const c = new Choreography(crew);

  const baseY = minutesToY(block.start, settings);
  const height = spanHeight(block.end - block.start);
  const top = baseY + height;
  const floors = Math.max(1, Math.round(height / (settings.slotMinutes * UNITS_PER_MINUTE)));
  const floorHeight = height / floors;
  const schedule = phaseSchedule(height, true);
  const { d, at, total } = schedule;
  const minutes = block.end - block.start;

  crew.park();
  props.setup(token, baseY, height);
  scaffold.layout(baseY, height, floors);
  scene.keepInFrame(top);

  const workers = crew.workers.slice(0, crewSize(minutes));
  const surveyor = workers[0]!;
  const builders = workers.length > 1 ? workers.slice(1) : [surveyor];
  const solo = workers.length === 1;

  // The mast grows, if it must, so the jib clears the new block (spec 10.4).
  const mastFrom = crane.pivotY;
  const mastTo = Math.max(mastFrom, top + 3);
  c.step(0, at.foundation, (t) => {
    crane.setMastTop(mastFrom + (mastTo - mastFrom) * t);
    crane.setPose({ ...CRANE_PARK, hookY: crane.hookCeiling });
  });
  const parked = (): CranePose => ({ ...CRANE_PARK, hookY: mastTo - 0.38 });
  const travelY = Math.min(mastTo - 0.45, Math.max(top + 0.9, STACK.top + 1.2) + HOOK_HANG);
  const stackPoint = new THREE.Vector3(STACK.x, STACK.top + 0.08, STACK.z);

  // Phase 0: survey. The surveyor walks in, sets the tripod at the front
  // corner, and the footprint outline draws itself.
  const jitter = (rng() - 0.5) * 0.1;
  const tripod = { x: 2.45 + jitter, z: 2.45 - jitter };
  const stand = { x: tripod.x + 0.33, z: tripod.z + 0.33, heading: Math.atan2(-1, -1) };
  c.walk(surveyor, [WORKER_GATE, { x: stand.x, z: WORKER_GATE.z }, stand], at.survey, 0.3, { face: stand.heading });
  c.step(at.survey + 0.25, 0.12, (t) => {
    props.tripod.visible = true;
    props.tripod.position.set(tripod.x, SITE_Y, tripod.z);
    props.tripod.scale.setScalar(Math.max(0.001, t));
  }, easeOutBack);
  c.step(at.survey + 0.2, 0.3, (t) => props.setOutline(t), linear);
  const surveyUntil = solo ? at.foundation : at.cleanup;
  c.hold(surveyor, 'survey', at.survey + 0.3, surveyUntil - (at.survey + 0.3), { ...stand, y: SITE_Y });

  // Phase 1: site prep. The bulldozer crosses the plot, blade down, and the
  // grass under its path goes as the plot fades to bare earth.
  const home = HOMES.bulldozer;
  const pass = new Path([home, { x: -3.9, z: home.z }]);
  const passEnd = at.prep + d.prep * 0.85;
  c.step(at.prep, d.prep * 0.85, (t) => {
    const p = pass.atFraction(t);
    bulldozer.drive({ x: p.x, z: p.z, heading: p.heading, distance: t * pass.length }, SITE_Y);
    // The clearing runs out past the plot edge by the end of the pass.
    ground.setClearFront(p.x - 0.85 - 1.3 * t);
  });
  c.step(at.prep, d.prep * 0.12, (t) => bulldozer.setBlade(t));
  c.step(at.prep + d.prep * 0.8, d.prep * 0.12, (t) => bulldozer.setBlade(1 - t));
  c.step(at.prep, d.prep, (t) => ground.setPrepFade(t), linear);
  for (const share of [0.3, 0.65]) {
    c.at(at.prep + d.prep * 0.85 * share, () => {
      const p = pass.atFraction(easeInOutCubic(share));
      dust.puff(new THREE.Vector3(p.x - 0.9, SITE_Y + 0.05, p.z), rng, 40, 0.9);
    });
  }
  // With the pass done, it heads home behind the tower, out of everyone's way.
  const back = new Path([{ x: -3.9, z: home.z }, { x: -3.9, z: BACK_LANE_Z }, { x: home.x, z: BACK_LANE_Z }, home]);
  c.drive(bulldozer, back, passEnd + 0.03, at.scaffold - passEnd, false, home.heading);

  // Phase 2: foundation. The excavator digs twice, footing pads pop in, the
  // mixer backs in with its drum turning, the slab rises, and two workers
  // screed it.
  const exIn = new Path([HOMES.excavator, WORK_SPOTS.excavator]);
  c.drive(excavator, exIn, at.foundation - 0.05, d.foundation * 0.3 + 0.05);
  const digStart = at.foundation + d.foundation * 0.3;
  const digLength = d.foundation * 0.5;
  c.step(digStart, digLength, (t) => excavator.setArm(t >= 1 ? ARM_REST : digPose((t * 2) % 1)), linear);
  const bucket = new THREE.Vector3();
  for (const cycle of [0, 1]) {
    for (const [share, count] of [[0.25, 30], [0.68, 44]] as const) {
      c.at(digStart + (digLength / 2) * (cycle + share), () => dust.puff(excavator.bucketWorld(bucket), rng, count, 0.6));
    }
  }
  const mixerIn = new Path([HOMES.mixer, WORK_SPOTS.mixer]);
  const mixerStart = at.foundation + d.foundation * 0.35;
  c.drive(mixer, mixerIn, mixerStart, d.foundation * 0.3, true);
  const drumUntil = at.cleanup + d.cleanup;
  c.step(mixerStart, drumUntil - mixerStart, (t) => mixer.setDrum(t >= 1 ? 0 : (t * (drumUntil - mixerStart) * Math.PI * 2) / 1.5), linear);
  const padScales = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    c.step(at.foundation + d.foundation * (0.5 + 0.04 * i), d.foundation * 0.16, (t) => {
      padScales[i] = t;
      props.setPads(padScales);
    }, easeOutBack);
  }
  c.step(at.foundation + d.foundation * 0.62, d.foundation * 0.3, (t) => props.setSlab(t), easeOutBack);
  c.at(at.foundation + d.foundation * 0.92, () => dust.puff(new THREE.Vector3(0, 0.02, 2.1), rng, 48, 0.8));

  const screedStart = at.foundation + d.foundation * 0.92;
  const screedEnd = at.frame + d.frame * 0.5;
  const screeders = builders.slice(0, 2);
  screeders.forEach((worker, j) => {
    const x = screeders.length === 1 ? 0 : j === 0 ? -1.0 : 1.0;
    const from = solo ? { x: stand.x, z: stand.z } : WORKER_GATE;
    const enter = solo ? at.foundation : at.prep + 0.1 * j;
    const arrive = at.foundation + d.foundation * 0.55;
    c.walk(worker, [from, { x: from.x, z: 3.25 }, { x, z: 3.25 }, { x, z: 2.5 }], enter, arrive - enter, { face: Math.PI });
    c.hold(worker, 'idle', arrive, screedStart - arrive, { x, y: SITE_Y, z: 2.5, heading: Math.PI });
    // Onto the slab, then backward along its length, pulling the board.
    c.step(screedStart, screedEnd - screedStart, (t) => {
      worker.show();
      const y = t < 0.06 ? SITE_Y + (0 - SITE_Y) * (t / 0.06) : 0;
      worker.place(x, y, 1.75 - 3.5 * t, 0);
      worker.setAnimationAt('screed', t * (screedEnd - screedStart));
      if (t >= 1) worker.hide();
    }, linear);
  });
  // Anyone else waits at the front until the scaffold is up.
  builders.slice(2).forEach((worker, j) => {
    const x = -2.2 + j * 0.8;
    const enter = at.prep + 0.2 + 0.1 * j;
    c.walk(worker, [WORKER_GATE, { x, z: WORKER_GATE.z }, { x, z: 3.1 }], enter, at.foundation - enter + 0.2, { face: Math.PI });
    c.hold(worker, 'idle', at.foundation + 0.2, at.scaffold - at.foundation - 0.2, { x, y: SITE_Y, z: 3.1, heading: Math.PI });
    c.at(at.scaffold, () => worker.hide());
  });

  // Phase 3: frame. Corner columns rise floor by floor; the crane brings each
  // floor's ring of beams from the depot stack and drops it in with a bounce.
  // Tall or quick builds group floors so the crane makes at most six lifts.
  const batch = craneBatch(floors, d.frame);
  const trips = Math.ceil(floors / batch);
  const tripLength = d.frame / trips;
  const ringY = (ring: number) => baseY + (ring + 1) * floorHeight;
  let pose = parked();
  for (let i = 0; i < trips; i++) {
    const r0 = i * batch;
    const r1 = Math.min(floors, (i + 1) * batch);
    const start = at.frame + i * tripLength;
    c.step(start + tripLength * 0.1, tripLength * 0.6, (t) => props.setColumns(baseY, baseY + (r0 + (r1 - r0) * t) * floorHeight));
    const finalTop = new THREE.Vector3(0, baseY + r1 * floorHeight, 0);
    pose = c.craneMove(stackPoint, finalTop, start, tripLength, pose, travelY, {
      pick: () => props.setRingCount(r1),
      carry: (point) => {
        for (let ring = r0; ring < r1; ring++) props.setRing(ring, point.x, point.y - 0.12 * (r1 - 1 - ring), point.z);
      },
      land: (from, t) => {
        for (let ring = r0; ring < r1; ring++) {
          const carried = from.y - 0.12 * (r1 - 1 - ring);
          props.setRing(ring, from.x * (1 - t), carried + (ringY(ring) - carried) * t, from.z * (1 - t));
        }
      },
    }, easeOutBounce);
  }

  // Phase 4: scaffold, bottom to top, then up to three workers on the planks.
  c.step(at.scaffold, d.scaffold, (t) => scaffold.revealTo(baseY + (height + 0.05) * t), linear);
  const faces: Array<[ScaffoldFace, number]> = [['front', -0.45], ['left', 0.35], ['front', 0.55]];
  const scaffolders = builders.slice(0, 3);
  const levels = Math.max(1, Math.min(floors, 24));
  const levelAt = (time: number) => Math.min(levels - 1, Math.floor((Math.max(0, time - at.cladding) / d.cladding) * levels));
  const floorTime = d.cladding / floors;
  const hammerCycle = floorTime * Math.max(1, Math.ceil(0.25 / floorTime));
  const strikeStart = at.roof + 0.3;
  scaffolders.forEach((worker, j) => {
    const [face, along] = faces[j]!;
    const from = at.scaffold + d.scaffold * 0.5 + 0.1 * j;
    c.step(from, strikeStart - from, (t) => {
      const time = from + t * (strikeStart - from);
      const spot = scaffold.standPoint(face, levelAt(time), along);
      worker.show();
      worker.place(spot.x, spot.y, spot.z, spot.heading);
      if (time < at.cladding) worker.setAnimationAt('idle', time - from);
      else worker.setAnimation('hammer', (time - at.cladding) / hammerCycle);
    }, linear);
    // Down off the scaffold as it strikes.
    c.step(strikeStart, 0.15, (t) => {
      const spot = scaffold.standPoint(face, levelAt(strikeStart), along);
      const ground = groundSpot(face, along);
      worker.place(spot.x + (ground.x - spot.x) * t, spot.y + (SITE_Y - spot.y) * t, spot.z + (ground.z - spot.z) * t, spot.heading);
      worker.setAnimationAt('idle', t);
    });
    c.hold(worker, 'idle', strikeStart + 0.15, at.cleanup - strikeStart - 0.15, { ...groundSpot(face, along), y: SITE_Y, heading: faceHeading(face) });
  });

  // Phase 5: cladding. The facade rises floor by floor behind the scaffold
  // with a hammer strike and a puff of dust as each floor completes. The
  // crane brings each band of floors a panel that fades as the plane passes it.
  const revealAt = (t: number) => {
    // Once complete, lift the plane clear of the top face so no fragment of it clips.
    if (t >= 1) return Infinity;
    const progress = Math.max(0, t) * floors;
    const floor = Math.min(floors - 1, Math.floor(progress));
    return baseY + (floor + easeInOutCubic(progress - floor)) * floorHeight;
  };
  let covered = 0;
  c.step(at.cladding, d.cladding, (t) => {
    const reveal = revealAt(t);
    props.setReveal(reveal);
    // The facade retires the frame it covers. The block body draws with a
    // polygon offset, so a beam slightly inside it would show through at grazing angles.
    props.setColumns(Math.min(reveal, top), top);
    while (covered < floors && ringY(covered) + BEAM_SIZE / 2 <= reveal) props.hideRing(covered++);
  }, linear);
  const puffEvery = Math.max(1, Math.ceil(floors / 12));
  for (let f = 1; f <= floors; f++) {
    if (f % puffEvery !== 0 && f !== floors) continue;
    c.at(at.cladding + f * floorTime, () => dust.puff(new THREE.Vector3((rng() - 0.5) * 2, baseY + f * floorHeight, 2.25), rng, 24, 0.5));
  }
  // Each lift lands as the plane reaches its band (see panelLifts).
  panelLifts(floors, schedule).forEach(({ r0, r1, start, lands, passes }, i) => {
    const bottom = baseY + r0 * floorHeight;
    const panelTop = baseY + r1 * floorHeight;
    const panelHeight = panelTop - bottom;
    const center = new THREE.Vector3(0, (bottom + panelTop) / 2, PANEL_Z);
    pose = c.craneMove(stackPoint, center, start, lands - start, pose, travelY, {
      pick: () => props.setPanel(i, stackPoint.x, stackPoint.y, stackPoint.z, panelHeight, 1),
      carry: (point) => props.setPanel(i, point.x, point.y - panelHeight / 2, point.z, panelHeight, 1),
      land: (from, t) => {
        const y = from.y - panelHeight / 2;
        props.setPanel(i, from.x + (center.x - from.x) * t, y + (center.y - y) * t, from.z + (center.z - from.z) * t, panelHeight, 1);
      },
    }, easeOutCubic);
    // The plate fades out as the plane passes it, from wherever the plane is
    // when it lands. Its own step, so a long jump still ends it hidden.
    const from = Math.max(bottom, revealAt((lands - at.cladding) / d.cladding));
    c.step(lands, passes - lands, (t) => {
      const reveal = t >= 1 ? Infinity : revealAt((lands + t * (passes - lands) - at.cladding) / d.cladding);
      const left = Math.min(1, Math.max(0, (panelTop - reveal) / Math.max(1e-6, panelTop - from)));
      props.setPanel(i, center.x, center.y, center.z, panelHeight, left);
    }, linear);
  });

  // Phase 6: roof and strike. The crane sets the cap with a small overshoot,
  // then the scaffold comes down top to bottom.
  const cap = props.cladding.cap;
  const capLocal = (point: THREE.Vector3) => cap.position.set(point.x, point.y - baseY, point.z);
  pose = c.craneMove(stackPoint, new THREE.Vector3(0, top, 0), at.roof - ROOF_LEAD, ROOF_LIFT, pose, travelY, {
    pick: () => {
      cap.visible = true;
      capLocal(stackPoint);
    },
    carry: (point) => capLocal(point),
    land: (from, t) => cap.position.set(from.x * (1 - t), from.y - baseY + (height + 0.002 - (from.y - baseY)) * t, from.z * (1 - t)),
  }, easeOutBack);
  c.step(strikeStart, 0.4, (t) => {
    if (t >= 1) scaffold.hide();
    else scaffold.revealTo(baseY + (height + 0.05) * (1 - t));
  }, linear);

  // Phase 7: cleanup. Machines back out, the crane folds away unless more work
  // is waiting, edges and label fade in, a last puff, and everyone leaves.
  c.drive(excavator, exIn.reversed(), at.cleanup, d.cleanup, true);
  c.drive(mixer, mixerIn.reversed(), at.cleanup, d.cleanup);
  let retract = true;
  c.at(at.cleanup, () => {
    retract = !scene.moreQueued();
  });
  const finalPose = pose;
  c.step(at.cleanup, d.cleanup, (t) => {
    if (!retract) return;
    const target = parked();
    crane.setPose({
      slew: finalPose.slew + angleBetween(finalPose.slew, target.slew) * t,
      trolley: finalPose.trolley + (target.trolley - finalPose.trolley) * t,
      hookY: finalPose.hookY + (target.hookY - finalPose.hookY) * t,
    });
  });
  c.step(at.cleanup + 0.1, 0.3, (t) => {
    props.setEdgeOpacity(0.5 * t);
    tower.setHeldLabelOpacity(block.id, HELD_LABEL_OPACITY + (1 - HELD_LABEL_OPACITY) * t);
  });
  c.at(at.cleanup, () => dust.puff(new THREE.Vector3(1.6, baseY + 0.05, 2.2), rng, 56, 1.0));
  c.at(at.cleanup + 0.05, () => {
    props.tripod.visible = false;
  });
  c.walk(surveyor, [stand, { x: stand.x, z: WORKER_GATE.z }, WORKER_GATE], at.cleanup, d.cleanup, { hide: true });
  scaffolders.forEach((worker, j) => {
    const [face, along] = faces[j]!;
    if (worker === surveyor) return;
    const ground = groundSpot(face, along);
    c.walk(worker, [ground, { x: ground.x, z: WORKER_GATE.z }, WORKER_GATE], at.cleanup + 0.05 * j, d.cleanup - 0.05 * j, { hide: true });
  });

  // Hold the final frame until the timeline's end so the job lasts its full length.
  c.step(0, total, () => {}, linear);
  return c.tl;
}

/** Where a worker stands on the ground beside a scaffold face. */
function groundSpot(face: ScaffoldFace, along: number): Point2 {
  const out = 2.75;
  const span = along * 1.9;
  return face === 'front' ? { x: span, z: out } : { x: -out, z: span };
}

function faceHeading(face: ScaffoldFace): number {
  return face === 'front' ? Math.PI : Math.PI / 2;
}

/**
 * Reduced motion (spec 9.7): the block fades in over 0.25 s with no crew,
 * on a site that is already prepared.
 */
export function fadeInJob(scene: JobScene, block: Block, token: SwatchToken): Job {
  const { crew, holds } = scene;
  holds.hold(block.id);
  let started = false;
  return {
    label: `Building ${block.title || 'Untitled'}`,
    start: () => {
      started = true;
      const settings = scene.settings();
      const props = crew.props;
      props.setup(token, minutesToY(block.start, settings), spanHeight(block.end - block.start), true);
      props.setReveal(Infinity);
      props.setFade(0);
      props.cladding.cap.visible = true;
      const tl = new Timeline();
      tl.add({
        at: 0,
        duration: 0.25,
        ease: linear,
        update: (t) => {
          props.setFade(t);
          scene.tower.setHeldLabelOpacity(block.id, t);
        },
      });
      return tl;
    },
    end: () => {
      if (started) crew.props.reset();
      holds.release(block.id);
      scene.tower.sync();
      scene.requestRender();
    },
  };
}

/**
 * Shows a block with no animation once the jobs ahead of it are done, so
 * blocks appear in order. Stacked blocks use this until M4.
 */
export function instantJob(scene: JobScene, block: Block): Job {
  scene.holds.hold(block.id);
  return {
    label: '',
    start: () => new Timeline(),
    end: () => {
      scene.holds.release(block.id);
      scene.tower.sync();
      scene.requestRender();
    },
  };
}


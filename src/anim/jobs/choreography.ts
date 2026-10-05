import * as THREE from 'three';
import { HOOK_HANG, type CranePose } from '../../scene/crew/Crane';
import { CRANE_PARK, SITE_Y, type Crew } from '../../scene/crew/Crew';
import type { Worker } from '../../scene/crew/Worker';
import type { WorkerAnim } from '../../scene/crew/workerAnims';
import { easeInOutCubic, easeOutCubic, linear, type Ease } from '../easing';
import { Path, angleBetween, type Point2 } from '../path';
import { Timeline } from '../Timeline';

// Building blocks every job uses to lay out its timeline: timed steps,
// workers walking and holding spots, machines driving, crane lifts, and the
// crane mast growing. Everything is a function of timeline time, so a job
// can be scrubbed, fast-forwarded, or finished and still land on its final
// state.

/** Seconds per walk cycle while workers hurry around the time-lapse site. */
export const WALK_CYCLE = 0.3;
/** How far a crane load drops from the hook at landing. */
export const DROP = 0.25;
/**
 * Where the crane lowers loads beside the tower when blocks above would be in
 * the way of a straight drop: the depot side, clear of the tower and the mast.
 * Loads slide in from here at their own height.
 */
export const LANE = { x: 4.3, z: 0.4 };

export interface Cargo {
  /** The load appears on the hook. */
  pick(): void;
  /** The load hangs at a world point under the hook. */
  carry(at: THREE.Vector3): void;
  /** The load moves from where the hook let go to its final place, t in [0, 1]. */
  land(from: THREE.Vector3, t: number): void;
}

/** The crane parked with its hook drawn up under a mast top. */
export function parkedPose(mastTop: number): CranePose {
  return { ...CRANE_PARK, hookY: mastTop - 0.38 };
}

export class Choreography {
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
  walk(
    worker: Worker,
    points: Point2[],
    start: number,
    duration: number,
    options: { y?: number; face?: number; hide?: boolean; anim?: WorkerAnim } = {},
  ): void {
    const path = new Path(points);
    const y = options.y ?? SITE_Y;
    const anim = options.anim ?? 'walk';
    this.step(
      start,
      duration,
      (t) => {
        worker.show();
        const p = path.atFraction(t, 0.25);
        const heading = options.face !== undefined && t >= 1 ? options.face : p.heading;
        worker.place(p.x, y, p.z, heading);
        worker.setAnimation(t >= 1 ? 'idle' : anim, (t * duration) / WALK_CYCLE);
        if (t >= 1 && options.hide) worker.hide();
      },
      linear,
    );
  }

  /** A worker holds a spot playing an animation. */
  hold(worker: Worker, anim: WorkerAnim, start: number, duration: number, spot: { x: number; y: number; z: number; heading: number }): void {
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

  /** Where the mast top stands for a tower top: 3 units over it, never below 3 (spec 10.4). */
  static mastFor(towerTop: number): number {
    return Math.max(3, towerTop + 3);
  }

  /** The crane mast grows or shrinks from one top height to another (spec 10.4). */
  mast(fromTop: number, toTop: number, start: number, duration: number): void {
    if (Math.abs(toTop - fromTop) < 1e-3) return;
    const crane = this.crew.crane;
    this.step(start, duration, (t) => crane.setMastTop(fromTop + (toTop - fromTop) * t));
  }

  /** The crane moves its hook from one pose to another. */
  swing(from: CranePose, to: CranePose, start: number, duration: number): void {
    const crane = this.crew.crane;
    this.step(start, duration, (t) => crane.setPose(blendPose(from, to, t)));
  }

  /**
   * One crane pick and place (spec 10.4): slew and trolley to the pickup
   * (0.3), lower and hook on (0.15), raise and swing over the target (0.35),
   * then lower and let go with the load's landing ease (0.2). With `via`,
   * the hook lowers beside the tower instead and the load slides in from
   * there at its own height.
   */
  craneMove(
    from: THREE.Vector3,
    to: THREE.Vector3,
    start: number,
    duration: number,
    before: CranePose,
    travelY: number,
    cargo: Cargo,
    landing: Ease,
    via?: { x: number; z: number },
  ): CranePose {
    const crane = this.crew.crane;
    const target = via ?? to;
    const pick = crane.aim(from.x, from.z);
    const drop = crane.aim(target.x, target.z);
    const pickHook = from.y + HOOK_HANG;
    const releaseHook = to.y + (via ? 0.02 : DROP) + HOOK_HANG;
    const overPick: CranePose = { ...pick, hookY: travelY };
    const atPick: CranePose = { ...pick, hookY: pickHook };
    const overDrop: CranePose = { ...drop, hookY: travelY };
    const atRelease: CranePose = { ...drop, hookY: releaseHook };
    const release = new THREE.Vector3();
    const carryAtHook = () => {
      crane.hookWorld(this.v);
      cargo.carry(this.v);
    };

    this.step(start, duration * 0.3, (t) => crane.setPose(blendPose(before, overPick, t)));
    this.step(start + duration * 0.3, duration * 0.15, (t) => crane.setPose(blendPose(overPick, atPick, t)));
    this.at(start + duration * 0.45, () => cargo.pick());
    this.step(start + duration * 0.45, duration * 0.35, (t) => {
      // Lift straight up first, then swing across.
      const lift = Math.min(1, t * 2.5);
      const swing = Math.max(0, (t - 0.2) / 0.8);
      const p = blendPose(atPick, overDrop, swing);
      p.hookY = pickHook + (travelY - pickHook) * easeOutCubic(lift);
      crane.setPose(p);
      carryAtHook();
    });
    this.step(start + duration * 0.8, duration * 0.1, (t) => {
      crane.setPose(blendPose(overDrop, atRelease, t));
      carryAtHook();
      if (t >= 1) release.copy(this.v);
    });
    this.step(start + duration * 0.9, duration * 0.1, (t) => cargo.land(release, t), landing);
    return atRelease;
  }
}

export function blendPose(a: CranePose, b: CranePose, t: number): CranePose {
  return {
    slew: a.slew + angleBetween(a.slew, b.slew) * t,
    trolley: a.trolley + (b.trolley - a.trolley) * t,
    hookY: a.hookY + (b.hookY - a.hookY) * t,
  };
}

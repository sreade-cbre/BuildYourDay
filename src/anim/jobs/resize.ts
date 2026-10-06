import * as THREE from 'three';
import { UNITS_PER_MINUTE } from '../../core/layout';
import { rngFromString } from '../../core/rng';
import type { CranePose } from '../../scene/crew/Crane';
import { HOOK_HANG } from '../../scene/crew/Crane';
import { STACK } from '../../scene/crew/Crew';
import type { ScaffoldFace } from '../../scene/crew/Scaffold';
import type { BlockPose, Claim } from '../../scene/holds';
import type { Job } from '../Director';
import { easeOutBack, linear } from '../easing';
import type { BlockMove } from '../plan';
import type { Timeline } from '../Timeline';
import { endJob } from './build';
import { Choreography, LANE, blendPose, parkedPose } from './choreography';
import { addExtend } from './extend';
import { hasBlocksAbove, standingTop, titleOf, type JobScene } from './scene';
import { addSettle, claimMove } from './settle';
import { addShrink } from './shrink';

// Extend and shrink (spec 11.2): a block gains or loses floors at its roof or
// its base. The tower's own mesh steps aside for the job's copy of the block,
// which spans both the old and the new times; clipping planes show only what
// stands at each moment. The top edge moves with the roof cap lifted off by
// the crane; at the base the roof stays put, so the planes sweep from the
// old base instead (spec 11.2, last item).

/** What the extend and shrink steps share while they lay out one job. */
export interface ResizeContext {
  scene: JobScene;
  c: Choreography;
  rng: () => number;
  move: BlockMove;
  from: BlockPose;
  to: BlockPose;
  /** World height the job's copy of the block is built from. */
  baseY: number;
  /** One floor's height: a slot. */
  floorHeight: number;
  /** Blocks stand above the new top, so loads come in from the side. */
  covered: boolean;
  travelY: number;
  stackPoint: THREE.Vector3;
  /** The crane's pose after the last lift laid out so far. */
  pose: CranePose;
  /** The cap's place relative to the copy's base. */
  capAt(point: THREE.Vector3): void;
}

/** When an edge's work is over, and when the crane has made its last lift for it. */
export interface EdgeTimes {
  end: number;
  craneDone: number;
}

/** Where two workers stand on the scaffold while they work on a block's edge. */
export const EDGE_WORKERS: Array<[ScaffoldFace, number]> = [['front', -0.4], ['left', 0.3]];

export function resizeJob(scene: JobScene, move: BlockMove, calm: boolean): Job {
  // The block keeps its old size until the job plays.
  const claim = claimMove(scene, move);
  claim.quiet = [{ start: Math.min(move.from.start, move.to.start), end: Math.max(move.from.end, move.to.end) }];
  const grows = move.to.end - move.to.start > move.from.end - move.from.start;
  return {
    label: `${grows ? 'Extending' : 'Shrinking'} ${titleOf(move.to)}`,
    borrows: ['crane'],
    start: () => {
      scene.crew.park({ machines: false });
      if (calm) {
        // Reduced motion: the block slides to its new size (spec 9.7).
        const c = new Choreography(scene.crew);
        addSettle(c, scene, move, claim, 0, true);
        return c.tl;
      }
      return resizeTimeline(scene, move, claim);
    },
    end: () => {
      scene.holds.release(move.to.id, claim);
      endJob(scene);
    },
  };
}

function resizeTimeline(scene: JobScene, move: BlockMove, claim: Claim): Timeline {
  const { crew, tower } = scene;
  const { props, crane } = crew;
  const settings = scene.settings();
  const from = claim.pose ? { ...claim.pose } : tower.poseFor(move.from);
  const to = tower.poseFor(move.to);
  const baseY = Math.min(from.baseY, to.baseY);
  const top = Math.max(from.baseY + from.height, to.baseY + to.height);

  // The job's copy takes over from the tower's mesh, showing the old block.
  claim.pose = null;
  props.setup(scene.token(move.to), baseY, top - baseY);
  props.setReveal(from.baseY + from.height);
  props.setRevealFrom(from.baseY);
  props.setEdgeOpacity(0.5);
  const cap = props.cladding.cap;
  cap.visible = true;
  const capAt = (point: THREE.Vector3) => cap.position.set(point.x, point.y - baseY, point.z);
  capAt(new THREE.Vector3(0, from.baseY + from.height + 0.002, 0));

  const towerTop = Math.max(standingTop(scene), top);
  const mastFrom = crane.pivotY;
  const mastHigh = Math.max(mastFrom, Choreography.mastFor(towerTop));
  const c = new Choreography(crew);
  c.mast(mastFrom, mastHigh, 0, 0.3);
  const ctx: ResizeContext = {
    scene,
    c,
    rng: rngFromString(move.to.id),
    move,
    from,
    to,
    baseY,
    floorHeight: settings.slotMinutes * UNITS_PER_MINUTE,
    covered: hasBlocksAbove(scene, move.to, move.to.id),
    travelY: Math.min(mastHigh - 0.45, Math.max(towerTop + 0.9, STACK.top + 1.2) + HOOK_HANG),
    stackPoint: new THREE.Vector3(STACK.x, STACK.top + 0.08, STACK.z),
    pose: crane.currentPose,
    capAt,
  };

  // The roof edge first, since it needs the crane; the base edge needs it only to extend.
  const fromTop = from.baseY + from.height;
  const toTop = to.baseY + to.height;
  let end = 0;
  let craneDone = 0;
  const add = (times: EdgeTimes) => {
    end = Math.max(end, times.end);
    craneDone = Math.max(craneDone, times.craneDone);
  };
  if (toTop > fromTop + 1e-6) add(addExtend(ctx, 'top'));
  else if (toTop < fromTop - 1e-6) add(addShrink(ctx, 'top'));
  if (to.baseY < from.baseY - 1e-6) add(addExtend(ctx, 'base'));
  else if (to.baseY > from.baseY + 1e-6) add(addShrink(ctx, 'base'));

  // After its last lift the crane folds away, unless more work is waiting,
  // and the mast settles to the new tower, all within the edge's own time.
  const mastEnd = Choreography.mastFor(standingTop(scene));
  if (craneDone > 0) {
    const finalPose = ctx.pose;
    const fold = Math.max(0.2, end - craneDone);
    let retract = true;
    c.at(craneDone, () => {
      retract = !scene.moreQueued();
    });
    c.step(craneDone, fold, (t) => {
      if (retract) crane.setPose(blendPose(finalPose, parkedPose(mastEnd), t));
    });
    end = Math.max(end, craneDone + fold);
  }
  c.mast(mastHigh, mastEnd, Math.max(0, end - 0.35), 0.35);
  c.step(0, end, () => {}, linear);
  return c.tl;
}

/**
 * Two workers pop onto the scaffold at a level, hammer from `work` for
 * `length` seconds, and pop off when the scaffold strikes.
 */
export function addEdgeWorkers(ctx: ResizeContext, level: number, appear: number, work: number, length: number, leave: number): void {
  const { c, scene } = ctx;
  const { scaffold } = scene.crew;
  EDGE_WORKERS.forEach(([face, along], j) => {
    const worker = scene.crew.workers[j]!;
    const show = appear + 0.06 * j;
    c.step(show, leave - show, (t) => {
      const time = show + t * (leave - show);
      const spot = scaffold.standPoint(face, level, along);
      worker.show();
      worker.place(spot.x, spot.y, spot.z, spot.heading);
      if (time < work || time > work + length) worker.setAnimationAt('idle', time);
      else worker.setAnimation('hammer', (time - work) / 0.6);
      if (t >= 1) worker.hide();
    }, linear);
    c.step(show, 0.14, (t) => worker.setScale(t), easeOutBack);
    c.step(leave - 0.12, 0.12, (t) => worker.setScale(1 - t), linear);
  });
}

/**
 * Takes the roof cap off at the start of a top edge job: straight up on the
 * hook, or out to the side lane first when blocks stand above. With
 * `toStack`, the crane sets it down on the depot stack so it is free for
 * other lifts; otherwise it holds the cap until `capOn`. Returns where the
 * cap hangs while held.
 */
export function capOff(ctx: ResizeContext, start: number, length: number, toStack: boolean): THREE.Vector3 {
  const { c, scene, from, covered } = ctx;
  const crane = scene.crew.crane;
  const fromTop = from.baseY + from.height + 0.002;
  const onRoof = new THREE.Vector3(0, fromTop, 0);
  const side = new THREE.Vector3(LANE.x, fromTop, LANE.z);
  if (covered) c.step(start, length * 0.35, (t) => ctx.capAt(onRoof.clone().lerp(side, t)));
  const pickup = covered ? side : onRoof;
  const pickAt = start + (covered ? length * 0.3 : 0);
  if (toStack) {
    ctx.pose = c.craneMove(pickup, ctx.stackPoint, pickAt, start + length - pickAt, ctx.pose, ctx.travelY, {
      pick: () => {},
      carry: (point) => ctx.capAt(point),
      land: (point, t) => ctx.capAt(point.clone().lerp(ctx.stackPoint, t)),
    }, linear);
    return ctx.stackPoint.clone();
  }
  // Hold it on the hook, lifted a little clear of the roof.
  const aim = crane.aim(pickup.x, pickup.z);
  const held = pickup.clone().add(new THREE.Vector3(0, covered ? 0.3 : 0.7, 0));
  const meet = { ...aim, hookY: pickup.y + HOOK_HANG };
  const lift = { ...aim, hookY: held.y + HOOK_HANG };
  c.swing(ctx.pose, meet, start, length * 0.6);
  c.step(start + length * 0.6, length * 0.4, (t) => {
    crane.setPose(blendPose(meet, lift, t));
    ctx.capAt(pickup.clone().lerp(held, t));
  });
  ctx.pose = lift;
  return held;
}

/**
 * Puts the roof cap back on at the end of a top edge job: from the stack or
 * from where the hook holds it, onto the new top, sliding in from the lane
 * when blocks stand above.
 */
export function capOn(ctx: ResizeContext, start: number, length: number, from: THREE.Vector3 | null): void {
  const { c, scene, to, covered } = ctx;
  const crane = scene.crew.crane;
  const toTop = to.baseY + to.height + 0.002;
  const onRoof = new THREE.Vector3(0, toTop, 0);
  if (!from) {
    ctx.pose = c.craneMove(ctx.stackPoint, onRoof, start, length, ctx.pose, ctx.travelY, {
      pick: () => {},
      carry: (point) => ctx.capAt(point),
      land: (point, t) => ctx.capAt(point.clone().lerp(onRoof, t)),
    }, covered ? linear : easeOutBack, covered ? LANE : undefined);
    return;
  }
  const lowered = new THREE.Vector3(from.x, toTop, from.z);
  const aim = crane.aim(from.x, from.z);
  const down = { ...aim, hookY: toTop + HOOK_HANG };
  const held = ctx.pose;
  const slide = covered ? 0.4 : 0;
  c.step(start, length * (1 - slide), (t) => {
    crane.setPose(blendPose(held, down, t));
    ctx.capAt(from.clone().lerp(lowered, t));
  });
  if (covered) c.step(start + length * (1 - slide), length * slide, (t) => ctx.capAt(lowered.clone().lerp(onRoof, t)));
  ctx.pose = down;
}

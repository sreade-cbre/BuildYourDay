import * as THREE from 'three';
import type { BlockId } from '../../core/model';
import { rngFromString } from '../../core/rng';
import type { BlockPose, Claim } from '../../scene/holds';
import type { Job } from '../Director';
import { easeOutBack, easeOutCubic, linear } from '../easing';
import type { BlockMove } from '../plan';
import { endJob } from './build';
import { Choreography } from './choreography';
import { solidBlocks, titleOf, type JobScene } from './scene';
import { CALM_SECONDS, SETTLE_SECONDS } from './schedule';

// Settle (spec 9.2): a block slides to its new height with a small overshoot
// and a puff of dust at its base. Under fixed times this plays when Move
// earlier or Move later shifts a block into free time beside it, and for the
// partner of a swap while the other block is relocated.

/** easeOutBack overshoots by about 7% of the distance traveled. */
const OVERSHOOT = 0.075;

/**
 * Claims a moving block: until its job plays it stays where it was, and the
 * gap outlines around both places wait for the job to finish.
 */
export function claimMove(scene: JobScene, move: BlockMove): Claim {
  const from = scene.tower.poseFor(move.from);
  return scene.holds.claim(move.to.id, { pose: { ...from }, labelOpacity: 1, quiet: [move.from, move.to] });
}

/** Free height beyond a target pose in the direction of travel, up to the next block or the slab. */
function roomPast(scene: JobScene, id: BlockId, to: BlockPose, up: boolean): number {
  let room = Infinity;
  for (const block of solidBlocks(scene, id)) {
    const pose = scene.tower.poseFor(block);
    if (up && pose.baseY >= to.baseY + to.height - 1e-6) room = Math.min(room, pose.baseY - (to.baseY + to.height));
    if (!up && pose.baseY + pose.height <= to.baseY + 1e-6) room = Math.min(room, to.baseY - (pose.baseY + pose.height));
  }
  return up ? room : Math.min(room, to.baseY);
}

/**
 * Slides a claimed block from its current pose to where the data puts it,
 * starting at `start`. Returns when it arrives. Under reduced motion the
 * slide is linear, with no overshoot and no dust (spec 9.7).
 */
export function addSettle(c: Choreography, scene: JobScene, move: BlockMove, claim: Claim, start: number, calm: boolean): number {
  const pose = claim.pose;
  if (!pose) return start;
  const from = { ...pose };
  const to = scene.tower.poseFor(move.to);
  const duration = calm ? CALM_SECONDS : SETTLE_SECONDS;
  const distance = Math.abs(to.baseY - from.baseY);
  const up = to.baseY > from.baseY;
  const ease = calm ? linear : roomPast(scene, move.to.id, to, up) >= distance * OVERSHOOT ? easeOutBack : easeOutCubic;
  c.step(start, duration, (t) => {
    pose.baseY = from.baseY + (to.baseY - from.baseY) * t;
    pose.height = from.height + (to.height - from.height) * t;
    pose.x = from.x + (to.x - from.x) * t;
    pose.z = from.z + (to.z - from.z) * t;
  }, ease);
  if (!calm) {
    const rng = rngFromString(move.to.id);
    c.at(start + duration * 0.7, () => scene.crew.dust.puff(new THREE.Vector3(0.6, to.baseY + 0.05, 2.15), rng, 30, 0.6));
  }
  return start + duration;
}

/** Slides one or more blocks to their new heights together. */
export function settleJob(scene: JobScene, moves: BlockMove[], calm: boolean): Job {
  const claims = moves.map((move) => claimMove(scene, move));
  return {
    label: `Moving ${titleOf(moves[0]!.to)}`,
    start: () => {
      scene.crew.park({ crane: false, machines: false });
      const c = new Choreography(scene.crew);
      moves.forEach((move, i) => addSettle(c, scene, move, claims[i]!, 0, calm));
      return c.tl;
    },
    end: () => {
      moves.forEach((move, i) => scene.holds.release(move.to.id, claims[i]!));
      endJob(scene);
    },
  };
}

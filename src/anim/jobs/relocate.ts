import * as THREE from 'three';
import { rngFromString } from '../../core/rng';
import { HOOK_HANG } from '../../scene/crew/Crane';
import type { Claim } from '../../scene/holds';
import type { Job } from '../Director';
import { easeOutCubic, linear } from '../easing';
import type { BlockMove } from '../plan';
import { Timeline } from '../Timeline';
import { endJob } from './build';
import { Choreography, blendPose, parkedPose } from './choreography';
import { standingTop, titleOf, type JobScene } from './scene';
import { CALM_SECONDS, relocateSchedule } from './schedule';
import { addSettle, claimMove } from './settle';

// Relocate (spec 11.3): the crane takes a block from one time to another.
// The spec lifts the block straight up, but blocks standing above it would
// be in the way, so the block slides out of the tower first, behind its left
// side where the crane can hook it without the cable crossing the tower. It
// rides to its new height there and slides back in. A swap partner settles
// into place while the block is out of the way.

/** Where a relocated block waits outside the tower: behind its left side, within the jib's reach. */
const OUT = { x: -2.0, z: -4.2 };

export function relocateJob(scene: JobScene, move: BlockMove, settles: BlockMove[], calm: boolean): Job {
  const claim = claimMove(scene, move);
  const partnerClaims = settles.map((m) => claimMove(scene, m));
  return {
    label: `Moving ${titleOf(move.to)}`,
    start: () => {
      scene.crew.park();
      return calm ? calmTimeline(scene, move, claim, settles, partnerClaims) : relocateTimeline(scene, move, claim, settles, partnerClaims);
    },
    end: () => {
      scene.holds.release(move.to.id, claim);
      settles.forEach((m, i) => scene.holds.release(m.to.id, partnerClaims[i]!));
      endJob(scene);
    },
  };
}

function relocateTimeline(scene: JobScene, move: BlockMove, claim: Claim, settles: BlockMove[], partnerClaims: Claim[]): Timeline {
  const { crew, tower } = scene;
  const { crane, dust } = crew;
  const c = new Choreography(crew);
  const rng = rngFromString(move.to.id);
  const pose = claim.pose!;
  const from = { ...pose };
  const to = tower.poseFor(move.to);
  const { out, travel, back, at, total } = relocateSchedule(Math.abs(to.baseY - from.baseY));

  // The jib clears the tower as it stands before and after the move.
  const after = standingTop(scene);
  const mastFrom = crane.pivotY;
  const mastHigh = Math.max(mastFrom, Choreography.mastFor(Math.max(after, from.baseY + from.height)));
  const mastEnd = Choreography.mastFor(after);
  c.mast(mastFrom, mastHigh, 0, 0.3);
  c.mast(mastHigh, mastEnd, total - 0.3, 0.3);

  // The hook comes down beside the block's way out as the block arrives.
  const aim = crane.aim(OUT.x, OUT.z);
  const hookOver = (top: number) => top + HOOK_HANG;
  const meet = { ...aim, hookY: hookOver(from.baseY + from.height) };
  c.swing(crane.currentPose, meet, at.hook, at.out + out * 0.9);

  // Out of the tower at its own height, where nothing else stands.
  c.step(at.out, out, (t) => {
    pose.x = from.x + (OUT.x - from.x) * t;
    pose.z = from.z + (OUT.z - from.z) * t;
  });
  c.at(at.out, () => dust.puff(new THREE.Vector3(-1.2, from.baseY + 0.05, -1.6), rng, 28, 0.5));
  // Its label steps aside while the block is outside the tower, so it never
  // crosses the labels of the blocks it passes.
  c.step(at.out, 0.15, (t) => {
    claim.labelOpacity = 1 - t;
  }, linear);
  c.step(at.park, 0.2, (t) => {
    claim.labelOpacity = t;
  }, linear);

  // On the hook to its new height, outside the tower.
  c.step(at.travel, travel, (t) => {
    pose.baseY = from.baseY + (to.baseY - from.baseY) * t;
    pose.height = from.height + (to.height - from.height) * t;
    crane.setPose({ ...aim, hookY: hookOver(pose.baseY + pose.height) });
  });
  settles.forEach((m, i) => addSettle(c, scene, m, partnerClaims[i]!, at.travel + 0.05, false));

  // Back in at the new height, and a puff of dust as it lands.
  c.step(at.back, back, (t) => {
    pose.x = OUT.x * (1 - t);
    pose.z = OUT.z * (1 - t);
  }, easeOutCubic);
  c.at(at.back + back * 0.85, () => dust.puff(new THREE.Vector3(0.6, to.baseY + 0.05, 2.15), rng, 40, 0.8));

  // The crane lets go and folds away unless more work is waiting.
  let retract = true;
  c.at(at.park, () => {
    retract = !scene.moreQueued();
  });
  const release = { ...aim, hookY: hookOver(to.baseY + to.height) };
  c.step(at.park, total - at.park, (t) => {
    if (retract) crane.setPose(blendPose(release, parkedPose(mastEnd), t));
  });
  return c.tl;
}

/**
 * Reduced motion (spec 9.7): the block fades out where it was and back in at
 * its new time, and any swap partner slides over linearly.
 */
function calmTimeline(scene: JobScene, move: BlockMove, claim: Claim, settles: BlockMove[], partnerClaims: Claim[]): Timeline {
  const { crew, tower } = scene;
  const props = crew.props;
  const c = new Choreography(crew);
  const from = claim.pose ? { ...claim.pose } : tower.poseFor(move.from);
  const to = tower.poseFor(move.to);
  claim.pose = null;
  props.setup(scene.token(move.to), from.baseY, from.height, true);
  props.setReveal(Infinity);
  props.cladding.cap.visible = true;
  c.step(0, CALM_SECONDS, (t) => {
    const leaving = t < 0.5;
    const place = leaving ? from : to;
    props.cladding.setBaseY(place.baseY);
    props.cladding.setHeight(place.height);
    props.setFade(leaving ? 1 - t * 2 : t * 2 - 1);
    claim.labelOpacity = leaving ? 1 - t * 2 : t * 2 - 1;
  }, linear);
  settles.forEach((m, i) => addSettle(c, scene, m, partnerClaims[i]!, 0, true));
  return c.tl;
}

import * as THREE from 'three';
import { easeInOutCubic, linear } from '../easing';
import { addEdgeWorkers, capOff, capOn, type EdgeTimes, type ResizeContext } from './resize';
import { shrinkDuration } from './schedule';

// Shrink (spec 11.2): the roof cap lifts off, scaffold wraps the floors being
// removed, the clipping plane sweeps them away while two workers hammer, the
// cap goes back on, and the scaffold strikes. At the base the roof stays put
// and the plane sweeps up from the old base instead.

export function addShrink(ctx: ResizeContext, edge: 'top' | 'base'): EdgeTimes {
  const { c, scene, from, to, rng } = ctx;
  const { props, scaffold, dust } = scene.crew;
  const atTop = edge === 'top';
  const lo = atTop ? to.baseY + to.height : from.baseY;
  const hi = atTop ? from.baseY + from.height : to.baseY;
  const removed = hi - lo;
  const floors = Math.max(1, Math.round(removed / ctx.floorHeight));
  const floorHeight = removed / floors;
  const total = shrinkDuration(floors);
  const sweepStart = 0.3;
  const sweepEnd = total - 0.45;

  scaffold.layout(lo, removed, floors);
  c.step(0.05, 0.25, (t) => scaffold.revealTo(lo + (removed + 0.05) * t), linear);
  c.step(total - 0.3, 0.3, (t) => (t >= 1 ? scaffold.hide() : scaffold.revealTo(lo + (removed + 0.05) * (1 - t))), linear);
  addEdgeWorkers(ctx, 0, 0.2, sweepStart, sweepEnd - sweepStart, total - 0.25);

  const held = atTop ? capOff(ctx, 0, sweepStart, false) : null;

  // The plane sweeps through the removed floors one by one.
  const sweepAt = (t: number) => {
    const progress = Math.max(0, t) * floors;
    const floor = Math.min(floors - 1, Math.floor(progress));
    const done = (floor + easeInOutCubic(progress - floor)) * floorHeight;
    return atTop ? hi - done : lo + done;
  };
  c.step(sweepStart, sweepEnd - sweepStart, (t) => {
    const y = t >= 1 ? (atTop ? lo : hi) : sweepAt(t);
    if (atTop) props.setReveal(y);
    else props.setRevealFrom(y);
  }, linear);
  const floorTime = (sweepEnd - sweepStart) / floors;
  for (let f = 1; f <= floors; f++) {
    const y = atTop ? hi - f * floorHeight : lo + f * floorHeight;
    c.at(sweepStart + f * floorTime, () => dust.puff(new THREE.Vector3((rng() - 0.5) * 2, y, 2.2), rng, 30, 0.6));
  }

  if (atTop) capOn(ctx, sweepEnd, 0.25, held);
  return { end: total, craneDone: atTop ? sweepEnd + 0.25 : 0 };
}

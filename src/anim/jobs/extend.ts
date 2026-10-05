import * as THREE from 'three';
import { BEAM_SIZE } from '../../scene/crew/props';
import { easeInOutCubic, easeOutBounce, easeOutCubic, linear } from '../easing';
import { LANE } from './choreography';
import { addEdgeWorkers, capOff, capOn, type EdgeTimes, type ResizeContext } from './resize';
import { craneBatch, extendSchedule } from './schedule';

// Extend (spec 11.2): new floors at a block's roof or base. Scaffold goes up
// around the new floors only, the crane brings their beams, and the facade
// reveals from the old edge to the new one. At the roof the cap goes to the
// depot stack first, so the crane is free for the beams, and comes back
// last. At the base the block itself stands overhead, so beams come in from
// the side lane.

export function addExtend(ctx: ResizeContext, edge: 'top' | 'base'): EdgeTimes {
  const { c, scene, from, to, rng } = ctx;
  const { props, scaffold, dust } = scene.crew;
  const atTop = edge === 'top';
  const lo = atTop ? from.baseY + from.height : to.baseY;
  const hi = atTop ? to.baseY + to.height : from.baseY;
  const added = hi - lo;
  const floors = Math.max(1, Math.round(added / ctx.floorHeight));
  const floorHeight = added / floors;
  const { d, at, total } = extendSchedule(added, atTop);
  const via = !atTop || ctx.covered ? LANE : undefined;

  // Scaffold around the new floors, and two workers on it.
  scaffold.layout(lo, added, floors);
  c.step(at.scaffold, 0.3, (t) => scaffold.revealTo(lo + (added + 0.05) * t), linear);
  c.step(at.strike, d.strike, (t) => (t >= 1 ? scaffold.hide() : scaffold.revealTo(lo + (added + 0.05) * (1 - t))), linear);
  const levels = Math.max(1, Math.min(floors, 24));
  addEdgeWorkers(ctx, atTop ? levels - 1 : 0, at.scaffold + 0.25, at.cladding, d.cladding, at.strike + 0.05);

  if (atTop) capOff(ctx, 0, d.capOff, true);

  // Frame: columns rise through the new floors and the crane brings each ring.
  const ringY = (ring: number) => lo + (ring + 1) * floorHeight;
  const batch = craneBatch(floors, d.frame);
  const trips = Math.ceil(floors / batch);
  const tripLength = d.frame / trips;
  for (let i = 0; i < trips; i++) {
    const r0 = i * batch;
    const r1 = Math.min(floors, (i + 1) * batch);
    const start = at.frame + i * tripLength;
    c.step(start + tripLength * 0.1, tripLength * 0.6, (t) => props.setColumns(lo, lo + (r0 + (r1 - r0) * t) * floorHeight));
    const target = new THREE.Vector3(0, ringY(r1 - 1), 0);
    ctx.pose = c.craneMove(ctx.stackPoint, target, start, tripLength, ctx.pose, ctx.travelY, {
      pick: () => props.setRingCount(r1),
      carry: (point) => {
        for (let ring = r0; ring < r1; ring++) props.setRing(ring, point.x, point.y - 0.12 * (r1 - 1 - ring), point.z);
      },
      land: (point, t) => {
        for (let ring = r0; ring < r1; ring++) {
          const carried = point.y - 0.12 * (r1 - 1 - ring);
          props.setRing(ring, point.x * (1 - t), carried + (ringY(ring) - carried) * t, point.z * (1 - t));
        }
      },
    }, via ? easeOutCubic : easeOutBounce, via);
  }

  // Cladding: the facade reveals floor by floor from the old edge to the new
  // one, retiring the frame it covers, with a puff as each floor completes.
  const revealAt = (t: number) => {
    const progress = Math.max(0, t) * floors;
    const floor = Math.min(floors - 1, Math.floor(progress));
    const done = (floor + easeInOutCubic(progress - floor)) * floorHeight;
    return atTop ? lo + done : hi - done;
  };
  let retired = 0;
  c.step(at.cladding, d.cladding, (t) => {
    if (atTop) {
      const y = t >= 1 ? Infinity : revealAt(t);
      props.setReveal(y);
      props.setColumns(Math.min(y, hi), hi);
      while (retired < floors && ringY(retired) + BEAM_SIZE / 2 <= y) props.hideRing(retired++);
    } else {
      const y = t >= 1 ? -Infinity : revealAt(t);
      props.setRevealFrom(y);
      props.setColumns(lo, Math.max(lo, y));
      while (retired < floors && ringY(floors - 1 - retired) - BEAM_SIZE / 2 >= y) props.hideRing(floors - 1 - retired++);
    }
  }, linear);
  const floorTime = d.cladding / floors;
  for (let f = 1; f <= floors; f++) {
    const y = atTop ? lo + f * floorHeight : hi - f * floorHeight;
    c.at(at.cladding + f * floorTime, () => dust.puff(new THREE.Vector3((rng() - 0.5) * 2, y, 2.25), rng, 24, 0.5));
  }

  if (atTop) capOn(ctx, at.roof, d.roof, null);
  return { end: total, craneDone: atTop ? at.roof + d.roof : at.frame + d.frame };
}

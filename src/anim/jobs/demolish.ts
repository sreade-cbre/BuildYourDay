import * as THREE from 'three';
import { BLOCK_FOOTPRINT, PLOT_SIZE, isInWindow } from '../../core/layout';
import type { Block, SwatchToken } from '../../core/model';
import { rngFromString } from '../../core/rng';
import { BlockMesh } from '../../scene/BlockMesh';
import { HOOK_HANG } from '../../scene/crew/Crane';
import { HOMES, WORK_SPOTS } from '../../scene/crew/Crew';
import { BALL_RADIUS, CHAIN_LENGTH } from '../../scene/crew/WreckingBall';
import { PLOT_TOP_Y } from '../../scene/Foundation';
import { DEPOT_TOP_Y, GROUND_Y } from '../../scene/Ground';
import type { BlockPose, SiteClaim } from '../../scene/holds';
import type { Job } from '../Director';
import { easeOutCubic, linear } from '../easing';
import { Path } from '../path';
import type { Timeline } from '../Timeline';
import { endJob } from './build';
import { Choreography, blendPose, parkedPose } from './choreography';
import { standingBlocks, standingTop, surfaceBelow, titleOf, type JobScene } from './scene';
import { CALM_SECONDS, DEMOLISH, rubbleGrid } from './schedule';

// Demolish (spec 11.1): guard rails on the roof below, the crane swings the
// wrecking ball into the block's upper third, and on contact the block turns
// into a heap of cubes that fly out, fall onto the surface below, bounce
// once, and fade. A dump truck backs in and the last 30% of the cubes go into
// its bed. Under fixed times nothing settles afterward: the time stays free.
// Demolishing the day's last block also clears the site back to grass.

const CONTACT_ANGLE = 0.12;
const DRAW_BACK = -1.0;

interface Cube {
  x: number;
  y: number;
  z: number;
  /** Total sideways travel before landing. */
  dx: number;
  dz: number;
  /** Where it comes to rest. */
  restY: number;
  hop: number;
  fall: number;
  spinX: number;
  spinZ: number;
  loaded: boolean;
}

export function demolishJob(scene: JobScene, block: Block, calm: boolean): Job {
  const { crew, holds, tower } = scene;
  const token = scene.token(block);
  const pose = tower.poseFor(block);
  // The removed block stands as a copy until its demolition plays.
  const proxy = new BlockMesh(block.id, token);
  proxy.setAppearance({ token, dimmed: false, hovered: false, hatched: !isInWindow(block, scene.settings()), weathered: false });
  proxy.setBaseY(pose.baseY);
  proxy.setHeight(pose.height);
  proxy.root.visible = false;
  crew.root.add(proxy.root);
  const claim = holds.claim(block.id, {
    pose: null,
    labelOpacity: 0,
    quiet: [block],
    onFirst: () => {
      proxy.root.visible = true;
      scene.requestRender();
    },
  });
  // The last block's site stays as it is until the demolition clears it.
  const site = scene.blocks().length === 0 ? holds.claimSite('freeze') : null;
  return {
    label: `Demolishing ${titleOf(block)}`,
    start: () => {
      crew.park();
      return calm ? fadeOut(scene, proxy, pose, token) : demolishTimeline(scene, block, pose, proxy, site);
    },
    end: () => {
      proxy.dispose();
      holds.release(block.id, claim);
      if (site) holds.releaseSite(site);
      endJob(scene);
    },
  };
}

function demolishTimeline(scene: JobScene, block: Block, pose: BlockPose, proxy: BlockMesh, site: SiteClaim | null): Timeline {
  const { crew, ground, tower } = scene;
  const { crane, ball, rubble, dust, dumpTruck, rail, props } = crew;
  const c = new Choreography(crew);
  const rng = rngFromString(block.id);
  const base = pose.baseY;
  const height = pose.height;
  const top = base + height;
  const surface = surfaceBelow(scene, base);
  const overhead = standingBlocks(scene).some((b) => tower.poseFor(b).baseY >= top - 1e-6);

  // The job takes over the slab so it can clear it at the end.
  if (site) {
    site.mode = 'build';
    props.setSlab(1);
    props.setPads([1, 1, 1, 1]);
    tower.sync();
  }

  // 1. Guard rails on the roof of the block below, if one carries this block.
  if (surface > 0.01 && Math.abs(surface - base) < 1e-3) {
    c.step(0, DEMOLISH.rails, (t) => rail.show(base, t), easeOutCubic);
    c.step(DEMOLISH.rubbleEnd - 0.15, 0.15, (t) => rail.show(base, 1 - t), linear);
  }

  // 2. The crane brings the ball over in front of the block, draws it back,
  // and swings it into the upper third of the front face.
  const contactY = base + height * (height > 0.9 ? 0.78 : 0.5);
  const pivot = new THREE.Vector3(
    0,
    contactY + CHAIN_LENGTH * Math.cos(CONTACT_ANGLE),
    BLOCK_FOOTPRINT / 2 + BALL_RADIUS + CHAIN_LENGTH * Math.sin(CONTACT_ANGLE),
  );
  const swing = { ...crane.aim(pivot.x, pivot.z), hookY: pivot.y + HOOK_HANG };
  c.swing(crane.currentPose, swing, 0, 0.28);
  const hook = new THREE.Vector3();
  const hang = (angle: number) => {
    crane.hookPoint(hook);
    ball.set(hook, angle);
  };
  c.step(0, DEMOLISH.contact, (t) => {
    const time = t * DEMOLISH.contact;
    if (time < 0.2) hang(0);
    else if (time < 0.3) hang(DRAW_BACK * easeOutCubic((time - 0.2) / 0.1));
    else {
      // Gathering speed as it falls in.
      const s = (time - 0.3) / 0.1;
      hang(DRAW_BACK + (CONTACT_ANGLE - DRAW_BACK) * s * s);
    }
  }, linear);
  c.step(DEMOLISH.contact, 0.2, (t) => hang(CONTACT_ANGLE + (-0.35 - CONTACT_ANGLE) * t), easeOutCubic);
  const mastEnd = Choreography.mastFor(standingTop(scene));
  c.step(0.6, 0.4, (t) => {
    crane.setPose(blendPose(swing, parkedPose(crane.pivotY), t));
    hang(-0.35 * (1 - t));
    if (t >= 1) ball.hide();
  });
  c.mast(crane.pivotY, mastEnd, DEMOLISH.rubbleEnd, DEMOLISH.truckGone - DEMOLISH.rubbleEnd);

  // 3. On contact the block becomes rubble that flies out, falls onto the
  // surface below, bounces once, and fades over the last 0.3 s.
  const grid = rubbleGrid(height);
  const impact = new THREE.Vector3(0, contactY, BLOCK_FOOTPRINT / 2);
  const cubes = planCubes(grid, base, height, surface, impact, overhead, rng);
  const edge = grid.edge * 0.92;
  const bed = new THREE.Vector3();
  c.at(DEMOLISH.contact, () => {
    proxy.root.visible = false;
    rubble.setup(scene.token(block), cubes.length);
    dust.puff(impact, rng, 54, 1.1);
  });
  c.step(DEMOLISH.contact, DEMOLISH.rubbleEnd - DEMOLISH.contact, (t) => {
    const time = t * (DEMOLISH.rubbleEnd - DEMOLISH.contact);
    const now = DEMOLISH.contact + time;
    dumpTruck.bedPoint(bed);
    cubes.forEach((cube, i) => {
      const s = Math.min(1, time / cube.fall);
      const spread = easeOutCubic(s);
      let x = cube.x + cube.dx * spread;
      let z = cube.z + cube.dz * spread;
      let y = cube.y + (cube.restY - cube.y) * s * s + cube.hop * 4 * s * (1 - s);
      const after = time - cube.fall;
      if (after > 0 && after < 0.12) y += Math.min(0.12, (cube.y - cube.restY) * 0.06) * Math.sin((after / 0.12) * Math.PI);
      // The last 30% go into the truck's bed as they fade (spec 11.1 step 4).
      if (cube.loaded && now > DEMOLISH.fadeStart) {
        const u = Math.min(1, (now - DEMOLISH.fadeStart) / 0.25);
        x += (bed.x + (i % 3) * 0.12 - 0.12 - x) * u;
        z += (bed.z + ((i >> 1) % 3) * 0.15 - 0.15 - z) * u;
        y += (bed.y + edge / 2 - y) * u + 0.5 * Math.sin(u * Math.PI);
      }
      const tumble = Math.min(time, cube.fall);
      rubble.setCube(i, x, y, z, cube.spinX * tumble, cube.spinZ * tumble, edge);
    });
    rubble.commit();
    rubble.setOpacity(now < DEMOLISH.fadeStart ? 1 : 1 - (now - DEMOLISH.fadeStart) / (DEMOLISH.rubbleEnd - DEMOLISH.fadeStart));
    if (t >= 1) rubble.hide();
  }, linear);
  // Three dust puffs: the hit, the landing, and the heap settling.
  c.at(0.66, () => dust.puff(new THREE.Vector3(0.4, surface + 0.05, 1.6), rng, 48, 0.9));
  c.at(0.86, () => dust.puff(new THREE.Vector3(-0.8, surface + 0.05, 1.9), rng, 40, 0.8));

  // 4. The dump truck backs in for the rubble and drives off with it.
  const truckIn = new Path([HOMES.dump, WORK_SPOTS.dump]);
  c.drive(dumpTruck, truckIn, DEMOLISH.contact + 0.05, DEMOLISH.fadeStart - DEMOLISH.contact - 0.05, true);
  c.drive(dumpTruck, truckIn.reversed(), DEMOLISH.rubbleEnd, DEMOLISH.truckGone - DEMOLISH.rubbleEnd);

  // The day's last block: the slab sinks and the grass grows back.
  if (site) {
    const restore = DEMOLISH.truckGone - DEMOLISH.rubbleEnd;
    c.step(DEMOLISH.rubbleEnd, restore, (t) => {
      props.setSlab(1 - t);
      props.setPads([1 - t, 1 - t, 1 - t, 1 - t]);
      ground.setPrepFade(1 - t);
      ground.setClearFront(-PLOT_SIZE / 2 - 1 + (PLOT_SIZE + 2) * t);
    }, linear);
  }
  c.step(0, DEMOLISH.truckGone, () => {}, linear);
  return c.tl;
}

/**
 * Lays the cubes out in the block's volume (spec 11.1) and plans each one's
 * flight: outward from the impact, down onto the roof below or, past the
 * tower's edge, onto the plot or the ground.
 */
function planCubes(
  grid: ReturnType<typeof rubbleGrid>,
  base: number,
  height: number,
  surface: number,
  impact: THREE.Vector3,
  overhead: boolean,
  rng: () => number,
): Cube[] {
  const cubes: Cube[] = [];
  const half = BLOCK_FOOTPRINT / 2;
  const cell = BLOCK_FOOTPRINT / grid.across;
  const layer = height / grid.up;
  const out = new THREE.Vector3();
  for (let k = 0; k < grid.up; k++) {
    for (let i = 0; i < grid.across; i++) {
      for (let j = 0; j < grid.across; j++) {
        const x = -half + (i + 0.5) * cell;
        const z = -half + (j + 0.5) * cell;
        const y = base + (k + 0.5) * layer;
        out.set(x - impact.x, 0, z - impact.z);
        if (out.lengthSq() < 1e-6) out.set(rng() - 0.5, 0, -1);
        out.normalize().multiplyScalar(0.25 + rng() * 0.9);
        const fall = 0.22 + rng() * 0.14;
        const dx = out.x + (rng() - 0.5) * 0.3;
        const dz = out.z + (rng() - 0.5) * 0.3;
        const fx = x + dx;
        const fz = z + dz;
        const edge = grid.edge * 0.92;
        let restY: number;
        if (Math.abs(fx) <= half && Math.abs(fz) <= half) restY = surface + edge / 2 + (rng() < 0.3 ? edge : 0);
        else if (Math.abs(fx) <= PLOT_SIZE / 2 && Math.abs(fz) <= PLOT_SIZE / 2) restY = PLOT_TOP_Y + edge / 2;
        else if (fx > PLOT_SIZE / 2 && Math.abs(fz) <= 4) restY = DEPOT_TOP_Y + edge / 2;
        else restY = GROUND_Y + edge / 2;
        cubes.push({
          x,
          y,
          z,
          dx,
          dz,
          restY,
          // Nothing hops up into a block that stands right above.
          hop: overhead ? 0 : 0.1 + rng() * 0.2,
          fall,
          spinX: (rng() - 0.5) * 14,
          spinZ: (rng() - 0.5) * 14,
          loaded: rng() < 0.3,
        });
      }
    }
  }
  return cubes;
}

/** Reduced motion (spec 9.7): the block fades out over 0.25 s. */
function fadeOut(scene: JobScene, proxy: BlockMesh, pose: BlockPose, token: SwatchToken): Timeline {
  const props = scene.crew.props;
  const c = new Choreography(scene.crew);
  proxy.root.visible = false;
  props.setup(token, pose.baseY, pose.height, true);
  props.setReveal(Infinity);
  props.setFade(1);
  props.cladding.cap.visible = true;
  c.step(0, CALM_SECONDS, (t) => props.setFade(1 - t), linear);
  return c.tl;
}

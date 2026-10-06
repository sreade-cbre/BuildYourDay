import * as THREE from 'three';
import { DEPOT_TOP_Y } from '../Ground';
import { PLOT_TOP_Y } from '../Foundation';
import { materials } from '../materials';
import { Bulldozer } from './Bulldozer';
import { Crane } from './Crane';
import { DumpTruck } from './DumpTruck';
import { Dust } from './Dust';
import { Excavator, ARM_REST } from './Excavator';
import { GuardRail } from './GuardRail';
import { Hoist } from './Hoist';
import { MixerTruck } from './MixerTruck';
import { box } from './parts';
import { SiteProps } from './props';
import { Rubble } from './Rubble';
import { Scaffold } from './Scaffold';
import { Worker } from './Worker';
import { WreckingBall } from './WreckingBall';

// Everyone and everything that works on the site (spec section 10): a pool of
// eight workers, the machines parked at the depot facing the plot, the shared
// tower crane with its wrecking ball, the hoist, the guard rail, the
// scaffold, dust, rubble, and the temporary props. Also holds the site
// layout, chosen so no machine path crosses the tower or another lane.

export const WORKER_POOL = 8;

/** Ground height for everything that moves; the depot sits 0.02 lower. */
export const SITE_Y = PLOT_TOP_Y;

export interface Spot {
  x: number;
  z: number;
  heading: number;
}

/** Parking spots on the depot. Heading -PI/2 faces the plot. */
export const HOMES = {
  bulldozer: { x: 10.2, z: 0.4, heading: -Math.PI / 2 },
  excavator: { x: 8.4, z: 1.6, heading: -Math.PI / 2 },
  // The mixer parks cab out, so its chute end can back toward the slab.
  mixer: { x: 8.4, z: -0.8, heading: Math.PI / 2 },
  // Cab out too, so it backs its bed up to the rubble.
  dump: { x: 8.9, z: 3.25, heading: Math.PI / 2 },
} satisfies Record<string, Spot>;

/** Where machines work during a build. */
export const WORK_SPOTS = {
  excavator: { x: 3.9, z: 1.6, heading: -Math.PI / 2 },
  mixer: { x: 4.05, z: -0.8, heading: Math.PI / 2 },
  // Beside the front right corner, where rubble can be loaded.
  dump: { x: 3.7, z: 3.15, heading: Math.PI / 2 },
} satisfies Record<string, Spot>;

/**
 * The hoist stands at the tower's rear left edge (spec 10.3), outside the
 * scaffold line, with its cage riding on the plot side of the mast.
 */
export const HOIST = { x: -2.78, mastZ: -2.3, cageZ: -1.86 };

/** The crane stands at the depot's plot side, close enough to reach the whole footprint. */
export const CRANE_BASE = { x: 5.3, z: -2.0 };
/** The stack of beams and panels the crane lifts from. */
export const STACK = { x: 7.6, z: -2.45, top: DEPOT_TOP_Y + 0.32 };
/** Workers come and go through the depot's front corner. */
export const WORKER_GATE = { x: 5.4, z: 3.6 };
/** Lane the bulldozer returns along, behind the tower. */
export const BACK_LANE_Z = -3.4;
/** Parked crane: jib out over the depot, trolley in, hook up. */
export const CRANE_PARK = { slew: 0, trolley: 2.2 };

export class Crew {
  readonly root = new THREE.Group();
  readonly workers: Worker[] = [];
  readonly bulldozer = new Bulldozer();
  readonly excavator = new Excavator();
  readonly mixer = new MixerTruck();
  readonly dumpTruck = new DumpTruck();
  readonly crane: Crane;
  readonly ball = new WreckingBall();
  readonly hoist = new Hoist(HOIST.x, HOIST.mastZ, HOIST.cageZ);
  readonly rail = new GuardRail();
  readonly scaffold = new Scaffold();
  readonly dust = new Dust();
  readonly rubble = new Rubble();
  readonly props = new SiteProps();
  private towerTop = 0;

  constructor() {
    this.root.name = 'crew';
    for (let i = 0; i < WORKER_POOL; i++) {
      const worker = new Worker(`worker-${i}`);
      this.workers.push(worker);
      this.root.add(worker.root);
    }
    this.crane = new Crane(CRANE_BASE.x, DEPOT_TOP_Y, CRANE_BASE.z);
    this.root.add(
      this.bulldozer.root,
      this.excavator.root,
      this.mixer.root,
      this.dumpTruck.root,
      this.crane.root,
      this.ball.root,
      this.hoist.root,
      this.rail.root,
      this.scaffold.root,
      this.dust.root,
      this.rubble.mesh,
      this.props.root,
      this.createStack(),
    );
    this.park();
  }

  /** A low pile of beams and panels on the depot, for the crane to lift from. */
  private createStack(): THREE.Group {
    const stack = new THREE.Group();
    stack.name = 'stack';
    stack.position.set(STACK.x, DEPOT_TOP_Y, STACK.z);
    const dark = materials.solid('slateDark');
    for (let layer = 0; layer < 3; layer++) {
      for (let i = 0; i < 3; i++) {
        const beam = box(1.8, 0.08, 0.08, dark);
        beam.position.set(0, 0.04 + layer * 0.09, -0.12 + i * 0.12);
        stack.add(beam);
      }
    }
    const panels = box(1.2, 0.05, 0.5, materials.solid('slatePale'));
    panels.position.set(0, 0.3, 0);
    stack.add(panels);
    return stack;
  }

  /** Mast top for the current tower: 3 units above it, never below 3. */
  get parkedMastTop(): number {
    return Math.max(3, this.towerTop + 3);
  }

  /** Keeps the idle crane's jib above the tower (spec 10.4). */
  setTowerTop(y: number): void {
    this.towerTop = y;
  }

  /**
   * Sends everyone home: machines parked, workers hidden, props and dust
   * cleared, the crane's jib swung back over the depot. The mast keeps its
   * height; jobs tween it, and settleMast sets it once the site is idle. A
   * job that needs no crane or no machines leaves them be, since the block
   * under way may be using them.
   */
  park(parts: { crane?: boolean; machines?: boolean } = {}): void {
    for (const worker of this.workers) worker.hide();
    if (parts.machines !== false) this.parkMachines();
    if (parts.crane !== false) this.crane.setPose({ ...CRANE_PARK, hookY: this.crane.hookCeiling });
    this.ball.hide();
    this.hoist.hide();
    this.rail.hide();
    this.scaffold.hide();
    this.dust.clear();
    this.rubble.hide();
    this.props.reset();
  }

  /** The bulldozer, excavator, mixer, and dump truck back on the depot, facing the plot. */
  parkMachines(): void {
    const { bulldozer, excavator, mixer, dump } = HOMES;
    this.bulldozer.drive({ ...bulldozer, distance: 0 }, SITE_Y);
    this.bulldozer.setBlade(0);
    this.excavator.drive({ ...excavator, distance: 0 }, SITE_Y);
    this.excavator.setArm(ARM_REST);
    this.mixer.drive({ ...mixer, distance: 0 }, SITE_Y);
    this.mixer.setDrum(0);
    this.dumpTruck.drive({ ...dump, distance: 0 }, SITE_Y);
    this.dumpTruck.setTilt(0);
    this.dumpTruck.setLoad(0);
  }

  /** Stands the mast 3 units over the tower top, never below 3 (spec 10.4). */
  settleMast(): void {
    this.crane.setMastTop(this.parkedMastTop);
    this.crane.setPose({ ...CRANE_PARK, hookY: this.crane.hookCeiling });
  }

  /** Per frame: worker poses and dust. Returns true while dust is in the air. */
  update(dt: number): boolean {
    for (const worker of this.workers) worker.update(dt);
    return this.dust.update(dt);
  }
}

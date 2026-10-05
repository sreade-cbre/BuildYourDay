import * as THREE from 'three';
import { DEPOT_TOP_Y } from '../Ground';
import { PLOT_TOP_Y } from '../Foundation';
import { materials } from '../materials';
import { Bulldozer } from './Bulldozer';
import { Crane } from './Crane';
import { Dust } from './Dust';
import { Excavator, ARM_REST } from './Excavator';
import { MixerTruck } from './MixerTruck';
import { box } from './parts';
import { SiteProps } from './props';
import { Scaffold } from './Scaffold';
import { Worker } from './Worker';

// Everyone and everything that works on the site (spec section 10): a pool of
// eight workers, the machines parked at the depot facing the plot, the shared
// tower crane, the scaffold, dust, and the temporary props. Also holds the
// site layout, chosen so no machine path crosses the tower or another lane.

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
} satisfies Record<string, Spot>;

/** Where machines work during a build. */
export const WORK_SPOTS = {
  excavator: { x: 3.9, z: 1.6, heading: -Math.PI / 2 },
  mixer: { x: 4.05, z: -0.8, heading: Math.PI / 2 },
} satisfies Record<string, Spot>;

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
  readonly crane: Crane;
  readonly scaffold = new Scaffold();
  readonly dust = new Dust();
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
      this.crane.root,
      this.scaffold.root,
      this.dust.root,
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

  /** Sends everyone home: machines parked, workers hidden, props and dust cleared. */
  park(): void {
    for (const worker of this.workers) worker.hide();
    const { bulldozer, excavator, mixer } = HOMES;
    this.bulldozer.drive({ ...bulldozer, distance: 0 }, SITE_Y);
    this.bulldozer.setBlade(0);
    this.excavator.drive({ ...excavator, distance: 0 }, SITE_Y);
    this.excavator.setArm(ARM_REST);
    this.mixer.drive({ ...mixer, distance: 0 }, SITE_Y);
    this.mixer.setDrum(0);
    this.crane.setMastTop(this.parkedMastTop);
    this.crane.setPose({ ...CRANE_PARK, hookY: this.crane.hookCeiling });
    this.scaffold.hide();
    this.dust.clear();
    this.props.reset();
  }

  /** Per frame: worker poses and dust. Returns true while dust is in the air. */
  update(dt: number): boolean {
    for (const worker of this.workers) worker.update(dt);
    return this.dust.update(dt);
  }
}

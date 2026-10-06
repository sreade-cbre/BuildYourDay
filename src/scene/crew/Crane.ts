import * as THREE from 'three';
import { materials } from '../materials';
import { box, pointInParent } from './parts';

// The shared tower crane (spec section 10.4). It stands at the depot; the
// slewing unit turns the jib, the trolley runs along it, and the hook hangs
// on a cable whose length always comes from the hook's height, so the cable
// can never float free of the hook.

export const JIB_LENGTH = 8;
/** The trolley's closest and farthest reach from the mast. */
export const TROLLEY_MIN = 1.1;
export const TROLLEY_MAX = 7.8;
const BASE_HEIGHT = 0.3;
/** The jib sits this far above the mast top; the trolley hangs below it. */
const TROLLEY_DROP = 0.18;
/** Distance from the hook block's top to where a carried item hangs. */
export const HOOK_HANG = 0.28;

export interface CranePose {
  /** Jib direction, radians about y; 0 points the jib along +x. */
  slew: number;
  /** Trolley distance from the mast. */
  trolley: number;
  /** World height of the hook block. */
  hookY: number;
}

const cableGeometry = new THREE.CylinderGeometry(0.01, 0.01, 1, 6).translate(0, -0.5, 0);
/** Sling legs at most: four for a bundle or a roof. */
const LEGS = 4;
const DOWN = new THREE.Vector3(0, -1, 0);

export class Crane {
  readonly root = new THREE.Group();
  private readonly mast: THREE.Mesh;
  private readonly slewing = new THREE.Group();
  private readonly trolley: THREE.Mesh;
  private readonly cable: THREE.Mesh;
  private readonly hookBlock: THREE.Mesh;
  /** Where carried items hang. Children of this move with the hook. */
  readonly hook = new THREE.Group();
  private readonly legs: THREE.Mesh[] = [];
  private mastHeight = 3;
  private pose: CranePose = { slew: 0, trolley: 2, hookY: 2 };

  constructor(readonly baseX: number, readonly baseY: number, readonly baseZ: number) {
    this.root.name = 'crane';
    this.root.position.set(baseX, baseY, baseZ);
    const dark = materials.solid('slateDark');
    const blue = materials.solid('blue');

    const base = box(1.0, BASE_HEIGHT, 1.0, dark);
    base.position.y = BASE_HEIGHT / 2;
    this.mast = box(0.3, 1, 0.3, dark);
    this.root.add(base, this.mast);

    const unit = box(0.45, 0.25, 0.45, dark);
    const cab = box(0.3, 0.26, 0.3, materials.solid('blueDark'));
    cab.position.set(0.32, -0.04, 0.3);
    this.slewing.add(unit, cab);

    // A lattice look from three thin chords (spec 10.4).
    for (const [y, z] of [[0, 0.09], [0, -0.09], [0.16, 0]] as const) {
      const chord = box(JIB_LENGTH, 0.04, 0.04, blue);
      chord.position.set(JIB_LENGTH / 2, 0.15 + y, z);
      this.slewing.add(chord);
    }
    const counterJib = box(2.5, 0.2, 0.2, blue);
    counterJib.position.set(-1.25, 0.22, 0);
    const counterweight = box(0.5, 0.4, 0.35, materials.solid('navy'));
    counterweight.position.set(-2.1, 0.05, 0);
    this.slewing.add(counterJib, counterweight);

    this.trolley = box(0.3, 0.2, 0.3, dark);
    this.cable = new THREE.Mesh(cableGeometry, dark);
    this.hookBlock = box(0.15, 0.2, 0.15, dark);
    this.slewing.add(this.trolley, this.cable, this.hookBlock, this.hook);
    for (let i = 0; i < LEGS; i++) {
      const leg = new THREE.Mesh(cableGeometry, dark);
      leg.visible = false;
      this.legs.push(leg);
      this.slewing.add(leg);
    }
    this.root.add(this.slewing);
    this.setMastHeight(3);
    this.setPose(this.pose);
  }

  /** World height of the mast top, where the jib turns. */
  get pivotY(): number {
    return this.baseY + BASE_HEIGHT + this.mastHeight;
  }

  /** Highest the hook can be: right under the trolley. */
  get hookCeiling(): number {
    return this.pivotY + 0.15 - TROLLEY_DROP - 0.35;
  }

  /** Sets the mast so its top stands at a world height. */
  setMastTop(worldY: number): void {
    this.setMastHeight(worldY - this.baseY - BASE_HEIGHT);
  }

  private setMastHeight(height: number): void {
    this.mastHeight = Math.max(1, height);
    this.mast.scale.y = this.mastHeight;
    this.mast.position.y = BASE_HEIGHT + this.mastHeight / 2;
    this.slewing.position.y = BASE_HEIGHT + this.mastHeight;
    this.setPose(this.pose);
  }

  get currentPose(): CranePose {
    return { ...this.pose };
  }

  setPose(pose: CranePose): void {
    this.pose = { ...pose };
    this.slewing.rotation.y = pose.slew;
    const trolley = Math.min(TROLLEY_MAX, Math.max(TROLLEY_MIN, pose.trolley));
    const trolleyY = 0.15 - TROLLEY_DROP;
    this.trolley.position.set(trolley, trolleyY, 0);
    const hookLocalY = Math.min(trolleyY - 0.3, pose.hookY - this.pivotY);
    const cableLength = trolleyY - 0.1 - (hookLocalY + 0.1);
    this.cable.position.set(trolley, trolleyY - 0.1, 0);
    this.cable.scale.y = Math.max(0.01, cableLength);
    this.hookBlock.position.set(trolley, hookLocalY, 0);
    this.hook.position.set(trolley, hookLocalY - HOOK_HANG, 0);
    for (const leg of this.legs) leg.visible = false;
  }

  /**
   * Rigs a load: sling legs from the hook block down to its lifting points,
   * given in the crew's frame. Set it after the pose; a new pose takes the
   * slings off.
   */
  setSling(points: ReadonlyArray<THREE.Vector3>): void {
    const start = new THREE.Vector3(this.hookBlock.position.x, this.hookBlock.position.y - 0.1, 0);
    const cos = Math.cos(this.pose.slew);
    const sin = Math.sin(this.pose.slew);
    const leg = new THREE.Vector3();
    this.legs.forEach((mesh, i) => {
      const point = points[i];
      mesh.visible = point !== undefined;
      if (!point) return;
      // Into the slewing unit's frame: from the mast top, turned back by the slew.
      const dx = point.x - this.root.position.x;
      const dz = point.z - this.root.position.z;
      leg.set(dx * cos - dz * sin, point.y - this.root.position.y - this.slewing.position.y, dx * sin + dz * cos).sub(start);
      const length = leg.length();
      mesh.position.copy(start);
      mesh.quaternion.setFromUnitVectors(DOWN, leg.divideScalar(Math.max(1e-6, length)));
      mesh.scale.set(0.8, Math.max(0.01, length), 0.8);
    });
  }

  /** The slew and trolley that put the hook over a world point. */
  aim(x: number, z: number): { slew: number; trolley: number } {
    const dx = x - this.baseX;
    const dz = z - this.baseZ;
    return { slew: Math.atan2(-dz, dx), trolley: Math.hypot(dx, dz) };
  }

  /** Where a carried item hangs, in the crew's frame. */
  hookPoint(target: THREE.Vector3): THREE.Vector3 {
    return pointInParent(this.root, this.hook, target);
  }
}

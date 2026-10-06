import * as THREE from 'three';
import { materials } from '../materials';
import { Wheel, box, glass, pointInParent, type Drive } from './parts';

// Dump truck (spec 10.3): cab, chassis, four wheels, and an open bed on a
// `tilt` pivot at its back edge. The cab faces +z, like the mixer truck.

/** Height of the bed floor above the ground. */
const BED_FLOOR = 0.5;

export class DumpTruck {
  readonly root = new THREE.Group();
  private readonly tilt = new THREE.Group();
  private readonly wheels: Wheel[] = [];
  private readonly bedCenter = new THREE.Object3D();
  /** Spoil in the bed. */
  private readonly load: THREE.Mesh;

  constructor() {
    this.root.name = 'dump-truck';
    const chassis = box(0.72, 0.14, 1.9, materials.solid('slateDark'));
    chassis.position.y = 0.3;
    this.root.add(chassis);
    for (const side of [-1, 1]) {
      for (const z of [-0.62, 0.62]) {
        const wheel = new Wheel(0.17, 0.12);
        wheel.root.position.set(0.4 * side, 0.17, z);
        this.wheels.push(wheel);
        this.root.add(wheel.root);
      }
    }
    const cab = box(0.74, 0.5, 0.5, materials.solid('blueDark'));
    cab.position.set(0, 0.62, 0.66);
    const window = box(0.76, 0.2, 0.38, glass());
    window.position.set(0, 0.72, 0.7);
    this.root.add(cab, window);

    // The bed hinges at its back edge, so tilting lifts its front.
    this.tilt.position.set(0, BED_FLOOR - 0.03, -0.92);
    const blue = materials.solid('blue');
    const length = 1.1;
    const parts: Array<[number, number, number, number, number, number]> = [
      [0.8, 0.05, length, 0, 0.0, length / 2],
      [0.04, 0.3, length, -0.38, 0.15, length / 2],
      [0.04, 0.3, length, 0.38, 0.15, length / 2],
      [0.8, 0.3, 0.04, 0, 0.15, length],
      [0.8, 0.26, 0.04, 0, 0.13, 0.02],
    ];
    for (const [w, h, d, x, y, z] of parts) {
      const part = box(w, h, d, blue);
      part.position.set(x, y, z);
      this.tilt.add(part);
    }
    this.bedCenter.position.set(0, 0.12, length / 2);
    this.tilt.add(this.bedCenter);
    this.load = box(0.68, 0.24, 0.96, materials.solid('slate'));
    this.load.position.set(0, 0.02, length / 2);
    this.load.visible = false;
    this.tilt.add(this.load);
    this.root.add(this.tilt);
  }

  /** How full the bed is, from empty (0) to heaped (1). */
  setLoad(share: number): void {
    this.load.visible = share > 0.01;
    this.load.scale.y = Math.max(0.01, share);
    this.load.position.y = 0.02 + 0.12 * share;
  }

  /** Bed angle in radians; positive lifts the front to dump out the back. */
  setTilt(angle: number): void {
    this.tilt.rotation.x = -angle;
  }

  /** A point a little above the bed floor, where loads come to rest, in the crew's frame. */
  bedPoint(target: THREE.Vector3): THREE.Vector3 {
    return pointInParent(this.root, this.bedCenter, target);
  }

  drive(state: Drive, y: number): void {
    this.root.position.set(state.x, y, state.z);
    this.root.rotation.y = state.heading;
    for (const wheel of this.wheels) wheel.roll(state.distance);
  }
}

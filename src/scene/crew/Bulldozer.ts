import * as THREE from 'three';
import { materials } from '../materials';
import { Wheel, box, glass, type Drive } from './parts';

// Bulldozer (spec 10.3): two tracks, body, cab, and a blade on a pivot that
// lowers 15 degrees for the pass. Faces +z.

export class Bulldozer {
  readonly root = new THREE.Group();
  private readonly blade = new THREE.Group();
  private readonly wheels: Wheel[] = [];

  constructor() {
    this.root.name = 'bulldozer';
    const dark = materials.solid('slateDark');
    for (const side of [-1, 1]) {
      const track = box(0.26, 0.28, 1.35, dark);
      track.position.set(0.37 * side, 0.14, 0);
      this.root.add(track);
      for (const z of [-0.45, 0, 0.45]) {
        const wheel = new Wheel(0.1, 0.04);
        wheel.root.position.set(0.52 * side, 0.14, z);
        this.wheels.push(wheel);
        this.root.add(wheel.root);
      }
    }
    const body = box(0.56, 0.32, 1.0, materials.solid('blue'));
    body.position.set(0, 0.42, -0.05);
    const cab = box(0.46, 0.36, 0.46, materials.solid('blueDark'));
    cab.position.set(0, 0.76, -0.22);
    const window = box(0.48, 0.16, 0.36, glass());
    window.position.set(0, 0.8, -0.2);
    this.root.add(body, cab, window);

    this.blade.position.set(0, 0.32, 0.5);
    const arms = box(0.62, 0.06, 0.34, materials.solid('navy'));
    arms.position.set(0, 0, 0.14);
    const plate = box(1.1, 0.34, 0.07, materials.solid('blue'));
    plate.position.set(0, -0.04, 0.32);
    const edge = box(1.12, 0.05, 0.08, materials.solid('slatePale'));
    edge.position.set(0, -0.2, 0.33);
    this.blade.add(arms, plate, edge);
    this.root.add(this.blade);
  }

  /** Blade from 0 (raised) to 1 (lowered 15 degrees). */
  setBlade(down: number): void {
    this.blade.rotation.x = (15 * Math.PI / 180) * down;
  }

  drive(state: Drive, y: number): void {
    this.root.position.set(state.x, y, state.z);
    this.root.rotation.y = state.heading;
    for (const wheel of this.wheels) wheel.roll(state.distance);
  }
}

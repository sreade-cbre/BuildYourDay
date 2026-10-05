import * as THREE from 'three';
import { materials } from '../materials';
import { Wheel, box, glass, type Drive } from './parts';

// Mixer truck (spec 10.3): cab, chassis, four wheels, a tapered drum on a
// pivot that turns while on site, and a chute at the back. The cab faces +z,
// so the chute end backs toward the slab.

export class MixerTruck {
  readonly root = new THREE.Group();
  private readonly drum = new THREE.Group();
  private readonly wheels: Wheel[] = [];

  constructor() {
    this.root.name = 'mixer-truck';
    const chassis = box(0.72, 0.14, 2.2, materials.solid('slateDark'));
    chassis.position.y = 0.3;
    this.root.add(chassis);
    for (const side of [-1, 1]) {
      for (const z of [-0.72, 0.72]) {
        const wheel = new Wheel(0.17, 0.12);
        wheel.root.position.set(0.4 * side, 0.17, z);
        this.wheels.push(wheel);
        this.root.add(wheel.root);
      }
    }
    const cab = box(0.74, 0.5, 0.52, materials.solid('blueDark'));
    cab.position.set(0, 0.62, 0.8);
    const window = box(0.76, 0.2, 0.4, glass());
    window.position.set(0, 0.72, 0.84);
    this.root.add(cab, window);

    // The drum leans up toward the back, like a real mixer.
    this.drum.position.set(0, 0.78, -0.25);
    this.drum.rotation.x = -0.18;
    const shell = new THREE.Mesh(
      new THREE.CylinderGeometry(0.26, 0.4, 1.25, 14).rotateX(Math.PI / 2),
      materials.solid('blue'),
    );
    shell.castShadow = true;
    const stripe = box(0.06, 0.06, 1.2, materials.solid('navy'));
    stripe.position.set(0, 0.33, 0);
    this.drum.add(shell, stripe);
    this.root.add(this.drum);

    const chute = box(0.16, 0.05, 0.5, materials.solid('slatePale'));
    chute.position.set(0, 0.5, -1.3);
    chute.rotation.x = 0.45;
    this.root.add(chute);
  }

  /** Drum rotation in radians. */
  setDrum(angle: number): void {
    this.drum.children[0]!.rotation.z = angle;
    this.drum.children[1]!.position.set(Math.sin(angle) * 0.33, Math.cos(angle) * 0.33, 0);
  }

  drive(state: Drive, y: number): void {
    this.root.position.set(state.x, y, state.z);
    this.root.rotation.y = state.heading;
    for (const wheel of this.wheels) wheel.roll(state.distance);
  }
}

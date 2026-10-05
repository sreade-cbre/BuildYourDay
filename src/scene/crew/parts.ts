import * as THREE from 'three';
import { materials } from '../materials';

// Shared building pieces for the machines.

export function box(w: number, h: number, d: number, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * A wheel that turns about its x axle. The spoke makes the rotation visible.
 * `roll(distance)` turns it to match ground travel.
 */
export class Wheel {
  readonly root = new THREE.Group();
  private readonly hub = new THREE.Group();

  constructor(readonly radius: number, width: number) {
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 12).rotateZ(Math.PI / 2), materials.solid('slateDark'));
    tire.castShadow = true;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(width + 0.01, radius * 1.4, radius * 0.25), materials.solid('slatePale'));
    this.hub.add(tire, spoke);
    this.root.add(this.hub);
  }

  roll(distance: number): void {
    this.hub.rotation.x = distance / this.radius;
  }
}

/** A machine's place on the ground and how far it has rolled. */
export interface Drive {
  x: number;
  z: number;
  heading: number;
  /** Total distance traveled, for turning wheels. Negative when reversing. */
  distance: number;
}

/**
 * A part's position in the frame of the object's parent, the crew. Jobs place
 * everything in that frame, so the whole crew can work on another plot.
 */
export function pointInParent(root: THREE.Object3D, part: THREE.Object3D, target: THREE.Vector3): THREE.Vector3 {
  part.getWorldPosition(target);
  return root.parent ? root.parent.worldToLocal(target) : target;
}

/** Window glass for cabs. */
export function glass(): THREE.Material {
  return materials.solid('bluePale', 0.4);
}

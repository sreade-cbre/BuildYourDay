import * as THREE from 'three';
import { materials } from './materials';

// The foundation of the first block (spec sections 7.2 and 9.4): a slab whose
// top is world y = 0, resting on four footing pads that stand on the plot.

export const SLAB_SIZE = 4.2;
export const SLAB_THICKNESS = 0.2;
export const PAD_SIZE = 0.6;
export const PAD_HEIGHT = 0.15;
/** Top of the plot surface the footings stand on. */
export const PLOT_TOP_Y = -0.3;

export const slabGeometry = new THREE.BoxGeometry(SLAB_SIZE, SLAB_THICKNESS, SLAB_SIZE).translate(0, -SLAB_THICKNESS / 2, 0);
export const slabEdgeGeometry = new THREE.EdgesGeometry(slabGeometry);
export const padGeometry = new THREE.BoxGeometry(PAD_SIZE, PAD_HEIGHT, PAD_SIZE).translate(0, PAD_HEIGHT / 2, 0);
/** Where the four footing pads sit, at the slab corners. */
export const PAD_OFFSET = SLAB_SIZE / 2 - PAD_SIZE / 2;

export class Foundation {
  readonly root = new THREE.Group();
  readonly slab: THREE.Mesh;
  readonly pads: THREE.Mesh[] = [];

  constructor() {
    this.root.name = 'foundation';

    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      const pad = new THREE.Mesh(padGeometry, materials.solid('slatePale'));
      pad.position.set(x * PAD_OFFSET, PLOT_TOP_Y, z * PAD_OFFSET);
      pad.castShadow = true;
      pad.receiveShadow = true;
      this.pads.push(pad);
      this.root.add(pad);
    }

    this.slab = new THREE.Mesh(slabGeometry, materials.solid('slatePale'));
    this.slab.castShadow = true;
    this.slab.receiveShadow = true;
    const edges = new THREE.LineSegments(slabEdgeGeometry, materials.line('slateLight'));
    this.slab.add(edges);
    this.root.add(this.slab);
  }
}

import * as THREE from 'three';
import { materials } from '../materials';

// Guard rail (spec 9.4 phase 1 and 11.1): posts and two rails in slateDark
// around a roof edge, right outside the roof cap's overhang. It rises out of
// the roof and sinks back into it.

/** Half the rail's square, right outside the 4.1 roof cap. */
export const RAIL_HALF = 2.12;
const POST_HEIGHT = 0.36;
const POST_SPACING = 1.05;
const RAIL_HEIGHTS = [0.17, 0.34];

const postGeometry = new THREE.BoxGeometry(0.045, POST_HEIGHT, 0.045).translate(0, POST_HEIGHT / 2, 0);
const railGeometry = new THREE.BoxGeometry(1, 0.03, 0.03);

export class GuardRail {
  readonly root = new THREE.Group();

  constructor() {
    this.root.name = 'guard-rail';
    const material = materials.solid('slateDark');
    const intervals = Math.round((RAIL_HALF * 2) / POST_SPACING);
    const posts: Array<[number, number]> = [];
    for (let i = 0; i < intervals; i++) {
      const t = -RAIL_HALF + (i * RAIL_HALF * 2) / intervals;
      posts.push([t, RAIL_HALF], [RAIL_HALF, -t], [-t, -RAIL_HALF], [-RAIL_HALF, t]);
    }
    const postMesh = new THREE.InstancedMesh(postGeometry, material, posts.length);
    const matrix = new THREE.Matrix4();
    posts.forEach(([x, z], i) => postMesh.setMatrixAt(i, matrix.makeTranslation(x, 0, z)));
    postMesh.castShadow = true;

    const railMesh = new THREE.InstancedMesh(railGeometry, material, RAIL_HEIGHTS.length * 4);
    const across = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const along = new THREE.Quaternion();
    const scale = new THREE.Vector3(RAIL_HALF * 2, 1, 1);
    let index = 0;
    for (const y of RAIL_HEIGHTS) {
      for (const [x, z, rotation] of [
        [0, RAIL_HALF, along],
        [0, -RAIL_HALF, along],
        [RAIL_HALF, 0, across],
        [-RAIL_HALF, 0, across],
      ] as const) {
        railMesh.setMatrixAt(index++, matrix.compose(new THREE.Vector3(x, y, z), rotation, scale));
      }
    }
    railMesh.castShadow = true;
    this.root.add(postMesh, railMesh);
    this.root.visible = false;
  }

  /** Stands the rail on a roof at a world height, risen from 0 (flat) to 1. */
  show(y: number, rise: number): void {
    this.root.visible = rise > 0.001;
    this.root.position.y = y;
    this.root.scale.y = Math.max(0.001, rise);
  }

  hide(): void {
    this.root.visible = false;
  }
}

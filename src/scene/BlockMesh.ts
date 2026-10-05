import * as THREE from 'three';
import { BLOCK_FOOTPRINT } from '../core/layout';
import type { BlockId, SwatchToken } from '../core/model';
import { materials } from './materials';

// One time block as a box (spec section 8.3). The group sits at the block's
// base, so scaling in y grows the block upward. Geometry is shared by every
// block: a unit tall box scaled to the block height.

export const CAP_SIZE = 4.1;
export const CAP_THICKNESS = 0.08;
// Lifts the cap a hair above the block's top face so the two never z-fight.
const CAP_LIFT = 0.002;

const bodyGeometry = new THREE.BoxGeometry(BLOCK_FOOTPRINT, 1, BLOCK_FOOTPRINT).translate(0, 0.5, 0);
const edgeGeometry = new THREE.EdgesGeometry(bodyGeometry);
const capGeometry = new THREE.BoxGeometry(CAP_SIZE, CAP_THICKNESS, CAP_SIZE).translate(0, -CAP_THICKNESS / 2, 0);

export class BlockMesh {
  readonly root = new THREE.Group();
  readonly body: THREE.Mesh;
  readonly edges: THREE.LineSegments;
  /** Roof cap, set into the top of the block in the category's dark variant. */
  readonly cap: THREE.Mesh;
  private token: SwatchToken;
  private heightValue = 1;

  constructor(readonly blockId: BlockId, token: SwatchToken) {
    this.token = token;
    this.body = new THREE.Mesh(bodyGeometry, materials.blockBody(token));
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.body.userData.blockId = blockId;

    this.edges = new THREE.LineSegments(edgeGeometry, materials.blockEdges(token));

    this.cap = new THREE.Mesh(capGeometry, materials.blockCap(token));
    this.cap.castShadow = true;
    this.cap.receiveShadow = true;
    this.cap.userData.blockId = blockId;

    this.root.name = `block:${blockId}`;
    this.root.add(this.body, this.edges, this.cap);
    this.setHeight(1);
  }

  get height(): number {
    return this.heightValue;
  }

  get baseY(): number {
    return this.root.position.y;
  }

  setHeight(height: number): void {
    this.heightValue = height;
    this.body.scale.y = height;
    this.edges.scale.y = height;
    this.cap.position.y = height + CAP_LIFT;
  }

  setBaseY(y: number): void {
    this.root.position.y = y;
  }

  setColor(token: SwatchToken): void {
    if (token === this.token) return;
    this.token = token;
    this.body.material = materials.blockBody(token);
    this.edges.material = materials.blockEdges(token);
    this.cap.material = materials.blockCap(token);
  }

  /** Removes the block from the scene. Geometry and materials are shared, so nothing is freed. */
  dispose(): void {
    this.root.removeFromParent();
  }
}

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

/** How a block should look right now. */
export interface BlockAppearance {
  token: SwatchToken;
  /** Outside a legend highlight. */
  dimmed: boolean;
  /** Under the pointer. */
  hovered: boolean;
  /** Outside the day window. */
  hatched: boolean;
}

function sameAppearance(a: BlockAppearance, b: BlockAppearance): boolean {
  return a.token === b.token && a.dimmed === b.dimmed && a.hovered === b.hovered && a.hatched === b.hatched;
}

export class BlockMesh {
  readonly root = new THREE.Group();
  readonly body: THREE.Mesh;
  readonly edges: THREE.LineSegments;
  /** Roof cap, set into the top of the block in the category's dark variant. */
  readonly cap: THREE.Mesh;
  private appearance: BlockAppearance;
  private heightValue = 1;

  constructor(readonly blockId: BlockId, token: SwatchToken) {
    this.appearance = { token, dimmed: false, hovered: false, hatched: false };
    this.body = new THREE.Mesh(bodyGeometry, materials.blockBody(token));
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.body.userData.blockId = blockId;

    this.edges = new THREE.LineSegments(edgeGeometry, materials.blockEdges(token));

    this.cap = new THREE.Mesh(capGeometry, materials.blockCap(token));
    this.cap.castShadow = true;
    this.cap.receiveShadow = true;
    this.cap.userData.blockId = blockId;
    this.cap.userData.roof = true;

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

  /** Picks the shared materials for a look. Cheap to call every sync. */
  setAppearance(next: BlockAppearance): void {
    if (sameAppearance(next, this.appearance)) return;
    this.appearance = { ...next };
    const variant = next.dimmed ? 'dimmed' : 'normal';
    // A hatched block reads as slateLight, whatever its category.
    const token: SwatchToken = next.hatched ? 'slateLight' : next.token;
    this.body.material = next.hatched ? materials.hatched(variant) : materials.blockBody(token, variant);
    this.edges.material = materials.blockEdges(token, next.dimmed ? 'dimmed' : next.hovered ? 'hover' : 'normal');
    this.cap.material = materials.blockCap(token, variant);
    // Translucent boxes should not shade the blocks around them.
    this.body.castShadow = !next.dimmed;
    this.cap.castShadow = !next.dimmed;
  }

  /** Removes the block from the scene. Geometry and materials are shared, so nothing is freed. */
  dispose(): void {
    this.root.removeFromParent();
  }
}

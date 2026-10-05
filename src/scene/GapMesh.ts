import * as THREE from 'three';
import { BLOCK_FOOTPRINT } from '../core/layout';
import type { TimeRange } from '../core/model';
import { materials } from './materials';

// Free time as a hollow dashed frame with a faint inner volume (spec 8.4).

// Keeps the gap's horizontal edges off the neighboring blocks' edges.
const INSET = 0.01;
const FILL_FOOTPRINT = BLOCK_FOOTPRINT - 0.04;
const fillGeometry = new THREE.BoxGeometry(FILL_FOOTPRINT, 1, FILL_FOOTPRINT).translate(0, 0.5, 0);

export class GapMesh {
  readonly root = new THREE.Group();
  private readonly lineGeometry: THREE.EdgesGeometry;
  private readonly fill: THREE.Mesh;

  constructor(readonly range: TimeRange, baseY: number, height: number) {
    const inner = Math.max(0.001, height - INSET * 2);
    // Dashes are laid out in local units, so each gap gets its own outline
    // instead of a scaled shared one.
    const box = new THREE.BoxGeometry(BLOCK_FOOTPRINT, inner, BLOCK_FOOTPRINT).translate(0, inner / 2 + INSET, 0);
    this.lineGeometry = new THREE.EdgesGeometry(box);
    box.dispose();

    const lines = new THREE.LineSegments(this.lineGeometry, materials.gapLines());
    lines.computeLineDistances();

    this.fill = new THREE.Mesh(fillGeometry, materials.gapFill());
    this.fill.position.y = INSET;
    this.fill.scale.y = inner;
    this.fill.userData.gap = { ...range };

    this.root.name = `gap:${range.start}-${range.end}`;
    this.root.position.y = baseY;
    this.root.add(lines, this.fill);
  }

  /** The faint fill that pointer picking tests against. */
  get pickTarget(): THREE.Object3D {
    return this.fill;
  }

  setHovered(hovered: boolean): void {
    this.fill.material = materials.gapFill(hovered);
  }

  dispose(): void {
    this.lineGeometry.dispose();
    this.root.removeFromParent();
  }
}

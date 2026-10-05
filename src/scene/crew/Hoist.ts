import * as THREE from 'three';
import { materials } from '../materials';
import { box } from './parts';

// Hoist (spec 10.3): a thin mast fixed to the tower's rear left edge and a
// cage, a wire box with a floor, that rides along it. Workers ride standing
// on the cage floor; the jobs place them there frame by frame.

const CAGE_WIDTH = 0.6;
const CAGE_HEIGHT = 0.7;

const cageGeometry = new THREE.EdgesGeometry(
  new THREE.BoxGeometry(CAGE_WIDTH, CAGE_HEIGHT, CAGE_WIDTH).translate(0, CAGE_HEIGHT / 2, 0),
);

export class Hoist {
  readonly root = new THREE.Group();
  private readonly mast: THREE.Mesh;
  private readonly cage = new THREE.Group();
  private mastBase = 0;

  /** The mast stands at (x, mastZ); the cage rides beside it at (x, cageZ). */
  constructor(readonly x: number, readonly mastZ: number, readonly cageZ: number) {
    this.root.name = 'hoist';
    this.mast = box(0.1, 1, 0.1, materials.solid('slateDark'));
    this.mast.position.set(x, 0, mastZ);
    const floor = box(CAGE_WIDTH, 0.04, CAGE_WIDTH, materials.solid('slatePale'));
    floor.position.y = -0.02;
    const frame = new THREE.LineSegments(cageGeometry, materials.line('slateDark'));
    // Arms that tie the cage to the mast.
    const arm = box(0.05, 0.05, Math.abs(cageZ - mastZ), materials.solid('slateDark'));
    arm.position.set(0, CAGE_HEIGHT * 0.5, (mastZ - cageZ) / 2);
    this.cage.add(floor, frame, arm);
    this.cage.position.set(x, 0, cageZ);
    this.root.add(this.mast, this.cage);
    this.root.visible = false;
  }

  /** Mast from the ground at `baseY` up to `topY`, risen from 0 (nothing) to 1. */
  setMast(baseY: number, topY: number, rise: number): void {
    this.root.visible = rise > 0.001;
    this.mastBase = baseY;
    const height = Math.max(0.01, (topY - baseY) * rise);
    this.mast.scale.y = height;
    this.mast.position.y = baseY + height / 2;
  }

  /** Puts the cage floor at a world height. */
  setCage(y: number): void {
    this.cage.position.y = Math.max(this.mastBase, y);
  }

  /** Where a rider stands: slot 0 to 2 across the cage floor. */
  riderSpot(slot: number): { x: number; z: number } {
    const offsets = [[-0.13, 0.1], [0.13, -0.08], [0.1, 0.14]] as const;
    const [dx, dz] = offsets[slot % offsets.length]!;
    return { x: this.x + dx, z: this.cageZ + dz };
  }

  get cageY(): number {
    return this.cage.position.y;
  }

  hide(): void {
    this.root.visible = false;
  }
}

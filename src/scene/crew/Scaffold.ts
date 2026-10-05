import * as THREE from 'three';
import { BLOCK_FOOTPRINT } from '../../core/layout';
import { materials } from '../materials';

// Scaffold cage (spec 9.4 phase 4): vertical tubes every 1.0 unit around the
// block, 0.35 out from its faces, ledgers at every floor, and planks on the
// two faces the default camera sees. Two InstancedMesh objects (tubes and
// planks) hold every piece, sorted bottom to top, so raising or striking the
// scaffold only changes how many instances draw.

/** Distance from a block face to the tube line. */
export const SCAFFOLD_OFFSET = 0.35;
const HALF = BLOCK_FOOTPRINT / 2 + SCAFFOLD_OFFSET;
const POST_SPACING = 1.0;
/** Very tall blocks group floors so the instance count stays bounded. */
const MAX_LEVELS = 24;
const TUBE_CAPACITY = 24 * MAX_LEVELS + 4 * (MAX_LEVELS + 1);
const PLANK_CAPACITY = 2 * MAX_LEVELS;
const PLANK_DEPTH = SCAFFOLD_OFFSET - 0.04;

export type ScaffoldFace = 'front' | 'left';

interface Piece {
  matrix: THREE.Matrix4;
  bottom: number;
}

const tubeGeometry = new THREE.CylinderGeometry(0.025, 0.025, 1, 6);
const plankGeometry = new THREE.BoxGeometry(1, 0.03, 1);

export class Scaffold {
  readonly root = new THREE.Group();
  private readonly tubes: THREE.InstancedMesh;
  private readonly planks: THREE.InstancedMesh;
  private tubeBottoms: number[] = [];
  private plankBottoms: number[] = [];
  private levels: number[] = [];

  constructor() {
    this.root.name = 'scaffold';
    this.tubes = new THREE.InstancedMesh(tubeGeometry, materials.solid('slateDark'), TUBE_CAPACITY);
    this.planks = new THREE.InstancedMesh(plankGeometry, materials.solid('slatePale'), PLANK_CAPACITY);
    for (const mesh of [this.tubes, this.planks]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.count = 0;
      // Instances change with every job, so skip culling against stale bounds.
      mesh.frustumCulled = false;
      this.root.add(mesh);
    }
    this.root.visible = false;
  }

  /** Lays out the cage around a block from `baseY` up `height`, in `floors` levels. */
  layout(baseY: number, height: number, floors: number): void {
    const levelCount = Math.max(1, Math.min(floors, MAX_LEVELS));
    const step = height / levelCount;
    this.levels = Array.from({ length: levelCount + 1 }, (_, i) => baseY + i * step);

    const tubes: Piece[] = [];
    const planks: Piece[] = [];
    const m = () => new THREE.Matrix4();
    const posts = this.postPositions();
    for (let level = 0; level < levelCount; level++) {
      const bottom = this.levels[level]!;
      for (const [x, z] of posts) {
        tubes.push({ bottom, matrix: m().compose(new THREE.Vector3(x, bottom + step / 2, z), new THREE.Quaternion(), new THREE.Vector3(1, step, 1)) });
      }
    }
    const alongX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    const alongZ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    for (const y of this.levels) {
      for (const [x, z, rotation] of [
        [0, HALF, alongX],
        [0, -HALF, alongX],
        [HALF, 0, alongZ],
        [-HALF, 0, alongZ],
      ] as const) {
        tubes.push({ bottom: y, matrix: m().compose(new THREE.Vector3(x, y, z), rotation, new THREE.Vector3(1, HALF * 2, 1)) });
      }
    }
    const plankCenter = BLOCK_FOOTPRINT / 2 + PLANK_DEPTH / 2 + 0.02;
    for (let level = 0; level < levelCount; level++) {
      const y = this.levels[level]! + 0.015;
      planks.push({ bottom: y, matrix: m().compose(new THREE.Vector3(0, y, plankCenter), new THREE.Quaternion(), new THREE.Vector3(HALF * 2, 1, PLANK_DEPTH)) });
      planks.push({ bottom: y, matrix: m().compose(new THREE.Vector3(-plankCenter, y, 0), new THREE.Quaternion(), new THREE.Vector3(PLANK_DEPTH, 1, HALF * 2)) });
    }

    this.tubeBottoms = this.fill(this.tubes, tubes);
    this.plankBottoms = this.fill(this.planks, planks);
  }

  private postPositions(): Array<[number, number]> {
    const intervals = Math.max(1, Math.round((HALF * 2) / POST_SPACING));
    const points: Array<[number, number]> = [];
    for (let i = 0; i < intervals; i++) {
      const t = -HALF + (i * HALF * 2) / intervals;
      points.push([t, HALF], [HALF, -t], [-t, -HALF], [-HALF, t]);
    }
    return points;
  }

  private fill(mesh: THREE.InstancedMesh, pieces: Piece[]): number[] {
    pieces.sort((a, b) => a.bottom - b.bottom);
    pieces.forEach((piece, i) => mesh.setMatrixAt(i, piece.matrix));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = 0;
    return pieces.map((piece) => piece.bottom);
  }

  /** Shows every piece that starts below a world height. */
  revealTo(height: number): void {
    this.root.visible = true;
    this.tubes.count = countBelow(this.tubeBottoms, height);
    this.planks.count = countBelow(this.plankBottoms, height);
  }

  /** World heights of the plank levels, bottom first. */
  get plankLevels(): readonly number[] {
    return this.levels.slice(0, -1).map((y) => y + 0.03);
  }

  /** Where a worker stands on a face at a level, `along` from -1 to 1 across it. */
  standPoint(face: ScaffoldFace, level: number, along: number): { x: number; y: number; z: number; heading: number } {
    const y = this.plankLevels[Math.min(level, this.plankLevels.length - 1)] ?? 0;
    const offset = BLOCK_FOOTPRINT / 2 + 0.16;
    const span = along * (HALF - 0.4);
    // Workers face the block.
    return face === 'front' ? { x: span, y, z: offset, heading: Math.PI } : { x: -offset, y, z: span, heading: Math.PI / 2 };
  }

  hide(): void {
    this.root.visible = false;
    this.tubes.count = 0;
    this.planks.count = 0;
  }
}

function countBelow(sorted: number[], height: number): number {
  let n = 0;
  while (n < sorted.length && sorted[n]! < height - 1e-6) n++;
  return n;
}

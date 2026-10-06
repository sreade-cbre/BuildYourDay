import * as THREE from 'three';
import { YARD, type StockKind } from '../../anim/sitePlan';
import type { SwatchToken } from '../../core/model';
import { DEPOT_TOP_Y } from '../Ground';
import { materials } from '../materials';

// The stockyard on the depot, next to the crane, where the materials for the
// building wait: columns and beams on bearers, deck sheets, facade panels in
// the block's color, and bundles of rebar, formwork, and scaffold. Each rack
// shows what is left, so it runs down as the crane picks from it and fills
// up again as deliveries are unloaded.

export type { StockKind };

interface Rack {
  mesh: THREE.InstancedMesh;
  /** Pieces in a layer, and how many the rack shows at most. */
  across: number;
  max: number;
  center: THREE.Vector3;
  layer: number;
}

const unit = new THREE.BoxGeometry(1, 1, 1);
const Y = DEPOT_TOP_Y + 0.06;

export class Stockyard {
  readonly root = new THREE.Group();
  private readonly racks: Record<StockKind, Rack>;
  private readonly counts: Record<StockKind, number> = { column: 0, beam: 0, deck: 0, panel: 0 };
  /** Where bundles wait to go up, always stocked. */
  readonly bundlePoint = new THREE.Vector3(9.4, DEPOT_TOP_Y + 0.32, -1.95);

  constructor() {
    this.root.name = 'stockyard';
    const steel = materials.solid('slateDark');
    const make = (kind: StockKind, material: THREE.Material, size: [number, number, number], center: [number, number], across: number, layers: number, gap: number): Rack => {
      const max = across * layers;
      const mesh = new THREE.InstancedMesh(unit, material, max);
      const matrix = new THREE.Matrix4();
      for (let i = 0; i < max; i++) {
        const layer = Math.floor(i / across);
        const k = i % across;
        const z = center[1] + (k - (across - 1) / 2) * gap;
        matrix.compose(new THREE.Vector3(center[0], Y + size[1] / 2 + layer * (size[1] + 0.01), z), new THREE.Quaternion(), new THREE.Vector3(...size));
        mesh.setMatrixAt(i, matrix);
      }
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.count = 0;
      mesh.name = `stock-${kind}`;
      this.root.add(mesh);
      return { mesh, across, max, center: new THREE.Vector3(center[0], Y, center[1]), layer: size[1] + 0.01 };
    };
    this.racks = {
      column: make('column', steel, [0.9, 0.12, 0.12], [6.75, -2.6], 4, 3, 0.16),
      beam: make('beam', steel, [1.6, 0.1, 0.1], [7.7, -2.55], 4, 3, 0.14),
      deck: make('deck', materials.solid('slatePale'), [0.95, 0.03, 0.6], [8.6, -2.05], 1, 10, 0),
      panel: make('panel', materials.blockBody('navy'), [1.1, 0.04, 0.5], [7.75, -1.75], 1, 8, 0),
    };
    // Bearers under the steel, and the standing pile of bundles.
    const bearer = materials.solid('slate');
    for (const [x, z, w] of [[6.45, -2.6, 0.1], [7.05, -2.6, 0.1], [7.2, -2.55, 0.1], [8.2, -2.55, 0.1]] as const) {
      const b = new THREE.Mesh(unit, bearer);
      b.scale.set(w, 0.06, 0.7);
      b.position.set(x, DEPOT_TOP_Y + 0.03, z);
      b.receiveShadow = true;
      this.root.add(b);
    }
    for (const [dx, dz, material] of [[-0.25, 0, steel], [0.25, 0, materials.solid('slatePale')], [0, 0, materials.solid('slateLight', 0.6)]] as const) {
      const pile = new THREE.Mesh(unit, material);
      const top = dx === 0 && dz === 0;
      pile.scale.set(0.45, 0.14, 0.4);
      pile.position.set(this.bundlePoint.x + dx, DEPOT_TOP_Y + 0.07 + (top ? 0.14 : 0), this.bundlePoint.z + dz);
      pile.castShadow = true;
      this.root.add(pile);
    }
    this.setToken('navy');
    this.fill();
  }

  /** The panels are the block's facade, in its category's color. */
  setToken(token: SwatchToken): void {
    this.racks.panel.mesh.material = materials.blockBody(token);
  }

  /** Shows how many of a piece are left. Deck sheets come two to a bundle. */
  setCount(kind: StockKind, count: number): void {
    const shown = kind === 'deck' ? count * 2 : count;
    if (this.counts[kind] === shown) return;
    this.counts[kind] = shown;
    const rack = this.racks[kind];
    rack.mesh.count = Math.max(0, Math.min(rack.max, shown));
  }

  /** The yard as a block opens and ends: well stocked. */
  fill(): void {
    for (const kind of Object.keys(YARD) as StockKind[]) this.setCount(kind, YARD[kind].opening);
  }

  /** Where the crane's hook picks up the top piece of a rack, holding `count` pieces or what it shows now. */
  pickPoint(kind: StockKind, count?: number): THREE.Vector3 {
    const rack = this.racks[kind];
    const shown = count === undefined ? this.counts[kind] : kind === 'deck' ? count * 2 : count;
    const layers = Math.max(1, Math.ceil(Math.min(rack.max, shown) / rack.across));
    const target = new THREE.Vector3();
    return target.copy(rack.center).setY(Y + layers * rack.layer + 0.02);
  }

  /** Where the crew takes loads off a parked delivery truck's bed. */
  get unloadPoint(): THREE.Vector3 {
    return new THREE.Vector3(6.7, DEPOT_TOP_Y, -0.1);
  }
}

/** A delivery truck with a flat bed of steel and panels. Its cab faces +z. */
export class FlatbedTruck {
  readonly root = new THREE.Group();
  private readonly wheels: Array<{ hub: THREE.Group; radius: number }> = [];
  private readonly loads: THREE.Mesh[] = [];

  constructor() {
    this.root.name = 'flatbed';
    const dark = materials.solid('slateDark');
    const part = (w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(unit, material);
      mesh.scale.set(w, h, d);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
      return mesh;
    };
    part(0.72, 0.14, 2.5, dark, 0, 0.3, -0.1);
    part(0.8, 0.06, 1.75, materials.solid('slate'), 0, 0.4, -0.45);
    part(0.78, 0.52, 0.55, materials.solid('blueDark'), 0, 0.6, 0.9);
    part(0.8, 0.2, 0.4, materials.solid('bluePale', 0.4), 0, 0.72, 0.95);
    // Headboard behind the cab.
    part(0.8, 0.3, 0.05, dark, 0, 0.58, 0.45);
    const tire = new THREE.CylinderGeometry(0.17, 0.17, 0.12, 12).rotateZ(Math.PI / 2);
    for (const z of [0.85, -0.55, -1.0]) {
      for (const side of [-1, 1]) {
        const hub = new THREE.Group();
        hub.position.set(0.4 * side, 0.17, z);
        const mesh = new THREE.Mesh(tire, dark);
        mesh.castShadow = true;
        hub.add(mesh);
        this.root.add(hub);
        this.wheels.push({ hub, radius: 0.17 });
      }
    }
    // The load: beams, columns, and a pallet of panels.
    this.loads.push(
      part(0.62, 0.12, 1.5, dark, -0.12, 0.49, -0.5),
      part(0.3, 0.1, 1.1, dark, 0.2, 0.48, -0.4),
      part(0.6, 0.18, 0.5, materials.solid('slatePale'), 0, 0.64, -0.8),
    );
    this.root.visible = false;
  }

  /** How much of the load is still on the bed, from none (0) to all (1). */
  setLoad(share: number): void {
    this.loads.forEach((load, i) => {
      load.visible = share > i / this.loads.length;
    });
  }

  drive(state: { x: number; z: number; heading: number; distance: number }, y: number): void {
    this.root.visible = true;
    this.root.position.set(state.x, y, state.z);
    this.root.rotation.y = state.heading;
    for (const wheel of this.wheels) wheel.hub.rotation.x = state.distance / wheel.radius;
  }

  hide(): void {
    this.root.visible = false;
  }
}


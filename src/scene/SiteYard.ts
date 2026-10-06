import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { tokens } from '../brand/tokens';
import { FONT_BODY, context2d, font } from './canvasText';
import { PLOT_TOP_Y } from './Foundation';
import { materials } from './materials';

// The construction site around the tower's base. Site set-up is always
// there: a mesh fence round the plot and depot with an entrance gate and
// signs, stacked site cabins with a stair, toilets, a skip, a lighting tower
// with its generator, and cones at the gate. Once the plot has been worked,
// it also has a gravel haul road and ring road with tyre tracks, a spoil
// heap, and materials laid down out of the crew's way: pallets of blocks,
// timber, cement, rebar, pipes, and formwork. Everything is built once from
// a few shared shapes, then merged into one mesh per material so the whole
// yard costs a handful of draw calls, and is only shown or hidden.

const GROUND_Y = PLOT_TOP_Y - 0.3;
const DEPOT_Y = PLOT_TOP_Y - 0.02;
/** Mesh fence panels: about 3.5 m long and 2 m tall at the workers' scale. */
const PANEL_LENGTH = 1.15;
const PANEL_HEIGHT = 0.62;
/** Where the site entrance opens in the fence along the depot's front. */
const GATE = { from: 6.0, to: 8.4, z: 4.35 };

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitCylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
const unitCone = new THREE.ConeGeometry(0.5, 1, 12);
const unitPlane = new THREE.PlaneGeometry(1, 1);

interface Placed {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  ry?: number;
  rx?: number;
  rz?: number;
}

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, p: Placed, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(p.x, p.y, p.z);
  m.scale.set(p.sx, p.sy, p.sz);
  m.rotation.set(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

/** A box resting on `y`, centered on x and z. */
function block(material: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0): THREE.Mesh {
  return mesh(unitBox, material, { x, y: y + sy / 2, z, sx, sy, sz, ry });
}

/** Instances of one shape, from a list of placements. */
function instanced(geometry: THREE.BufferGeometry, material: THREE.Material, items: Placed[], shadow = true): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geometry, material, Math.max(1, items.length));
  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  items.forEach((p, i) => {
    q.setFromEuler(e.set(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0));
    matrix.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.sx, p.sy, p.sz));
    m.setMatrixAt(i, matrix);
  });
  m.count = items.length;
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

/**
 * Merges a group's plain meshes into one per material. Instanced meshes and
 * signs, which have a face of their own, stay as they are.
 */
function bake(group: THREE.Group): THREE.Group {
  group.updateMatrixWorld(true);
  const inverse = group.matrixWorld.clone().invert();
  const byMaterial = new Map<THREE.Material, { geometries: THREE.BufferGeometry[]; shadow: boolean }>();
  const merged: THREE.Mesh[] = [];
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh || Array.isArray(object.material)) return;
    const geometry = object.geometry.clone().applyMatrix4(inverse.clone().multiply(object.matrixWorld));
    const entry = byMaterial.get(object.material) ?? { geometries: [], shadow: false };
    entry.geometries.push(geometry);
    entry.shadow ||= object.castShadow;
    byMaterial.set(object.material, entry);
    merged.push(object);
  });
  for (const object of merged) object.removeFromParent();
  // Groups left empty, such as the gate leaves, go too.
  for (const child of [...group.children]) if (child instanceof THREE.Group && child.children.length === 0) child.removeFromParent();
  for (const [material, { geometries, shadow }] of byMaterial) {
    const geometry = mergeGeometries(geometries);
    for (const part of geometries) part.dispose();
    if (!geometry) continue;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

/** A sign board with words on its face, white on a brand color. */
function sign(text: string, width: number, height: number, color: 'navy' | 'blue'): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = Math.round((512 * height) / width);
  const ctx = context2d(canvas);
  ctx.fillStyle = tokens[color];
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = tokens.white;
  ctx.lineWidth = 6;
  ctx.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);
  ctx.fillStyle = tokens.white;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = text.split('\n');
  let size = Math.floor((canvas.height * 0.62) / lines.length);
  ctx.font = font(size, FONT_BODY, true);
  while (lines.some((line) => ctx.measureText(line).width > canvas.width - 60) && size > 12) {
    size -= 2;
    ctx.font = font(size, FONT_BODY, true);
  }
  lines.forEach((line, i) => ctx.fillText(line, canvas.width / 2, canvas.height * ((i + 0.5) / lines.length)));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const face = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.8, metalness: 0 });
  const edge = materials.solid(color);
  const board = new THREE.Mesh(unitBox, [edge, edge, edge, edge, face, edge]);
  board.scale.set(width, height, 0.03);
  board.castShadow = true;
  return board;
}

export class SiteYard {
  readonly root = new THREE.Group();
  /** What only a worked plot has: roads, tracks, the spoil heap, and the laydown. */
  private readonly worked = new THREE.Group();
  private isWorked = true;

  constructor() {
    this.root.name = 'site-yard';
    this.worked.name = 'worked-plot';
    this.root.add(...[this.createFence(), this.createCabins(), this.createWelfare(), this.createLighting(), this.createGate()].map(bake), this.worked);
    this.worked.add(this.createRoads(), bake(this.createLaydown()));
    this.setWorked(false);
  }

  /** Shows what a worked plot has, once the site has been cleared. */
  setWorked(worked: boolean): void {
    if (worked === this.isWorked) return;
    this.isWorked = worked;
    this.worked.visible = worked;
  }

  // Set-up

  /** A mesh fence round the plot and the depot, open at the entrance. */
  private createFence(): THREE.Group {
    const fence = new THREE.Group();
    fence.name = 'fence';
    const route: Array<[number, number]> = [
      [-5.35, -5.35],
      [5.35, -5.35],
      [5.35, -4.35],
      [11.35, -4.35],
      [11.35, 4.35],
      [GATE.to, GATE.z],
    ];
    const front: Array<[number, number]> = [
      [GATE.from, GATE.z],
      [5.35, 4.35],
      [5.35, 5.35],
      [-5.35, 5.35],
      [-5.35, -5.35],
    ];
    const tubes: Placed[] = [];
    const panes: Placed[] = [];
    const feet: Placed[] = [];
    for (const path of [route, front]) {
      for (let i = 1; i < path.length; i++) {
        const [ax, az] = path[i - 1]!;
        const [bx, bz] = path[i]!;
        const length = Math.hypot(bx - ax, bz - az);
        const panels = Math.max(1, Math.round(length / PANEL_LENGTH));
        const heading = Math.atan2(bz - az, bx - ax);
        for (let k = 0; k < panels; k++) {
          const u0 = k / panels;
          const u1 = (k + 1) / panels;
          const x0 = ax + (bx - ax) * u0;
          const z0 = az + (bz - az) * u0;
          const x1 = ax + (bx - ax) * u1;
          const z1 = az + (bz - az) * u1;
          const cx = (x0 + x1) / 2;
          const cz = (z0 + z1) / 2;
          const w = length / panels;
          const y = GROUND_Y + 0.05;
          // Frame: top and bottom rails, an upright at the start. The next
          // panel's upright closes this one.
          tubes.push({ x: cx, y: y + PANEL_HEIGHT, z: cz, sx: w, sy: 0.025, sz: 0.025, ry: -heading });
          tubes.push({ x: cx, y: y + 0.02, z: cz, sx: w, sy: 0.025, sz: 0.025, ry: -heading });
          tubes.push({ x: x0, y: y + PANEL_HEIGHT / 2, z: z0, sx: 0.028, sy: PANEL_HEIGHT, sz: 0.028 });
          if (k === panels - 1) tubes.push({ x: x1, y: y + PANEL_HEIGHT / 2, z: z1, sx: 0.028, sy: PANEL_HEIGHT, sz: 0.028 });
          panes.push({ x: cx, y: y + PANEL_HEIGHT / 2, z: cz, sx: w - 0.02, sy: PANEL_HEIGHT - 0.03, sz: 1, ry: -heading });
          feet.push({ x: x0, y: GROUND_Y + 0.03, z: z0, sx: 0.24, sy: 0.06, sz: 0.09, ry: -heading });
        }
      }
    }
    const paneMaterial = new THREE.MeshStandardMaterial({
      color: materials.solid('slateLight').color,
      roughness: 0.9,
      metalness: 0,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    fence.add(
      instanced(unitBox, materials.solid('slateLight', 0.6), tubes),
      instanced(unitPlane, paneMaterial, panes, false),
      instanced(unitBox, materials.solid('slate'), feet),
    );
    // Safety notice on the front fence, facing the road.
    const notice = sign('Hard hats and hi-vis\nmust be worn on site', 1.0, 0.42, 'blue');
    notice.position.set(1.6, GROUND_Y + 0.05 + PANEL_HEIGHT * 0.55, 5.38);
    fence.add(notice);
    return fence;
  }

  /** The entrance: gates swung open out to the road, a sign, and cones. */
  private createGate(): THREE.Group {
    const gate = new THREE.Group();
    gate.name = 'gate';
    const tube = materials.solid('slateLight', 0.6);
    const width = (GATE.to - GATE.from) / 2;
    for (const [hinge, side] of [[GATE.from, 1], [GATE.to, -1]] as const) {
      const leaf = new THREE.Group();
      leaf.position.set(hinge, GROUND_Y + 0.05, GATE.z);
      // Swung out to the road, about 110 degrees from where it closes.
      const open = { x: -side * 0.34, z: 0.94 };
      leaf.rotation.y = -Math.atan2(open.z, open.x);
      leaf.add(mesh(unitBox, tube, { x: width / 2, y: PANEL_HEIGHT, z: 0, sx: width, sy: 0.025, sz: 0.025 }));
      leaf.add(mesh(unitBox, tube, { x: width / 2, y: 0.03, z: 0, sx: width, sy: 0.025, sz: 0.025 }));
      leaf.add(mesh(unitBox, tube, { x: width, y: PANEL_HEIGHT / 2, z: 0, sx: 0.028, sy: PANEL_HEIGHT, sz: 0.028 }));
      leaf.add(mesh(unitBox, tube, { x: width * 0.5, y: PANEL_HEIGHT / 2, z: 0, sx: 0.025, sy: PANEL_HEIGHT, sz: 0.025, rz: Math.atan2(PANEL_HEIGHT, width) }));
      gate.add(leaf);
    }
    const entrance = sign('Site entrance', 1.0, 0.3, 'navy');
    entrance.position.set(9.6, GROUND_Y + 0.05 + PANEL_HEIGHT * 0.62, GATE.z + 0.03);
    gate.add(entrance);
    // Cones mark the way in.
    const cones: Placed[] = [];
    const bands: Placed[] = [];
    for (const [x, z] of [[GATE.from - 0.2, 4.85], [GATE.from + 0.5, 5.25], [GATE.to - 0.5, 5.25], [GATE.to + 0.2, 4.85]] as const) {
      cones.push({ x, y: GROUND_Y + 0.13, z, sx: 0.14, sy: 0.26, sz: 0.14 });
      bands.push({ x, y: GROUND_Y + 0.15, z, sx: 0.07, sy: 0.04, sz: 0.07 });
      bands.push({ x, y: GROUND_Y + 0.01, z, sx: 0.2, sy: 0.02, sz: 0.2 });
    }
    gate.add(instanced(unitCone, materials.hazard(), cones), instanced(unitCylinder, materials.solid('white'), bands));
    return gate;
  }

  /** Two site cabins stacked at the back of the depot, the upper one reached by a stair. */
  private createCabins(): THREE.Group {
    const cabins = new THREE.Group();
    cabins.name = 'cabins';
    const body = materials.solid('slatePale');
    const frame = materials.solid('slateDark');
    const window = materials.solid('bluePale', 0.4);
    const door = materials.solid('navy');
    const length = 2.9;
    const height = 0.78;
    const depth = 0.95;
    const cx = 9.5;
    const cz = -3.45;
    for (const level of [0, 1]) {
      const y = DEPOT_Y + level * (height + 0.02);
      cabins.add(block(body, cx, y, cz, length, height, depth));
      // Corner posts and rails.
      for (const dx of [-1, 1]) for (const dz of [-1, 1]) cabins.add(block(frame, cx + (dx * length) / 2, y, cz + (dz * depth) / 2, 0.06, height, 0.06));
      cabins.add(block(frame, cx, y + height - 0.04, cz + depth / 2, length, 0.05, 0.05));
      cabins.add(block(frame, cx, y, cz + depth / 2, length, 0.05, 0.05));
      // Windows along the front, and a door.
      for (const wx of [-0.95, -0.25, 0.45]) cabins.add(block(window, cx + wx, y + 0.34, cz + depth / 2 + 0.005, 0.42, 0.24, 0.02));
      cabins.add(block(door, cx + 1.1, y + 0.04, cz + depth / 2 + 0.005, 0.3, 0.62, 0.02));
    }
    // The stair up the front to the upper door, with a landing and a rail.
    const stairX = cx + 1.1;
    const run = 0.95;
    const rise = height + 0.02;
    const stair = mesh(unitBox, frame, { x: stairX - run / 2 + 0.05, y: DEPOT_Y + rise / 2, z: cz + depth / 2 + 0.28, sx: Math.hypot(run, rise), sy: 0.05, sz: 0.36, rz: Math.atan2(rise, run) });
    cabins.add(stair);
    cabins.add(block(frame, stairX + 0.1, DEPOT_Y + rise - 0.03, cz + depth / 2 + 0.28, 0.5, 0.04, 0.4));
    cabins.add(block(frame, stairX + 0.33, DEPOT_Y + rise, cz + depth / 2 + 0.47, 0.03, 0.3, 0.03));
    cabins.add(block(frame, stairX + 0.1, DEPOT_Y + rise + 0.28, cz + depth / 2 + 0.47, 0.5, 0.025, 0.025));
    cabins.add(block(frame, stairX + 0.33, DEPOT_Y, cz + depth / 2 + 0.47, 0.03, rise, 0.03));
    const office = sign('Site office', 0.62, 0.17, 'navy');
    office.position.set(cx - 0.3, DEPOT_Y + rise + height - 0.14, cz + depth / 2 + 0.02);
    cabins.add(office);
    return cabins;
  }

  /** Toilets at the depot's front corner and a skip by the crane. */
  private createWelfare(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'welfare';
    const blue = materials.solid('blue');
    const roof = materials.solid('white');
    const door = materials.solid('blueDark');
    for (const x of [10.3, 10.68]) {
      group.add(block(blue, x, DEPOT_Y, 3.55, 0.34, 0.74, 0.34));
      group.add(block(roof, x, DEPOT_Y + 0.74, 3.55, 0.37, 0.04, 0.37));
      group.add(block(door, x, DEPOT_Y + 0.04, 3.55 + 0.172, 0.24, 0.6, 0.01));
    }
    // The skip, its ends sloped, with rubble showing over the rim.
    const skipX = 6.1;
    const skipZ = -3.6;
    group.add(block(blue, skipX, DEPOT_Y, skipZ, 0.8, 0.34, 0.56));
    for (const side of [-1, 1]) {
      group.add(mesh(unitBox, blue, { x: skipX + side * 0.47, y: DEPOT_Y + 0.2, z: skipZ, sx: 0.06, sy: 0.4, sz: 0.56, rz: side * 0.45 }));
    }
    const rubble = materials.solid('slate');
    const pale = materials.solid('slatePale');
    for (const [dx, dz, s, m] of [[-0.2, -0.1, 0.16, rubble], [0.05, 0.12, 0.14, pale], [0.22, -0.06, 0.15, rubble], [-0.02, -0.14, 0.12, pale]] as const) {
      group.add(mesh(unitBox, m, { x: skipX + dx, y: DEPOT_Y + 0.34, z: skipZ + dz, sx: s, sy: s, sz: s, ry: dx * 4, rx: dz * 3 }));
    }
    return group;
  }

  /** A lighting tower on its trailer at the back corner of the plot, with its generator. */
  private createLighting(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'lighting';
    const dark = materials.solid('slateDark');
    const x = -4.55;
    const z = -4.5;
    const y = PLOT_TOP_Y;
    group.add(block(materials.solid('slate'), x, y + 0.08, z, 0.55, 0.22, 0.34));
    for (const dx of [-0.18, 0.18]) group.add(mesh(unitCylinder, dark, { x: x + dx, y: y + 0.08, z: z + 0.19, sx: 0.16, sy: 0.04, sz: 0.16, rx: Math.PI / 2 }));
    group.add(mesh(unitCylinder, dark, { x, y: y + 1.35, z, sx: 0.05, sy: 2.3, sz: 0.05 }));
    group.add(block(dark, x, y + 2.48, z, 0.62, 0.05, 0.06));
    const lamp = materials.solid('white');
    for (const dx of [-0.24, -0.08, 0.08, 0.24]) group.add(block(lamp, x + dx, y + 2.32, z + 0.03, 0.12, 0.14, 0.06));
    // Outriggers.
    for (const angle of [0.6, 2.5, -0.6, -2.5]) group.add(mesh(unitBox, dark, { x: x + Math.cos(angle) * 0.3, y: y + 0.03, z: z + Math.sin(angle) * 0.3, sx: 0.4, sy: 0.03, sz: 0.04, ry: -angle }));
    // The generator that feeds it.
    group.add(block(dark, -3.85, y, -4.6, 0.52, 0.06, 0.32));
    group.add(block(materials.solid('blue'), -3.85, y + 0.06, -4.6, 0.48, 0.26, 0.28));
    return group;
  }

  // The worked plot

  /** Gravel haul road and ring road, and the tracks the machines leave. */
  private createRoads(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'roads';
    const gravel = materials.solid('slateLight', 1);
    const y = PLOT_TOP_Y + 0.003;
    const outer = 3.55;
    const inner = 2.65;
    const band = outer - inner;
    const mid = (outer + inner) / 2;
    const pieces: Placed[] = [
      { x: 0, y, z: mid, sx: outer * 2, sy: 0.006, sz: band },
      { x: 0, y, z: -mid, sx: outer * 2, sy: 0.006, sz: band },
      { x: mid, y, z: 0, sx: band, sy: 0.006, sz: inner * 2 },
      { x: -mid, y, z: 0, sx: band, sy: 0.006, sz: inner * 2 },
      // The haul road from the depot to the machines' work spots.
      { x: (outer + 5) / 2, y, z: 1.15, sx: 5 - outer, sy: 0.006, sz: 5.1 },
    ];
    group.add(instanced(unitBox, gravel, pieces, false));
    const tracks: Placed[] = [];
    for (const z of [-1.05, -0.55, 1.25, 1.95, 2.85, 3.45]) tracks.push({ x: 3.7, y: y + 0.004, z, sx: 2.6, sy: 0.004, sz: 0.07 });
    // Wheel ruts round the front of the ring road.
    for (const x of [-2.2, -0.4, 1.4]) tracks.push({ x, y: y + 0.004, z: 3.25, sx: 1.4, sy: 0.004, sz: 0.05 });
    group.add(instanced(unitBox, materials.solid('slate', 1), tracks, false));
    return group;
  }

  /** Materials laid down on the plot's edges, clear of the ring road and the machines. */
  private createLaydown(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'laydown';
    const y = PLOT_TOP_Y;
    const pallet = materials.solid('slate');
    const blocks = materials.solid('slatePale');
    const dark = materials.solid('slateDark');
    const white = materials.solid('white');

    // Pallets of blocks down the left side, and one at the bay where loads are dropped.
    for (const [x, z] of [[-4.35, -2.5], [-4.35, -1.8], [-4.35, -1.1], [2.5, 3.85]] as const) {
      group.add(block(pallet, x, y, z, 0.5, 0.06, 0.5));
      group.add(block(blocks, x, y + 0.06, z, 0.44, 0.26, 0.44));
      group.add(block(dark, x, y + 0.06, z, 0.45, 0.27, 0.02));
    }
    // Timber on bearers.
    for (const dz of [-0.4, 0.4]) group.add(block(dark, -4.35, y, 0.45 + dz, 0.6, 0.04, 0.06));
    for (let layer = 0; layer < 4; layer++) {
      for (let i = 0; i < 5; i++) group.add(block(blocks, -4.59 + i * 0.12, y + 0.04 + layer * 0.035, 0.45, 0.1, 0.03, 1.05));
    }
    // A pallet of cement bags.
    group.add(block(pallet, -4.35, y, 1.55, 0.5, 0.06, 0.5));
    for (let layer = 0; layer < 3; layer++) {
      for (const [dx, dz] of [[-0.11, -0.12], [0.11, -0.12], [-0.11, 0.12], [0.11, 0.12]] as const) {
        group.add(block(white, -4.35 + dx, y + 0.06 + layer * 0.07, 1.55 + dz, 0.2, 0.065, 0.22, layer % 2 ? Math.PI / 2 : 0));
      }
    }
    // Rebar bundles and a stack of pipes behind the tower.
    for (const dx of [-0.5, 0.5]) group.add(block(dark, -2.4 + dx, y, -4.45, 0.08, 0.05, 0.5));
    for (const dz of [-0.14, 0.14]) group.add(block(dark, -2.4, y + 0.05, -4.45 + dz, 1.5, 0.07, 0.16));
    for (const [dy, dz] of [[0, -0.09], [0, 0.09], [0.12, 0]] as const) {
      group.add(mesh(unitCylinder, materials.solid('slateLight'), { x: -0.6, y: y + 0.07 + dy, z: -4.5 + dz, sx: 0.14, sy: 1.2, sz: 0.14, rz: Math.PI / 2 }));
    }
    // Formwork panels.
    for (let i = 0; i < 6; i++) group.add(block(i % 2 ? blocks : white, 4.15, y + i * 0.04, -4.35, 0.95, 0.035, 0.62, 0.05 * (i % 3)));
    // The spoil heap the digging left.
    group.add(mesh(unitCone, materials.solid('slate', 1), { x: 2.35, y: y + 0.2, z: -4.3, sx: 1.3, sy: 0.4, sz: 1.0 }));
    return group;
  }
}

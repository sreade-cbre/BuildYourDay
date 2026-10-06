import * as THREE from 'three';
import { BLOCK_FOOTPRINT } from '../../core/layout';
import type { SwatchToken } from '../../core/model';
import { BlockMesh, CAP_SIZE, CAP_THICKNESS } from '../BlockMesh';
import { PAD_OFFSET, PLOT_TOP_Y, SLAB_SIZE, SLAB_THICKNESS, padGeometry, slabEdgeGeometry, slabGeometry } from '../Foundation';
import { colorOf, materials } from '../materials';

// The temporary pieces a build animates (spec 9.4): the survey tripod and
// footprint outline, footing pads and slab, corner columns, perimeter beams,
// facade panels, and a copy of the block that a clipping plane reveals floor
// by floor. All pooled. The facade and panel materials live as long as the
// site and are recolored for each job, so their shader programs stay compiled.
//
// A build in real time also uses corner stakes, the dug pit, a rebar mat, a
// deck on each floor, a concrete pump line, and a roof cap for the crane.

const COLUMN_SIZE = 0.12;
export const BEAM_SIZE = 0.1;
/** Most beam rings one block can need: 96 floors (8 hours at 5 minute slots). */
const MAX_RINGS = 96;
const PANEL_POOL = 3;
const OUTLINE_POINTS = 96;
/** A stacked block's poured floor: as wide as the block and this thick. */
const FLOOR_THICKNESS = 0.05;
/** Floor decks laid on each ring of beams, inside the columns. */
export const DECK_THICKNESS = 0.05;
const DECK_SPAN = BLOCK_FOOTPRINT - 0.18;
const REBAR_BARS = 9;
const STAKE_HEIGHT = 0.32;

const columnGeometry = new THREE.BoxGeometry(COLUMN_SIZE, 1, COLUMN_SIZE).translate(0, 0.5, 0);
const beamGeometry = new THREE.BoxGeometry(1, BEAM_SIZE, BEAM_SIZE);
const panelGeometry = new THREE.BoxGeometry(BLOCK_FOOTPRINT, 1, 0.1);
const legGeometry = new THREE.CylinderGeometry(0.012, 0.012, 0.44, 5).translate(0, -0.22, 0);
const instrumentGeometry = new THREE.BoxGeometry(0.09, 0.07, 0.12);
const deckGeometry = new THREE.BoxGeometry(DECK_SPAN, DECK_THICKNESS, DECK_SPAN);
const rebarGeometry = new THREE.BoxGeometry(SLAB_SIZE - 0.3, 0.025, 0.025);
const stakeGeometry = new THREE.BoxGeometry(0.035, STAKE_HEIGHT, 0.035).translate(0, STAKE_HEIGHT / 2, 0);
const flagGeometry = new THREE.BoxGeometry(0.1, 0.06, 0.01).translate(0.05, STAKE_HEIGHT - 0.04, 0);
const pitGeometry = new THREE.BoxGeometry(SLAB_SIZE + 0.3, 0.01, SLAB_SIZE + 0.3);
const roofGeometry = new THREE.BoxGeometry(CAP_SIZE, CAP_THICKNESS, CAP_SIZE).translate(0, -CAP_THICKNESS / 2, 0);
const pipeGeometry = new THREE.BoxGeometry(0.1, 1, 0.1).translate(0, 0.5, 0);
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
/** Stands in for an unbounded clipping height; shader uniforms should not carry Infinity. */
const FAR = 1e5;

export class SiteProps {
  readonly root = new THREE.Group();
  readonly tripod = new THREE.Group();
  readonly outline: THREE.Line;
  readonly pads: THREE.Mesh[] = [];
  readonly slab: THREE.Mesh;
  /** A stacked block's poured floor, on the roof below it. */
  readonly floor: THREE.Mesh;
  /** Survey stakes at the footprint's corners, each with a flag. */
  readonly stakes: THREE.Group[] = [];
  /** The dug pit, a dark patch on the plot that widens as the digging goes on. */
  readonly pit: THREE.Mesh;
  /** The rebar mat, tied over the pit before the slab is poured. */
  readonly rebar: THREE.InstancedMesh;
  /** A deck laid on each floor's ring of beams. */
  readonly decks: THREE.InstancedMesh;
  /** The concrete pump line up the tower's right side to a stacked floor. */
  readonly pump = new THREE.Group();
  /** The roof cap on its way up on the crane. */
  readonly roof: THREE.Mesh;
  private readonly pumpRiser: THREE.Mesh;
  private readonly pumpBoom: THREE.Mesh;
  readonly columns: THREE.Mesh[] = [];
  readonly beams: THREE.InstancedMesh;
  readonly panels: THREE.Mesh[] = [];
  /** The facade that rises behind the scaffold. */
  readonly cladding: BlockMesh;
  /** Keeps the facade copy below a height (y <= constant). */
  readonly clipTop = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  /** Keeps the facade copy above a height (y >= -constant), for work at a block's base. */
  readonly clipBase = new THREE.Plane(new THREE.Vector3(0, 1, 0), FAR);
  private readonly claddingBody: THREE.MeshStandardMaterial;
  /** The finished block for reduced motion, which fades in instead (spec 9.7). */
  private readonly fadeBody: THREE.MeshStandardMaterial;
  private readonly fadeCap: THREE.MeshStandardMaterial;
  private readonly claddingEdges: THREE.LineBasicMaterial;
  private readonly panelMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly outlineGeometry: THREE.BufferGeometry;

  constructor() {
    this.root.name = 'site-props';

    const legMaterial = materials.solid('slateDark');
    for (let i = 0; i < 3; i++) {
      const leg = new THREE.Mesh(legGeometry, legMaterial);
      const angle = (i / 3) * Math.PI * 2;
      leg.rotation.set(Math.cos(angle) * 0.35, 0, Math.sin(angle) * 0.35);
      leg.position.y = 0.44;
      leg.castShadow = true;
      this.tripod.add(leg);
    }
    const instrument = new THREE.Mesh(instrumentGeometry, materials.solid('navy'));
    instrument.position.y = 0.48;
    instrument.castShadow = true;
    this.tripod.add(instrument);

    // A dashed square that draws itself around the footprint.
    const half = BLOCK_FOOTPRINT / 2;
    const corners = [[-half, half], [half, half], [half, -half], [-half, -half], [-half, half]] as const;
    const points: THREE.Vector3[] = [];
    for (let side = 0; side < 4; side++) {
      const [ax, az] = corners[side]!;
      const [bx, bz] = corners[side + 1]!;
      for (let i = 0; i < OUTLINE_POINTS / 4; i++) {
        const t = i / (OUTLINE_POINTS / 4);
        points.push(new THREE.Vector3(ax + (bx - ax) * t, 0, az + (bz - az) * t));
      }
    }
    points.push(points[0]!.clone());
    this.outlineGeometry = new THREE.BufferGeometry().setFromPoints(points);
    this.outline = new THREE.Line(
      this.outlineGeometry,
      new THREE.LineDashedMaterial({ color: colorOf('blue'), dashSize: 0.25, gapSize: 0.15, toneMapped: false }),
    );
    this.outline.computeLineDistances();
    this.outline.position.y = PLOT_TOP_Y + 0.012;

    for (let i = 0; i < 4; i++) {
      const pad = new THREE.Mesh(padGeometry, materials.solid('slatePale'));
      pad.castShadow = true;
      pad.receiveShadow = true;
      this.pads.push(pad);
    }
    this.slab = new THREE.Mesh(slabGeometry, materials.solid('slatePale'));
    this.slab.castShadow = true;
    this.slab.receiveShadow = true;
    this.slab.add(new THREE.LineSegments(slabEdgeGeometry, materials.line('slateLight')));
    this.floor = new THREE.Mesh(slabGeometry, materials.solid('slatePale'));
    this.floor.castShadow = true;
    this.floor.receiveShadow = true;

    const stakeMaterial = materials.solid('slateDark');
    const flagMaterial = materials.solid('blue');
    for (let i = 0; i < 4; i++) {
      const stake = new THREE.Group();
      const post = new THREE.Mesh(stakeGeometry, stakeMaterial);
      post.castShadow = true;
      stake.add(post, new THREE.Mesh(flagGeometry, flagMaterial));
      this.stakes.push(stake);
    }
    this.pit = new THREE.Mesh(pitGeometry, materials.solid('slate'));
    this.pit.receiveShadow = true;
    this.pit.position.y = PLOT_TOP_Y + 0.006;
    this.rebar = new THREE.InstancedMesh(rebarGeometry, materials.solid('slateDark'), REBAR_BARS * 2);
    const bar = new THREE.Matrix4();
    const turned = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    for (let i = 0; i < REBAR_BARS; i++) {
      const offset = -SLAB_SIZE / 2 + 0.3 + (i * (SLAB_SIZE - 0.6)) / (REBAR_BARS - 1);
      // Bars one way, then the other, so the mat fills in as a grid.
      bar.compose(new THREE.Vector3(0, -0.1, offset), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
      this.rebar.setMatrixAt(i * 2, bar);
      bar.compose(new THREE.Vector3(offset, -0.075, 0), turned, new THREE.Vector3(1, 1, 1));
      this.rebar.setMatrixAt(i * 2 + 1, bar);
    }
    this.rebar.count = 0;
    this.rebar.frustumCulled = false;
    this.decks = new THREE.InstancedMesh(deckGeometry, materials.solid('slatePale'), MAX_RINGS);
    this.decks.castShadow = true;
    this.decks.receiveShadow = true;
    this.decks.frustumCulled = false;
    for (let i = 0; i < MAX_RINGS; i++) this.decks.setMatrixAt(i, HIDDEN);
    this.decks.count = 0;
    this.roof = new THREE.Mesh(roofGeometry, materials.blockCap('navy'));
    this.roof.castShadow = true;
    const pipe = materials.solid('slateDark');
    this.pumpRiser = new THREE.Mesh(pipeGeometry, pipe);
    this.pumpBoom = new THREE.Mesh(pipeGeometry, pipe);
    this.pumpBoom.rotation.z = Math.PI / 2;
    this.pump.add(this.pumpRiser, this.pumpBoom);

    for (let i = 0; i < 4; i++) {
      const column = new THREE.Mesh(columnGeometry, materials.solid('slateDark'));
      column.castShadow = true;
      this.columns.push(column);
    }
    this.beams = new THREE.InstancedMesh(beamGeometry, materials.solid('slateDark'), MAX_RINGS * 4);
    this.beams.castShadow = true;
    this.beams.frustumCulled = false;
    this.beams.count = 0;

    for (let i = 0; i < PANEL_POOL; i++) {
      const material = materials.blockBody('navy').clone();
      material.transparent = true;
      material.polygonOffset = false;
      this.panelMaterials.push(material);
      const panel = new THREE.Mesh(panelGeometry, material);
      panel.castShadow = true;
      this.panels.push(panel);
    }

    this.claddingBody = materials.blockBody('navy').clone();
    this.claddingBody.clippingPlanes = [this.clipTop, this.clipBase];
    this.claddingBody.clipShadows = true;
    // Inner faces too, so the cut reads as a shell rather than a see-through box.
    this.claddingBody.side = THREE.DoubleSide;
    // Shadows from the outer faces only, as for a one sided material, or the
    // inner faces would shade the outer ones in fine stripes.
    this.claddingBody.shadowSide = THREE.BackSide;
    this.claddingEdges = materials.blockEdges('navy').clone();
    this.claddingEdges.clippingPlanes = [this.clipTop, this.clipBase];
    this.fadeBody = materials.blockBody('navy').clone();
    this.fadeBody.transparent = true;
    this.fadeCap = materials.blockCap('navy').clone();
    this.fadeCap.transparent = true;
    this.cladding = new BlockMesh('cladding', 'navy');
    this.cladding.useMaterials(this.claddingBody, this.claddingEdges, materials.blockCap('navy'));
    // Never drawn. Keeps the fade material in the scene so the startup warm up compiles it.
    const fadeHolder = new THREE.Mesh(panelGeometry, this.fadeBody);
    fadeHolder.visible = false;

    this.root.add(this.tripod, this.outline, ...this.pads, this.slab, ...this.columns, this.beams, ...this.panels, this.cladding.root, fadeHolder);
    this.root.add(this.floor, ...this.stakes, this.pit, this.rebar, this.decks, this.pump, this.roof);
    this.reset();
  }

  /**
   * Prepares the facade copy and panels for a block's color, base, and
   * height. With `fade`, the copy is the see-through body that reduced motion
   * fades in.
   */
  setup(token: SwatchToken, baseY: number, height: number, fade = false): void {
    const color = materials.blockBody(token).color;
    for (const material of [this.claddingBody, this.fadeBody, ...this.panelMaterials]) material.color.copy(color);
    this.fadeCap.color.copy(materials.blockCap(token).color);
    this.roof.material = materials.blockCap(token);
    this.claddingEdges.color.copy(materials.blockEdges(token).color);
    this.claddingEdges.opacity = 0;
    this.cladding.useMaterials(
      fade ? this.fadeBody : this.claddingBody,
      this.claddingEdges,
      fade ? this.fadeCap : materials.blockCap(token),
    );
    this.cladding.setBaseY(baseY);
    this.cladding.setHeight(height);
    this.cladding.cap.visible = false;
    this.cladding.cap.position.x = 0;
    this.cladding.cap.position.z = 0;
    this.clipTop.constant = baseY;
    this.clipBase.constant = FAR;
  }

  /** Puts the survey outline at a height: the plot for a first build, a stacked block's base otherwise. */
  setOutlineY(y: number): void {
    this.outline.position.y = y;
  }

  /** Draws the footprint outline from 0 (none) to 1 (closed square). */
  setOutline(progress: number): void {
    this.outline.visible = progress > 0;
    this.outlineGeometry.setDrawRange(0, Math.round(progress * (OUTLINE_POINTS + 1)));
  }

  /** Footing pads at the slab corners, each scaled by its own pop. */
  setPads(scales: readonly number[]): void {
    this.pads.forEach((pad, i) => {
      const s = scales[i] ?? 0;
      const x = i === 1 || i === 2 ? 1 : -1;
      const z = i >= 2 ? 1 : -1;
      pad.position.set(x * PAD_OFFSET, PLOT_TOP_Y, z * PAD_OFFSET);
      pad.scale.setScalar(Math.max(0.001, s));
      pad.visible = s > 0;
    });
  }

  /** The slab from 0 (flat) to 1 (full depth); may overshoot for a wobble. */
  setSlab(scale: number): void {
    this.slab.visible = scale > 0;
    this.slab.position.y = 0;
    this.slab.scale.set(1, Math.max(0.001, scale), 1);
  }

  /** A stacked block's floor, poured on the roof below it at `y`, from 0 (none) to 1. */
  setFloor(y: number, rise: number): void {
    const span = (SLAB_SIZE - 0.2) / SLAB_SIZE;
    const depth = (FLOOR_THICKNESS / SLAB_THICKNESS) * Math.max(0.001, rise);
    this.floor.visible = rise > 0;
    this.floor.position.y = y + SLAB_THICKNESS * depth;
    this.floor.scale.set(span, depth, span);
  }

  /** A survey stake at a footprint corner, driven in from 0 (none) to 1. */
  setStake(index: number, x: number, z: number, y: number, driven: number): void {
    const stake = this.stakes[index]!;
    stake.visible = driven > 0;
    stake.position.set(x, y, z);
    stake.scale.set(1, Math.max(0.001, driven), 1);
  }

  /** The pit widens from nothing (0) to the slab's footprint (1). */
  setPit(share: number): void {
    this.pit.visible = share > 0;
    const s = Math.max(0.001, share);
    this.pit.scale.set(s, 1, s);
  }

  /** The rebar mat, from no bars (0) to all of them (1). */
  setRebar(share: number): void {
    this.rebar.count = Math.round(Math.min(1, Math.max(0, share)) * REBAR_BARS * 2);
  }

  /** Floor decks there can be, one per beam ring. */
  setDeckCount(decks: number): void {
    this.decks.count = Math.max(0, Math.min(MAX_RINGS, decks));
  }

  /** Lays a deck with its underside on a ring at `y`, spreading from the middle (0) to full (1). */
  setDeck(index: number, y: number, share: number): void {
    const matrix = new THREE.Matrix4();
    if (share <= 0) matrix.copy(HIDDEN);
    else matrix.compose(new THREE.Vector3(0, y + DECK_THICKNESS / 2, 0), new THREE.Quaternion(), new THREE.Vector3(share, 1, share));
    this.decks.setMatrixAt(index, matrix);
    this.decks.instanceMatrix.needsUpdate = true;
  }

  /** The pump line from the ground at `baseY` up to a floor at `topY`, raised from 0 to 1. */
  setPump(baseY: number, topY: number, rise: number): void {
    this.pump.visible = rise > 0.001;
    const height = Math.max(0.01, (topY + 0.35 - baseY) * rise);
    this.pumpRiser.position.set(2.32, baseY, -0.8);
    this.pumpRiser.scale.y = height;
    // The boom reaches in over the floor once the riser is up.
    this.pumpBoom.position.set(2.32, baseY + height, -0.8);
    this.pumpBoom.scale.y = 1.6 * Math.max(0, rise * 2 - 1);
    this.pumpBoom.visible = rise > 0.5;
  }

  /** The roof cap, its top at a point, or hidden. */
  setRoof(point: THREE.Vector3 | null): void {
    this.roof.visible = point !== null;
    if (point) this.roof.position.copy(point);
  }

  /** Corner columns from `baseY` up to `topY`. */
  setColumns(baseY: number, topY: number): void {
    const height = topY - baseY;
    const inset = BLOCK_FOOTPRINT / 2 - COLUMN_SIZE / 2 - 0.01;
    this.columns.forEach((column, i) => {
      column.visible = height > 0.001;
      column.position.set(i % 2 === 0 ? -inset : inset, baseY, i < 2 ? -inset : inset);
      column.scale.y = Math.max(0.001, height);
    });
  }

  /**
   * Places the four beams of a floor ring centered at (cx, y, cz). Ring `r`
   * uses instances 4r to 4r + 3; `count` limits how many rings draw.
   */
  setRing(ring: number, cx: number, y: number, cz: number): void {
    const half = BLOCK_FOOTPRINT / 2 - BEAM_SIZE / 2 - 0.01;
    const matrix = new THREE.Matrix4();
    const along = new THREE.Vector3(BLOCK_FOOTPRINT - 0.02, 1, 1);
    const across = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const none = new THREE.Quaternion();
    const pieces: Array<[number, number, THREE.Quaternion]> = [
      [0, half, none],
      [0, -half, none],
      [half, 0, across],
      [-half, 0, across],
    ];
    pieces.forEach(([dx, dz, rotation], i) => {
      matrix.compose(new THREE.Vector3(cx + dx, y, cz + dz), rotation, along);
      this.beams.setMatrixAt(ring * 4 + i, matrix);
    });
    this.beams.instanceMatrix.needsUpdate = true;
  }

  setRingCount(rings: number): void {
    this.beams.count = Math.max(0, Math.min(MAX_RINGS, rings)) * 4;
  }

  /** Collapses one ring's beams to nothing, leaving the other rings in place. */
  hideRing(ring: number): void {
    for (let i = 0; i < 4; i++) this.beams.setMatrixAt(ring * 4 + i, HIDDEN);
    this.beams.instanceMatrix.needsUpdate = true;
  }

  /** A facade panel: front face plate, `height` tall, centered at (x, y, z). */
  setPanel(index: number, x: number, y: number, z: number, height: number, opacity: number): void {
    const panel = this.panels[index % PANEL_POOL]!;
    panel.visible = opacity > 0.01;
    panel.position.set(x, y, z);
    panel.scale.set(1, Math.max(0.01, height), 1);
    (panel.material as THREE.MeshStandardMaterial).opacity = opacity;
  }

  hidePanel(index: number): void {
    this.panels[index % PANEL_POOL]!.visible = false;
  }

  /** Shows the facade copy up to a world height; Infinity shows all of it. */
  setReveal(y: number): void {
    this.cladding.root.visible = true;
    this.clipTop.constant = Math.min(y, FAR);
  }

  /** Shows the facade copy from a world height up; -Infinity shows all of it. */
  setRevealFrom(y: number): void {
    this.cladding.root.visible = true;
    this.clipBase.constant = -Math.max(y, -FAR);
  }

  setEdgeOpacity(opacity: number): void {
    this.claddingEdges.opacity = opacity;
  }

  /** Reduced motion: the whole finished block, body, roof, and edges, at an opacity. */
  setFade(opacity: number): void {
    this.fadeBody.opacity = opacity;
    this.fadeCap.opacity = opacity;
    this.claddingEdges.opacity = 0.5 * opacity;
  }

  /** Hides everything. */
  reset(): void {
    this.floor.visible = false;
    for (const stake of this.stakes) stake.visible = false;
    this.pit.visible = false;
    this.rebar.count = 0;
    for (let i = 0; i < MAX_RINGS; i++) this.decks.setMatrixAt(i, HIDDEN);
    this.decks.instanceMatrix.needsUpdate = true;
    this.decks.count = 0;
    this.pump.visible = false;
    this.roof.visible = false;
    this.tripod.visible = false;
    this.tripod.scale.setScalar(1);
    this.setOutline(0);
    this.setOutlineY(PLOT_TOP_Y + 0.012);
    this.setPads([0, 0, 0, 0]);
    this.setSlab(0);
    for (const column of this.columns) column.visible = false;
    this.beams.count = 0;
    for (const panel of this.panels) panel.visible = false;
    this.cladding.root.visible = false;
    this.cladding.cap.visible = true;
  }
}

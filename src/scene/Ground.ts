import * as THREE from 'three';
import { tokens } from '../brand/tokens';
import { DEPOT_OFFSET, PLOT_SIZE } from '../core/layout';
import type { IsoDate, PaletteMode, Theme } from '../core/model';
import { hashString, mulberry32, randomRange } from '../core/rng';
import { formatDateTitle } from '../core/time';
import { FONT_HEADING, context2d, font } from './canvasText';
import { PLOT_TOP_Y } from './Foundation';
import { colorOf, materials } from './materials';

// The ground, the plot the tower stands on, the depot pad, and the site sign
// (spec section 8.2).

export const PLOT_THICKNESS = 0.3;
/** The plot is a raised tile, so the wider ground sits at its base. */
export const GROUND_Y = PLOT_TOP_Y - PLOT_THICKNESS;
/** Depot pad size. 6 along x so it meets the plot edge exactly, 8 along z. */
export const DEPOT_WIDTH = 6;
export const DEPOT_DEPTH = 8;
/**
 * The depot sits a hair below the plot. Level tops would put the two side
 * faces in one plane, which flickers along the seam.
 */
export const DEPOT_TOP_Y = PLOT_TOP_Y - 0.02;
const GROUND_SIZE = 200;
const GRASS_COUNT = 2500;
/** Half width of the strip the bulldozer clears across the plot. */
export const CLEARED_HALF_WIDTH = 2.6;

const SIGN_POST_HEIGHT = 1.4;
const SIGN_BOARD_WIDTH = 2.0;
const SIGN_BOARD_HEIGHT = 1.0;

export interface SignPlacement {
  x: number;
  z: number;
  /** Rotation about y so the board faces the default camera. */
  facing: number;
}

export class Ground {
  readonly root = new THREE.Group();
  readonly grass: THREE.InstancedMesh;
  /** The plot slab; clicking it starts a new block (spec 12.1). */
  readonly plotMesh: THREE.Mesh;
  private readonly groundMaterial: THREE.MeshStandardMaterial;
  private readonly plotTopMaterial: THREE.MeshStandardMaterial;
  private readonly grassMaterial: THREE.MeshStandardMaterial;
  private readonly bladeMatrices: Float32Array;
  private readonly clearedBlades: number[] = [];
  private readonly sign: SiteSign;
  private prepared = false;
  private palette: PaletteMode = 'strict';

  constructor(sign: SignPlacement) {
    this.root.name = 'ground';

    this.groundMaterial = new THREE.MeshStandardMaterial({ color: colorOf('white'), roughness: 1, metalness: 0 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE), this.groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = GROUND_Y;
    ground.receiveShadow = true;
    ground.name = 'ground-plane';
    this.root.add(ground);

    // The plot top is its own material so site prep can recolor it.
    this.plotTopMaterial = new THREE.MeshStandardMaterial({ color: colorOf('slateLight'), roughness: 0.95, metalness: 0 });
    const side = materials.solid('slate');
    const plot = new THREE.Mesh(
      new THREE.BoxGeometry(PLOT_SIZE, PLOT_THICKNESS, PLOT_SIZE),
      [side, side, this.plotTopMaterial, side, side, side],
    );
    plot.position.y = PLOT_TOP_Y - PLOT_THICKNESS / 2;
    plot.receiveShadow = true;
    plot.castShadow = true;
    plot.name = 'plot';
    plot.userData.plot = true;
    this.plotMesh = plot;
    this.root.add(plot);

    this.grassMaterial = new THREE.MeshStandardMaterial({ color: colorOf('slateLight'), roughness: 0.9, metalness: 0 });
    const blade = new THREE.ConeGeometry(0.03, 0.18, 4).translate(0, 0.09, 0);
    this.grass = new THREE.InstancedMesh(blade, this.grassMaterial, GRASS_COUNT);
    this.grass.name = 'grass';
    this.grass.receiveShadow = true;
    this.scatterGrass();
    this.bladeMatrices = new Float32Array(this.grass.instanceMatrix.array);
    this.root.add(this.grass);

    this.root.add(createDepot());

    this.sign = new SiteSign();
    this.sign.root.position.set(sign.x, PLOT_TOP_Y, sign.z);
    this.sign.root.rotation.y = sign.facing;
    this.root.add(this.sign.root);
  }

  private scatterGrass(): void {
    const rng = mulberry32(hashString('plot-grass'));
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const tilt = new THREE.Euler();
    const scale = new THREE.Vector3();
    const half = PLOT_SIZE / 2 - 0.08;
    for (let i = 0; i < GRASS_COUNT; i++) {
      position.set(randomRange(rng, -half, half), PLOT_TOP_Y, randomRange(rng, -half, half));
      tilt.set(randomRange(rng, -0.25, 0.25), rng() * Math.PI * 2, randomRange(rng, -0.25, 0.25));
      rotation.setFromEuler(tilt);
      scale.set(1, randomRange(rng, 0.7, 1.3), 1);
      matrix.compose(position, rotation, scale);
      this.grass.setMatrixAt(i, matrix);
      if (Math.abs(position.z) < CLEARED_HALF_WIDTH) this.clearedBlades.push(i);
    }
    this.grass.instanceMatrix.needsUpdate = true;
  }

  /**
   * Shows the site as prepared (bare earth, cleared strip) or as untouched
   * grass. A day with any block has a prepared site.
   */
  setPrepared(prepared: boolean): void {
    if (prepared === this.prepared) return;
    this.prepared = prepared;
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    const array = this.grass.instanceMatrix.array as Float32Array;
    for (const i of this.clearedBlades) {
      if (prepared) this.grass.setMatrixAt(i, hidden);
      else array.set(this.bladeMatrices.subarray(i * 16, i * 16 + 16), i * 16);
    }
    this.grass.instanceMatrix.needsUpdate = true;
    this.plotTopMaterial.color.copy(colorOf(prepared ? 'slatePale' : this.grassToken()));
  }

  setPaletteMode(mode: PaletteMode): void {
    this.palette = mode;
    this.grassMaterial.color.copy(colorOf(this.grassToken()));
    if (!this.prepared) this.plotTopMaterial.color.copy(colorOf(this.grassToken()));
  }

  setTheme(theme: Theme): void {
    this.groundMaterial.color.copy(Ground.groundFor(theme));
  }

  /** The ground plane color for a theme (spec 5.8). */
  static groundFor(theme: Theme): THREE.Color {
    return colorOf(theme === 'dark' ? 'slateDark' : 'white');
  }

  /** The live ground color, for theme transitions. */
  get groundColor(): THREE.Color {
    return this.groundMaterial.color;
  }

  /** World point at the center of the plot surface, for placing HTML over it. */
  get plotCenter(): THREE.Vector3 {
    return new THREE.Vector3(0, PLOT_TOP_Y, 0);
  }

  setDate(date: IsoDate): void {
    this.sign.setText(formatDateTitle(date));
  }

  private grassToken(): 'slateLight' | 'grass' {
    return this.palette === 'accents' ? 'grass' : 'slateLight';
  }
}

/** The pad beside the plot where machines park between jobs. */
function createDepot(): THREE.Group {
  const depot = new THREE.Group();
  depot.name = 'depot';
  depot.position.set(DEPOT_OFFSET, 0, 0);

  const side = materials.solid('slate');
  const top = materials.solid('slatePale');
  const thickness = DEPOT_TOP_Y - GROUND_Y;
  const padGeometry = new THREE.BoxGeometry(DEPOT_WIDTH, thickness, DEPOT_DEPTH);
  const pad = new THREE.Mesh(padGeometry, [side, side, top, side, side, side]);
  pad.position.y = DEPOT_TOP_Y - thickness / 2;
  pad.receiveShadow = true;
  pad.castShadow = true;
  depot.add(pad);

  // Painted bay lines, so the depot reads as a parking area and not more plot.
  const lineGeometry = new THREE.BoxGeometry(DEPOT_WIDTH - 1.4, 0.01, 0.06);
  for (const z of [-2, 0, 2]) {
    const line = new THREE.Mesh(lineGeometry, materials.solid('white'));
    line.position.set(0.4, DEPOT_TOP_Y + 0.006, z);
    line.receiveShadow = true;
    depot.add(line);
  }
  const stopGeometry = new THREE.BoxGeometry(0.06, 0.01, DEPOT_DEPTH - 1.2);
  const stop = new THREE.Mesh(stopGeometry, materials.solid('white'));
  stop.position.set(DEPOT_WIDTH / 2 - 0.4, DEPOT_TOP_Y + 0.006, 0);
  stop.receiveShadow = true;
  depot.add(stop);
  return depot;
}

/** A navy board on two posts that shows the viewed date in Georgia. */
class SiteSign {
  readonly root = new THREE.Group();
  private readonly canvas = document.createElement('canvas');
  private readonly texture: THREE.CanvasTexture;
  private text = '';

  constructor() {
    this.root.name = 'site-sign';
    this.canvas.width = 1024;
    this.canvas.height = 512;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;

    const postGeometry = new THREE.CylinderGeometry(0.05, 0.05, SIGN_POST_HEIGHT, 10).translate(0, SIGN_POST_HEIGHT / 2, 0);
    for (const x of [-0.75, 0.75]) {
      const post = new THREE.Mesh(postGeometry, materials.solid('slateDark'));
      post.position.set(x, 0, -0.05);
      post.castShadow = true;
      this.root.add(post);
    }

    const navy = materials.solid('navy');
    const face = new THREE.MeshStandardMaterial({ map: this.texture, roughness: 0.85, metalness: 0 });
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(SIGN_BOARD_WIDTH, SIGN_BOARD_HEIGHT, 0.06),
      [navy, navy, navy, navy, face, navy],
    );
    board.position.y = SIGN_POST_HEIGHT - SIGN_BOARD_HEIGHT / 2;
    board.castShadow = true;
    board.receiveShadow = true;
    this.root.add(board);
  }

  setText(text: string): void {
    if (text === this.text) return;
    this.text = text;
    const ctx = context2d(this.canvas);
    const { width, height } = this.canvas;
    ctx.fillStyle = tokens.navy;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = tokens.white;
    ctx.lineWidth = 6;
    ctx.strokeRect(28, 28, width - 56, height - 56);

    let size = 118;
    ctx.font = font(size, FONT_HEADING);
    while (ctx.measureText(text).width > width - 150 && size > 40) {
      size -= 4;
      ctx.font = font(size, FONT_HEADING);
    }
    ctx.fillStyle = tokens.white;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, width / 2, height / 2);
    this.texture.needsUpdate = true;
  }
}

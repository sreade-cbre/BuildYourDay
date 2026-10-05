import * as THREE from 'three';
import { tokenHex, type AnyTokenName } from '../brand/tokens';
import type { SwatchToken } from '../core/model';

// Shared materials (spec sections 5.7 and 16): one per swatch token and one
// per structural role, created on first use and never per block.

/** A three Color from a brand token. three converts the sRGB hex for us. */
export function colorOf(name: AnyTokenName): THREE.Color {
  return new THREE.Color(tokenHex(name));
}

const DARK: Record<SwatchToken, SwatchToken> = {
  navy: 'navyDark', navyLight: 'navyDark', navyDark: 'navyDark',
  blue: 'blueDark', blueLight: 'blueDark', blueDark: 'blueDark',
  slate: 'slateDark', slateLight: 'slateDark', slateDark: 'slateDark',
};

const LIGHT: Record<SwatchToken, SwatchToken> = {
  navy: 'navyLight', navyLight: 'navyLight', navyDark: 'navyLight',
  blue: 'blueLight', blueLight: 'blueLight', blueDark: 'blueLight',
  slate: 'slateLight', slateLight: 'slateLight', slateDark: 'slateLight',
};

/** The dark shade of a swatch's family: navyDark, blueDark, or slateDark. */
export function darkVariant(token: SwatchToken): SwatchToken {
  return DARK[token];
}

/** The light tint of a swatch's family: navyLight, blueLight, or slateLight. */
export function lightVariant(token: SwatchToken): SwatchToken {
  return LIGHT[token];
}

/**
 * Edge color for a block. The family's dark shade, except on a block that is
 * already that shade, where dark edges would vanish; those get the light tint.
 */
export function edgeToken(token: SwatchToken): SwatchToken {
  return token === DARK[token] ? LIGHT[token] : DARK[token];
}

/** How a block is drawn: as is, dimmed by a legend highlight, or hovered. */
export type BlockVariant = 'normal' | 'dimmed';
export type EdgeVariant = 'normal' | 'hover' | 'dimmed';

/** Opacity of blocks outside a legend highlight (spec 13.3). */
export const DIMMED_OPACITY = 0.4;

class MaterialLibrary {
  private readonly cache = new Map<string, THREE.Material>();
  private hatchTexture: THREE.CanvasTexture | null = null;

  private shared<T extends THREE.Material>(key: string, create: () => T): T {
    const existing = this.cache.get(key);
    if (existing) return existing as T;
    const material = create();
    this.cache.set(key, material);
    return material;
  }

  /** Solid structural material in a brand color. */
  solid(name: AnyTokenName, roughness = 0.85): THREE.MeshStandardMaterial {
    return this.shared(`solid:${name}:${roughness}`, () =>
      new THREE.MeshStandardMaterial({ color: colorOf(name), roughness, metalness: 0 }),
    );
  }

  /** Finished block faces. Pushed back slightly in depth so edge lines stay crisp. */
  blockBody(token: SwatchToken, variant: BlockVariant = 'normal'): THREE.MeshStandardMaterial {
    return this.shared(`block:${token}:${variant}`, () =>
      new THREE.MeshStandardMaterial({
        color: colorOf(token),
        roughness: 0.75,
        metalness: 0,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
        ...(variant === 'dimmed' ? { transparent: true, opacity: DIMMED_OPACITY } : {}),
      }),
    );
  }

  /** Roof cap in the category's dark variant. */
  blockCap(token: SwatchToken, variant: BlockVariant = 'normal'): THREE.MeshStandardMaterial {
    if (variant === 'normal') return this.solid(darkVariant(token), 0.75);
    return this.shared(`cap:${token}:${variant}`, () =>
      new THREE.MeshStandardMaterial({
        color: colorOf(darkVariant(token)),
        roughness: 0.75,
        metalness: 0,
        transparent: true,
        opacity: DIMMED_OPACITY,
      }),
    );
  }

  /**
   * Block outline at half opacity. Hovered blocks brighten to the swatch's
   * light variant (spec 10.5).
   */
  blockEdges(token: SwatchToken, variant: EdgeVariant = 'normal'): THREE.LineBasicMaterial {
    return this.shared(`edges:${token}:${variant}`, () =>
      new THREE.LineBasicMaterial({
        color: colorOf(variant === 'hover' ? lightVariant(token) : edgeToken(token)),
        transparent: true,
        opacity: variant === 'hover' ? 1 : variant === 'dimmed' ? 0.5 * DIMMED_OPACITY : 0.5,
        toneMapped: false,
      }),
    );
  }

  /**
   * Hatched slateLight for blocks outside the day window (spec section 6).
   * The stripes take their coordinates from world position, so they keep the
   * same size on blocks of any height while the geometry stays shared.
   */
  hatched(variant: BlockVariant = 'normal'): THREE.MeshStandardMaterial {
    return this.shared(`hatched:${variant}`, () => {
      const material = new THREE.MeshStandardMaterial({
        color: colorOf('white'),
        map: this.hatchMap(),
        roughness: 0.9,
        metalness: 0,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
        ...(variant === 'dimmed' ? { transparent: true, opacity: DIMMED_OPACITY } : {}),
      });
      material.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>
          vec4 hatchWorld = modelMatrix * vec4( position, 1.0 );
          vMapUv = vec2( hatchWorld.x + hatchWorld.z, hatchWorld.y ) * 0.9;`,
        );
      };
      material.customProgramCacheKey = () => 'hatched-world-uv';
      return material;
    });
  }

  private hatchMap(): THREE.CanvasTexture {
    if (this.hatchTexture) return this.hatchTexture;
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = tokenHex('slateLight');
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = tokenHex('slatePale');
      ctx.lineWidth = 14;
      for (let offset = -size; offset <= size * 2; offset += size / 2) {
        ctx.beginPath();
        ctx.moveTo(offset, size);
        ctx.lineTo(offset + size, 0);
        ctx.stroke();
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    this.hatchTexture = texture;
    return texture;
  }

  /** The translucent stand-in that follows the pointer during a move (spec 12.4). */
  ghost(): THREE.MeshStandardMaterial {
    return this.shared('ghost', () =>
      new THREE.MeshStandardMaterial({
        color: colorOf('blue'),
        roughness: 0.85,
        metalness: 0,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      }),
    );
  }

  /** Outline around the selected block. Its opacity pulses (spec 10.5). */
  selection(): THREE.LineBasicMaterial {
    return this.shared('selection', () =>
      new THREE.LineBasicMaterial({
        color: colorOf('blue'),
        transparent: true,
        opacity: 0.9,
        toneMapped: false,
      }),
    );
  }

  /** Plain line in a brand color. */
  line(name: AnyTokenName, opacity = 1): THREE.LineBasicMaterial {
    return this.shared(`line:${name}:${opacity}`, () =>
      new THREE.LineBasicMaterial({
        color: colorOf(name),
        transparent: opacity < 1,
        opacity,
        toneMapped: false,
      }),
    );
  }

  /** Dashed outline of free time. */
  gapLines(): THREE.LineDashedMaterial {
    return this.shared('gap:lines', () =>
      new THREE.LineDashedMaterial({
        color: colorOf('slateLight'),
        dashSize: 0.25,
        gapSize: 0.15,
        toneMapped: false,
      }),
    );
  }

  /**
   * Faint volume inside a gap so its extent reads from any angle. A hovered
   * gap fills a little more, since clicking it starts a new block.
   */
  gapFill(hovered = false): THREE.MeshBasicMaterial {
    return this.shared(`gap:fill:${hovered}`, () =>
      new THREE.MeshBasicMaterial({
        color: colorOf(hovered ? 'blue' : 'slateLight'),
        transparent: true,
        opacity: hovered ? 0.12 : 0.06,
        depthWrite: false,
        toneMapped: false,
      }),
    );
  }

  /** Leader lines from blocks to their labels. Drawn on top like the labels. */
  leader(): THREE.LineBasicMaterial {
    return this.shared('label:leader', () =>
      new THREE.LineBasicMaterial({
        color: colorOf('slateLight'),
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      }),
    );
  }

  /** Number of shared materials, for the debug overlay. */
  get count(): number {
    return this.cache.size;
  }
}

export const materials = new MaterialLibrary();

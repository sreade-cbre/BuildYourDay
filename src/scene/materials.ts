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

/** How far a past block's color moves toward slateLight (spec 5.7). */
export const WEATHER_SHARE = 0.35;

/** A past block's color: its category color 35% of the way to slateLight (spec 5.7). */
export function weatheredColor(name: AnyTokenName): THREE.Color {
  return colorOf(name).lerp(colorOf('slateLight'), WEATHER_SHARE);
}

/** How a block is drawn: as is, dimmed by a legend highlight, or hovered. */
export type BlockVariant = 'normal' | 'dimmed';
export type EdgeVariant = 'normal' | 'hover' | 'dimmed';

/** Opacity of blocks outside a legend highlight (spec 13.3). */
export const DIMMED_OPACITY = 0.4;

/** Opacity of a planned block's faces. */
export const BLUEPRINT_OPACITY = 0.22;

class MaterialLibrary {
  private readonly cache = new Map<string, THREE.Material>();
  private hatchTexture: THREE.CanvasTexture | null = null;
  /** Plans are drawn lighter on the dark theme, where their own colors would vanish. */
  private theme: 'light' | 'dark' = 'light';

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

  /**
   * A past block's faces (spec 5.7 and 11.4): the category color weathered
   * toward slateLight, roughness 1.
   */
  blockWeathered(token: SwatchToken, variant: BlockVariant = 'normal'): THREE.MeshStandardMaterial {
    return this.shared(`weathered:${token}:${variant}`, () =>
      new THREE.MeshStandardMaterial({
        color: weatheredColor(token),
        roughness: 1,
        metalness: 0,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
        ...(variant === 'dimmed' ? { transparent: true, opacity: DIMMED_OPACITY } : {}),
      }),
    );
  }

  /**
   * A planned block, one whose time has not come: its category color, see
   * through, so the plan reads as a volume still to be built. Above the now
   * ring, the block under way is drawn the same way.
   */
  blueprint(token: SwatchToken, variant: BlockVariant = 'normal'): THREE.MeshStandardMaterial {
    return this.shared(`blueprint:${token}:${variant}`, () =>
      new THREE.MeshStandardMaterial({
        color: this.blueprintColor(token),
        roughness: 0.9,
        metalness: 0,
        transparent: true,
        opacity: variant === 'dimmed' ? BLUEPRINT_OPACITY * DIMMED_OPACITY : BLUEPRINT_OPACITY,
        depthWrite: false,
      }),
    );
  }

  /**
   * A planned block's outline, and the outline of the block under way. On
   * the light theme it matches a finished block's; on the dark theme it is
   * the family's light tint, stronger, so the plan reads against the sky.
   */
  blueprintEdges(token: SwatchToken, variant: EdgeVariant = 'normal'): THREE.LineBasicMaterial {
    return this.shared(`blueprint-edges:${token}:${variant}`, () => {
      const material = new THREE.LineBasicMaterial({ transparent: true, toneMapped: false });
      this.styleBlueprintEdges(material, token, variant);
      return material;
    });
  }

  private blueprintColor(token: SwatchToken): THREE.Color {
    return colorOf(this.theme === 'dark' ? lightVariant(token) : token);
  }

  private styleBlueprintEdges(material: THREE.LineBasicMaterial, token: SwatchToken, variant: EdgeVariant): void {
    const dark = this.theme === 'dark';
    material.color.copy(colorOf(variant === 'hover' || dark ? lightVariant(token) : edgeToken(token)));
    const opacity = variant === 'hover' ? 1 : dark ? 0.75 : 0.5;
    material.opacity = variant === 'dimmed' ? opacity * DIMMED_OPACITY : opacity;
  }

  /** Recolors the plans for a theme. */
  setTheme(theme: 'light' | 'dark'): void {
    this.theme = theme;
    for (const [key, material] of this.cache) {
      const [kind, token, variant] = key.split(':') as [string, SwatchToken, string];
      if (kind === 'blueprint') (material as THREE.MeshStandardMaterial).color.copy(this.blueprintColor(token));
      if (kind === 'blueprint-edges') this.styleBlueprintEdges(material as THREE.LineBasicMaterial, token, variant as EdgeVariant);
    }
  }

  /** A past block's roof cap, weathered like its faces. */
  capWeathered(token: SwatchToken, variant: BlockVariant = 'normal'): THREE.MeshStandardMaterial {
    return this.shared(`weathered-cap:${token}:${variant}`, () =>
      new THREE.MeshStandardMaterial({
        color: weatheredColor(darkVariant(token)),
        roughness: 1,
        metalness: 0,
        ...(variant === 'dimmed' ? { transparent: true, opacity: DIMMED_OPACITY } : {}),
      }),
    );
  }

  /** The now ring (spec 5.7): blue, glowing a little. */
  nowRing(): THREE.MeshStandardMaterial {
    return this.shared('now-ring', () =>
      new THREE.MeshStandardMaterial({
        color: colorOf('blue'),
        emissive: colorOf('blue'),
        emissiveIntensity: 0.6,
        roughness: 0.6,
        metalness: 0,
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

  /** Worker vests: blue in strict mode, hiVis in accents mode (spec 5.3). */
  vest(): THREE.MeshStandardMaterial {
    return this.shared('vest', () => new THREE.MeshStandardMaterial({ color: colorOf('blue'), roughness: 0.8, metalness: 0 }));
  }

  /** Site cones: blue in strict mode, hi-vis orange in accents mode, like the vests. */
  hazard(): THREE.MeshStandardMaterial {
    return this.shared('hazard', () => new THREE.MeshStandardMaterial({ color: colorOf('blue'), roughness: 0.7, metalness: 0 }));
  }

  setPaletteMode(mode: 'strict' | 'accents'): void {
    const accent = colorOf(mode === 'accents' ? 'hiVis' : 'blue');
    this.vest().color.copy(accent);
    this.hazard().color.copy(accent);
  }

  /** Number of shared materials, for the debug overlay. */
  get count(): number {
    return this.cache.size;
  }
}

export const materials = new MaterialLibrary();

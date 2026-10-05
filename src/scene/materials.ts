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

class MaterialLibrary {
  private readonly cache = new Map<string, THREE.Material>();

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
  blockBody(token: SwatchToken): THREE.MeshStandardMaterial {
    return this.shared(`block:${token}`, () =>
      new THREE.MeshStandardMaterial({
        color: colorOf(token),
        roughness: 0.75,
        metalness: 0,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
    );
  }

  /** Roof cap in the category's dark variant. */
  blockCap(token: SwatchToken): THREE.MeshStandardMaterial {
    return this.solid(darkVariant(token), 0.75);
  }

  /** Block outline at half opacity. */
  blockEdges(token: SwatchToken): THREE.LineBasicMaterial {
    return this.shared(`edges:${token}`, () =>
      new THREE.LineBasicMaterial({
        color: colorOf(edgeToken(token)),
        transparent: true,
        opacity: 0.5,
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

  /** Faint volume inside a gap so its extent reads from any angle. */
  gapFill(): THREE.MeshBasicMaterial {
    return this.shared('gap:fill', () =>
      new THREE.MeshBasicMaterial({
        color: colorOf('slateLight'),
        transparent: true,
        opacity: 0.06,
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

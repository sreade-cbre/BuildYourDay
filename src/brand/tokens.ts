// Turner & Townsend brand tokens. This is the only file in src/ allowed to
// contain hex color literals. styles.css mirrors these values as CSS custom
// properties with the same names, and tests/brand.test.ts keeps the two in sync.

/** Base palette plus the derived tints and shades (spec sections 5.1 and 5.2). */
export const tokens = {
  navy: '#1E4479',
  blue: '#0090DC',
  slate: '#505A60',
  white: '#FFFFFF',
  lightGray: '#F5F5F5',

  navyLight: '#788FAF',
  navyPale: '#BCC7D7',
  navyDark: '#153055',
  blueLight: '#66BCEA',
  bluePale: '#B2DEF4',
  blueDark: '#00659A',
  slateLight: '#969CA0',
  slatePale: '#CACED0',
  slateDark: '#383F43',
} as const;

/**
 * The two colors outside the brand palette (spec section 5.3). Grass is
 * used for grass only, in either palette mode. Hi-vis is used for worker
 * vests and site cones only, in the opt-in accents mode.
 */
export const accentTokens = {
  grass: '#7FA86B',
  hiVis: '#F28C28',
} as const;

export type TokenName = keyof typeof tokens;
export type AccentTokenName = keyof typeof accentTokens;
export type AnyTokenName = TokenName | AccentTokenName;

/** Hex value for any token, strict or accent. */
export function tokenHex(name: AnyTokenName): string {
  return name in tokens ? tokens[name as TokenName] : accentTokens[name as AccentTokenName];
}

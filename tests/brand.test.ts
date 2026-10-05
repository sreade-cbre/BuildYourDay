import { describe, expect, it } from 'vitest';
import { accentTokens, tokens } from '../src/brand/tokens';

// Brand guard rails (spec sections 5.2 and 22.1).

const sources = import.meta.glob(['../src/**/*.ts', '../src/**/*.css'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// A glob never includes the file doing the importing, so this test covers the
// other test files and tests/writing.test.ts covers this one.
const testSources = import.meta.glob('../tests/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const TOKENS_FILE = '../src/brand/tokens.ts';
const HEX = /#[0-9a-fA-F]{3,8}\b/;
// Built from character codes so this file holds no dash characters itself.
const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

function findAll(files: Record<string, string>, pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const [path, text] of Object.entries(files)) {
    text.split('\n').forEach((line, index) => {
      if (pattern.test(line)) hits.push(`${path}:${index + 1}: ${line.trim()}`);
    });
  }
  return hits;
}

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

describe('brand rules', () => {
  it('scans real, non-empty files', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(10);
    expect(Object.keys(sources)).toContain(TOKENS_FILE);
    expect(Object.keys(sources)).toContain('../src/styles.css');
    // An empty file here would mean the loader stubbed it and the scan saw nothing.
    const empty = Object.entries({ ...sources, ...testSources })
      .filter(([, text]) => text.trim().length === 0)
      .map(([path]) => path);
    expect(empty).toEqual([]);
  });

  it('has no hex color literals in src outside tokens.ts', () => {
    const others = Object.fromEntries(Object.entries(sources).filter(([path]) => path !== TOKENS_FILE));
    expect(findAll(others, HEX)).toEqual([]);
  });

  it('has no em dashes or en dashes in src', () => {
    expect(findAll(sources, DASHES)).toEqual([]);
  });

  it('has no em dashes or en dashes in the other test files', () => {
    expect(Object.keys(testSources)).toContain('./writing.test.ts');
    expect(findAll(testSources, DASHES)).toEqual([]);
  });
});

describe('brand tokens', () => {
  const css = sources['../src/styles.css'] ?? '';
  const all = { ...tokens, ...accentTokens };

  it('mirrors every token in styles.css with the same name and value', () => {
    for (const [name, hex] of Object.entries(all)) {
      const match = new RegExp(`--${name}:\\s*rgb\\((\\d+) (\\d+) (\\d+)\\);`).exec(css);
      expect(match, `--${name} is missing from styles.css`).not.toBeNull();
      expect(match!.slice(1, 4).map(Number), `--${name} does not match tokens.ts`).toEqual(hexToRgb(hex));
    }
  });

  it('derives tints and shades from the base colors as the spec states', () => {
    const mix = (hex: string, toward: number, amount: number) =>
      hexToRgb(hex).map((c) => c + (toward - c) * amount);
    const close = (actual: string, expected: number[]) =>
      hexToRgb(actual).forEach((c, i) => expect(Math.abs(c - expected[i]!)).toBeLessThanOrEqual(1));

    for (const base of ['navy', 'blue', 'slate'] as const) {
      close(tokens[`${base}Light`], mix(tokens[base], 255, 0.4));
      close(tokens[`${base}Pale`], mix(tokens[base], 255, 0.7));
      close(tokens[`${base}Dark`], mix(tokens[base], 0, 0.3));
    }
  });
});

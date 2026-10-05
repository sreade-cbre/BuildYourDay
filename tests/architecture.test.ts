import { describe, expect, it } from 'vitest';

// Architecture rules from spec section 19: core/ is pure, with no three
// imports, no DOM access, and no dependency on the scene or UI layers.

const core = import.meta.glob('../src/core/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const FORBIDDEN: Array<[string, RegExp]> = [
  ['three import', /from\s+['"]three/],
  ['scene, ui, or anim import', /from\s+['"]\.\.\/(scene|ui|anim)\//],
  ['DOM global', /\b(window|document|navigator|localStorage|sessionStorage)\.[A-Za-z_$]/],
  ['DOM type or API', /\b(HTMLElement|HTMLCanvasElement|requestAnimationFrame|getComputedStyle)\b/],
];

/** Code only, so prose such as "the day window." in comments does not count. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('core purity', () => {
  it('finds the core modules', () => {
    expect(Object.keys(core).length).toBeGreaterThanOrEqual(6);
  });

  for (const [label, pattern] of FORBIDDEN) {
    it(`has no ${label}`, () => {
      const hits = Object.entries(core)
        .filter(([, text]) => pattern.test(stripComments(text)))
        .map(([path]) => path);
      expect(hits).toEqual([]);
    });
  }
});

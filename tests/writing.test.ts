import { describe, expect, it } from 'vitest';

// Writing rules from spec appendix C that apply to the whole repo: no em
// dashes or en dashes in docs, tests, config, or the page shell.

const files = import.meta.glob(
  ['../*.md', '../*.html', '../*.ts', '../package.json', '../tsconfig.json', '../.gitignore', '../tests/**/*.ts'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

// Built from character codes so this file holds no dash characters itself.
const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

describe('writing rules', () => {
  it('scans the docs, config, and tests', () => {
    for (const path of ['../README.md', '../DECISIONS.md', '../TIME_TOWER_SPEC.md', '../index.html', './brand.test.ts']) {
      expect(Object.keys(files)).toContain(path);
    }
    const empty = Object.entries(files)
      .filter(([, text]) => text.trim().length === 0)
      .map(([path]) => path);
    expect(empty).toEqual([]);
  });

  it('has no em dashes or en dashes', () => {
    const hits: string[] = [];
    for (const [path, text] of Object.entries(files)) {
      text.split('\n').forEach((line, index) => {
        if (DASHES.test(line)) hits.push(`${path}:${index + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
});

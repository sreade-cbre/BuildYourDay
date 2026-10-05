import { describe, expect, it } from 'vitest';
import { hashString, mulberry32, rngFromString } from '../src/core/rng';

describe('rng', () => {
  it('repeats the same sequence for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('stays in [0, 1)', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 10_000; i++) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('gives different sequences for different block ids', () => {
    expect(rngFromString('b1')()).not.toBe(rngFromString('b2')());
  });

  it('hashes strings with FNV-1a', () => {
    expect(hashString('')).toBe(2166136261);
    expect(hashString('a')).toBe(3826002220);
  });
});

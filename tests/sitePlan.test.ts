import { describe, expect, it } from 'vitest';
import {
  LIFT_SECONDS,
  cladBands,
  facadeShare,
  frameSteps,
  levelsFor,
  phaseOrder,
  progress,
  roofLands,
  sitePhases,
  split,
} from '../src/anim/sitePlan';

describe('site plan', () => {
  it('fills the whole block with its phases, end to end, in order', () => {
    for (const first of [true, false]) {
      const seconds = 3600;
      const phases = sitePhases(seconds, first);
      const order = phaseOrder(first);
      let at = 0;
      for (const name of order) {
        const span = phases[name]!;
        expect(span.start).toBeCloseTo(at, 9);
        expect(span.end).toBeGreaterThan(span.start);
        at = span.end;
      }
      expect(at).toBeCloseTo(seconds, 9);
    }
    expect(phaseOrder(true)).toContain('excavate');
    expect(phaseOrder(false)).toContain('deck');
  });

  it('splits spans evenly and measures progress through them', () => {
    expect(split({ start: 10, end: 40 }, 3)).toEqual([
      { start: 10, end: 20 },
      { start: 20, end: 30 },
      { start: 30, end: 40 },
    ]);
    expect(progress({ start: 10, end: 20 }, 5)).toBe(0);
    expect(progress({ start: 10, end: 20 }, 15)).toBe(0.5);
    expect(progress({ start: 10, end: 20 }, 25)).toBe(1);
  });

  it('closes the facade band by band, from nothing to the whole block', () => {
    const phases = sitePhases(3600, true);
    expect(facadeShare(phases, 4, phases.scaffold.end)).toBe(0);
    let last = 0;
    for (let t = phases.clad.start; t <= phases.clad.end; t += 5) {
      const share = facadeShare(phases, 4, t);
      expect(share).toBeGreaterThanOrEqual(last - 1e-12);
      last = share;
    }
    expect(facadeShare(phases, 4, phases.clad.end)).toBe(1);
    expect(facadeShare(phases, 4, phases.strike.end)).toBe(1);
  });

  it('never has two crane lifts at once, for any block, slot, or speed', () => {
    for (const speed of [0.5, 1, 3]) {
      const lift = LIFT_SECONDS / speed;
      for (const slot of [5, 10, 15, 30]) {
        for (let minutes = slot; minutes <= 1080; minutes += slot * 3) {
          for (const first of [true, false]) {
            const phases = sitePhases(minutes * 60, first);
            const floors = minutes / slot;
            const lands = [
              ...frameSteps(phases, floors).map((s) => s.lands),
              ...cladBands(phases, floors).map((b) => b.lands),
              roofLands(phases),
            ];
            for (let i = 1; i < lands.length; i++) expect(lands[i]! - lift).toBeGreaterThan(lands[i - 1]!);
            // The first lift waits for the frame to start.
            expect(lands[0]! - lift).toBeGreaterThanOrEqual(phases.frame.start);
          }
        }
      }
    }
  });

  it('groups floors into at most 24 levels', () => {
    expect([1, 4, 24, 25, 96].map(levelsFor)).toEqual([1, 4, 24, 24, 24]);
  });
});

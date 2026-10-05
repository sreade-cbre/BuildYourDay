import { describe, expect, it } from 'vitest';
import { SAMPLE_DAY } from '../src/core/defaults';
import {
  DEMOLISH,
  MAX_BUILD_SECONDS,
  ROOF_LIFT,
  RUBBLE_EDGE,
  RUBBLE_MAX,
  ROOF_LEAD,
  craneBatch,
  crewSize,
  extendSchedule,
  panelLifts,
  phaseSchedule,
  relocateSchedule,
  rubbleGrid,
  shrinkDuration,
} from '../src/anim/jobs/schedule';
import { spanHeight } from '../src/core/layout';

describe('build schedule', () => {
  it('builds a 60 minute first block in 5.5 to 6.5 seconds at speed 1', () => {
    const { total } = phaseSchedule(spanHeight(60), true);
    expect(total).toBeGreaterThanOrEqual(5.5);
    expect(total).toBeLessThanOrEqual(6.5);
  });

  it('runs the phases in the order of spec 9.4', () => {
    const { at } = phaseSchedule(spanHeight(60), true);
    const order = [at.survey, at.prep, at.foundation, at.frame, at.scaffold, at.cladding, at.roof, at.cleanup];
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]!);
  });

  it('sizes the crew by block length', () => {
    expect([10, 15, 30, 60, 90, 120, 480].map(crewSize)).toEqual([1, 2, 3, 4, 5, 6, 6]);
  });

  it('lifts one floor at a time when there is time, and never more than six times', () => {
    expect(craneBatch(4, 1.2)).toBe(1);
    expect(craneBatch(1, 0.9)).toBe(1);
    // Six floors in 0.85 s: two lifts of three floors, not six rushed ones.
    expect(craneBatch(6, 0.85)).toBe(3);
    expect(craneBatch(32, 3.39)).toBe(6);
  });

  it('keeps panel lifts in sequence, between the frame and the roof, for any block', () => {
    for (const tight of [false, true]) for (const slot of [5, 10, 15, 30, 60]) {
      for (let minutes = slot; minutes <= 1080; minutes += slot) {
        const schedule = phaseSchedule(spanHeight(minutes), true, tight);
        const { at, d } = schedule;
        const floors = Math.max(1, Math.round(minutes / slot));
        const lifts = panelLifts(floors, schedule);
        expect(lifts.length).toBeLessThanOrEqual(6);
        expect(lifts[0]!.r0).toBe(0);
        expect(lifts.at(-1)!.r1).toBe(floors);
        let free = at.frame + d.frame;
        for (const lift of lifts) {
          expect(lift.start).toBeGreaterThanOrEqual(free - 1e-9);
          expect(lift.lands - lift.start).toBeGreaterThan(0.1);
          expect(lift.lands).toBeLessThan(lift.passes);
          free = lift.lands;
        }
        expect(free).toBeLessThanOrEqual(at.roof - ROOF_LEAD + 1e-9);
      }
    }
  });

  it('fills a demolished block with 0.4 cubes, growing them so there are never more than 400', () => {
    expect(rubbleGrid(0.75).edge).toBe(RUBBLE_EDGE);
    for (const minutes of [5, 15, 60, 180, 480, 1080]) {
      const grid = rubbleGrid(minutes * 0.05);
      expect(grid.count).toBeLessThanOrEqual(RUBBLE_MAX);
      expect(grid.count).toBe(grid.across * grid.across * grid.up);
      expect(grid.edge).toBeGreaterThanOrEqual(RUBBLE_EDGE);
    }
    expect(rubbleGrid(3).edge).toBeGreaterThan(RUBBLE_EDGE);
  });

  it('times a demolition as spec 11.1 does, whatever the height', () => {
    expect(DEMOLISH.rails).toBe(0.15);
    expect(DEMOLISH.contact).toBe(0.4);
    expect(DEMOLISH.rubbleEnd).toBe(1.1);
    expect(DEMOLISH.rubbleEnd - DEMOLISH.fadeStart).toBeCloseTo(0.3);
  });

  it('times a shrink at 0.9 s plus 0.2 s a floor, at most 2 s', () => {
    expect(shrinkDuration(1)).toBeCloseTo(1.1);
    expect(shrinkDuration(4)).toBeCloseTo(1.7);
    expect(shrinkDuration(12)).toBe(2);
  });

  it('runs an extend in order, with roof work only at the top', () => {
    for (const top of [true, false]) {
      const { at, d, total } = extendSchedule(1.5, top);
      expect(at.cladding).toBeGreaterThan(at.frame);
      expect(at.strike).toBeGreaterThan(at.cladding);
      expect(at.cleanup + d.cleanup).toBeCloseTo(total);
      expect(d.capOff > 0).toBe(top);
    }
    expect(extendSchedule(1.5, true).total).toBeGreaterThan(extendSchedule(1.5, false).total);
  });

  it('keeps a relocation short and lets longer trips take a little longer', () => {
    const near = relocateSchedule(3);
    const far = relocateSchedule(30);
    expect(near.total).toBeLessThan(far.total);
    expect(far.total).toBeLessThan(2.2);
  });

  it('builds an 8 hour block in about 9.8 s and nothing longer (spec 18)', () => {
    expect(phaseSchedule(spanHeight(480), true).total).toBeCloseTo(9.8, 5);
    for (const tight of [false, true]) {
      for (let minutes = 5; minutes <= 1080; minutes += 5) {
        expect(phaseSchedule(spanHeight(minutes), true, tight).total).toBeLessThanOrEqual(MAX_BUILD_SECONDS + 1e-9);
      }
    }
    // Blocks under the cap keep their own length.
    expect(phaseSchedule(spanHeight(240), true).total).toBeCloseTo(8.86, 2);
  });

  it('runs a rapid sequence tighter, but sets the roof only once the facade is up', () => {
    for (let minutes = 5; minutes <= 1080; minutes += 5) {
      const usual = phaseSchedule(spanHeight(minutes), false);
      const tight = phaseSchedule(spanHeight(minutes), false, true);
      // Both stop at the cap for the longest blocks.
      if (usual.total < MAX_BUILD_SECONDS - 1e-6) expect(tight.total).toBeLessThan(usual.total);
      else expect(tight.total).toBeLessThanOrEqual(usual.total + 1e-9);
      expect(tight.at.roof - ROOF_LEAD + ROOF_LIFT).toBeGreaterThanOrEqual(tight.at.cladding + tight.d.cladding);
    }
  });

  it('loads the sample day in under 15 s at speed 2.5 (spec 20)', () => {
    const seconds = SAMPLE_DAY.reduce((sum, block, i) => sum + phaseSchedule(spanHeight(block.end - block.start), i === 0, true).total, 0) / 2.5;
    expect(seconds).toBeLessThan(15);
  });
});


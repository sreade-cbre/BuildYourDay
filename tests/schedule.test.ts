import { describe, expect, it } from 'vitest';
import { ROOF_LEAD, craneBatch, crewSize, panelLifts, phaseSchedule } from '../src/anim/jobs/schedule';
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
    for (const slot of [5, 10, 15, 30, 60]) {
      for (let minutes = slot; minutes <= 1080; minutes += slot) {
        const schedule = phaseSchedule(spanHeight(minutes), true);
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
});

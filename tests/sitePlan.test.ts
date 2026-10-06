import { describe, expect, it } from 'vitest';
import {
  LIFT_SECONDS,
  activity,
  facadeShare,
  frameShare,
  levelsFor,
  phaseOrder,
  progress,
  siteSchedule,
  sitePhases,
  split,
} from '../src/anim/sitePlan';

describe('site plan', () => {
  it('runs the groundworks end to end, then overlaps the frame and the facade', () => {
    for (const first of [true, false]) {
      const phases = sitePhases(3600, first);
      const order = phaseOrder(first);
      let last = 0;
      for (const name of order) {
        const span = phases[name]!;
        expect(span.start).toBeGreaterThanOrEqual(last - 1e-9);
        expect(span.end).toBeGreaterThan(span.start);
        last = span.start;
      }
      expect(phases.strike.end).toBeCloseTo(3600, 9);
      // The facade starts while the frame is still going up.
      expect(phases.clad.start).toBeLessThan(phases.frame.end);
      expect(phases.roof.start).toBeGreaterThanOrEqual(phases.clad.end);
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

  it('closes each band of facade only once its floors are framed', () => {
    for (const first of [true, false]) {
      for (const floors of [1, 2, 3, 4, 6, 12, 32, 96]) {
        const schedule = siteSchedule(floors * 15 * 60, first, floors);
        const levels = levelsFor(floors);
        schedule.bands.forEach((band, b) => {
          const topFloor = Math.min(floors, Math.ceil(((b + 1) * floors) / levels)) - 1;
          expect(band.closes.start).toBeGreaterThan(schedule.frame[topFloor]!.end);
        });
      }
    }
  });

  it('keeps the building rising through the block once the frame starts', () => {
    const schedule = siteSchedule(5400, false, 6);
    const { phases } = schedule;
    let lastFrame = 0;
    let lastFacade = 0;
    for (let t = 0; t <= 5400; t += 30) {
      const frame = frameShare(schedule, t);
      const facade = facadeShare(schedule, t);
      expect(frame).toBeGreaterThanOrEqual(lastFrame - 1e-12);
      expect(facade).toBeGreaterThanOrEqual(lastFacade - 1e-12);
      // The facade never gets ahead of the frame.
      expect(facade).toBeLessThanOrEqual(frame + 1e-9);
      lastFrame = frame;
      lastFacade = facade;
    }
    // A third of the way in, some of the facade already stands.
    expect(facadeShare(schedule, 0.4 * 5400)).toBeGreaterThan(0);
    expect(facadeShare(schedule, phases.clad.end)).toBe(1);
  });

  it('never has two crane lifts at once, for any block, slot, or speed', () => {
    for (const speed of [0.5, 1, 3]) {
      const lift = LIFT_SECONDS / speed;
      for (const slot of [5, 10, 15, 30]) {
        for (let minutes = slot; minutes <= 1080; minutes += slot * 3) {
          for (const first of [true, false]) {
            const schedule = siteSchedule(minutes * 60, first, minutes / slot, lift, 3 / speed);
            const lands = [...schedule.frame.map((s) => s.lands), ...schedule.bands.map((b) => b.lands), schedule.roofLands].sort((a, b) => a - b);
            for (let i = 1; i < lands.length; i++) expect(lands[i]! - lift).toBeGreaterThan(lands[i - 1]!);
            expect(lands[0]! - lift).toBeGreaterThanOrEqual(schedule.phases.frame.start - 1e-9);
            expect(lands.at(-1)!).toBeLessThan(schedule.phases.strike.start);
          }
        }
      }
    }
  });

  it('names what the crew is doing', () => {
    const schedule = siteSchedule(3600, true, 4);
    expect(activity(schedule, 30)).toBe('setting out');
    expect(activity(schedule, 0.05 * 3600)).toBe('clearing');
    expect(activity(schedule, 0.1 * 3600)).toBe('digging');
    expect(activity(schedule, 0.15 * 3600)).toBe('footings');
    expect(activity(schedule, 0.2 * 3600)).toBe('framing');
    expect(activity(schedule, 0.5 * 3600)).toBe('framing');
    expect(activity(schedule, 0.8 * 3600)).toBe('cladding');
    expect(activity(schedule, 0.93 * 3600)).toBe('roofing');
    expect(activity(schedule, 0.97 * 3600)).toBe('striking');
    const stacked = siteSchedule(3600, false, 4);
    expect([0.04, 0.08].map((share) => activity(stacked, share * 3600))).toEqual(['setting up', 'floor pour']);
  });

  it('groups floors into at most 24 levels', () => {
    expect([1, 4, 24, 25, 96].map(levelsFor)).toEqual([1, 4, 24, 24, 24]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  LIFT_SECONDS,
  PICK,
  YARD,
  activity,
  facadeShare,
  levelsFor,
  phaseOrder,
  progress,
  siteSchedule,
  sitePhases,
  split,
  stock,
  type StockKind,
} from '../src/anim/sitePlan';

/** Every program the tests check: block lengths and slots, first and stacked. */
function* programs() {
  for (const slot of [5, 15, 30]) {
    for (const minutes of [slot, 30, 60, 90, 180, 480]) {
      if (minutes % slot !== 0) continue;
      for (const first of [true, false]) yield { minutes, slot, first, floors: minutes / slot };
    }
  }
}

describe('site plan', () => {
  it('runs the groundworks end to end, then overlaps the frame and the facade', () => {
    for (const first of [true, false]) {
      const phases = sitePhases(3600, first);
      let last = 0;
      for (const name of phaseOrder(first)) {
        const span = phases[name]!;
        expect(span.start).toBeGreaterThanOrEqual(last - 1e-9);
        expect(span.end).toBeGreaterThan(span.start);
        last = span.start;
      }
      expect(phases.strike.end).toBeCloseTo(3600, 9);
      expect(phases.clad.start).toBeLessThan(phases.frame.end);
      expect(phases.roof.start).toBeGreaterThanOrEqual(phases.clad.end);
    }
  });

  it('splits spans evenly and measures progress through them', () => {
    expect(split({ start: 10, end: 40 }, 3)).toEqual([
      { start: 10, end: 20 },
      { start: 20, end: 30 },
      { start: 30, end: 40 },
    ]);
    expect(progress({ start: 10, end: 20 }, 15)).toBe(0.5);
  });

  it('never has two crane lifts at once, and ends them before the time is up', () => {
    for (const speed of [0.5, 1, 3]) {
      for (const { minutes, first, floors } of programs()) {
        const schedule = siteSchedule(minutes * 60, first, floors, LIFT_SECONDS / speed, 4 / speed);
        const lifts = [...schedule.lifts].sort((a, b) => a.start - b.start);
        for (let i = 1; i < lifts.length; i++) expect(lifts[i]!.start).toBeGreaterThanOrEqual(lifts[i - 1]!.lands + schedule.craneReturn - 1e-6);
        expect(lifts.at(-1)!.lands).toBeLessThan(minutes * 60);
      }
    }
  });

  it('puts each floor together in order: columns, beams, then the deck', () => {
    for (const { minutes, first, floors } of programs()) {
      const schedule = siteSchedule(minutes * 60, first, floors);
      for (const floor of schedule.frame) {
        const order = [...floor.columns, ...floor.beams, floor.deck];
        for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]!);
      }
      for (let k = 1; k < schedule.frame.length; k++) expect(schedule.frame[k]!.columns[0]).toBeGreaterThan(schedule.frame[k - 1]!.deck);
    }
  });

  it('closes each band of facade only once its floors are framed, bottom band first', () => {
    for (const { minutes, first, floors } of programs()) {
      const schedule = siteSchedule(minutes * 60, first, floors);
      const levels = levelsFor(floors);
      schedule.bands.forEach((band, b) => {
        const top = Math.min(floors, Math.ceil(((b + 1) * floors) / levels)) - 1;
        expect(band.closes.start).toBeGreaterThan(schedule.frame[top]!.laid);
        if (b > 0) expect(band.closes.start).toBeGreaterThanOrEqual(schedule.bands[b - 1]!.closes.end - 1e-6);
      });
      expect(schedule.roofLands).toBeGreaterThan(schedule.bands.at(-1)!.closes.end);
    }
  });

  it('keeps the yard stocked, and ends the block with the stock it opened with', () => {
    for (const { minutes, first, floors } of programs()) {
      const schedule = siteSchedule(minutes * 60, first, floors);
      for (const kind of Object.keys(YARD) as StockKind[]) {
        expect(stock(schedule, kind, 0)).toBe(YARD[kind].opening);
        for (const lift of schedule.lifts.filter((l) => l.kind === kind)) {
          expect(stock(schedule, kind, lift.start + PICK * schedule.lift - 1e-3)).toBeGreaterThanOrEqual(YARD[kind].reserve + 1);
        }
        for (let t = 0; t <= schedule.seconds; t += 5) expect(stock(schedule, kind, t)).toBeLessThanOrEqual(YARD[kind].capacity);
        expect(stock(schedule, kind, schedule.seconds)).toBe(YARD[kind].opening);
      }
    }
  });

  it('sends one truck and one mixer at a time', () => {
    for (const { minutes, first, floors } of programs()) {
      const schedule = siteSchedule(minutes * 60, first, floors);
      for (let i = 1; i < schedule.deliveries.length; i++) expect(schedule.deliveries[i]!.arrives).toBeGreaterThanOrEqual(schedule.deliveries[i - 1]!.leaves);
      for (let i = 1; i < schedule.pours.length; i++) expect(schedule.pours[i]!.visit.start).toBeGreaterThanOrEqual(schedule.pours[i - 1]!.visit.end - 1e-6);
    }
  });

  it('keeps the crane busy for most of the frame and the facade', () => {
    for (const { minutes, first, floors } of programs()) {
      if (minutes < 30) continue;
      const schedule = siteSchedule(minutes * 60, first, floors);
      const window = { start: schedule.phases.frame.start, end: schedule.phases.clad.end };
      // Lifting, or swinging back for the next load.
      const busy = schedule.lifts.reduce((sum, l) => sum + Math.max(0, Math.min(l.lands + schedule.craneReturn, window.end) - Math.max(l.start, window.start)), 0);
      expect(busy / (window.end - window.start)).toBeGreaterThan(0.6);
    }
  });

  it('closes the facade steadily from nothing to the whole block', () => {
    const schedule = siteSchedule(5400, false, 6);
    let last = 0;
    for (let t = 0; t <= 5400; t += 20) {
      const share = facadeShare(schedule, t);
      expect(share).toBeGreaterThanOrEqual(last - 1e-12);
      last = share;
    }
    expect(facadeShare(schedule, 0.4 * 5400)).toBeGreaterThan(0);
    expect(facadeShare(schedule, 5400)).toBe(1);
  });

  it('names what the crew is doing', () => {
    const schedule = siteSchedule(3600, true, 4);
    expect(activity(schedule, 30)).toBe('setting out');
    expect(activity(schedule, 0.05 * 3600)).toBe('clearing');
    expect(activity(schedule, 0.1 * 3600)).toBe('digging');
    expect(activity(schedule, 0.15 * 3600)).toBe('footings');
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

import { describe, expect, it } from 'vitest';
import { SAMPLE_DAY, defaultSettings } from '../src/core/defaults';
import {
  UNITS_PER_MINUTE,
  canPlace,
  computeGaps,
  minutesToY,
  nextFreeRange,
  totals,
  towerHeight,
  yToMinutes,
} from '../src/core/layout';
import type { Block, Settings } from '../src/core/model';

function settings(patch: Partial<Settings> = {}): Settings {
  return { ...defaultSettings(), ...patch };
}

let nextId = 0;
function block(start: number, end: number, categoryId = 'deep'): Block {
  nextId += 1;
  return { id: `t${nextId}`, title: '', start, end, categoryId, createdAt: 0 };
}

const sample: Block[] = SAMPLE_DAY.map((b, i) => ({ ...b, id: `s${i}`, createdAt: 0 }));

describe('minutesToY and yToMinutes', () => {
  const s = settings();

  it('puts dayStart at y = 0 and scales by UNITS_PER_MINUTE', () => {
    expect(minutesToY(420, s)).toBe(0);
    expect(minutesToY(480, s)).toBeCloseTo(3.0);
    expect(minutesToY(1080, s)).toBeCloseTo(33.0);
    expect(UNITS_PER_MINUTE * 60).toBeCloseTo(3.0);
  });

  it('round trips every slot boundary in the window', () => {
    for (let m = s.dayStart; m <= s.dayEnd; m += 5) {
      expect(yToMinutes(minutesToY(m, s), s)).toBeCloseTo(m, 9);
    }
  });

  it('measures the full window for camera framing', () => {
    expect(towerHeight(s)).toBeCloseTo(33.0);
    expect(towerHeight(settings({ dayStart: 0, dayEnd: 1080 }))).toBeCloseTo(54.0);
  });

  it('makes a 90 minute block three times as tall as a 30 minute block', () => {
    const tall = minutesToY(540, s) - minutesToY(450, s);
    const short = minutesToY(570, s) - minutesToY(540, s);
    expect(tall / short).toBeCloseTo(3);
  });
});

describe('computeGaps', () => {
  const s = settings();

  it('returns the whole window for an empty day', () => {
    expect(computeGaps([], s)).toEqual([{ start: 420, end: 1080 }]);
  });

  it('returns gaps on both sides of one block', () => {
    expect(computeGaps([block(600, 660)], s)).toEqual([
      { start: 420, end: 600 },
      { start: 660, end: 1080 },
    ]);
  });

  it('finds every gap in the sample day', () => {
    expect(computeGaps(sample, s)).toEqual([
      { start: 420, end: 450 },
      { start: 570, end: 600 },
      { start: 810, end: 900 },
      { start: 1020, end: 1080 },
    ]);
  });

  it('leaves no gap between adjacent blocks', () => {
    expect(computeGaps([block(600, 660), block(660, 720)], s)).toEqual([
      { start: 420, end: 600 },
      { start: 720, end: 1080 },
    ]);
  });

  it('leaves no end gaps when blocks touch the window ends', () => {
    expect(computeGaps([block(420, 480), block(1020, 1080)], s)).toEqual([{ start: 480, end: 1020 }]);
  });

  it('returns nothing for a full day', () => {
    expect(computeGaps([block(420, 750), block(750, 1080)], s)).toEqual([]);
  });

  it('accepts unsorted input', () => {
    expect(computeGaps([block(900, 960), block(480, 540)], s)).toEqual([
      { start: 420, end: 480 },
      { start: 540, end: 900 },
      { start: 960, end: 1080 },
    ]);
  });

  it('clips blocks that poke outside the window and ignores blocks fully outside', () => {
    expect(computeGaps([block(360, 450), block(1020, 1140), block(1200, 1260)], s)).toEqual([
      { start: 450, end: 1020 },
    ]);
  });
});

describe('totals', () => {
  const s = settings();

  it('sums the sample day by category', () => {
    const t = totals(sample, s);
    expect(t.plannedMinutes).toBe(450);
    expect(t.freeMinutes).toBe(210);
    expect(t.byCategory).toEqual({ deep: 240, meet: 120, admin: 90 });
  });

  it('lists every category with 0 on an empty day', () => {
    const t = totals([], s);
    expect(t.plannedMinutes).toBe(0);
    expect(t.freeMinutes).toBe(660);
    expect(t.byCategory).toEqual({ deep: 0, meet: 0, admin: 0 });
  });

  it('counts only the part of a block inside the window', () => {
    const t = totals([block(360, 480, 'meet')], s);
    expect(t.plannedMinutes).toBe(60);
    expect(t.freeMinutes).toBe(600);
    expect(t.byCategory.meet).toBe(60);
  });
});

describe('canPlace', () => {
  const s = settings();
  const existing = [block(600, 660), block(720, 780)];

  it('rejects any overlap', () => {
    expect(canPlace(existing, block(630, 690), s)).toBe(false);
    expect(canPlace(existing, block(570, 615), s)).toBe(false);
    expect(canPlace(existing, block(600, 660), s)).toBe(false);
    expect(canPlace(existing, block(540, 840), s)).toBe(false);
    expect(canPlace(existing, block(615, 645), s)).toBe(false);
  });

  it('allows blocks that touch neighbors', () => {
    expect(canPlace(existing, block(660, 720), s)).toBe(true);
    expect(canPlace(existing, block(540, 600), s)).toBe(true);
  });

  it('allows the exact window edges and rejects anything beyond', () => {
    expect(canPlace([], block(420, 480), s)).toBe(true);
    expect(canPlace([], block(1020, 1080), s)).toBe(true);
    expect(canPlace([], block(405, 480), s)).toBe(false);
    expect(canPlace([], block(1020, 1095), s)).toBe(false);
  });

  it('rejects empty, reversed, and fractional spans', () => {
    expect(canPlace([], block(600, 600), s)).toBe(false);
    expect(canPlace([], block(660, 600), s)).toBe(false);
    expect(canPlace([], block(600.5, 660), s)).toBe(false);
  });

  it('ignores the block being edited', () => {
    const first = existing[0]!;
    expect(canPlace(existing, { id: first.id, start: 615, end: 690 }, s)).toBe(true);
    expect(canPlace(existing, { id: first.id, start: 615, end: 735 }, s)).toBe(false);
  });
});

describe('nextFreeRange', () => {
  const s = settings();

  it('offers the whole window on an empty day', () => {
    expect(nextFreeRange([], s, 15)).toEqual({ start: 420, end: 1080 });
  });

  it('prefers the range above the last block', () => {
    expect(nextFreeRange(sample, s, 15)).toEqual({ start: 1020, end: 1080 });
  });

  it('falls back to the earliest gap when the top is full', () => {
    const blocks = [block(480, 540), block(600, 1080)];
    expect(nextFreeRange(blocks, s, 15)).toEqual({ start: 420, end: 480 });
  });

  it('skips gaps shorter than the minimum', () => {
    const blocks = [block(420, 600), block(615, 900), block(960, 1080)];
    expect(nextFreeRange(blocks, s, 15)).toEqual({ start: 600, end: 615 });
    expect(nextFreeRange(blocks, s, 30)).toEqual({ start: 900, end: 960 });
  });

  it('returns null when the day is full', () => {
    expect(nextFreeRange([block(420, 1080)], s, 15)).toBeNull();
    expect(nextFreeRange([block(420, 600), block(600, 1080)], s, 15)).toBeNull();
  });

  it('returns null when the last block ends at dayEnd and no other gap fits', () => {
    expect(nextFreeRange([block(420, 1075)], settings({ slotMinutes: 5 }), 15)).toBeNull();
  });

  it('trims gaps left by a finer slot to the current slot', () => {
    const blocks = [block(420, 605), block(650, 1080)];
    expect(nextFreeRange(blocks, s, 15)).toEqual({ start: 615, end: 645 });
  });
});

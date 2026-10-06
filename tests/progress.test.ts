import { describe, expect, it } from 'vitest';
import { buildProgress, buildState, nextChange } from '../src/core/progress';

const TODAY = '2026-10-06';
const block = (start: number, end: number) => ({ start, end });

describe('buildState', () => {
  it('follows the clock on today', () => {
    const b = block(540, 600);
    expect(buildState(b, TODAY, { today: TODAY, minutes: 539.9 })).toBe('planned');
    expect(buildState(b, TODAY, { today: TODAY, minutes: 540 })).toBe('building');
    expect(buildState(b, TODAY, { today: TODAY, minutes: 599.99 })).toBe('building');
    expect(buildState(b, TODAY, { today: TODAY, minutes: 600 })).toBe('built');
  });

  it('treats earlier days as done and later days as planned', () => {
    const b = block(540, 600);
    expect(buildState(b, '2026-10-05', { today: TODAY, minutes: 0 })).toBe('built');
    expect(buildState(b, '2026-10-07', { today: TODAY, minutes: 1439 })).toBe('planned');
    expect(buildState(b, '2025-12-31', { today: '2026-01-01', minutes: 0 })).toBe('built');
  });
});

describe('buildProgress', () => {
  it('runs from 0 at the start to 1 at the end and stays in range', () => {
    const b = block(540, 600);
    expect(buildProgress(b, 500)).toBe(0);
    expect(buildProgress(b, 540)).toBe(0);
    expect(buildProgress(b, 570)).toBe(0.5);
    expect(buildProgress(b, 600)).toBe(1);
    expect(buildProgress(b, 700)).toBe(1);
  });
});

describe('nextChange', () => {
  it('finds the next start or end after a minute', () => {
    const blocks = [block(540, 600), block(600, 660), block(720, 750)];
    expect(nextChange(blocks, 500)).toBe(540);
    expect(nextChange(blocks, 540)).toBe(600);
    expect(nextChange(blocks, 610.5)).toBe(660);
    expect(nextChange(blocks, 700)).toBe(720);
    expect(nextChange(blocks, 750)).toBeNull();
    expect(nextChange([], 0)).toBeNull();
  });
});

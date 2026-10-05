import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../src/core/defaults';
import type { Settings, SlotMinutes } from '../src/core/model';
import {
  addDays,
  ceilToSlot,
  floorToSlot,
  formatDateTitle,
  formatDuration,
  formatDurationLong,
  formatTime,
  formatTimeShort,
  isIsoDate,
  isOnSlot,
  nowMinutes,
  snapToSlot,
  toIsoDate,
} from '../src/core/time';

function settings(patch: Partial<Settings> = {}): Settings {
  return { ...defaultSettings(), ...patch };
}

describe('snapToSlot', () => {
  const slots: SlotMinutes[] = [5, 10, 15, 30];

  for (const slot of slots) {
    it(`snaps to the nearest ${slot} minute boundary`, () => {
      const s = settings({ slotMinutes: slot, dayStart: 0, dayEnd: 1080 });
      for (let base = 0; base < 1080; base += slot) {
        expect(snapToSlot(base, s)).toBe(base);
        expect(snapToSlot(base + slot * 0.49, s)).toBe(base);
        expect(snapToSlot(base + slot * 0.5, s)).toBe(base + slot);
        expect(snapToSlot(base + slot * 0.51, s)).toBe(base + slot);
      }
    });
  }

  it('clamps to the day window', () => {
    const s = settings({ slotMinutes: 15, dayStart: 420, dayEnd: 1080 });
    expect(snapToSlot(0, s)).toBe(420);
    expect(snapToSlot(419, s)).toBe(420);
    expect(snapToSlot(1080, s)).toBe(1080);
    expect(snapToSlot(1200, s)).toBe(1080);
    expect(Object.is(snapToSlot(-3, settings({ dayStart: 0, dayEnd: 600 })), 0)).toBe(true);
  });

  it('keeps unsnapped fractional input on the grid', () => {
    const s = settings({ slotMinutes: 10 });
    expect(snapToSlot(605.001, s)).toBe(610);
    expect(snapToSlot(604.999, s)).toBe(600);
  });
});

describe('slot helpers', () => {
  it('detects slot boundaries', () => {
    expect(isOnSlot(450, 15)).toBe(true);
    expect(isOnSlot(455, 15)).toBe(false);
    expect(isOnSlot(455, 5)).toBe(true);
    expect(isOnSlot(450.5, 5)).toBe(false);
  });

  it('floors and ceils to slots', () => {
    expect(floorToSlot(457, 15)).toBe(450);
    expect(ceilToSlot(457, 15)).toBe(465);
    expect(ceilToSlot(450, 15)).toBe(450);
  });
});

describe('formatTime', () => {
  const h12 = settings({ timeFormat: '12h' });
  const h24 = settings({ timeFormat: '24h' });

  it('formats 12h times including noon and midnight', () => {
    expect(formatTime(0, h12)).toBe('12:00 AM');
    expect(formatTime(5, h12)).toBe('12:05 AM');
    expect(formatTime(420, h12)).toBe('7:00 AM');
    expect(formatTime(450, h12)).toBe('7:30 AM');
    expect(formatTime(719, h12)).toBe('11:59 AM');
    expect(formatTime(720, h12)).toBe('12:00 PM');
    expect(formatTime(765, h12)).toBe('12:45 PM');
    expect(formatTime(780, h12)).toBe('1:00 PM');
    expect(formatTime(1439, h12)).toBe('11:59 PM');
    expect(formatTime(1440, h12)).toBe('12:00 AM');
  });

  it('formats 24h times including noon and midnight', () => {
    expect(formatTime(0, h24)).toBe('00:00');
    expect(formatTime(450, h24)).toBe('07:30');
    expect(formatTime(720, h24)).toBe('12:00');
    expect(formatTime(1395, h24)).toBe('23:15');
    expect(formatTime(1440, h24)).toBe('24:00');
  });

  it('has a short form for in-scene labels', () => {
    expect(formatTimeShort(450, h12)).toBe('7:30');
    expect(formatTimeShort(780, h12)).toBe('1:00');
    expect(formatTimeShort(720, h12)).toBe('12:00');
    expect(formatTimeShort(450, h24)).toBe('07:30');
  });
});

describe('formatDuration', () => {
  it('formats the reference durations', () => {
    expect(formatDuration(5)).toBe('5m');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(90)).toBe('1h 30m');
    expect(formatDuration(135)).toBe('2h 15m');
    expect(formatDuration(480)).toBe('8h');
  });

  it('handles zero', () => {
    expect(formatDuration(0)).toBe('0m');
  });

  it('has a long form for screen readers', () => {
    expect(formatDurationLong(450)).toBe('7 hours 30 minutes');
    expect(formatDurationLong(60)).toBe('1 hour');
    expect(formatDurationLong(61)).toBe('1 hour 1 minute');
    expect(formatDurationLong(45)).toBe('45 minutes');
    expect(formatDurationLong(0)).toBe('0 minutes');
  });
});

describe('dates', () => {
  it('formats the date title', () => {
    expect(formatDateTitle('2026-10-05')).toBe('Monday, October 5');
    expect(formatDateTitle('2027-01-01')).toBe('Friday, January 1');
  });

  it('adds days across month, year, leap day, and DST boundaries', () => {
    expect(addDays('2026-10-05', 1)).toBe('2026-10-06');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
  });

  it('validates ISO dates', () => {
    expect(isIsoDate('2026-10-05')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-1-5')).toBe(false);
    expect(isIsoDate('not a date')).toBe(false);
    expect(isIsoDate(20261005)).toBe(false);
  });

  it('uses local time, not UTC', () => {
    expect(toIsoDate(new Date(2026, 9, 5, 0, 1))).toBe('2026-10-05');
    expect(toIsoDate(new Date(2026, 9, 5, 23, 59))).toBe('2026-10-05');
  });
});

describe('nowMinutes', () => {
  it('counts minutes since local midnight, seconds as a fraction', () => {
    expect(nowMinutes(new Date(2026, 9, 5, 0, 0, 0))).toBe(0);
    expect(nowMinutes(new Date(2026, 9, 5, 10, 40, 30))).toBeCloseTo(640.5);
    expect(nowMinutes(new Date(2026, 9, 5, 23, 59, 0))).toBe(1439);
  });
});

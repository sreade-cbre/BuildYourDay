import type { IsoDate, Settings } from './model';

// Time and date helpers. Everything here works in local time: day keys are
// local ISO dates and no function uses UTC.

type SlotSettings = Pick<Settings, 'slotMinutes' | 'dayStart' | 'dayEnd'>;
type FormatSettings = Pick<Settings, 'timeFormat'>;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** True when `minutes` lies on a boundary of the given slot size. */
export function isOnSlot(minutes: number, slotMinutes: number): boolean {
  return Number.isInteger(minutes) && minutes % slotMinutes === 0;
}

export function floorToSlot(minutes: number, slotMinutes: number): number {
  return Math.floor(minutes / slotMinutes) * slotMinutes;
}

export function ceilToSlot(minutes: number, slotMinutes: number): number {
  return Math.ceil(minutes / slotMinutes) * slotMinutes;
}

/** Nearest slot boundary, clamped to the day window. */
export function snapToSlot(minutes: number, settings: SlotSettings): number {
  const snapped = Math.round(minutes / settings.slotMinutes) * settings.slotMinutes;
  // Adding 0 turns a possible -0 into 0.
  return clamp(snapped, settings.dayStart, settings.dayEnd) + 0;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** "7:30 AM" in 12h mode, "07:30" in 24h mode. 1440 is "12:00 AM" or "24:00". */
export function formatTime(minutes: number, settings: FormatSettings): string {
  const total = Math.round(minutes);
  const mm = pad2(((total % 60) + 60) % 60);
  if (settings.timeFormat === '24h') {
    return `${pad2(Math.floor(total / 60))}:${mm}`;
  }
  const h24 = ((Math.floor(total / 60) % 24) + 24) % 24;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${h24 < 12 ? 'AM' : 'PM'}`;
}

/**
 * Compact time for in-scene text where space is tight: "7:30" in 12h mode,
 * "07:30" in 24h mode (spec section 8.5 example "7:30 to 9:00").
 */
export function formatTimeShort(minutes: number, settings: FormatSettings): string {
  if (settings.timeFormat === '24h') return formatTime(minutes, settings);
  return formatTime(minutes, settings).replace(/ (AM|PM)$/, '');
}

/** "1h 30m", "45m", "2h". */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** "7 hours 30 minutes", "1 hour", "45 minutes". Used for screen reader text. */
export function formatDurationLong(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  const hours = `${h} ${h === 1 ? 'hour' : 'hours'}`;
  const mins = `${m} ${m === 1 ? 'minute' : 'minutes'}`;
  if (h === 0) return mins;
  if (m === 0) return hours;
  return `${hours} ${mins}`;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Local ISO date for a Date. */
export function toIsoDate(date: Date): IsoDate {
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function todayIso(now: Date = new Date()): IsoDate {
  return toIsoDate(now);
}

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string') return false;
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const date = parseIsoDate(value);
  return toIsoDate(date) === value;
}

/** Local noon on the given date. Noon keeps date math clear of DST jumps. */
export function parseIsoDate(iso: IsoDate): Date {
  const match = ISO_DATE.exec(iso);
  if (!match) throw new Error(`Not an ISO date: ${iso}`);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  const date = parseIsoDate(iso);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

/** "Monday, October 5". */
export function formatDateTitle(iso: IsoDate): string {
  const date = parseIsoDate(iso);
  return `${WEEKDAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

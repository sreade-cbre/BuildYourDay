import { LIMITS } from './defaults';
import type { Block, IsoDate, Settings, TimeRange } from './model';
import { ceilToSlot, floorToSlot, parseIsoDate, toIsoDate } from './time';

// Meetings from Outlook as blocks. The app reads a day of events from
// Microsoft Graph's calendarView; this module reads that reply and decides
// where each meeting goes on the tower, and the store applies the result
// with syncCalendarDay. Pure, so it is unit tested.
//
// Times are fixed: a meeting never moves or trims the user's own blocks. A
// meeting that would overlap one, or a firmer meeting, is left off and
// reported, so the user can make room.

/** An event as read from Graph, with its times as epoch milliseconds. */
export interface CalendarEvent {
  id: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  cancelled: boolean;
  /** free, tentative, busy, oof, workingElsewhere, or unknown. */
  showAs: string;
  /** none, organizer, tentativelyAccepted, accepted, declined, or notResponded. */
  response: string;
}

/** A meeting placed on the tower, ready for the store. */
export interface MeetingDraft {
  eventId: string;
  title: string;
  start: number;
  end: number;
}

export type SkipReason = 'overlap' | 'outsideWindow' | 'dayFull';

/** A meeting left off the tower, with its time on the day before snapping. */
export interface SkippedMeeting {
  eventId: string;
  title: string;
  start: number;
  end: number;
  reason: SkipReason;
  /** For an overlap, the title of the block or meeting in the way. */
  blockedBy?: string;
}

export interface MeetingPlan {
  placed: MeetingDraft[];
  skipped: SkippedMeeting[];
}

export interface GraphPage {
  events: CalendarEvent[];
  /** The next page of results, when Graph split the reply. */
  nextLink: string | null;
}

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const DAY_MINUTES = 1440;
/** Graph ids run to about 150 characters; anything far longer is not one. */
const MAX_EVENT_ID = 1024;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * The instant a Graph dateTimeTimeZone names, as epoch milliseconds. The app
 * asks Graph for UTC, so any other zone is refused rather than guessed.
 */
export function parseGraphDateTime(value: unknown): number | null {
  if (!isRecord(value) || typeof value.dateTime !== 'string') return null;
  const zone = value.timeZone;
  const match = DATE_TIME.exec(value.dateTime);
  if (!match) return null;
  const offset = match[8];
  if (!offset && zone !== undefined && zone !== 'UTC' && zone !== 'Etc/UTC') return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map((part) => Number(part ?? 0));
  const millis = Number(`0.${match[7] ?? '0'}`) * 1000;
  let ms = Date.UTC(year!, month! - 1, day!, hour!, minute!, second!, Math.round(millis));
  if (offset && offset !== 'Z') {
    const sign = offset.startsWith('-') ? -1 : 1;
    ms -= sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6))) * 60_000;
  }
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Reads one page of a calendarView reply. Events with a shape Graph would
 * never send are dropped; a reply that is not a page at all is null.
 */
export function parseGraphPage(raw: unknown): GraphPage | null {
  if (!isRecord(raw) || !Array.isArray(raw.value)) return null;
  const events: CalendarEvent[] = [];
  for (const entry of raw.value) {
    if (!isRecord(entry)) continue;
    const id = entry.id;
    if (typeof id !== 'string' || id === '' || id.length > MAX_EVENT_ID) continue;
    const start = parseGraphDateTime(entry.start);
    const end = parseGraphDateTime(entry.end);
    if (start === null || end === null) continue;
    const response = isRecord(entry.responseStatus) ? entry.responseStatus.response : undefined;
    events.push({
      id,
      title: typeof entry.subject === 'string' ? entry.subject : '',
      start,
      end,
      allDay: entry.isAllDay === true,
      cancelled: entry.isCancelled === true,
      showAs: typeof entry.showAs === 'string' ? entry.showAs : 'unknown',
      response: typeof response === 'string' ? response : 'none',
    });
  }
  const next = raw['@odata.nextLink'];
  return { events, nextLink: typeof next === 'string' && next !== '' ? next : null };
}

/** Local midnight at the start and end of a day, as ISO instants for calendarView. */
export function calendarViewRange(date: IsoDate): { start: string; end: string } {
  const noon = parseIsoDate(date);
  const start = new Date(noon.getFullYear(), noon.getMonth(), noon.getDate());
  const end = new Date(noon.getFullYear(), noon.getMonth(), noon.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * Wall clock minutes on `date` for an instant: 0 for anything before the day
 * and 1440 for anything after it, so a meeting that crosses midnight keeps
 * only its part of the day.
 */
export function minutesOnDay(ms: number, date: IsoDate): number {
  const when = new Date(ms);
  const day = toIsoDate(when);
  if (day < date) return 0;
  if (day > date) return DAY_MINUTES;
  return when.getHours() * 60 + when.getMinutes() + when.getSeconds() / 60;
}

/**
 * Whether an event belongs on the tower: a timed meeting that is still on,
 * not declined, and not marked free or as a place of work.
 */
export function isMeeting(event: CalendarEvent): boolean {
  if (event.allDay || event.cancelled || event.response === 'declined') return false;
  return event.showAs !== 'free' && event.showAs !== 'workingElsewhere';
}

/** Firm meetings claim their time first, then tentative ones, then unanswered invites. */
function firmness(event: CalendarEvent): number {
  if (event.response === 'tentativelyAccepted') return 1;
  if (event.response === 'notResponded') return 2;
  return 0;
}

function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end && b.start < a.end;
}

type PlanSettings = Pick<Settings, 'dayStart' | 'dayEnd' | 'slotMinutes'>;

/**
 * Where a day's meetings go. Each is clipped to the day window and widened to
 * the slot grid; if that runs into something, it tries the slots fully
 * inside its time instead. The user's own blocks never give way. Between
 * meetings, firmer ones go first, then earlier, then longer.
 */
export function planMeetings(
  date: IsoDate,
  events: readonly CalendarEvent[],
  blocks: readonly Block[],
  settings: PlanSettings,
): MeetingPlan {
  const { dayStart, dayEnd, slotMinutes } = settings;
  const taken: Array<TimeRange & { title: string }> = blocks
    .filter((b) => b.eventId === undefined)
    .map((b) => ({ start: b.start, end: b.end, title: b.title }));
  const placed: MeetingDraft[] = [];
  const skipped: SkippedMeeting[] = [];
  const seen = new Set<string>();

  const candidates = events
    .filter((event) => isMeeting(event))
    .map((event) => ({ event, start: minutesOnDay(event.start, date), end: minutesOnDay(event.end, date) }))
    .filter((c) => c.end > c.start)
    .sort(
      (a, b) =>
        firmness(a.event) - firmness(b.event) ||
        a.start - b.start ||
        b.end - b.start - (a.end - a.start) ||
        (a.event.id < b.event.id ? -1 : a.event.id > b.event.id ? 1 : 0),
    );

  for (const { event, start, end } of candidates) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    const title = event.title.trim().slice(0, LIMITS.titleMax);
    const skip = (reason: SkipReason, blockedBy?: string) => {
      const entry: SkippedMeeting = { eventId: event.id, title, start, end, reason };
      if (blockedBy !== undefined) entry.blockedBy = blockedBy;
      skipped.push(entry);
    };

    const low = Math.max(start, dayStart);
    const high = Math.min(end, dayEnd);
    if (high <= low) {
      skip('outsideWindow');
      continue;
    }
    if (taken.length >= LIMITS.maxBlocksPerDay) {
      skip('dayFull');
      continue;
    }
    // The window falls on the half hour, so widening never leaves it.
    const outward = { start: floorToSlot(low, slotMinutes), end: ceilToSlot(high, slotMinutes) };
    const inward = { start: ceilToSlot(low, slotMinutes), end: floorToSlot(high, slotMinutes) };
    const options = inward.end - inward.start >= slotMinutes ? [outward, inward] : [outward];
    const fit = options.find((range) => !taken.some((t) => overlaps(t, range)));
    if (!fit) {
      skip('overlap', taken.find((t) => overlaps(t, outward))?.title);
      continue;
    }
    taken.push({ ...fit, title });
    placed.push({ eventId: event.id, title, start: fit.start, end: fit.end });
  }

  placed.sort((a, b) => a.start - b.start);
  skipped.sort((a, b) => a.start - b.start || a.end - b.end);
  return { placed, skipped };
}

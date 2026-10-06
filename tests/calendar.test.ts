import { describe, expect, it } from 'vitest';
import {
  calendarViewRange,
  isMeeting,
  minutesOnDay,
  parseGraphDateTime,
  parseGraphPage,
  planMeetings,
  type CalendarEvent,
} from '../src/core/calendar';
import { defaultSettings } from '../src/core/defaults';
import type { Block } from '../src/core/model';

const DAY = '2026-10-06';

/** Local wall clock time on DAY, so the tests pass in any time zone. */
function at(hours: number, minutes = 0, dayOffset = 0): number {
  return new Date(2026, 9, 6 + dayOffset, hours, minutes).getTime();
}

function meeting(id: string, start: number, end: number, patch: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id, title: id, start, end, allDay: false, cancelled: false, showAs: 'busy', response: 'accepted', ...patch };
}

function own(start: number, end: number, title = `own ${start}`): Block {
  return { id: `b${start}`, title, start, end, categoryId: 'deep', createdAt: 0 };
}

const settings = defaultSettings();

describe('reading Graph replies', () => {
  it('reads UTC date times with seven digit fractions', () => {
    expect(parseGraphDateTime({ dateTime: '2026-10-06T14:00:00.0000000', timeZone: 'UTC' })).toBe(Date.UTC(2026, 9, 6, 14));
    expect(parseGraphDateTime({ dateTime: '2026-10-06T14:00:30.5000000', timeZone: 'UTC' })).toBe(Date.UTC(2026, 9, 6, 14, 0, 30, 500));
    expect(parseGraphDateTime({ dateTime: '2026-10-06T14:00:00' })).toBe(Date.UTC(2026, 9, 6, 14));
  });

  it('honors an explicit offset and refuses a zone it would have to guess', () => {
    expect(parseGraphDateTime({ dateTime: '2026-10-06T14:00:00Z', timeZone: 'Pacific Standard Time' })).toBe(Date.UTC(2026, 9, 6, 14));
    expect(parseGraphDateTime({ dateTime: '2026-10-06T09:00:00-05:00' })).toBe(Date.UTC(2026, 9, 6, 14));
    expect(parseGraphDateTime({ dateTime: '2026-10-06T14:00:00', timeZone: 'Pacific Standard Time' })).toBeNull();
    expect(parseGraphDateTime({ dateTime: 'tomorrow', timeZone: 'UTC' })).toBeNull();
    expect(parseGraphDateTime('2026-10-06T14:00:00')).toBeNull();
  });

  it('reads a page of events and its next link', () => {
    const page = parseGraphPage({
      '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/calendarView?$skip=10',
      value: [
        {
          id: 'AAMk1',
          subject: 'Project standup',
          start: { dateTime: '2026-10-06T14:00:00.0000000', timeZone: 'UTC' },
          end: { dateTime: '2026-10-06T14:30:00.0000000', timeZone: 'UTC' },
          isAllDay: false,
          isCancelled: false,
          showAs: 'busy',
          responseStatus: { response: 'accepted', time: '0001-01-01T00:00:00Z' },
        },
        { id: 'AAMk2', start: { dateTime: '2026-10-06T15:00:00', timeZone: 'UTC' }, end: { dateTime: '2026-10-06T16:00:00', timeZone: 'UTC' } },
        { id: '', start: {}, end: {} },
        'not an event',
      ],
    });
    expect(page).toEqual({
      nextLink: 'https://graph.microsoft.com/v1.0/me/calendarView?$skip=10',
      events: [
        {
          id: 'AAMk1',
          title: 'Project standup',
          start: Date.UTC(2026, 9, 6, 14),
          end: Date.UTC(2026, 9, 6, 14, 30),
          allDay: false,
          cancelled: false,
          showAs: 'busy',
          response: 'accepted',
        },
        {
          id: 'AAMk2',
          title: '',
          start: Date.UTC(2026, 9, 6, 15),
          end: Date.UTC(2026, 9, 6, 16),
          allDay: false,
          cancelled: false,
          showAs: 'unknown',
          response: 'none',
        },
      ],
    });
    expect(parseGraphPage({ value: [] })).toEqual({ events: [], nextLink: null });
    expect(parseGraphPage({ error: { code: 'InvalidAuthenticationToken' } })).toBeNull();
    expect(parseGraphPage(null)).toBeNull();
  });

  it('asks for the day from local midnight to local midnight', () => {
    expect(calendarViewRange(DAY)).toEqual({
      start: new Date(2026, 9, 6).toISOString(),
      end: new Date(2026, 9, 7).toISOString(),
    });
  });

  it('measures times on the day in wall clock minutes', () => {
    expect(minutesOnDay(at(9, 30), DAY)).toBe(570);
    expect(minutesOnDay(at(23, 0, -1), DAY)).toBe(0);
    expect(minutesOnDay(at(0, 0, 1), DAY)).toBe(1440);
  });
});

describe('which events are meetings', () => {
  it('keeps busy, tentative, and away time, and skips the rest', () => {
    expect(isMeeting(meeting('a', at(9), at(10)))).toBe(true);
    expect(isMeeting(meeting('a', at(9), at(10), { showAs: 'tentative', response: 'notResponded' }))).toBe(true);
    expect(isMeeting(meeting('a', at(9), at(10), { showAs: 'oof' }))).toBe(true);
    expect(isMeeting(meeting('a', at(9), at(10), { allDay: true }))).toBe(false);
    expect(isMeeting(meeting('a', at(9), at(10), { cancelled: true }))).toBe(false);
    expect(isMeeting(meeting('a', at(9), at(10), { response: 'declined' }))).toBe(false);
    expect(isMeeting(meeting('a', at(9), at(10), { showAs: 'free' }))).toBe(false);
    expect(isMeeting(meeting('a', at(9), at(10), { showAs: 'workingElsewhere' }))).toBe(false);
  });
});

describe('planning meetings', () => {
  it('widens a meeting to the slot grid', () => {
    const plan = planMeetings(DAY, [meeting('a', at(10, 5), at(10, 25))], [], settings);
    expect(plan).toEqual({ placed: [{ eventId: 'a', title: 'a', start: 600, end: 630 }], skipped: [] });
  });

  it('falls back to the slots inside its time when widening hits a block', () => {
    const plan = planMeetings(DAY, [meeting('a', at(9, 55), at(10, 30))], [own(540, 600)], settings);
    expect(plan.placed).toEqual([{ eventId: 'a', title: 'a', start: 600, end: 630 }]);
  });

  it('never moves the user own blocks and reports what was in the way', () => {
    const plan = planMeetings(DAY, [meeting('a', at(9, 30), at(10, 30))], [own(540, 600, 'Pay app review')], settings);
    expect(plan.placed).toEqual([]);
    expect(plan.skipped).toEqual([{ eventId: 'a', title: 'a', start: 570, end: 630, reason: 'overlap', blockedBy: 'Pay app review' }]);
  });

  it('lets a firm meeting claim its time before a tentative one, then earlier before later', () => {
    const plan = planMeetings(
      DAY,
      [
        meeting('maybe', at(9), at(10), { response: 'tentativelyAccepted' }),
        meeting('yes', at(9, 30), at(10, 30)),
        meeting('later', at(10), at(11)),
      ],
      [],
      settings,
    );
    expect(plan.placed.map((m) => m.eventId)).toEqual(['yes']);
    expect(plan.skipped.map((m) => [m.eventId, m.blockedBy])).toEqual([
      ['maybe', 'yes'],
      ['later', 'yes'],
    ]);
  });

  it('clips meetings to the day window and skips those outside it', () => {
    const plan = planMeetings(DAY, [meeting('early', at(6, 30), at(7, 30)), meeting('night', at(19), at(20))], [], settings);
    expect(plan.placed).toEqual([{ eventId: 'early', title: 'early', start: 420, end: 450 }]);
    expect(plan.skipped).toEqual([{ eventId: 'night', title: 'night', start: 1140, end: 1200, reason: 'outsideWindow' }]);
  });

  it('keeps only the part of an overnight meeting that falls on the day', () => {
    const plan = planMeetings(DAY, [meeting('overnight', at(23, 0, -1), at(7, 30))], [], settings);
    expect(plan.placed).toEqual([{ eventId: 'overnight', title: 'overnight', start: 420, end: 450 }]);
  });

  it('leaves out events that are not meetings without reporting them', () => {
    const plan = planMeetings(
      DAY,
      [
        meeting('holiday', at(0), at(0, 1), { allDay: true }),
        meeting('declined', at(9), at(10), { response: 'declined' }),
        meeting('gone', at(11), at(12), { cancelled: true }),
        meeting('empty', at(13), at(13)),
      ],
      [],
      settings,
    );
    expect(plan).toEqual({ placed: [], skipped: [] });
  });

  it('ignores the meetings already on the tower, which it replaces', () => {
    const synced: Block = { ...own(600, 660), eventId: 'a' };
    const plan = planMeetings(DAY, [meeting('a', at(10, 30), at(11, 30))], [synced], settings);
    expect(plan.placed).toEqual([{ eventId: 'a', title: 'a', start: 630, end: 690 }]);
  });

  it('places a repeated event once and trims long titles', () => {
    const long = 'x'.repeat(80);
    const plan = planMeetings(DAY, [meeting('a', at(9), at(10), { title: `  ${long}  ` }), meeting('a', at(9), at(10))], [], settings);
    expect(plan.placed).toEqual([{ eventId: 'a', title: 'x'.repeat(60), start: 540, end: 600 }]);
  });

  it('stops at the block limit', () => {
    const blocks = Array.from({ length: 47 }, (_, i) => own(420 + i * 5, 425 + i * 5));
    const plan = planMeetings(DAY, [meeting('a', at(12), at(12, 30)), meeting('b', at(13), at(13, 30))], blocks, settings);
    expect(plan.placed.map((m) => m.eventId)).toEqual(['a']);
    expect(plan.skipped.map((m) => [m.eventId, m.reason])).toEqual([['b', 'dayFull']]);
  });

  it('follows the slot size', () => {
    const plan = planMeetings(DAY, [meeting('a', at(10, 5), at(10, 25))], [], { ...settings, slotMinutes: 5 });
    expect(plan.placed).toEqual([{ eventId: 'a', title: 'a', start: 605, end: 625 }]);
  });
});

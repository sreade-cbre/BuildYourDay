import { describe, expect, it } from 'vitest';
import type { MeetingDraft } from '../src/core/calendar';
import { migrate } from '../src/core/migrate';
import type { Block } from '../src/core/model';
import { MESSAGES, Store, type StoreEvent } from '../src/core/store';

// Meetings synced from Outlook, in the store: Outlook owns their time and
// title, and they never disturb the user's own blocks.

const TODAY = '2026-10-06';

function makeStore(): { store: Store; events: StoreEvent[] } {
  let id = 0;
  const store = new Store({ today: TODAY, now: () => 5_000, createId: (prefix) => `${prefix}${(id += 1)}` });
  const events: StoreEvent[] = [];
  store.subscribe((event) => events.push(event));
  return { store, events };
}

function draft(eventId: string, start: number, end: number, title = eventId): MeetingDraft {
  return { eventId, title, start, end };
}

function mustAdd(store: Store, start: number, end: number, date = TODAY): Block {
  const result = store.addBlock(date, { start, end, categoryId: 'deep', title: `own ${start}` });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function mustSync(store: Store, meetings: MeetingDraft[], date = TODAY): void {
  const result = store.syncCalendarDay(date, meetings, 'meet');
  if (!result.ok) throw new Error(result.error);
}

function meetingBlock(store: Store, eventId: string, date = TODAY): Block {
  const block = store.blocksFor(date).find((b) => b.eventId === eventId);
  if (!block) throw new Error(`No block for ${eventId}`);
  return block;
}

describe('syncing a day', () => {
  it('adds meetings beside the user blocks as one calendar change', () => {
    const { store, events } = makeStore();
    mustAdd(store, 450, 540);
    events.length = 0;
    mustSync(store, [draft('a', 600, 660, 'Standup'), draft('b', 900, 960)]);
    expect(store.blocks.map((b) => [b.start, b.title, b.categoryId, b.eventId])).toEqual([
      [450, 'own 450', 'deep', undefined],
      [600, 'Standup', 'meet', 'a'],
      [900, 'b', 'meet', 'b'],
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'blocks', origin: 'calendar', date: TODAY });
    expect((events[0] as Extract<StoreEvent, { type: 'blocks' }>).changes.map((c) => c.kind)).toEqual(['added', 'added']);
  });

  it('says nothing when Outlook has not changed', () => {
    const { store, events } = makeStore();
    mustSync(store, [draft('a', 600, 660)]);
    events.length = 0;
    expect(store.syncCalendarDay(TODAY, [draft('a', 600, 660)], 'meet')).toEqual({ ok: true, value: [] });
    expect(events).toHaveLength(0);
  });

  it('moves, retitles, and removes meetings, keeping each block and its color', () => {
    const { store, events } = makeStore();
    mustSync(store, [draft('a', 600, 660), draft('b', 900, 960), draft('c', 720, 750)]);
    const a = meetingBlock(store, 'a');
    store.updateBlock(TODAY, a.id, { categoryId: 'admin' });
    events.length = 0;
    mustSync(store, [draft('a', 630, 690, 'Standup moved'), draft('b', 900, 990)]);
    const changes = (events[0] as Extract<StoreEvent, { type: 'blocks' }>).changes;
    expect(changes.map((c) => [c.kind, c.block.eventId])).toEqual([
      ['moved', 'a'],
      ['retitled', 'a'],
      ['resized', 'b'],
      ['removed', 'c'],
    ]);
    const moved = meetingBlock(store, 'a');
    expect(moved).toMatchObject({ id: a.id, start: 630, end: 690, title: 'Standup moved', categoryId: 'admin', createdAt: a.createdAt });
    expect(store.blocks.map((b) => b.eventId)).toEqual(['a', 'b']);
  });

  it('refuses a plan that would overlap a user block and changes nothing', () => {
    const { store, events } = makeStore();
    mustAdd(store, 600, 660);
    events.length = 0;
    expect(store.syncCalendarDay(TODAY, [draft('a', 630, 690)], 'meet')).toEqual({ ok: false, error: MESSAGES.overlap });
    expect(store.syncCalendarDay(TODAY, [draft('a', 700, 690)], 'meet')).toEqual({ ok: false, error: MESSAGES.badTimes });
    expect(store.syncCalendarDay(TODAY, [draft('a', 700, 760)], 'gone')).toEqual({ ok: false, error: MESSAGES.unknownCategory });
    expect(store.blocks).toHaveLength(1);
    expect(events).toHaveLength(0);
  });

  it('lets a meeting take the time another meeting just left', () => {
    const { store } = makeStore();
    mustSync(store, [draft('a', 600, 660), draft('b', 660, 720)]);
    mustSync(store, [draft('a', 660, 720), draft('b', 600, 660)]);
    expect(store.blocks.map((b) => b.eventId)).toEqual(['b', 'a']);
  });
});

describe('what the user can do to a meeting', () => {
  it('can recolor it but not change its time or title', () => {
    const { store } = makeStore();
    mustSync(store, [draft('a', 600, 660)]);
    const { id } = meetingBlock(store, 'a');
    expect(store.updateBlock(TODAY, id, { start: 615, end: 675 })).toEqual({ ok: false, error: MESSAGES.meetingTimes });
    expect(store.updateBlock(TODAY, id, { end: 690 })).toEqual({ ok: false, error: MESSAGES.meetingTimes });
    expect(store.updateBlock(TODAY, id, { title: 'Renamed' })).toEqual({ ok: false, error: MESSAGES.meetingTimes });
    expect(store.updateBlock(TODAY, id, { categoryId: 'deep' }).ok).toBe(true);
    expect(store.nudgeBlock(TODAY, id, 1)).toEqual({ ok: false, error: MESSAGES.meetingTimes });
    expect(store.canNudge(TODAY, id, 1)).toBe(false);
  });

  it('cannot demolish it, and cannot swap a block with it', () => {
    const { store } = makeStore();
    mustSync(store, [draft('a', 600, 660)]);
    const own = mustAdd(store, 540, 600);
    expect(store.deleteBlock(TODAY, meetingBlock(store, 'a').id)).toEqual({ ok: false, error: MESSAGES.meetingDelete });
    expect(store.canNudge(TODAY, own.id, 1)).toBe(false);
    expect(store.nudgeBlock(TODAY, own.id, 1)).toEqual({ ok: false, error: MESSAGES.meetingSwap });
    expect(store.canNudge(TODAY, own.id, -1)).toBe(true);
  });

  it('keeps meetings when the day is cleared, and undo brings back the rest', () => {
    const { store } = makeStore();
    mustAdd(store, 450, 540);
    mustSync(store, [draft('a', 600, 660)]);
    expect(store.clearDay(TODAY)).toEqual({ ok: true, value: 1 });
    expect(store.blocks.map((b) => b.eventId)).toEqual(['a']);
    expect(store.undoDelete().ok).toBe(true);
    expect(store.blocks.map((b) => b.start)).toEqual([450, 600]);
    store.clearDay(TODAY);
    expect(store.clearDay(TODAY)).toEqual({ ok: true, value: 0 });
  });
});

describe('copying days with meetings', () => {
  it('copies only the user blocks, onto a day that has only meetings, around them', () => {
    const { store } = makeStore();
    const yesterday = '2026-10-05';
    mustAdd(store, 450, 540, yesterday);
    mustAdd(store, 600, 660, yesterday);
    mustSync(store, [draft('old', 900, 960)], yesterday);
    mustSync(store, [draft('a', 630, 690)]);
    expect(store.previousPlannedDate(TODAY)).toBe(yesterday);
    const result = store.copyDay(yesterday, TODAY);
    expect(result.ok && result.value.map((b) => b.start)).toEqual([450]);
    expect(store.blocks.map((b) => [b.start, b.eventId])).toEqual([
      [450, undefined],
      [630, 'a'],
    ]);
    expect(store.copyDay(yesterday, TODAY)).toEqual({ ok: false, error: MESSAGES.dayNotEmpty });
  });

  it('skips days of only meetings as a copy source, and says when nothing fits', () => {
    const { store } = makeStore();
    mustAdd(store, 600, 660, '2026-10-01');
    mustSync(store, [draft('old', 900, 960)], '2026-10-05');
    expect(store.previousPlannedDate(TODAY)).toBe('2026-10-01');
    mustSync(store, [draft('a', 600, 660)]);
    expect(store.copyDay('2026-10-01', TODAY)).toEqual({ ok: false, error: MESSAGES.copyBlocked });
    expect(store.copyDay('2026-10-05', TODAY)).toEqual({ ok: false, error: MESSAGES.nothingToCopy });
  });
});

describe('changing the meetings category and disconnecting', () => {
  it('moves only meetings in the old category', () => {
    const { store } = makeStore();
    const ownMeet = store.addBlock(TODAY, { start: 450, end: 480, categoryId: 'meet' });
    mustSync(store, [draft('a', 600, 660), draft('b', 900, 960)]);
    store.updateBlock(TODAY, meetingBlock(store, 'b').id, { categoryId: 'deep' });
    expect(store.recategorizeMeetings('meet', 'admin')).toEqual({ ok: true, value: 1 });
    expect(store.blocks.map((b) => b.categoryId)).toEqual(['meet', 'admin', 'deep']);
    expect(ownMeet.ok).toBe(true);
  });

  it('keeps meetings as ordinary blocks, or removes them', () => {
    const { store, events } = makeStore();
    mustAdd(store, 450, 540);
    mustSync(store, [draft('a', 600, 660)]);
    mustSync(store, [draft('b', 600, 660)], '2026-10-07');
    events.length = 0;
    expect(store.releaseMeetings(true)).toBe(2);
    expect(events.map((e) => e.type)).toEqual(['loaded']);
    expect(store.blocks.map((b) => 'eventId' in b)).toEqual([false, false]);
    expect(store.updateBlock(TODAY, store.blocks[1]!.id, { title: 'Mine now' }).ok).toBe(true);

    const second = makeStore();
    mustAdd(second.store, 450, 540);
    mustSync(second.store, [draft('a', 600, 660)]);
    expect(second.store.releaseMeetings(false)).toBe(1);
    expect(second.store.blocks.map((b) => b.start)).toEqual([450]);
  });
});

describe('saving meetings', () => {
  it('round trips the event id and drops a broken one', () => {
    const { store } = makeStore();
    mustSync(store, [draft('AAMkAGI2', 600, 660)]);
    const save = store.toSaveFile();
    const back = migrate(JSON.parse(JSON.stringify(save)), TODAY, { log: false });
    expect(back.ok && back.save.days[TODAY]!.blocks[0]!.eventId).toBe('AAMkAGI2');

    save.days[TODAY]!.blocks[0]!.eventId = 42 as unknown as string;
    const broken = migrate(JSON.parse(JSON.stringify(save)), TODAY, { log: false });
    expect(broken.ok && broken.save.days[TODAY]!.blocks[0]!.eventId).toBeUndefined();
    expect(broken.ok && broken.changes.some((c) => c.includes('ordinary block'))).toBe(true);
  });
});

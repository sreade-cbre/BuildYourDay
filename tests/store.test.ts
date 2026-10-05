import { describe, expect, it } from 'vitest';
import { LIMITS, sampleBlocks } from '../src/core/defaults';
import { totals } from '../src/core/layout';
import type { Block, SlotMinutes, Theme } from '../src/core/model';
import { MESSAGES, Store, type StoreEvent } from '../src/core/store';

const TODAY = '2026-10-05';

function makeStore(): { store: Store; events: StoreEvent[] } {
  let id = 0;
  let clock = 1_000;
  const store = new Store({
    today: TODAY,
    now: () => (clock += 1),
    createId: (prefix) => `${prefix}${(id += 1)}`,
  });
  const events: StoreEvent[] = [];
  store.subscribe((event) => events.push(event));
  return { store, events };
}

function mustAdd(store: Store, start: number, end: number, categoryId = 'deep', date = TODAY): Block {
  const result = store.addBlock(date, { start, end, categoryId, title: `${start}` });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe('adding blocks', () => {
  it('keeps blocks sorted by start whatever the insert order', () => {
    const { store } = makeStore();
    mustAdd(store, 900, 960);
    mustAdd(store, 450, 540);
    mustAdd(store, 600, 660);
    expect(store.blocks.map((b) => b.start)).toEqual([450, 600, 900]);
  });

  it('rejects overlaps and leaves the day unchanged', () => {
    const { store, events } = makeStore();
    mustAdd(store, 600, 660);
    events.length = 0;
    const result = store.addBlock(TODAY, { start: 630, end: 690, categoryId: 'deep' });
    expect(result).toEqual({ ok: false, error: MESSAGES.overlap });
    expect(store.blocks).toHaveLength(1);
    expect(events).toHaveLength(0);
  });

  it('accepts a block that touches its neighbors', () => {
    const { store } = makeStore();
    mustAdd(store, 600, 660);
    mustAdd(store, 720, 780);
    expect(store.addBlock(TODAY, { start: 660, end: 720, categoryId: 'meet' }).ok).toBe(true);
  });

  it('rejects blocks outside the window, off the slot grid, or shorter than a slot', () => {
    const { store } = makeStore();
    expect(store.addBlock(TODAY, { start: 390, end: 450, categoryId: 'deep' })).toEqual({
      ok: false,
      error: MESSAGES.outsideWindow,
    });
    expect(store.addBlock(TODAY, { start: 455, end: 510, categoryId: 'deep' })).toEqual({
      ok: false,
      error: MESSAGES.offSlot(15),
    });
    expect(store.addBlock(TODAY, { start: 450, end: 450, categoryId: 'deep' })).toEqual({
      ok: false,
      error: MESSAGES.badTimes,
    });
    store.updateSettings({ slotMinutes: 30 });
    expect(store.addBlock(TODAY, { start: 450, end: 465, categoryId: 'deep' }).ok).toBe(false);
  });

  it('rejects unknown categories', () => {
    const { store } = makeStore();
    expect(store.addBlock(TODAY, { start: 450, end: 510, categoryId: 'nope' })).toEqual({
      ok: false,
      error: MESSAGES.unknownCategory,
    });
  });

  it('trims titles and caps them at 60 characters', () => {
    const { store } = makeStore();
    const result = store.addBlock(TODAY, { start: 450, end: 510, categoryId: 'deep', title: `  ${'x'.repeat(80)}  ` });
    expect(result.ok && result.value.title).toBe('x'.repeat(60));
  });

  it('caps a day at 48 blocks', () => {
    const { store } = makeStore();
    store.updateSettings({ slotMinutes: 5 });
    for (let i = 0; i < LIMITS.maxBlocksPerDay; i++) mustAdd(store, 420 + i * 5, 425 + i * 5);
    expect(store.blocks).toHaveLength(48);
    const result = store.addBlock(TODAY, { start: 900, end: 905, categoryId: 'deep' });
    expect(result).toEqual({ ok: false, error: 'A day can hold up to 48 blocks.' });
    expect(store.addBlocks('2026-10-06', Array.from({ length: 49 }, (_, i) => ({
      start: 420 + i * 5, end: 425 + i * 5, categoryId: 'deep',
    })))).toEqual({ ok: false, error: MESSAGES.dayFull });
  });

  it('announces additions with the origin', () => {
    const { store, events } = makeStore();
    const block = mustAdd(store, 450, 540);
    expect(events).toEqual([{ type: 'blocks', date: TODAY, origin: 'user', changes: [{ kind: 'added', block }] }]);
  });

  it('loads the sample day atomically', () => {
    const { store, events } = makeStore();
    const result = store.addBlocks(TODAY, sampleBlocks(store.settings.categories), 'sample');
    expect(result.ok).toBe(true);
    expect(store.blocks).toHaveLength(7);
    expect(events).toHaveLength(1);
    expect(totals(store.blocks, store.settings).plannedMinutes).toBe(450);
  });

  it('adds nothing when any block in a batch is invalid', () => {
    const { store } = makeStore();
    const result = store.addBlocks(TODAY, [
      { start: 450, end: 510, categoryId: 'deep' },
      { start: 480, end: 540, categoryId: 'deep' },
    ]);
    expect(result.ok).toBe(false);
    expect(store.blocks).toHaveLength(0);
  });
});

describe('updating blocks', () => {
  it('reports moves, resizes, retitles, and recategorizations', () => {
    const { store, events } = makeStore();
    const block = mustAdd(store, 600, 660);
    events.length = 0;

    store.updateBlock(TODAY, block.id, { start: 630, end: 690 });
    store.updateBlock(TODAY, block.id, { end: 720 });
    store.updateBlock(TODAY, block.id, { title: 'Review' });
    store.updateBlock(TODAY, block.id, { categoryId: 'meet' });

    const kinds = events.map((e) => (e.type === 'blocks' ? e.changes.map((c) => c.kind) : []));
    expect(kinds).toEqual([['moved'], ['resized'], ['retitled'], ['recategorized']]);
    expect(store.blocks[0]).toMatchObject({ start: 630, end: 720, title: 'Review', categoryId: 'meet' });
  });

  it('refuses edits that overlap, leave the window, or shrink below a slot', () => {
    const { store } = makeStore();
    const a = mustAdd(store, 600, 645);
    mustAdd(store, 660, 720);
    expect(store.updateBlock(TODAY, a.id, { end: 675 })).toEqual({ ok: false, error: MESSAGES.overlap });
    expect(store.updateBlock(TODAY, a.id, { start: 390 })).toEqual({ ok: false, error: MESSAGES.outsideWindow });
    expect(store.updateBlock(TODAY, a.id, { end: 610 })).toEqual({ ok: false, error: MESSAGES.offSlot(15) });
    store.updateSettings({ slotMinutes: 30 });
    expect(store.updateBlock(TODAY, a.id, { start: 630 })).toEqual({ ok: false, error: MESSAGES.tooShort(30) });
  });

  it('keeps blocks made under a finer slot editable after the slot gets coarser', () => {
    const { store } = makeStore();
    store.updateSettings({ slotMinutes: 5 });
    const small = mustAdd(store, 600, 605);
    store.updateSettings({ slotMinutes: 15 });
    const moved = store.updateBlock(TODAY, small.id, { start: 615, end: 620 });
    expect(moved.ok).toBe(true);
    const grown = store.updateBlock(TODAY, small.id, { end: 630 });
    expect(grown.ok).toBe(true);
    expect(store.blocks[0]).toMatchObject({ start: 615, end: 630 });
  });

  it('returns the block unchanged and stays quiet when nothing changes', () => {
    const { store, events } = makeStore();
    const block = mustAdd(store, 600, 660);
    events.length = 0;
    expect(store.updateBlock(TODAY, block.id, { start: 600, title: '600' })).toEqual({ ok: true, value: block });
    expect(events).toHaveLength(0);
  });
});

describe('deleting and undo', () => {
  it('restores an identical block', () => {
    const { store, events } = makeStore();
    const block = mustAdd(store, 600, 660, 'meet');
    const snapshot = { ...block };
    store.deleteBlock(TODAY, block.id);
    expect(store.blocks).toHaveLength(0);
    expect(store.canUndo).toBe(true);
    events.length = 0;

    const result = store.undoDelete();
    expect(result.ok).toBe(true);
    expect(store.blocks).toEqual([snapshot]);
    expect(store.canUndo).toBe(false);
    expect(events[0]).toMatchObject({ type: 'blocks', origin: 'undo', changes: [{ kind: 'added' }] });
  });

  it('refuses to restore into a taken slot', () => {
    const { store } = makeStore();
    const block = mustAdd(store, 600, 660);
    store.deleteBlock(TODAY, block.id);
    mustAdd(store, 630, 690);
    expect(store.undoDelete()).toEqual({ ok: false, error: MESSAGES.undoBlocked });
  });

  it('has nothing to undo at first', () => {
    const { store } = makeStore();
    expect(store.undoDelete()).toEqual({ ok: false, error: MESSAGES.nothingToUndo });
  });

  it('clears a day', () => {
    const { store } = makeStore();
    mustAdd(store, 600, 660);
    mustAdd(store, 690, 720);
    expect(store.clearDay(TODAY)).toEqual({ ok: true, value: 2 });
    expect(store.plannedDates()).toEqual([]);
  });
});

describe('categories', () => {
  it('reassigns blocks on every day to the first remaining category', () => {
    const { store, events } = makeStore();
    mustAdd(store, 600, 660, 'meet');
    mustAdd(store, 660, 720, 'admin');
    mustAdd(store, 600, 660, 'meet', '2026-10-06');
    events.length = 0;

    const result = store.deleteCategory('meet');
    expect(result).toEqual({ ok: true, value: 2 });
    expect(store.settings.categories.map((c) => c.id)).toEqual(['deep', 'admin']);
    expect(store.blocksFor(TODAY).map((b) => b.categoryId)).toEqual(['deep', 'admin']);
    expect(store.blocksFor('2026-10-06').map((b) => b.categoryId)).toEqual(['deep']);
    expect(events.map((e) => e.type)).toEqual(['settings', 'blocks', 'blocks']);
  });

  it('refuses to delete the last category', () => {
    const { store } = makeStore();
    expect(store.deleteCategory('deep').ok).toBe(true);
    expect(store.deleteCategory('meet').ok).toBe(true);
    expect(store.deleteCategory('admin')).toEqual({ ok: false, error: MESSAGES.lastCategory });
    expect(store.settings.categories).toHaveLength(1);
  });

  it('validates names, colors, and the category limit', () => {
    const { store } = makeStore();
    expect(store.addCategory('', 'navy')).toEqual({ ok: false, error: MESSAGES.categoryName });
    expect(store.addCategory('x'.repeat(25), 'navy')).toEqual({ ok: false, error: MESSAGES.categoryName });
    expect(store.addCategory('deep WORK', 'navy')).toEqual({ ok: false, error: MESSAGES.categoryDuplicate });
    for (let i = 0; i < 6; i++) expect(store.addCategory(`Extra ${i}`, 'slateLight').ok).toBe(true);
    expect(store.addCategory('One too many', 'blue')).toEqual({ ok: false, error: MESSAGES.categoryLimit });
    expect(store.updateCategory('deep', { name: 'Focus' }).ok).toBe(true);
    expect(store.category('deep')?.name).toBe('Focus');
  });
});

describe('settings', () => {
  it('enforces a 4 to 18 hour day window on half hour steps', () => {
    const { store } = makeStore();
    expect(store.updateSettings({ dayStart: 600, dayEnd: 780 })).toEqual({ ok: false, error: MESSAGES.windowLength });
    expect(store.updateSettings({ dayStart: 0, dayEnd: 1110 })).toEqual({ ok: false, error: MESSAGES.windowLength });
    expect(store.updateSettings({ dayStart: 0, dayEnd: 1440 })).toEqual({ ok: false, error: MESSAGES.windowLength });
    expect(store.updateSettings({ dayStart: 425, dayEnd: 1080 })).toEqual({ ok: false, error: MESSAGES.windowStep });
    expect(store.updateSettings({ dayStart: 420, dayEnd: 1450 })).toEqual({ ok: false, error: MESSAGES.windowStep });
    expect(store.updateSettings({ dayStart: 0, dayEnd: 1080 }).ok).toBe(true);
    expect(store.updateSettings({ dayStart: 360, dayEnd: 600 }).ok).toBe(true);
    expect(store.updateSettings({ dayStart: 1200, dayEnd: 1440 }).ok).toBe(true);
  });

  it('keeps blocks that fall outside a narrower window', () => {
    const { store } = makeStore();
    mustAdd(store, 960, 1020);
    expect(store.updateSettings({ dayStart: 420, dayEnd: 900 }).ok).toBe(true);
    expect(store.blocks).toHaveLength(1);
    expect(store.updateSettings({ dayEnd: 1080 }).ok).toBe(true);
    expect(store.blocks[0]).toMatchObject({ start: 960, end: 1020 });
  });

  it('rejects out of range values', () => {
    const { store } = makeStore();
    expect(store.updateSettings({ animationSpeed: 4 })).toEqual({ ok: false, error: MESSAGES.animationSpeed });
    expect(store.updateSettings({ slotMinutes: 20 as unknown as SlotMinutes }).ok).toBe(false);
    expect(store.updateSettings({ theme: 'sepia' as unknown as Theme }).ok).toBe(false);
    expect(store.settings.animationSpeed).toBe(1);
  });
});

describe('navigation and saving', () => {
  it('announces date changes and ignores invalid dates', () => {
    const { store, events } = makeStore();
    expect(store.setViewedDate('2026-10-06').ok).toBe(true);
    expect(store.setViewedDate('2026-13-01').ok).toBe(false);
    expect(store.viewedDate).toBe('2026-10-06');
    expect(events).toEqual([{ type: 'viewedDate', previous: TODAY, current: '2026-10-06' }]);
  });

  it('round trips through a save file', () => {
    const { store } = makeStore();
    store.addBlocks(TODAY, sampleBlocks(store.settings.categories), 'sample');
    mustAdd(store, 480, 540, 'meet', '2026-10-07');
    store.updateSettings({ timeFormat: '24h' });
    const save = store.toSaveFile();
    const copy = new Store({ today: TODAY, save });
    expect(copy.toSaveFile()).toEqual(save);
    expect(Object.keys(save.days)).toEqual([TODAY, '2026-10-07']);
  });

  it('omits empty days from the save file', () => {
    const { store } = makeStore();
    const block = mustAdd(store, 600, 660);
    store.deleteBlock(TODAY, block.id);
    expect(store.toSaveFile().days).toEqual({});
  });
});

describe('move earlier and later', () => {
  it('moves one slot into free time', () => {
    const { store } = makeStore();
    const a = mustAdd(store, 600, 660);
    expect(store.nudgeBlock(TODAY, a.id, 1)).toMatchObject({ ok: true, value: { start: 615, end: 675 } });
    expect(store.nudgeBlock(TODAY, a.id, -1)).toMatchObject({ ok: true, value: { start: 600, end: 660 } });
  });

  it('moves up to a neighbor that is closer than a slot', () => {
    const { store } = makeStore();
    store.updateSettings({ slotMinutes: 5 });
    const a = mustAdd(store, 600, 660);
    mustAdd(store, 665, 700);
    store.updateSettings({ slotMinutes: 15 });
    expect(store.nudgeBlock(TODAY, a.id, 1)).toMatchObject({ ok: true, value: { start: 605, end: 665 } });
  });

  it('swaps with a touching neighbor inside the time they share', () => {
    const { store, events } = makeStore();
    const a = mustAdd(store, 600, 660);
    const b = mustAdd(store, 660, 690);
    mustAdd(store, 690, 750);
    events.length = 0;
    expect(store.nudgeBlock(TODAY, a.id, 1).ok).toBe(true);
    expect(store.findBlock(TODAY, b.id)).toMatchObject({ start: 600, end: 630 });
    expect(store.findBlock(TODAY, a.id)).toMatchObject({ start: 630, end: 690 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'blocks', changes: [{ kind: 'moved' }, { kind: 'moved' }] });
    // And back again.
    expect(store.nudgeBlock(TODAY, a.id, -1).ok).toBe(true);
    expect(store.findBlock(TODAY, a.id)).toMatchObject({ start: 600, end: 660 });
    expect(store.findBlock(TODAY, b.id)).toMatchObject({ start: 660, end: 690 });
  });

  it('stops at the window edges', () => {
    const { store } = makeStore();
    const first = mustAdd(store, 420, 480);
    const last = mustAdd(store, 1020, 1080);
    expect(store.canNudge(TODAY, first.id, -1)).toBe(false);
    expect(store.nudgeBlock(TODAY, first.id, -1)).toEqual({ ok: false, error: MESSAGES.noRoomEarlier });
    expect(store.canNudge(TODAY, last.id, 1)).toBe(false);
    expect(store.nudgeBlock(TODAY, last.id, 1)).toEqual({ ok: false, error: MESSAGES.noRoomLater });
    expect(store.canNudge(TODAY, first.id, 1)).toBe(true);
  });
});

describe('clearing, copying, and merging days', () => {
  it('restores a cleared day with one undo', () => {
    const { store } = makeStore();
    store.addBlocks(TODAY, sampleBlocks(store.settings.categories), 'sample');
    const before = store.toSaveFile();
    expect(store.clearDay(TODAY)).toEqual({ ok: true, value: 7 });
    expect(store.blocks).toHaveLength(0);
    expect(store.undoDelete().ok).toBe(true);
    expect(store.toSaveFile()).toEqual(before);
  });

  it('copies a day onto an empty day with new ids', () => {
    const { store, events } = makeStore();
    store.addBlocks('2026-10-02', sampleBlocks(store.settings.categories), 'sample');
    expect(store.previousPlannedDate(TODAY)).toBe('2026-10-02');
    expect(store.previousPlannedDate('2026-10-02')).toBeNull();
    events.length = 0;
    const result = store.copyDay('2026-10-02', TODAY);
    expect(result.ok).toBe(true);
    const source = store.blocksFor('2026-10-02');
    const copy = store.blocksFor(TODAY);
    expect(copy.map((b) => [b.start, b.end, b.title, b.categoryId])).toEqual(source.map((b) => [b.start, b.end, b.title, b.categoryId]));
    expect(copy.some((b) => source.some((s) => s.id === b.id))).toBe(false);
    expect(events[0]).toMatchObject({ type: 'blocks', date: TODAY, origin: 'copy' });
    expect(store.copyDay('2026-10-02', TODAY)).toEqual({ ok: false, error: MESSAGES.dayNotEmpty });
    expect(store.copyDay('2026-09-01', '2026-10-09')).toEqual({ ok: false, error: MESSAGES.nothingToCopy });
  });

  it('merges only the days that are missing and matches categories', () => {
    const { store } = makeStore();
    mustAdd(store, 600, 660, 'deep');
    const other = new Store({ today: TODAY });
    other.updateSettings({
      categories: [
        { id: 'deep', name: 'Deep work', color: 'navy' },
        { id: 'x1', name: 'meetings', color: 'blueDark' },
        { id: 'x2', name: 'Travel', color: 'slateLight' },
      ],
    });
    mustAdd(other, 480, 540, 'deep');
    mustAdd(other, 480, 540, 'x1', '2026-10-06');
    mustAdd(other, 600, 660, 'x2', '2026-10-06');
    const result = store.mergeDays(other.toSaveFile());
    expect(result).toEqual({ ok: true, value: ['2026-10-06'] });
    expect(store.blocksFor(TODAY).map((b) => b.start)).toEqual([600]);
    expect(store.blocksFor('2026-10-06').map((b) => b.categoryId)).toEqual(['meet', 'x2']);
    expect(store.settings.categories.map((c) => c.name)).toEqual(['Deep work', 'Meetings', 'Admin', 'Travel']);
  });

  it('clears all data back to the defaults', () => {
    const { store } = makeStore();
    mustAdd(store, 600, 660);
    store.updateSettings({ theme: 'dark' });
    store.clearAll();
    expect(store.isEmpty).toBe(true);
    expect(store.settings.theme).toBe('light');
    expect(store.canUndo).toBe(false);
  });
});

describe('settings preview', () => {
  it('shows unsaved settings without saving them or touching blocks', () => {
    const { store, events } = makeStore();
    const block = mustAdd(store, 600, 660, 'meet');
    events.length = 0;
    const draft = { ...store.settings, theme: 'dark' as const, categories: store.settings.categories.filter((c) => c.id !== 'meet') };
    expect(store.previewSettings(draft).ok).toBe(true);
    expect(store.settings.theme).toBe('dark');
    expect(store.savedSettings.theme).toBe('light');
    expect(store.toSaveFile().settings.theme).toBe('light');
    expect(store.findBlock(TODAY, block.id)!.categoryId).toBe('meet');
    expect(store.categoryFor(store.findBlock(TODAY, block.id)!).id).toBe('deep');
    expect(events).toEqual([expect.objectContaining({ type: 'settings', preview: true })]);
  });

  it('reverts when the preview ends and commits when saved', () => {
    const { store } = makeStore();
    const block = mustAdd(store, 600, 660, 'meet');
    const draft = { ...store.settings, theme: 'dark' as const, categories: store.settings.categories.filter((c) => c.id !== 'meet') };
    store.previewSettings(draft);
    store.previewSettings(null);
    expect(store.settings.theme).toBe('light');
    expect(store.category('meet')).toBeDefined();

    store.previewSettings(draft);
    expect(store.updateSettings(draft).ok).toBe(true);
    expect(store.isPreviewingSettings).toBe(false);
    expect(store.savedSettings.theme).toBe('dark');
    expect(store.findBlock(TODAY, block.id)!.categoryId).toBe('deep');
  });

  it('refuses an invalid preview', () => {
    const { store } = makeStore();
    expect(store.previewSettings({ ...store.settings, dayStart: 600, dayEnd: 780 })).toEqual({
      ok: false,
      error: MESSAGES.windowLength,
    });
    expect(store.isPreviewingSettings).toBe(false);
  });
});

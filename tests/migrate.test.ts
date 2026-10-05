import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../src/core/defaults';
import { migrate } from '../src/core/migrate';
import type { Block, SaveFile } from '../src/core/model';

const TODAY = '2026-10-05';
let ids = 0;
const options = { log: false, createId: () => `new${(ids += 1)}`, now: () => 42 };

function block(start: number, end: number, extra: Partial<Block> = {}): Block {
  return { id: `b${start}`, title: 'Task', start, end, categoryId: 'deep', createdAt: 1, ...extra };
}

function validSave(): SaveFile {
  return {
    version: 1,
    settings: { ...defaultSettings(), timeFormat: '24h', theme: 'dark' },
    days: {
      '2026-10-04': { date: '2026-10-04', blocks: [block(450, 540), block(600, 660, { categoryId: 'meet' })] },
      '2026-10-05': { date: '2026-10-05', blocks: [block(480, 510, { title: 'Email' })] },
    },
    lastViewedDate: '2026-10-04',
  };
}

function migrated(raw: unknown) {
  const result = migrate(raw, TODAY, options);
  if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
  return result;
}

describe('version 1', () => {
  it('passes a valid save through unchanged and reports nothing', () => {
    const save = validSave();
    const result = migrated(structuredClone(save));
    expect(result.save).toEqual(save);
    expect(result.changes).toEqual([]);
  });

  it('fills missing settings with defaults', () => {
    const save = validSave() as unknown as Record<string, unknown>;
    delete save.settings;
    const result = migrated(save);
    expect(result.save.settings).toEqual(defaultSettings());
    expect(result.changes.join(' ')).toMatch(/settings were missing/);
  });

  it('keeps valid fields and defaults the missing or invalid ones', () => {
    const result = migrated({
      version: 1,
      settings: { theme: 'dark', slotMinutes: 20, dayStart: 360, dayEnd: 1200, categories: [{ id: 'x', name: 'Focus', color: 'navyDark' }] },
      days: {},
      lastViewedDate: TODAY,
    });
    const settings = result.save.settings;
    expect(settings.theme).toBe('dark');
    expect(settings.slotMinutes).toBe(15);
    expect([settings.dayStart, settings.dayEnd]).toEqual([360, 1200]);
    expect(settings.categories).toEqual([{ id: 'x', name: 'Focus', color: 'navyDark' }]);
    expect(result.changes.some((c) => c.includes('slotMinutes was invalid'))).toBe(true);
    expect(result.changes.some((c) => c.includes('timeFormat was missing'))).toBe(true);
  });

  it('replaces an impossible day window and drops bad categories', () => {
    const result = migrated({
      version: 1,
      settings: {
        ...defaultSettings(),
        dayStart: 600,
        dayEnd: 660,
        categories: [{ id: 'a', name: '', color: 'navy' }, { id: 'b', name: 'Ok', color: 'red' }],
      },
      days: {},
      lastViewedDate: TODAY,
    });
    expect([result.save.settings.dayStart, result.save.settings.dayEnd]).toEqual([420, 1080]);
    expect(result.save.settings.categories.map((c) => c.id)).toEqual(['deep', 'meet', 'admin']);
  });

  it('keeps blocks outside the current window, as section 6 requires', () => {
    const save = validSave();
    save.days['2026-10-05']!.blocks = [block(360, 420), block(1080, 1140)];
    const result = migrated(save);
    expect(result.save.days['2026-10-05']!.blocks.map((b) => [b.start, b.end])).toEqual([[360, 420], [1080, 1140]]);
    expect(result.changes).toEqual([]);
  });

  it('repairs times: snaps to 5 minutes, clamps to the day, drops zero length', () => {
    const save = validSave();
    save.days['2026-10-05']!.blocks = [
      block(452, 538),
      block(-30, 60, { id: 'early' }),
      block(1400, 1500, { id: 'late' }),
      block(700, 701, { id: 'tiny' }),
    ];
    const result = migrated(save);
    expect(result.save.days['2026-10-05']!.blocks.map((b) => [b.id, b.start, b.end])).toEqual([
      ['early', 0, 60],
      ['b452', 450, 540],
      ['late', 1400, 1440],
    ]);
    expect(result.changes.some((c) => c.includes('Dropped'))).toBe(true);
  });

  it('drops overlaps, repeats, and blocks past the cap, and fixes categories', () => {
    const save = validSave();
    const many = Array.from({ length: 50 }, (_, i) => block(420 + i * 10, 425 + i * 10, { id: `m${i}` }));
    save.days['2026-10-05']!.blocks = [
      block(420, 480, { id: 'first', categoryId: 'gone' }),
      block(450, 510, { id: 'overlapping' }),
      ...many.slice(10),
    ];
    const blocks = migrated(save).save.days['2026-10-05']!.blocks;
    expect(blocks[0]).toMatchObject({ id: 'first', categoryId: 'deep' });
    expect(blocks.some((b) => b.id === 'overlapping')).toBe(false);
    expect(blocks.length).toBeLessThanOrEqual(48);
    expect(new Set(blocks.map((b) => b.id)).size).toBe(blocks.length);
  });

  it('drops days with bad keys and fixes a mismatched date field', () => {
    const save = validSave() as unknown as { days: Record<string, unknown> };
    save.days['not-a-date'] = { date: 'x', blocks: [block(600, 660)] };
    (save.days['2026-10-04'] as { date: string }).date = '1999-01-01';
    const result = migrated(save);
    expect(Object.keys(result.save.days)).toEqual(['2026-10-04', '2026-10-05']);
    expect(result.save.days['2026-10-04']!.date).toBe('2026-10-04');
  });
});

describe('version 0', () => {
  it('reads any object with a blocks array as one day, today', () => {
    const result = migrated({ blocks: [{ id: 'a', title: 'Old', start: 450, end: 540, categoryId: 'deep' }] });
    expect(Object.keys(result.save.days)).toEqual([TODAY]);
    expect(result.save.days[TODAY]!.blocks).toEqual([
      { id: 'a', title: 'Old', start: 450, end: 540, categoryId: 'deep', createdAt: 42 },
    ]);
    expect(result.save.settings).toEqual(defaultSettings());
    expect(result.save.lastViewedDate).toBe(TODAY);
  });

  it('accepts an explicit version 0', () => {
    expect(migrated({ version: 0, blocks: [] }).save.days).toEqual({});
  });

  it('clamps out of window blocks into the window', () => {
    const result = migrated({
      blocks: [
        { id: 'early', start: 360, end: 480, categoryId: 'deep' },
        { id: 'late', start: 1020, end: 1200, categoryId: 'meet' },
        { id: 'gone', start: 300, end: 400, categoryId: 'meet' },
      ],
    });
    expect(result.save.days[TODAY]!.blocks.map((b) => [b.id, b.start, b.end])).toEqual([
      ['early', 420, 480],
      ['late', 1020, 1080],
    ]);
  });

  it('gives blocks without ids or titles usable values', () => {
    const result = migrated({ blocks: [{ start: 600, end: 660, categoryId: 'nope' }] });
    expect(result.save.days[TODAY]!.blocks[0]).toMatchObject({ title: '', categoryId: 'deep' });
    expect(result.save.days[TODAY]!.blocks[0]!.id).toMatch(/^new/);
  });
});

describe('refusals', () => {
  it('refuses a future version', () => {
    expect(migrate({ ...validSave(), version: 2 }, TODAY, options)).toEqual({ ok: false, reason: 'newer' });
  });

  it('refuses things that are not saves', () => {
    for (const raw of [null, 7, 'text', [], { hello: 'world' }, { version: '1', days: {} }]) {
      expect(migrate(raw, TODAY, options)).toEqual({ ok: false, reason: 'invalid' });
    }
  });
});

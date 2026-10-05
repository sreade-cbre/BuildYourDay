import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleBlocks } from '../src/core/defaults';
import {
  CORRUPT_KEY_PREFIX,
  PERSIST_MESSAGES,
  STORAGE_KEY,
  Saver,
  exportFileName,
  parseImport,
  readSave,
  serializeExport,
  usableStorage,
  type StorageLike,
} from '../src/core/persist';
import { Store } from '../src/core/store';

const TODAY = '2026-10-05';

class MemoryStorage implements StorageLike {
  readonly items = new Map<string, string>();
  writes = 0;
  failWrites = false;
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.writes += 1;
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

function sampleStore(): Store {
  const store = new Store({ today: TODAY, now: () => 1 });
  store.addBlocks(TODAY, sampleBlocks(store.settings.categories), 'sample');
  store.updateSettings({ theme: 'dark', slotMinutes: 30 });
  return store;
}

describe('usableStorage', () => {
  it('returns storage that accepts writes', () => {
    const storage = new MemoryStorage();
    expect(usableStorage(() => storage)).toBe(storage);
    expect(storage.items.size).toBe(0);
  });

  it('returns null when storage is missing, throws on access, or refuses writes', () => {
    expect(usableStorage(() => null)).toBeNull();
    expect(usableStorage(() => {
      throw new Error('SecurityError');
    })).toBeNull();
    const full = new MemoryStorage();
    full.failWrites = true;
    expect(usableStorage(() => full)).toBeNull();
  });
});

describe('readSave', () => {
  it('starts fresh when nothing is saved', () => {
    expect(readSave(new MemoryStorage(), TODAY)).toEqual({ kind: 'fresh' });
  });

  it('loads a saved file', () => {
    const storage = new MemoryStorage();
    const save = sampleStore().toSaveFile();
    storage.setItem(STORAGE_KEY, JSON.stringify(save));
    const outcome = readSave(storage, TODAY);
    expect(outcome).toEqual({ kind: 'loaded', save, changes: [] });
  });

  it('backs up unreadable JSON and starts fresh', () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, '{ broken');
    const outcome = readSave(storage, TODAY, 1234);
    expect(outcome).toEqual({ kind: 'unreadable', backupKey: `${CORRUPT_KEY_PREFIX}1234` });
    expect(storage.getItem(`${CORRUPT_KEY_PREFIX}1234`)).toBe('{ broken');
    // The next start finds nothing to back up again.
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    expect(readSave(storage, TODAY, 5678)).toEqual({ kind: 'fresh' });
  });

  it('keeps unreadable data in place when the backup cannot be written', () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, '{ broken');
    storage.failWrites = true;
    expect(readSave(storage, TODAY, 1)).toEqual({ kind: 'unreadable', backupKey: null });
    expect(storage.getItem(STORAGE_KEY)).toBe('{ broken');
  });

  it('backs up a save from a newer version rather than reading it', () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 9, days: {} }));
    expect(readSave(storage, TODAY, 5)).toMatchObject({ kind: 'unreadable', backupKey: `${CORRUPT_KEY_PREFIX}5` });
  });

  it('has the spec wording for the unreadable toast', () => {
    expect(PERSIST_MESSAGES.unreadable).toBe('Saved data could not be read. A backup was kept.');
  });
});

describe('Saver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('collapses changes inside 250 ms into one write', () => {
    const storage = new MemoryStorage();
    const store = sampleStore();
    const saver = new Saver(storage, () => store.toSaveFile());
    saver.schedule();
    vi.advanceTimersByTime(100);
    saver.schedule();
    vi.advanceTimersByTime(100);
    saver.schedule();
    expect(storage.writes).toBe(0);
    vi.advanceTimersByTime(250);
    expect(storage.writes).toBe(1);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(store.toSaveFile());
  });

  it('holds writes while paused and writes once on resume', () => {
    const storage = new MemoryStorage();
    const saver = new Saver(storage, () => sampleStore().toSaveFile());
    saver.pause();
    saver.schedule();
    vi.advanceTimersByTime(1000);
    expect(storage.writes).toBe(0);
    saver.resume();
    vi.advanceTimersByTime(250);
    expect(storage.writes).toBe(1);
  });

  it('flushes a pending change at once and skips when nothing changed', () => {
    const storage = new MemoryStorage();
    const saver = new Saver(storage, () => sampleStore().toSaveFile());
    saver.flush();
    expect(storage.writes).toBe(0);
    saver.schedule();
    saver.flush();
    expect(storage.writes).toBe(1);
  });

  it('reports a failed write and stops trying', () => {
    const storage = new MemoryStorage();
    storage.failWrites = true;
    const failures: unknown[] = [];
    const saver = new Saver(storage, () => sampleStore().toSaveFile(), (e) => failures.push(e));
    saver.schedule();
    vi.advanceTimersByTime(250);
    expect(failures).toHaveLength(1);
    expect(saver.saving).toBe(false);
    saver.schedule();
    vi.advanceTimersByTime(250);
    expect(failures).toHaveLength(1);
  });

  it('does nothing without storage', () => {
    const saver = new Saver(null, () => sampleStore().toSaveFile());
    expect(saver.saving).toBe(false);
    saver.schedule();
    saver.flush();
  });
});

describe('export and import', () => {
  it('names the file after the date', () => {
    expect(exportFileName(TODAY)).toBe('timetower-2026-10-05.json');
  });

  it('round trips the full save identically', () => {
    const store = sampleStore();
    const before = store.toSaveFile();
    const parsed = parseImport(serializeExport(before), TODAY);
    expect(parsed).toEqual({ ok: true, save: before, changes: [] });

    const other = new Store({ today: TODAY });
    if (parsed.ok) other.load(parsed.save);
    expect(other.toSaveFile()).toEqual(before);
    expect(JSON.stringify(other.toSaveFile())).toBe(JSON.stringify(before));
  });

  it('refuses unreadable and newer files with the spec wording', () => {
    expect(parseImport('nope', TODAY)).toEqual({ ok: false, error: PERSIST_MESSAGES.importUnreadable });
    expect(parseImport('{"version": 3}', TODAY)).toEqual({ ok: false, error: 'This file was made with a newer version.' });
    expect(parseImport('{"hello": 1}', TODAY)).toEqual({ ok: false, error: PERSIST_MESSAGES.importUnreadable });
  });
});

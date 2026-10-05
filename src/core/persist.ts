import { migrate } from './migrate';
import type { IsoDate, SaveFile } from './model';

// Local persistence (spec section 15). The storage object is passed in, so
// this module stays free of the DOM: the app hands it window.localStorage, and
// tests hand it a map.

export const STORAGE_KEY = 'timetower.save';
export const CORRUPT_KEY_PREFIX = 'timetower.save.corrupt.';
/** Debounce for writes after a committed change. */
export const SAVE_DELAY_MS = 250;

export const PERSIST_MESSAGES = {
  unreadable: 'Saved data could not be read. A backup was kept.',
  storageUnavailable: 'Not saving: storage unavailable',
  importUnreadable: 'That file could not be read, so choose a JSON file exported from Time Tower.',
  importNewer: 'This file was made with a newer version.',
} as const;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * The storage to use, or null when it is missing or refuses writes (private
 * browsing, disabled storage, a full quota). Checked with a test write.
 */
export function usableStorage(get: () => StorageLike | null | undefined): StorageLike | null {
  try {
    const storage = get();
    if (!storage) return null;
    const probe = `${STORAGE_KEY}.probe`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

export type LoadOutcome =
  | { kind: 'fresh' }
  | { kind: 'loaded'; save: SaveFile; changes: string[] }
  | { kind: 'unreadable'; backupKey: string | null };

/**
 * Reads the save once at startup. Unreadable data (bad JSON, a bad shape, or
 * a newer version) is copied to a timestamped backup key so nothing is lost,
 * and the app starts fresh.
 */
export function readSave(storage: StorageLike, today: IsoDate, now: number = Date.now()): LoadOutcome {
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { kind: 'fresh' };
  }
  if (raw === null) return { kind: 'fresh' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'unreadable', backupKey: backup(storage, raw, now) };
  }
  const result = migrate(parsed, today);
  if (!result.ok) return { kind: 'unreadable', backupKey: backup(storage, raw, now) };
  return { kind: 'loaded', save: result.save, changes: result.changes };
}

/**
 * Copies unreadable data to a timestamped key, then clears the main key so the
 * next start does not back the same data up again. If the copy fails, the
 * original stays where it is rather than being lost.
 */
function backup(storage: StorageLike, raw: string, now: number): string | null {
  const key = `${CORRUPT_KEY_PREFIX}${now}`;
  try {
    storage.setItem(key, raw);
  } catch {
    return null;
  }
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // The backup exists; a stale main key only costs another backup later.
  }
  return key;
}

/**
 * Writes the save after changes settle. Calls to schedule() inside the delay
 * collapse into one write. A failed write (a full quota, say) stops further
 * attempts and reports through onFailure so the app can say it is not saving.
 */
export class Saver {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private failed = false;
  private pausedCount = 0;
  private pending = false;

  constructor(
    private readonly storage: StorageLike | null,
    private readonly snapshot: () => SaveFile,
    private readonly onFailure: (error: unknown) => void = () => {},
    private readonly delayMs: number = SAVE_DELAY_MS,
  ) {}

  /** True while changes are reaching storage. */
  get saving(): boolean {
    return this.storage !== null && !this.failed;
  }

  schedule(): void {
    if (!this.saving) return;
    this.pending = true;
    if (this.pausedCount > 0) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delayMs);
  }

  /** Writes now if a change is waiting. */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.pending || !this.saving || this.pausedCount > 0) return;
    this.pending = false;
    try {
      this.storage!.setItem(STORAGE_KEY, JSON.stringify(this.snapshot()));
    } catch (error) {
      this.failed = true;
      this.onFailure(error);
    }
  }

  /** Holds writes, for example while a modal previews unsaved settings. */
  pause(): void {
    this.pausedCount += 1;
  }

  resume(): void {
    this.pausedCount = Math.max(0, this.pausedCount - 1);
    if (this.pausedCount === 0 && this.pending) this.schedule();
  }
}

/** "timetower-2026-10-05.json". */
export function exportFileName(today: IsoDate): string {
  return `timetower-${today}.json`;
}

/** The export file body: the full save, indented for people to read. */
export function serializeExport(save: SaveFile): string {
  return `${JSON.stringify(save, null, 2)}\n`;
}

export type ImportOutcome = { ok: true; save: SaveFile; changes: string[] } | { ok: false; error: string };

/** Parses and migrates an imported file. Never touches the store. */
export function parseImport(text: string, today: IsoDate): ImportOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: PERSIST_MESSAGES.importUnreadable };
  }
  const result = migrate(parsed, today);
  if (!result.ok) {
    return { ok: false, error: result.reason === 'newer' ? PERSIST_MESSAGES.importNewer : PERSIST_MESSAGES.importUnreadable };
  }
  return { ok: true, save: result.save, changes: result.changes };
}

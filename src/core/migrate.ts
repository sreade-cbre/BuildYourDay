import { DEFAULT_CATEGORIES, LIMITS, defaultSettings } from './defaults';
import {
  SLOT_SIZES,
  SWATCH_TOKENS,
  type Block,
  type Category,
  type DayPlan,
  type IsoDate,
  type SaveFile,
  type Settings,
  type SwatchToken,
} from './model';
import { validateSettings } from './store';
import { clamp, isIsoDate } from './time';

// Brings any saved or imported data up to SaveFile version 1 (spec section
// 15.2): validates the shape, fills missing settings with defaults, repairs
// blocks where it can (snap, clamp, drop zero length), drops what it cannot,
// and reports every change.
//
// Version 0 is any object with a `blocks` array; it becomes one day, today.
// Its blocks are clamped to the day window because they carry no window of
// their own. Version 1 saves keep blocks outside the current window, because
// section 6 keeps such blocks so that changing the window back restores them.

export type MigrateResult =
  | { ok: true; save: SaveFile; changes: string[] }
  | { ok: false; reason: 'newer' | 'invalid' };

export interface MigrateOptions {
  /** Id factory for blocks that arrive without a usable id. */
  createId?: () => string;
  /** Clock for blocks that arrive without createdAt. */
  now?: () => number;
  /** Log changes to the console. On by default. */
  log?: boolean;
}

/** The finest slot. Every repaired time lands on this grid. */
const GRID = 5;
const DAY_MINUTES = 1440;

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

interface Context {
  changes: string[];
  createId: () => string;
  now: () => number;
}

export function migrate(raw: unknown, today: IsoDate, options: MigrateOptions = {}): MigrateResult {
  if (!isRecord(raw)) return { ok: false, reason: 'invalid' };
  const version = raw.version;
  if (typeof version === 'number' && version > 1) return { ok: false, reason: 'newer' };

  let counter = 0;
  const context: Context = {
    changes: [],
    createId: options.createId ?? (() => `m${Date.now().toString(36)}${(counter += 1).toString(36)}`),
    now: options.now ?? Date.now,
  };

  let save: SaveFile;
  if (version === 1) {
    save = fromVersion1(raw, today, context);
  } else if ((version === 0 || version === undefined) && Array.isArray(raw.blocks)) {
    save = fromVersion0(raw, raw.blocks, today, context);
  } else {
    return { ok: false, reason: 'invalid' };
  }

  if (options.log !== false && context.changes.length > 0) {
    console.info(`Time Tower adjusted saved data (${context.changes.length} changes):`, context.changes);
  }
  return { ok: true, save, changes: context.changes };
}

function fromVersion0(raw: Raw, blocks: unknown[], today: IsoDate, context: Context): SaveFile {
  context.changes.push(`Read a version 0 plan as ${today}.`);
  const settings = repairSettings(raw.settings, context, raw.settings === undefined);
  const repaired = repairBlocks(blocks, today, settings, context, true);
  return {
    version: 1,
    settings,
    days: repaired.length > 0 ? { [today]: { date: today, blocks: repaired } } : {},
    lastViewedDate: today,
  };
}

function fromVersion1(raw: Raw, today: IsoDate, context: Context): SaveFile {
  const settings = repairSettings(raw.settings, context, false);
  const days: Record<IsoDate, DayPlan> = {};
  if (raw.days !== undefined && !isRecord(raw.days)) context.changes.push('days was not an object; no days were read.');
  const rawDays = isRecord(raw.days) ? raw.days : {};
  if (raw.days === undefined) context.changes.push('days was missing; started with no days.');

  for (const date of Object.keys(rawDays).sort()) {
    const plan = rawDays[date];
    if (!isIsoDate(date)) {
      context.changes.push(`Dropped day "${date}": not a valid date.`);
      continue;
    }
    if (!isRecord(plan) || !Array.isArray(plan.blocks)) {
      context.changes.push(`Dropped day ${date}: it had no blocks list.`);
      continue;
    }
    if (plan.date !== date) context.changes.push(`Day ${date}: set its date field to match its key.`);
    const blocks = repairBlocks(plan.blocks, date, settings, context, false);
    if (blocks.length > 0) days[date] = { date, blocks };
  }

  let lastViewedDate = raw.lastViewedDate;
  if (!isIsoDate(lastViewedDate)) {
    context.changes.push(`lastViewedDate was missing or invalid; used ${today}.`);
    lastViewedDate = today;
  }
  return { version: 1, settings, days, lastViewedDate: lastViewedDate as IsoDate };
}

/** Settings with every missing or invalid field replaced by its default. */
function repairSettings(raw: unknown, context: Context, quietWhenMissing: boolean): Settings {
  const defaults = defaultSettings();
  if (!isRecord(raw)) {
    if (!quietWhenMissing) context.changes.push('settings were missing or invalid; used the defaults.');
    return defaults;
  }
  const settings: Settings = { ...defaults, categories: repairCategories(raw.categories, context) };

  const dayStart = finiteNumber(raw.dayStart);
  const dayEnd = finiteNumber(raw.dayEnd);
  const windowCheck = validateSettings({ ...defaults, dayStart: dayStart ?? NaN, dayEnd: dayEnd ?? NaN });
  if (dayStart !== null && dayEnd !== null && windowCheck === null) {
    settings.dayStart = dayStart;
    settings.dayEnd = dayEnd;
  } else {
    context.changes.push('settings day window was missing or invalid; used 07:00 to 18:00.');
  }

  pick(raw, 'slotMinutes', (v) => SLOT_SIZES.includes(v as Settings['slotMinutes']), settings, context);
  pick(raw, 'timeFormat', (v) => v === '12h' || v === '24h', settings, context);
  pick(
    raw,
    'animationSpeed',
    (v) => typeof v === 'number' && v >= LIMITS.minAnimationSpeed && v <= LIMITS.maxAnimationSpeed,
    settings,
    context,
  );
  pick(raw, 'reducedMotion', (v) => v === 'system' || v === 'on' || v === 'off', settings, context);
  pick(raw, 'idleOrbit', (v) => typeof v === 'boolean', settings, context);
  pick(raw, 'labelMode', (v) => v === 'always' || v === 'hover', settings, context);
  pick(raw, 'weatherPastBlocks', (v) => typeof v === 'boolean', settings, context);
  pick(raw, 'theme', (v) => v === 'light' || v === 'dark', settings, context);
  pick(raw, 'paletteMode', (v) => v === 'strict' || v === 'accents', settings, context);
  return settings;
}

type SimpleKey = Exclude<keyof Settings, 'categories' | 'dayStart' | 'dayEnd'>;

function pick(raw: Raw, key: SimpleKey, valid: (value: unknown) => boolean, settings: Settings, context: Context): void {
  const value = raw[key];
  if (value === undefined) {
    context.changes.push(`settings.${key} was missing; used ${JSON.stringify(settings[key])}.`);
  } else if (valid(value)) {
    (settings as unknown as Raw)[key] = value;
  } else {
    context.changes.push(`settings.${key} was invalid (${JSON.stringify(value)}); used ${JSON.stringify(settings[key])}.`);
  }
}

function repairCategories(raw: unknown, context: Context): Category[] {
  if (!Array.isArray(raw)) {
    context.changes.push('settings.categories was missing or invalid; used the defaults.');
    return DEFAULT_CATEGORIES.map((c) => ({ ...c }));
  }
  const kept: Category[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  raw.forEach((entry, index) => {
    if (!isRecord(entry)) {
      context.changes.push(`Dropped category ${index + 1}: not an object.`);
      return;
    }
    const id = entry.id;
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    const color = entry.color;
    const problem =
      typeof id !== 'string' || id === '' ? 'no id'
      : ids.has(id) ? 'a repeated id'
      : name.length < 1 || name.length > LIMITS.categoryNameMax ? 'an invalid name'
      : names.has(name.toLowerCase()) ? 'a repeated name'
      : !SWATCH_TOKENS.includes(color as SwatchToken) ? 'a color outside the palette'
      : kept.length >= LIMITS.maxCategories ? 'too many categories'
      : null;
    if (problem) {
      context.changes.push(`Dropped category ${index + 1}: ${problem}.`);
      return;
    }
    ids.add(id as string);
    names.add(name.toLowerCase());
    kept.push({ id: id as string, name, color: color as SwatchToken });
  });
  if (kept.length === 0) {
    context.changes.push('No usable categories; used the defaults.');
    return DEFAULT_CATEGORIES.map((c) => ({ ...c }));
  }
  return kept;
}

/**
 * Repairs one day's blocks: times snap to the 5 minute grid and clamp to the
 * day (and to the window when `clampToWindow`), zero length blocks drop,
 * unknown categories move to the first category, and overlaps and blocks past
 * the 48 block cap drop, keeping the earliest.
 */
function repairBlocks(
  raw: unknown[],
  date: IsoDate,
  settings: Settings,
  context: Context,
  clampToWindow: boolean,
): Block[] {
  const known = new Set(settings.categories.map((c) => c.id));
  const fallback = settings.categories[0]!.id;
  const low = clampToWindow ? settings.dayStart : 0;
  const high = clampToWindow ? settings.dayEnd : DAY_MINUTES;
  const candidates: Block[] = [];

  raw.forEach((entry, index) => {
    const label = `${date} block ${index + 1}`;
    if (!isRecord(entry)) {
      context.changes.push(`Dropped ${label}: not an object.`);
      return;
    }
    const rawStart = finiteNumber(entry.start);
    const rawEnd = finiteNumber(entry.end);
    if (rawStart === null || rawEnd === null) {
      context.changes.push(`Dropped ${label}: start or end was not a number.`);
      return;
    }
    const start = clamp(Math.round(rawStart / GRID) * GRID, low, high);
    const end = clamp(Math.round(rawEnd / GRID) * GRID, low, high);
    if (end <= start) {
      context.changes.push(`Dropped ${label}: no time left after repair (${rawStart} to ${rawEnd}).`);
      return;
    }
    if (start !== rawStart || end !== rawEnd) {
      context.changes.push(`Repaired ${label} times from ${rawStart} to ${rawEnd} into ${start} to ${end}.`);
    }

    let id = entry.id;
    if (typeof id !== 'string' || id === '') {
      id = context.createId();
      context.changes.push(`Gave ${label} a new id.`);
    }
    let title = typeof entry.title === 'string' ? entry.title.trim() : '';
    if (title.length > LIMITS.titleMax) {
      title = title.slice(0, LIMITS.titleMax);
      context.changes.push(`Shortened ${label} title to ${LIMITS.titleMax} characters.`);
    }
    let categoryId = entry.categoryId;
    if (typeof categoryId !== 'string' || !known.has(categoryId)) {
      context.changes.push(`Moved ${label} to category "${fallback}": its category was unknown.`);
      categoryId = fallback;
    }
    const createdAt = finiteNumber(entry.createdAt) ?? context.now();
    candidates.push({ id: id as string, title, start, end, categoryId: categoryId as string, createdAt });
  });

  candidates.sort((a, b) => a.start - b.start || a.end - b.end);
  const kept: Block[] = [];
  const ids = new Set<string>();
  for (const block of candidates) {
    const previous = kept[kept.length - 1];
    if (previous && block.start < previous.end) {
      context.changes.push(`Dropped ${date} block ${block.id}: it overlapped ${previous.id}.`);
      continue;
    }
    if (kept.length >= LIMITS.maxBlocksPerDay) {
      context.changes.push(`Dropped ${date} block ${block.id}: past the ${LIMITS.maxBlocksPerDay} block limit.`);
      continue;
    }
    if (ids.has(block.id)) {
      const fresh = context.createId();
      context.changes.push(`Gave ${date} block ${block.id} a new id: the id repeated.`);
      block.id = fresh;
    }
    ids.add(block.id);
    kept.push(block);
  }
  return kept;
}

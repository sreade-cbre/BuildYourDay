import type { Block, CategoryId, Settings, TimeRange } from './model';
import { ceilToSlot, clamp, floorToSlot } from './time';

// Time to geometry mapping (spec section 7). Pure functions, no three.

export const UNITS_PER_MINUTE = 0.05;   // 60 min = 3.0 world units tall
export const BLOCK_FOOTPRINT = 4.0;      // x and z extent of every block
export const PLOT_SIZE = 10.0;           // grass plot is 10 x 10
export const DEPOT_OFFSET = 8.0;         // depot pad center is 8 units in +x from plot center
export const MIN_BLOCK_UNITS = 0.25;     // a 5 min block at slot 5 is 0.25 tall; still visible

type WindowSettings = Pick<Settings, 'dayStart' | 'dayEnd'>;
type SlotWindowSettings = Pick<Settings, 'dayStart' | 'dayEnd' | 'slotMinutes'>;

/** World y of a time. y = 0 is the top of the foundation slab, at dayStart. */
export function minutesToY(minutes: number, settings: WindowSettings): number {
  return (minutes - settings.dayStart) * UNITS_PER_MINUTE;
}

/** Inverse of minutesToY, unsnapped. */
export function yToMinutes(y: number, settings: WindowSettings): number {
  return y / UNITS_PER_MINUTE + settings.dayStart;
}

/** Height of the full day window. Used for camera framing. */
export function towerHeight(settings: WindowSettings): number {
  return (settings.dayEnd - settings.dayStart) * UNITS_PER_MINUTE;
}

/** Rendered height of a span of minutes, never below MIN_BLOCK_UNITS. */
export function spanHeight(minutes: number): number {
  return Math.max(MIN_BLOCK_UNITS, minutes * UNITS_PER_MINUTE);
}

/** The part of a range that lies inside the day window, or null. */
export function clipToWindow(range: TimeRange, settings: WindowSettings): TimeRange | null {
  const start = clamp(range.start, settings.dayStart, settings.dayEnd);
  const end = clamp(range.end, settings.dayStart, settings.dayEnd);
  return end > start ? { start, end } : null;
}

/** True when the block lies fully inside the day window. */
export function isInWindow(block: TimeRange, settings: WindowSettings): boolean {
  return block.start >= settings.dayStart && block.end <= settings.dayEnd;
}

/**
 * Unplanned ranges inside the day window, in time order. Blocks may arrive in
 * any order and may poke outside the window; only the covered part counts.
 */
export function computeGaps(blocks: readonly TimeRange[], settings: WindowSettings): TimeRange[] {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || a.end - b.end);
  const gaps: TimeRange[] = [];
  let cursor = settings.dayStart;
  for (const block of sorted) {
    const clipped = clipToWindow(block, settings);
    if (!clipped) continue;
    if (clipped.start > cursor) gaps.push({ start: cursor, end: clipped.start });
    cursor = Math.max(cursor, clipped.end);
  }
  if (cursor < settings.dayEnd) gaps.push({ start: cursor, end: settings.dayEnd });
  return gaps;
}

export interface Totals {
  plannedMinutes: number;
  freeMinutes: number;
  byCategory: Record<CategoryId, number>;
}

/**
 * Planned and free minutes inside the day window. Only the in-window part of a
 * block counts, so planned plus free always equals the window length and the
 * category totals always add up to the planned total. Every current category
 * appears in byCategory, with 0 when it has no blocks.
 */
export function totals(
  blocks: readonly Block[],
  settings: WindowSettings & Partial<Pick<Settings, 'categories'>>,
): Totals {
  const byCategory: Record<CategoryId, number> = {};
  for (const category of settings.categories ?? []) byCategory[category.id] = 0;
  let planned = 0;
  for (const block of blocks) {
    const clipped = clipToWindow(block, settings);
    const minutes = clipped ? clipped.end - clipped.start : 0;
    planned += minutes;
    byCategory[block.categoryId] = (byCategory[block.categoryId] ?? 0) + minutes;
  }
  return {
    plannedMinutes: planned,
    freeMinutes: settings.dayEnd - settings.dayStart - planned,
    byCategory,
  };
}

/**
 * Whether a candidate span can sit in the tower: whole minutes, a positive
 * length, inside the day window, and clear of every other block. A block with
 * the candidate's id is ignored so the same check works for edits. Slot
 * alignment and minimum length are store rules, checked there.
 */
export function canPlace(
  blocks: readonly Block[],
  candidate: Pick<Block, 'id' | 'start' | 'end'>,
  settings: WindowSettings,
): boolean {
  const { start, end } = candidate;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return false;
  if (end <= start) return false;
  if (start < settings.dayStart || end > settings.dayEnd) return false;
  return blocks.every((b) => b.id === candidate.id || b.end <= start || b.start >= end);
}

/**
 * The free range a new block should go in, trimmed to slot boundaries. Prefers
 * the range above the last block (the top of the tower); falls back to the
 * earliest gap that is long enough. Null when no gap holds `minMinutes`.
 */
export function nextFreeRange(
  blocks: readonly Block[],
  settings: SlotWindowSettings,
  minMinutes: number,
): TimeRange | null {
  const slot = settings.slotMinutes;
  const needed = Math.max(1, minMinutes);
  const usable = computeGaps(blocks, settings)
    .map((gap) => ({ start: ceilToSlot(gap.start, slot), end: floorToSlot(gap.end, slot) }))
    .filter((gap) => gap.end - gap.start >= needed);
  if (usable.length === 0) return null;
  // Only the trailing gap can reach the end of the window.
  const top = usable[usable.length - 1]!;
  return top.end === floorToSlot(settings.dayEnd, slot) ? top : usable[0]!;
}

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

/** Default length of a new block from the Add button (spec section 12.1). */
export const NEW_BLOCK_MINUTES = 60;
/** Longest range a gap click prefills (spec section 12.1). */
export const GAP_DRAFT_MAX_MINUTES = 120;

/**
 * Where a new block from the Add button goes: the start of the next free
 * range, running 60 minutes or to the end of that range. Null on a full day.
 */
export function defaultNewRange(blocks: readonly Block[], settings: SlotWindowSettings): TimeRange | null {
  const range = nextFreeRange(blocks, settings, settings.slotMinutes);
  if (!range) return null;
  return { start: range.start, end: Math.min(range.end, range.start + NEW_BLOCK_MINUTES) };
}

/**
 * The prefill for a click on a gap: the gap trimmed to slot boundaries and
 * capped at 120 minutes from its start. Null when less than a slot remains.
 */
export function gapDraftRange(gap: TimeRange, settings: SlotWindowSettings): TimeRange | null {
  const slot = settings.slotMinutes;
  const start = Math.max(ceilToSlot(gap.start, slot), settings.dayStart);
  const end = Math.min(floorToSlot(gap.end, slot), settings.dayEnd, start + GAP_DRAFT_MAX_MINUTES);
  return end - start >= slot ? { start, end } : null;
}

/**
 * How far a block may stretch: down to the end of the block before it (or the
 * window start) and up to the start of the block after it (or the window end).
 * Other blocks never move, so a resize stops at these limits (spec 12.3).
 */
export function resizeLimits(
  blocks: readonly Block[],
  block: Pick<Block, 'id' | 'start' | 'end'>,
  settings: WindowSettings,
): { minStart: number; maxEnd: number } {
  let minStart = settings.dayStart;
  let maxEnd = settings.dayEnd;
  for (const other of blocks) {
    if (other.id === block.id) continue;
    if (other.end <= block.start) minStart = Math.max(minStart, other.end);
    if (other.start >= block.end) maxEnd = Math.min(maxEnd, other.start);
  }
  return { minStart, maxEnd };
}

/**
 * The slot-aligned start nearest to `desired` where a block of `duration`
 * fits in free time, ignoring the block being moved. A dragged block lands
 * here, so it never pushes others aside. Ties go in the direction of travel.
 * Null when no free range is long enough.
 */
export function nearestFreeStart(
  blocks: readonly Block[],
  settings: SlotWindowSettings,
  duration: number,
  desired: number,
  excludeId: string,
  preferLater = true,
): number | null {
  const slot = settings.slotMinutes;
  const target = Math.round(desired / slot) * slot;
  const others = blocks.filter((b) => b.id !== excludeId);
  let best: number | null = null;
  let bestDistance = Infinity;
  for (const gap of computeGaps(others, settings)) {
    const earliest = ceilToSlot(gap.start, slot);
    const latest = floorToSlot(gap.end - duration, slot);
    if (latest < earliest) continue;
    const candidate = clamp(target, earliest, latest);
    const distance = Math.abs(candidate - target);
    const better =
      distance < bestDistance ||
      (distance === bestDistance && best !== null && (preferLater ? candidate > best : candidate < best));
    if (better) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

import { computeGaps, resizeLimits } from '../core/layout';
import type { Block, Settings, TimeRange } from '../core/model';
import { ceilToSlot, floorToSlot, formatTime, slotTimes } from '../core/time';
import { h } from './dom';

// Choices for start and end selects. Edit choices stop at the neighbors, so a
// select can never push another block (fixed times). New block choices list
// only free time.

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

/** Start and end choices for an existing block, around times being edited. */
export function editTimeOptions(
  blocks: readonly Block[],
  block: Block,
  times: TimeRange,
  settings: Readonly<Settings>,
): { starts: number[]; ends: number[] } {
  const slot = settings.slotMinutes;
  const limits = resizeLimits(blocks, block, settings);
  const minLength = Math.min(slot, block.end - block.start);
  const starts = slotTimes(ceilToSlot(limits.minStart, slot), times.end - minLength, slot);
  const ends = slotTimes(ceilToSlot(times.start + minLength, slot), floorToSlot(limits.maxEnd, slot), slot);
  // The block's own times stay listed even when they sit off the current grid.
  return {
    starts: uniqueSorted([...starts, block.start, times.start]),
    ends: uniqueSorted([...ends, block.end, times.end]),
  };
}

/** The free range containing a time, if any. */
export function freeRangeAt(blocks: readonly Block[], time: number, settings: Readonly<Settings>): TimeRange | null {
  return computeGaps(blocks, settings).find((gap) => gap.start <= time && time < gap.end) ?? null;
}

/** Start and end choices for a block that does not exist yet. */
export function newTimeOptions(
  blocks: readonly Block[],
  draft: TimeRange,
  settings: Readonly<Settings>,
): { starts: number[]; ends: number[] } {
  const slot = settings.slotMinutes;
  const starts: number[] = [];
  for (const gap of computeGaps(blocks, settings)) {
    starts.push(...slotTimes(gap.start, floorToSlot(gap.end, slot) - slot, slot));
  }
  const free = freeRangeAt(blocks, draft.start, settings);
  const ends = free ? slotTimes(draft.start + slot, floorToSlot(free.end, slot), slot) : [];
  return { starts: uniqueSorted([...starts, draft.start]), ends: uniqueSorted([...ends, draft.end]) };
}

/** A draft's end after its start changes: same length where the free time allows. */
export function draftEndFor(
  blocks: readonly Block[],
  draft: TimeRange,
  newStart: number,
  settings: Readonly<Settings>,
): number {
  const slot = settings.slotMinutes;
  const length = Math.max(draft.end - draft.start, slot);
  const free = freeRangeAt(blocks, newStart, settings);
  return free ? Math.min(newStart + length, floorToSlot(free.end, slot)) : newStart + length;
}

const optionKeys = new WeakMap<HTMLSelectElement, string>();

/** Fills a select with times, rebuilding options only when the list changed. */
export function fillTimeSelect(
  select: HTMLSelectElement,
  times: readonly number[],
  value: number,
  settings: Pick<Settings, 'timeFormat'>,
): void {
  const key = `${settings.timeFormat}:${times.join(',')}`;
  if (optionKeys.get(select) !== key) {
    optionKeys.set(select, key);
    select.replaceChildren(...times.map((t) => h('option', { text: formatTime(t, settings), attrs: { value: t } })));
  }
  select.value = String(value);
}

import type { IsoDate, TimeRange } from './model';

// Construction follows the clock: a block is planned until its start, is
// built while its time runs, and is done once its end has passed. Earlier
// days are all done and later days are all planned. Pure, so it is unit
// tested.

export type BuildState = 'planned' | 'building' | 'built';

/** Today's date and the minutes into it, from the wall clock. */
export interface Clock {
  today: IsoDate;
  minutes: number;
}

/** Where a block on `date` stands by the clock. */
export function buildState(range: TimeRange, date: IsoDate, clock: Clock): BuildState {
  if (date < clock.today) return 'built';
  if (date > clock.today) return 'planned';
  if (clock.minutes >= range.end) return 'built';
  return clock.minutes >= range.start ? 'building' : 'planned';
}

/** How much of a block's time has passed, from 0 at its start to 1 at its end. */
export function buildProgress(range: TimeRange, minutes: number): number {
  const length = range.end - range.start;
  if (length <= 0) return 1;
  return Math.min(1, Math.max(0, (minutes - range.start) / length));
}

/**
 * The next minute after `minutes` at which a block starts or ends, so the
 * app can wake exactly then, or null when nothing more changes today.
 */
export function nextChange(blocks: readonly TimeRange[], minutes: number): number | null {
  let next: number | null = null;
  for (const block of blocks) {
    for (const edge of [block.start, block.end]) {
      if (edge > minutes && (next === null || edge < next)) next = edge;
    }
  }
  return next;
}

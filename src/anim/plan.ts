import type { Block, BlockId, IsoDate, TimeRange } from '../core/model';
import type { BlockChange, StoreEvent } from '../core/store';

// Turns store changes into the jobs that animate them (spec 9.2). Times are
// fixed (M2 decision 1): an edit never moves another block, so a deletion
// leaves free time, and only a swap from Move earlier or Move later moves two
// blocks at once. Free of three and the DOM, so it is unit tested.

export interface BlockMove {
  /** The block before the change. */
  from: Block;
  /** The block after the change. */
  to: Block;
}

export type JobPlan =
  | { kind: 'build'; block: Block; fast: boolean }
  | { kind: 'demolish'; block: Block }
  | { kind: 'resize'; move: BlockMove }
  | { kind: 'relocate'; move: BlockMove; settles: BlockMove[] }
  | { kind: 'settle'; moves: BlockMove[] };

export interface Plan {
  /** Finish whatever is playing at once before anything new is queued. */
  finish: boolean;
  jobs: JobPlan[];
}

const NOTHING: Plan = { finish: false, jobs: [] };
const FINISH: Plan = { finish: true, jobs: [] };

/** A move that lands on or beside where the block was can slide there (spec 12.4). */
export function isAdjacentMove(from: TimeRange, to: TimeRange): boolean {
  return to.start <= from.end && from.start <= to.end;
}

function movesOf(changes: readonly BlockChange[], kind: 'moved' | 'resized'): BlockMove[] {
  return changes.filter((c) => c.kind === kind && c.previous).map((c) => ({ from: c.previous!, to: c.block }));
}

/**
 * A single move slides when it is adjacent and is relocated otherwise. When
 * two blocks trade places, one of them must leave the tower so they never
 * pass through each other: the one whose move is not adjacent, or failing
 * that the selected block, which Move earlier and Move later act on.
 */
function planMoves(moves: BlockMove[], selectedId: BlockId | null): JobPlan[] {
  if (moves.length === 0) return [];
  if (moves.length === 1) {
    const move = moves[0]!;
    return isAdjacentMove(move.from, move.to) ? [{ kind: 'settle', moves }] : [{ kind: 'relocate', move, settles: [] }];
  }
  const distance = (m: BlockMove) => Math.abs(m.to.start - m.from.start);
  const ranked = [...moves].sort((a, b) => {
    const jumpA = isAdjacentMove(a.from, a.to) ? 0 : 1;
    const jumpB = isAdjacentMove(b.from, b.to) ? 0 : 1;
    if (jumpA !== jumpB) return jumpB - jumpA;
    if (distance(a) !== distance(b)) return distance(b) - distance(a);
    return (b.to.id === selectedId ? 1 : 0) - (a.to.id === selectedId ? 1 : 0);
  });
  const [move, ...settles] = ranked;
  return [{ kind: 'relocate', move: move!, settles }];
}

/**
 * The jobs for a store event on the viewed day. Users' single edits animate;
 * an undone deletion of one block rebuilds it fast (spec 12.6); bulk changes
 * such as the sample day, copying a day, imports, settings, and clearing a
 * day finish whatever is playing and show at once.
 */
export function planJobs(event: StoreEvent, viewedDate: IsoDate, selectedId: BlockId | null): Plan {
  if (event.type !== 'blocks') return FINISH;
  if (event.date !== viewedDate) return NOTHING;
  const { changes, origin } = event;
  const added = changes.filter((c) => c.kind === 'added');
  const removed = changes.filter((c) => c.kind === 'removed');

  if (origin === 'undo') {
    return added.length === 1 ? { finish: false, jobs: [{ kind: 'build', block: added[0]!.block, fast: true }] } : FINISH;
  }
  if (origin !== 'user') return FINISH;

  // A new color applies at once, so anything mid-build finishes first.
  const finish = changes.some((c) => c.kind === 'recategorized') || added.length > 1 || removed.length > 1;
  const jobs: JobPlan[] = [];
  if (added.length === 1) jobs.push({ kind: 'build', block: added[0]!.block, fast: false });
  if (removed.length === 1) jobs.push({ kind: 'demolish', block: removed[0]!.block });
  for (const move of movesOf(changes, 'resized')) jobs.push({ kind: 'resize', move });
  jobs.push(...planMoves(movesOf(changes, 'moved'), selectedId));
  return { finish, jobs };
}

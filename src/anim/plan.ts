import type { Block, BlockId, IsoDate, TimeRange } from '../core/model';
import type { BuildState } from '../core/progress';
import type { BlockChange, StoreEvent } from '../core/store';

// Turns store changes into the jobs that animate them (spec 9.2). Times are
// fixed (M2 decision 1): an edit never moves another block, so a deletion
// leaves free time, and only a swap from Move earlier or Move later moves two
// blocks at once. Free of three and the DOM, so it is unit tested.
//
// Blocks are built in real time, so what an edit shows depends on where its
// block stands by the clock. A block whose time is up appears finished, the
// block under way gets its crew, and a planned block is only a plan: edits to
// it slide or fade, with no crew. The crane and the full crew animations are
// for finished blocks.

export interface BlockMove {
  /** The block before the change. */
  from: Block;
  /** The block after the change. */
  to: Block;
}

/** An undone deletion rebuilds at speed 3 (spec 12.6). */
export const UNDO_SPEED = 3;

/** Where blocks of the viewed day stand by the clock. */
export interface PlanClock {
  stateOf(range: TimeRange): BuildState;
  /** Minutes into the viewed day now, for the part of a block under way that stands. */
  minutes: number;
}

export type JobPlan =
  /** A block whose time is up appears, already finished. */
  | { kind: 'appear'; block: Block; speed?: number }
  /** The crew starts the block under way. */
  | { kind: 'start'; block: Block }
  /** The crew finishes a block an edit has made done. */
  | { kind: 'finish'; block: Block }
  /** A finished block, or the part of the block under way that stands, comes down. */
  | { kind: 'demolish'; block: Block }
  /** A planned block's plan fades away. */
  | { kind: 'vanish'; block: Block }
  /** `calm` plays the plain version, for a planned block. */
  | { kind: 'resize'; move: BlockMove; calm?: boolean }
  | { kind: 'relocate'; move: BlockMove; settles: BlockMove[] }
  | { kind: 'settle'; moves: BlockMove[]; calm?: boolean };

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

/** How a block that arrives shows: finished, started by the crew, or as a plan, which needs no job. */
function arrival(block: Block, clock: PlanClock, speed?: number): JobPlan[] {
  const state = clock.stateOf(block);
  if (state === 'built') return [speed === undefined ? { kind: 'appear', block } : { kind: 'appear', block, speed }];
  return state === 'building' ? [{ kind: 'start', block }] : [];
}

/**
 * A block that leaves: a finished one is demolished; the block under way
 * loses the part that stands, if a minute of it does; a plan fades.
 */
function departure(block: Block, clock: PlanClock): JobPlan[] {
  const state = clock.stateOf(block);
  if (state === 'built') return [{ kind: 'demolish', block }];
  if (state === 'building' && clock.minutes - block.start >= 1) return [{ kind: 'demolish', block: { ...block, end: clock.minutes } }];
  return [{ kind: 'vanish', block }];
}

/**
 * A block whose times moved it from one part of the day to another. Out of
 * the plan into the block under way, the crew starts it; out of the block
 * under way into the finished part, the crew finishes it; from the plan into
 * the finished part, it appears finished. Any other crossing shows at once,
 * and the site for the block under way follows on its own.
 */
function change(move: BlockMove, clock: PlanClock): JobPlan[] {
  const from = clock.stateOf(move.from);
  const to = clock.stateOf(move.to);
  if (from === 'planned' && to === 'building') return [{ kind: 'start', block: move.to }];
  if (from === 'building' && to === 'built') return [{ kind: 'finish', block: move.to }];
  if (from === 'planned' && to === 'built') return [{ kind: 'appear', block: move.to }];
  return [];
}

/**
 * The jobs for a store event on the viewed day. Users' single edits animate;
 * an undone deletion of one block comes back fast (spec 12.6). Bulk changes,
 * such as copying a day, the sample day, imports, settings, and clearing a
 * day, finish whatever is playing and show at once, except that the crew
 * starts on a block whose time is under way.
 */
export function planJobs(event: StoreEvent, viewedDate: IsoDate, selectedId: BlockId | null, clock: PlanClock): Plan {
  if (event.type !== 'blocks') return FINISH;
  if (event.date !== viewedDate) return NOTHING;
  const { changes, origin } = event;
  const added = changes.filter((c) => c.kind === 'added');
  const removed = changes.filter((c) => c.kind === 'removed');

  if (origin === 'undo') {
    return added.length === 1 ? { finish: false, jobs: arrival(added[0]!.block, clock, UNDO_SPEED) } : FINISH;
  }
  if (origin === 'copy' || origin === 'sample') {
    const underWay = added.map((c) => c.block).filter((b) => clock.stateOf(b) === 'building');
    return { finish: true, jobs: underWay.map((block) => ({ kind: 'start', block })) };
  }
  if (origin !== 'user') return FINISH;

  // A new color applies at once, so anything mid-build finishes first, and
  // so does anything at work on the block under way when it changes.
  const touchesUnderWay = changes.some(
    (c) => c.kind !== 'retitled' && (clock.stateOf(c.block) === 'building' || (c.previous !== undefined && clock.stateOf(c.previous) === 'building')),
  );
  const finish = changes.some((c) => c.kind === 'recategorized') || added.length > 1 || removed.length > 1 || touchesUnderWay;
  const jobs: JobPlan[] = [];
  if (added.length === 1) jobs.push(...arrival(added[0]!.block, clock));
  if (removed.length === 1) jobs.push(...departure(removed[0]!.block, clock));
  const stays = (move: BlockMove, state: BuildState) => clock.stateOf(move.from) === state && clock.stateOf(move.to) === state;
  for (const move of movesOf(changes, 'resized')) {
    if (stays(move, 'built')) jobs.push({ kind: 'resize', move });
    else if (stays(move, 'planned')) jobs.push({ kind: 'resize', move, calm: true });
    else jobs.push(...change(move, clock));
  }

  // Blocks that move within the finished part of the day animate together,
  // as do plans; any other move on its own.
  const moves = movesOf(changes, 'moved');
  const finished = moves.filter((m) => stays(m, 'built'));
  const planned = moves.filter((m) => stays(m, 'planned'));
  jobs.push(...planMoves(finished, selectedId));
  if (planned.length > 0) jobs.push({ kind: 'settle', moves: planned, calm: true });
  for (const move of moves) if (!finished.includes(move) && !planned.includes(move)) jobs.push(...change(move, clock));
  return { finish, jobs };
}

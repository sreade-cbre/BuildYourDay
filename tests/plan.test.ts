import { describe, expect, it } from 'vitest';
import { isAdjacentMove, planJobs, type PlanClock } from '../src/anim/plan';
import type { Block } from '../src/core/model';
import { buildState } from '../src/core/progress';
import type { BlockChange, ChangeOrigin, StoreEvent } from '../src/core/store';

const DAY = '2026-10-05';

function block(id: string, start: number, end: number): Block {
  return { id, title: id, start, end, categoryId: 'deep', createdAt: 0 };
}

function blocksEvent(changes: BlockChange[], origin: ChangeOrigin = 'user', date = DAY): StoreEvent {
  return { type: 'blocks', date, origin, changes };
}

function moved(from: Block, start: number, end = start + (from.end - from.start)): BlockChange {
  return { kind: 'moved', block: { ...from, start, end }, previous: from };
}

/** The viewed day at a minute: earlier blocks done, later ones planned; `built` is where the block under way's facade has got to. */
function at(minutes: number, built?: number): PlanClock {
  return { stateOf: (range) => buildState(range, DAY, { today: DAY, minutes }), builtTo: (block) => built ?? block.start };
}

/** Late in the day, when every block in these tests is done. */
const EVENING = at(1200);
/** Early in the day, when every block in these tests is planned. */
const DAWN = at(300);

describe('isAdjacentMove', () => {
  it('counts overlapping and touching ranges as adjacent', () => {
    expect(isAdjacentMove({ start: 540, end: 600 }, { start: 555, end: 615 })).toBe(true);
    expect(isAdjacentMove({ start: 540, end: 600 }, { start: 600, end: 660 })).toBe(true);
    expect(isAdjacentMove({ start: 540, end: 600 }, { start: 615, end: 675 })).toBe(false);
  });
});

describe('planJobs', () => {
  it('shows an added block by the clock: done appears, while under way and planned need no job', () => {
    const a = block('a', 540, 600);
    const added = blocksEvent([{ kind: 'added', block: a }]);
    expect(planJobs(added, DAY, null, EVENING)).toEqual({ finish: false, jobs: [{ kind: 'appear', block: a }] });
    expect(planJobs(added, DAY, null, at(570))).toEqual({ finish: true, jobs: [] });
    expect(planJobs(added, DAY, null, DAWN)).toEqual({ finish: false, jobs: [] });
  });

  it('brings back one undone deletion fast, and shows a whole day at once', () => {
    const a = block('a', 540, 600);
    expect(planJobs(blocksEvent([{ kind: 'added', block: a }], 'undo'), DAY, null, EVENING).jobs).toEqual([{ kind: 'appear', block: a, speed: 3 }]);
    expect(planJobs(blocksEvent([{ kind: 'added', block: a }], 'undo'), DAY, null, at(560)).jobs).toEqual([]);
    const day = [a, block('b', 600, 660)].map((b) => ({ kind: 'added' as const, block: b }));
    expect(planJobs(blocksEvent(day, 'undo'), DAY, null, EVENING)).toEqual({ finish: true, jobs: [] });
  });

  it('demolishes a done block, fades a plan, and clears a whole day at once', () => {
    const a = block('a', 540, 600);
    const removed = blocksEvent([{ kind: 'removed', block: a, previous: a }]);
    expect(planJobs(removed, DAY, null, EVENING).jobs).toEqual([{ kind: 'demolish', block: a }]);
    expect(planJobs(removed, DAY, null, DAWN).jobs).toEqual([{ kind: 'vanish', block: a }]);
    const b = block('b', 600, 660);
    const clear = [a, b].map((x) => ({ kind: 'removed' as const, block: x, previous: x }));
    expect(planJobs(blocksEvent(clear), DAY, null, EVENING)).toEqual({ finish: true, jobs: [] });
  });

  it('demolishes only the facade that stands on the block under way', () => {
    const a = block('a', 540, 600);
    const removed = blocksEvent([{ kind: 'removed', block: a, previous: a }]);
    expect(planJobs(removed, DAY, null, at(590, 572.5))).toEqual({ finish: true, jobs: [{ kind: 'demolish', block: { ...a, end: 572.5 } }] });
    // Before the facade, nothing stands that a wrecking ball could take, so its plan fades.
    expect(planJobs(removed, DAY, null, at(560, 540)).jobs).toEqual([{ kind: 'vanish', block: a }]);
  });

  it('resizes a done block with the crew and a plan plainly', () => {
    const a = block('a', 540, 600);
    const next = { ...a, end: 630 };
    const event = blocksEvent([{ kind: 'resized', block: next, previous: a }]);
    expect(planJobs(event, DAY, null, EVENING).jobs).toEqual([{ kind: 'resize', move: { from: a, to: next } }]);
    expect(planJobs(event, DAY, null, DAWN).jobs).toEqual([{ kind: 'resize', move: { from: a, to: next }, calm: true }]);
  });

  it('shows a block whose times carry it across the clock as it now stands', () => {
    const a = block('a', 540, 600);
    // A plan stretched back over the time, or the block under way cut short behind it.
    const reached = { ...a, start: 510 };
    expect(planJobs(blocksEvent([{ kind: 'resized', block: reached, previous: a }]), DAY, null, at(520)).jobs).toEqual([]);
    const cut = { ...a, end: 555 };
    expect(planJobs(blocksEvent([{ kind: 'resized', block: cut, previous: a }]), DAY, null, at(560))).toEqual({ finish: true, jobs: [] });
    // A plan moved into the finished part of the day appears done.
    const early = { ...a, start: 420, end: 480 };
    expect(planJobs(blocksEvent([moved(a, 420)]), DAY, null, at(500)).jobs).toEqual([{ kind: 'appear', block: early }]);
    // A done block moved into the plan, or a block under way kept under way, shows at once.
    expect(planJobs(blocksEvent([moved(a, 660)]), DAY, null, at(620)).jobs).toEqual([]);
    const longer = { ...a, end: 630 };
    expect(planJobs(blocksEvent([{ kind: 'resized', block: longer, previous: a }]), DAY, null, at(570))).toEqual({ finish: true, jobs: [] });
  });

  it('slides an adjacent move and relocates a longer one, among done blocks', () => {
    const a = block('a', 540, 600);
    expect(planJobs(blocksEvent([moved(a, 555)]), DAY, null, EVENING).jobs[0]!.kind).toBe('settle');
    expect(planJobs(blocksEvent([moved(a, 600)]), DAY, null, EVENING).jobs[0]!.kind).toBe('settle');
    expect(planJobs(blocksEvent([moved(a, 720)]), DAY, null, EVENING).jobs[0]!.kind).toBe('relocate');
  });

  it('slides planned blocks plainly, however far they move, together in a swap', () => {
    const a = block('a', 540, 600);
    const b = block('b', 600, 660);
    expect(planJobs(blocksEvent([moved(a, 720)]), DAY, null, DAWN).jobs).toEqual([
      { kind: 'settle', moves: [{ from: a, to: { ...a, start: 720, end: 780 } }], calm: true },
    ]);
    const swap = planJobs(blocksEvent([moved(b, 540), moved(a, 600)]), DAY, 'a', DAWN);
    expect(swap.jobs).toHaveLength(1);
    expect(swap.jobs[0]!.kind === 'settle' && swap.jobs[0]!.moves.length).toBe(2);
  });

  it('relocates the block that jumps in a swap and settles its partner', () => {
    // Move later on a (9:00 to 10:00) past b (10:00 to 11:30).
    const a = block('a', 540, 600);
    const b = block('b', 600, 690);
    const plan = planJobs(blocksEvent([moved(b, 540), moved(a, 630)]), DAY, 'a', EVENING);
    expect(plan.jobs).toHaveLength(1);
    const job = plan.jobs[0]!;
    expect(job.kind).toBe('relocate');
    if (job.kind !== 'relocate') return;
    expect(job.move.to.id).toBe('a');
    expect(job.settles.map((m) => m.to.id)).toEqual(['b']);
  });

  it('relocates the selected block when two equal blocks trade places', () => {
    const a = block('a', 540, 600);
    const b = block('b', 600, 660);
    const plan = planJobs(blocksEvent([moved(b, 540), moved(a, 600)]), DAY, 'b', EVENING);
    const job = plan.jobs[0]!;
    expect(job.kind === 'relocate' && job.move.to.id).toBe('b');
  });

  it('shows a copied day and the sample day at once', () => {
    const late = block('late', 600, 660);
    const early = block('early', 420, 480);
    const added = [late, early].map((b) => ({ kind: 'added' as const, block: b }));
    expect(planJobs(blocksEvent(added, 'copy'), DAY, null, EVENING)).toEqual({ finish: true, jobs: [] });
    expect(planJobs(blocksEvent(added, 'sample'), DAY, null, at(630))).toEqual({ finish: true, jobs: [] });
  });

  it('finishes running jobs for bulk changes and for anything outside block edits', () => {
    const a = block('a', 540, 600);
    for (const origin of ['import', 'settings'] as const) {
      expect(planJobs(blocksEvent([{ kind: 'added', block: a }], origin), DAY, null, EVENING)).toEqual({ finish: true, jobs: [] });
    }
    expect(planJobs({ type: 'viewedDate', previous: DAY, current: '2026-10-06' }, DAY, null, EVENING).finish).toBe(true);
    expect(planJobs({ type: 'loaded' }, DAY, null, EVENING).finish).toBe(true);
  });

  it('leaves other days alone, and finishes a build when a color changes', () => {
    const a = block('a', 540, 600);
    expect(planJobs(blocksEvent([{ kind: 'added', block: a }], 'user', '2026-10-06'), DAY, null, EVENING)).toEqual({ finish: false, jobs: [] });
    const recolor = planJobs(blocksEvent([{ kind: 'recategorized', block: { ...a, categoryId: 'meet' }, previous: a }]), DAY, null, EVENING);
    expect(recolor).toEqual({ finish: true, jobs: [] });
    const renamed = planJobs(blocksEvent([{ kind: 'retitled', block: { ...a, title: 'New' }, previous: a }]), DAY, null, at(570));
    expect(renamed).toEqual({ finish: false, jobs: [] });
  });
});

import { describe, expect, it } from 'vitest';
import { isAdjacentMove, planJobs } from '../src/anim/plan';
import type { Block } from '../src/core/model';
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

describe('isAdjacentMove', () => {
  it('counts overlapping and touching ranges as adjacent', () => {
    expect(isAdjacentMove({ start: 540, end: 600 }, { start: 555, end: 615 })).toBe(true);
    expect(isAdjacentMove({ start: 540, end: 600 }, { start: 600, end: 660 })).toBe(true);
    expect(isAdjacentMove({ start: 540, end: 600 }, { start: 615, end: 675 })).toBe(false);
  });
});

describe('planJobs', () => {
  it('builds a block the user adds', () => {
    const a = block('a', 540, 600);
    const plan = planJobs(blocksEvent([{ kind: 'added', block: a }]), DAY, null);
    expect(plan).toEqual({ finish: false, jobs: [{ kind: 'build', block: a, fast: false }] });
  });

  it('rebuilds fast when one deleted block is undone, and shows a whole day at once', () => {
    const a = block('a', 540, 600);
    expect(planJobs(blocksEvent([{ kind: 'added', block: a }], 'undo'), DAY, null).jobs).toEqual([{ kind: 'build', block: a, fast: true }]);
    const day = [a, block('b', 600, 660)].map((b) => ({ kind: 'added' as const, block: b }));
    expect(planJobs(blocksEvent(day, 'undo'), DAY, null)).toEqual({ finish: true, jobs: [] });
  });

  it('demolishes one deleted block and clears a whole day at once', () => {
    const a = block('a', 540, 600);
    expect(planJobs(blocksEvent([{ kind: 'removed', block: a, previous: a }]), DAY, null).jobs).toEqual([{ kind: 'demolish', block: a }]);
    const b = block('b', 600, 660);
    const clear = [a, b].map((x) => ({ kind: 'removed' as const, block: x, previous: x }));
    expect(planJobs(blocksEvent(clear), DAY, null)).toEqual({ finish: true, jobs: [] });
  });

  it('resizes a block whose length changed', () => {
    const a = block('a', 540, 600);
    const next = { ...a, end: 630 };
    const plan = planJobs(blocksEvent([{ kind: 'resized', block: next, previous: a }]), DAY, null);
    expect(plan.jobs).toEqual([{ kind: 'resize', move: { from: a, to: next } }]);
  });

  it('slides an adjacent move and relocates a longer one', () => {
    const a = block('a', 540, 600);
    expect(planJobs(blocksEvent([moved(a, 555)]), DAY, null).jobs[0]!.kind).toBe('settle');
    expect(planJobs(blocksEvent([moved(a, 600)]), DAY, null).jobs[0]!.kind).toBe('settle');
    expect(planJobs(blocksEvent([moved(a, 720)]), DAY, null).jobs[0]!.kind).toBe('relocate');
  });

  it('relocates the block that jumps in a swap and settles its partner', () => {
    // Move later on a (9:00 to 10:00) past b (10:00 to 11:30).
    const a = block('a', 540, 600);
    const b = block('b', 600, 690);
    const plan = planJobs(blocksEvent([moved(b, 540), moved(a, 630)]), DAY, 'a');
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
    const plan = planJobs(blocksEvent([moved(b, 540), moved(a, 600)]), DAY, 'b');
    const job = plan.jobs[0]!;
    expect(job.kind === 'relocate' && job.move.to.id).toBe('b');
  });

  it('finishes running jobs for bulk changes and for anything outside block edits', () => {
    const a = block('a', 540, 600);
    for (const origin of ['sample', 'copy', 'import', 'settings'] as const) {
      expect(planJobs(blocksEvent([{ kind: 'added', block: a }], origin), DAY, null)).toEqual({ finish: true, jobs: [] });
    }
    expect(planJobs({ type: 'viewedDate', previous: DAY, current: '2026-10-06' }, DAY, null).finish).toBe(true);
    expect(planJobs({ type: 'loaded' }, DAY, null).finish).toBe(true);
  });

  it('leaves other days alone, and finishes a build when a color changes', () => {
    const a = block('a', 540, 600);
    expect(planJobs(blocksEvent([{ kind: 'added', block: a }], 'user', '2026-10-06'), DAY, null)).toEqual({ finish: false, jobs: [] });
    const recolor = planJobs(blocksEvent([{ kind: 'recategorized', block: { ...a, categoryId: 'meet' }, previous: a }]), DAY, null);
    expect(recolor).toEqual({ finish: true, jobs: [] });
    const renamed = planJobs(blocksEvent([{ kind: 'retitled', block: { ...a, title: 'New' }, previous: a }]), DAY, null);
    expect(renamed).toEqual({ finish: false, jobs: [] });
  });
});

import { describe, expect, it } from 'vitest';
import { linear } from '../src/anim/easing';
import { Timeline } from '../src/anim/Timeline';

function recorder() {
  const log: string[] = [];
  const values = new Map<string, number[]>();
  const step = (name: string, at: number, duration: number) => ({
    at,
    duration,
    ease: linear,
    update: (t: number) => {
      values.set(name, [...(values.get(name) ?? []), t]);
    },
    onStart: () => log.push(`${name}:start`),
    onComplete: () => log.push(`${name}:complete`),
  });
  return { log, values, step };
}

describe('Timeline', () => {
  it('computes its duration from the latest step end', () => {
    const tl = new Timeline();
    tl.add({ at: 0.5, duration: 1, update: () => {} });
    tl.add({ at: 0, duration: 0.25, update: () => {} });
    expect(tl.duration).toBe(1.5);
  });

  it('fires steps in time order as it plays', () => {
    const { log, step } = recorder();
    const tl = new Timeline();
    tl.add(step('b', 0.5, 0.5));
    tl.add(step('a', 0, 0.5));
    tl.add(step('c', 1, 0));
    tl.play(1);
    for (let i = 0; i < 20; i++) tl.tick(0.1);
    expect(log).toEqual(['a:start', 'a:complete', 'b:start', 'b:complete', 'c:start', 'c:complete']);
    expect(tl.done).toBe(true);
  });

  it('passes eased progress and ends every step on exactly 1', () => {
    const { values, step } = recorder();
    const tl = new Timeline();
    tl.add(step('a', 0, 1));
    tl.play(1);
    tl.tick(0.25);
    tl.tick(0.25);
    tl.tick(0.75);
    expect(values.get('a')).toEqual([0.25, 0.5, 1]);
  });

  it('chains a sequence end to end', () => {
    const { log, step } = recorder();
    const tl = new Timeline();
    tl.addSequence([step('a', 0, 0.3), step('b', 0, 0.2), step('c', 0, 0.5)], 1);
    expect(tl.duration).toBeCloseTo(2);
    tl.seek(1.4);
    expect(log).toEqual(['a:start', 'a:complete', 'b:start']);
  });

  it('scales playback by speed', () => {
    const tl = new Timeline();
    let last = 0;
    tl.add({ at: 0, duration: 2, ease: linear, update: (t) => (last = t) });
    tl.play(2);
    tl.tick(0.5);
    expect(last).toBeCloseTo(0.5);
    expect(tl.currentTime).toBeCloseTo(1);
  });

  it('seeks idempotently', () => {
    const { log, values, step } = recorder();
    const tl = new Timeline();
    tl.add(step('a', 0, 1));
    tl.add(step('b', 1, 1));
    tl.seek(1.5);
    const logAfterFirst = [...log];
    const updatesAfterFirst = (values.get('a')?.length ?? 0) + (values.get('b')?.length ?? 0);
    tl.seek(1.5);
    expect(log).toEqual(logAfterFirst);
    expect((values.get('a')?.length ?? 0) + (values.get('b')?.length ?? 0)).toBe(updatesAfterFirst);
    expect(values.get('b')?.at(-1)).toBeCloseTo(0.5);
  });

  it('never fires a callback twice when seeking back and forth', () => {
    const { log, step } = recorder();
    const tl = new Timeline();
    tl.add(step('a', 0, 1));
    tl.seek(2);
    tl.seek(0);
    tl.seek(2);
    expect(log).toEqual(['a:start', 'a:complete']);
  });

  it('fast-forwards to the end within the wall time asked for', () => {
    const tl = new Timeline();
    tl.add({ at: 0, duration: 6, update: () => {} });
    tl.play(1);
    tl.tick(1);
    tl.fastForwardTo(tl.duration, 0.4);
    let wall = 0;
    while (!tl.done && wall < 1) {
      tl.tick(1 / 60);
      wall += 1 / 60;
    }
    expect(tl.done).toBe(true);
    expect(wall).toBeGreaterThan(0.38);
    expect(wall).toBeLessThan(0.42);
  });

  it('fast-forwards without slowing down when already playing fast', () => {
    const tl = new Timeline();
    tl.add({ at: 0, duration: 1, update: () => {} });
    tl.play(3);
    tl.fastForwardTo(1, 0.4);
    const before = tl.currentTime;
    tl.tick(0.1);
    // At least as fast as plain linear progress over the 0.4 s.
    expect(tl.currentTime - before).toBeGreaterThanOrEqual(0.25 - 1e-9);
  });

  it('finish fires every completion exactly once', () => {
    const { log, step } = recorder();
    const tl = new Timeline();
    tl.add(step('a', 0, 1));
    tl.add(step('b', 0.5, 1));
    tl.add(step('c', 3, 0));
    tl.play(1);
    tl.tick(0.75);
    tl.finish();
    tl.finish();
    tl.tick(1);
    expect(log.filter((e) => e.endsWith(':complete'))).toEqual(['a:complete', 'b:complete', 'c:complete']);
    expect(log.filter((e) => e.endsWith(':start'))).toEqual(['a:start', 'b:start', 'c:start']);
    expect(tl.done).toBe(true);
  });

  it('runs zero length steps once, with update(1)', () => {
    const { values, log, step } = recorder();
    const tl = new Timeline();
    tl.add(step('z', 0.2, 0));
    tl.play(1);
    tl.tick(0.1);
    expect(log).toEqual([]);
    tl.tick(0.2);
    tl.tick(0.2);
    expect(values.get('z')).toEqual([1]);
    expect(log).toEqual(['z:start', 'z:complete']);
  });

  it('completes a step whose end rounds a hair past the timeline end', () => {
    // 3.95 + 0.35 rounds differently from the 4.3 the other step ends at.
    const tl = new Timeline();
    let last = 0;
    tl.add({ at: 0, duration: 4.3, update: () => {} });
    tl.add({ at: 3.95, duration: 0.35, update: (t) => (last = t) });
    tl.play(1);
    for (let i = 0; i < 400 && !tl.done; i++) tl.tick(1 / 60);
    expect(tl.done).toBe(true);
    expect(last).toBe(1);
  });
});


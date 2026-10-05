import { describe, expect, it } from 'vitest';
import { Director, MAX_QUEUE, type Job } from '../src/anim/Director';
import { Timeline } from '../src/anim/Timeline';

function makeJob(name: string, seconds: number, log: string[]): Job & { started: boolean } {
  const job = {
    label: name,
    started: false,
    start: () => {
      job.started = true;
      log.push(`${name}:start`);
      const tl = new Timeline();
      tl.add({ at: 0, duration: seconds, update: () => {}, onComplete: () => log.push(`${name}:done`) });
      return tl;
    },
    end: () => log.push(`${name}:end`),
  };
  return job;
}

function run(director: Director, seconds: number, dt = 1 / 60): number {
  let wall = 0;
  while (wall < seconds) {
    director.tick(dt);
    wall += dt;
  }
  return wall;
}

describe('Director', () => {
  it('plays a job and ends it once', () => {
    const log: string[] = [];
    const director = new Director(() => 1);
    director.enqueue(makeJob('a', 1, log));
    expect(director.isBusy).toBe(true);
    run(director, 1.1);
    expect(log).toEqual(['a:start', 'a:done', 'a:end']);
    expect(director.isBusy).toBe(false);
  });

  it('scales playback by the animation speed', () => {
    const log: string[] = [];
    let speed = 2;
    const director = new Director(() => speed);
    director.enqueue(makeJob('a', 1, log));
    run(director, 0.55);
    expect(log).toContain('a:end');
    speed = 0.5;
    director.enqueue(makeJob('b', 1, log));
    run(director, 1.5);
    expect(log).not.toContain('b:end');
    run(director, 0.6);
    expect(log).toContain('b:end');
  });

  it('plays a job with its own speed instead of the setting, as undo does', () => {
    const log: string[] = [];
    const director = new Director(() => 0.5);
    director.enqueue({ ...makeJob('undo', 3, log), speed: 3 });
    run(director, 0.95);
    expect(log).not.toContain('undo:end');
    run(director, 0.1);
    expect(log).toContain('undo:end');
  });

  it('plays a chain in turn without hurrying, but hurries it all when something else arrives', () => {
    const log: string[] = [];
    const director = new Director(() => 1);
    const chain = {};
    for (const name of ['a', 'b', 'c']) director.enqueue({ ...makeJob(name, 1, log), chain });
    run(director, 1.05);
    // The first played its full second before the second began.
    expect(log).toEqual(['a:start', 'a:done', 'a:end', 'b:start']);
    director.enqueue(makeJob('user', 1, log));
    run(director, 0.85);
    expect(log).toContain('c:end');
    expect(log).toContain('user:start');
  });

  it('does not count a long chain against the queue limit', () => {
    const log: string[] = [];
    const director = new Director(() => 1);
    const chain = {};
    for (let i = 0; i < MAX_QUEUE + 4; i++) director.enqueue({ ...makeJob(`j${i}`, 0.1, log), chain });
    run(director, 2.5);
    expect(log.filter((l) => l.endsWith(':done'))).toHaveLength(MAX_QUEUE + 4);
  });

  it('fast-forwards the running job when another arrives, then plays the next', () => {
    const log: string[] = [];
    const director = new Director(() => 1);
    director.enqueue(makeJob('a', 6, log));
    run(director, 1);
    director.enqueue(makeJob('b', 1, log));
    run(director, 0.45);
    expect(log).toEqual(['a:start', 'a:done', 'a:end', 'b:start']);
    expect(director.current?.label).toBe('b');
  });

  it('caps the queue by finishing the oldest waiting jobs', () => {
    const log: string[] = [];
    const director = new Director(() => 1);
    director.enqueue(makeJob('active', 5, log));
    director.tick(0.01);
    const jobs = Array.from({ length: MAX_QUEUE + 2 }, (_, i) => makeJob(`q${i}`, 1, log));
    for (const job of jobs) director.enqueue(job);
    expect(director.queued).toBe(MAX_QUEUE);
    expect(log.filter((e) => e.endsWith(':end'))).toEqual(['q0:end', 'q1:end']);
    expect(jobs[0]!.started).toBe(false);
  });

  it('finishes everything at once and reports idle', () => {
    const log: string[] = [];
    const director = new Director(() => 1);
    let idle = 0;
    director.onIdle(() => (idle += 1));
    director.enqueue(makeJob('a', 6, log));
    director.enqueue(makeJob('b', 6, log));
    director.tick(0.1);
    director.finishAll();
    expect(log).toEqual(['a:start', 'a:done', 'a:end', 'b:end']);
    expect(director.isBusy).toBe(false);
    expect(idle).toBe(1);
    director.finishAll();
    expect(idle).toBe(1);
  });

  it('tells listeners when jobs start and end', () => {
    const log: string[] = [];
    const director = new Director(() => 1);
    let changes = 0;
    director.onChange(() => (changes += 1));
    director.enqueue(makeJob('a', 0.5, log));
    run(director, 0.6);
    expect(changes).toBeGreaterThanOrEqual(3);
    expect(director.isBusy).toBe(false);
  });
});

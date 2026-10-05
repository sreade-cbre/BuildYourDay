import type { Timeline } from './Timeline';

// Plays jobs one at a time from a queue (spec sections 9.3 and 9.6). A job
// builds its timeline only when it becomes active, so it sees the scene as it
// is then, and always gets end() exactly once, whether it played out, was
// fast-forwarded, was finished early, or never started at all.

export interface Job {
  /** Shown in the status chip while the job plays, for example "Building Pay app review". */
  label: string;
  /** Builds the job's timeline when the job becomes active. */
  start(): Timeline;
  /** Runs once when the job ends, however it ended. Releases what the job held. */
  end(): void;
  /** Plays at this speed instead of the animation speed setting, for example 3 for an undo (spec 12.6). */
  speed?: number;
  /**
   * Jobs that share a chain, such as the rapid build of a copied day, play in
   * turn without hurrying each other (spec 12.8 and 20). Anything else that
   * arrives still hurries the whole chain.
   */
  chain?: object;
}

/** Wall seconds a running job gets to finish when another job arrives. */
export const FAST_FORWARD_SECONDS = 0.4;
/** Queued jobs beyond this many finish at once as new ones arrive. */
export const MAX_QUEUE = 8;

export class Director {
  private readonly queue: Job[] = [];
  private active: { job: Job; timeline: Timeline } | null = null;
  private readonly changeListeners = new Set<() => void>();
  private readonly idleListeners = new Set<() => void>();

  /** `speed` reads the animation speed setting each frame. */
  constructor(private readonly speed: () => number) {}

  get isBusy(): boolean {
    return this.active !== null || this.queue.length > 0;
  }

  /** The job playing now, if any. */
  get current(): Job | null {
    return this.active?.job ?? null;
  }

  /** The active timeline, for development tools that scrub through a job. */
  get timeline(): Timeline | null {
    return this.active?.timeline ?? null;
  }

  get queued(): number {
    return this.queue.length;
  }

  enqueue(job: Job): void {
    const active = this.active;
    if (active && !(job.chain && active.job.chain === job.chain)) {
      active.timeline.fastForwardTo(active.timeline.duration, FAST_FORWARD_SECONDS);
    }
    this.queue.push(job);
    // A chain is one action, so it does not count against the queue limit.
    if (!job.chain) while (this.queue.length > MAX_QUEUE) this.queue.shift()!.end();
    this.notify();
  }

  /** Advances by `dt` wall seconds. Returns true while there is work left. */
  tick(dt: number): boolean {
    if (!this.active) this.startNext();
    const active = this.active;
    if (!active) return false;
    active.timeline.play(this.speedOf(active.job));
    active.timeline.tick(dt);
    if (active.timeline.done) {
      this.endActive();
      this.startNext();
    }
    return this.isBusy;
  }

  /** Finishes the active job and every queued one at once (Skip, Escape, changing days). */
  finishAll(): void {
    const hadWork = this.isBusy;
    if (this.active) {
      this.active.timeline.finish();
      this.endActive(false);
    }
    while (this.queue.length > 0) this.queue.shift()!.end();
    if (hadWork) {
      this.notify();
      this.idle();
    }
  }

  /** The Skip control (spec 9.6). */
  skip(): void {
    this.finishAll();
  }

  /** Listens for jobs starting and ending, for example to show the status chip. */
  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  onIdle(listener: () => void): () => void {
    this.idleListeners.add(listener);
    return () => this.idleListeners.delete(listener);
  }

  private startNext(): void {
    const job = this.queue.shift();
    if (!job) return;
    const timeline = job.start();
    this.active = { job, timeline };
    timeline.play(this.speedOf(job));
    // Another job is already waiting, so this one gets the short version too,
    // unless all that waits is the rest of its own chain.
    const onlyChain = job.chain !== undefined && this.queue.every((next) => next.chain === job.chain);
    if (this.queue.length > 0 && !onlyChain) timeline.fastForwardTo(timeline.duration, FAST_FORWARD_SECONDS);
    this.notify();
  }

  private speedOf(job: Job): number {
    return job.speed ?? this.speed();
  }

  private endActive(announce = true): void {
    const active = this.active;
    if (!active) return;
    this.active = null;
    active.job.end();
    if (announce) {
      this.notify();
      if (!this.isBusy) this.idle();
    }
  }

  private notify(): void {
    for (const listener of [...this.changeListeners]) listener();
  }

  private idle(): void {
    for (const listener of [...this.idleListeners]) listener();
  }
}

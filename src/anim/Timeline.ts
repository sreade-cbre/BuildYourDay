import { easeInOutCubic, type Ease } from './easing';

// A small, fully controlled timeline (spec section 9.3). Steps run at fixed
// times; each step's update receives eased progress in [0, 1]. Callbacks fire
// at most once per step, whatever order seeks arrive in, so finish() and
// fast-forwarding can never fire a completion twice.

export type { Ease };

export interface Step {
  /** Start time in seconds, relative to the timeline start. */
  at: number;
  /** Seconds. Zero is allowed for instant steps. */
  duration: number;
  /** Default easeInOutCubic. */
  ease?: Ease;
  /** Called with eased t every frame while active, and once with 1 when complete. */
  update: (t: number) => void;
  onStart?: () => void;
  onComplete?: () => void;
}

/** Seconds of floating point slack when deciding a step has reached its end. */
const END_EPSILON = 1e-9;

interface StepState {
  step: Step;
  /** Last raw progress applied, or null before the step was reached. */
  last: number | null;
  started: boolean;
  completed: boolean;
}

interface FastForward {
  from: number;
  to: number;
  wallDuration: number;
  wallElapsed: number;
  startSpeed: number;
}

export class Timeline {
  private readonly states: StepState[] = [];
  private time = 0;
  private speed = 1;
  private playing = false;
  private fastForward: FastForward | null = null;
  private finished = false;

  add(step: Step): this {
    this.states.push({ step, last: null, started: false, completed: false });
    // Stable sort keeps insertion order for steps that share a start time.
    this.states.sort((a, b) => a.step.at - b.step.at);
    return this;
  }

  /** Chains steps end to end from `startAt`. */
  addSequence(steps: Array<Omit<Step, 'at'>>, startAt = 0): this {
    let at = startAt;
    for (const step of steps) {
      this.add({ ...step, at });
      at += step.duration;
    }
    return this;
  }

  /** Length in seconds: the latest step end. */
  get duration(): number {
    let end = 0;
    for (const { step } of this.states) end = Math.max(end, step.at + step.duration);
    return end;
  }

  get currentTime(): number {
    return this.time;
  }

  get done(): boolean {
    return this.finished || (this.time >= this.duration && this.states.every((s) => s.completed));
  }

  /** Starts or continues playback at a speed, in timeline seconds per wall second. */
  play(speed: number): void {
    this.speed = Math.max(0, speed);
    this.playing = true;
  }

  pause(): void {
    this.playing = false;
  }

  /** Advances by `dtSeconds` of wall time. */
  tick(dtSeconds: number): void {
    if (this.done || dtSeconds <= 0) return;
    const ff = this.fastForward;
    if (ff) {
      ff.wallElapsed += dtSeconds;
      const w = Math.min(1, ff.wallElapsed / ff.wallDuration);
      // Starts at the current playback speed and accelerates so it lands on
      // the target exactly when the wall time runs out.
      const distance = ff.to - ff.from;
      const linear = ff.startSpeed * ff.wallDuration;
      const progress = linear < distance && linear > 0 ? (linear * w + (distance - linear) * w * w) / distance : w;
      this.apply(ff.from + distance * progress);
      if (w >= 1) {
        this.fastForward = null;
        this.apply(ff.to);
      }
      return;
    }
    if (!this.playing) return;
    this.apply(this.time + dtSeconds * this.speed);
  }

  /** Jumps to a time and brings every step in line. Seeking twice to the same time changes nothing. */
  seek(seconds: number): void {
    this.fastForward = null;
    this.apply(seconds);
  }

  /**
   * Speeds up so playback reaches `seconds` after `overSeconds` of wall time
   * (spec 9.6: a new job finishes the current one in 0.4 s).
   */
  fastForwardTo(seconds: number, overSeconds: number): void {
    const to = Math.max(this.time, Math.min(seconds, this.duration));
    if (overSeconds <= 0 || to <= this.time) {
      this.seek(to);
      return;
    }
    this.fastForward = {
      from: this.time,
      to,
      wallDuration: overSeconds,
      wallElapsed: 0,
      startSpeed: this.playing ? this.speed : 0,
    };
  }

  get fastForwarding(): boolean {
    return this.fastForward !== null;
  }

  /** Seeks to the end and fires every remaining completion. */
  finish(): void {
    this.fastForward = null;
    this.apply(this.duration);
    for (const state of this.states) this.complete(state);
    this.finished = true;
    this.playing = false;
  }

  private apply(time: number): void {
    this.time = Math.max(0, Math.min(time, this.duration));
    for (const state of this.states) {
      const { step } = state;
      if (this.time < step.at) {
        // Seeking back before a step puts its visuals back at the start.
        if (state.last !== null && state.last > 0) {
          state.last = 0;
          step.update((step.ease ?? easeInOutCubic)(0));
        }
        continue;
      }
      if (!state.started) {
        state.started = true;
        step.onStart?.();
      }
      // A step whose end rounds a hair past the timeline's end still completes.
      const ended = this.time >= step.at + step.duration - END_EPSILON;
      const raw = step.duration <= 0 || ended ? 1 : Math.min(1, (this.time - step.at) / step.duration);
      if (raw !== state.last) {
        state.last = raw;
        step.update(raw >= 1 ? 1 : (step.ease ?? easeInOutCubic)(raw));
      }
      if (raw >= 1) this.complete(state);
    }
  }

  private complete(state: StepState): void {
    if (state.completed) return;
    if (!state.started) {
      state.started = true;
      state.step.onStart?.();
    }
    if (state.last !== 1) {
      state.last = 1;
      state.step.update(1);
    }
    state.completed = true;
    state.step.onComplete?.();
  }
}

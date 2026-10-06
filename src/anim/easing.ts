// Easing functions (spec section 9.3). Each maps t in [0, 1] to progress.

export type Ease = (t: number) => number;

export const linear: Ease = (t) => t;

export const easeOutCubic: Ease = (t) => 1 - (1 - t) ** 3;

export const easeInOutCubic: Ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Gentle in and out, for long smooth moves like the crane's. */
export const easeInOutSine: Ease = (t) => (1 - Math.cos(Math.PI * t)) / 2;

/**
 * Speeds up over the first `ramp` of the way, holds a steady speed, and
 * slows over the last `ramp`, so a vehicle drives without lurching.
 */
export function cruise(ramp = 0.2): Ease {
  const speed = 1 / (1 - ramp);
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    if (t < ramp) return (speed * t * t) / (2 * ramp);
    if (t <= 1 - ramp) return speed * (ramp / 2 + t - ramp);
    return 1 - (speed * (1 - t) * (1 - t)) / (2 * ramp);
  };
}

/** Overshoots by the spec's 1.4 before settling. */
export const easeOutBack: Ease = (t) => {
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};

export const easeOutBounce: Ease = (t) => {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
};

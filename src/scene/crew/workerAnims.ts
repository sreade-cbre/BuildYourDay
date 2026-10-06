import { easeInOutCubic, easeOutCubic } from '../../anim/easing';

// Worker animations (spec section 10.2) as pure functions of a cycle phase in
// [0, 1). Angles are radians about each pivot's x axis; negative swings a
// limb forward, positive back. A pose is flat numbers so two poses blend by
// interpolating field by field.

export type WorkerAnim = 'idle' | 'walk' | 'hammer' | 'screed' | 'survey' | 'carry' | 'ride' | 'signal';

export interface Pose {
  bob: number;
  lean: number;
  neck: number;
  hipL: number;
  hipR: number;
  kneeL: number;
  kneeR: number;
  shoulderL: number;
  shoulderR: number;
  /** Raises an arm out to the side, for the survey wave. */
  shoulderOutL: number;
  elbowL: number;
  elbowR: number;
  /** Sideways shuffle of the feet while screeding. */
  shuffle: number;
}

/** Seconds per cycle for each animation. */
export const CYCLE: Record<WorkerAnim, number> = {
  idle: 2.0,
  walk: 0.5,
  hammer: 0.6,
  screed: 1.2,
  survey: 3.0,
  carry: 0.5,
  // A still pose; the cycle only paces the blend.
  ride: 1.0,
  signal: 1.2,
};

const deg = (d: number) => (d * Math.PI) / 180;
const TAU = Math.PI * 2;

const REST: Pose = {
  bob: 0,
  lean: 0,
  neck: 0,
  hipL: 0,
  hipR: 0,
  kneeL: 0,
  kneeR: 0,
  shoulderL: 0,
  shoulderR: 0,
  shoulderOutL: 0,
  elbowL: deg(-8),
  elbowR: deg(-8),
  shuffle: 0,
};

/** Slight torso bob, arms hang with a small sway. */
function idle(p: number): Pose {
  const s = Math.sin(TAU * p);
  return { ...REST, bob: 0.005 * s, shoulderL: deg(3) * s, shoulderR: -deg(3) * s };
}

/** Hips swing out of phase, knees bend on the back swing, arms counter-swing. */
function walk(p: number): Pose {
  const s = Math.sin(TAU * p);
  return {
    ...REST,
    bob: 0.01 * Math.cos(2 * TAU * p),
    hipL: deg(30) * s,
    hipR: -deg(30) * s,
    kneeL: deg(45) * Math.max(0, s),
    kneeR: deg(45) * Math.max(0, -s),
    shoulderL: -deg(20) * s,
    shoulderR: deg(20) * s,
    elbowL: deg(-18),
    elbowR: deg(-18),
  };
}

/**
 * The right arm rises to -80 degrees, then snaps down to +20 with
 * easeOutCubic in the last quarter of the cycle; the left arm holds at +10.
 */
function hammer(p: number): Pose {
  const raise = p < 0.75 ? easeInOutCubic(p / 0.75) : 1 - easeOutCubic((p - 0.75) / 0.25);
  return {
    ...REST,
    lean: deg(6),
    shoulderR: deg(20) + (deg(-80) - deg(20)) * raise,
    elbowR: deg(-60) + deg(-40) * raise,
    shoulderL: deg(10),
    elbowL: deg(-30),
  };
}

/** Both arms forward holding the board, torso tilted, feet shuffling sideways. */
function screed(p: number): Pose {
  const s = Math.sin(TAU * p);
  return {
    ...REST,
    lean: deg(12),
    shoulderL: deg(-70),
    shoulderR: deg(-70),
    elbowL: deg(-10),
    elbowR: deg(-10),
    hipL: deg(8) * s,
    hipR: -deg(8) * s,
    kneeL: deg(10),
    kneeR: deg(10),
    shuffle: 0.02 * s,
  };
}

/** Bends to look through the instrument, straightens, waves once per cycle. */
function survey(p: number): Pose {
  const look = p < 0.4 ? Math.sin((p / 0.4) * Math.PI) : 0;
  const waveWindow = p >= 0.55 && p < 0.9 ? (p - 0.55) / 0.35 : -1;
  const wave = waveWindow >= 0 ? Math.sin(waveWindow * Math.PI) : 0;
  return {
    ...REST,
    lean: deg(20) * look,
    neck: deg(10) * look,
    shoulderR: deg(-55) * look,
    elbowR: deg(-70) * look,
    shoulderL: deg(-20) * wave,
    shoulderOutL: deg(150) * wave,
    elbowL: deg(-8) - deg(35) * wave * Math.sin(waveWindow * Math.PI * 6),
  };
}

/** The walk cycle with both arms forward at -60 degrees, holding a plank. */
function carry(p: number): Pose {
  return { ...walk(p), shoulderL: deg(-60), shoulderR: deg(-60), elbowL: deg(-25), elbowR: deg(-25) };
}

/** Standing still on the hoist platform, one hand on the rail. */
function ride(): Pose {
  return { ...REST, shoulderL: deg(-25), shoulderOutL: deg(35), elbowL: deg(-35), elbowR: deg(-12) };
}

/**
 * The banksman guiding the crane: right arm up with the hand circling to
 * signal the hoist, left arm out toward the load, head tipped up to the hook.
 */
function signal(p: number): Pose {
  const s = Math.sin(TAU * p);
  const c = Math.cos(TAU * p);
  return {
    ...REST,
    neck: deg(-14),
    shoulderR: deg(-160) + deg(8) * s,
    elbowR: deg(-30) + deg(22) * c,
    shoulderL: deg(-20),
    shoulderOutL: deg(75) + deg(8) * s,
    elbowL: deg(-10),
  };
}

const POSES: Record<WorkerAnim, (p: number) => Pose> = { idle, walk, hammer, screed, survey, carry, ride, signal };

/** The pose for an animation at a phase; any phase wraps into [0, 1). */
export function poseFor(anim: WorkerAnim, phase: number): Pose {
  const p = ((phase % 1) + 1) % 1;
  return POSES[anim](p);
}

export function blendPoses(a: Pose, b: Pose, t: number): Pose {
  const out = { ...a };
  for (const key of Object.keys(a) as Array<keyof Pose>) out[key] = a[key] + (b[key] - a[key]) * t;
  return out;
}

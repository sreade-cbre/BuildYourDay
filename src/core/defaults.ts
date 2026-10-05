import type { Category, CategoryId, Settings } from './model';

/** Default categories (spec section 5.4 and appendix B). */
export const DEFAULT_CATEGORIES: readonly Category[] = [
  { id: 'deep', name: 'Deep work', color: 'navy' },
  { id: 'meet', name: 'Meetings', color: 'blue' },
  { id: 'admin', name: 'Admin', color: 'slate' },
];

/** A fresh copy of the default settings (appendix B). */
export function defaultSettings(): Settings {
  return {
    dayStart: 420,
    dayEnd: 1080,
    slotMinutes: 15,
    timeFormat: '12h',
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    animationSpeed: 1,
    reducedMotion: 'system',
    idleOrbit: true,
    labelMode: 'always',
    weatherPastBlocks: true,
    theme: 'light',
    paletteMode: 'strict',
  };
}

/** Limits enforced by the store. */
export const LIMITS = {
  maxBlocksPerDay: 48,
  minCategories: 1,
  maxCategories: 9,
  categoryNameMax: 24,
  titleMax: 60,
  minWindowMinutes: 240,
  maxWindowMinutes: 1080,
  windowStepMinutes: 30,
  minAnimationSpeed: 0.5,
  maxAnimationSpeed: 3,
} as const;

export interface SampleBlock {
  start: number;
  end: number;
  title: string;
  categoryId: CategoryId;
}

/** Development seed data (spec section 20). */
export const SAMPLE_DAY: readonly SampleBlock[] = [
  { start: 450, end: 540, title: 'Pay app review', categoryId: 'deep' },
  { start: 540, end: 570, title: 'Email and admin', categoryId: 'admin' },
  { start: 600, end: 660, title: 'Project standup', categoryId: 'meet' },
  { start: 660, end: 750, title: 'Cost reconciliation', categoryId: 'deep' },
  { start: 750, end: 810, title: 'Lunch', categoryId: 'admin' },
  { start: 900, end: 960, title: 'Client call', categoryId: 'meet' },
  { start: 960, end: 1020, title: 'Skill bank docs', categoryId: 'deep' },
];

/**
 * The sample day mapped onto the current categories. If the user has removed
 * or renamed a default category, its blocks fall back to the first category.
 */
export function sampleBlocks(categories: readonly Category[]): SampleBlock[] {
  const fallback = categories[0]?.id ?? DEFAULT_CATEGORIES[0]!.id;
  const known = new Set(categories.map((c) => c.id));
  return SAMPLE_DAY.map((b) => ({
    ...b,
    categoryId: known.has(b.categoryId) ? b.categoryId : fallback,
  }));
}

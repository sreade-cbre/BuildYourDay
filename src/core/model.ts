// Data model (spec section 6). All times are integer minutes from local
// midnight. Dates are ISO YYYY-MM-DD strings in local time.

export type CategoryId = string;
export type BlockId = string;
export type IsoDate = string; // "2026-10-05"

export type SwatchToken =
  | 'navy' | 'navyLight' | 'navyDark'
  | 'blue' | 'blueLight' | 'blueDark'
  | 'slate' | 'slateLight' | 'slateDark';

/** The nine colors a category may use, in picker order. */
export const SWATCH_TOKENS: readonly SwatchToken[] = [
  'navy', 'navyLight', 'navyDark',
  'blue', 'blueLight', 'blueDark',
  'slate', 'slateLight', 'slateDark',
];

export interface Category {
  id: CategoryId;
  name: string;            // 1 to 24 chars
  color: SwatchToken;      // one of the nine allowed tokens
}

export interface Block {
  id: BlockId;
  title: string;           // 0 to 60 chars, empty allowed, shown as "Untitled"
  start: number;           // minutes from midnight, multiple of slot
  end: number;             // minutes from midnight, > start, multiple of slot
  categoryId: CategoryId;
  createdAt: number;       // epoch ms
}

export type SlotMinutes = 5 | 10 | 15 | 30;
export const SLOT_SIZES: readonly SlotMinutes[] = [5, 10, 15, 30];

export type TimeFormat = '12h' | '24h';
export type ReducedMotionSetting = 'system' | 'on' | 'off';
export type LabelMode = 'always' | 'hover';
export type Theme = 'light' | 'dark';
export type PaletteMode = 'strict' | 'accents';

export interface Settings {
  dayStart: number;        // minutes from midnight, default 420 (07:00)
  dayEnd: number;          // minutes from midnight, default 1080 (18:00)
  slotMinutes: SlotMinutes;          // default 15
  timeFormat: TimeFormat;            // default '12h'
  categories: Category[];            // default three, min 1, max 9
  animationSpeed: number;            // 0.5 to 3, default 1
  reducedMotion: ReducedMotionSetting; // default 'system'
  idleOrbit: boolean;                // default true
  labelMode: LabelMode;              // default 'always'
  weatherPastBlocks: boolean;        // default true
  theme: Theme;                      // default 'light'
  paletteMode: PaletteMode;          // default 'strict'
}

export interface DayPlan {
  date: IsoDate;
  blocks: Block[];         // sorted by start, non-overlapping
}

export interface SaveFile {
  version: 1;
  settings: Settings;
  days: Record<IsoDate, DayPlan>;
  lastViewedDate: IsoDate;
}

/** A half-open span of minutes, [start, end). */
export interface TimeRange {
  start: number;
  end: number;
}

/** Outcome of a store operation. Errors are user-facing sentences. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail<T>(error: string): Result<T> {
  return { ok: false, error };
}

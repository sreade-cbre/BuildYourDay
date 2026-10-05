import { LIMITS, defaultSettings } from './defaults';
import { isInWindow } from './layout';
import {
  SLOT_SIZES,
  SWATCH_TOKENS,
  fail,
  ok,
  type Block,
  type BlockId,
  type Category,
  type CategoryId,
  type DayPlan,
  type IsoDate,
  type Result,
  type SaveFile,
  type Settings,
  type SwatchToken,
} from './model';
import { isIsoDate, isOnSlot } from './time';

// The single source of truth for plans and settings. Every write goes through
// a method here, every method enforces the invariants from spec section 6, and
// every committed change is announced to subscribers with a change type so the
// scene can pick the right animation.

export type BlockChangeKind = 'added' | 'removed' | 'resized' | 'moved' | 'retitled' | 'recategorized';

export interface BlockChange {
  kind: BlockChangeKind;
  /** The block after the change. For 'removed', the block as it was. */
  block: Block;
  /** The block before the change. Present for every kind except 'added'. */
  previous?: Block;
}

/** What caused a change. Lets the scene choose, for example, a fast undo build. */
export type ChangeOrigin = 'user' | 'undo' | 'sample' | 'copy' | 'import' | 'settings';

export type StoreEvent =
  | { type: 'blocks'; date: IsoDate; changes: BlockChange[]; origin: ChangeOrigin }
  | { type: 'settings'; previous: Settings; current: Settings }
  | { type: 'viewedDate'; previous: IsoDate; current: IsoDate }
  | { type: 'loaded' };

export type StoreListener = (event: StoreEvent) => void;

export interface BlockDraft {
  start: number;
  end: number;
  title?: string;
  categoryId: CategoryId;
}

export type BlockPatch = Partial<Pick<Block, 'start' | 'end' | 'title' | 'categoryId'>>;

export interface StoreOptions {
  /** The date the app opens on. */
  today: IsoDate;
  /** Saved state, already validated by migrate(). */
  save?: SaveFile;
  /** Clock for createdAt. */
  now?: () => number;
  /** Id factory. The prefix is 'b' for blocks and 'c' for categories. */
  createId?: (prefix: string) => string;
}

/** User-facing error messages. Each says what happened and what to do next. */
export const MESSAGES = {
  dayFull: `A day can hold up to ${LIMITS.maxBlocksPerDay} blocks.`,
  overlap: 'That time overlaps another block, so choose a free range.',
  outsideWindow: 'That time falls outside the day window, so choose a time inside it.',
  badTimes: 'The end time must come after the start time, so choose a later end.',
  offSlot: (slot: number) => `Times must fall on ${slot} minute steps, so choose times from the list.`,
  tooShort: (slot: number) => `A block must be at least ${slot} minutes long, so choose a later end time.`,
  unknownBlock: 'That block no longer exists, so select another one.',
  unknownCategory: 'That category no longer exists, so pick another one.',
  nothingToUndo: 'There is nothing to undo.',
  undoBlocked: 'That time is now taken, so the block could not be restored.',
  lastCategory: 'At least one category is required, so add another before removing this one.',
  categoryLimit: `You can have up to ${LIMITS.maxCategories} categories, so remove one before adding another.`,
  categoryName: `Category names need 1 to ${LIMITS.categoryNameMax} characters, so adjust the name.`,
  categoryDuplicate: 'Each category needs its own name, so rename the duplicate.',
  categoryColor: 'That color is not in the palette, so pick one of the swatches.',
  windowStep: 'Day start and end must fall on the half hour, so choose times from the list.',
  windowLength: 'The day must be 4 to 18 hours long, so adjust the start or end time.',
  animationSpeed: `Animation speed must be between ${LIMITS.minAnimationSpeed} and ${LIMITS.maxAnimationSpeed}, so move the slider back into range.`,
  invalidSetting: 'That setting is not valid, so choose one of the listed options.',
  invalidDate: 'That date is not valid, so pick another day.',
} as const;

function defaultIdFactory(): (prefix: string) => string {
  let counter = 0;
  return (prefix) => {
    counter = (counter + 1) % 1296;
    const time = Date.now().toString(36);
    const count = counter.toString(36).padStart(2, '0');
    const noise = Math.floor(Math.random() * 46656).toString(36).padStart(3, '0');
    return `${prefix}${time}${count}${noise}`;
  };
}

function normalizeTitle(title: string | undefined): string {
  return (title ?? '').trim().slice(0, LIMITS.titleMax);
}

function overlaps(a: Pick<Block, 'start' | 'end'>, b: Pick<Block, 'start' | 'end'>): boolean {
  return a.start < b.end && b.start < a.end;
}

function byStart(a: Block, b: Block): number {
  return a.start - b.start || a.end - b.end;
}

function cloneSettings(settings: Settings): Settings {
  return { ...settings, categories: settings.categories.map((c) => ({ ...c })) };
}

const ENUMS = {
  timeFormat: ['12h', '24h'],
  reducedMotion: ['system', 'on', 'off'],
  labelMode: ['always', 'hover'],
  theme: ['light', 'dark'],
  paletteMode: ['strict', 'accents'],
} as const;

/** Returns an error message when settings break a rule, otherwise null. */
export function validateSettings(settings: Settings): string | null {
  const { dayStart, dayEnd } = settings;
  const step = LIMITS.windowStepMinutes;
  if (
    !Number.isInteger(dayStart) || !Number.isInteger(dayEnd) ||
    dayStart % step !== 0 || dayEnd % step !== 0 ||
    dayStart < 0 || dayStart > 1380 || dayEnd < 60 || dayEnd > 1440
  ) {
    return MESSAGES.windowStep;
  }
  const length = dayEnd - dayStart;
  if (length < LIMITS.minWindowMinutes || length > LIMITS.maxWindowMinutes) return MESSAGES.windowLength;
  if (!SLOT_SIZES.includes(settings.slotMinutes)) return MESSAGES.invalidSetting;
  if (!(ENUMS.timeFormat as readonly string[]).includes(settings.timeFormat)) return MESSAGES.invalidSetting;
  if (!(ENUMS.reducedMotion as readonly string[]).includes(settings.reducedMotion)) return MESSAGES.invalidSetting;
  if (!(ENUMS.labelMode as readonly string[]).includes(settings.labelMode)) return MESSAGES.invalidSetting;
  if (!(ENUMS.theme as readonly string[]).includes(settings.theme)) return MESSAGES.invalidSetting;
  if (!(ENUMS.paletteMode as readonly string[]).includes(settings.paletteMode)) return MESSAGES.invalidSetting;
  if (typeof settings.idleOrbit !== 'boolean' || typeof settings.weatherPastBlocks !== 'boolean') {
    return MESSAGES.invalidSetting;
  }
  const speed = settings.animationSpeed;
  if (!Number.isFinite(speed) || speed < LIMITS.minAnimationSpeed || speed > LIMITS.maxAnimationSpeed) {
    return MESSAGES.animationSpeed;
  }
  return validateCategories(settings.categories);
}

function validateCategories(categories: readonly Category[]): string | null {
  if (categories.length < LIMITS.minCategories) return MESSAGES.lastCategory;
  if (categories.length > LIMITS.maxCategories) return MESSAGES.categoryLimit;
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const category of categories) {
    if (typeof category.id !== 'string' || category.id === '' || ids.has(category.id)) {
      return MESSAGES.invalidSetting;
    }
    ids.add(category.id);
    const name = category.name.trim();
    if (name.length < 1 || name.length > LIMITS.categoryNameMax) return MESSAGES.categoryName;
    const key = name.toLowerCase();
    if (names.has(key)) return MESSAGES.categoryDuplicate;
    names.add(key);
    if (!SWATCH_TOKENS.includes(category.color)) return MESSAGES.categoryColor;
  }
  return null;
}

export class Store {
  private settingsState: Settings = defaultSettings();
  private readonly days = new Map<IsoDate, Block[]>();
  private viewed: IsoDate;
  private lastDeleted: { date: IsoDate; block: Block } | null = null;
  private readonly listeners = new Set<StoreListener>();
  private readonly now: () => number;
  private readonly createId: (prefix: string) => string;

  constructor(options: StoreOptions) {
    if (!isIsoDate(options.today)) throw new Error(`Invalid start date: ${options.today}`);
    this.viewed = options.today;
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? defaultIdFactory();
    if (options.save) this.applySave(options.save);
  }

  // Reading

  get settings(): Readonly<Settings> {
    return this.settingsState;
  }

  get viewedDate(): IsoDate {
    return this.viewed;
  }

  /** Blocks for the viewed date, sorted by start. */
  get blocks(): readonly Block[] {
    return this.blocksFor(this.viewed);
  }

  blocksFor(date: IsoDate): readonly Block[] {
    return this.days.get(date) ?? [];
  }

  findBlock(date: IsoDate, id: BlockId): Block | undefined {
    return this.blocksFor(date).find((b) => b.id === id);
  }

  category(id: CategoryId): Category | undefined {
    return this.settingsState.categories.find((c) => c.id === id);
  }

  /** Dates that hold at least one block, oldest first. */
  plannedDates(): IsoDate[] {
    return [...this.days.keys()].sort();
  }

  /** How many blocks across all days use a category. */
  countBlocksInCategory(id: CategoryId): number {
    let count = 0;
    for (const blocks of this.days.values()) {
      for (const block of blocks) if (block.categoryId === id) count++;
    }
    return count;
  }

  get canUndo(): boolean {
    return this.lastDeleted !== null;
  }

  toSaveFile(): SaveFile {
    const days: Record<IsoDate, DayPlan> = {};
    for (const date of this.plannedDates()) {
      days[date] = { date, blocks: this.blocksFor(date).map((b) => ({ ...b })) };
    }
    return {
      version: 1,
      settings: cloneSettings(this.settingsState),
      days,
      lastViewedDate: this.viewed,
    };
  }

  // Events

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: StoreEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (error) {
        // Keep notifying the others, then surface the failure.
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  }

  // Blocks

  addBlock(date: IsoDate, draft: BlockDraft, origin: ChangeOrigin = 'user'): Result<Block> {
    const result = this.addBlocks(date, [draft], origin);
    return result.ok ? ok(result.value[0]!) : fail(result.error);
  }

  /**
   * Adds several blocks at once, all or nothing, as one change event. Used for
   * the sample day and for copying a day.
   */
  addBlocks(date: IsoDate, drafts: readonly BlockDraft[], origin: ChangeOrigin = 'user'): Result<Block[]> {
    if (!isIsoDate(date)) return fail(MESSAGES.invalidDate);
    const existing = this.blocksFor(date);
    if (existing.length + drafts.length > LIMITS.maxBlocksPerDay) return fail(MESSAGES.dayFull);
    const placed: Block[] = [...existing];
    const created: Block[] = [];
    for (const draft of drafts) {
      const error = this.checkNewBlock(draft, placed);
      if (error) return fail(error);
      const block: Block = {
        id: this.uniqueBlockId(placed),
        title: normalizeTitle(draft.title),
        start: draft.start,
        end: draft.end,
        categoryId: draft.categoryId,
        createdAt: this.now(),
      };
      placed.push(block);
      created.push(block);
    }
    if (created.length === 0) return ok([]);
    this.days.set(date, placed.sort(byStart));
    this.emit({
      type: 'blocks',
      date,
      origin,
      changes: created.map((block) => ({ kind: 'added', block })),
    });
    return ok(created);
  }

  private checkNewBlock(draft: BlockDraft, others: readonly Block[]): string | null {
    const { start, end } = draft;
    const { slotMinutes } = this.settingsState;
    if (!this.category(draft.categoryId)) return MESSAGES.unknownCategory;
    if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) return MESSAGES.badTimes;
    if (!isInWindow(draft, this.settingsState)) return MESSAGES.outsideWindow;
    if (!isOnSlot(start, slotMinutes) || !isOnSlot(end, slotMinutes)) return MESSAGES.offSlot(slotMinutes);
    if (end - start < slotMinutes) return MESSAGES.tooShort(slotMinutes);
    if (others.some((b) => overlaps(b, draft))) return MESSAGES.overlap;
    return null;
  }

  private uniqueBlockId(blocks: readonly Block[]): BlockId {
    let id = this.createId('b');
    while (blocks.some((b) => b.id === id)) id = this.createId('b');
    return id;
  }

  /**
   * Changes a block's times, title, or category. A time change keeps the
   * block's duration for a move, and only the edited edges must fall on the
   * current slot, so blocks made under a finer slot stay editable.
   */
  updateBlock(date: IsoDate, id: BlockId, patch: BlockPatch, origin: ChangeOrigin = 'user'): Result<Block> {
    const blocks = this.blocksFor(date);
    const previous = blocks.find((b) => b.id === id);
    if (!previous) return fail(MESSAGES.unknownBlock);

    const next: Block = {
      ...previous,
      start: patch.start ?? previous.start,
      end: patch.end ?? previous.end,
      title: patch.title !== undefined ? normalizeTitle(patch.title) : previous.title,
      categoryId: patch.categoryId ?? previous.categoryId,
    };

    const startChanged = next.start !== previous.start;
    const endChanged = next.end !== previous.end;
    if (startChanged || endChanged) {
      const error = this.checkTimeEdit(previous, next, blocks);
      if (error) return fail(error);
    }
    if (next.categoryId !== previous.categoryId && !this.category(next.categoryId)) {
      return fail(MESSAGES.unknownCategory);
    }

    const changes: BlockChange[] = [];
    if (startChanged || endChanged) {
      const sameLength = next.end - next.start === previous.end - previous.start;
      changes.push({ kind: sameLength ? 'moved' : 'resized', block: next, previous });
    }
    if (next.title !== previous.title) changes.push({ kind: 'retitled', block: next, previous });
    if (next.categoryId !== previous.categoryId) changes.push({ kind: 'recategorized', block: next, previous });
    if (changes.length === 0) return ok(previous);

    this.days.set(date, blocks.map((b) => (b.id === id ? next : b)).sort(byStart));
    this.emit({ type: 'blocks', date, origin, changes });
    return ok(next);
  }

  private checkTimeEdit(previous: Block, next: Block, blocks: readonly Block[]): string | null {
    const { slotMinutes } = this.settingsState;
    const { start, end } = next;
    if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) return MESSAGES.badTimes;
    if (!isInWindow(next, this.settingsState)) return MESSAGES.outsideWindow;
    const length = end - start;
    const previousLength = previous.end - previous.start;
    const isMove = start !== previous.start && length === previousLength;
    if (isMove) {
      if (!isOnSlot(start, slotMinutes)) return MESSAGES.offSlot(slotMinutes);
    } else {
      if (start !== previous.start && !isOnSlot(start, slotMinutes)) return MESSAGES.offSlot(slotMinutes);
      if (end !== previous.end && !isOnSlot(end, slotMinutes)) return MESSAGES.offSlot(slotMinutes);
      // Shrinking below one slot is refused. A block already shorter than a
      // slot, made under a finer slot size, may still grow.
      if (length < slotMinutes && length < previousLength) return MESSAGES.tooShort(slotMinutes);
    }
    if (blocks.some((b) => b.id !== previous.id && overlaps(b, next))) return MESSAGES.overlap;
    return null;
  }

  /** Removes a block and keeps a copy so undoDelete() can restore it. */
  deleteBlock(date: IsoDate, id: BlockId, origin: ChangeOrigin = 'user'): Result<Block> {
    const blocks = this.blocksFor(date);
    const block = blocks.find((b) => b.id === id);
    if (!block) return fail(MESSAGES.unknownBlock);
    this.setDay(date, blocks.filter((b) => b.id !== id));
    this.lastDeleted = { date, block: { ...block } };
    this.emit({ type: 'blocks', date, origin, changes: [{ kind: 'removed', block, previous: block }] });
    return ok(block);
  }

  /** Restores the most recently deleted block, identical to how it was. */
  undoDelete(): Result<{ date: IsoDate; block: Block }> {
    if (!this.lastDeleted) return fail(MESSAGES.nothingToUndo);
    const { date } = this.lastDeleted;
    let block = this.lastDeleted.block;
    const blocks = this.blocksFor(date);
    if (blocks.length >= LIMITS.maxBlocksPerDay) return fail(MESSAGES.dayFull);
    if (blocks.some((b) => overlaps(b, block))) return fail(MESSAGES.undoBlocked);
    if (!this.category(block.categoryId)) {
      // Its category was removed in the meantime; follow the same rule as a deletion.
      block = { ...block, categoryId: this.settingsState.categories[0]!.id };
    }
    this.days.set(date, [...blocks, block].sort(byStart));
    this.lastDeleted = null;
    this.emit({ type: 'blocks', date, origin: 'undo', changes: [{ kind: 'added', block }] });
    return ok({ date, block });
  }

  /** Removes every block on a date. Returns how many were removed. */
  clearDay(date: IsoDate, origin: ChangeOrigin = 'user'): Result<number> {
    const blocks = this.blocksFor(date);
    if (blocks.length === 0) return ok(0);
    this.days.delete(date);
    this.emit({
      type: 'blocks',
      date,
      origin,
      changes: blocks.map((block) => ({ kind: 'removed', block, previous: block })),
    });
    return ok(blocks.length);
  }

  private setDay(date: IsoDate, blocks: Block[]): void {
    if (blocks.length === 0) this.days.delete(date);
    else this.days.set(date, blocks);
  }

  // Navigation

  setViewedDate(date: IsoDate): Result<IsoDate> {
    if (!isIsoDate(date)) return fail(MESSAGES.invalidDate);
    if (date === this.viewed) return ok(date);
    const previous = this.viewed;
    this.viewed = date;
    this.emit({ type: 'viewedDate', previous, current: date });
    return ok(date);
  }

  // Settings

  /**
   * Applies a settings change after validating the result as a whole. Blocks
   * that reference a removed category move to the first remaining category.
   * Blocks that fall outside a new day window are kept as they are.
   */
  updateSettings(patch: Partial<Settings>): Result<Settings> {
    const previous = this.settingsState;
    const next: Settings = cloneSettings({
      ...previous,
      ...patch,
      categories: (patch.categories ?? previous.categories).map((c) => ({ ...c, name: c.name.trim() })),
    });
    const error = validateSettings(next);
    if (error) return fail(error);

    this.settingsState = next;
    const fallback = next.categories[0]!.id;
    const live = new Set(next.categories.map((c) => c.id));
    const reassigned = new Map<IsoDate, BlockChange[]>();
    for (const [date, blocks] of this.days) {
      const changes: BlockChange[] = [];
      const updated = blocks.map((block) => {
        if (live.has(block.categoryId)) return block;
        const moved = { ...block, categoryId: fallback };
        changes.push({ kind: 'recategorized', block: moved, previous: block });
        return moved;
      });
      if (changes.length > 0) {
        this.days.set(date, updated);
        reassigned.set(date, changes);
      }
    }

    this.emit({ type: 'settings', previous, current: next });
    for (const [date, changes] of reassigned) {
      this.emit({ type: 'blocks', date, origin: 'settings', changes });
    }
    return ok(next);
  }

  addCategory(name: string, color: SwatchToken): Result<Category> {
    const categories = this.settingsState.categories;
    if (categories.length >= LIMITS.maxCategories) return fail(MESSAGES.categoryLimit);
    let id = this.createId('c');
    while (categories.some((c) => c.id === id)) id = this.createId('c');
    const category: Category = { id, name: name.trim(), color };
    const result = this.updateSettings({ categories: [...categories, category] });
    return result.ok ? ok(category) : fail(result.error);
  }

  updateCategory(id: CategoryId, patch: Partial<Pick<Category, 'name' | 'color'>>): Result<Category> {
    const current = this.category(id);
    if (!current) return fail(MESSAGES.unknownCategory);
    const updated: Category = { ...current, ...patch, id };
    const result = this.updateSettings({
      categories: this.settingsState.categories.map((c) => (c.id === id ? updated : c)),
    });
    return result.ok ? ok(this.category(id)!) : fail(result.error);
  }

  /**
   * Removes a category. Its blocks, on every day, move to the first remaining
   * category. Returns how many blocks moved. The last category cannot go.
   */
  deleteCategory(id: CategoryId): Result<number> {
    const categories = this.settingsState.categories;
    if (!this.category(id)) return fail(MESSAGES.unknownCategory);
    if (categories.length <= LIMITS.minCategories) return fail(MESSAGES.lastCategory);
    const count = this.countBlocksInCategory(id);
    const result = this.updateSettings({ categories: categories.filter((c) => c.id !== id) });
    return result.ok ? ok(count) : fail(result.error);
  }

  // Whole state

  /** Replaces all plans and settings, for example after an import. */
  load(save: SaveFile): void {
    this.applySave(save);
    this.lastDeleted = null;
    this.emit({ type: 'loaded' });
  }

  private applySave(save: SaveFile): void {
    this.settingsState = cloneSettings(save.settings);
    this.days.clear();
    for (const [date, plan] of Object.entries(save.days)) {
      if (plan.blocks.length > 0) this.days.set(date, plan.blocks.map((b) => ({ ...b })).sort(byStart));
    }
  }
}

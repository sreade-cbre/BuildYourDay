import { LIMITS } from '../core/defaults';
import { SLOT_SIZES, SWATCH_TOKENS, type Category, type Settings, type SwatchToken } from '../core/model';
import type { Store } from '../core/store';
import { formatTime } from '../core/time';
import { Dialog } from './Dialog';
import { button, h } from './dom';
import { setDisabled } from './Overlay';

// The settings modal (spec sections 13.6 and 14). Every change previews live
// through the store's preview layer; Save commits the draft and Cancel (or
// Escape, or a click outside) drops it. Nothing is saved until Save.

export interface SettingsActions {
  exportJson(): void;
  /** Starts an import. The modal closes first. */
  importJson(): void;
  clearDay(): void;
  clearAll(): void;
  saved(): void;
  /** Builds a temporary block at the draft speed (spec 14). Absent without the 3D view. */
  previewSpeed?: () => void;
}

const SWATCH_NAMES: Record<SwatchToken, string> = {
  navy: 'Navy', navyLight: 'Navy light', navyDark: 'Navy dark',
  blue: 'Blue', blueLight: 'Blue light', blueDark: 'Blue dark',
  slate: 'Slate', slateLight: 'Slate light', slateDark: 'Slate dark',
};

export const ACCENTS_NOTE = 'Adds hi-vis orange outside the brand palette.';

type Choice<T> = { value: T; label: string };

export class SettingsModal {
  private readonly dialog: Dialog;
  private draft: Settings;
  private readonly error: HTMLElement;
  private readonly categoryList: HTMLElement;
  private readonly addCategoryButton: HTMLButtonElement;
  private readonly dayStart: HTMLSelectElement;
  private readonly dayEnd: HTMLSelectElement;
  private readonly speedValue: HTMLOutputElement;
  private readonly previewButton: HTMLButtonElement;
  /** A category waiting for its removal to be confirmed. */
  private confirmingRemoval: string | null = null;

  constructor(
    host: HTMLElement,
    private readonly store: Store,
    private readonly actions: SettingsActions,
  ) {
    this.draft = structuredClone(store.savedSettings) as Settings;
    this.dialog = new Dialog(host, {
      title: 'Settings',
      className: 'dialog--settings',
      onDismiss: () => this.cancel(),
    });
    this.error = h('p', { class: 'form-error', attrs: { role: 'alert' } });
    this.error.hidden = true;

    // Day
    this.dayStart = h('select', { class: 'select', attrs: { 'aria-label': 'Day start' } });
    this.dayEnd = h('select', { class: 'select', attrs: { 'aria-label': 'Day end' } });
    this.dayStart.addEventListener('change', () => this.change({ dayStart: Number(this.dayStart.value) }));
    this.dayEnd.addEventListener('change', () => this.change({ dayEnd: Number(this.dayEnd.value) }));
    this.fillWindowSelects();
    const day = this.section(
      'Day',
      this.row('Day start', this.dayStart),
      this.row('Day end', this.dayEnd),
      this.radios('Slot', 'slotMinutes', SLOT_SIZES.map((v) => ({ value: v, label: `${v} min` }))),
      this.radios('Time format', 'timeFormat', [
        { value: '12h', label: '12h' },
        { value: '24h', label: '24h' },
      ]),
    );

    // Categories
    this.categoryList = h('ul', { class: 'category-list' });
    this.addCategoryButton = button('Add category', 'button', () => this.addCategory());
    const categories = this.section('Categories', this.categoryList, this.addCategoryButton);
    this.renderCategories();

    // Motion
    this.speedValue = h('output', { class: 'range-value' });
    const speed = h('input', {
      class: 'range',
      attrs: {
        type: 'range',
        min: LIMITS.minAnimationSpeed,
        max: LIMITS.maxAnimationSpeed,
        step: 0.25,
        value: this.draft.animationSpeed,
        'aria-label': 'Animation speed',
      },
    });
    speed.addEventListener('input', () => this.change({ animationSpeed: Number(speed.value) }));
    const preview = button('Preview', 'button', () => {
      if (preview.getAttribute('aria-disabled') !== 'true') this.actions.previewSpeed?.();
    });
    this.previewButton = preview;
    this.renderSpeed();
    const motion = this.section(
      'Motion',
      this.row('Animation speed', h('div', { class: 'range-row' }, speed, this.speedValue, preview)),
      this.radios('Reduced motion', 'reducedMotion', [
        { value: 'system', label: 'System' },
        { value: 'on', label: 'On' },
        { value: 'off', label: 'Off' },
      ]),
      this.toggle('Idle orbit', 'idleOrbit'),
    );

    // Display
    const display = this.section(
      'Display',
      this.radios('Labels', 'labelMode', [
        { value: 'always', label: 'Always' },
        { value: 'hover', label: 'On hover' },
      ]),
      this.toggle('Weather past blocks', 'weatherPastBlocks'),
      this.radios('Theme', 'theme', [
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
      ]),
      this.radios(
        'Palette mode',
        'paletteMode',
        [
          { value: 'strict', label: 'Strict' },
          { value: 'accents', label: 'Accents' },
        ],
        h('p', { class: 'field-note', text: ACCENTS_NOTE }),
      ),
    );

    // Data
    const data = this.section(
      'Data',
      h(
        'div',
        { class: 'button-row' },
        button('Export JSON', 'button', () => actions.exportJson()),
        button('Import JSON', 'button', () => {
          this.cancel();
          actions.importJson();
        }),
        button('Clear this day', 'button', () => actions.clearDay()),
        button('Clear all data', 'button button--danger', () => this.askClearAll(data)),
      ),
    );

    this.dialog.body.append(day, categories, motion, display, data, this.error);
    this.dialog.footer.append(
      button('Cancel', 'button', () => this.cancel()),
      button('Save', 'button button--primary', () => this.save()),
    );
    this.dialog.focus();
  }

  // Building blocks

  private section(title: string, ...content: Node[]): HTMLElement {
    return h('section', { class: 'settings-section' }, h('h3', { class: 'settings-section__title', text: title }), ...content);
  }

  private row(label: string, control: HTMLElement): HTMLElement {
    return h('label', { class: 'settings-row' }, h('span', { class: 'settings-row__label', text: label }), control);
  }

  private radios<K extends 'slotMinutes' | 'timeFormat' | 'reducedMotion' | 'labelMode' | 'theme' | 'paletteMode'>(
    label: string,
    key: K,
    choices: Array<Choice<Settings[K]>>,
    note?: HTMLElement,
  ): HTMLElement {
    const name = `setting-${key}`;
    const group = h('div', { class: 'segmented', attrs: { role: 'radiogroup', 'aria-label': label } });
    for (const choice of choices) {
      const input = h('input', {
        attrs: { type: 'radio', name, value: String(choice.value), checked: this.draft[key] === choice.value },
      });
      input.addEventListener('change', () => {
        if (input.checked) this.change({ [key]: choice.value } as Partial<Settings>);
      });
      group.append(h('label', { class: 'segmented__option' }, input, h('span', { text: choice.label })));
    }
    return h(
      'div',
      { class: 'settings-row' },
      h('span', { class: 'settings-row__label', text: label }),
      h('div', { class: 'settings-row__control' }, group, note ?? null),
    );
  }

  private toggle(label: string, key: 'idleOrbit' | 'weatherPastBlocks'): HTMLElement {
    const input = h('input', { attrs: { type: 'checkbox', checked: this.draft[key] } });
    input.addEventListener('change', () => this.change({ [key]: input.checked } as Partial<Settings>));
    return h('label', { class: 'settings-row' }, h('span', { class: 'settings-row__label', text: label }), h('span', { class: 'switch' }, input));
  }

  private fillWindowSelects(): void {
    const format = { timeFormat: this.draft.timeFormat };
    const startTimes: number[] = [];
    for (let t = 0; t <= 1380; t += LIMITS.windowStepMinutes) startTimes.push(t);
    const endTimes: number[] = [];
    for (let t = 60; t <= 1440; t += LIMITS.windowStepMinutes) endTimes.push(t);
    this.dayStart.replaceChildren(...startTimes.map((t) => h('option', { text: formatTime(t, format), attrs: { value: t } })));
    this.dayEnd.replaceChildren(...endTimes.map((t) => h('option', { text: formatTime(t, format), attrs: { value: t } })));
    this.dayStart.value = String(this.draft.dayStart);
    this.dayEnd.value = String(this.draft.dayEnd);
  }

  /** Steps aside while the scene plays the speed preview, and comes back after. */
  setAside(aside: boolean): void {
    this.dialog.setAside(aside);
  }

  private renderSpeed(): void {
    const calm =
      this.draft.reducedMotion === 'on' ||
      (this.draft.reducedMotion === 'system' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    setDisabled(
      this.previewButton,
      !this.actions.previewSpeed
        ? 'The preview needs the 3D view, which this browser cannot show.'
        : calm
          ? 'Reduced motion is on, so blocks fade in instead of being built.'
          : null,
    );
    this.speedValue.value = `${this.draft.animationSpeed}x`;
  }

  // Categories

  private renderCategories(): void {
    const focused = document.activeElement as HTMLElement | null;
    const focusKey = focused?.dataset?.focusKey;
    const categories = this.draft.categories;
    this.categoryList.replaceChildren(...categories.map((category, index) => this.categoryRow(category, index)));
    setDisabled(
      this.addCategoryButton,
      categories.length >= LIMITS.maxCategories ? `You can have up to ${LIMITS.maxCategories} categories.` : null,
    );
    if (focusKey) this.categoryList.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus();
  }

  private categoryRow(category: Category, index: number): HTMLElement {
    const name = h('input', {
      class: 'input',
      attrs: {
        type: 'text',
        value: category.name,
        maxlength: LIMITS.categoryNameMax,
        'aria-label': `Category ${index + 1} name`,
        'data-focus-key': `name-${category.id}`,
      },
    });
    name.addEventListener('input', () => {
      this.change({ categories: this.draft.categories.map((c) => (c.id === category.id ? { ...c, name: name.value } : c)) }, false);
    });

    const swatches = h('div', { class: 'swatches swatches--small', attrs: { role: 'radiogroup', 'aria-label': `${category.name} color` } });
    for (const token of SWATCH_TOKENS) {
      const swatch = h('button', {
        class: `swatch swatch--${token}`,
        attrs: {
          type: 'button',
          role: 'radio',
          'aria-checked': String(category.color === token),
          'aria-label': SWATCH_NAMES[token],
          title: SWATCH_NAMES[token],
          'data-focus-key': `color-${category.id}-${token}`,
        },
      });
      swatch.addEventListener('click', () => {
        this.change({ categories: this.draft.categories.map((c) => (c.id === category.id ? { ...c, color: token } : c)) });
      });
      swatches.append(swatch);
    }

    const remove = button('Remove', 'button button--quiet', () => this.removeCategory(category.id));
    remove.dataset.focusKey = `remove-${category.id}`;
    setDisabled(remove, this.draft.categories.length <= LIMITS.minCategories ? 'At least one category is required.' : null);

    const row = h('li', { class: 'category-row' }, name, swatches, remove);
    if (this.confirmingRemoval === category.id) row.append(this.removalPrompt(category));
    return row;
  }

  private removalPrompt(category: Category): HTMLElement {
    const count = this.store.countBlocksInCategory(category.id);
    const target = this.draft.categories.find((c) => c.id !== category.id);
    const message = `${count} ${count === 1 ? 'block uses' : 'blocks use'} ${category.name}. Removing it moves ${count === 1 ? 'that block' : 'them'} to ${target?.name ?? 'the first category'}.`;
    const confirm = button('Remove category', 'button button--danger', () => {
      this.confirmingRemoval = null;
      this.applyRemoval(category.id);
    });
    const keep = button('Keep', 'button', () => {
      this.confirmingRemoval = null;
      this.renderCategories();
    });
    queueMicrotask(() => confirm.focus());
    return h('div', { class: 'category-row__confirm', attrs: { role: 'group', 'aria-label': 'Confirm removal' } }, h('p', { text: message }), confirm, keep);
  }

  private removeCategory(id: string): void {
    if (this.draft.categories.length <= LIMITS.minCategories) return;
    if (this.store.countBlocksInCategory(id) > 0) {
      this.confirmingRemoval = id;
      this.renderCategories();
      return;
    }
    this.applyRemoval(id);
  }

  private applyRemoval(id: string): void {
    this.change({ categories: this.draft.categories.filter((c) => c.id !== id) });
  }

  private addCategory(): void {
    const categories = this.draft.categories;
    if (categories.length >= LIMITS.maxCategories) return;
    const taken = new Set(categories.map((c) => c.name.toLowerCase()));
    let name = 'New category';
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `New category ${n}`;
    const used = new Set(categories.map((c) => c.color));
    const color = SWATCH_TOKENS.find((t) => !used.has(t)) ?? 'navy';
    const id = this.store.newCategoryId(categories);
    this.change({ categories: [...categories, { id, name, color }] });
    this.categoryList.querySelector<HTMLInputElement>(`[data-focus-key="name-${CSS.escape(id)}"]`)?.select();
  }

  // Draft

  /**
   * Updates the draft and previews it. An invalid draft stays on screen with
   * its error, and the scene keeps the last valid preview.
   */
  private change(patch: Partial<Settings>, rerenderCategories = true): void {
    const before = this.draft.timeFormat;
    this.draft = { ...this.draft, ...patch };
    const result = this.store.previewSettings(this.draft);
    this.error.textContent = result.ok ? '' : result.error;
    this.error.hidden = result.ok;
    if (patch.timeFormat && patch.timeFormat !== before) this.fillWindowSelects();
    if (patch.animationSpeed !== undefined || patch.reducedMotion !== undefined) this.renderSpeed();
    if (patch.categories && rerenderCategories) this.renderCategories();
  }

  private askClearAll(section: HTMLElement): void {
    if (section.querySelector('.confirm-clear')) return;
    const input = h('input', { class: 'input', attrs: { type: 'text', 'aria-label': 'Type clear to confirm', autocomplete: 'off' } });
    const go = button('Clear all data', 'button button--danger', () => {
      if (input.value.trim().toLowerCase() !== 'clear') return;
      this.store.previewSettings(null);
      this.dialog.close();
      this.actions.clearAll();
    });
    setDisabled(go, 'Type clear to confirm.');
    input.addEventListener('input', () => setDisabled(go, input.value.trim().toLowerCase() === 'clear' ? null : 'Type clear to confirm.'));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') go.click();
    });
    const box = h(
      'div',
      { class: 'confirm-clear' },
      h('p', { text: 'This erases every day and resets all settings. Type clear to confirm.' }),
      h('div', { class: 'button-row' }, input, go),
    );
    section.append(box);
    input.focus();
  }

  private cancel(): void {
    this.store.previewSettings(null);
    this.dialog.close();
  }

  private save(): void {
    const result = this.store.updateSettings(this.draft);
    if (!result.ok) {
      this.error.textContent = result.error;
      this.error.hidden = false;
      return;
    }
    this.dialog.close();
    this.actions.saved();
  }

  get isOpen(): boolean {
    return this.dialog.isOpen;
  }

  close(): void {
    this.cancel();
  }
}

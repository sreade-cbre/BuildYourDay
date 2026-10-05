import { isInWindow } from '../core/layout';
import type { BlockId, TimeRange } from '../core/model';
import type { BlockPatch, Store } from '../core/store';
import { formatDuration } from '../core/time';
import { button, h, iconButton } from './dom';
import { setDisabled } from './Overlay';
import type { BlockDraftState, InspectorState, UiState } from './state';
import { draftEndFor, editTimeOptions, fillTimeSelect, newTimeOptions } from './timeOptions';

// The right side panel (spec section 13.2) for creating and editing a block.
// Times are selects of slot-aligned times that already respect neighbors, so
// an edit can only stop at a neighbor, never push it (fixed times). Title and
// time edits commit on blur or Enter; time edits preview in the tower first.

export interface InspectorActions {
  /** Creates the drafted block. Returns an error to show, or null. */
  build(draft: BlockDraftState): string | null;
  updateDraft(draft: BlockDraftState): void;
  /** Shows uncommitted times in the tower, or clears them with null. */
  previewTimes(id: BlockId, range: TimeRange | null): void;
  /** Commits an edit. Returns an error to show, or null. */
  commit(id: BlockId, patch: BlockPatch): string | null;
  nudge(id: BlockId, direction: -1 | 1): string | null;
  demolish(id: BlockId): void;
  close(): void;
}

export const OUTSIDE_WINDOW_WARNING =
  'This block is outside the day window, so move it inside or widen the window in settings.';

export class Inspector {
  private readonly panel: HTMLElement;
  private readonly heading: HTMLHeadingElement;
  private readonly titleInput: HTMLInputElement;
  private readonly startSelect: HTMLSelectElement;
  private readonly endSelect: HTMLSelectElement;
  private readonly duration: HTMLElement;
  private readonly swatches: HTMLElement;
  private readonly moves: HTMLElement;
  private readonly earlierButton: HTMLButtonElement;
  private readonly laterButton: HTMLButtonElement;
  private readonly warning: HTMLElement;
  private readonly error: HTMLElement;
  private readonly footer: HTMLElement;
  private readonly demolishButton: HTMLButtonElement;
  private readonly cancelButton: HTMLButtonElement;
  private readonly buildButton: HTMLButtonElement;
  private shown: InspectorState = { mode: 'closed' };
  /** Uncommitted times picked in the selects, in edit mode. */
  private pending: TimeRange | null = null;
  /** Set when Escape should drop an edit instead of committing it on blur. */
  private discardOnBlur = false;

  constructor(
    host: HTMLElement,
    private readonly store: Store,
    private readonly ui: UiState,
    private readonly actions: InspectorActions,
  ) {
    this.heading = h('h2', { class: 'inspector__heading', attrs: { id: 'inspector-heading' } });
    this.titleInput = h('input', {
      class: 'inspector__title',
      attrs: { type: 'text', maxlength: 60, placeholder: 'Untitled', autocomplete: 'off', 'aria-label': 'Title' },
    });
    this.startSelect = h('select', { class: 'select', attrs: { 'aria-label': 'Start time' } });
    this.endSelect = h('select', { class: 'select', attrs: { 'aria-label': 'End time' } });
    this.duration = h('span', { class: 'inspector__duration', attrs: { 'aria-live': 'polite' } });
    this.swatches = h('div', { class: 'swatches', attrs: { role: 'group', 'aria-label': 'Category' } });
    this.earlierButton = button('Move earlier', 'button', () => this.nudge(-1));
    this.laterButton = button('Move later', 'button', () => this.nudge(1));
    this.moves = h('div', { class: 'inspector__moves' }, this.earlierButton, this.laterButton);
    this.warning = h('p', { class: 'inspector__warning', text: OUTSIDE_WINDOW_WARNING });
    this.error = h('p', { class: 'inspector__error', attrs: { role: 'alert' } });
    this.demolishButton = button('Demolish', 'button button--quiet', () => {
      if (this.shown.mode === 'edit') this.actions.demolish(this.shown.id);
    });
    this.cancelButton = button('Cancel', 'button', () => this.actions.close());
    this.buildButton = button('Build', 'button button--primary', () => this.build());
    this.footer = h('div', { class: 'inspector__footer' });

    this.panel = h(
      'aside',
      { class: 'inspector panel', attrs: { 'aria-labelledby': 'inspector-heading' } },
      h('div', { class: 'inspector__head' }, this.heading, iconButton('close', 'Close inspector', () => this.actions.close())),
      h('label', { class: 'field' }, h('span', { class: 'field__label', text: 'Title' }), this.titleInput),
      h(
        'div',
        { class: 'field' },
        h('span', { class: 'field__label', text: 'Time' }),
        h('div', { class: 'inspector__times' }, this.startSelect, h('span', { class: 'inspector__to', text: 'to' }), this.endSelect, this.duration),
      ),
      h('div', { class: 'field' }, h('span', { class: 'field__label', text: 'Category' }), this.swatches),
      this.moves,
      this.warning,
      this.error,
      this.footer,
    );
    this.panel.hidden = true;
    host.append(this.panel);

    this.wireTitle();
    this.wireTimes();
    store.subscribe(() => this.render());
    ui.subscribe(() => this.render());
  }

  get element(): HTMLElement {
    return this.panel;
  }

  // Wiring

  private wireTitle(): void {
    const input = this.titleInput;
    input.addEventListener('input', () => {
      const state = this.ui.state.inspector;
      if (state.mode === 'new') this.actions.updateDraft({ ...state.draft, title: input.value });
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (this.shown.mode === 'new') this.build();
        else this.commitTitle();
      } else if (event.key === 'Escape') {
        this.discardOnBlur = true;
      }
    });
    input.addEventListener('blur', () => {
      if (this.discardOnBlur) {
        this.discardOnBlur = false;
        return;
      }
      if (this.shown.mode === 'edit') this.commitTitle();
    });
  }

  private wireTimes(): void {
    for (const select of [this.startSelect, this.endSelect]) {
      select.addEventListener('change', () => this.onTimeChange(select));
      select.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          if (this.shown.mode === 'new') this.build();
          else this.commitTimes();
        } else if (event.key === 'Escape') {
          this.discardOnBlur = true;
          this.dropPending();
        }
      });
      select.addEventListener('blur', () => {
        if (this.discardOnBlur) {
          this.discardOnBlur = false;
          return;
        }
        // Moving between the two selects keeps the edit open. Focus has not
        // reached the next control during blur, so check once it settles.
        setTimeout(() => {
          if (document.activeElement !== this.startSelect && document.activeElement !== this.endSelect) this.commitTimes();
        }, 0);
      });
    }
  }

  private onTimeChange(select: HTMLSelectElement): void {
    const value = Number(select.value);
    const state = this.ui.state.inspector;
    if (state.mode === 'new') {
      const { draft } = state;
      if (select === this.startSelect) {
        const end = draftEndFor(this.store.blocks, draft, value, this.store.settings);
        this.actions.updateDraft({ ...draft, start: value, end });
      } else {
        this.actions.updateDraft({ ...draft, end: value });
      }
      return;
    }
    if (state.mode !== 'edit') return;
    const block = this.store.findBlock(this.store.viewedDate, state.id);
    if (!block) return;
    const current = this.pending ?? { start: block.start, end: block.end };
    this.pending = select === this.startSelect ? { start: value, end: current.end } : { start: current.start, end: value };
    this.actions.previewTimes(block.id, this.pending);
    this.render();
  }

  private commitTitle(): void {
    if (this.shown.mode !== 'edit') return;
    const block = this.store.findBlock(this.store.viewedDate, this.shown.id);
    if (!block || this.titleInput.value.trim() === block.title) return;
    this.showError(this.actions.commit(block.id, { title: this.titleInput.value }));
  }

  private commitTimes(): void {
    if (this.shown.mode !== 'edit' || !this.pending) return;
    const pending = this.pending;
    this.pending = null;
    this.actions.previewTimes(this.shown.id, null);
    this.showError(this.actions.commit(this.shown.id, { start: pending.start, end: pending.end }));
  }

  private dropPending(): void {
    if (this.shown.mode === 'edit' && this.pending) this.actions.previewTimes(this.shown.id, null);
    this.pending = null;
  }

  private nudge(direction: -1 | 1): void {
    if (this.shown.mode !== 'edit') return;
    const control = direction > 0 ? this.laterButton : this.earlierButton;
    if (control.getAttribute('aria-disabled') === 'true') return;
    this.showError(this.actions.nudge(this.shown.id, direction));
  }

  private build(): void {
    const state = this.ui.state.inspector;
    if (state.mode !== 'new') return;
    this.showError(this.actions.build({ ...state.draft, title: this.titleInput.value }));
  }

  private showError(message: string | null): void {
    this.error.textContent = message ?? '';
    this.error.hidden = !message;
  }

  // Rendering

  render(): void {
    const state = this.ui.state.inspector;
    const changedMode =
      state.mode !== this.shown.mode || (state.mode === 'edit' && this.shown.mode === 'edit' && state.id !== this.shown.id);
    if (changedMode) {
      if (this.shown.mode === 'edit' && this.pending) this.actions.previewTimes(this.shown.id, null);
      this.pending = null;
      this.showError(null);
    }
    const wasClosed = this.shown.mode === 'closed';
    this.shown = state;

    if (state.mode === 'closed') {
      this.panel.hidden = true;
      return;
    }
    this.panel.hidden = false;
    if (state.mode === 'new') this.renderNew(state.draft, changedMode);
    else this.renderEdit(state.id, changedMode);
    if (changedMode && state.mode === 'new') {
      this.titleInput.focus();
      this.titleInput.select();
    }
    if (wasClosed) this.panel.scrollTop = 0;
  }

  private renderNew(draft: BlockDraftState, fresh: boolean): void {
    const settings = this.store.settings;
    this.heading.textContent = 'New block';
    if (fresh || document.activeElement !== this.titleInput) this.titleInput.value = draft.title;
    const { starts, ends } = newTimeOptions(this.store.blocks, draft, settings);
    fillTimeSelect(this.startSelect, starts, draft.start, settings);
    fillTimeSelect(this.endSelect, ends, draft.end, settings);
    this.duration.textContent = formatDuration(draft.end - draft.start);
    this.renderSwatches(draft.categoryId);
    this.moves.hidden = true;
    this.warning.hidden = true;
    if (this.footer.firstChild !== this.cancelButton) this.footer.replaceChildren(this.cancelButton, this.buildButton);
  }

  private renderEdit(id: BlockId, fresh: boolean): void {
    const block = this.store.findBlock(this.store.viewedDate, id);
    if (!block) {
      this.panel.hidden = true;
      return;
    }
    const settings = this.store.settings;
    this.heading.textContent = 'Block details';
    if (fresh || document.activeElement !== this.titleInput) this.titleInput.value = block.title;
    const times = this.pending ?? { start: block.start, end: block.end };
    const { starts, ends } = editTimeOptions(this.store.blocks, block, times, settings);
    fillTimeSelect(this.startSelect, starts, times.start, settings);
    fillTimeSelect(this.endSelect, ends, times.end, settings);
    this.duration.textContent = formatDuration(times.end - times.start);
    this.renderSwatches(this.store.categoryFor(block).id);
    this.moves.hidden = false;
    const date = this.store.viewedDate;
    setDisabled(this.earlierButton, this.store.canNudge(date, id, -1) ? null : 'There is no room to move this block earlier.');
    setDisabled(this.laterButton, this.store.canNudge(date, id, 1) ? null : 'There is no room to move this block later.');
    this.warning.hidden = isInWindow(block, settings);
    if (this.footer.firstChild !== this.demolishButton) this.footer.replaceChildren(this.demolishButton);
  }

  private renderSwatches(selectedId: string): void {
    const categories = this.store.settings.categories;
    const key = categories.map((c) => `${c.id}:${c.name}:${c.color}`).join('|');
    if (this.swatches.dataset.key !== key) {
      this.swatches.dataset.key = key;
      this.swatches.replaceChildren(
        ...categories.map((category) => {
          const swatch = h('button', {
            class: `swatch swatch--${category.color}`,
            attrs: { type: 'button', title: category.name, 'aria-label': category.name, 'data-category': category.id },
          });
          swatch.addEventListener('click', () => this.pickCategory(category.id));
          return swatch;
        }),
      );
    }
    for (const swatch of this.swatches.querySelectorAll<HTMLButtonElement>('.swatch')) {
      swatch.setAttribute('aria-pressed', String(swatch.dataset.category === selectedId));
    }
  }

  private pickCategory(categoryId: string): void {
    const state = this.ui.state.inspector;
    if (state.mode === 'new') this.actions.updateDraft({ ...state.draft, categoryId });
    else if (state.mode === 'edit') this.showError(this.actions.commit(state.id, { categoryId }));
  }
}

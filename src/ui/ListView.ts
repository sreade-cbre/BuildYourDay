import { defaultNewRange, isInWindow } from '../core/layout';
import type { Block, BlockId, TimeRange } from '../core/model';
import type { BlockPatch, Store } from '../core/store';
import { formatDateTitle, formatDuration } from '../core/time';
import { button, h, iconButton } from './dom';
import { setDisabled } from './Overlay';
import { draftEndFor, editTimeOptions, fillTimeSelect, newTimeOptions } from './timeOptions';

// A plain HTML table of the viewed day (spec section 17) with the same edits
// as the inspector, so the app works without the 3D view. It also stands in
// for the scene when WebGL2 is unavailable.

export interface ListActions {
  build(draft: { start: number; end: number; title: string; categoryId: string }): string | null;
  commit(id: BlockId, patch: BlockPatch): string | null;
  nudge(id: BlockId, direction: -1 | 1): string | null;
  demolish(id: BlockId): void;
  previousDay(): void;
  nextDay(): void;
  today(): void;
}

export class ListView {
  readonly element: HTMLElement;
  private readonly heading: HTMLElement;
  private readonly body: HTMLTableSectionElement;
  private readonly error: HTMLElement;
  private draft: { start: number; end: number; title: string; categoryId: string } | null = null;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly store: Store,
    private readonly actions: ListActions,
    options: { notice?: string } = {},
  ) {
    this.heading = h('h2', { class: 'list-view__date' });
    this.body = h('tbody');
    this.error = h('p', { class: 'form-error', attrs: { role: 'alert' } });
    this.error.hidden = true;
    const table = h(
      'table',
      { class: 'list-table' },
      h('caption', { class: 'visually-hidden', text: 'Blocks for the day, earliest first' }),
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          ...['Title', 'Start', 'End', 'Length', 'Category', 'Actions'].map((label) => h('th', { text: label, attrs: { scope: 'col' } })),
        ),
      ),
      this.body,
    );
    this.element = h(
      'div',
      { class: 'list-view' },
      options.notice ? h('p', { class: 'list-view__notice', text: options.notice }) : null,
      h(
        'div',
        { class: 'list-view__nav' },
        iconButton('previous', 'Go to previous day', () => actions.previousDay()),
        this.heading,
        iconButton('next', 'Go to next day', () => actions.nextDay()),
        button('Today', 'button button--quiet', () => actions.today()),
      ),
      h('div', { class: 'list-view__scroll' }, table),
      this.error,
    );
    this.unsubscribe = store.subscribe((event) => {
      if (event.type === 'viewedDate') this.draft = null;
      this.render();
    });
    this.render();
  }

  private showError(message: string | null): void {
    this.error.textContent = message ?? '';
    this.error.hidden = !message;
  }

  render(): void {
    const focused = document.activeElement as HTMLElement | null;
    const focusKey = this.element.contains(focused) ? focused?.dataset?.focusKey : undefined;
    this.heading.textContent = formatDateTitle(this.store.viewedDate);
    const rows = this.store.blocks.map((block) => this.row(block));
    rows.push(this.newRow());
    this.body.replaceChildren(...rows);
    if (focusKey) this.body.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus();
  }

  private row(block: Block): HTMLTableRowElement {
    const settings = this.store.settings;
    const date = this.store.viewedDate;
    const key = (field: string) => `${block.id}-${field}`;

    const title = h('input', {
      class: 'input',
      attrs: { type: 'text', value: block.title, maxlength: 60, placeholder: 'Untitled', 'aria-label': 'Title', 'data-focus-key': key('title') },
    });
    const commitTitle = () => {
      if (title.value.trim() !== block.title) this.showError(this.actions.commit(block.id, { title: title.value }));
    };
    title.addEventListener('blur', commitTitle);
    title.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') commitTitle();
    });

    const start = h('select', { class: 'select', attrs: { 'aria-label': 'Start time', 'data-focus-key': key('start') } });
    const end = h('select', { class: 'select', attrs: { 'aria-label': 'End time', 'data-focus-key': key('end') } });
    const options = editTimeOptions(this.store.blocks, block, block, settings);
    fillTimeSelect(start, options.starts, block.start, settings);
    fillTimeSelect(end, options.ends, block.end, settings);
    const commitTimes = (range: TimeRange) => {
      if (range.start !== block.start || range.end !== block.end) this.showError(this.actions.commit(block.id, range));
    };
    for (const select of [start, end]) {
      const commit = () => commitTimes({ start: Number(start.value), end: Number(end.value) });
      select.addEventListener('blur', commit);
      select.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') commit();
      });
    }

    const category = this.categorySelect(this.store.categoryFor(block).id, key('category'));
    category.addEventListener('change', () => this.showError(this.actions.commit(block.id, { categoryId: category.value })));

    const earlier = button('Move earlier', 'button button--small', () => {
      if (earlier.getAttribute('aria-disabled') !== 'true') this.showError(this.actions.nudge(block.id, -1));
    });
    earlier.dataset.focusKey = key('earlier');
    setDisabled(earlier, this.store.canNudge(date, block.id, -1) ? null : 'There is no room to move this block earlier.');
    const later = button('Move later', 'button button--small', () => {
      if (later.getAttribute('aria-disabled') !== 'true') this.showError(this.actions.nudge(block.id, 1));
    });
    later.dataset.focusKey = key('later');
    setDisabled(later, this.store.canNudge(date, block.id, 1) ? null : 'There is no room to move this block later.');
    const demolish = button('Demolish', 'button button--small button--quiet', () => this.actions.demolish(block.id));

    const outside = isInWindow(block, settings) ? null : h('span', { class: 'list-table__warning', text: 'Outside the day window' });
    return h(
      'tr',
      {},
      h('td', {}, title, outside),
      h('td', {}, start),
      h('td', {}, end),
      h('td', { class: 'list-table__length', text: formatDuration(block.end - block.start) }),
      h('td', {}, category),
      h('td', { class: 'list-table__actions' }, earlier, later, demolish),
    );
  }

  /** The last row: a form for a new block in the next free range. */
  private newRow(): HTMLTableRowElement {
    const settings = this.store.settings;
    const blocks = this.store.blocks;
    if (!this.draft) {
      const range = defaultNewRange(blocks, settings);
      this.draft = range ? { ...range, title: '', categoryId: settings.categories[0]!.id } : null;
    }
    const draft = this.draft;
    if (!draft) {
      return h('tr', { class: 'list-table__new' }, h('td', { attrs: { colspan: 6 }, text: 'The day is full.' }));
    }
    const title = h('input', {
      class: 'input',
      attrs: { type: 'text', value: draft.title, maxlength: 60, placeholder: 'New block title', 'aria-label': 'New block title', 'data-focus-key': 'new-title' },
    });
    title.addEventListener('input', () => {
      draft.title = title.value;
    });
    const start = h('select', { class: 'select', attrs: { 'aria-label': 'New block start time', 'data-focus-key': 'new-start' } });
    const end = h('select', { class: 'select', attrs: { 'aria-label': 'New block end time', 'data-focus-key': 'new-end' } });
    const options = newTimeOptions(blocks, draft, settings);
    fillTimeSelect(start, options.starts, draft.start, settings);
    fillTimeSelect(end, options.ends, draft.end, settings);
    start.addEventListener('change', () => {
      const value = Number(start.value);
      draft.end = draftEndFor(blocks, draft, value, settings);
      draft.start = value;
      this.render();
    });
    end.addEventListener('change', () => {
      draft.end = Number(end.value);
      this.render();
    });
    const category = this.categorySelect(draft.categoryId, 'new-category');
    category.addEventListener('change', () => {
      draft.categoryId = category.value;
    });
    const build = button('Build', 'button button--primary button--small', () => {
      const error = this.actions.build(draft);
      this.showError(error);
      if (!error) {
        this.draft = null;
        this.render();
        this.body.querySelector<HTMLElement>('[data-focus-key="new-title"]')?.focus();
      }
    });
    title.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') build.click();
    });
    return h(
      'tr',
      { class: 'list-table__new' },
      h('td', {}, title),
      h('td', {}, start),
      h('td', {}, end),
      h('td', { class: 'list-table__length', text: formatDuration(draft.end - draft.start) }),
      h('td', {}, category),
      h('td', { class: 'list-table__actions' }, build),
    );
  }

  private categorySelect(selected: string, focusKey: string): HTMLSelectElement {
    const select = h(
      'select',
      { class: 'select', attrs: { 'aria-label': 'Category', 'data-focus-key': focusKey } },
      ...this.store.settings.categories.map((c) => h('option', { text: c.name, attrs: { value: c.id } })),
    );
    select.value = selected;
    return select;
  }

  dispose(): void {
    this.unsubscribe();
    this.element.remove();
  }
}

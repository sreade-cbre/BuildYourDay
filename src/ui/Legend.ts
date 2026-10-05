import { totals } from '../core/layout';
import type { CategoryId } from '../core/model';
import type { Store } from '../core/store';
import { formatDuration } from '../core/time';
import { h } from './dom';
import type { UiState } from './state';

// Bottom left legend (spec section 13.3): one row per category with its total
// for the viewed day. Clicking a row highlights that category by dimming the
// others; clicking again or pressing Escape clears it.

export class Legend {
  private readonly list: HTMLElement;

  constructor(
    host: HTMLElement,
    private readonly store: Store,
    private readonly ui: UiState,
    private readonly toggle: (id: CategoryId) => void,
  ) {
    this.list = h('ul', { class: 'legend__list' });
    host.append(h('section', { class: 'legend panel', attrs: { 'aria-label': 'Categories' } }, this.list));
    store.subscribe(() => this.render());
    ui.subscribe((state, previous) => {
      if (state.highlightedCategory !== previous.highlightedCategory) this.render();
    });
    this.render();
  }

  render(): void {
    const { settings } = this.store;
    // Count blocks by the category they show as, which matters while a
    // settings preview removes a category.
    const blocks = this.store.blocks.map((b) => ({ ...b, categoryId: this.store.categoryFor(b).id }));
    const byCategory = totals(blocks, settings).byCategory;
    const highlighted = this.ui.state.highlightedCategory;
    const focusedId = (document.activeElement as HTMLElement | null)?.dataset?.category;

    this.list.replaceChildren(
      ...settings.categories.map((category) => {
        const minutes = byCategory[category.id] ?? 0;
        const row = h(
          'button',
          {
            class: 'legend__row',
            attrs: {
              type: 'button',
              'aria-pressed': String(highlighted === category.id),
              'data-category': category.id,
              title: highlighted === category.id ? 'Show all categories' : `Highlight ${category.name}`,
            },
          },
          h('span', { class: `legend__swatch swatch--${category.color}`, attrs: { 'aria-hidden': 'true' } }),
          h('span', { class: 'legend__name', text: category.name }),
          h('span', { class: 'legend__total', text: formatDuration(minutes) }),
        );
        row.addEventListener('click', () => this.toggle(category.id));
        return h('li', {}, row);
      }),
    );
    // Rebuilding the rows should not drop keyboard focus.
    if (focusedId) this.list.querySelector<HTMLElement>(`[data-category="${CSS.escape(focusedId)}"]`)?.focus();
  }
}

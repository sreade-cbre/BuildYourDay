import { totals } from '../core/layout';
import type { Store } from '../core/store';
import { formatDateTitle, formatDuration } from '../core/time';

// The HTML layer over the canvas (spec section 13). M1 has the top bar with
// the date title and totals; controls arrive with editing in M2.

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

export class Overlay {
  private readonly dateTitle: HTMLHeadingElement;
  private readonly totalsLine: HTMLParagraphElement;
  private readonly unsubscribe: () => void;

  constructor(private readonly host: HTMLElement, private readonly store: Store) {
    const bar = element('header', 'top-bar panel');
    const date = element('div', 'top-bar__date');
    this.dateTitle = element('h1', 'date-title');
    date.append(this.dateTitle);
    this.totalsLine = element('p', 'totals');
    this.totalsLine.setAttribute('aria-live', 'polite');
    bar.append(date, this.totalsLine, element('div', 'top-bar__spacer'));
    host.append(bar);

    this.unsubscribe = store.subscribe(() => this.render());
    this.render();
  }

  render(): void {
    const { settings } = this.store;
    this.dateTitle.textContent = formatDateTitle(this.store.viewedDate);
    const t = totals(this.store.blocks, settings);
    this.totalsLine.textContent = `${formatDuration(t.plannedMinutes)} stacked · ${formatDuration(t.freeMinutes)} free`;
  }

  dispose(): void {
    this.unsubscribe();
    this.host.replaceChildren();
  }
}

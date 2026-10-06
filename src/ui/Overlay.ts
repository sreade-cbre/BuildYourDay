import { LIMITS } from '../core/defaults';
import { defaultNewRange, totals } from '../core/layout';
import { PERSIST_MESSAGES } from '../core/persist';
import { isMeetingBlock, type Store } from '../core/store';
import { addDays, formatDateTitle, formatDuration } from '../core/time';
import { button, h, iconButton } from './dom';

// The top bar and the small fixed pieces of the overlay (spec section 13.1):
// day navigation, totals, Add block, the menu, settings, plus the list view
// button that appears on focus, the storage warning chip, and the chip that
// says when Outlook needs the user to keep meetings up to date.

export interface OverlayActions {
  previousDay(): void;
  nextDay(): void;
  today(): void;
  addBlock(): void;
  resetView(): void;
  openSettings(): void;
  openListView(): void;
  copyPrevious(): void;
  exportJson(): void;
  importJson(): void;
  clearDay(): void;
  /** The Skip link on the status chip (spec 9.6). */
  skip(): void;
}

export const DAY_FULL_MESSAGE = 'The day is full.';

/** A problem with the Outlook connection that needs the user. */
export interface OutlookAlert {
  text: string;
  action: { label: string; run: () => void };
}

export class Overlay {
  readonly root: HTMLElement;
  private readonly dateTitle: HTMLHeadingElement;
  private readonly totalsLine: HTMLParagraphElement;
  private readonly todayButton: HTMLButtonElement;
  private readonly addButton: HTMLButtonElement;
  private readonly menuButton: HTMLButtonElement;
  private readonly menuList: HTMLElement;
  private readonly copyItem: HTMLButtonElement;
  private readonly clearItem: HTMLButtonElement;
  private readonly storageChip: HTMLElement;
  private readonly statusChip: HTMLElement;
  private readonly statusText: HTMLElement;
  private readonly outlookChip: HTMLElement;
  private readonly outlookText: HTMLElement;
  private readonly outlookAction: HTMLButtonElement;
  private outlookRun: (() => void) | null = null;
  private readonly unsubscribe: () => void;

  constructor(
    host: HTMLElement,
    private readonly store: Store,
    actions: OverlayActions,
    private readonly today: () => string,
    options: { scene: boolean },
  ) {
    this.root = host;

    const listButton = button('Open list view', 'skip-button', () => actions.openListView());

    this.dateTitle = h('h1', { class: 'date-title' });
    this.todayButton = h('button', {
      class: 'button button--quiet',
      text: 'Today',
      attrs: { type: 'button', 'aria-label': 'Go to today' },
    });
    this.todayButton.addEventListener('click', () => actions.today());
    const dateNav = h(
      'nav',
      { class: 'top-bar__date', attrs: { 'aria-label': 'Day' } },
      iconButton('previous', 'Go to previous day', () => actions.previousDay()),
      this.dateTitle,
      iconButton('next', 'Go to next day', () => actions.nextDay()),
      this.todayButton,
    );

    this.totalsLine = h('p', { class: 'totals', attrs: { 'aria-live': 'polite' } });

    this.addButton = button('Add block', 'button button--primary', () => {
      if (this.addButton.getAttribute('aria-disabled') !== 'true') actions.addBlock();
    });

    this.copyItem = this.menuItem("Copy yesterday's blocks", () => actions.copyPrevious());
    this.clearItem = this.menuItem('Clear this day', () => actions.clearDay());
    this.menuList = h(
      'ul',
      { class: 'menu__list panel', attrs: { role: 'menu', 'aria-label': 'Day actions' } },
      this.wrapItem(this.copyItem),
      this.wrapItem(this.menuItem('Export JSON', () => actions.exportJson())),
      this.wrapItem(this.menuItem('Import JSON', () => actions.importJson())),
      this.wrapItem(this.clearItem),
    );
    this.menuList.hidden = true;
    this.menuButton = iconButton('more', 'Open menu');
    this.menuButton.setAttribute('aria-haspopup', 'menu');
    this.menuButton.setAttribute('aria-expanded', 'false');
    this.menuButton.addEventListener('click', () => this.toggleMenu());
    this.menuButton.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.openMenu();
      }
    });
    this.menuList.addEventListener('keydown', this.onMenuKey);
    const menu = h('div', { class: 'menu' }, this.menuButton, this.menuList);

    const actionsGroup = h(
      'div',
      { class: 'top-bar__actions' },
      options.scene ? button('Reset view', 'button button--quiet', () => actions.resetView()) : null,
      this.addButton,
      menu,
      iconButton('settings', 'Open settings', () => actions.openSettings()),
    );

    const bar = h('header', { class: 'top-bar panel' }, dateNav, this.totalsLine, h('div', { class: 'top-bar__spacer' }), actionsGroup);
    this.storageChip = h('div', { class: 'chip chip--warning chip--top', text: PERSIST_MESSAGES.storageUnavailable, attrs: { role: 'status' } });
    this.storageChip.hidden = true;
    // While a job plays: "Building Pay app review" with a Skip link (spec 13.4).
    this.statusText = h('span', { class: 'chip__text' });
    this.statusChip = h(
      'div',
      { class: 'chip chip--status', attrs: { role: 'status' } },
      this.statusText,
      button('Skip', 'button button--link', () => actions.skip()),
    );
    this.statusChip.hidden = true;
    this.outlookText = h('span', { class: 'chip__text' });
    this.outlookAction = button('', 'button button--link', () => this.outlookRun?.());
    this.outlookChip = h('div', { class: 'chip chip--status chip--outlook', attrs: { role: 'status' } }, this.outlookText, this.outlookAction);
    this.outlookChip.hidden = true;
    host.append(listButton, bar, this.storageChip, this.statusChip, this.outlookChip);

    document.addEventListener('pointerdown', this.onDocumentPointer, true);
    this.unsubscribe = store.subscribe(() => this.render());
    this.render();
  }

  private menuItem(label: string, run: () => void): HTMLButtonElement {
    const item = h('button', { class: 'menu__item', text: label, attrs: { type: 'button', role: 'menuitem', tabindex: '-1' } });
    item.addEventListener('click', () => {
      if (item.getAttribute('aria-disabled') === 'true') return;
      this.closeMenu(true);
      run();
    });
    return item;
  }

  private wrapItem(item: HTMLButtonElement): HTMLLIElement {
    return h('li', { attrs: { role: 'none' } }, item);
  }

  private items(): HTMLButtonElement[] {
    return [...this.menuList.querySelectorAll<HTMLButtonElement>('.menu__item')];
  }

  private toggleMenu(): void {
    if (this.menuList.hidden) this.openMenu();
    else this.closeMenu(true);
  }

  private openMenu(): void {
    this.render();
    this.menuList.hidden = false;
    this.menuButton.setAttribute('aria-expanded', 'true');
    this.items()[0]?.focus();
  }

  closeMenu(returnFocus: boolean): void {
    if (this.menuList.hidden) return;
    this.menuList.hidden = true;
    this.menuButton.setAttribute('aria-expanded', 'false');
    if (returnFocus) this.menuButton.focus();
  }

  get menuOpen(): boolean {
    return !this.menuList.hidden;
  }

  private readonly onMenuKey = (event: KeyboardEvent): void => {
    const items = this.items();
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      (event.key === 'Home' ? items[0] : items[items.length - 1])?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.closeMenu(true);
    } else if (event.key === 'Tab') {
      this.closeMenu(false);
    }
  };

  private readonly onDocumentPointer = (event: PointerEvent): void => {
    if (this.menuList.hidden) return;
    const target = event.target as Node;
    if (!this.menuList.contains(target) && !this.menuButton.contains(target)) this.closeMenu(false);
  };

  setStorageWarning(visible: boolean): void {
    this.storageChip.hidden = !visible;
  }

  /** Shows what Outlook needs, or hides the chip with null. */
  setOutlookAlert(alert: OutlookAlert | null): void {
    this.outlookChip.hidden = alert === null;
    this.outlookRun = alert?.action.run ?? null;
    if (!alert) return;
    this.outlookText.textContent = alert.text;
    this.outlookAction.textContent = alert.action.label;
  }

  /** Shows what is being built, or hides the chip with null. */
  setStatus(label: string | null): void {
    this.statusChip.hidden = !label;
    if (label) this.statusText.textContent = `${label}\u2026`;
  }

  render(): void {
    const { settings } = this.store;
    const viewed = this.store.viewedDate;
    const blocks = this.store.blocks;
    this.dateTitle.textContent = formatDateTitle(viewed);
    this.todayButton.hidden = viewed === this.today();
    const t = totals(blocks, settings);
    this.totalsLine.textContent = `${formatDuration(t.plannedMinutes)} stacked · ${formatDuration(t.freeMinutes)} free`;

    const full = blocks.length >= LIMITS.maxBlocksPerDay
      ? `A day can hold up to ${LIMITS.maxBlocksPerDay} blocks.`
      : defaultNewRange(blocks, settings) === null ? DAY_FULL_MESSAGE : null;
    setDisabled(this.addButton, full);

    const previous = this.store.previousPlannedDate(viewed);
    const yesterday = addDays(viewed, -1);
    this.copyItem.textContent = previous && previous !== yesterday
      ? `Copy blocks from ${formatDateTitle(previous)}`
      : "Copy yesterday's blocks";
    // Meetings from Outlook are not the user's to copy over or clear.
    const own = blocks.filter((b) => !isMeetingBlock(b)).length;
    setDisabled(
      this.copyItem,
      own > 0 ? 'This day already has blocks.' : previous === null ? 'No earlier day has blocks.' : null,
    );
    setDisabled(
      this.clearItem,
      blocks.length === 0 ? 'This day has no blocks.' : own === 0 ? 'Meetings from Outlook stay, so there is nothing else to clear.' : null,
    );
  }

  dispose(): void {
    this.unsubscribe();
    document.removeEventListener('pointerdown', this.onDocumentPointer, true);
    this.root.replaceChildren();
  }
}

/**
 * Marks a control unavailable with a reason in its tooltip. aria-disabled keeps
 * it focusable and hoverable, so the reason can be read, unlike `disabled`.
 */
export function setDisabled(control: HTMLElement, reason: string | null): void {
  if (reason) {
    control.setAttribute('aria-disabled', 'true');
    control.title = reason;
  } else {
    control.removeAttribute('aria-disabled');
    control.removeAttribute('title');
  }
}

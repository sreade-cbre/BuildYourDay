import { focusables, h } from './dom';

// A modal dialog with a focus trap. Escape and the backdrop close it, and
// focus returns to whatever opened it.

export interface DialogOptions {
  title: string;
  /** Extra class for sizing, for example 'dialog--wide'. */
  className?: string;
  /** Runs when the dialog closes for any reason. */
  onClose?: () => void;
  /** Escape and backdrop clicks call this instead of closing directly, if set. */
  onDismiss?: () => void;
}

export class Dialog {
  readonly body: HTMLElement;
  readonly footer: HTMLElement;
  private readonly backdrop: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly opener: Element | null;
  private closed = false;
  private asideFocus: Element | null = null;

  static openCount = 0;

  constructor(host: HTMLElement, private readonly options: DialogOptions) {
    this.opener = document.activeElement;
    const titleId = `dialog-title-${Math.random().toString(36).slice(2, 8)}`;
    this.body = h('div', { class: 'dialog__body' });
    this.footer = h('div', { class: 'dialog__footer' });
    this.panel = h(
      'section',
      {
        class: `dialog panel ${options.className ?? ''}`.trim(),
        attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      },
      h('h2', { class: 'dialog__title', text: options.title, attrs: { id: titleId } }),
      this.body,
      this.footer,
    );
    this.backdrop = h('div', { class: 'dialog-backdrop' }, this.panel);
    this.backdrop.addEventListener('pointerdown', (event) => {
      if (event.target === this.backdrop) this.dismiss();
    });
    this.panel.addEventListener('keydown', this.onKeyDown);
    host.append(this.backdrop);
    Dialog.openCount += 1;
  }

  /** Moves focus to the first control, or to a given element. */
  focus(target?: HTMLElement | null): void {
    (target ?? focusables(this.panel)[0] ?? this.panel).focus();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.dismiss();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusables(this.panel);
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  private dismiss(): void {
    if (this.options.onDismiss) this.options.onDismiss();
    else this.close();
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  /**
   * Steps out of view and back without closing, for example while the scene
   * previews a setting. The dialog stays open for everything else, so
   * keyboard shortcuts stay off meanwhile.
   */
  setAside(aside: boolean): void {
    if (this.closed || aside === this.backdrop.hidden) return;
    if (aside) this.asideFocus = document.activeElement;
    this.backdrop.hidden = aside;
    if (!aside && this.asideFocus instanceof HTMLElement && this.asideFocus.isConnected) this.asideFocus.focus();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    Dialog.openCount -= 1;
    this.backdrop.remove();
    this.options.onClose?.();
    if (this.opener instanceof HTMLElement && this.opener.isConnected) this.opener.focus();
  }
}

/** Asks a question with a row of buttons. Resolves with the chosen value, or null on dismiss. */
export function choose<T extends string>(
  host: HTMLElement,
  title: string,
  message: string,
  choices: Array<{ value: T; label: string; primary?: boolean }>,
): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: T | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const dialog = new Dialog(host, { title, onClose: () => settle(null) });
    dialog.body.append(h('p', { text: message }));
    for (const choice of choices) {
      const node = h('button', {
        class: choice.primary ? 'button button--primary' : 'button',
        text: choice.label,
        attrs: { type: 'button' },
      });
      node.addEventListener('click', () => {
        settle(choice.value);
        dialog.close();
      });
      dialog.footer.append(node);
    }
    dialog.focus();
  });
}

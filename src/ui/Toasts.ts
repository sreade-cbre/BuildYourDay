import { button, h } from './dom';

// Toasts in the bottom right (spec section 13.5): undo, import results, and
// confirmations. Each dismisses after 6 seconds; hover or focus pauses it.

const TOAST_MS = 6000;

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastOptions {
  action?: ToastAction;
  /** Milliseconds before it dismisses itself. */
  duration?: number;
}

interface LiveToast {
  node: HTMLElement;
  remaining: number;
  startedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export class Toasts {
  private readonly region: HTMLElement;
  private readonly live = new Set<LiveToast>();

  constructor(host: HTMLElement) {
    this.region = h('div', { class: 'toasts', attrs: { role: 'status', 'aria-live': 'polite' } });
    host.append(this.region);
  }

  show(message: string, options: ToastOptions = {}): () => void {
    const node = h('div', { class: 'toast panel' }, h('p', { class: 'toast__message', text: message }));
    const toast: LiveToast = { node, remaining: options.duration ?? TOAST_MS, startedAt: 0, timer: null };
    const dismiss = () => this.dismiss(toast);
    if (options.action) {
      const { action } = options;
      node.append(
        button(action.label, 'button button--link toast__action', () => {
          dismiss();
          action.run();
        }),
      );
    }
    const pause = () => {
      if (toast.timer === null) return;
      clearTimeout(toast.timer);
      toast.timer = null;
      toast.remaining -= performance.now() - toast.startedAt;
    };
    const resume = () => {
      if (toast.timer !== null || !this.live.has(toast)) return;
      if (node.matches(':hover') || node.contains(document.activeElement)) return;
      this.start(toast);
    };
    node.addEventListener('pointerenter', pause);
    node.addEventListener('pointerleave', resume);
    node.addEventListener('focusin', pause);
    node.addEventListener('focusout', () => setTimeout(resume, 0));
    this.region.append(node);
    this.live.add(toast);
    this.start(toast);
    return dismiss;
  }

  private start(toast: LiveToast): void {
    toast.startedAt = performance.now();
    toast.timer = setTimeout(() => this.dismiss(toast), Math.max(0, toast.remaining));
  }

  private dismiss(toast: LiveToast): void {
    if (!this.live.delete(toast)) return;
    if (toast.timer !== null) clearTimeout(toast.timer);
    toast.node.remove();
  }

  /** Removes every toast, for example when switching days. */
  clear(): void {
    for (const toast of [...this.live]) this.dismiss(toast);
  }
}

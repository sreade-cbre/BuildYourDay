import { Dialog } from './Dialog';
import { isTypingTarget } from './dom';

// Global keyboard shortcuts (spec section 12.9). Keys that type text or move
// within a control are left alone while such a control has focus, and nothing
// fires while a modal dialog is open; dialogs handle their own keys.

export interface ShortcutActions {
  newBlock(): void;
  /** Enter outside a control: confirm the inspector. */
  confirm(): void;
  /** Returns true when something was closed or canceled. */
  escape(): boolean;
  deleteSelected(): void;
  /** +1 selects the next block in time (up the tower), -1 the previous. */
  selectStep(direction: 1 | -1): void;
  previousDay(): void;
  nextDay(): void;
  today(): void;
  resetView(): void;
  openSettings(): void;
  toggleDebug(): void;
}

export function installShortcuts(actions: ShortcutActions): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.isComposing) return;
    if (Dialog.openCount > 0) return;
    if (event.key === 'Escape') {
      if (actions.escape()) event.preventDefault();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const typing = isTypingTarget(event.target);
    if (typing) return;
    const onControl = event.target instanceof HTMLElement && event.target.closest('button, a, [role="menuitem"]') !== null;

    switch (event.key) {
      case 'n':
      case 'N':
        actions.newBlock();
        break;
      case 'Enter':
        // Enter on a button presses that button, so only plain focus confirms.
        if (onControl) return;
        actions.confirm();
        break;
      case 'Delete':
      case 'Backspace':
        actions.deleteSelected();
        break;
      case 'ArrowUp':
        actions.selectStep(1);
        break;
      case 'ArrowDown':
        actions.selectStep(-1);
        break;
      case '[':
        actions.previousDay();
        break;
      case ']':
        actions.nextDay();
        break;
      case 't':
      case 'T':
        actions.today();
        break;
      case 'r':
      case 'R':
        actions.resetView();
        break;
      case ',':
        actions.openSettings();
        break;
      case 'd':
      case 'D':
        actions.toggleDebug();
        break;
      default:
        return;
    }
    event.preventDefault();
  };
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}

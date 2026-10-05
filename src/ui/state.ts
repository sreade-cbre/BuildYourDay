import type { BlockId, CategoryId } from '../core/model';

// Interaction state that is not plan data: what is selected or hovered, the
// legend highlight, and what the inspector shows. Lives outside the store so
// it is never saved.

export interface BlockDraftState {
  start: number;
  end: number;
  title: string;
  categoryId: CategoryId;
}

export type InspectorState =
  | { mode: 'closed' }
  | { mode: 'new'; draft: BlockDraftState }
  | { mode: 'edit'; id: BlockId };

export interface UiSnapshot {
  selectedId: BlockId | null;
  hoveredId: BlockId | null;
  hoveredGapStart: number | null;
  highlightedCategory: CategoryId | null;
  inspector: InspectorState;
}

export type UiListener = (state: UiSnapshot, previous: UiSnapshot) => void;

export class UiState {
  private current: UiSnapshot = {
    selectedId: null,
    hoveredId: null,
    hoveredGapStart: null,
    highlightedCategory: null,
    inspector: { mode: 'closed' },
  };
  private readonly listeners = new Set<UiListener>();

  get state(): UiSnapshot {
    return this.current;
  }

  update(patch: Partial<UiSnapshot>): void {
    const previous = this.current;
    const next = { ...previous, ...patch };
    const changed = (Object.keys(patch) as Array<keyof UiSnapshot>).some((key) => previous[key] !== next[key]);
    if (!changed) return;
    this.current = next;
    for (const listener of [...this.listeners]) listener(next, previous);
  }

  subscribe(listener: UiListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

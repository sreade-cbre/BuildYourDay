import type { BlockId } from '../core/model';

// What animation jobs currently control (spec section 19: the Director is the
// only thing that moves a block while its job plays). Tower hides held blocks
// and leaves a held site alone; the job shows its own copy instead, and the
// Tower takes over again once the hold is released.

/** A held block's label shows at this opacity until the job fades it in. */
export const HELD_LABEL_OPACITY = 0.45;

export class Holds {
  readonly blocks = new Set<BlockId>();
  /** True while a first build owns the plot and foundation. */
  site = false;
  private readonly labels = new Map<BlockId, number>();

  hold(id: BlockId): void {
    this.blocks.add(id);
  }

  release(id: BlockId): void {
    this.blocks.delete(id);
    this.labels.delete(id);
  }

  isHeld(id: BlockId): boolean {
    return this.blocks.has(id);
  }

  labelOpacity(id: BlockId): number {
    return this.labels.get(id) ?? HELD_LABEL_OPACITY;
  }

  setLabelOpacity(id: BlockId, opacity: number): void {
    this.labels.set(id, opacity);
  }
}

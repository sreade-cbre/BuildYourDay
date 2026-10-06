import type { BlockId, TimeRange } from '../core/model';

// What animation jobs control (spec section 19: the Director is the only
// thing that moves a block while its job plays, and the Tower applies final
// transforms once the job is done). Every job that touches a block files a
// claim on it when the job is created, in queue order. The first claim
// decides what the block shows: hidden while the job draws its own copy, or
// posed where the job puts it. When a job ends it withdraws its claim and the
// next one takes over, so a block never flashes its final state between two
// of its jobs.

/** A block under construction shows its label at this opacity until the job fades it in. */
export const HELD_LABEL_OPACITY = 0.45;

/** Where a job shows a block: its base height, its height, and a sideways offset. */
export interface BlockPose {
  baseY: number;
  height: number;
  x: number;
  z: number;
}

export interface Claim {
  /** Null hides the block while the job draws its own copy. */
  pose: BlockPose | null;
  labelOpacity: number;
  /** Times whose gap outlines stay hidden while the job waits or plays. */
  quiet: TimeRange[];
  /**
   * For the block under way: how high the built part reaches, instead of
   * the now ring, while the crew catches up with the time already passed.
   */
  reveal?: number;
  /** Runs when this claim becomes the first on its block. */
  onFirst?: () => void;
}

/**
 * Who owns the plot and foundation. A first build owns them outright and the
 * Tower hides its own slab; a demolition that empties the day freezes them as
 * they are until it has cleared the site.
 */
export type SiteMode = 'build' | 'freeze';

export interface SiteClaim {
  mode: SiteMode;
}

export class Holds {
  private readonly claims = new Map<BlockId, Claim[]>();
  private readonly siteClaims: SiteClaim[] = [];

  /** Files a claim behind any earlier ones on the same block. */
  claim(id: BlockId, claim: Claim): Claim {
    const list = this.claims.get(id) ?? [];
    list.push(claim);
    this.claims.set(id, list);
    if (list.length === 1) claim.onFirst?.();
    return claim;
  }

  /** Withdraws a claim; the next one on the block, if any, takes over. */
  release(id: BlockId, claim: Claim): void {
    const list = this.claims.get(id);
    if (!list) return;
    const index = list.indexOf(claim);
    if (index < 0) return;
    list.splice(index, 1);
    if (list.length === 0) this.claims.delete(id);
    else if (index === 0) list[0]!.onFirst?.();
  }

  /** The claim that decides what a block shows, if any. */
  current(id: BlockId): Claim | undefined {
    return this.claims.get(id)?.[0];
  }

  /** True while a job hides the block to draw its own copy. */
  isHidden(id: BlockId): boolean {
    const claim = this.current(id);
    return claim !== undefined && claim.pose === null;
  }

  isClaimed(id: BlockId): boolean {
    return this.claims.has(id);
  }

  /** Every range a pending or playing job keeps clear of gap outlines. */
  quietRanges(): TimeRange[] {
    const ranges: TimeRange[] = [];
    for (const list of this.claims.values()) for (const claim of list) ranges.push(...claim.quiet);
    return ranges;
  }

  claimSite(mode: SiteMode): SiteClaim {
    const claim = { mode };
    this.siteClaims.push(claim);
    return claim;
  }

  releaseSite(claim: SiteClaim): void {
    const index = this.siteClaims.indexOf(claim);
    if (index >= 0) this.siteClaims.splice(index, 1);
  }

  /** The first site claim's mode, or null when the Tower shows the site as the data says. */
  get siteMode(): SiteMode | null {
    return this.siteClaims[0]?.mode ?? null;
  }
}

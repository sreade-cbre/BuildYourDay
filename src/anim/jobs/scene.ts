import type { Block, BlockId, Settings, SwatchToken, TimeRange } from '../../core/model';
import type { Crew } from '../../scene/crew/Crew';
import type { Ground } from '../../scene/Ground';
import type { Holds } from '../../scene/holds';
import type { Tower } from '../../scene/Tower';

// What a job can see and touch, and a few questions jobs ask about the
// tower as it stands while they play.

export interface JobScene {
  crew: Crew;
  tower: Tower;
  ground: Ground;
  holds: Holds;
  settings(): Readonly<Settings>;
  /** The viewed day's blocks as the data has them now. */
  blocks(): readonly Block[];
  /** A block's category color. */
  token(block: Block): SwatchToken;
  /** Whether another job is waiting; if so the crane stays out (spec 9.4 phase 7). */
  moreQueued(): boolean;
  /** Reframes the camera when a height is out of view (spec 9.5). */
  keepInFrame(topY: number): void;
  requestRender(): void;
}

/** Blocks standing now: in the data and not hidden by a build still to come. */
export function standingBlocks(scene: JobScene, except?: BlockId): Block[] {
  return scene.blocks().filter((b) => b.id !== except && !scene.holds.isHidden(b.id));
}

/** True when any standing block sits at or above a range's end, so loads cannot drop in from above. */
export function hasBlocksAbove(scene: JobScene, range: TimeRange, except?: BlockId): boolean {
  return standingBlocks(scene, except).some((b) => b.start >= range.end);
}

/** The highest standing roof, or 0 for none. */
export function standingTop(scene: JobScene, except?: BlockId): number {
  let top = 0;
  for (const block of standingBlocks(scene, except)) {
    const pose = scene.tower.poseFor(block);
    top = Math.max(top, pose.baseY + pose.height);
  }
  return top;
}

/** The highest standing roof at or below a height, where rubble comes to rest; the slab top is 0. */
export function surfaceBelow(scene: JobScene, y: number, except?: BlockId): number {
  let surface = 0;
  for (const block of standingBlocks(scene, except)) {
    const pose = scene.tower.poseFor(block);
    const roof = pose.baseY + pose.height;
    if (roof <= y + 1e-6) surface = Math.max(surface, roof);
  }
  return surface;
}

/** A block's title for the status chip. */
export function titleOf(block: Block): string {
  return block.title || 'Untitled';
}

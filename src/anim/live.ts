import { isInWindow } from '../core/layout';
import type { Block, BlockId } from '../core/model';
import { CRANE_PARK } from '../scene/crew/Crew';
import type { LiveKit } from '../scene/crew/LiveKit';
import type { SiteClaim } from '../scene/holds';
import { solidBlocks, type JobScene } from './jobs/scene';
import { SiteScript } from './liveBuild';

// The block under way. Blocks are built in real time: while a block's time
// runs, the crew builds it from setting out to the last of the scaffold (see
// liveBuild.ts), finishing as its time is up. This keeps that site in step
// with the clock, frame by frame, on its own set of site pieces, and lends
// the shared crane and machines to any job that needs them meanwhile. It is
// not a job itself: it has no length to skip and nothing to hurry.

export interface LiveHost {
  /** Reduced motion: the building goes up with the time but no one moves. */
  calm(): boolean;
  /** Animation speed for the crew's motion. */
  speed(): number;
  /** Runs a callback every frame, or at a calm rate while nothing else moves, until it returns false. */
  animate(frame: (dt: number) => boolean): void;
  /** What the job playing now has borrowed. */
  borrowed(): { crane: boolean; machines: boolean };
  /** Minutes into today by the clock. */
  minutes(): number;
}

export class LiveSite {
  private script: SiteScript | null = null;
  private key = '';
  /** The day's first block owns the plot until it is done, so the tower leaves the grass and slab to it. */
  private site: SiteClaim | null = null;
  private previous: number | null = null;
  private running = false;

  constructor(private readonly scene: JobScene, readonly kit: LiveKit, private readonly host: LiveHost) {}

  /** The block under way that the site is building, if any. */
  get blockId(): BlockId | null {
    return this.script?.block.id ?? null;
  }

  /** The minute up to which a block under way stands built, for demolishing what is there. */
  builtTo(block: Block): number {
    const script = this.script;
    if (!script || script.block.id !== block.id) return block.start;
    const share = (script.reveal(this.secondsInto(block)) - script.baseY) / script.height;
    return block.start + share * (block.end - block.start);
  }

  private secondsInto(block: Block): number {
    return (this.host.minutes() - block.start) * 60;
  }

  /** The block whose time runs now on the viewed day, inside the day window. */
  private target(): Block | null {
    const settings = this.scene.settings();
    return this.scene.blocks().find((b) => isInWindow(b, settings) && this.scene.stateOf(b) === 'building') ?? null;
  }

  /**
   * Brings the site in line with the clock, the data, and the settings: sets
   * it up for the block under way, again if that block changed, or clears it.
   */
  sync(): void {
    const block = this.target();
    if (!block) {
      this.clear();
      return;
    }
    const { scene } = this;
    const first = solidBlocks(scene, block.id).length === 0 && (scene.holds.siteMode === null || this.site !== null);
    const pose = scene.tower.poseFor(block);
    const key = [block.id, block.start, block.end, pose.baseY, pose.height, scene.settings().slotMinutes, first, this.host.speed(), this.host.calm(), scene.token(block)].join('|');
    if (this.script && key === this.key) return;
    this.key = key;
    if (first && !this.site) this.site = scene.holds.claimSite('build');
    if (!first && this.site) {
      scene.holds.releaseSite(this.site);
      this.site = null;
    }
    this.script = new SiteScript(scene, block, this.kit, { first, pace: this.host.speed(), calm: this.host.calm() });
    this.previous = null;
    // With the site claimed, the tower hides its own slab.
    scene.tower.sync();
    this.show();
    this.kit.update(0);
    this.ensureRunning();
    scene.requestRender();
  }

  /** Takes the site down at once and gives the plot back to the tower. */
  clear(): void {
    if (!this.script && !this.site) return;
    const borrowed = this.host.borrowed();
    this.script = null;
    this.key = '';
    this.kit.park();
    const { crew } = this.scene;
    if (!borrowed.machines) crew.parkMachines();
    if (!borrowed.crane) crew.crane.setPose({ ...CRANE_PARK, hookY: crew.crane.hookCeiling });
    if (this.site) {
      this.scene.holds.releaseSite(this.site);
      this.site = null;
    }
    this.scene.tower.setLive(null);
    this.scene.tower.sync();
    this.scene.requestRender();
  }

  private ensureRunning(): void {
    if (this.running) return;
    this.running = true;
    this.host.animate(this.frame);
  }

  private readonly frame = (dt: number): boolean => {
    if (this.script) this.show();
    const dusty = this.kit.update(dt * this.host.speed());
    const keep = this.script !== null || dusty;
    if (!keep) this.running = false;
    return keep;
  };

  /** Shows the site as it stands now. */
  private show(): void {
    const script = this.script!;
    const t = this.secondsInto(script.block);
    const borrowed = this.host.borrowed();
    script.apply(t, { crane: !borrowed.crane, machines: !borrowed.machines }, this.previous);
    this.previous = t;
    this.scene.tower.setLive(script.block.id, script.reveal(t), script.roofOn(t), script.activity(t));
  }
}

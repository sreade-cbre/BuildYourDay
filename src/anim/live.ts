import * as THREE from 'three';
import { isInWindow } from '../core/layout';
import type { Block, BlockId } from '../core/model';
import { SITE_Y } from '../scene/crew/Crew';
import type { LiveKit } from '../scene/crew/LiveKit';
import { BEAM_SIZE } from '../scene/crew/props';
import type { Job } from './Director';
import { easeInOutCubic } from './easing';
import { SCAFFOLD_SPOTS, endJob, finishTimeline, isFirstBuild, levelFor, ringY, siteLayout, startTimeline, type SiteLayout } from './jobs/build';
import { titleOf, type JobScene } from './jobs/scene';
import { Timeline } from './Timeline';

// The block under way. Blocks are built in real time: while a block's time
// runs, its site stands around it, with the scaffold up, the frame ahead of
// the facade, and the crew hammering on the planks where the facade has got
// to, which is the now ring. Each finished floor puffs dust, and the crew
// climbs a level when the facade reaches one. The site's start and finish
// are jobs like any other (see build.ts); between them this keeps the site
// in step with the clock, frame by frame, on its own set of site pieces, so
// other jobs can borrow the crane meanwhile.

export interface LiveHost {
  /** False under reduced motion, when no crew works: the facade rises with the ring alone. */
  enabled(): boolean;
  /** Height of the now ring. */
  nowY(): number;
  /** Animation speed for the crew's own motion. */
  speed(): number;
  /** Runs a callback every frame, or at a calm rate while nothing else moves, until it returns false. */
  animate(frame: (dt: number) => boolean): void;
}

/** Seconds a worker takes to climb from one scaffold level to the next. */
const CLIMB_SECONDS = 0.6;

/** Floors the facade has finished at a share of the block's time. */
function floorsUp(layout: SiteLayout, progress: number): number {
  return Math.min(layout.floors, Math.floor(progress * layout.floors + 1e-9));
}

/** What the site's look depends on; a change means it stands again in its new place. */
function keyOf(layout: SiteLayout): string {
  const { block } = layout;
  return [block.id, block.start, block.end, layout.baseY, layout.height, layout.floors, layout.first, layout.hoistTop].join('|');
}

export class LiveSite {
  private layout: SiteLayout | null = null;
  private key = '';
  /** Start and finish jobs queued or playing. While there are any, the site is theirs. */
  private holders = 0;
  private running = false;
  private elapsed = 0;
  private floorsDone = 0;
  private ringsHidden = 0;
  private level = 0;
  private climb: { from: number; elapsed: number } | null = null;

  constructor(private readonly scene: JobScene, readonly kit: LiveKit, private readonly host: LiveHost) {}

  /** The block the site stands around, if any. */
  get blockId(): BlockId | null {
    return this.layout?.block.id ?? null;
  }

  /** The block whose time runs now on the viewed day, inside the day window, when the crew works at all. */
  private target(): Block | null {
    if (!this.host.enabled()) return null;
    const settings = this.scene.settings();
    return this.scene.blocks().find((b) => isInWindow(b, settings) && this.scene.stateOf(b) === 'building') ?? null;
  }

  /**
   * Brings the site in line with the clock and the data at once: stands it
   * around the block under way, moves it when that block changed, or clears
   * it when there is none.
   */
  sync(): void {
    if (this.holders > 0) return;
    const block = this.target();
    if (!block) {
      this.clear();
      return;
    }
    const layout = siteLayout(this.scene, block, this.kit, isFirstBuild(this.scene, block));
    if (this.layout && keyOf(layout) === this.key) return;
    this.establish(layout);
  }

  /** Takes the site down at once. */
  clear(): void {
    if (!this.layout) return;
    this.layout = null;
    this.key = '';
    this.kit.park();
    this.scene.requestRender();
  }

  /**
   * The crew starts a block whose time has come: survey, site prep,
   * foundation, frame, and scaffold, then the facade catches up with the
   * time already gone. The block shows as its plan meanwhile.
   */
  startJob(block: Block): Job {
    const { scene } = this;
    const { holds } = scene;
    this.hold();
    const pose = scene.tower.poseFor(block);
    const claim = holds.claim(block.id, { pose: { ...pose }, labelOpacity: 1, quiet: [], reveal: pose.baseY });
    const first = isFirstBuild(scene, block);
    const site = first ? holds.claimSite('build') : null;
    return {
      label: `Building ${titleOf(block)}`,
      start: () => {
        this.clear();
        const current = this.current(block.id);
        if (!current || scene.stateOf(current) !== 'building') return new Timeline();
        return startTimeline(scene, current, claim, first, this.kit, this.host.nowY());
      },
      end: () => {
        holds.release(block.id, claim);
        if (site) holds.releaseSite(site);
        this.release();
        endJob(scene);
      },
    };
  }

  /**
   * The crew finishes a block whose time is up: the roof goes on, the
   * scaffold comes down, and everyone goes home. The site's copy of the
   * block, whole, stands in for the tower's own until then.
   */
  finishJob(block: Block): Job {
    const { scene } = this;
    const { holds } = scene;
    this.hold();
    const claim = holds.claim(block.id, { pose: null, labelOpacity: 1, quiet: [], onFirst: () => this.showWhole(block) });
    return {
      label: `Finishing ${titleOf(block)}`,
      start: () => {
        const current = this.current(block.id);
        if (!current || scene.stateOf(current) !== 'built' || !isInWindow(current, scene.settings())) return new Timeline();
        const first = this.layout?.block.id === current.id ? this.layout.first : isFirstBuild(scene, current);
        const layout = siteLayout(scene, current, this.kit, first);
        // The site as it stood when the time ran out: facade up, crew on the top planks.
        this.establish(layout, layout.top);
        this.layout = null;
        this.key = '';
        return finishTimeline(scene, layout, this.kit);
      },
      end: () => {
        holds.release(block.id, claim);
        this.kit.park();
        this.layout = null;
        this.key = '';
        this.release();
        endJob(scene);
      },
    };
  }

  private current(id: BlockId): Block | undefined {
    return this.scene.blocks().find((b) => b.id === id);
  }

  /** The block whole, for a finish that is waiting its turn. */
  private showWhole(block: Block): void {
    const { props } = this.kit;
    const { baseY, height } = this.scene.tower.poseFor(block);
    props.setup(this.scene.token(block), baseY, height);
    props.setReveal(Infinity);
    props.setEdgeOpacity(0.5);
    this.scene.requestRender();
  }

  private hold(): void {
    this.holders++;
    this.ensureRunning();
  }

  private release(): void {
    this.holders = Math.max(0, this.holders - 1);
    this.sync();
  }

  /**
   * Stands the site around a block as it is at this moment: what the start
   * leaves, with the facade at the ring, or at `reveal` when given.
   */
  private establish(layout: SiteLayout, reveal?: number): void {
    const { props, scaffold, rail, hoist } = this.kit;
    const { baseY, height, top, floors } = layout;
    this.kit.park();
    this.layout = layout;
    this.key = keyOf(layout);
    const y = reveal ?? this.revealY(layout);
    const progress = (y - baseY) / height;

    props.tripod.visible = true;
    props.tripod.position.set(layout.tripod.x, SITE_Y, layout.tripod.z);
    props.tripod.scale.setScalar(1);
    if (!layout.first) props.setFloor(baseY, 1);
    props.setColumns(Math.min(y, top), top);
    props.setRingCount(floors);
    for (let ring = 0; ring < floors; ring++) props.setRing(ring, 0, ringY(layout, ring), 0);
    this.ringsHidden = 0;
    this.hideCoveredRings(y);
    scaffold.layout(baseY, height, floors);
    scaffold.revealTo(top + 0.05);
    if (!layout.first) {
      rail.show(baseY, 1);
      hoist.setMast(SITE_Y, layout.hoistTop, 1);
      hoist.setCage(baseY);
    }
    if (!layout.solo) {
      layout.surveyor.show();
      layout.surveyor.place(layout.stand.x, SITE_Y, layout.stand.z, layout.stand.heading);
    }
    this.floorsDone = floorsUp(layout, progress);
    this.level = levelFor(layout, progress);
    this.climb = null;
    this.poseCrew(layout);
    this.ensureRunning();
    this.scene.requestRender();
  }

  private revealY(layout: SiteLayout): number {
    return Math.min(layout.top, Math.max(layout.baseY, this.host.nowY()));
  }

  private hideCoveredRings(reveal: number): void {
    const layout = this.layout!;
    while (this.ringsHidden < layout.floors && ringY(layout, this.ringsHidden) + BEAM_SIZE / 2 <= reveal) {
      this.kit.props.hideRing(this.ringsHidden++);
    }
  }

  private ensureRunning(): void {
    if (this.running) return;
    this.running = true;
    this.host.animate(this.frame);
  }

  private readonly frame = (dt: number): boolean => {
    const step = dt * this.host.speed();
    if (this.holders === 0 && this.layout) this.work(this.layout, step);
    const dusty = this.kit.update(step);
    const keep = this.holders > 0 || this.layout !== null || dusty;
    if (!keep) this.running = false;
    return keep;
  };

  /** One frame of work while the block's time runs. */
  private work(layout: SiteLayout, dt: number): void {
    const { props, dust } = this.kit;
    this.elapsed += dt;
    const reveal = this.revealY(layout);
    const progress = (reveal - layout.baseY) / layout.height;
    // The facade retires the frame it covers.
    props.setColumns(Math.min(reveal, layout.top), layout.top);
    this.hideCoveredRings(reveal);
    const floors = floorsUp(layout, progress);
    if (floors > this.floorsDone) {
      const { rng } = layout;
      dust.puff(new THREE.Vector3((rng() - 0.5) * 2, layout.baseY + floors * layout.floorHeight, 2.25), rng, 24, 0.5);
    }
    this.floorsDone = floors;
    const level = levelFor(layout, progress);
    if (level !== this.level) {
      this.climb = { from: this.level, elapsed: 0 };
      this.level = level;
    }
    if (this.climb) {
      this.climb.elapsed += dt;
      if (this.climb.elapsed >= CLIMB_SECONDS) this.climb = null;
    }
    this.poseCrew(layout);
  }

  /** The crew hammers on the planks at the facade's level, climbing when it moves up, and the surveyor watches. */
  private poseCrew(layout: SiteLayout): void {
    const { scaffold } = this.kit;
    layout.scaffolders.forEach((worker, j) => {
      const [face, along] = SCAFFOLD_SPOTS[j]!;
      const spot = scaffold.standPoint(face, this.level, along);
      worker.show();
      if (this.climb) {
        const from = scaffold.standPoint(face, this.climb.from, along);
        const t = easeInOutCubic(Math.min(1, this.climb.elapsed / CLIMB_SECONDS));
        worker.place(spot.x, from.y + (spot.y - from.y) * t, spot.z, spot.heading);
        worker.setAnimationAt('walk', this.elapsed);
      } else {
        worker.place(spot.x, spot.y, spot.z, spot.heading);
        // Each worker keeps their own rhythm.
        worker.setAnimationAt('hammer', this.elapsed + 0.2 * j);
      }
    });
    if (!layout.solo) layout.surveyor.setAnimationAt('survey', this.elapsed);
  }
}

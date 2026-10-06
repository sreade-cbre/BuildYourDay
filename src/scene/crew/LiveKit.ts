import * as THREE from 'three';
import { HOIST } from './Crew';
import { Dust } from './Dust';
import { GuardRail } from './GuardRail';
import { Hoist } from './Hoist';
import { SiteProps } from './props';
import { Scaffold } from './Scaffold';
import { Sparks } from './Sparks';
import { FlatbedTruck, Stockyard } from './Stockyard';
import { Worker } from './Worker';

// The pieces of one construction site: its workers, scaffold, guard rail,
// hoist, props, and dust. The crew's own set serves the short jobs. The block
// under way has a second set, which stands for as long as the block's time
// runs, while other jobs borrow the crane and the machines for their edits.

export interface SiteKit {
  readonly workers: readonly Worker[];
  readonly scaffold: Scaffold;
  readonly rail: GuardRail;
  readonly hoist: Hoist;
  readonly props: SiteProps;
  readonly dust: Dust;
  /** Clears the site's pieces away. */
  park(): void;
}

/** The most workers the block under way puts on site. */
const LIVE_WORKERS = 10;
/** How fast the crew turns: most of the way round in about a fifth of a second. */
const TURN_EASE = 10;

export class LiveKit implements SiteKit {
  readonly root = new THREE.Group();
  readonly workers: Worker[] = [];
  readonly scaffold = new Scaffold();
  readonly rail = new GuardRail();
  readonly hoist = new Hoist(HOIST.x, HOIST.mastZ, HOIST.cageZ);
  readonly props = new SiteProps();
  readonly dust = new Dust();
  /** Welding sparks where the crew fixes pieces. */
  readonly sparks = new Sparks();
  /** The materials waiting on the depot, which the crane lifts from. */
  readonly stockyard = new Stockyard();
  /** The truck that restocks the yard. */
  readonly flatbed = new FlatbedTruck();

  constructor() {
    this.root.name = 'live-site';
    for (let i = 0; i < LIVE_WORKERS; i++) {
      const worker = new Worker(`live-worker-${i}`);
      // Turning about takes a moment, as it does for anyone.
      worker.turnEase = TURN_EASE;
      this.workers.push(worker);
      this.root.add(worker.root);
    }
    this.root.add(this.scaffold.root, this.rail.root, this.hoist.root, this.props.root, this.dust.root, this.sparks.root, this.stockyard.root, this.flatbed.root);
    this.park();
  }

  /** Clears the site: workers gone, scaffold, rail, and hoist down, props and dust cleared. */
  park(): void {
    for (const worker of this.workers) worker.hide();
    this.scaffold.hide();
    this.rail.hide();
    this.hoist.hide();
    this.props.reset();
    this.dust.clear();
    this.sparks.clear();
    this.flatbed.hide();
    this.stockyard.fill();
  }

  /** Per frame: worker poses, dust, and sparks. Returns true while any are in the air. */
  update(dt: number): boolean {
    for (const worker of this.workers) worker.update(dt);
    const dusty = this.dust.update(dt);
    return this.sparks.update(dt) || dusty;
  }
}

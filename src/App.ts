import { sampleBlocks } from './core/defaults';
import { totals, towerHeight } from './core/layout';
import { Store, type StoreEvent } from './core/store';
import { formatDateTitle, formatDurationLong, todayIso } from './core/time';
import { DEFAULT_AZIMUTH, SceneRoot } from './scene/SceneRoot';
import { Ground } from './scene/Ground';
import { Tower } from './scene/Tower';
import { Overlay } from './ui/Overlay';

// Wires the store, the scene, and the overlay together.

export interface AppHosts {
  scene: HTMLElement;
  overlay: HTMLElement;
}

export class App {
  readonly store: Store;
  readonly sceneRoot: SceneRoot;
  readonly ground: Ground;
  readonly tower: Tower;
  readonly overlay: Overlay;

  constructor(hosts: AppHosts) {
    this.store = new Store({ today: todayIso() });

    // No persistence or editing until M2, so development builds open on the
    // sample day from spec section 20.
    if (import.meta.env.DEV && this.store.blocks.length === 0) {
      this.store.addBlocks(this.store.viewedDate, sampleBlocks(this.store.settings.categories), 'sample');
    }

    const { settings } = this.store;
    this.sceneRoot = new SceneRoot(hosts.scene, settings.theme);
    this.ground = new Ground({ x: -3.6, z: 4.0, facing: DEFAULT_AZIMUTH });
    this.ground.setTheme(settings.theme);
    this.ground.setPaletteMode(settings.paletteMode);
    this.ground.setDate(this.store.viewedDate);
    this.sceneRoot.scene.add(this.ground.root);

    this.tower = new Tower(this.store, this.ground);
    this.tower.onChange = () => this.sceneRoot.requestRender();
    this.sceneRoot.scene.add(this.tower.root);
    this.sceneRoot.onBeforeRender((camera) => this.tower.updateForCamera(camera));
    this.sceneRoot.onViewChange(() => this.tower.setLabelSpace(this.sceneRoot.labelSpace));
    this.sceneRoot.frameTower(towerHeight(settings), false);

    this.overlay = new Overlay(hosts.overlay, this.store);

    this.store.subscribe((event) => this.onStoreEvent(event));
    this.describeCanvas();
  }

  private onStoreEvent(event: StoreEvent): void {
    if (event.type === 'viewedDate' || event.type === 'loaded') this.ground.setDate(this.store.viewedDate);
    this.describeCanvas();
    this.sceneRoot.requestRender();
  }

  /** Screen reader summary of the tower (spec section 17). */
  private describeCanvas(): void {
    const blocks = this.store.blocks;
    const planned = totals(blocks, this.store.settings).plannedMinutes;
    const count = `${blocks.length} ${blocks.length === 1 ? 'block' : 'blocks'}`;
    const label = `Time tower for ${formatDateTitle(this.store.viewedDate)}. ${count}, ${formatDurationLong(planned)} planned.`;
    this.sceneRoot.canvas.setAttribute('aria-label', label);
  }
}

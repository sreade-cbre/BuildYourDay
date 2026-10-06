import * as THREE from 'three';
import { Director, type Job } from './anim/Director';
import { fadeInJob } from './anim/jobs/build';
import { demolishJob } from './anim/jobs/demolish';
import { previewJob } from './anim/jobs/preview';
import { relocateJob } from './anim/jobs/relocate';
import { resizeJob } from './anim/jobs/resize';
import type { JobScene } from './anim/jobs/scene';
import { settleJob } from './anim/jobs/settle';
import { vanishJob } from './anim/jobs/vanish';
import { LiveSite } from './anim/live';
import { planJobs, type JobPlan } from './anim/plan';
import { LIMITS, sampleBlocks } from './core/defaults';
import { UNITS_PER_MINUTE, defaultNewRange, gapDraftRange, minutesToY, resizeLimits, totals, towerHeight } from './core/layout';
import type { Block, BlockId, CategoryId, Settings, TimeRange } from './core/model';
import {
  PERSIST_MESSAGES,
  Saver,
  exportFileName,
  parseImport,
  readSave,
  serializeExport,
  usableStorage,
  type StorageLike,
} from './core/persist';
import { nextChange, type Clock } from './core/progress';
import { MESSAGES, Store, isMeetingBlock, type BlockPatch, type StoreEvent } from './core/store';
import { addDays, ceilToSlot, clamp, floorToSlot, formatDateTitle, formatDurationLong, formatTimeShort, nowMinutes, todayIso } from './core/time';
import { Crew } from './scene/crew/Crew';
import { LiveKit } from './scene/crew/LiveKit';
import { Ground } from './scene/Ground';
import { Holds } from './scene/holds';
import { materials } from './scene/materials';
import { Picker } from './scene/Picker';
import { DEFAULT_AZIMUTH, SceneRoot } from './scene/SceneRoot';
import { NowRing } from './scene/NowRing';
import { OutlookSync } from './outlook/OutlookSync';
import { Tower } from './scene/Tower';
import { DebugPanel } from './ui/DebugPanel';
import { Dialog, choose } from './ui/Dialog';
import { h } from './ui/dom';
import { Inspector } from './ui/Inspector';
import { Legend } from './ui/Legend';
import { ListView, type ListActions } from './ui/ListView';
import { DAY_FULL_MESSAGE, Overlay, type OutlookAlert } from './ui/Overlay';
import { SettingsModal } from './ui/SettingsModal';
import { installShortcuts } from './ui/shortcuts';
import { UiState, type BlockDraftState, type UiSnapshot } from './ui/state';
import { Toasts } from './ui/Toasts';

// Wires the store, persistence, the scene, and the overlay together, and owns
// the actions every entry point shares: the Add button, a gap click, and the
// N key all start a new block the same way.

export interface AppHosts {
  /** Where the 3D scene goes; null when WebGL2 is unavailable. */
  scene: HTMLElement | null;
  overlay: HTMLElement;
  /** Where the list view lives when there is no scene. */
  list: HTMLElement | null;
}

interface SceneParts {
  root: SceneRoot;
  nowRing: NowRing;
  ground: Ground;
  tower: Tower;
  picker: Picker;
  crew: Crew;
  holds: Holds;
  director: Director;
  jobs: JobScene;
  /** The site of the block under way. */
  live: LiveSite;
}

const GAP_TOO_SHORT = 'That gap is shorter than one slot, so pick a longer gap.';
/**
 * How often the now ring, weathering, and the date catch up with the clock
 * (spec 8.6). A block's start and end also wake the app exactly on time, and
 * the site of the block under way follows the clock every frame.
 */
const CLOCK_MS = 30_000;
/** Quiet time before the camera starts its idle orbit (spec 8.7). */
const IDLE_ORBIT_MS = 20_000;
const IDLE_ORBIT_SPEED = 0.4;
/** Where the side plot for the animation speed preview stands, clear of the main site (spec 14). */
const SIDE_SITE = new THREE.Vector3(-26, 0, 0);
const NO_WEBGL_NOTICE = 'This browser does not support WebGL2, so the day is shown as a list.';

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export class App {
  readonly store: Store;
  readonly ui = new UiState();
  readonly scene: SceneParts | null;
  readonly overlay: Overlay;
  readonly inspector: Inspector;
  readonly toasts: Toasts;
  /** Meetings from the user's Outlook calendar, once connected. */
  readonly outlook: OutlookSync;
  private readonly saver: Saver;
  private readonly overlayHost: HTMLElement;
  private readonly debug: DebugPanel | null;
  private readonly fileInput: HTMLInputElement;
  private readonly sampleButton: HTMLButtonElement | null = null;
  private listDialog: { dialog: Dialog; view: ListView } | null = null;
  private settingsModal: SettingsModal | null = null;
  private pulseRunning = false;
  private directorRunning = false;
  private ringRunning = false;
  /** The date the app last saw as today, to notice midnight. */
  private today = todayIso();
  private boundaryTimer = 0;
  private lastInput = performance.now();
  /** Whether the user has clicked, typed, or scrolled since the page opened. */
  private touched = false;
  private sideGround: Ground | null = null;

  constructor(hosts: AppHosts, storage: StorageLike | null) {
    const today = todayIso();
    const loaded = storage ? readSave(storage, today) : ({ kind: 'fresh' } as const);
    this.store = new Store({ today, save: loaded.kind === 'loaded' ? loaded.save : undefined });
    this.overlayHost = hosts.overlay;

    // Persistence: every committed change, debounced; settings previews never.
    this.saver = new Saver(storage, () => this.store.toSaveFile(), () => this.overlay.setStorageWarning(true));
    this.store.subscribe((event) => {
      if (!(event.type === 'settings' && event.preview)) this.saver.schedule();
    });
    window.addEventListener('pagehide', () => this.saver.flush());

    const settings = this.store.settings;
    document.documentElement.dataset.theme = settings.theme;
    this.scene = hosts.scene ? this.createScene(hosts.scene, settings) : null;

    this.toasts = new Toasts(hosts.overlay);
    this.overlay = new Overlay(
      hosts.overlay,
      this.store,
      {
        previousDay: () => this.shiftDay(-1),
        nextDay: () => this.shiftDay(1),
        today: () => this.goToToday(),
        addBlock: () => this.startNew(null),
        resetView: () => this.scene?.root.resetView(),
        openSettings: () => this.openSettings(),
        openListView: () => this.openListView(),
        copyPrevious: () => this.copyPrevious(),
        exportJson: () => this.exportJson(),
        importJson: () => this.importJson(),
        clearDay: () => this.clearDay(),
        skip: () => this.scene?.director.skip(),
      },
      todayIso,
      { scene: this.scene !== null },
    );
    this.inspector = new Inspector(hosts.overlay, this.store, this.ui, {
      build: (draft) => this.build(draft),
      updateDraft: (draft) => this.ui.update({ inspector: { mode: 'new', draft } }),
      previewTimes: (_id, range) => this.scene?.tower.setPreview(range ? { ghost: range } : null),
      commit: (id, patch) => this.commit(id, patch),
      nudge: (id, direction) => this.nudge(id, direction),
      demolish: (id) => this.demolish(id),
      close: () => this.select(null),
    });
    new Legend(hosts.overlay, this.store, this.ui, (id) => this.toggleHighlight(id));
    for (const type of ['pointerdown', 'keydown', 'wheel']) {
      window.addEventListener(type, () => (this.touched = true), { capture: true, passive: true });
    }
    this.outlook = new OutlookSync(this.store, storage, usableStorage(() => window.sessionStorage), {
      notify: (message, action) => this.toasts.show(message, action ? { action } : {}),
      showDetails: () => this.openSettings(),
      untouched: () => !this.touched && Dialog.openCount === 0,
    });
    this.outlook.subscribe(() => this.overlay.setOutlookAlert(this.outlookAlert()));
    this.overlay.setOutlookAlert(this.outlookAlert());
    this.debug = this.scene ? new DebugPanel(hosts.overlay) : null;

    this.fileInput = h('input', { class: 'visually-hidden', attrs: { type: 'file', accept: 'application/json,.json', tabindex: '-1', 'aria-hidden': 'true' } });
    this.fileInput.addEventListener('change', () => void this.readImportFile());
    hosts.overlay.append(this.fileInput);

    if (hosts.list) {
      const view = new ListView(this.store, this.listActions(), { notice: NO_WEBGL_NOTICE });
      hosts.list.append(view.element);
    }
    if (import.meta.env.DEV && this.scene) {
      this.sampleButton = h('button', { class: 'button button--primary sample-button', text: 'Load sample day', attrs: { type: 'button' } });
      this.sampleButton.addEventListener('click', () => this.loadSample());
      hosts.overlay.append(this.sampleButton);
    }

    this.store.subscribe((event) => this.onStoreEvent(event));
    this.ui.subscribe((state, previous) => this.onUiChange(state, previous));
    installShortcuts({
      newBlock: () => this.startNew(null),
      confirm: () => {
        const state = this.ui.state.inspector;
        if (state.mode === 'new') this.build(state.draft);
      },
      escape: () => this.escape(),
      deleteSelected: () => {
        const id = this.ui.state.selectedId;
        if (id) this.demolish(id);
      },
      selectStep: (direction) => this.selectStep(direction),
      previousDay: () => this.shiftDay(-1),
      nextDay: () => this.shiftDay(1),
      today: () => this.goToToday(),
      resetView: () => this.scene?.root.resetView(),
      openSettings: () => this.openSettings(),
      toggleDebug: () => {
        this.debug?.toggle();
        this.scene?.root.requestRender();
      },
    });

    if (!storage) this.overlay.setStorageWarning(true);
    if (loaded.kind === 'unreadable') this.toasts.show(PERSIST_MESSAGES.unreadable);
    this.describeCanvas();
    this.updateSampleButton();
    this.updateNow(false);
    this.startClock();
    this.watchForIdle();
  }

  // Time passing

  /** Catches up with the clock every 30 seconds and when the tab comes back (spec 8.6). */
  private startClock(): void {
    window.setInterval(() => this.tick(), CLOCK_MS);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.tick();
    });
    window.addEventListener('focus', () => this.tick());
  }

  /**
   * After local midnight the Today button returns and a toast offers the new
   * day, but the viewed date stays put (spec 18).
   */
  private tick(): void {
    const today = todayIso();
    if (today !== this.today) {
      this.today = today;
      this.overlay.render();
      this.toasts.show(`It is now ${formatDateTitle(today)}.`, { action: { label: 'Go to today', run: () => this.goToToday() } });
    }
    this.updateNow(true);
  }

  /**
   * Places the now ring, shown only on today and inside the day window (spec
   * 8.6), and tells the tower the time, which decides what is planned, under
   * way, and done, and what is weathered (spec 11.4). `animate` tweens the
   * ring and lets newly done blocks fade; after a day change or a load
   * everything lands at once.
   */
  private updateNow(animate: boolean): void {
    const scene = this.scene;
    if (!scene) return;
    const settings = this.store.settings;
    const clock: Clock = { today: todayIso(), minutes: nowMinutes() };
    const { minutes } = clock;
    const viewingToday = this.store.viewedDate === clock.today;
    if (viewingToday && minutes >= settings.dayStart && minutes <= settings.dayEnd) {
      const label = `now ${formatTimeShort(Math.floor(minutes), settings)}`;
      scene.nowRing.show(minutesToY(minutes, settings), label, animate && !this.reducedMotion());
    } else {
      scene.nowRing.hide();
    }
    scene.tower.setNowY(scene.nowRing.y);
    scene.tower.setNowTag(scene.nowRing.tag);
    scene.tower.setClock(clock, animate);
    scene.live.sync();
    this.scheduleBoundary();
    if (!this.ringRunning) {
      this.ringRunning = true;
      scene.root.addAnimator((dt) => {
        const moving = scene.nowRing.step(dt);
        scene.tower.setNowY(scene.nowRing.y);
        if (!moving) this.ringRunning = false;
        return moving;
      });
    }
    scene.root.requestRender();
  }

  /** Wakes the app exactly when the next block on today starts or ends. */
  private scheduleBoundary(): void {
    window.clearTimeout(this.boundaryTimer);
    if (this.store.viewedDate !== todayIso()) return;
    const minutes = nowMinutes();
    const next = nextChange(this.store.blocks, minutes);
    if (next === null) return;
    // A hair past the minute, so the clock reads the block as started or done.
    this.boundaryTimer = window.setTimeout(() => this.tick(), (next - minutes) * 60_000 + 50);
  }

  /**
   * Idle orbit (spec 8.7): after 20 s with no pointer, wheel, or key input the
   * camera slowly circles the tower. Any input stops it. It waits while a job
   * plays or a dialog is open, and never runs under reduced motion.
   */
  private watchForIdle(): void {
    const touch = () => {
      this.lastInput = performance.now();
      if (this.scene?.root.controls.autoRotate) this.setOrbit(false);
    };
    for (const type of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart']) {
      window.addEventListener(type, touch, { capture: true, passive: true });
    }
    window.setInterval(() => {
      const scene = this.scene;
      if (!scene) return;
      const allowed =
        this.store.settings.idleOrbit &&
        !this.reducedMotion() &&
        !scene.director.isBusy &&
        !scene.picker.dragging &&
        Dialog.openCount === 0 &&
        !document.hidden;
      this.setOrbit(allowed && performance.now() - this.lastInput >= IDLE_ORBIT_MS);
    }, 1000);
  }

  private setOrbit(on: boolean): void {
    const root = this.scene?.root;
    if (!root || root.controls.autoRotate === on) return;
    root.controls.autoRotateSpeed = IDLE_ORBIT_SPEED;
    root.controls.autoRotate = on;
    root.requestRender();
  }

  // Scene

  private createScene(host: HTMLElement, settings: Readonly<Settings>): SceneParts {
    const root = new SceneRoot(host, settings.theme);
    const ground = new Ground({ x: -3.6, z: 4.0, facing: DEFAULT_AZIMUTH });
    ground.setTheme(settings.theme);
    ground.setDate(this.store.viewedDate);
    root.scene.add(ground.root);

    const holds = new Holds();
    const director = new Director(() => this.store.settings.animationSpeed);
    const crew = new Crew();
    root.scene.add(crew.root);
    // The site of the block under way stands apart from the crew, which
    // moves to the side plot for the speed preview.
    const liveKit = new LiveKit();
    root.scene.add(liveKit.root);
    materials.setPaletteMode(settings.paletteMode);
    materials.setTheme(settings.theme);
    let tower: Tower | null = null;
    const jobs: JobScene = {
      crew,
      ground,
      holds,
      get tower(): Tower {
        return tower!;
      },
      settings: () => this.store.settings,
      blocks: () => this.store.blocks,
      stateOf: (range) => tower!.stateOf(range),
      token: (block) => this.store.categoryFor(block).color,
      moreQueued: () => director.queued > 0,
      keepInFrame: (topY) => this.keepInFrame(topY),
      requestRender: () => root.requestRender(),
    };
    const live = new LiveSite(jobs, liveKit, {
      calm: () => this.reducedMotion(),
      speed: () => this.store.settings.animationSpeed,
      animate: (frame) => root.addAnimator(frame),
      borrowed: () => {
        const borrows = director.current?.borrows ?? [];
        return { crane: borrows.includes('crane'), machines: borrows.includes('machines') };
      },
      minutes: () => nowMinutes(),
    });
    // Jobs are planned before the Tower hears of a change, so a new block is
    // already held when the Tower first draws it.
    this.store.subscribe((event) => this.planJobs(event, director, jobs, live));
    director.onChange(() => this.onDirectorChange());
    // With the site quiet again, the crew goes home and the mast fits the tower.
    director.onIdle(() => {
      crew.setTowerTop(tower!.topY);
      crew.park();
      crew.settleMast();
      root.requestRender();
    });
    root.onShow(() => director.finishAll());

    tower = new Tower(this.store, ground, holds);
    tower.onChange = () => root.requestRender();
    tower.animate = (animator) => root.addAnimator(animator);
    const nowRing = new NowRing();
    root.scene.add(nowRing.root);
    root.scene.add(tower.root);
    root.onBeforeRender((camera) => {
      tower.updateForCamera(camera);
      nowRing.updateForCamera(camera);
      this.afterFrame();
    });
    root.onViewChange(() => {
      tower.setLabelSpace(root.labelSpace);
      nowRing.setWorldScale(root.labelSpace.unitsPerPixel);
    });
    nowRing.setWorldScale(root.labelSpace.unitsPerPixel);
    root.frameTower(towerHeight(settings), false);

    const picker = new Picker(root, tower, ground, this.store, {
      selectedId: () => this.ui.state.selectedId,
      select: (id) => this.select(id),
      hover: ({ blockId, gapStart }) => this.ui.update({ hoveredId: blockId, hoveredGapStart: gapStart }),
      startNew: (gap) => this.startNew(gap),
      preview: (preview) => tower.setPreview(preview),
      commit: (id, range) => {
        const error = this.commit(id, range);
        if (error) this.toasts.show(error);
      },
      stepEnd: (id, slots) => this.stepEnd(id, slots),
    });
    crew.setTowerTop(tower.topY);
    crew.park();
    crew.settleMast();
    root.warmUp();
    return { root, nowRing, ground, tower, picker, crew, holds, director, jobs, live };
  }

  // Animation jobs

  /**
   * Turns store changes into jobs (spec 9.2 and 9.6); see plan.ts. Under
   * reduced motion each job plays its short version (spec 9.7).
   */
  private planJobs(event: StoreEvent, director: Director, jobs: JobScene, live: LiveSite): void {
    const tower = jobs.tower;
    const plan = planJobs(event, this.store.viewedDate, this.ui.state.selectedId, {
      stateOf: (range) => tower.stateOf(range),
      builtTo: (block) => live.builtTo(block),
    });
    if (plan.finish) director.finishAll();
    const calm = this.reducedMotion();
    for (const job of plan.jobs) {
      director.enqueue(this.makeJob(job, jobs, calm));
    }
    if (director.isBusy) this.runDirector();
  }

  private makeJob(plan: JobPlan, scene: JobScene, calm: boolean): Job {
    switch (plan.kind) {
      case 'appear': {
        const job = fadeInJob(scene, plan.block);
        job.speed = plan.speed;
        return job;
      }
      case 'demolish':
        return demolishJob(scene, plan.block, calm);
      case 'vanish':
        return vanishJob(scene, plan.block);
      case 'resize':
        return resizeJob(scene, plan.move, calm || plan.calm === true);
      case 'relocate':
        return relocateJob(scene, plan.move, plan.settles, calm);
      case 'settle':
        return settleJob(scene, plan.moves, calm || plan.calm === true);
    }
  }

  /** Ticks the Director every frame while it has work or dust is still settling. */
  private runDirector(): void {
    const scene = this.scene;
    if (!scene || this.directorRunning) return;
    this.directorRunning = true;
    scene.root.addAnimator((dt) => {
      scene.director.tick(dt);
      const dusty = scene.crew.update(dt * this.store.settings.animationSpeed);
      const busy = scene.director.isBusy || dusty;
      if (!busy) this.directorRunning = false;
      return busy;
    });
  }

  private onDirectorChange(): void {
    const label = this.scene?.director.current?.label;
    this.overlay?.setStatus(label ? label : null);
    // Builds are watched from a still camera (spec 8.7).
    if (this.scene?.director.isBusy) this.setOrbit(false);
  }

  /** Brings the camera back to the standard framing if a new roof would be out of view (spec 9.5). */
  private keepInFrame(topY: number): void {
    const root = this.scene?.root;
    if (!root) return;
    const corners = [-2, 2].flatMap((x) => [-2, 2].map((z) => new THREE.Vector3(x, topY, z)));
    if (!root.pointsInView(corners)) root.frameTower(towerHeight(this.store.settings), true, 1.0);
  }

  /** Runs before each frame renders: keeps overlay pieces tied to the scene current. */
  private afterFrame(): void {
    const scene = this.scene;
    if (!scene) return;
    if (this.debug?.visible) {
      const info = scene.root.renderer.info;
      this.debug.update({
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        calls: info.render.calls,
        triangles: info.render.triangles,
        materials: materials.count,
      });
    }
    if (this.sampleButton && !this.sampleButton.hidden) {
      const point = scene.root.toClient(scene.ground.plotCenter);
      this.sampleButton.style.left = `${point.x}px`;
      this.sampleButton.style.top = `${point.y}px`;
    }
  }

  private reducedMotion(): boolean {
    const setting = this.store.settings.reducedMotion;
    return setting === 'on' || (setting === 'system' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // Store and UI events

  private onStoreEvent(event: StoreEvent): void {
    switch (event.type) {
      case 'viewedDate':
        this.ui.update({ selectedId: null, hoveredId: null, hoveredGapStart: null, inspector: { mode: 'closed' } });
        this.scene?.tower.setPreview(null);
        this.scene?.ground.setDate(this.store.viewedDate);
        this.updateNow(false);
        // The new day appears at once, then takes on its colors (spec 12.7).
        this.scene?.tower.playSunrise();
        break;
      case 'settings':
        this.applySettings(event.previous, event.current);
        // The ring moves with the tower when the day start changes, and
        // turning weathering on fades the done blocks.
        this.updateNow(true);
        break;
      case 'loaded':
        this.applySettings(null, this.store.settings);
        this.scene?.ground.setDate(this.store.viewedDate);
        this.dropMissingSelection();
        this.updateNow(false);
        break;
      case 'blocks':
        if (event.date === this.store.viewedDate) this.dropMissingSelection();
        break;
    }
    const scene = this.scene;
    if (scene && !scene.director.isBusy) {
      scene.crew.setTowerTop(scene.tower.topY);
      scene.crew.park();
      scene.crew.settleMast();
    }
    // The site of the block under way follows the data, the day, and the settings.
    scene?.live.sync();
    if (event.type !== 'settings' || !event.preview) this.scheduleBoundary();
    this.describeCanvas();
    this.updateSampleButton();
    this.scene?.root.requestRender();
  }

  private applySettings(previous: Readonly<Settings> | null, current: Readonly<Settings>): void {
    document.documentElement.dataset.reducedMotion = String(this.reducedMotion());
    if (!previous || previous.theme !== current.theme) this.applyTheme(current.theme, previous !== null);
    const scene = this.scene;
    if (!scene) return;
    if (!previous || previous.paletteMode !== current.paletteMode) materials.setPaletteMode(current.paletteMode);
    if (!previous || previous.dayStart !== current.dayStart || previous.dayEnd !== current.dayEnd) {
      // A new day window re-lays out the tower (done by Tower) and reframes the camera.
      const animate = previous !== null && !this.reducedMotion();
      scene.root.frameTower(towerHeight(current), animate);
      // Every block and gap slides to its new height over 0.6 s (spec 14).
      if (animate && previous.dayStart !== current.dayStart) {
        scene.tower.slideFrom((current.dayStart - previous.dayStart) * UNITS_PER_MINUTE);
      }
    }
  }

  private applyTheme(theme: Settings['theme'], animate: boolean): void {
    document.documentElement.dataset.theme = theme;
    const scene = this.scene;
    if (!scene) return;
    materials.setTheme(theme);
    scene.tower.sync();
    const background = SceneRoot.backgroundFor(theme);
    const [sky, fog] = scene.root.themeColors;
    scene.root.tweenColors(
      [
        [sky!, background],
        [fog!, background],
        [scene.ground.groundColor, Ground.groundFor(theme)],
        [scene.ground.lawnColor, Ground.lawnFor(theme)],
      ],
      animate && !this.reducedMotion() ? 0.4 : 0,
    );
  }

  private dropMissingSelection(): void {
    const { selectedId, inspector } = this.ui.state;
    const editing = inspector.mode === 'edit' ? inspector.id : null;
    const date = this.store.viewedDate;
    const missing = (id: BlockId | null) => id !== null && !this.store.findBlock(date, id);
    if (missing(selectedId) || missing(editing)) this.select(null);
  }

  private onUiChange(state: UiSnapshot, previous: UiSnapshot): void {
    const scene = this.scene;
    if (!scene) return;
    scene.tower.setDecor({
      selectedId: state.selectedId,
      hoveredId: state.hoveredId,
      hoveredGapStart: state.hoveredGapStart,
      highlightedCategory: state.highlightedCategory,
    });
    if (state.inspector !== previous.inspector) {
      // A new block draft shows as a ghost where it will go.
      if (state.inspector.mode === 'new') {
        const { start, end } = state.inspector.draft;
        scene.tower.setPreview({ ghost: { start, end } });
      } else if (previous.inspector.mode === 'new') {
        scene.tower.setPreview(null);
      }
    }
    if (state.selectedId && state.selectedId !== previous.selectedId) this.startPulse();
  }

  /** The selection outline pulses between 0.5 and 0.9 opacity every 1.5 s (spec 10.5). */
  private startPulse(): void {
    const scene = this.scene;
    if (!scene || this.pulseRunning) return;
    this.pulseRunning = true;
    let elapsed = 0;
    scene.root.addAnimator((dt) => {
      if (this.ui.state.selectedId === null || this.reducedMotion()) {
        scene.tower.setOutlineOpacity(0.75);
        this.pulseRunning = false;
        return false;
      }
      elapsed += dt;
      scene.tower.setOutlineOpacity(0.7 + 0.2 * Math.sin((elapsed / 1.5) * Math.PI * 2));
      return true;
    });
  }

  private describeCanvas(): void {
    if (!this.scene) return;
    const blocks = this.store.blocks;
    const planned = totals(blocks, this.store.settings).plannedMinutes;
    const label = `Time tower for ${formatDateTitle(this.store.viewedDate)}. ${plural(blocks.length, 'block', 'blocks')}, ${formatDurationLong(planned)} planned.`;
    this.scene.root.canvas.setAttribute('aria-label', label);
  }

  // Selection and the inspector

  select(id: BlockId | null): void {
    if (id === null) this.ui.update({ selectedId: null, inspector: { mode: 'closed' } });
    else this.ui.update({ selectedId: id, inspector: { mode: 'edit', id } });
  }

  private selectStep(direction: 1 | -1): void {
    const blocks = this.store.blocks;
    if (blocks.length === 0) return;
    const index = blocks.findIndex((b) => b.id === this.ui.state.selectedId);
    const next = index < 0 ? (direction > 0 ? blocks[0] : blocks[blocks.length - 1]) : blocks[index + direction];
    if (next) this.select(next.id);
  }

  /**
   * Opens the inspector for a new block (spec 12.1): from a clicked gap,
   * capped at two hours, or above the last block for an hour.
   */
  startNew(gap: TimeRange | null): void {
    const { settings } = this.store;
    const blocks = this.store.blocks;
    if (blocks.length >= LIMITS.maxBlocksPerDay) {
      this.toasts.show(MESSAGES.dayFull);
      return;
    }
    const range = gap ? gapDraftRange(gap, settings) : defaultNewRange(blocks, settings);
    if (!range) {
      this.toasts.show(gap ? GAP_TOO_SHORT : DAY_FULL_MESSAGE);
      return;
    }
    const draft: BlockDraftState = { ...range, title: '', categoryId: settings.categories[0]!.id };
    this.ui.update({ selectedId: null, inspector: { mode: 'new', draft } });
  }

  private build(draft: BlockDraftState): string | null {
    const result = this.store.addBlock(this.store.viewedDate, {
      start: draft.start,
      end: draft.end,
      title: draft.title,
      categoryId: draft.categoryId,
    });
    if (!result.ok) return result.error;
    this.select(result.value.id);
    return null;
  }

  private commit(id: BlockId, patch: BlockPatch): string | null {
    const result = this.store.updateBlock(this.store.viewedDate, id, patch);
    return result.ok ? null : result.error;
  }

  private nudge(id: BlockId, direction: -1 | 1): string | null {
    const result = this.store.nudgeBlock(this.store.viewedDate, id, direction);
    return result.ok ? null : result.error;
  }

  /** Shift + wheel: moves the end along the slot grid, stopping at neighbors. */
  private stepEnd(id: BlockId, slots: number): void {
    const block = this.store.findBlock(this.store.viewedDate, id);
    if (!block) return;
    const { settings } = this.store;
    const slot = settings.slotMinutes;
    const limits = resizeLimits(this.store.blocks, block, settings);
    const low = ceilToSlot(block.start + Math.min(slot, block.end - block.start), slot);
    const high = Math.max(low, floorToSlot(limits.maxEnd, slot));
    const base = slots > 0 ? floorToSlot(block.end, slot) : ceilToSlot(block.end, slot);
    const end = clamp(base + slots * slot, low, high);
    if (end !== block.end) {
      const error = this.commit(id, { end });
      if (error) this.toasts.show(error);
    }
  }

  demolish(id: BlockId): void {
    const block = this.store.findBlock(this.store.viewedDate, id);
    if (!block) return;
    const result = this.store.deleteBlock(this.store.viewedDate, id);
    if (!result.ok) {
      this.toasts.show(result.error);
      return;
    }
    this.select(null);
    this.toasts.show(`Demolished ${block.title || 'Untitled'}.`, { action: { label: 'Undo', run: () => this.undo() } });
  }

  private undo(): void {
    const result = this.store.undoDelete();
    if (!result.ok) {
      this.toasts.show(result.error);
      return;
    }
    if (result.value.date !== this.store.viewedDate) this.store.setViewedDate(result.value.date);
    if (result.value.blocks.length === 1) this.select(result.value.blocks[0]!.id);
  }

  private toggleHighlight(id: CategoryId): void {
    this.ui.update({ highlightedCategory: this.ui.state.highlightedCategory === id ? null : id });
  }

  private escape(): boolean {
    if (this.scene?.picker.cancelDrag()) return true;
    if (this.scene?.director.isBusy) {
      this.scene.director.skip();
      return true;
    }
    if (this.overlay.menuOpen) {
      this.overlay.closeMenu(true);
      return true;
    }
    const state = this.ui.state;
    if (state.inspector.mode !== 'closed' || state.selectedId) {
      this.select(null);
      return true;
    }
    if (state.highlightedCategory) {
      this.ui.update({ highlightedCategory: null });
      return true;
    }
    return false;
  }

  // Days

  private shiftDay(days: number): void {
    this.store.setViewedDate(addDays(this.store.viewedDate, days));
  }

  private goToToday(): void {
    this.store.setViewedDate(todayIso());
  }

  /** Clears the user's own blocks; meetings from Outlook stay. */
  private clearDay(): void {
    const result = this.store.clearDay(this.store.viewedDate);
    if (!result.ok || result.value === 0) return;
    this.select(null);
    this.toasts.show(`Cleared ${plural(result.value, 'block', 'blocks')}.`, { action: { label: 'Undo', run: () => this.undo() } });
  }

  private copyPrevious(): void {
    const from = this.store.previousPlannedDate(this.store.viewedDate);
    if (!from || this.store.blocks.some((b) => !isMeetingBlock(b))) return;
    const result = this.store.copyDay(from, this.store.viewedDate);
    if (!result.ok) {
      this.toasts.show(result.error);
      return;
    }
    const copied = `Copied ${plural(result.value.length, 'block', 'blocks')} from ${formatDateTitle(from)}.`;
    const left = this.store.blocksFor(from).filter((b) => !isMeetingBlock(b)).length - result.value.length;
    this.toasts.show(left > 0 ? `${copied} ${left === 1 ? 'One overlapped a meeting, so it was' : `${left} overlapped meetings, so they were`} left out.` : copied);
  }

  // Outlook

  /** The chip for an Outlook connection that needs the user, if it does. */
  private outlookAlert(): OutlookAlert | null {
    const { connection, problem, needsUser } = this.outlook.status;
    if (connection === 'expired') {
      return {
        text: 'Outlook sign-in has expired',
        action: {
          label: 'Reconnect',
          run: () =>
            void this.outlook.connect().then((error) => {
              if (error) this.toasts.show(error);
            }),
        },
      };
    }
    if (connection === 'on' && problem && needsUser) {
      return { text: 'Meetings from Outlook are not updating', action: { label: 'Details', run: () => this.openSettings() } };
    }
    return null;
  }

  private loadSample(): void {
    const today = todayIso();
    this.store.setViewedDate(today);
    const result = this.store.addBlocks(today, sampleBlocks(this.store.settings.categories), 'sample');
    if (!result.ok) this.toasts.show(result.error);
  }

  private updateSampleButton(): void {
    if (!this.sampleButton) return;
    this.sampleButton.hidden = !this.store.isEmpty;
    this.scene?.root.requestRender();
  }

  // Data

  private exportJson(): void {
    const name = exportFileName(todayIso());
    const blob = new Blob([serializeExport(this.store.toSaveFile())], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = h('a', { attrs: { href: url, download: name } });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.toasts.show(`Exported ${name}.`);
  }

  private importJson(): void {
    this.fileInput.value = '';
    this.fileInput.click();
  }

  private async readImportFile(): Promise<void> {
    const file = this.fileInput.files?.[0];
    if (!file) return;
    await this.importText(await file.text());
  }

  /** Imports a JSON save after asking whether to replace or merge (spec 15.3). */
  async importText(text: string, choice?: 'replace' | 'merge'): Promise<void> {
    const parsed = parseImport(text, todayIso());
    if (!parsed.ok) {
      this.toasts.show(parsed.error);
      return;
    }
    const decision =
      choice ??
      (await choose(this.overlayHost, 'Import data', 'Replace all data or merge days?', [
        { value: 'cancel' as const, label: 'Cancel' },
        { value: 'merge' as const, label: 'Merge days' },
        { value: 'replace' as const, label: 'Replace all data', primary: true },
      ]));
    if (decision === 'replace') {
      this.store.load(parsed.save);
      this.toasts.show(`Imported ${plural(Object.keys(parsed.save.days).length, 'day', 'days')}.`);
    } else if (decision === 'merge') {
      const result = this.store.mergeDays(parsed.save);
      if (!result.ok) this.toasts.show(result.error);
      else this.toasts.show(result.value.length > 0 ? `Merged ${plural(result.value.length, 'new day', 'new days')}.` : 'There were no new days to merge.');
    }
  }

  private clearAll(): void {
    this.store.clearAll();
    this.select(null);
    this.toasts.show('All data cleared.');
  }

  // Panels

  openSettings(): void {
    if (this.settingsModal?.isOpen || Dialog.openCount > 0) return;
    this.scene?.director.finishAll();
    this.select(null);
    this.settingsModal = new SettingsModal(this.overlayHost, this.store, {
      exportJson: () => this.exportJson(),
      importJson: () => this.importJson(),
      clearDay: () => this.clearDay(),
      clearAll: () => this.clearAll(),
      saved: () => this.toasts.show('Settings saved.'),
      previewSpeed: this.scene ? () => this.previewSpeed() : undefined,
    }, this.outlook);
  }

  /**
   * The Preview button beside the animation speed (spec 14): the settings
   * step aside, the camera goes to an empty side plot, and the crew builds a
   * temporary 60 minute block there at the draft speed, then clears it away.
   * Escape or Skip ends it early. Then everything comes back as it was.
   */
  private previewSpeed(): void {
    const scene = this.scene;
    if (!scene || scene.director.isBusy) return;
    const settings = this.store.settings;
    const side = this.sidePlot(scene);
    const view = scene.root.saveView();
    this.settingsModal?.setAside(true);
    side.root.visible = true;
    side.setPrepared(false);
    scene.root.frameSite(SIDE_SITE, 6);
    scene.crew.root.position.copy(SIDE_SITE);
    scene.crew.stack.visible = true;
    scene.crew.setTowerTop(3);
    scene.crew.park();
    scene.crew.settleMast();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      scene.director.skip();
    };
    document.addEventListener('keydown', onKey, true);
    const block: Block = {
      id: 'speed-preview',
      title: '',
      start: settings.dayStart,
      end: settings.dayStart + 60,
      categoryId: settings.categories[0]!.id,
      createdAt: 0,
    };
    const jobs: JobScene = { ...scene.jobs, ground: side, holds: new Holds(), blocks: () => [], moreQueued: () => false, keepInFrame: () => {} };
    const job = previewJob(jobs, block, `Previewing ${settings.animationSpeed}x speed`, () => {
      document.removeEventListener('keydown', onKey, true);
      scene.crew.root.position.set(0, 0, 0);
      scene.crew.stack.visible = false;
      side.setPrepared(false);
      side.root.visible = false;
      scene.root.restoreView(view);
      this.settingsModal?.setAside(false);
    });
    scene.director.enqueue(job);
    this.runDirector();
  }

  /** The empty side plot and depot the speed preview builds on, made the first time it is needed. */
  private sidePlot(scene: SceneParts): Ground {
    if (!this.sideGround) {
      const side = new Ground(null);
      side.root.position.copy(SIDE_SITE);
      side.root.visible = false;
      scene.root.scene.add(side.root);
      this.sideGround = side;
    }
    return this.sideGround;
  }

  private listActions(): ListActions {
    return {
      build: (draft) => {
        const result = this.store.addBlock(this.store.viewedDate, draft);
        return result.ok ? null : result.error;
      },
      commit: (id, patch) => this.commit(id, patch),
      nudge: (id, direction) => this.nudge(id, direction),
      demolish: (id) => this.demolish(id),
      previousDay: () => this.shiftDay(-1),
      nextDay: () => this.shiftDay(1),
      today: () => this.goToToday(),
    };
  }

  openListView(): void {
    if (!this.scene) {
      document.querySelector<HTMLElement>('.list-view input, .list-view select, .list-view button')?.focus();
      return;
    }
    if (this.listDialog?.dialog.isOpen || Dialog.openCount > 0) return;
    const view = new ListView(this.store, this.listActions());
    const dialog = new Dialog(this.overlayHost, {
      title: 'List view',
      className: 'dialog--wide',
      onClose: () => {
        view.dispose();
        this.listDialog = null;
      },
    });
    dialog.body.append(view.element);
    dialog.footer.append(h('button', { class: 'button', text: 'Close list view', attrs: { type: 'button' } }));
    dialog.footer.lastElementChild!.addEventListener('click', () => dialog.close());
    this.listDialog = { dialog, view };
    dialog.focus();
  }
}

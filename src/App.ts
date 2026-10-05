import { LIMITS, sampleBlocks } from './core/defaults';
import { defaultNewRange, gapDraftRange, resizeLimits, totals, towerHeight } from './core/layout';
import type { BlockId, CategoryId, Settings, TimeRange } from './core/model';
import {
  PERSIST_MESSAGES,
  Saver,
  exportFileName,
  parseImport,
  readSave,
  serializeExport,
  type StorageLike,
} from './core/persist';
import { MESSAGES, Store, type BlockPatch, type StoreEvent } from './core/store';
import { addDays, ceilToSlot, clamp, floorToSlot, formatDateTitle, formatDurationLong, todayIso } from './core/time';
import { Ground } from './scene/Ground';
import { materials } from './scene/materials';
import { Picker } from './scene/Picker';
import { DEFAULT_AZIMUTH, SceneRoot } from './scene/SceneRoot';
import { Tower } from './scene/Tower';
import { DebugPanel } from './ui/DebugPanel';
import { Dialog, choose } from './ui/Dialog';
import { h } from './ui/dom';
import { Inspector } from './ui/Inspector';
import { Legend } from './ui/Legend';
import { ListView, type ListActions } from './ui/ListView';
import { DAY_FULL_MESSAGE, Overlay } from './ui/Overlay';
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
  ground: Ground;
  tower: Tower;
  picker: Picker;
}

const GAP_TOO_SHORT = 'That gap is shorter than one slot, so pick a longer gap.';
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
  private readonly saver: Saver;
  private readonly overlayHost: HTMLElement;
  private readonly debug: DebugPanel | null;
  private readonly fileInput: HTMLInputElement;
  private readonly sampleButton: HTMLButtonElement | null = null;
  private listDialog: { dialog: Dialog; view: ListView } | null = null;
  private settingsModal: SettingsModal | null = null;
  private pulseRunning = false;

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
      },
      todayIso,
      { scene: this.scene !== null },
    );
    this.inspector = new Inspector(hosts.overlay, this.store, this.ui, {
      build: (draft) => this.build(draft),
      updateDraft: (draft) => this.ui.update({ inspector: { mode: 'new', draft } }),
      previewTimes: (id, range) => this.scene?.tower.setPreview(range ? { times: new Map([[id, range]]) } : null),
      commit: (id, patch) => this.commit(id, patch),
      nudge: (id, direction) => this.nudge(id, direction),
      demolish: (id) => this.demolish(id),
      close: () => this.select(null),
    });
    new Legend(hosts.overlay, this.store, this.ui, (id) => this.toggleHighlight(id));
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
  }

  // Scene

  private createScene(host: HTMLElement, settings: Readonly<Settings>): SceneParts {
    const root = new SceneRoot(host, settings.theme);
    const ground = new Ground({ x: -3.6, z: 4.0, facing: DEFAULT_AZIMUTH });
    ground.setTheme(settings.theme);
    ground.setPaletteMode(settings.paletteMode);
    ground.setDate(this.store.viewedDate);
    root.scene.add(ground.root);

    const tower = new Tower(this.store, ground);
    tower.onChange = () => root.requestRender();
    root.scene.add(tower.root);
    root.onBeforeRender((camera) => {
      tower.updateForCamera(camera);
      this.afterFrame();
    });
    root.onViewChange(() => tower.setLabelSpace(root.labelSpace));
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
    return { root, ground, tower, picker };
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
        break;
      case 'settings':
        this.applySettings(event.previous, event.current);
        break;
      case 'loaded':
        this.applySettings(null, this.store.settings);
        this.scene?.ground.setDate(this.store.viewedDate);
        this.dropMissingSelection();
        break;
      case 'blocks':
        if (event.date === this.store.viewedDate) this.dropMissingSelection();
        break;
    }
    this.describeCanvas();
    this.updateSampleButton();
    this.scene?.root.requestRender();
  }

  private applySettings(previous: Readonly<Settings> | null, current: Readonly<Settings>): void {
    document.documentElement.dataset.reducedMotion = String(this.reducedMotion());
    if (!previous || previous.theme !== current.theme) this.applyTheme(current.theme, previous !== null);
    const scene = this.scene;
    if (!scene) return;
    if (!previous || previous.paletteMode !== current.paletteMode) scene.ground.setPaletteMode(current.paletteMode);
    if (!previous || previous.dayStart !== current.dayStart || previous.dayEnd !== current.dayEnd) {
      // A new day window re-lays out the tower (done by Tower) and reframes the camera.
      scene.root.frameTower(towerHeight(current), previous !== null && !this.reducedMotion());
    }
  }

  private applyTheme(theme: Settings['theme'], animate: boolean): void {
    document.documentElement.dataset.theme = theme;
    const scene = this.scene;
    if (!scene) return;
    const background = SceneRoot.backgroundFor(theme);
    const [sky, fog] = scene.root.themeColors;
    scene.root.tweenColors(
      [
        [sky!, background],
        [fog!, background],
        [scene.ground.groundColor, Ground.groundFor(theme)],
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

  private clearDay(): void {
    const count = this.store.blocks.length;
    if (count === 0) return;
    this.store.clearDay(this.store.viewedDate);
    this.select(null);
    this.toasts.show(`Cleared ${plural(count, 'block', 'blocks')}.`, { action: { label: 'Undo', run: () => this.undo() } });
  }

  private copyPrevious(): void {
    const from = this.store.previousPlannedDate(this.store.viewedDate);
    if (!from || this.store.blocks.length > 0) return;
    const result = this.store.copyDay(from, this.store.viewedDate);
    this.toasts.show(result.ok ? `Copied ${plural(result.value.length, 'block', 'blocks')} from ${formatDateTitle(from)}.` : result.error);
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
    this.select(null);
    this.settingsModal = new SettingsModal(this.overlayHost, this.store, {
      exportJson: () => this.exportJson(),
      importJson: () => this.importJson(),
      clearDay: () => this.clearDay(),
      clearAll: () => this.clearAll(),
      saved: () => this.toasts.show('Settings saved.'),
    });
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

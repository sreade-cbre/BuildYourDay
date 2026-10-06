import * as THREE from 'three';
import {
  BLOCK_FOOTPRINT,
  MIN_BLOCK_UNITS,
  UNITS_PER_MINUTE,
  clipToWindow,
  computeGaps,
  isInWindow,
  minutesToY,
  spanHeight,
} from '../core/layout';
import type { Block, BlockId, CategoryId, LabelMode, SwatchToken, TimeRange } from '../core/model';
import { buildState, type BuildState, type Clock } from '../core/progress';
import type { Store, StoreEvent } from '../core/store';
import { formatDuration, formatTimeShort, nowMinutes, todayIso } from '../core/time';
import { easeInOutCubic } from '../anim/easing';
import { BlockMesh } from './BlockMesh';
import { Foundation } from './Foundation';
import { GapMesh } from './GapMesh';
import type { Ground } from './Ground';
import type { BlockPose, Holds } from './holds';
import { Label, type LabelText } from './Label';
import { DIMMED_OPACITY, colorOf, darkVariant, materials, weatheredColor } from './materials';
import type { LabelSpace } from './SceneRoot';

// Owns the meshes for the viewed day and reconciles them against the store by
// block id: adds what is missing, removes what is orphaned, updates what
// changed (spec section 19). Reads the store, never writes to it. Blocks a job
// has claimed show as the job says (see holds.ts). While a drag or an unsaved
// inspector edit is in progress, a ghost shows the new times and the block
// stays put, so the job that follows starts from where the block stands.
//
// Blocks are built in real time: a block whose time has not come is a see
// through plan, the block under way is built up to the now ring with its plan
// above, and a block whose time is up stands finished.

/** Gap between a block's right face and its label (spec section 8.5). */
const LABEL_OFFSET = 0.4;
/** Extra reach, with a leader line, for blocks shorter than SHORT_BLOCK. */
const LEADER_STEP = 0.25;
const SHORT_BLOCK = 0.6;
/** Vertical breathing room between labels that share a column. */
const LABEL_GAP = 0.12;
/** Horizontal gap between staggered label columns. */
const COLUMN_GAP = 0.3;
/** Dense days may shrink labels to this share of their normal size to fit. */
const MIN_LABEL_FACTOR = 0.8;
const MAX_LEADERS = 48;
/** Height of the grab zones at a block's roof and base for resizing. */
const HANDLE = 0.35;
/** The selection outline is this much larger than the block (spec 10.5). */
const OUTLINE_GROWTH = 0.08;
/** Blocks entirely outside the window show as a thin band at the nearest edge. */
const OUTSIDE_BAND_MINUTES = MIN_BLOCK_UNITS / UNITS_PER_MINUTE;

const outlineGeometry = new THREE.EdgesGeometry(
  new THREE.BoxGeometry(BLOCK_FOOTPRINT + OUTLINE_GROWTH, 1, BLOCK_FOOTPRINT + OUTLINE_GROWTH).translate(0, 0.5, 0),
);
const ghostGeometry = new THREE.BoxGeometry(BLOCK_FOOTPRINT + 0.04, 1, BLOCK_FOOTPRINT + 0.04).translate(0, 0.5, 0);
const landingGeometry = new THREE.EdgesGeometry(ghostGeometry);

/** Interaction state the tower draws: selection, hover, and legend highlight. */
export interface TowerDecor {
  selectedId: BlockId | null;
  hoveredId: BlockId | null;
  hoveredGapStart: number | null;
  highlightedCategory: CategoryId | null;
}

/** Temporary state shown before it is committed. */
export interface TowerPreview {
  /** A translucent box: new times for a block, the pointer during a move, or a new block draft. */
  ghost?: TimeRange | null;
  /** An outline where a moved block will land, when that is not under the pointer. */
  landing?: TimeRange | null;
}

/** What a pointer ray hit, in tower terms. */
export type TowerHit =
  | { kind: 'block'; id: BlockId; zone: 'roof' | 'base' | 'body' | 'label'; topFace: boolean }
  | { kind: 'gap'; range: TimeRange };

interface BlockView {
  block: Block;
  mesh: BlockMesh;
  label: Label;
  /** Where the block stands when no job has claimed it. */
  home: BlockPose;
  dimmed: boolean;
  /** Distance from the block's right face to the label's left edge. */
  labelOffset: number;
  leader: boolean;
}

interface LabelPlan {
  /** Distance from the tower's right face to the far edge of the last column. */
  width: number;
  slots: Array<{ view: BlockView; offset: number; leader: boolean }>;
}

const NO_DECOR: TowerDecor = { selectedId: null, hoveredId: null, hoveredGapStart: null, highlightedCategory: null };

/**
 * What a block shows by the clock, for weathering (spec 11.4): finished but
 * not weathered, done and weathered, under way now, or still planned.
 */
type Weather = 'fresh' | 'past' | 'current' | 'planned';

/** Seconds a block takes to cross-fade to weathered (spec 11.4). */
const WEATHER_FADE_SECONDS = 2;
/** Keeps the cut through the block under way off its base face. */
const SPLIT_CLEARANCE = 0.004;
/** The day change sunrise (spec 12.7): each block's fade and the whole sweep. */
const SUNRISE_SECONDS = 0.4;
const SUNRISE_FADE = 0.2;

/** Materials that stand in for a block's shared ones during a fade. */
interface Override {
  /** A weathering fade ends early if its block is no longer done; the sunrise always plays out. */
  kind: 'weather' | 'sunrise';
  body: THREE.Material;
  cap: THREE.Material;
  /** The part above the now ring, for the block under way. */
  upper?: THREE.Material;
}

export class Tower {
  readonly root = new THREE.Group();
  /** Called whenever the tower changed and the scene should redraw. */
  onChange: (() => void) | null = null;
  private readonly views = new Map<BlockId, BlockView>();
  private gaps: GapMesh[] = [];
  private gapKey = '';
  private readonly foundation = new Foundation();
  /**
   * Never drawn. Keeps the label shader program alive while the viewed day
   * has no labels, so a day's first label does not stall a frame compiling it.
   */
  private readonly keeper = new Label();
  /** Today and the minute, which decide what is planned, under way, and done. */
  private clock: Clock = { today: todayIso(), minutes: nowMinutes() };
  /** The now ring's height, where the block under way splits. */
  private nowY = 0;
  /** The block under way on the viewed day, drawn split, if any. */
  private buildingId: BlockId | null = null;
  /** How far the crew has got with the block under way: the facade's height, whether the roof is on, and what they are doing. */
  private live: { id: BlockId; reveal: number; roof: boolean; activity: string } | null = null;
  private readonly planeBelow = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  private readonly planeAbove = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly splitBelow: THREE.MeshStandardMaterial;
  private readonly splitAbove: THREE.MeshStandardMaterial;
  /** What each block last showed, so a block that becomes done can fade. */
  private weatherShown = new Map<BlockId, Weather | 'hidden'>();
  /** True while a change of time should land without fading, such as a day change. */
  private quietWeather = false;
  private readonly overrides = new Map<BlockId, Override>();
  private syncedDate: string | null = null;
  /** Lets the tower run a per-frame animation, for fades. Set by the app. */
  animate: ((animator: (dt: number) => boolean) => void) | null = null;
  /** Bumped by each slide, so an older one stops when a newer starts. */
  private slideRun = 0;
  private readonly leaderGeometry = new THREE.BufferGeometry();
  private readonly leaders: THREE.LineSegments;
  private readonly outline: THREE.LineSegments;
  private readonly ghost: THREE.Mesh;
  private readonly landing: THREE.LineSegments;
  private readonly right = new THREE.Vector3(1, 0, 0);
  private labelSpace: LabelSpace = { unitsPerPixel: 0.04, budget: Infinity };
  private labelMode: LabelMode = 'always';
  private decor: TowerDecor = NO_DECOR;
  private preview: TowerPreview | null = null;
  private topId: BlockId | null = null;
  private topYValue = 0;
  private readonly unsubscribe: () => void;

  constructor(private readonly store: Store, private readonly ground: Ground, private readonly holds: Holds) {
    this.root.name = 'tower';
    this.root.add(this.foundation.root);

    const positions = new THREE.BufferAttribute(new Float32Array(MAX_LEADERS * 2 * 3), 3);
    positions.setUsage(THREE.DynamicDrawUsage);
    this.leaderGeometry.setAttribute('position', positions);
    this.leaderGeometry.setDrawRange(0, 0);
    this.leaders = new THREE.LineSegments(this.leaderGeometry, materials.leader());
    this.leaders.name = 'label-leaders';
    this.leaders.renderOrder = 9;
    this.leaders.frustumCulled = false;

    this.outline = new THREE.LineSegments(outlineGeometry, materials.selection());
    this.outline.name = 'selection-outline';
    this.outline.visible = false;

    this.ghost = new THREE.Mesh(ghostGeometry, materials.ghost());
    this.ghost.name = 'ghost';
    this.ghost.visible = false;
    this.ghost.renderOrder = 5;

    this.landing = new THREE.LineSegments(landingGeometry, materials.selection());
    this.landing.name = 'landing';
    this.landing.visible = false;

    this.keeper.setText({ title: ' ', detail: ' ' });
    this.keeper.sprite.visible = false;

    // One block at a time is under way, so one pair of clipped materials,
    // recolored for it, draws its two parts: what stands, and the plan above.
    this.splitBelow = materials.blockBody('navy').clone();
    this.splitBelow.clippingPlanes = [this.planeBelow];
    this.splitBelow.clipShadows = true;
    // Inner faces too, so the cut reads as a building going up, not a see through box.
    this.splitBelow.side = THREE.DoubleSide;
    // Shadows as for a one sided material, so the inner faces never stripe the outer ones.
    this.splitBelow.shadowSide = THREE.BackSide;
    this.splitAbove = materials.blueprint('navy').clone();
    this.splitAbove.clippingPlanes = [this.planeAbove];
    // Never drawn; keeps both in the scene so the startup warm up compiles them.
    for (const material of [this.splitBelow, this.splitAbove]) {
      const holder = new THREE.Mesh(ghostGeometry, material);
      holder.visible = false;
      this.root.add(holder);
    }

    this.root.add(this.leaders, this.outline, this.ghost, this.landing, this.keeper.sprite);
    this.unsubscribe = store.subscribe((event) => this.onStoreEvent(event));
    this.sync();
  }

  private onStoreEvent(event: StoreEvent): void {
    if (event.type === 'blocks' && event.date !== this.store.viewedDate) return;
    this.sync();
  }

  setDecor(decor: TowerDecor): void {
    this.decor = { ...decor };
    this.sync();
  }

  setPreview(preview: TowerPreview | null): void {
    this.preview = preview;
    this.sync();
  }

  /** The block whose roof is the top of the tower, if any. */
  get topBlockId(): BlockId | null {
    return this.topId;
  }

  /** World height of the highest roof in the data, or 0 for an empty day. Jobs in progress do not change it. */
  get topY(): number {
    return this.topYValue;
  }

  /** Where the tower draws a time range: its base height and height, clipped to the window. */
  poseFor(range: TimeRange): BlockPose {
    const settings = this.store.settings;
    const span = this.renderSpan(range);
    return { baseY: minutesToY(span.start, settings), height: spanHeight(span.end - span.start), x: 0, z: 0 };
  }

  /**
   * Sets today and the minute, which decide what is planned, under way, and
   * done, and what is weathered (spec 11.4). With `fade`, blocks that this
   * makes done cross-fade over 2 s; without it, as after a day change or a
   * load, they show weathered at once.
   */
  setClock(clock: Clock, fade: boolean): void {
    if (clock.today === this.clock.today && clock.minutes === this.clock.minutes) return;
    this.clock = { ...clock };
    this.quietWeather = !fade;
    this.sync();
    this.quietWeather = false;
  }

  /** Where a span of the viewed day stands by the clock. */
  stateOf(range: TimeRange): BuildState {
    return buildState(range, this.store.viewedDate, this.clock);
  }



  /**
   * Shows the whole tower `offset` units from where it stands, then slides it
   * home over 0.6 s, as when the day start changes (spec 14). The slab stays
   * on the plot throughout.
   */
  slideFrom(offset: number, seconds = 0.6): void {
    if (!this.animate || Math.abs(offset) < 1e-6) return;
    const run = ++this.slideRun;
    const from = this.root.position.y + offset;
    const place = (y: number) => {
      this.root.position.y = y;
      this.foundation.root.position.y = -y;
    };
    place(from);
    let elapsed = 0;
    this.animate((dt) => {
      if (run !== this.slideRun) return false;
      elapsed += dt;
      const t = Math.min(1, elapsed / seconds);
      place(from * (1 - easeInOutCubic(t)));
      this.onChange?.();
      return t < 1;
    });
  }

  /** Moves the top of the block under way to a height, following the now ring. */
  setNowY(y: number): void {
    this.nowY = y;
    this.applySplit();
  }

  /**
   * Tells the tower how far the crew has got with the block under way: how
   * high its facade has closed, whether its roof is on, and what the crew is
   * doing, which its label says. Null when no crew is at work on it.
   */
  setLive(id: BlockId | null, reveal = 0, roof = false, activity = 'building'): void {
    const before = this.live;
    this.live = id === null ? null : { id, reveal, roof, activity };
    // A new trade, or a site set up or cleared, changes the label.
    if (before?.id !== this.live?.id || before?.activity !== this.live?.activity) this.sync();
    else this.applySplit();
  }

  /** Cuts the block under way where its facade has got to, or at the now ring when no crew is at work on it. */
  private applySplit(): void {
    const id = this.buildingId;
    const live = id && this.live?.id === id ? this.live : null;
    let y = live?.reveal ?? this.nowY;
    // Until the facade has started, the cut stays clear of the base, where
    // a face lying on the cut would flicker.
    const base = id ? this.views.get(id)?.mesh.baseY : undefined;
    if (base !== undefined && y < base + SPLIT_CLEARANCE) y = base - SPLIT_CLEARANCE;
    this.planeBelow.constant = y;
    this.planeAbove.constant = -y;
  }

  private weatherOf(state: BuildState, inside: boolean): Weather {
    if (!inside) return 'fresh';
    if (state === 'planned') return 'planned';
    if (state === 'building') return 'current';
    const weathering = this.store.settings.weatherPastBlocks && this.store.viewedDate === this.clock.today;
    return weathering ? 'past' : 'fresh';
  }

  /** Brings every mesh in line with the store's viewed day. */
  sync(): void {
    const settings = this.store.settings;
    // On a new day nothing fades in; the sunrise covers the change.
    const sameDay = this.syncedDate === this.store.viewedDate;
    if (!sameDay) {
      this.syncedDate = this.store.viewedDate;
      this.weatherShown.clear();
    }
    this.labelMode = settings.labelMode;
    const blocks = this.store.blocks;
    const live = new Set<BlockId>();
    const { selectedId, hoveredId, highlightedCategory } = this.decor;
    let topEnd = -Infinity;
    this.topId = null;
    this.topYValue = 0;
    this.buildingId = null;

    for (const block of blocks) {
      live.add(block.id);
      let view = this.views.get(block.id);
      if (!view) {
        const mesh = new BlockMesh(block.id, this.store.categoryFor(block).color);
        const label = new Label();
        label.sprite.userData.blockId = block.id;
        label.sprite.userData.label = true;
        this.root.add(mesh.root, label.sprite);
        view = { block, mesh, label, home: this.poseFor(block), dimmed: false, labelOffset: LABEL_OFFSET, leader: false };
        this.views.set(block.id, view);
      }
      view.block = block;

      const inside = isInWindow(block, settings);
      view.home = this.poseFor(block);
      // A band for a block wholly outside the window sits slightly proud of the tower.
      const band = !clipToWindow(block, settings);
      view.mesh.root.scale.set(band ? 1.02 : 1, 1, band ? 1.02 : 1);

      const category = this.store.categoryFor(block);
      view.dimmed = highlightedCategory !== null && category.id !== highlightedCategory;
      const state = this.stateOf(block);
      const weather = this.weatherOf(state, inside);
      if (weather === 'current') this.buildingId = block.id;
      // A dimmed block under way is drawn whole, since two translucent parts
      // would draw darker where they meet.
      const split = weather === 'current' && !view.dimmed;
      if (!split) view.mesh.clearSplit();
      view.mesh.setAppearance({
        token: category.color,
        dimmed: view.dimmed,
        hovered: hoveredId === block.id,
        hatched: !inside,
        weathered: weather === 'past',
        stage: state,
      });
      if (split) {
        this.splitBelow.color.copy(colorOf(category.color));
        this.splitAbove.color.copy(materials.blueprint(category.color).color);
        view.mesh.setSplit(this.splitBelow, this.splitAbove);
      }
      // A block that is under way or planned again drops its weathering fade.
      if (this.overrides.get(block.id)?.kind === 'weather' && weather !== 'past') this.dropOverride(block.id);
      const override = this.overrides.get(block.id);
      if (override) view.mesh.useMaterials(override.body, view.mesh.edges.material as THREE.Material, override.cap, override.upper);
      // A block that becomes done while in view fades over 2 s, whether the
      // crew just finished it or a job just showed it. Blocks that arrive all
      // at once, as from a load, need no fade.
      if (this.holds.isHidden(block.id)) {
        this.weatherShown.set(block.id, 'hidden');
      } else {
        const before = this.weatherShown.get(block.id);
        const fade = sameDay && !this.quietWeather && weather === 'past' && before !== undefined && before !== 'past';
        if (fade && !view.dimmed) this.fadeToWeathered(view, category.color);
        this.weatherShown.set(block.id, weather);
      }
      view.label.setText(this.labelText(block, inside, weather === 'past', weather === 'current'));
      view.label.sprite.visible = this.labelMode === 'always' || block.id === hoveredId || block.id === selectedId;

      if (inside && block.end > topEnd) {
        topEnd = block.end;
        this.topId = block.id;
      }
      this.topYValue = Math.max(this.topYValue, view.home.baseY + view.home.height);
    }

    for (const [id, view] of this.views) {
      if (live.has(id)) continue;
      view.mesh.dispose();
      view.label.dispose();
      this.views.delete(id);
    }

    this.applyClaims();
    this.syncGaps(blocks);
    this.syncGhost();
    this.syncSite(blocks);
    this.layoutLabels();
    this.syncOutline();
    this.onChange?.();
  }

  /**
   * Shows each block as the first job that claimed it says: hidden while the
   * job draws its own copy, or at the job's pose. Runs on every sync and
   * before every frame, so a playing job only has to update its claim.
   */
  private applyClaims(): void {
    this.applySplit();
    for (const view of this.views.values()) {
      const claim = this.holds.current(view.block.id);
      const pose = claim?.pose ?? view.home;
      view.mesh.setBaseY(pose.baseY);
      view.mesh.setHeight(pose.height);
      view.mesh.root.position.x = pose.x;
      view.mesh.root.position.z = pose.z;
      view.mesh.root.visible = claim?.pose !== null;
      view.label.setOpacity(claim ? claim.labelOpacity : view.dimmed ? DIMMED_OPACITY : 1);
      // The block under way has its roof once the crane has set it.
      if (view.block.id === this.buildingId) view.mesh.cap.visible = this.live?.id === this.buildingId && this.live.roof;
    }
  }

  /**
   * The plot and slab follow the data unless a job owns the site: the plot
   * keeps its grass until the day's first block is started.
   */
  private syncSite(blocks: readonly Block[]): void {
    const mode = this.holds.siteMode;
    if (mode === null) {
      const built = blocks.some((block) => this.stateOf(block) !== 'planned');
      this.foundation.root.visible = built;
      this.ground.setPrepared(built);
    } else if (mode === 'build') {
      // A first build draws its own slab and prepares the plot as it goes.
      this.foundation.root.visible = false;
    }
    // A frozen site stays as it is until the job lets go.
  }

  /** The part of a block to draw: its own span, clipped to the window if needed. */
  private renderSpan(block: TimeRange): TimeRange {
    const settings = this.store.settings;
    const clipped = clipToWindow(block, settings);
    if (clipped) return clipped;
    return block.end <= settings.dayStart
      ? { start: settings.dayStart, end: settings.dayStart + OUTSIDE_BAND_MINUTES }
      : { start: settings.dayEnd - OUTSIDE_BAND_MINUTES, end: settings.dayEnd };
  }

  /** Cross-fades a block that just became done to the weathered look (spec 11.4). */
  private fadeToWeathered(view: BlockView, token: SwatchToken): void {
    if (!this.animate || this.overrides.has(view.block.id)) return;
    const id = view.block.id;
    const body = materials.blockBody(token).clone();
    const cap = materials.blockCap(token).clone();
    const from = [body.color.clone(), cap.color.clone()];
    const to = [weatheredColor(token), weatheredColor(darkVariant(token))];
    const fromRoughness = [body.roughness, cap.roughness];
    this.overrides.set(id, { kind: 'weather', body, cap });
    view.mesh.useMaterials(body, view.mesh.edges.material as THREE.Material, cap);
    let elapsed = 0;
    this.animate((dt) => {
      // Dropped because the block is no longer done.
      if (this.overrides.get(id)?.body !== body) return false;
      elapsed += dt;
      const t = Math.min(1, elapsed / WEATHER_FADE_SECONDS);
      [body, cap].forEach((material, i) => {
        material.color.lerpColors(from[i]!, to[i]!, t);
        material.roughness = fromRoughness[i]! + (1 - fromRoughness[i]!) * t;
      });
      if (t >= 1) this.endOverride(id);
      this.onChange?.();
      return t < 1;
    });
  }

  /**
   * The day change sunrise (spec 12.7): every block starts slatePale and
   * takes on its color, the lowest first, over 0.4 s.
   */
  playSunrise(): void {
    if (!this.animate) return;
    const top = Math.max(1e-6, this.topYValue);
    const fades: Array<{ id: BlockId; materials: THREE.MeshStandardMaterial[]; targets: THREE.Color[]; delay: number }> = [];
    for (const view of this.views.values()) {
      const id = view.block.id;
      if (this.holds.isClaimed(id) || this.overrides.has(id)) continue;
      const body = (view.mesh.body.material as THREE.MeshStandardMaterial).clone();
      const cap = (view.mesh.cap.material as THREE.MeshStandardMaterial).clone();
      // The block under way has a second part above the ring, which warms up with the rest.
      const upper = (view.mesh.upperMaterial as THREE.MeshStandardMaterial | null)?.clone();
      const parts = upper ? [body, cap, upper] : [body, cap];
      const targets = parts.map((material) => material.color.clone());
      for (const material of parts) material.color.copy(colorOf('slatePale'));
      this.overrides.set(id, { kind: 'sunrise', body, cap, upper });
      view.mesh.useMaterials(body, view.mesh.edges.material as THREE.Material, cap, upper);
      fades.push({ id, materials: parts, targets, delay: (view.mesh.baseY / top) * (SUNRISE_SECONDS - SUNRISE_FADE) });
    }
    if (fades.length === 0) return;
    const pale = colorOf('slatePale');
    let elapsed = 0;
    this.animate((dt) => {
      elapsed += dt;
      for (const fade of fades) {
        const t = Math.min(1, Math.max(0, (elapsed - fade.delay) / SUNRISE_FADE));
        fade.materials.forEach((material, i) => material.color.lerpColors(pale, fade.targets[i]!, t));
      }
      const done = elapsed >= SUNRISE_SECONDS;
      if (done) for (const fade of fades) this.endOverride(fade.id);
      this.onChange?.();
      return !done;
    });
  }

  /** Drops a block's stand-in materials and gives it its shared ones back. */
  private endOverride(id: BlockId): void {
    if (this.dropOverride(id)) this.sync();
  }

  /** Frees a block's stand-in materials; the next sync gives it its shared ones. */
  private dropOverride(id: BlockId): boolean {
    const override = this.overrides.get(id);
    if (!override) return false;
    this.overrides.delete(id);
    override.body.dispose();
    override.cap.dispose();
    override.upper?.dispose();
    return true;
  }

  private labelText(block: Block, inside: boolean, done = false, building = false): LabelText {
    const settings = this.store.settings;
    const range = `${formatTimeShort(block.start, settings)} to ${formatTimeShort(block.end, settings)}`;
    const parts = [range, formatDuration(block.end - block.start)];
    // Category in words too, so color is never the only carrier (spec 17).
    parts.push(this.store.categoryFor(block).name);
    if (!inside) parts.push('outside window');
    // Weathering is never color alone (spec 17).
    if (done) parts.push('done');
    if (building) parts.push(this.live?.id === block.id ? this.live.activity : 'building');
    return { title: block.title || 'Untitled', detail: parts.join(' · ') };
  }

  private syncGaps(blocks: readonly Block[]): void {
    const settings = this.store.settings;
    // Gaps shorter than one slot are not drawn (spec section 8.4).
    const ranges = computeGaps(blocks, settings).filter((gap) => gap.end - gap.start >= settings.slotMinutes);
    const key = `${settings.dayStart}:${ranges.map((g) => `${g.start}-${g.end}`).join(',')}`;
    if (key !== this.gapKey) {
      this.gapKey = key;
      for (const gap of this.gaps) gap.dispose();
      this.gaps = ranges.map((range) => {
        const gap = new GapMesh(range, minutesToY(range.start, settings), (range.end - range.start) * UNITS_PER_MINUTE);
        this.root.add(gap.root);
        return gap;
      });
    }
    // Where a job is still working, the old layout shows until it is done.
    const quiet = this.holds.quietRanges();
    for (const gap of this.gaps) {
      gap.setHovered(gap.range.start === this.decor.hoveredGapStart);
      gap.root.visible = !quiet.some((q) => q.start < gap.range.end && gap.range.start < q.end);
    }
  }

  /** The selection outline follows its block, even while a job moves it. */
  private syncOutline(): void {
    const id = this.decor.selectedId;
    const view = id && !this.holds.isHidden(id) ? this.views.get(id) : undefined;
    this.outline.visible = view !== undefined;
    if (!view) return;
    const root = view.mesh.root;
    this.outline.position.set(root.position.x, view.mesh.baseY - OUTLINE_GROWTH / 2, root.position.z);
    this.outline.scale.set(root.scale.x, view.mesh.height + OUTLINE_GROWTH, root.scale.z);
  }

  private syncGhost(): void {
    const settings = this.store.settings;
    const place = (object: THREE.Object3D, range: TimeRange | null | undefined) => {
      object.visible = !!range;
      if (!range) return;
      object.position.y = minutesToY(range.start, settings);
      object.scale.y = spanHeight(range.end - range.start);
    };
    place(this.ghost, this.preview?.ghost);
    place(this.landing, this.preview?.landing);
  }

  /** Sets the selection outline's opacity, for the pulse in spec 10.5. */
  setOutlineOpacity(opacity: number): void {
    const material = this.outline.material as THREE.LineBasicMaterial;
    material.opacity = opacity;
  }

  // Picking

  /** Everything a pointer can interact with: blocks, their labels, and gaps. */
  pickTargets(): THREE.Object3D[] {
    const targets: THREE.Object3D[] = [];
    for (const view of this.views.values()) {
      targets.push(view.mesh.body, view.mesh.cap);
      if (view.label.sprite.visible) targets.push(view.label.sprite);
    }
    for (const gap of this.gaps) if (gap.root.visible) targets.push(gap.pickTarget);
    return targets;
  }

  /** Reads a raycast hit as a block zone or a gap. */
  interpret(hit: THREE.Intersection): TowerHit | null {
    const data = hit.object.userData as { blockId?: BlockId; label?: boolean; roof?: boolean; gap?: TimeRange };
    if (data.gap) return { kind: 'gap', range: data.gap };
    if (!data.blockId) return null;
    const view = this.views.get(data.blockId);
    if (!view) return null;
    if (data.label) return { kind: 'block', id: data.blockId, zone: 'label', topFace: false };
    const topFace = (hit.face?.normal.y ?? 0) > 0.5;
    if (data.roof) return { kind: 'block', id: data.blockId, zone: 'roof', topFace };
    const local = hit.point.y - view.mesh.baseY;
    const handle = Math.min(HANDLE, view.mesh.height * 0.3);
    const zone = topFace || local >= view.mesh.height - handle ? 'roof' : local <= handle ? 'base' : 'body';
    return { kind: 'block', id: data.blockId, zone, topFace };
  }

  /** Block meshes by id, for picking and animation. */
  meshFor(id: BlockId): BlockMesh | undefined {
    return this.views.get(id)?.mesh;
  }

  // Labels

  /** Label scale and room beside the tower, from the camera framing. */
  setLabelSpace(space: LabelSpace): void {
    const current = this.labelSpace;
    if (Math.abs(space.unitsPerPixel - current.unitsPerPixel) < 1e-6 && Math.abs(space.budget - current.budget) < 1e-4) {
      return;
    }
    this.labelSpace = space;
    this.layoutLabels();
    this.onChange?.();
  }

  /**
   * Gives every visible label a place where it overlaps no other (spec 8.5).
   * Labels keep their normal size when the columns fit beside the tower; on a
   * dense day they shrink a little, down to MIN_LABEL_FACTOR, to fit.
   */
  private layoutLabels(): void {
    const base = this.labelSpace.unitsPerPixel;
    const floor = base * MIN_LABEL_FACTOR;
    let scale = base;
    let plan = this.planLabels(scale);
    while (plan.width > this.labelSpace.budget && scale > floor) {
      scale = Math.max(floor, scale * 0.95);
      plan = this.planLabels(scale);
    }
    for (const slot of plan.slots) {
      slot.view.labelOffset = slot.offset;
      slot.view.leader = slot.leader;
      slot.view.label.setWorldScale(scale);
    }
  }

  /**
   * Assigns labels to columns at a given scale. Taller blocks claim the inner
   * column first; when two labels would overlap, the shorter block's label
   * steps one column further out. Short blocks get a leader line.
   */
  private planLabels(scale: number): LabelPlan {
    const items = [...this.views.values()]
      .filter((view) => view.label.sprite.visible)
      .map((view) => {
        const height = view.mesh.height;
        return {
          view,
          height,
          mid: view.mesh.baseY + height / 2,
          labelHeight: view.label.heightPx * scale,
          labelWidth: view.label.widthPx * scale,
          short: height < SHORT_BLOCK,
          column: 0,
        };
      });
    items.sort((a, b) => b.height - a.height || a.view.block.start - b.view.block.start);

    const columns: Array<Array<[number, number]>> = [];
    const widths: number[] = [];
    for (const item of items) {
      const low = item.mid - item.labelHeight / 2 - LABEL_GAP / 2;
      const high = item.mid + item.labelHeight / 2 + LABEL_GAP / 2;
      let column = 0;
      while (columns[column]?.some(([a, b]) => a < high && low < b)) column++;
      (columns[column] ??= []).push([low, high]);
      widths[column] = Math.max(widths[column] ?? 0, item.labelWidth + (item.short ? LEADER_STEP : 0));
      item.column = column;
    }

    const columnStart = [0];
    for (let c = 1; c < widths.length; c++) columnStart[c] = columnStart[c - 1]! + widths[c - 1]! + COLUMN_GAP;
    const last = widths.length - 1;
    const width = last < 0 ? 0 : LABEL_OFFSET + columnStart[last]! + widths[last]!;

    return {
      width,
      slots: items.map((item) => ({
        view: item.view,
        offset: LABEL_OFFSET + columnStart[item.column]! + (item.short ? LEADER_STEP : 0),
        leader: item.short || item.column > 0,
      })),
    };
  }

  /**
   * Places labels to the right of the tower as seen from the camera. Runs
   * before each render so labels follow an orbiting camera.
   */
  updateForCamera(camera: THREE.Camera): void {
    this.applyClaims();
    this.syncOutline();
    this.right.setFromMatrixColumn(camera.matrixWorld, 0);
    this.right.y = 0;
    if (this.right.lengthSq() < 1e-8) this.right.set(1, 0, 0);
    this.right.normalize();
    // How far the square footprint reaches along the camera's right axis.
    const face = ((Math.abs(this.right.x) + Math.abs(this.right.z)) * BLOCK_FOOTPRINT) / 2;

    const positions = this.leaderGeometry.getAttribute('position') as THREE.BufferAttribute;
    let leaders = 0;
    for (const view of this.views.values()) {
      if (!view.label.sprite.visible) continue;
      const mid = view.mesh.baseY + view.mesh.height / 2;
      const reach = face + view.labelOffset;
      view.label.sprite.position.set(this.right.x * reach, mid, this.right.z * reach);
      if (view.leader && leaders < MAX_LEADERS) {
        positions.setXYZ(leaders * 2, this.right.x * face, mid, this.right.z * face);
        positions.setXYZ(leaders * 2 + 1, this.right.x * reach, mid, this.right.z * reach);
        leaders++;
      }
    }
    positions.needsUpdate = true;
    this.leaderGeometry.setDrawRange(0, leaders * 2);
  }

  dispose(): void {
    this.unsubscribe();
    for (const view of this.views.values()) {
      view.mesh.dispose();
      view.label.dispose();
    }
    this.views.clear();
    for (const override of this.overrides.values()) {
      override.body.dispose();
      override.cap.dispose();
      override.upper?.dispose();
    }
    this.overrides.clear();
    this.splitBelow.dispose();
    this.splitAbove.dispose();
    for (const gap of this.gaps) gap.dispose();
    this.gaps = [];
    this.keeper.dispose();
    this.leaderGeometry.dispose();
    this.root.removeFromParent();
  }
}

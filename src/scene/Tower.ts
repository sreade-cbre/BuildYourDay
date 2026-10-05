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
import type { Block, BlockId, CategoryId, LabelMode, TimeRange } from '../core/model';
import type { Store, StoreEvent } from '../core/store';
import { formatDuration, formatTimeShort } from '../core/time';
import { BlockMesh } from './BlockMesh';
import { Foundation } from './Foundation';
import { GapMesh } from './GapMesh';
import type { Ground } from './Ground';
import type { Holds } from './holds';
import { Label, type LabelText } from './Label';
import { DIMMED_OPACITY, materials } from './materials';
import type { LabelSpace } from './SceneRoot';

// Owns the meshes for the viewed day and reconciles them against the store by
// block id: adds what is missing, removes what is orphaned, updates what
// changed (spec section 19). Reads the store, never writes to it. While a drag
// or an unsaved inspector edit is in progress, a preview overrides block times
// so the tower shows the result before anything is committed.

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

/** Interaction state the tower draws: selection, hover, and legend highlight. */
export interface TowerDecor {
  selectedId: BlockId | null;
  hoveredId: BlockId | null;
  hoveredGapStart: number | null;
  highlightedCategory: CategoryId | null;
}

/** Temporary state shown before it is committed. */
export interface TowerPreview {
  /** Times that replace the stored ones, by block id. */
  times?: ReadonlyMap<BlockId, TimeRange>;
  /** A translucent box: the pointer during a move, or a new block draft. */
  ghost?: TimeRange | null;
}

/** What a pointer ray hit, in tower terms. */
export type TowerHit =
  | { kind: 'block'; id: BlockId; zone: 'roof' | 'base' | 'body' | 'label'; topFace: boolean }
  | { kind: 'gap'; range: TimeRange };

interface BlockView {
  block: Block;
  mesh: BlockMesh;
  label: Label;
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
  private readonly leaderGeometry = new THREE.BufferGeometry();
  private readonly leaders: THREE.LineSegments;
  private readonly outline: THREE.LineSegments;
  private readonly ghost: THREE.Mesh;
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

    this.keeper.setText({ title: ' ', detail: ' ' });
    this.keeper.sprite.visible = false;

    this.root.add(this.leaders, this.outline, this.ghost, this.keeper.sprite);
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

  /** World height of the tower's highest roof, or 0 for an empty day. */
  get topY(): number {
    return this.topYValue;
  }

  /** Fades a held block's label, for a job's last moments (spec 9.4 phase 7). */
  setHeldLabelOpacity(id: BlockId, opacity: number): void {
    this.holds.setLabelOpacity(id, opacity);
    this.views.get(id)?.label.setOpacity(opacity);
    this.onChange?.();
  }

  /** Blocks for the viewed day with any preview times applied. */
  private effectiveBlocks(): Block[] {
    const times = this.preview?.times;
    return this.store.blocks.map((b) => {
      const override = times?.get(b.id);
      return override ? { ...b, start: override.start, end: override.end } : b;
    });
  }

  /** Brings every mesh in line with the store's viewed day. */
  sync(): void {
    const settings = this.store.settings;
    this.labelMode = settings.labelMode;
    const blocks = this.effectiveBlocks();
    const live = new Set<BlockId>();
    const { selectedId, hoveredId, highlightedCategory } = this.decor;
    let topEnd = -Infinity;
    this.topId = null;
    this.topYValue = 0;

    for (const block of blocks) {
      live.add(block.id);
      let view = this.views.get(block.id);
      if (!view) {
        const mesh = new BlockMesh(block.id, this.store.categoryFor(block).color);
        const label = new Label();
        label.sprite.userData.blockId = block.id;
        label.sprite.userData.label = true;
        this.root.add(mesh.root, label.sprite);
        view = { block, mesh, label, labelOffset: LABEL_OFFSET, leader: false };
        this.views.set(block.id, view);
      }
      view.block = block;

      const inside = isInWindow(block, settings);
      const span = this.renderSpan(block);
      view.mesh.setBaseY(minutesToY(span.start, settings));
      view.mesh.setHeight(spanHeight(span.end - span.start));
      // A band for a block wholly outside the window sits slightly proud of the tower.
      const band = !clipToWindow(block, settings);
      view.mesh.root.scale.set(band ? 1.02 : 1, 1, band ? 1.02 : 1);

      const category = this.store.categoryFor(block);
      const dimmed = highlightedCategory !== null && category.id !== highlightedCategory;
      const held = this.holds.isHeld(block.id);
      view.mesh.setAppearance({ token: category.color, dimmed, hovered: hoveredId === block.id, hatched: !inside });
      // A block under construction shows as the job's copy, not this mesh.
      view.mesh.root.visible = !held;
      view.label.setText(this.labelText(block, inside));
      view.label.setOpacity(held ? this.holds.labelOpacity(block.id) : dimmed ? DIMMED_OPACITY : 1);
      view.label.sprite.visible = this.labelMode === 'always' || block.id === hoveredId || block.id === selectedId;

      if (inside && block.end > topEnd) {
        topEnd = block.end;
        this.topId = block.id;
      }
      this.topYValue = Math.max(this.topYValue, view.mesh.baseY + view.mesh.height);
    }

    for (const [id, view] of this.views) {
      if (live.has(id)) continue;
      view.mesh.dispose();
      view.label.dispose();
      this.views.delete(id);
    }

    this.syncGaps(blocks);
    this.syncOutline();
    this.syncGhost();
    // During a first build the job owns the plot and foundation.
    if (!this.holds.site) {
      const built = blocks.length > 0;
      this.foundation.root.visible = built;
      this.ground.setPrepared(built);
    } else {
      this.foundation.root.visible = false;
    }
    this.layoutLabels();
    this.onChange?.();
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

  private labelText(block: Block, inside: boolean): LabelText {
    const settings = this.store.settings;
    const range = `${formatTimeShort(block.start, settings)} to ${formatTimeShort(block.end, settings)}`;
    const parts = [range, formatDuration(block.end - block.start)];
    // Category in words too, so color is never the only carrier (spec 17).
    parts.push(this.store.categoryFor(block).name);
    if (!inside) parts.push('outside window');
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
    for (const gap of this.gaps) gap.setHovered(gap.range.start === this.decor.hoveredGapStart);
  }

  private syncOutline(): void {
    const id = this.decor.selectedId;
    const view = id && !this.holds.isHeld(id) ? this.views.get(id) : undefined;
    this.outline.visible = view !== undefined;
    if (!view) return;
    this.outline.position.y = view.mesh.baseY - OUTLINE_GROWTH / 2;
    this.outline.scale.set(view.mesh.root.scale.x, view.mesh.height + OUTLINE_GROWTH, view.mesh.root.scale.z);
  }

  private syncGhost(): void {
    const range = this.preview?.ghost ?? null;
    this.ghost.visible = range !== null;
    if (!range) return;
    const settings = this.store.settings;
    this.ghost.position.y = minutesToY(range.start, settings);
    this.ghost.scale.y = spanHeight(range.end - range.start);
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
    for (const gap of this.gaps) targets.push(gap.pickTarget);
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
    for (const gap of this.gaps) gap.dispose();
    this.gaps = [];
    this.keeper.dispose();
    this.leaderGeometry.dispose();
    this.root.removeFromParent();
  }
}

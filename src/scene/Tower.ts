import * as THREE from 'three';
import { BLOCK_FOOTPRINT, UNITS_PER_MINUTE, computeGaps, minutesToY, spanHeight } from '../core/layout';
import type { Block, BlockId, SwatchToken, TimeRange } from '../core/model';
import type { Store, StoreEvent } from '../core/store';
import { formatDuration, formatTimeShort } from '../core/time';
import { BlockMesh } from './BlockMesh';
import { Foundation } from './Foundation';
import { GapMesh } from './GapMesh';
import type { Ground } from './Ground';
import { Label, type LabelText } from './Label';
import { materials } from './materials';
import type { LabelSpace } from './SceneRoot';

// Owns the meshes for the viewed day and reconciles them against the store by
// block id: adds what is missing, removes what is orphaned, updates what
// changed (spec section 19). Reads the store, never writes to it.

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

export class Tower {
  readonly root = new THREE.Group();
  /** Called whenever the tower changed and the scene should redraw. */
  onChange: (() => void) | null = null;
  private readonly views = new Map<BlockId, BlockView>();
  private gaps: GapMesh[] = [];
  private gapKey = '';
  private readonly foundation = new Foundation();
  private readonly leaderGeometry = new THREE.BufferGeometry();
  private readonly leaders: THREE.LineSegments;
  private readonly right = new THREE.Vector3(1, 0, 0);
  private labelSpace: LabelSpace = { unitsPerPixel: 0.04, budget: Infinity };
  private readonly unsubscribe: () => void;

  constructor(private readonly store: Store, private readonly ground: Ground) {
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
    this.root.add(this.leaders);

    this.unsubscribe = store.subscribe((event) => this.onStoreEvent(event));
    this.sync();
  }

  private onStoreEvent(event: StoreEvent): void {
    if (event.type === 'blocks' && event.date !== this.store.viewedDate) return;
    this.sync();
  }

  /** Brings every mesh in line with the store's viewed day. */
  sync(): void {
    const settings = this.store.settings;
    const blocks = this.store.blocks;
    const live = new Set<BlockId>();

    for (const block of blocks) {
      live.add(block.id);
      let view = this.views.get(block.id);
      if (!view) {
        const mesh = new BlockMesh(block.id, this.colorFor(block));
        const label = new Label();
        this.root.add(mesh.root, label.sprite);
        view = { block, mesh, label, labelOffset: LABEL_OFFSET, leader: false };
        this.views.set(block.id, view);
      }
      view.block = block;
      view.mesh.setColor(this.colorFor(block));
      view.mesh.setBaseY(minutesToY(block.start, settings));
      view.mesh.setHeight(spanHeight(block.end - block.start));
      view.label.setText(this.labelText(block));
    }

    for (const [id, view] of this.views) {
      if (live.has(id)) continue;
      view.mesh.dispose();
      view.label.dispose();
      this.views.delete(id);
    }

    this.syncGaps(blocks);
    const built = blocks.length > 0;
    this.foundation.root.visible = built;
    this.ground.setPrepared(built);
    this.layoutLabels();
    this.onChange?.();
  }

  private colorFor(block: Block): SwatchToken {
    return this.store.category(block.categoryId)?.color ?? 'slate';
  }

  private labelText(block: Block): LabelText {
    const settings = this.store.settings;
    const range = `${formatTimeShort(block.start, settings)} to ${formatTimeShort(block.end, settings)}`;
    const parts = [range, formatDuration(block.end - block.start)];
    // Category in words too, so color is never the only carrier (spec 17).
    const category = this.store.category(block.categoryId)?.name;
    if (category) parts.push(category);
    return { title: block.title || 'Untitled', detail: parts.join(' · ') };
  }

  private syncGaps(blocks: readonly Block[]): void {
    const settings = this.store.settings;
    // Gaps shorter than one slot are not drawn (spec section 8.4).
    const ranges = computeGaps(blocks, settings).filter((gap) => gap.end - gap.start >= settings.slotMinutes);
    const key = `${settings.dayStart}:${ranges.map((g) => `${g.start}-${g.end}`).join(',')}`;
    if (key === this.gapKey) return;
    this.gapKey = key;
    for (const gap of this.gaps) gap.dispose();
    this.gaps = ranges.map((range: TimeRange) => {
      const gap = new GapMesh(range, minutesToY(range.start, settings), (range.end - range.start) * UNITS_PER_MINUTE);
      this.root.add(gap.root);
      return gap;
    });
  }

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
   * Gives every label a place where it overlaps no other (spec section 8.5).
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
    const items = [...this.views.values()].map((view) => {
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

  /** Block meshes by id, for picking and animation. */
  meshFor(id: BlockId): BlockMesh | undefined {
    return this.views.get(id)?.mesh;
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
    this.leaderGeometry.dispose();
    this.root.removeFromParent();
  }
}

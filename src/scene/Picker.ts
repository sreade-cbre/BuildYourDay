import * as THREE from 'three';
import { nearestFreeStart, resizeLimits, yToMinutes } from '../core/layout';
import type { BlockId, TimeRange } from '../core/model';
import { isMeetingBlock, type Store } from '../core/store';
import { ceilToSlot, clamp, floorToSlot } from '../core/time';
import type { Ground } from './Ground';
import type { SceneRoot } from './SceneRoot';
import type { Tower, TowerHit, TowerPreview } from './Tower';

// Pointer input on the scene (spec section 12): hover, click to select or add,
// and the drag state machine for resizing and moving. A press on a block turns
// camera orbiting off before OrbitControls sees it (spec 12.10). Drags show a
// live preview and commit once, on release, through the handlers; the store
// is never written mid-drag. The block itself stays put while a ghost shows
// the new times, so the job that plays on release starts where it stands.

/** Pixels the pointer must travel before a press becomes a drag. */
const DRAG_THRESHOLD = 4;
/**
 * Wheel travel, in pixels, per slot of Shift + wheel resizing. A standard
 * wheel notch is 100 pixels, so one notch moves one slot (spec 12.3); small
 * trackpad deltas add up to the same.
 */
const WHEEL_STEP = 100;

export interface HoverTarget {
  blockId: BlockId | null;
  gapStart: number | null;
}

export interface PickerHandlers {
  selectedId(): BlockId | null;
  select(id: BlockId | null): void;
  hover(target: HoverTarget): void;
  /** Starts a new block: from a clicked gap, or with the Add button's default when null. */
  startNew(gap: TimeRange | null): void;
  preview(preview: TowerPreview | null): void;
  /** Commits the result of a drag. */
  commit(id: BlockId, range: TimeRange): void;
  /** Shift + wheel over the selected block: change its end by whole slots. */
  stepEnd(id: BlockId, slots: number): void;
}

type Press =
  | { kind: 'block'; id: BlockId; zone: Extract<TowerHit, { kind: 'block' }>['zone']; wasSelected: boolean; topRoof: boolean }
  | { kind: 'gap'; range: TimeRange }
  | { kind: 'plot' }
  | { kind: 'empty' };

interface Drag {
  kind: 'move' | 'resize-top' | 'resize-base';
  id: BlockId;
  original: TimeRange;
  pointerStart: number;
  plane: THREE.Plane;
  current: TimeRange;
}

interface Hit {
  tower: TowerHit | null;
  plot: boolean;
}

export class Picker {
  private press: Press | null = null;
  private pressX = 0;
  private pressY = 0;
  private pointerId: number | null = null;
  private moved = false;
  private drag: Drag | null = null;
  private wheelTravel = 0;
  private wheelTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly hitPoint = new THREE.Vector3();
  private readonly canvas: HTMLCanvasElement;
  private readonly host: HTMLElement;

  constructor(
    private readonly sceneRoot: SceneRoot,
    private readonly tower: Tower,
    private readonly ground: Ground,
    private readonly store: Store,
    private readonly handlers: PickerHandlers,
  ) {
    this.canvas = sceneRoot.canvas;
    this.host = this.canvas.parentElement ?? this.canvas;
    // Capture on the parent runs before OrbitControls' own listeners on the canvas.
    this.host.addEventListener('pointerdown', this.onPointerDown, { capture: true });
    this.host.addEventListener('wheel', this.onWheel, { capture: true, passive: false });
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerCancel);
    this.canvas.addEventListener('lostpointercapture', this.onPointerCancel);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
  }

  get dragging(): boolean {
    return this.drag !== null;
  }

  /** Ends a drag without committing it, for example on Escape. */
  cancelDrag(): boolean {
    if (!this.drag) return false;
    this.finishDrag(false);
    this.endPress();
    return true;
  }

  private hitTest(clientX: number, clientY: number): Hit {
    const raycaster = this.sceneRoot.pointerRay(clientX, clientY);
    const plot = this.ground.plotMesh;
    const hits = raycaster.intersectObjects([...this.tower.pickTargets(), plot], false);
    for (const hit of hits) {
      if (hit.object === plot) return { tower: null, plot: true };
      const read = this.tower.interpret(hit);
      if (read) return { tower: read, plot: false };
    }
    return { tower: null, plot: false };
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.target !== this.canvas || event.button !== 0 || !event.isPrimary) return;
    const hit = this.hitTest(event.clientX, event.clientY);
    this.pressX = event.clientX;
    this.pressY = event.clientY;
    this.moved = false;
    const target = hit.tower;
    if (target?.kind === 'block') {
      // Dragging that begins on a block never orbits the camera.
      this.sceneRoot.controls.enabled = false;
      this.canvas.setPointerCapture(event.pointerId);
      this.pointerId = event.pointerId;
      this.press = {
        kind: 'block',
        id: target.id,
        zone: target.zone,
        wasSelected: this.handlers.selectedId() === target.id,
        topRoof: target.topFace && target.id === this.tower.topBlockId,
      };
    } else if (target?.kind === 'gap') {
      this.press = { kind: 'gap', range: target.range };
    } else {
      this.press = hit.plot ? { kind: 'plot' } : { kind: 'empty' };
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.press) {
      if (event.buttons === 0) this.updateHover(event);
      return;
    }
    if (!this.moved && Math.hypot(event.clientX - this.pressX, event.clientY - this.pressY) > DRAG_THRESHOLD) {
      this.moved = true;
      if (this.press.kind === 'block' && this.press.zone !== 'label') this.beginDrag(this.press);
    }
    if (this.drag) this.updateDrag(event);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!event.isPrimary) return;
    const press = this.press;
    if (this.drag) this.finishDrag(true);
    else if (press && !this.moved) this.click(press);
    this.endPress();
  };

  /** A drag that loses its pointer ends where it last was (spec section 18). */
  private readonly onPointerCancel = (): void => {
    if (this.drag) this.finishDrag(true);
    if (this.press) this.endPress();
  };

  private readonly onPointerLeave = (): void => {
    if (!this.press) {
      this.handlers.hover({ blockId: null, gapStart: null });
      this.canvas.style.cursor = '';
    }
  };

  private endPress(): void {
    this.press = null;
    this.moved = false;
    this.sceneRoot.controls.enabled = true;
    if (this.pointerId !== null && this.canvas.hasPointerCapture(this.pointerId)) {
      this.canvas.releasePointerCapture(this.pointerId);
    }
    this.pointerId = null;
  }

  private click(press: Press): void {
    switch (press.kind) {
      case 'block':
        // Clicking the roof of the top block adds a block above it (spec 12.1).
        if (press.topRoof && press.zone === 'roof') this.handlers.startNew(null);
        else this.handlers.select(press.id);
        break;
      case 'gap':
        this.handlers.startNew(press.range);
        break;
      case 'plot':
        this.handlers.startNew(null);
        break;
      case 'empty':
        this.handlers.select(null);
        break;
    }
  }

  private updateHover(event: PointerEvent): void {
    const hit = this.hitTest(event.clientX, event.clientY);
    const target = hit.tower;
    this.handlers.hover({
      blockId: target?.kind === 'block' ? target.id : null,
      gapStart: target?.kind === 'gap' ? target.range.start : null,
    });
    let cursor = '';
    if (target?.kind === 'block') {
      const block = this.store.findBlock(this.store.viewedDate, target.id);
      const selected = this.handlers.selectedId() === target.id && block !== undefined && !isMeetingBlock(block);
      if (selected && (target.zone === 'roof' || target.zone === 'base') && !(target.topFace && target.id === this.tower.topBlockId)) {
        cursor = 'ns-resize';
      } else if (selected && target.zone === 'body') {
        cursor = 'grab';
      } else {
        cursor = 'pointer';
      }
    } else if (target?.kind === 'gap' || hit.plot) {
      cursor = 'pointer';
    }
    this.canvas.style.cursor = cursor;
  }

  // Drags

  private beginDrag(press: Extract<Press, { kind: 'block' }>): void {
    const block = this.store.findBlock(this.store.viewedDate, press.id);
    if (!block) return;
    if (!press.wasSelected) this.handlers.select(press.id);
    // Outlook owns a meeting's time, so a drag on one only selects it.
    if (isMeetingBlock(block)) return;
    const kind =
      press.wasSelected && press.zone === 'roof' ? 'resize-top'
      : press.wasSelected && press.zone === 'base' ? 'resize-base'
      : 'move';
    // A vertical plane through the tower's axis, facing the camera. The
    // pointer's height on it is the time it points at.
    const normal = new THREE.Vector3();
    this.sceneRoot.camera.getWorldDirection(normal);
    normal.y = 0;
    if (normal.lengthSq() < 1e-8) normal.set(0, 0, 1);
    normal.normalize();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, new THREE.Vector3(0, 0, 0));
    // Measure from where the press began, not where it crossed the drag
    // threshold, so the block follows the pointer's full travel.
    const pointerStart = this.minutesAtClient(this.pressX, this.pressY, plane);
    if (pointerStart === null) return;
    const original = { start: block.start, end: block.end };
    this.drag = { kind, id: block.id, original, pointerStart, plane, current: original };
    this.canvas.style.cursor = kind === 'move' ? 'grabbing' : 'ns-resize';
  }

  private minutesAtClient(clientX: number, clientY: number, plane: THREE.Plane): number | null {
    const ray = this.sceneRoot.pointerRay(clientX, clientY).ray;
    const point = ray.intersectPlane(plane, this.hitPoint);
    return point ? yToMinutes(point.y, this.store.settings) : null;
  }

  private updateDrag(event: PointerEvent): void {
    const drag = this.drag!;
    const minutes = this.minutesAtClient(event.clientX, event.clientY, drag.plane);
    if (minutes === null) return;
    const settings = this.store.settings;
    const slot = settings.slotMinutes;
    const blocks = this.store.blocks;
    const { start, end } = drag.original;
    const length = end - start;
    const delta = minutes - drag.pointerStart;
    // Less than half a slot of travel keeps the block where it was.
    const still = Math.abs(delta) < slot / 2;
    if (drag.kind === 'move') {
      const desired = Math.round((start + delta) / slot) * slot;
      const ghostStart = clamp(desired, settings.dayStart, settings.dayEnd - length);
      const ghost = still ? null : { start: ghostStart, end: ghostStart + length };
      const landing = still ? start : nearestFreeStart(blocks, settings, length, desired, drag.id, delta > 0) ?? start;
      drag.current = { start: landing, end: landing + length };
      // The ghost follows the pointer; an outline marks where the block will
      // land when that is somewhere else (spec 12.4).
      const moves = landing !== start;
      this.handlers.preview({ ghost, landing: moves && ghost?.start !== landing ? drag.current : null });
    } else {
      const limits = resizeLimits(blocks, { id: drag.id, start, end }, settings);
      const minLength = Math.min(slot, length);
      if (drag.kind === 'resize-top') {
        const low = ceilToSlot(start + minLength, slot);
        const high = Math.max(low, floorToSlot(limits.maxEnd, slot));
        const next = clamp(Math.round((end + delta) / slot) * slot, low, high);
        drag.current = { start, end: still ? end : next };
      } else {
        const high = floorToSlot(end - minLength, slot);
        const low = Math.min(high, ceilToSlot(limits.minStart, slot));
        const next = clamp(Math.round((start + delta) / slot) * slot, low, high);
        drag.current = { start: still ? start : next, end };
      }
      const changed = drag.current.start !== start || drag.current.end !== end;
      this.handlers.preview({ ghost: changed ? drag.current : null });
    }
  }

  private finishDrag(commit: boolean): void {
    const drag = this.drag;
    this.drag = null;
    this.canvas.style.cursor = '';
    if (!drag) return;
    this.handlers.preview(null);
    const changed = drag.current.start !== drag.original.start || drag.current.end !== drag.original.end;
    if (commit && changed) this.handlers.commit(drag.id, drag.current);
  }

  // Shift + wheel

  private readonly onWheel = (event: WheelEvent): void => {
    if (!event.shiftKey || event.target !== this.canvas) return;
    const id = this.handlers.selectedId();
    if (!id) return;
    const hit = this.hitTest(event.clientX, event.clientY);
    if (hit.tower?.kind !== 'block' || hit.tower.id !== id) return;
    // Over the selected block, the wheel resizes instead of zooming.
    event.preventDefault();
    event.stopImmediatePropagation();
    // Shift turns a vertical wheel sideways in some browsers.
    const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX;
    const pixels = event.deltaMode === 1 ? delta * 40 : event.deltaMode === 2 ? delta * 800 : delta;
    this.wheelTravel += pixels;
    const steps = Math.trunc(this.wheelTravel / WHEEL_STEP);
    if (steps !== 0) {
      this.wheelTravel -= steps * WHEEL_STEP;
      // Scrolling up (negative delta) lengthens the block.
      this.handlers.stepEnd(id, -steps);
    }
    if (this.wheelTimer !== null) clearTimeout(this.wheelTimer);
    this.wheelTimer = setTimeout(() => {
      this.wheelTravel = 0;
    }, 250);
  };

  dispose(): void {
    this.host.removeEventListener('pointerdown', this.onPointerDown, { capture: true });
    this.host.removeEventListener('wheel', this.onWheel, { capture: true });
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerCancel);
    this.canvas.removeEventListener('lostpointercapture', this.onPointerCancel);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
  }
}

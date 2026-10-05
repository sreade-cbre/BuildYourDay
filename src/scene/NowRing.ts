import * as THREE from 'three';
import { easeInOutCubic } from '../anim/easing';
import { tokens } from '../brand/tokens';
import { BLOCK_FOOTPRINT } from '../core/layout';
import { FONT_BODY, context2d, font } from './canvasText';
import { materials } from './materials';

// The now ring (spec 8.6): a thin blue ring around the tower at the current
// time's height, with a small "now 10:40" card beside it. The card sits on the
// camera's left, away from the block labels on the right. The ring tweens to
// a new height over 0.6 s, or jumps there under reduced motion.

const RING_RADIUS = BLOCK_FOOTPRINT * 0.78;
const TUBE = 0.05;
const TWEEN_SECONDS = 0.6;
const CARD_PX = 15;
const PAD_X = 8;
const PAD_Y = 5;
const PIXEL_RATIO = 2;
/** Gap between the ring and the card, in world units. */
const CARD_GAP = 0.25;

const ringGeometry = new THREE.TorusGeometry(RING_RADIUS, TUBE, 10, 112);

export class NowRing {
  readonly root = new THREE.Group();
  private readonly ring: THREE.Mesh;
  private readonly card: THREE.Sprite;
  private readonly cardMaterial: THREE.SpriteMaterial;
  private readonly canvas = document.createElement('canvas');
  private texture: THREE.CanvasTexture | null = null;
  private text = '';
  private widthPx = 1;
  private heightPx = 1;
  private unitsPerPixel = 0.04;
  private readonly right = new THREE.Vector3(1, 0, 0);
  private from = 0;
  private to = 0;
  private elapsed = 0;
  private duration = 0;

  constructor() {
    this.root.name = 'now-ring';
    this.ring = new THREE.Mesh(ringGeometry, materials.nowRing());
    this.ring.rotation.x = Math.PI / 2;
    this.cardMaterial = new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
    this.card = new THREE.Sprite(this.cardMaterial);
    // Anchored at its right edge, so the card reaches away from the ring.
    this.card.center.set(1, 0.5);
    this.card.renderOrder = 10;
    this.root.add(this.ring, this.card);
    this.root.visible = false;
  }

  get visible(): boolean {
    return this.root.visible;
  }

  /** World height the ring stands at, or is heading to. */
  get targetY(): number {
    return this.to;
  }

  /** World height the ring stands at right now, mid tween included. */
  get y(): number {
    return this.root.position.y;
  }

  /**
   * Shows the ring at a height with its card text. A visible ring tweens to
   * the new height when `animate` is true; a hidden one appears in place.
   */
  show(y: number, text: string, animate: boolean): void {
    this.setText(text);
    const wasVisible = this.root.visible;
    this.root.visible = true;
    if (!wasVisible || !animate || Math.abs(y - this.root.position.y) < 1e-6) {
      this.from = this.to = y;
      this.duration = 0;
      this.root.position.y = y;
      return;
    }
    this.from = this.root.position.y;
    this.to = y;
    this.elapsed = 0;
    this.duration = TWEEN_SECONDS;
  }

  hide(): void {
    this.root.visible = false;
    this.duration = 0;
  }

  /** Advances the height tween. Returns true while the ring is still moving. */
  step(dt: number): boolean {
    if (this.duration <= 0) return false;
    this.elapsed += dt;
    const t = Math.min(1, this.elapsed / this.duration);
    this.root.position.y = this.from + (this.to - this.from) * easeInOutCubic(t);
    if (t >= 1) this.duration = 0;
    return t < 1;
  }

  /** Sizes the card in world units per canvas pixel, like the block labels. */
  setWorldScale(unitsPerPixel: number): void {
    this.unitsPerPixel = unitsPerPixel;
    this.card.scale.set(this.widthPx * unitsPerPixel, this.heightPx * unitsPerPixel, 1);
  }

  /** Keeps the card on the camera's left of the ring. Runs before each render. */
  updateForCamera(camera: THREE.Camera): void {
    if (!this.root.visible) return;
    this.right.setFromMatrixColumn(camera.matrixWorld, 0);
    this.right.y = 0;
    if (this.right.lengthSq() < 1e-8) this.right.set(1, 0, 0);
    this.right.normalize();
    const reach = RING_RADIUS + TUBE + CARD_GAP;
    this.card.position.set(-this.right.x * reach, 0, -this.right.z * reach);
  }

  private setText(text: string): void {
    if (text === this.text) return;
    this.text = text;
    const ctx = context2d(this.canvas);
    const cardFont = font(CARD_PX, FONT_BODY);
    ctx.font = cardFont;
    const width = Math.ceil(ctx.measureText(text).width + PAD_X * 2);
    const height = CARD_PX + PAD_Y * 2 + 2;
    const resized = width !== this.widthPx || height !== this.heightPx;
    this.widthPx = width;
    this.heightPx = height;
    this.canvas.width = width * PIXEL_RATIO;
    this.canvas.height = height * PIXEL_RATIO;
    ctx.setTransform(PIXEL_RATIO, 0, 0, PIXEL_RATIO, 0, 0);
    ctx.beginPath();
    ctx.roundRect(0.5, 0.5, width - 1, height - 1, 5);
    ctx.fillStyle = tokens.white;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = tokens.blue;
    ctx.stroke();
    ctx.font = cardFont;
    ctx.fillStyle = tokens.blue;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, PAD_X, height / 2 + 0.5);
    if (!this.texture || resized) {
      // A canvas that changed size needs a new texture (see Label).
      this.texture?.dispose();
      this.texture = new THREE.CanvasTexture(this.canvas);
      this.texture.colorSpace = THREE.SRGBColorSpace;
      this.cardMaterial.map = this.texture;
      this.cardMaterial.needsUpdate = true;
    } else {
      this.texture.needsUpdate = true;
    }
    this.setWorldScale(this.unitsPerPixel);
  }

  dispose(): void {
    this.texture?.dispose();
    this.cardMaterial.dispose();
    this.root.removeFromParent();
  }
}

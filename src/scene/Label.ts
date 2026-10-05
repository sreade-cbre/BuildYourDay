import * as THREE from 'three';
import { tokens } from '../brand/tokens';
import { FONT_BODY, FONT_HEADING, context2d, font, truncateToWidth } from './canvasText';

// A block label (spec sections 5.6 and 8.5): a camera-facing sprite with the
// title on line one and times on line two, on a white card at 85% opacity.
// The canvas is redrawn only when the text changes.

export interface LabelText {
  title: string;
  detail: string;
}

const PIXEL_RATIO = 2;
const TITLE_PX = 20;
const DETAIL_PX = 16;
const TITLE_LINE = 24;
const DETAIL_LINE = 19;
const PAD_X = 12;
const PAD_Y = 5;
const LINE_GAP = 1;
const RADIUS = 6;
const CARD_OPACITY = 0.85;
const MAX_TITLE_WIDTH = 300;
const MAX_DETAIL_WIDTH = 360;

export class Label {
  readonly sprite: THREE.Sprite;
  private readonly material: THREE.SpriteMaterial;
  private readonly canvas = document.createElement('canvas');
  private texture: THREE.CanvasTexture | null = null;
  private key = '';
  /** Card size in canvas pixels at 1x. */
  widthPx = 1;
  heightPx = 1;

  constructor() {
    this.material = new THREE.SpriteMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    this.sprite = new THREE.Sprite(this.material);
    // Anchor at the left middle so the card extends away from the tower.
    this.sprite.center.set(0, 0.5);
    this.sprite.renderOrder = 10;
  }

  setText(text: LabelText): void {
    const key = `${text.title}\n${text.detail}`;
    if (key === this.key) return;
    this.key = key;
    this.draw(text);
  }

  /** Sizes the sprite in world units per canvas pixel. */
  setWorldScale(unitsPerPixel: number): void {
    this.sprite.scale.set(this.widthPx * unitsPerPixel, this.heightPx * unitsPerPixel, 1);
  }

  setOpacity(opacity: number): void {
    this.material.opacity = opacity;
  }

  private draw(text: LabelText): void {
    const ctx = context2d(this.canvas);
    const titleFont = font(TITLE_PX, FONT_HEADING, true);
    const detailFont = font(DETAIL_PX, FONT_BODY);

    ctx.font = titleFont;
    const title = truncateToWidth(ctx, text.title, MAX_TITLE_WIDTH);
    const titleWidth = ctx.measureText(title).width;
    ctx.font = detailFont;
    const detail = truncateToWidth(ctx, text.detail, MAX_DETAIL_WIDTH);
    const detailWidth = ctx.measureText(detail).width;

    const width = Math.ceil(Math.max(titleWidth, detailWidth) + PAD_X * 2);
    const height = PAD_Y * 2 + TITLE_LINE + LINE_GAP + DETAIL_LINE;
    const resized = width !== this.widthPx || height !== this.heightPx;
    this.widthPx = width;
    this.heightPx = height;

    // Setting the size also clears the canvas and resets the context.
    this.canvas.width = width * PIXEL_RATIO;
    this.canvas.height = height * PIXEL_RATIO;
    ctx.setTransform(PIXEL_RATIO, 0, 0, PIXEL_RATIO, 0, 0);

    ctx.beginPath();
    ctx.roundRect(0.5, 0.5, width - 1, height - 1, RADIUS);
    ctx.globalAlpha = CARD_OPACITY;
    ctx.fillStyle = tokens.white;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
    ctx.strokeStyle = tokens.slatePale;
    ctx.stroke();

    ctx.fillStyle = tokens.slate;
    ctx.textBaseline = 'middle';
    ctx.font = titleFont;
    ctx.fillText(title, PAD_X, PAD_Y + TITLE_LINE / 2);
    ctx.font = detailFont;
    ctx.fillText(detail, PAD_X, PAD_Y + TITLE_LINE + LINE_GAP + DETAIL_LINE / 2);

    if (!this.texture || resized) {
      // three allocates fixed size texture storage on first upload, so a
      // canvas that changed size needs a new texture.
      this.texture?.dispose();
      this.texture = new THREE.CanvasTexture(this.canvas);
      this.texture.colorSpace = THREE.SRGBColorSpace;
      this.material.map = this.texture;
      this.material.needsUpdate = true;
    } else {
      this.texture.needsUpdate = true;
    }
  }

  dispose(): void {
    this.sprite.removeFromParent();
    this.texture?.dispose();
    this.material.dispose();
  }
}

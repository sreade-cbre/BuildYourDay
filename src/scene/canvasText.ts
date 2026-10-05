// Helpers for text drawn into CanvasTexture images (spec sections 5.5 and 5.6).

export const FONT_HEADING = "Georgia, 'Times New Roman', serif";
export const FONT_BODY = 'Verdana, Geneva, sans-serif';

/** A CSS font string, for example "bold 20px Georgia, serif". */
export function font(sizePx: number, family: string, bold = false): string {
  return `${bold ? 'bold ' : ''}${sizePx}px ${family}`;
}

const ELLIPSIS = '…';

/** Shortens text with an ellipsis so it fits `maxWidth` in the current font. */
export function truncateToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    const candidate = `${text.slice(0, mid).trimEnd()}${ELLIPSIS}`;
    if (ctx.measureText(candidate).width <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return `${text.slice(0, low).trimEnd()}${ELLIPSIS}`;
}

/** A 2D context, or an error that names the problem. */
export function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable, so in-scene text cannot be drawn.');
  return ctx;
}

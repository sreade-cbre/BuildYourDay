// Small helpers for building the overlay without a UI framework.

type Child = Node | string | null | undefined | false;

export interface ElementOptions {
  class?: string;
  text?: string;
  attrs?: Record<string, string | number | boolean | undefined>;
}

/** Creates an element with classes, text, attributes, and children. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.class) node.className = options.class;
  if (options.text !== undefined) node.textContent = options.text;
  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    if (value === undefined || value === false) continue;
    node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

/** A button with visible text and an optional click handler. */
export function button(text: string, className: string, onClick?: (event: MouseEvent) => void): HTMLButtonElement {
  const node = h('button', { class: className, text, attrs: { type: 'button' } });
  if (onClick) node.addEventListener('click', onClick);
  return node;
}

const SVG = 'http://www.w3.org/2000/svg';

/** A toothed gear outline, built once: 8 teeth around a small hole. */
function gearPath(): string {
  const points: string[] = [];
  const steps = 32;
  for (let k = 0; k < steps; k++) {
    const angle = (k / steps) * Math.PI * 2;
    const radius = k % 4 === 1 || k % 4 === 2 ? 10 : 7.4;
    points.push(`${(12 + radius * Math.cos(angle)).toFixed(2)} ${(12 + radius * Math.sin(angle)).toFixed(2)}`);
  }
  return `M${points.join('L')}Z`;
}

/** Line icons drawn in currentColor, so they follow the theme. */
const ICONS: Record<string, string[]> = {
  previous: ['M15 18l-6-6 6-6'],
  next: ['M9 18l6-6-6-6'],
  close: ['M18 6L6 18', 'M6 6l12 12'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  settings: [gearPath(), 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z'],
};

export type IconName = keyof typeof ICONS;

export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', name === 'more' ? '3.5' : '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of ICONS[name] ?? []) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/** An icon-only button. The label is its accessible name and tooltip. */
export function iconButton(name: IconName, label: string, onClick?: (event: MouseEvent) => void): HTMLButtonElement {
  const node = h('button', { class: 'icon-button', attrs: { type: 'button', 'aria-label': label, title: label } }, icon(name));
  if (onClick) node.addEventListener('click', onClick);
  return node;
}

/** True when keyboard focus is in a control that uses typing or arrow keys. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = (target as HTMLInputElement).type;
  return !['button', 'checkbox', 'radio', 'submit', 'reset', 'file', 'color'].includes(type);
}

/** Every element inside `root` that can take keyboard focus, in order. */
export function focusables(root: HTMLElement): HTMLElement[] {
  const selector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return [...root.querySelectorAll<HTMLElement>(selector)].filter((el) => !el.hidden && el.offsetParent !== null);
}

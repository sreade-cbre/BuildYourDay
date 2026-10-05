import { h } from './dom';

// Live renderer counts, toggled with D (spec section 16). Used to confirm the
// geometry count returns to its baseline after edits.

export interface DebugStats {
  geometries: number;
  textures: number;
  calls: number;
  triangles: number;
  materials: number;
}

export class DebugPanel {
  private readonly panel: HTMLElement;
  private readonly lines: HTMLElement;

  constructor(host: HTMLElement) {
    this.lines = h('pre', { class: 'debug__lines' });
    this.panel = h('section', { class: 'debug panel', attrs: { 'aria-label': 'Renderer statistics' } }, this.lines);
    this.panel.hidden = true;
    host.append(this.panel);
  }

  get visible(): boolean {
    return !this.panel.hidden;
  }

  toggle(): void {
    this.panel.hidden = !this.panel.hidden;
  }

  update(stats: DebugStats): void {
    if (this.panel.hidden) return;
    this.lines.textContent = [
      `Geometries ${stats.geometries}`,
      `Textures ${stats.textures}`,
      `Shared materials ${stats.materials}`,
      `Draw calls ${stats.calls}`,
      `Triangles ${stats.triangles}`,
    ].join('\n');
  }
}

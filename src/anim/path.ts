// Ground paths for workers and machines (spec section 9.5): straight segments
// joined by quarter turns. Position follows the segments exactly; the heading
// eases around each corner so a body turns instead of snapping.

export interface Point2 {
  x: number;
  z: number;
}

export interface PathSample {
  x: number;
  z: number;
  /** Rotation about y that points a model's +z along the direction of travel. */
  heading: number;
}

function headingOf(from: Point2, to: Point2): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

/** Shortest signed angle from a to b. */
export function angleBetween(a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

export class Path {
  readonly points: readonly Point2[];
  readonly length: number;
  private readonly cumulative: number[];
  private readonly headings: number[];

  constructor(points: readonly Point2[]) {
    if (points.length < 2) throw new Error('A path needs at least two points.');
    this.points = points.map((p) => ({ ...p }));
    this.cumulative = [0];
    this.headings = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      this.cumulative.push(this.cumulative[i - 1]! + Math.hypot(b.x - a.x, b.z - a.z));
      this.headings.push(headingOf(a, b));
    }
    this.length = this.cumulative[this.cumulative.length - 1]!;
  }

  /** The same path walked backward. */
  reversed(): Path {
    return new Path([...this.points].reverse());
  }

  /**
   * Position and heading at a distance along the path. `turn` is how far
   * before and after a corner the heading blends between the two segments.
   */
  at(distance: number, turn = 0.3): PathSample {
    const d = Math.min(Math.max(distance, 0), this.length);
    let index = 0;
    while (index < this.headings.length - 1 && d > this.cumulative[index + 1]!) index++;
    const a = this.points[index]!;
    const b = this.points[index + 1]!;
    const segment = this.cumulative[index + 1]! - this.cumulative[index]!;
    const local = segment > 0 ? (d - this.cumulative[index]!) / segment : 0;
    const x = a.x + (b.x - a.x) * local;
    const z = a.z + (b.z - a.z) * local;

    let heading = this.headings[index]!;
    if (turn > 0) {
      // Approaching the next corner: lean toward the next segment.
      const toEnd = this.cumulative[index + 1]! - d;
      const next = this.headings[index + 1];
      if (next !== undefined && toEnd < turn) {
        heading += angleBetween(heading, next) * 0.5 * (1 - toEnd / turn);
      }
      // Leaving the last corner: finish turning from the previous segment.
      const fromStart = d - this.cumulative[index]!;
      const previous = this.headings[index - 1];
      if (previous !== undefined && fromStart < turn) {
        heading = this.headings[index]! + angleBetween(this.headings[index]!, previous) * 0.5 * (1 - fromStart / turn);
      }
    }
    return { x, z, heading };
  }

  /** Position and heading at a fraction of the path's length. */
  atFraction(u: number, turn?: number): PathSample {
    return this.at(u * this.length, turn);
  }
}

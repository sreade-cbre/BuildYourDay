import * as THREE from 'three';
import { colorOf } from '../materials';

// Dust puffs (spec 10.5): bursts of 24 to 60 lightGray particles that rise and
// spread, fall under gravity -1.5, and fade and shrink over 0.6 s. Three
// pooled emitters; a fourth puff reuses the oldest.

const EMITTERS = 3;
const MAX_PARTICLES = 60;
const LIFETIME = 0.6;
const GRAVITY = -1.5;

class Emitter {
  readonly points: THREE.Points;
  private readonly positions = new Float32Array(MAX_PARTICLES * 3);
  private readonly velocities = new Float32Array(MAX_PARTICLES * 3);
  private readonly material: THREE.PointsMaterial;
  private readonly geometry = new THREE.BufferGeometry();
  age = Infinity;

  constructor() {
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setDrawRange(0, 0);
    this.material = new THREE.PointsMaterial({
      color: colorOf('lightGray'),
      size: 0.1,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  get active(): boolean {
    return this.age < LIFETIME;
  }

  fire(origin: THREE.Vector3, count: number, spread: number, rng: () => number): void {
    const n = Math.max(24, Math.min(MAX_PARTICLES, Math.round(count)));
    for (let i = 0; i < n; i++) {
      const angle = rng() * Math.PI * 2;
      const out = (0.3 + rng() * 0.7) * spread;
      this.positions.set([origin.x + (rng() - 0.5) * 0.1, origin.y + rng() * 0.05, origin.z + (rng() - 0.5) * 0.1], i * 3);
      this.velocities.set([Math.cos(angle) * out, 0.5 + rng() * 0.9, Math.sin(angle) * out], i * 3);
    }
    this.geometry.setDrawRange(0, n);
    this.geometry.getAttribute('position').needsUpdate = true;
    this.age = 0;
    this.points.visible = true;
    this.apply();
  }

  update(dt: number): void {
    if (!this.active) return;
    this.age += dt;
    if (!this.active) {
      this.points.visible = false;
      return;
    }
    const n = this.geometry.drawRange.count;
    for (let i = 0; i < n; i++) {
      this.velocities[i * 3 + 1]! += GRAVITY * dt;
      this.positions[i * 3]! += this.velocities[i * 3]! * dt;
      this.positions[i * 3 + 1]! += this.velocities[i * 3 + 1]! * dt;
      this.positions[i * 3 + 2]! += this.velocities[i * 3 + 2]! * dt;
    }
    this.geometry.getAttribute('position').needsUpdate = true;
    this.apply();
  }

  private apply(): void {
    const t = Math.min(1, this.age / LIFETIME);
    this.material.opacity = 0.9 * (1 - t);
    this.material.size = 0.1 + (0.03 - 0.1) * t;
  }

  clear(): void {
    this.age = Infinity;
    this.points.visible = false;
  }
}

export class Dust {
  readonly root = new THREE.Group();
  private readonly emitters: Emitter[] = [];
  private next = 0;

  constructor() {
    this.root.name = 'dust';
    for (let i = 0; i < EMITTERS; i++) {
      const emitter = new Emitter();
      this.emitters.push(emitter);
      this.root.add(emitter.points);
    }
  }

  /** A burst at a point. `spread` is the outward speed. */
  puff(origin: THREE.Vector3, rng: () => number, count = 36, spread = 0.7): void {
    // Prefer an idle emitter; otherwise reuse the oldest.
    const idle = this.emitters.find((e) => !e.active);
    const emitter = idle ?? this.emitters[this.next]!;
    if (!idle) this.next = (this.next + 1) % EMITTERS;
    emitter.fire(origin, count, spread, rng);
  }

  /** True while any puff is still in the air. */
  update(dt: number): boolean {
    let active = false;
    for (const emitter of this.emitters) {
      emitter.update(dt);
      active ||= emitter.active;
    }
    return active;
  }

  clear(): void {
    for (const emitter of this.emitters) emitter.clear();
  }
}

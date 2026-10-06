import * as THREE from 'three';
import { colorOf } from '../materials';

// Welding and grinding sparks at the joints the crew is fixing: small bursts
// of bright points that spray out, fall fast, and wink out within a third of
// a second. Pooled like the dust; a burst beyond the pool reuses the oldest.

const EMITTERS = 6;
const PER_BURST = 14;
const LIFETIME = 0.35;
const GRAVITY = -6;

class Burst {
  readonly points: THREE.Points;
  private readonly positions = new Float32Array(PER_BURST * 3);
  private readonly velocities = new Float32Array(PER_BURST * 3);
  private readonly material: THREE.PointsMaterial;
  private readonly geometry = new THREE.BufferGeometry();
  age = Infinity;

  constructor(color: THREE.Color) {
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.PointsMaterial({ color, size: 0.045, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  get active(): boolean {
    return this.age < LIFETIME;
  }

  fire(origin: THREE.Vector3, rng: () => number): void {
    for (let i = 0; i < PER_BURST; i++) {
      this.positions.set([origin.x, origin.y, origin.z], i * 3);
      const angle = rng() * Math.PI * 2;
      const speed = 0.4 + rng() * 0.9;
      this.velocities.set([Math.cos(angle) * speed, 0.3 + rng() * 0.9, Math.sin(angle) * speed], i * 3);
    }
    this.geometry.attributes.position!.needsUpdate = true;
    this.age = 0;
    this.points.visible = true;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.age += dt;
    if (!this.active) {
      this.points.visible = false;
      return;
    }
    for (let i = 0; i < PER_BURST; i++) {
      this.velocities[i * 3 + 1]! += GRAVITY * dt;
      for (let k = 0; k < 3; k++) this.positions[i * 3 + k]! += this.velocities[i * 3 + k]! * dt;
    }
    this.geometry.attributes.position!.needsUpdate = true;
    this.material.opacity = 1 - this.age / LIFETIME;
  }

  clear(): void {
    this.age = Infinity;
    this.points.visible = false;
  }
}

export class Sparks {
  readonly root = new THREE.Group();
  private readonly bursts: Burst[] = [];
  private next = 0;

  constructor() {
    this.root.name = 'sparks';
    for (let i = 0; i < EMITTERS; i++) {
      // Alternate white and pale blue, so the sparks read hot but stay on brand.
      const burst = new Burst(colorOf(i % 2 ? 'white' : 'bluePale'));
      this.bursts.push(burst);
      this.root.add(burst.points);
    }
  }

  burst(origin: THREE.Vector3, rng: () => number): void {
    const idle = this.bursts.find((b) => !b.active);
    const burst = idle ?? this.bursts[this.next]!;
    if (!idle) this.next = (this.next + 1) % EMITTERS;
    burst.fire(origin, rng);
  }

  /** True while any spark is still in the air. */
  update(dt: number): boolean {
    let active = false;
    for (const burst of this.bursts) {
      burst.update(dt);
      active ||= burst.active;
    }
    return active;
  }

  clear(): void {
    for (const burst of this.bursts) burst.clear();
  }
}

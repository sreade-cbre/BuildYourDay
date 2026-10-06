import * as THREE from 'three';
import { materials } from '../materials';
import { CYCLE, blendPoses, poseFor, type Pose, type WorkerAnim } from './workerAnims';

// A construction worker built from primitives (spec section 10.1), with named
// pivots for the animations in workerAnims.ts. Built at the spec's part sizes,
// which stack to about 0.71 units, then scaled to the specified 0.55 tall.

export const WORKER_HEIGHT = 0.55;
const BUILT_HEIGHT = 0.71;
const BLEND_SECONDS = 0.15;

/** Shared by every worker in the pool. */
const geometry = {
  torso: new THREE.CapsuleGeometry(0.08, 0.14, 4, 8),
  head: new THREE.SphereGeometry(0.07, 12, 10),
  hat: new THREE.SphereGeometry(0.08, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  brim: new THREE.CylinderGeometry(0.1, 0.1, 0.015, 16),
  upperArm: new THREE.CylinderGeometry(0.022, 0.022, 0.12).translate(0, -0.06, 0),
  forearm: new THREE.CylinderGeometry(0.02, 0.02, 0.11).translate(0, -0.055, 0),
  thigh: new THREE.CylinderGeometry(0.028, 0.028, 0.13).translate(0, -0.065, 0),
  shin: new THREE.CylinderGeometry(0.025, 0.025, 0.12).translate(0, -0.06, 0),
  boot: new THREE.BoxGeometry(0.06, 0.03, 0.09).translate(0, -0.015, 0.012),
  hammerHandle: new THREE.CylinderGeometry(0.008, 0.008, 0.12).rotateX(Math.PI / 2).translate(0, 0, 0.06),
  hammerHead: new THREE.BoxGeometry(0.05, 0.025, 0.025),
  board: new THREE.BoxGeometry(1.2, 0.03, 0.08),
  plank: new THREE.BoxGeometry(0.14, 0.03, 0.95),
};

function part(geo: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  return mesh;
}

export class Worker {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly torso: THREE.Mesh;
  private readonly neck = new THREE.Group();
  private readonly shoulderL = new THREE.Group();
  private readonly shoulderR = new THREE.Group();
  private readonly elbowL = new THREE.Group();
  private readonly elbowR = new THREE.Group();
  private readonly hipL = new THREE.Group();
  private readonly hipR = new THREE.Group();
  private readonly kneeL = new THREE.Group();
  private readonly kneeR = new THREE.Group();
  private readonly hammer = new THREE.Group();
  private readonly board: THREE.Mesh;
  private readonly plank: THREE.Mesh;
  private anim: WorkerAnim = 'idle';
  private phase = 0;
  private current: Pose = poseFor('idle', 0);
  private blendFrom: Pose | null = null;
  private blendElapsed = 0;
  /**
   * How quickly the worker turns to a new heading, as a rate of easing in;
   * 0 turns at once. The live crew turns smoothly; a job's crew snaps.
   */
  turnEase = 0;
  private heading = 0;
  /** True until placed after being hidden, so a worker who appears faces the right way at once. */
  private fresh = true;

  constructor(name: string) {
    this.root.name = name;
    this.root.visible = false;
    this.body.scale.setScalar(WORKER_HEIGHT / BUILT_HEIGHT);
    this.root.add(this.body);

    const navy = materials.solid('navy');
    const skin = materials.solid('slateLight');
    const dark = materials.solid('slateDark');
    const white = materials.solid('white');

    this.torso = part(geometry.torso, materials.vest());
    this.torso.position.y = 0.4;
    this.body.add(this.torso);

    this.neck.position.y = 0.55;
    const head = part(geometry.head, skin);
    head.position.y = 0.06;
    const hat = part(geometry.hat, white);
    hat.position.y = 0.08;
    const brim = part(geometry.brim, white);
    brim.position.y = 0.08;
    this.neck.add(head, hat, brim);
    this.body.add(this.neck);

    for (const [shoulder, elbow, side] of [
      [this.shoulderL, this.elbowL, 1],
      [this.shoulderR, this.elbowR, -1],
    ] as const) {
      shoulder.position.set(0.1 * side, 0.5, 0);
      shoulder.add(part(geometry.upperArm, navy));
      elbow.position.y = -0.12;
      elbow.add(part(geometry.forearm, skin));
      shoulder.add(elbow);
      this.body.add(shoulder);
    }

    for (const [hip, knee, side] of [
      [this.hipL, this.kneeL, 1],
      [this.hipR, this.kneeR, -1],
    ] as const) {
      hip.position.set(0.045 * side, 0.28, 0);
      hip.add(part(geometry.thigh, navy));
      knee.position.y = -0.13;
      knee.add(part(geometry.shin, dark));
      const boot = part(geometry.boot, dark);
      boot.position.y = -0.12;
      knee.add(boot);
      hip.add(knee);
      this.body.add(hip);
    }

    // The hammer sits in the right hand.
    this.hammer.position.y = -0.11;
    this.hammer.add(part(geometry.hammerHandle, dark));
    const headMesh = part(geometry.hammerHead, dark);
    headMesh.position.z = 0.12;
    this.hammer.add(headMesh);
    this.hammer.visible = false;
    this.elbowR.add(this.hammer);

    // The screed board is held level in front of the body.
    this.board = part(geometry.board, materials.solid('slatePale'));
    this.board.position.set(0, 0.33, 0.2);
    this.board.visible = false;
    this.body.add(this.board);

    // A plank carried in both hands, running front to back.
    this.plank = part(geometry.plank, materials.solid('slatePale'));
    this.plank.position.set(0, 0.36, 0.22);
    this.plank.visible = false;
    this.body.add(this.plank);
  }

  get visible(): boolean {
    return this.root.visible;
  }

  show(): void {
    this.root.visible = true;
  }

  /** Scales the whole worker, for popping onto and off a scaffold. */
  setScale(scale: number): void {
    this.root.scale.setScalar(Math.max(0.001, scale));
  }

  hide(): void {
    this.root.visible = false;
    this.fresh = true;
    this.root.scale.setScalar(1);
    this.hammer.visible = false;
    this.board.visible = false;
    this.plank.visible = false;
  }

  /** Places the worker's feet at a point, facing a heading. */
  place(x: number, y: number, z: number, heading: number): void {
    this.root.position.set(x, y, z);
    this.heading = heading;
    if (this.turnEase > 0 && !this.fresh) return;
    this.root.rotation.y = heading;
    this.fresh = false;
  }

  /**
   * Plays an animation at a phase (in cycles). Changing animation blends
   * from the current pose over 0.15 s (spec 10.2).
   */
  setAnimation(anim: WorkerAnim, cycles: number): void {
    if (anim !== this.anim) {
      this.blendFrom = { ...this.current };
      this.blendElapsed = 0;
      this.anim = anim;
    }
    this.phase = cycles;
    this.hammer.visible = anim === 'hammer';
    this.board.visible = anim === 'screed';
    this.plank.visible = anim === 'carry';
  }

  /** Plays an animation by elapsed seconds instead of cycles. */
  setAnimationAt(anim: WorkerAnim, seconds: number): void {
    this.setAnimation(anim, seconds / CYCLE[anim]);
  }

  /** Applies the pose. Runs every frame while the worker is visible. */
  update(dt: number): void {
    if (!this.root.visible) return;
    if (this.turnEase > 0) {
      const r = this.root.rotation.y;
      const turn = Math.atan2(Math.sin(this.heading - r), Math.cos(this.heading - r));
      this.root.rotation.y = r + turn * (1 - Math.exp(-this.turnEase * dt));
    }
    const target = poseFor(this.anim, this.phase);
    if (this.blendFrom) {
      this.blendElapsed += dt;
      const t = Math.min(1, this.blendElapsed / BLEND_SECONDS);
      this.current = blendPoses(this.blendFrom, target, t);
      if (t >= 1) this.blendFrom = null;
    } else {
      this.current = target;
    }
    this.apply(this.current);
  }

  private apply(pose: Pose): void {
    this.body.position.set(pose.shuffle, pose.bob, 0);
    this.torso.rotation.x = pose.lean;
    this.neck.rotation.x = pose.neck * 0.5 + pose.lean * 0.6;
    this.neck.position.z = Math.sin(pose.lean) * 0.15;
    this.neck.position.y = 0.55 - (1 - Math.cos(pose.lean)) * 0.15;
    for (const shoulder of [this.shoulderL, this.shoulderR]) {
      shoulder.position.z = Math.sin(pose.lean) * 0.1;
      shoulder.position.y = 0.5 - (1 - Math.cos(pose.lean)) * 0.1;
    }
    this.shoulderL.rotation.set(pose.shoulderL, 0, pose.shoulderOutL);
    this.shoulderR.rotation.set(pose.shoulderR, 0, 0);
    this.elbowL.rotation.x = pose.elbowL;
    this.elbowR.rotation.x = pose.elbowR;
    this.hipL.rotation.x = pose.hipL;
    this.hipR.rotation.x = pose.hipR;
    this.kneeL.rotation.x = pose.kneeL;
    this.kneeR.rotation.x = pose.kneeR;
  }
}

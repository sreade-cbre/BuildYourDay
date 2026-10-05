import * as THREE from 'three';
import { materials } from '../materials';
import { Wheel, box, glass, type Drive } from './parts';

// Excavator (spec 10.3): track base, a house that swings, and a boom, stick,
// and bucket on pivots. Faces +z.

export interface ArmPose {
  /** House rotation about y, radians. */
  swing: number;
  /** Boom pitch, -40 to +30 degrees (in radians); positive lowers the boom. */
  boom: number;
  /** Stick, 0 to 110 degrees; larger reaches out and down. */
  stick: number;
  /** Bucket curl, 0 to 150 degrees. */
  bucket: number;
}

const deg = (d: number) => (d * Math.PI) / 180;

export const ARM_REST: ArmPose = { swing: 0, boom: deg(-30), stick: deg(40), bucket: deg(60) };

export class Excavator {
  readonly root = new THREE.Group();
  private readonly house = new THREE.Group();
  private readonly boom = new THREE.Group();
  private readonly stick = new THREE.Group();
  private readonly bucket = new THREE.Group();
  private readonly wheels: Wheel[] = [];

  constructor() {
    this.root.name = 'excavator';
    const dark = materials.solid('slateDark');
    for (const side of [-1, 1]) {
      const track = box(0.24, 0.24, 1.15, dark);
      track.position.set(0.38 * side, 0.12, 0);
      this.root.add(track);
      for (const z of [-0.38, 0, 0.38]) {
        const wheel = new Wheel(0.085, 0.04);
        wheel.root.position.set(0.52 * side, 0.12, z);
        this.wheels.push(wheel);
        this.root.add(wheel.root);
      }
    }

    this.house.position.y = 0.26;
    const deck = box(0.86, 0.3, 0.86, materials.solid('blue'));
    deck.position.set(0, 0.17, -0.06);
    const cab = box(0.36, 0.36, 0.38, materials.solid('blueDark'));
    cab.position.set(0.2, 0.5, 0.12);
    const window = box(0.38, 0.16, 0.3, glass());
    window.position.set(0.2, 0.55, 0.14);
    const counterweight = box(0.8, 0.22, 0.2, materials.solid('navy'));
    counterweight.position.set(0, 0.25, -0.46);
    this.house.add(deck, cab, window, counterweight);

    const arm = materials.solid('navy');
    this.boom.position.set(-0.16, 0.36, 0.32);
    const boomBeam = box(0.12, 0.12, 0.95, arm);
    boomBeam.position.z = 0.47;
    this.boom.add(boomBeam);
    this.stick.position.z = 0.94;
    const stickBeam = box(0.1, 0.6, 0.1, arm);
    stickBeam.position.y = -0.3;
    this.stick.add(stickBeam);
    this.bucket.position.y = -0.6;
    const scoop = box(0.3, 0.16, 0.22, materials.solid('slateDark'));
    scoop.position.set(0, -0.06, 0.08);
    const lip = box(0.32, 0.04, 0.06, materials.solid('slatePale'));
    lip.position.set(0, -0.14, 0.18);
    this.bucket.add(scoop, lip);
    this.stick.add(this.bucket);
    this.boom.add(this.stick);
    this.house.add(this.boom);
    this.root.add(this.house);
    this.setArm(ARM_REST);
  }

  setArm(pose: ArmPose): void {
    this.house.rotation.y = pose.swing;
    this.boom.rotation.x = pose.boom;
    this.stick.rotation.x = pose.stick;
    this.bucket.rotation.x = pose.bucket;
  }

  /** World position of the bucket, for dust. */
  bucketWorld(target: THREE.Vector3): THREE.Vector3 {
    return this.bucket.getWorldPosition(target);
  }

  drive(state: Drive, y: number): void {
    this.root.position.set(state.x, y, state.z);
    this.root.rotation.y = state.heading;
    for (const wheel of this.wheels) wheel.roll(state.distance);
  }
}

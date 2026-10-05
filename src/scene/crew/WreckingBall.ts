import * as THREE from 'three';
import { materials } from '../materials';

// Wrecking ball (spec 10.3): a slateDark ball of radius 0.3 on a short chain
// below the crane hook. It swings like a pendulum in the y-z plane, so it can
// come at a block's front face from outside the tower.

export const BALL_RADIUS = 0.3;
/** Chain length from the hook to the ball's center. */
export const CHAIN_LENGTH = 1.4;

const chainGeometry = new THREE.CylinderGeometry(0.015, 0.015, 1, 6).translate(0, -0.5, 0);
const ballGeometry = new THREE.SphereGeometry(BALL_RADIUS, 18, 14);

export class WreckingBall {
  readonly root = new THREE.Group();
  private readonly pendulum = new THREE.Group();

  constructor() {
    this.root.name = 'wrecking-ball';
    const material = materials.solid('slateDark', 0.6);
    const chain = new THREE.Mesh(chainGeometry, material);
    chain.scale.y = CHAIN_LENGTH - BALL_RADIUS;
    const ball = new THREE.Mesh(ballGeometry, material);
    ball.position.y = -CHAIN_LENGTH;
    ball.castShadow = true;
    this.pendulum.add(chain, ball);
    this.root.add(this.pendulum);
    this.root.visible = false;
  }

  /**
   * Hangs the ball from a pivot at `angle` radians from straight down.
   * Negative angles swing it toward +z, positive toward -z.
   */
  set(pivot: THREE.Vector3, angle: number): void {
    this.root.visible = true;
    this.root.position.copy(pivot);
    this.pendulum.rotation.x = angle;
  }

  /** World position of the ball's center for a pivot and angle. */
  static center(pivot: THREE.Vector3, angle: number, target: THREE.Vector3): THREE.Vector3 {
    return target.set(pivot.x, pivot.y - CHAIN_LENGTH * Math.cos(angle), pivot.z - CHAIN_LENGTH * Math.sin(angle));
  }

  hide(): void {
    this.root.visible = false;
  }
}

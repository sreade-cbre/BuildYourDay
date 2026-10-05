import * as THREE from 'three';
import type { SwatchToken } from '../../core/model';
import { RUBBLE_MAX } from '../../anim/jobs/schedule';
import { materials } from '../materials';

// Demolition rubble (spec 11.1): up to 400 cubes in one InstancedMesh, in the
// demolished block's category color. The material lives as long as the site
// and is recolored per job, so a demolition compiles no shaders.

const cubeGeometry = new THREE.BoxGeometry(1, 1, 1);

export class Rubble {
  readonly mesh: THREE.InstancedMesh;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();

  constructor() {
    this.material = materials.blockBody('navy').clone();
    this.material.transparent = true;
    this.material.polygonOffset = false;
    this.mesh = new THREE.InstancedMesh(cubeGeometry, this.material, RUBBLE_MAX);
    this.mesh.name = 'rubble';
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  /** Readies `count` cubes in a category's color. */
  setup(token: SwatchToken, count: number): void {
    this.material.color.copy(materials.blockBody(token).color);
    this.material.opacity = 1;
    this.mesh.count = Math.min(RUBBLE_MAX, count);
  }

  /** Places one cube: center, tumble angles, and edge length. */
  setCube(index: number, x: number, y: number, z: number, rx: number, rz: number, edge: number): void {
    this.position.set(x, y, z);
    this.quaternion.setFromEuler(this.euler.set(rx, 0, rz));
    this.scale.setScalar(Math.max(0.001, edge));
    this.mesh.setMatrixAt(index, this.matrix.compose(this.position, this.quaternion, this.scale));
  }

  /** Uploads the cube placements made since the last call. */
  commit(): void {
    this.mesh.visible = this.mesh.count > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  setOpacity(opacity: number): void {
    this.material.opacity = opacity;
    this.mesh.visible = this.mesh.count > 0 && opacity > 0.01;
  }

  hide(): void {
    this.mesh.count = 0;
    this.mesh.visible = false;
  }
}

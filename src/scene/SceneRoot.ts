import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { easeInOutCubic } from '../anim/easing';
import { BLOCK_FOOTPRINT, DEPOT_OFFSET, PLOT_SIZE } from '../core/layout';
import type { Theme } from '../core/model';
import { PLOT_TOP_Y } from './Foundation';
import { DEPOT_WIDTH, GROUND_Y } from './Ground';
import { colorOf } from './materials';

// Renderer, camera, controls, lights, and the render loop (spec sections 8.7,
// 8.8, and 16). The loop only runs while something moves: a camera tween,
// damping after a drag, or a registered animator. Otherwise it renders on
// demand through requestRender().

export const CAMERA_FOV = 38;
/** Default view direction: low over the horizon, from the front left. */
export const DEFAULT_POLAR = 0.41 * Math.PI;
export const DEFAULT_AZIMUTH = -0.42;
const TARGET_HEIGHT_RATIO = 0.45;
/** Share of the viewport kept clear above and below the tower. */
const FRAME_MARGIN = 0.15;
const SIDE_MARGIN = 0.08;
/** The closest the default framing comes. */
const MIN_DISTANCE = 12;
/** The lowest the camera goes: just above the plot, so the view never looks up from under the ground. */
const CAMERA_FLOOR = PLOT_TOP_Y + 0.3;
/** Panning keeps what the camera looks at this far out from the tower at most, and no higher than the day's tower plus this, so the site is never lost. */
const PAN_REACH = { out: 40, above: 10 };
/** How close in and far out the user can zoom. */
const ZOOM = { min: 1, max: 300 };
/** Fog starts and ends this far from the camera at the default framing (spec 8.8), and moves out as the user zooms out. */
const FOG = { near: 60, far: 140 };
const FRAME_TWEEN_SECONDS = 0.8;
const LIGHT_DIRECTION = new THREE.Vector3(12, 30, 18).normalize();
/** Label canvas pixels shown at this many screen pixels at the default view. */
const LABEL_SCREEN_SCALE = 0.75;
/** Share of the half screen width kept clear at the left edge, past the labels. */
const LABEL_EDGE_MARGIN = 0.04;

/** Room for labels at the default view, in world units. */
export interface LabelSpace {
  /** World units per label canvas pixel. */
  unitsPerPixel: number;
  /** Width from the tower's left face to the screen edge. */
  budget: number;
}

/** Runs every frame while registered. Return false when finished. */
export type Animator = (dt: number) => boolean;

/** A camera place to come back to: what it looks at, and from where. */
export interface CameraView {
  target: THREE.Vector3;
  offset: THREE.Spherical;
}

const ORIGIN = new THREE.Vector3();

export class SceneRoot {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private readonly sun: THREE.DirectionalLight;
  private readonly fog: THREE.Fog;
  private readonly animators = new Set<Animator>();
  private readonly panHeld = new THREE.Vector3();
  private readonly renderHooks = new Set<(camera: THREE.Camera) => void>();
  private readonly viewHooks = new Set<() => void>();
  private readonly showHooks = new Set<() => void>();
  private readonly resizeObserver: ResizeObserver;
  private readonly raycaster = new THREE.Raycaster();
  private cameraTween: Animator | null = null;
  private needsRender = true;
  private frameId = 0;
  private lastFrame = 0;
  private widthPx = 1;
  private heightPx = 1;
  private towerHeight = 1;
  private defaultDistance = 60;

  constructor(private readonly host: HTMLElement, theme: Theme) {
    THREE.ColorManagement.enabled = true;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    // r186 removed PCFSoftShadowMap; PCFShadowMap is its soft filtered successor.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // Builds reveal their facade with a clipping plane (spec 9.4 phase 5).
    this.renderer.localClippingEnabled = true;
    this.renderer.domElement.setAttribute('role', 'img');
    host.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 500);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    // The view is free above the ground: drag to turn to any angle, from
    // straight down to looking up from just above the ground; zoom right in
    // or far out; and pan with the right button, or a drag with shift held,
    // to look at any part of the site. keepAboveGround sets how far it tilts.
    this.controls.minPolarAngle = 0;
    this.controls.maxPolarAngle = 0.5 * Math.PI;
    this.controls.minDistance = ZOOM.min;
    this.controls.maxDistance = ZOOM.max;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = true;
    this.controls.addEventListener('change', () => this.requestRender());
    // A drag takes over from any framing tween.
    this.controls.addEventListener('start', () => this.stopCameraTween());

    // The spec's intensities (0.9 and 1.4) use the older three convention,
    // which scaled every light by pi internally. Current three uses physical
    // units, so the same look needs the pi applied here.
    const hemisphere = new THREE.HemisphereLight(colorOf('white'), colorOf('slatePale'), 0.9 * Math.PI);
    this.sun = new THREE.DirectionalLight(colorOf('white'), 1.4 * Math.PI);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.scene.add(hemisphere, this.sun, this.sun.target);

    this.fog = new THREE.Fog(colorOf('lightGray'), FOG.near, FOG.far);
    this.scene.fog = this.fog;
    this.setTheme(theme);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /** The background and fog color for a theme (spec 5.8). */
  static backgroundFor(theme: Theme): THREE.Color {
    return colorOf(theme === 'dark' ? 'navyDark' : 'lightGray');
  }

  setTheme(theme: Theme): void {
    const background = SceneRoot.backgroundFor(theme);
    this.scene.background = background;
    this.fog.color.copy(background);
    this.requestRender();
  }

  /** The live background and fog colors, for theme transitions. */
  get themeColors(): THREE.Color[] {
    return [this.scene.background as THREE.Color, this.fog.color];
  }

  /**
   * Moves each color to its target over `seconds`, for example the 0.4 s
   * theme transition in spec section 14. Zero seconds applies at once.
   */
  tweenColors(pairs: ReadonlyArray<readonly [THREE.Color, THREE.Color]>, seconds: number): void {
    if (seconds <= 0) {
      for (const [color, target] of pairs) color.copy(target);
      this.requestRender();
      return;
    }
    const from = pairs.map(([color]) => color.clone());
    let elapsed = 0;
    this.addAnimator((dt) => {
      elapsed += dt;
      const t = easeInOutCubic(Math.min(1, elapsed / seconds));
      pairs.forEach(([color, target], i) => color.lerpColors(from[i]!, target, t));
      return elapsed < seconds;
    });
  }

  /** A ray from the camera through a point given in client pixels. */
  pointerRay(clientX: number, clientY: number): THREE.Raycaster {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster;
  }

  /** Projects a world point to client pixels, for HTML placed over the scene. */
  toClient(point: THREE.Vector3): { x: number; y: number; visible: boolean } {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const projected = point.clone().project(this.camera);
    return {
      x: rect.left + ((projected.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - projected.y) / 2) * rect.height,
      visible: projected.z < 1 && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1,
    };
  }

  // Rendering

  /**
   * Compiles every material in the scene, hidden ones included, so the crew's
   * first appearance does not stall frames on shader compiles. Runs in the
   * background where the browser supports parallel compiles.
   */
  warmUp(): void {
    void this.renderer.compileAsync(this.scene, this.camera);
  }

  requestRender(): void {
    this.needsRender = true;
    this.schedule();
  }

  /** Registers a per-frame callback. It runs until it returns false. */
  addAnimator(animator: Animator): void {
    this.animators.add(animator);
    this.schedule();
  }

  /** Runs before every render, for example to keep labels beside the tower. */
  onBeforeRender(hook: (camera: THREE.Camera) => void): void {
    this.renderHooks.add(hook);
  }

  /** Runs when the viewport size or default framing changes. */
  onViewChange(hook: () => void): void {
    this.viewHooks.add(hook);
  }

  /** Runs when a hidden tab becomes visible again. */
  onShow(hook: () => void): void {
    this.showHooks.add(hook);
  }

  /** True when every point projects inside the viewport. */
  pointsInView(points: readonly THREE.Vector3[]): boolean {
    this.camera.updateMatrixWorld();
    const v = new THREE.Vector3();
    return points.every((point) => {
      v.copy(point).project(this.camera);
      return Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.z < 1;
    });
  }

  private schedule(): void {
    if (this.frameId === 0 && !document.hidden) this.frameId = requestAnimationFrame(this.frame);
  }

  private readonly frame = (time: number): void => {
    this.frameId = 0;
    const dt = this.lastFrame > 0 ? Math.min((time - this.lastFrame) / 1000, 0.1) : 1 / 60;
    this.lastFrame = time;

    const animating = this.animators.size > 0;
    for (const animator of [...this.animators]) {
      if (!animator(dt)) this.animators.delete(animator);
    }
    this.keepAboveGround();
    const cameraMoved = this.controls.update(dt);
    if (this.camera.position.y < CAMERA_FLOOR) this.camera.position.y = CAMERA_FLOOR;

    if (animating || cameraMoved || this.needsRender) {
      this.needsRender = false;
      this.followFog();
      for (const hook of this.renderHooks) hook(this.camera);
      this.renderer.render(this.scene, this.camera);
    }

    if (this.animators.size > 0 || cameraMoved || this.controls.autoRotate) this.schedule();
    else this.lastFrame = 0;
  };

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) {
      cancelAnimationFrame(this.frameId);
      this.frameId = 0;
      this.lastFrame = 0;
    } else {
      for (const hook of this.showHooks) hook();
      this.requestRender();
    }
  };

  private resize(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    if (width === this.widthPx && height === this.heightPx) return;
    this.widthPx = width;
    this.heightPx = height;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    // The default framing depends on the aspect ratio. Update it for Reset
    // view and label sizing, but leave the user's current camera alone.
    this.defaultDistance = this.fitDistance(this.towerHeight);
    this.notifyView();
    this.requestRender();
  }

  private notifyView(): void {
    for (const hook of this.viewHooks) hook();
  }

  // Camera framing

  private framingTarget(height: number): THREE.Vector3 {
    return new THREE.Vector3(0, height * TARGET_HEIGHT_RATIO, 0);
  }

  /**
   * Frames the full day window (not the topmost block, so the camera does not
   * jump as blocks are added), keeping 15% of the viewport clear above and
   * below. Tweens over 0.8 s when `animate` is true.
   */
  frameTower(towerHeight: number, animate: boolean, seconds = FRAME_TWEEN_SECONDS): void {
    this.towerHeight = towerHeight;
    this.defaultDistance = this.fitDistance(towerHeight);
    // Very long day windows need the zoom limit to grow with the default
    // framing, and the far plane with it, so zoomed right out nothing is cut off.
    this.controls.maxDistance = Math.max(ZOOM.max, 3 * this.defaultDistance);
    this.camera.far = Math.max(500, this.controls.maxDistance + 200);
    this.camera.updateProjectionMatrix();
    this.fitShadowCamera(towerHeight);

    const target = this.framingTarget(towerHeight);
    const to = new THREE.Spherical(this.defaultDistance, DEFAULT_POLAR, DEFAULT_AZIMUTH);
    if (animate) {
      this.tweenCamera(target, to, seconds);
    } else {
      this.stopCameraTween();
      this.controls.target.copy(target);
      this.camera.position.setFromSpherical(to).add(target);
      this.controls.update();
    }
    this.notifyView();
    this.requestRender();
  }

  /**
   * Keeps the camera above the ground. Panning cannot take the target below
   * it, or so far off that the site is lost, and the furthest the camera
   * tilts under its target is set from how high the target stands and how
   * far away the camera is, so it can look up at the tower from just above
   * the ground but never from beneath.
   */
  private keepAboveGround(): void {
    const { target } = this.controls;
    const held = this.panHeld.set(
      THREE.MathUtils.clamp(target.x, -PAN_REACH.out, PAN_REACH.out),
      THREE.MathUtils.clamp(target.y, CAMERA_FLOOR, Math.max(CAMERA_FLOOR, this.towerHeight + PAN_REACH.above)),
      THREE.MathUtils.clamp(target.z, -PAN_REACH.out, PAN_REACH.out),
    );
    if (!held.equals(target)) {
      // Move the camera with the target, so the view slides rather than turns.
      this.camera.position.add(held).sub(target);
      target.copy(held);
    }
    const room = (target.y - CAMERA_FLOOR) / Math.max(1e-6, this.camera.position.distanceTo(target));
    this.controls.maxPolarAngle = room >= 1 ? Math.PI : Math.acos(-room);
  }

  /** Pushes the fog back as the camera zooms out past the default framing, so the site never fades away. */
  private followFog(): void {
    const out = Math.max(0, this.camera.position.distanceTo(this.controls.target) - this.defaultDistance);
    this.fog.near = FOG.near + out;
    this.fog.far = FOG.far + out;
  }

  /** Returns to the default framing (the "Reset view" control). */
  resetView(): void {
    this.frameTower(this.towerHeight, true);
  }

  /** Where the camera is now, to come back to after a detour. */
  saveView(): CameraView {
    return {
      target: this.controls.target.clone(),
      offset: new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target)),
    };
  }

  /** Tweens back to a saved view, and the sun back to the main site. */
  restoreView(view: CameraView, seconds = FRAME_TWEEN_SECONDS): void {
    this.tweenCamera(view.target, view.offset, seconds);
    this.fitShadowCamera(this.towerHeight);
  }

  /**
   * Frames another site, centered at `center`, with a tower up to `height`,
   * as the animation speed preview does (spec 14). The sun's shadows follow.
   * The default framing for Reset view is left as it was.
   */
  frameSite(center: THREE.Vector3, height: number, seconds = FRAME_TWEEN_SECONDS): void {
    const target = this.framingTarget(height).add(center);
    const distance = this.fitDistance(height, center);
    this.tweenCamera(target, new THREE.Spherical(distance, DEFAULT_POLAR, DEFAULT_AZIMUTH), seconds);
    this.fitShadowCamera(height, center);
  }

  /** The distance at which the default framing fits, for the current aspect. */
  get framingDistance(): number {
    return this.defaultDistance;
  }

  private fitDistance(towerHeight: number, center: THREE.Vector3 = ORIGIN): number {
    const target = this.framingTarget(towerHeight).add(center);
    const direction = new THREE.Vector3().setFromSpherical(new THREE.Spherical(1, DEFAULT_POLAR, DEFAULT_AZIMUTH));
    const half = BLOCK_FOOTPRINT / 2;
    const plotHalf = PLOT_SIZE / 2;
    const points: THREE.Vector3[] = [];
    for (const x of [-half, half]) {
      for (const z of [-half, half]) {
        points.push(new THREE.Vector3(x, 0, z).add(center), new THREE.Vector3(x, towerHeight, z).add(center));
      }
    }
    for (const x of [-plotHalf, plotHalf]) {
      for (const z of [-plotHalf, plotHalf]) points.push(new THREE.Vector3(x, GROUND_Y, z).add(center));
    }

    const probe = this.camera.clone();
    const view = new THREE.Vector3();
    const limitY = 1 - 2 * FRAME_MARGIN;
    const limitX = 1 - 2 * SIDE_MARGIN;
    const fits = (distance: number): boolean => {
      probe.position.copy(direction).multiplyScalar(distance).add(target);
      probe.lookAt(target);
      probe.updateMatrixWorld();
      return points.every((point) => {
        view.copy(point).applyMatrix4(probe.matrixWorldInverse);
        if (view.z > -probe.near) return false;
        view.applyMatrix4(probe.projectionMatrix);
        return Math.abs(view.y) <= limitY && Math.abs(view.x) <= limitX;
      });
    };

    let low = MIN_DISTANCE;
    let high = 2000;
    for (let i = 0; i < 40; i++) {
      const mid = (low + high) / 2;
      if (fits(mid)) high = mid;
      else low = mid;
    }
    return high;
  }

  private tweenCamera(target: THREE.Vector3, to: THREE.Spherical, seconds: number): void {
    this.stopCameraTween();
    const fromTarget = this.controls.target.clone();
    const from = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(fromTarget));
    // Turn the short way round.
    let turn = to.theta - from.theta;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    const current = new THREE.Spherical();
    let elapsed = 0;
    const tween: Animator = (dt) => {
      elapsed += dt;
      const t = Math.min(1, elapsed / seconds);
      const k = easeInOutCubic(t);
      this.controls.target.lerpVectors(fromTarget, target, k);
      current.set(
        from.radius + (to.radius - from.radius) * k,
        from.phi + (to.phi - from.phi) * k,
        from.theta + turn * k,
      );
      this.camera.position.setFromSpherical(current).add(this.controls.target);
      if (t >= 1) this.cameraTween = null;
      return t < 1;
    };
    this.cameraTween = tween;
    this.addAnimator(tween);
  }

  private stopCameraTween(): void {
    if (this.cameraTween) this.animators.delete(this.cameraTween);
    this.cameraTween = null;
  }

  /**
   * Label sizing for the default view: a scale that keeps label text at a
   * steady screen size, and the room to the left of the tower. The framing
   * is centered, so it is the same as the room to the right.
   */
  get labelSpace(): LabelSpace {
    const visibleHeight = 2 * this.defaultDistance * Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2));
    const halfWidth = (visibleHeight * this.camera.aspect) / 2;
    const face = ((Math.abs(Math.cos(DEFAULT_AZIMUTH)) + Math.abs(Math.sin(DEFAULT_AZIMUTH))) * BLOCK_FOOTPRINT) / 2;
    return {
      unitsPerPixel: (LABEL_SCREEN_SCALE * visibleHeight) / this.heightPx,
      budget: halfWidth * (1 - LABEL_EDGE_MARGIN) - face,
    };
  }

  // Lighting

  /** Fits the orthographic shadow camera to a site's plot, depot, and full tower height. */
  private fitShadowCamera(towerHeight: number, center: THREE.Vector3 = ORIGIN): void {
    this.sun.position.copy(LIGHT_DIRECTION).multiplyScalar(120).add(center);
    this.sun.target.position.copy(center);
    this.sun.updateMatrixWorld();
    this.sun.target.updateMatrixWorld();

    const camera = this.sun.shadow.camera;
    camera.position.copy(this.sun.position);
    camera.lookAt(this.sun.target.position);
    camera.updateMatrixWorld();

    const min = new THREE.Vector3(Infinity, Infinity, Infinity);
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    const corner = new THREE.Vector3();
    const xs = [-PLOT_SIZE / 2 - 0.5, DEPOT_OFFSET + DEPOT_WIDTH / 2 + 0.5];
    const ys = [GROUND_Y, towerHeight + 4];
    const zs = [-PLOT_SIZE / 2 - 0.5, PLOT_SIZE / 2 + 0.5];
    for (const x of xs) {
      for (const y of ys) {
        for (const z of zs) {
          corner.set(x, y, z).add(center).applyMatrix4(camera.matrixWorldInverse);
          min.min(corner);
          max.max(corner);
        }
      }
    }
    const pad = 0.5;
    camera.left = min.x - pad;
    camera.right = max.x + pad;
    camera.bottom = min.y - pad;
    camera.top = max.y + pad;
    camera.near = Math.max(0.1, -max.z - pad);
    camera.far = -min.z + pad;
    camera.updateProjectionMatrix();
    this.sun.shadow.needsUpdate = true;
  }

  // Diagnostics

  get memory(): { geometries: number; textures: number } {
    return { ...this.renderer.info.memory };
  }

  dispose(): void {
    cancelAnimationFrame(this.frameId);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

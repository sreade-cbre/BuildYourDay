import * as THREE from 'three';
import { hashString, mulberry32, randomRange } from '../core/rng';
import { clamp } from '../core/time';
import { colorOf } from './materials';
import { FENCED, GATE, ROAD_WIDTH, ROAD_Z, STREET_GLSL, streetUniforms } from './SiteYard';

// Grass for the plot and the lawn round the site. Every tuft is a few thin
// three sided blades leaning out from its middle, dark at the root and light
// at the tip, and every tuft has its own shade, lighter or darker with the
// lawn's broad patches. The ground between the tufts is darker than the
// blades, so they stand out from it. The lawn itself is drawn on the ground
// plane by a shader, with the same patches, and fades into the theme's
// ground away from the fence. The tufts fade into that ground the same way,
// and thin out and shrink as they go. The same shader paints the street
// across the lawn.

/** The lawn is all green this far out from the fence, then fades into the ground by LAWN_FADE_END. */
const LAWN_FADE_START = 14;
const LAWN_FADE_END = 45;
/** Tufts to the square unit where the grass is full. */
const TUFT_DENSITY = 16;
const TUFT_BLADES = 6;
const BLADE_RADIUS = 0.02;
/** A blade's shade at its root and at its tip, as multiples of its color. */
const ROOT_SHADE = 0.5;
const TIP_SHADE = 1.0;
/** The ground between the tufts, as a share of the blades' color. */
const TURF_SHADE = 0.55;
/** How much lighter or darker the lawn's patches make it, either way. */
const PATCH_DEPTH = 0.12;

/** The box round the whole fence, which the lawn fades out from: minX, minZ, maxX, maxZ. */
const BOUNDS = FENCED.reduce(
  (box, [minX, minZ, maxX, maxZ]) => box.set(Math.min(box.x, minX), Math.min(box.y, minZ), Math.max(box.z, maxX), Math.max(box.w, maxZ)),
  new THREE.Vector4(Infinity, Infinity, -Infinity, -Infinity),
);

/** Where a tuft stands, and its size as a share of a full one. */
export interface TuftSpot {
  x: number;
  y: number;
  z: number;
  size: number;
}

/** The ground between the tufts on a grass plot. */
export function turfColor(): THREE.Color {
  return colorOf('grass').multiplyScalar(TURF_SHADE);
}

/**
 * The lawn's broad patches, 0 to 1: a wide swell and a finer one. The
 * ground's shader has the same sum (PATCH_GLSL), so the tufts and the ground
 * under them agree.
 */
function patch(x: number, z: number): number {
  const wide = Math.sin(x * 0.31 + 1.7 * Math.sin(z * 0.23)) * Math.sin(z * 0.37 - 1.3 * Math.sin(x * 0.19));
  const fine = Math.sin(x * 1.3 + z * 0.9) * Math.sin(z * 1.1 - x * 0.7);
  return clamp(0.5 + 0.35 * wide + 0.15 * fine, 0, 1);
}

const PATCH_GLSL = `float lawnPatch( vec2 p ) {
  float wide = sin( p.x * 0.31 + 1.7 * sin( p.y * 0.23 ) ) * sin( p.y * 0.37 - 1.3 * sin( p.x * 0.19 ) );
  float fine = sin( p.x * 1.3 + p.y * 0.9 ) * sin( p.y * 1.1 - p.x * 0.7 );
  return clamp( 0.5 + 0.35 * wide + 0.15 * fine, 0.0, 1.0 );
}`;

/** The lawn's fade, 0 near the fence to 1 where the ground has taken over. */
const FADE_GLSL = `uniform vec4 lawnBounds;
uniform vec2 lawnFade;
float lawnFadeAt( vec2 p ) {
  vec2 beyond = max( max( lawnBounds.xy - p, p - lawnBounds.zw ), 0.0 );
  return smoothstep( lawnFade.x, lawnFade.y, length( beyond ) );
}`;

/** Passes each vertex's world x and z to the fragment shader, instanced or not. */
function withLawnPosition(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.uniforms.lawnBounds = { value: BOUNDS };
  shader.uniforms.lawnFade = { value: new THREE.Vector2(LAWN_FADE_START, LAWN_FADE_END) };
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
    varying vec2 vLawnXZ;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
    vec4 lawnWorld = vec4( transformed, 1.0 );
    #ifdef USE_INSTANCING
      lawnWorld = instanceMatrix * lawnWorld;
    #endif
    vLawnXZ = ( modelMatrix * lawnWorld ).xz;`);
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
  varying vec2 vLawnXZ;
  ${FADE_GLSL}`);
}

/** How green the ground is at a point: 1 near the fence, fading to 0 by LAWN_FADE_END, as in FADE_GLSL. */
function lawnShare(x: number, z: number): number {
  const dx = Math.max(BOUNDS.x - x, 0, x - BOUNDS.z);
  const dz = Math.max(BOUNDS.y - z, 0, z - BOUNDS.w);
  const t = clamp((Math.hypot(dx, dz) - LAWN_FADE_START) / (LAWN_FADE_END - LAWN_FADE_START), 0, 1);
  return 1 - t * t * (3 - 2 * t);
}

/** How far a ground point lies outside the fence: 0 inside it. */
function outsideFence(x: number, z: number): number {
  let nearest = Infinity;
  for (const [minX, minZ, maxX, maxZ] of FENCED) {
    const dx = Math.max(minX - x, 0, x - maxX);
    const dz = Math.max(minZ - z, 0, z - maxZ);
    nearest = Math.min(nearest, Math.hypot(dx, dz));
  }
  return nearest;
}

/** Full tufts spread evenly over a square plot top. */
export function plotSpots(y: number, half: number): TuftSpot[] {
  const rng = mulberry32(hashString('plot-grass'));
  const count = Math.round(TUFT_DENSITY * (2 * half) ** 2);
  return Array.from({ length: count }, () => ({ x: randomRange(rng, -half, half), y, z: randomRange(rng, -half, half), size: 1 }));
}

/**
 * Tufts wherever the lawn is green: as thick as on the plot where it is
 * fully green, thinning and shrinking as it fades, and kept outside the
 * fence and off the street, the ramp, and the cones at the gate.
 */
export function lawnSpots(y: number): TuftSpot[] {
  const rng = mulberry32(hashString('lawn-grass'));
  const minX = BOUNDS.x - LAWN_FADE_END;
  const minZ = BOUNDS.y - LAWN_FADE_END;
  const maxX = BOUNDS.z + LAWN_FADE_END;
  const maxZ = BOUNDS.w + LAWN_FADE_END;
  const tries = Math.round(TUFT_DENSITY * (maxX - minX) * (maxZ - minZ));
  const spots: TuftSpot[] = [];
  for (let i = 0; i < tries; i++) {
    const x = randomRange(rng, minX, maxX);
    const z = randomRange(rng, minZ, maxZ);
    // Thinning faster than the green fades, so few stand where it is pale.
    const share = lawnShare(x, z);
    if (rng() >= share * share) continue;
    // Clear of the fence feet.
    if (outsideFence(x, z) < 0.1) continue;
    if (Math.abs(z - ROAD_Z) < ROAD_WIDTH / 2 + 0.08) continue;
    if (x > GATE.from - 0.6 && x < GATE.to + 0.6 && z > GATE.z && z < ROAD_Z) continue;
    spots.push({ x, y, z, size: 0.6 + 0.4 * share });
  }
  return spots;
}

/**
 * One tuft: blades round its middle, each a thin three sided spike leaning
 * outward. Normals lean up, so the blades light much as the ground under
 * them does, and the vertex colors run from a dark root to a light tip.
 */
function tuftGeometry(): THREE.BufferGeometry {
  const rng = mulberry32(hashString('tuft'));
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const normal = new THREE.Vector3();
  for (let b = 0; b < TUFT_BLADES; b++) {
    const heading = (b / TUFT_BLADES) * Math.PI * 2 + randomRange(rng, -0.4, 0.4);
    const out = new THREE.Vector2(Math.cos(heading), Math.sin(heading));
    const root = out.clone().multiplyScalar(randomRange(rng, 0.008, 0.05));
    const lean = randomRange(rng, 0.03, 0.1);
    const first = positions.length / 3;
    for (let k = 0; k < 3; k++) {
      const a = heading + (k / 3) * Math.PI * 2;
      positions.push(root.x + Math.cos(a) * BLADE_RADIUS, 0, root.y + Math.sin(a) * BLADE_RADIUS);
      normal.set(Math.cos(a) * 0.5, 0.85, Math.sin(a) * 0.5).normalize();
      normals.push(normal.x, normal.y, normal.z);
      colors.push(ROOT_SHADE, ROOT_SHADE, ROOT_SHADE);
    }
    positions.push(root.x + out.x * lean, randomRange(rng, 0.16, 0.27), root.y + out.y * lean);
    normals.push(0, 1, 0);
    colors.push(TIP_SHADE, TIP_SHADE, TIP_SHADE);
    // Each side runs from two root corners to the tip, wound to face out.
    for (let k = 0; k < 3; k++) {
      const a = (k + 1) % 3;
      indices.push(first + a, first + k, first + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  return geometry;
}

/**
 * A material for tufts in a color, which the tufts' own shades multiply.
 * Given the ground's color, the tufts fade into it as the lawn does.
 */
export function tuftMaterial(color: THREE.Color, ground?: THREE.Color): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, vertexColors: true });
  material.color = color;
  if (ground) {
    material.onBeforeCompile = (shader) => {
      withLawnPosition(shader);
      shader.uniforms.lawnGround = { value: ground };
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
        uniform vec3 lawnGround;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb = mix( diffuseColor.rgb, lawnGround, lawnFadeAt( vLawnXZ ) );`);
    };
    material.customProgramCacheKey = () => 'lawn-tufts';
  }
  return material;
}

/** Tufts at the given spots, each turned, sized, and shaded its own way. */
export function tuftMesh(name: string, material: THREE.Material, spots: readonly TuftSpot[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(tuftGeometry(), material, spots.length);
  mesh.name = name;
  mesh.receiveShadow = true;
  const rng = mulberry32(hashString(name));
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const tilt = new THREE.Euler();
  const scale = new THREE.Vector3();
  const shade = new THREE.Color();
  spots.forEach(({ x, y, z, size }, i) => {
    tilt.set(randomRange(rng, -0.15, 0.15), rng() * Math.PI * 2, randomRange(rng, -0.15, 0.15));
    const width = randomRange(rng, 0.8, 1.25) * size;
    scale.set(width, randomRange(rng, 0.7, 1.35) * size, width);
    mesh.setMatrixAt(i, matrix.compose(position.set(x, y, z), rotation.setFromEuler(tilt), scale));
    // Lighter or darker, a little warmer or cooler, and with the patches.
    const light = randomRange(rng, 0.8, 1.1) * (1 + PATCH_DEPTH * (patch(x, z) * 2 - 1));
    const warmth = randomRange(rng, -1, 1);
    mesh.setColorAt(i, shade.setRGB(light * (1 + 0.06 * warmth), light, light * (1 - 0.12 * warmth)));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

/**
 * The ground plane's material. Its color is the theme's ground, which theme
 * changes tween; the shader lays the lawn over it by distance from the fence,
 * in the turf's darker shade and with the patches, so the lawn fades into
 * that ground whatever the theme, and paints the street over both.
 */
export function groundMaterial(lawnColor: THREE.Color): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: colorOf('white'), roughness: 1, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    withLawnPosition(shader);
    Object.assign(shader.uniforms, streetUniforms());
    shader.uniforms.lawnColor = { value: lawnColor };
    shader.uniforms.lawnShade = { value: new THREE.Vector2(TURF_SHADE, PATCH_DEPTH) };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
      uniform vec3 lawnColor;
      uniform vec2 lawnShade;
      ${PATCH_GLSL}
      ${STREET_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      vec3 turf = lawnColor * lawnShade.x * ( 1.0 + lawnShade.y * ( lawnPatch( vLawnXZ ) * 2.0 - 1.0 ) );
      diffuseColor.rgb = paintStreet( mix( turf, diffuseColor.rgb, lawnFadeAt( vLawnXZ ) ), vLawnXZ );`);
  };
  material.customProgramCacheKey = () => 'lawn-ground';
  return material;
}

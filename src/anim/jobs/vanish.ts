import * as THREE from 'three';
import type { Block } from '../../core/model';
import { BlockMesh } from '../../scene/BlockMesh';
import { BLUEPRINT_OPACITY, materials } from '../../scene/materials';
import type { Job } from '../Director';
import { linear } from '../easing';
import { Timeline } from '../Timeline';
import { endJob } from './build';
import { titleOf, type JobScene } from './scene';
import { CALM_SECONDS } from './schedule';

// A planned block that is removed: nothing was built yet, so no crew comes,
// and its plan fades away where it stood.

export function vanishJob(scene: JobScene, block: Block): Job {
  const { holds, tower } = scene;
  const token = scene.token(block);
  const pose = tower.poseFor(block);
  const body = materials.blueprint(token).clone();
  const edges = materials.blueprintEdges(token).clone();
  const edgeOpacity = edges.opacity;
  const proxy = new BlockMesh(block.id, token);
  proxy.setAppearance({ token, dimmed: false, hovered: false, hatched: false, weathered: false, stage: 'planned' });
  proxy.useMaterials(body, edges, proxy.cap.material as THREE.Material);
  proxy.setBaseY(pose.baseY);
  proxy.setHeight(pose.height);
  proxy.root.visible = false;
  scene.crew.root.add(proxy.root);
  const claim = holds.claim(block.id, {
    pose: null,
    labelOpacity: 0,
    quiet: [block],
    onFirst: () => {
      proxy.root.visible = true;
      scene.requestRender();
    },
  });
  return {
    label: `Removing ${titleOf(block)}`,
    start: () => {
      const tl = new Timeline();
      tl.add({
        at: 0,
        duration: CALM_SECONDS,
        ease: linear,
        update: (t) => {
          body.opacity = BLUEPRINT_OPACITY * (1 - t);
          edges.opacity = edgeOpacity * (1 - t);
        },
      });
      return tl;
    },
    end: () => {
      proxy.dispose();
      body.dispose();
      edges.dispose();
      holds.release(block.id, claim);
      endJob(scene);
    },
  };
}

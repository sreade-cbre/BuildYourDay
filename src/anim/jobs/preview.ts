import { PLOT_SIZE } from '../../core/layout';
import type { Block } from '../../core/model';
import type { Job } from '../Director';
import { linear } from '../easing';
import { buildJob } from './build';
import type { JobScene } from './scene';

// The animation speed preview (spec 14): a temporary 60 minute block built
// on an empty side plot at the speed being tried, then taken away again. It
// is a first build like any other; the scene it gets places the plot, keeps
// its own claims, and sees no other blocks. When the block is done it fades,
// the slab sinks, and the grass grows back.

export function previewJob(scene: JobScene, block: Block, label: string, done: () => void): Job {
  const build = buildJob(scene, block);
  return {
    label,
    // The live site keeps off the crane and machines while they show the preview.
    borrows: build.borrows,
    start: () => {
      const tl = build.start();
      const end = tl.duration;
      const { props } = scene.crew;
      const { baseY, height } = scene.tower.poseFor(block);
      const token = scene.token(block);
      tl.add({
        at: end,
        duration: 0.35,
        ease: linear,
        onStart: () => {
          props.setup(token, baseY, height, true);
          props.setReveal(Infinity);
          props.cladding.cap.visible = true;
        },
        update: (t) => props.setFade(1 - t),
      });
      tl.add({
        at: end + 0.25,
        duration: 0.4,
        ease: linear,
        update: (t) => {
          props.setSlab(1 - t);
          props.setPads([1 - t, 1 - t, 1 - t, 1 - t]);
          scene.ground.setPrepFade(1 - t);
          scene.ground.setClearFront(-PLOT_SIZE / 2 - 1 + (PLOT_SIZE + 2) * t);
        },
      });
      return tl;
    },
    end: () => {
      build.end();
      done();
    },
  };
}

import './styles.css';
import { App } from './App';
import { usableStorage } from './core/persist';
import { h } from './ui/dom';

// Entry point: checks for WebGL2, then starts the app (spec section 4). Without
// WebGL2 the app still runs, with the list view in place of the scene
// (spec section 17).

declare global {
  interface Window {
    /** Development handle for inspecting the running app from the console. */
    timeTower?: App;
  }
}

function hasWebGL2(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function start(): void {
  const root = document.getElementById('app');
  const scene = document.getElementById('scene');
  const overlay = document.getElementById('overlay');
  if (!root || !scene || !overlay) throw new Error('The page is missing its app containers.');

  const storage = usableStorage(() => window.localStorage);
  let list: HTMLElement | null = null;
  const webgl = hasWebGL2();
  if (!webgl) {
    scene.remove();
    root.classList.add('app--no-scene');
    list = h('main', { class: 'fallback-list panel', attrs: { 'aria-label': 'Blocks' } });
    root.prepend(list);
  }
  const app = new App({ scene: webgl ? scene : null, overlay, list }, storage);
  if (import.meta.env.DEV) window.timeTower = app;
}

start();

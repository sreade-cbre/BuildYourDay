import './styles.css';
import { App } from './App';

// Entry point: checks for WebGL2, then starts the app (spec section 4).

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

function showFallback(root: HTMLElement): void {
  const wrapper = document.createElement('div');
  wrapper.className = 'fallback';
  const card = document.createElement('section');
  card.className = 'fallback__card panel';
  const heading = document.createElement('h1');
  heading.textContent = 'Time Tower';
  const message = document.createElement('p');
  message.textContent =
    'This browser does not support WebGL2, so open Time Tower in a current version of Chrome, Edge, Safari, or Firefox.';
  card.append(heading, message);
  wrapper.append(card);
  root.replaceChildren(wrapper);
}

function start(): void {
  const root = document.getElementById('app');
  const scene = document.getElementById('scene');
  const overlay = document.getElementById('overlay');
  if (!root || !scene || !overlay) throw new Error('The page is missing its app containers.');

  if (!hasWebGL2()) {
    showFallback(root);
    return;
  }
  const app = new App({ scene, overlay });
  if (import.meta.env.DEV) window.timeTower = app;
}

start();

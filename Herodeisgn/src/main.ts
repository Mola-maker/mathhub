// Entry point. Wires the three.js scene, DOM binary columns, and the
// anime.js entrance reveal together. Everything is module-scoped — no
// global state leaks onto window.

import { mountBinaryColumns } from './binaryColumns';
import { playReveal } from './reveal';
import { createScene } from './scene';
import './style.css';

function init() {
  const wordmarkSlot = document.querySelector<HTMLElement>('.hero__wordmark-slot');
  const binarySlot = document.querySelector<HTMLElement>('.hero__binary');

  if (!wordmarkSlot || !binarySlot) {
    console.warn('[hero-binary] required slots not found in DOM');
    return;
  }

  // Three.js scene mounts into the wordmark slot.
  const sceneHandle = createScene();
  sceneHandle.mount(wordmarkSlot);

  // Binary columns inject into their slot.
  mountBinaryColumns(binarySlot);

  // Entrance reveal — runs once on mount.
  playReveal(sceneHandle.wordmark);
}

// Defer until DOM is ready.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
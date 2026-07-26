// Three.js scene — owns the renderer, camera, animation loop, and the
// Geo wordmark. Designed for a 2D-on-3D look: orthographic camera, the
// letterforms sit on z=0, and a slow ambient rotation gives them life
// without ever departing from the wordmark aesthetic.

import {
  AmbientLight,
  Clock,
  DirectionalLight,
  Group,
  OrthographicCamera,
  Scene,
  Vector2,
  WebGLRenderer,
} from 'three';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { buildGeoWordmark } from './geoLetters';

export type SceneHandle = {
  /** Append the renderer's canvas to a host element. */
  mount: (host: HTMLElement) => void;
  /** Tear down the loop and release the GL context. */
  dispose: () => void;
  /** The wordmark group — exposed for reveal animation. */
  wordmark: Group;
};

export function createScene(): SceneHandle {
  const renderer = new WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0xffffff, 0); // transparent over the white body bg
  renderer.outputColorSpace = 'srgb';

  const scene = new Scene();
  scene.background = null;

  const camera = new OrthographicCamera(-1, 1, 1, -1, -100, 100);
  camera.position.set(0, 0, 20);
  camera.lookAt(0, 0, 0);

  // Lights are mostly vestigial — LineMaterial doesn't use lighting,
  // and the wireframe lines should always render at full opacity.
  scene.add(new AmbientLight(0xffffff, 1.0));
  const key = new DirectionalLight(0xffffff, 0.8);
  key.position.set(2, 3, 4);
  scene.add(key);

  const wordmarkData = buildGeoWordmark(11);
  wordmarkData.group.position.set(0, 0, 0);
  wordmarkData.group.rotation.z = -0.05;
  scene.add(wordmarkData.group);

  const mouse = new Vector2(0, 0);
  const target = new Vector2(0, 0);

  const onMouseMove = (e: PointerEvent) => {
    const r = renderer.domElement.getBoundingClientRect();
    target.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    target.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
  };
  renderer.domElement.addEventListener('pointermove', onMouseMove);

  const fit = () => {
    const canvas = renderer.domElement;
    const parent = canvas.parentElement;
    if (!parent) return;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    renderer.setSize(w, h, false);

    // Line2 materials need a resolution uniform that tracks the canvas
    // pixel size — they use it to convert the `linewidth` value (CSS px)
    // into screen-space width.
    const resolution = new Vector2(w, h);
    wordmarkData.lineMaterials.forEach((m: LineMaterial) => {
      m.resolution.copy(resolution);
    });

    const aspect = w / Math.max(h, 1);
    const targetW = wordmarkData.width;
    const viewH = targetW / aspect;
    camera.left = -targetW / 2;
    camera.right = targetW / 2;
    camera.top = viewH / 2;
    camera.bottom = -viewH / 2;
    camera.updateProjectionMatrix();
  };

  const ro = new ResizeObserver(fit);
  let resizeObserverAttached = false;

  const clock = new Clock();
  let rafId = 0;
  let running = true;
  const loop = () => {
    if (!running) return;
    rafId = requestAnimationFrame(loop);
    const dt = clock.getDelta();

    mouse.lerp(target, Math.min(1, dt * 4));

    wordmarkData.group.rotation.x = mouse.y * 0.08;
    wordmarkData.group.rotation.y = mouse.x * -0.08;

    renderer.render(scene, camera);
  };

  return {
    mount(host: HTMLElement) {
      host.appendChild(renderer.domElement);
      renderer.domElement.classList.add('hero__canvas');
      if (!resizeObserverAttached) {
        ro.observe(host);
        resizeObserverAttached = true;
      }
      fit();
      loop();
    },
    dispose() {
      running = false;
      cancelAnimationFrame(rafId);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointermove', onMouseMove);
      renderer.dispose();
      renderer.forceContextLoss();
    },
    wordmark: wordmarkData.group,
  };
}
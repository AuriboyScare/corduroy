import { signal } from '@preact/signals';
import { h, render } from 'preact';
import {
  Color,
  DirectionalLight,
  HemisphereLight,
  IcosahedronGeometry,
  Mesh,
  MeshStandardNodeMaterial,
  PerspectiveCamera,
  Scene,
} from 'three/webgpu';
import { createRenderer, type BootInfo } from './render/createRenderer';
import { FixedStepClock } from './sim/clock';
import { BootPanel } from './ui/BootPanel';

interface DebugBridge {
  boot: BootInfo;
  frames: number;
  simSteps: number;
}

declare global {
  interface Window {
    __corduroy?: DebugBridge;
  }
}

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;

async function boot(): Promise<void> {
  const { renderer, info } = await createRenderer({ canvas, forceWebGL: params.get('gl') === '1' });

  const scene = new Scene();
  scene.background = new Color(0x9fb8cf);
  scene.add(new HemisphereLight(0xdfeeff, 0x6b7785, 1.2));
  const sun = new DirectionalLight(0xfff1dc, 2.5);
  sun.position.set(3, 5, 2);
  scene.add(sun);
  const probe = new Mesh(
    new IcosahedronGeometry(1, 3),
    new MeshStandardNodeMaterial({ color: 0xf2f6fa, roughness: 0.6 }),
  );
  scene.add(probe);

  const camera = new PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0.6, 4);

  const resize = (): void => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  const fps = signal(0);
  const bridge: DebugBridge = { boot: info, frames: 0, simSteps: 0 };
  if (params.get('debug') === '1') window.__corduroy = bridge;

  const clock = new FixedStepClock({ stepSeconds: 1 / 60, maxStepsPerAdvance: 8 });
  let last = performance.now();
  let windowStart = last;
  let windowFrames = 0;

  await renderer.setAnimationLoop(() => {
    const now = performance.now();
    const steps = clock.advance((now - last) / 1000);
    last = now;
    probe.rotation.y = (clock.simSeconds + clock.alpha * clock.stepSeconds) * 0.5;
    renderer.render(scene, camera);

    bridge.frames++;
    bridge.simSteps += steps;
    windowFrames++;
    if (now - windowStart >= 500) {
      fps.value = (windowFrames * 1000) / (now - windowStart);
      windowStart = now;
      windowFrames = 0;
      render(h(BootPanel, { info, fps: fps.value }), uiRoot);
    }
  });
  render(h(BootPanel, { info, fps: 0 }), uiRoot);
}

boot().catch((error: unknown) => {
  console.error(error);
  const message = error instanceof Error ? error.message : String(error);
  uiRoot.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'panel boot bad';
  box.textContent = `Corduroy could not start the renderer: ${message}`;
  uiRoot.append(box);
});

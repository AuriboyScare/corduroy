import { PerspectiveCamera, Scene, Vector3, type WebGPURenderer } from 'three/webgpu';
import { createEnvironment } from '../render/environment';
import { createForest } from '../render/forest';
import { SnowcatModel } from '../render/snowcatModel';
import { createSnowMaterial } from '../render/snowMaterial';
import { SurfaceDetailView } from '../render/surfaceDetail';
import { TerrainView } from '../render/terrainView';
import { FixedStepClock } from '../sim/clock';
import { Snowpack } from '../sim/snow/snowpack';
import { generateMountain } from '../sim/terrain/mountain';
import { PathFollower } from '../sim/vehicles/autopilot';
import type { SnowcatInput } from '../sim/vehicles/snowcat';
import { World } from '../sim/world';
import { MachineAudio } from './audio';
import { CameraRig, type CameraMode } from './cameraRig';
import { helpVisible, hud, loadingMessage } from './hudState';
import { Input, SnowcatControls } from './input';

/** Hooks for automated tests and screenshots, exposed as window.__corduroy with ?debug=1. */
export interface GameDebug {
  world: World;
  rig: CameraRig;
  frames: number;
  /** When set, replaces keyboard input for the snowcat. */
  autoInput: SnowcatInput | null;
  /** Milliseconds spent building the mountain. */
  buildMs: number;
  renderInfo(): { calls: number; triangles: number };
  setCamera(mode: CameraMode): void;
  /** Drives the piste centreline uphill on autopilot for a number of steps, without rendering. */
  autoGroom(steps: number): void;
  /** Runs simulation steps immediately, without rendering. */
  fastForward(steps: number, input: SnowcatInput): void;
}

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

export async function startGame(
  renderer: WebGPURenderer,
  canvas: HTMLCanvasElement,
  seed: number,
): Promise<GameDebug> {
  loadingMessage.value = 'Shaping the mountain';
  await nextFrame();
  await nextFrame();
  const buildStart = performance.now();
  const mountain = generateMountain(seed);
  const snow = new Snowpack(mountain);
  snow.fillNatural(seed);
  const world = new World(mountain, snow);
  loadingMessage.value = 'Planting the forest';
  await nextFrame();

  const scene = new Scene();
  const camera = new PerspectiveCamera(55, 1, 0.35, 60_000);
  const environment = createEnvironment(scene, renderer, mountain, snow);
  const detail = new SurfaceDetailView(snow);
  const terrain = new TerrainView(
    snow,
    createSnowMaterial({
      fine: detail.fine,
      coarse: detail.coarse,
      windowOrigin: detail.origin,
      mapSizeM: mountain.grid.sizeM,
      sunDirection: environment.sunDirection,
    }),
  );
  scene.add(terrain.group);
  const forest = createForest(mountain, snow);
  scene.add(forest.group);
  const catModel = new SnowcatModel();
  scene.add(catModel.group);
  const buildMs = performance.now() - buildStart;

  const input = new Input(canvas);
  const controls = new SnowcatControls();
  const rig = new CameraRig(camera, snow);
  const audio = new MachineAudio();

  const resize = (): void => {
    // Render at up to roughly 1200 lines; the display's full Retina resolution is not worth its cost.
    const ratio = Math.min(window.devicePixelRatio, Math.max(1, 1200 / window.innerHeight));
    renderer.setPixelRatio(ratio);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  const clock = new FixedStepClock({ stepSeconds: world.stepSeconds, maxStepsPerAdvance: 5 });
  const idle: SnowcatInput = { throttle: 0, steer: 0, bladeLift: 0, tillerDown: false };
  const debug: GameDebug = {
    world,
    rig,
    frames: 0,
    autoInput: null,
    buildMs,
    renderInfo: () => ({ calls: renderer.info.render.drawCalls, triangles: renderer.info.render.triangles }),
    setCamera: (mode) => rig.setMode(mode),
    autoGroom: (steps) => {
      const pilot = new PathFollower(mountain.pisteLine, -1, 0.62);
      for (let i = 0; i < steps && !pilot.done; i++) world.step(pilot.update(world.cat, true));
    },
    fastForward: (steps, stepInput) => {
      for (let i = 0; i < steps; i++) world.step(stepInput);
    },
  };

  let lastInput: SnowcatInput = idle;
  const cameraPosition = new Vector3();
  let last = performance.now();
  let hudAt = 0;
  let fpsFrames = 0;
  let fpsStart = last;
  let fps = 0;

  const updateHud = (): void => {
    const cat = world.cat;
    const i = snow.grid.nearest(cat.body.px, cat.body.pz);
    hud.value = {
      speedKmh: cat.forwardSpeed * 3.6,
      engineLoad: cat.engineLoad,
      engineRpm: audio.engineRpm,
      muted: audio.muted,
      bladeHeightCm: cat.bladeHeightM * 100,
      bladeLoadKg: cat.bladeLoadKg,
      bladeCapacityKg: cat.spec.bladeCapacityKg,
      tillerDown: lastInput.tillerDown,
      tillerWorking: cat.tillerWorking,
      groomQuality: cat.groomQuality,
      pitchDeg: (cat.pitch * 180) / Math.PI,
      rollDeg: (cat.roll * 180) / Math.PI,
      grip: cat.grip,
      sinkCm: cat.sinkM * 100,
      snowTopCm: snow.top[i]! * 100,
      snowBaseCm: snow.base[i]! * 100,
      snowDensity: snow.density[i]!,
      altitudeM: mountain.datumAltitudeM + cat.body.py,
      groomedHere: snow.groomed[i]! > 0,
      pisteGroomed: world.pisteGroomedFraction,
      camera: rig.mode,
      fps,
      machine: cat.spec.name,
    };
  };

  await renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    if (input.wasPressed('KeyC')) rig.cycle();
    if (input.wasPressed('KeyH')) helpVisible.value = !helpVisible.value;
    if (input.wasPressed('KeyM')) audio.muted = !audio.muted;
    const driving = rig.mode !== 'free';
    const catInput = debug.autoInput ?? controls.read(input, driving);
    lastInput = catInput;
    const steps = clock.advance(dt);
    for (let s = 0; s < steps; s++) world.step(catInput);

    audio.update(dt, world.cat, catInput);
    catModel.sync(world.cat);
    catModel.setInteriorView(rig.mode === 'cab');
    rig.update(dt, input, world.cat);
    input.endFrame();

    cameraPosition.copy(camera.position);
    detail.update(rig.focus.x, rig.focus.z, now);
    terrain.update(cameraPosition);
    forest.update(cameraPosition);
    environment.update(rig.focus);
    renderer.render(scene, camera);

    debug.frames++;
    fpsFrames++;
    if (now - fpsStart >= 500) {
      fps = (fpsFrames * 1000) / (now - fpsStart);
      fpsStart = now;
      fpsFrames = 0;
    }
    if (now - hudAt > 100) {
      hudAt = now;
      updateHud();
    }
  });

  loadingMessage.value = null;
  return debug;
}

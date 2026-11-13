import { PerspectiveCamera, Scene, Vector3, type WebGPURenderer } from 'three/webgpu';
import type { SaveStore } from '../platform/saveStore';
import { createEnvironment } from '../render/environment';
import { FleetView } from '../render/fleetView';
import { createForest } from '../render/forest';
import { createGarage } from '../render/garage';
import { MachineEffects } from '../render/machineEffects';
import { Particles } from '../render/particles';
import { createSnowMaterial } from '../render/snowMaterial';
import { SurfaceDetailView } from '../render/surfaceDetail';
import { TerrainView } from '../render/terrainView';
import { WinchView } from '../render/winchView';
import type { GameMode } from '../sim/career';
import { FixedStepClock } from '../sim/clock';
import type { Command } from '../sim/commands';
import { machineModel, MACHINE_MODELS, UPGRADES, upgradePrice } from '../sim/machines/catalog';
import { Snowpack } from '../sim/snow/snowpack';
import { generateMountain, runById } from '../sim/terrain/mountain';
import { PathFollower } from '../sim/vehicles/autopilot';
import type { SnowcatInput } from '../sim/vehicles/snowcat';
import { World } from '../sim/world';
import { MachineAudio } from './sound/machineAudio';
import { loadSlot, peekSlot, SaveManager, slotFor } from './saving';
import { CameraRig, type CameraMode } from './cameraRig';
import {
  garageActions,
  garageMessage,
  garageOpen,
  garageSelected,
  garageView,
  helpVisible,
  hud,
  loadingMessage,
  modeMenu,
  notices,
  type DealerEntry,
  type FleetEntry,
  type Notice,
  type StartChoice,
} from './hudState';
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
  renderInfo(): { calls: number; triangles: number; particles: number };
  setCamera(mode: CameraMode): void;
  /** Applies a command as if the player had made it in the interface. */
  apply(command: Command): ReturnType<World['apply']>;
  /** Drives the Kestrel run uphill on autopilot for a number of steps, without rendering. */
  autoGroom(steps: number): void;
  /** Audio state, for tests. */
  audio(): { context: string; synth: boolean };
  /** Saves now; resolves true on success. */
  save(): Promise<boolean>;
  /** Runs simulation steps immediately, without rendering. */
  fastForward(steps: number, input: SnowcatInput): void;
}

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** Shows the start menu, with any saved games, and resolves with the player's choice. */
async function chooseStart(store: SaveStore | null): Promise<StartChoice> {
  const saves: Partial<Record<GameMode, NonNullable<Awaited<ReturnType<typeof peekSlot>>>>> = {};
  if (store) {
    for (const mode of ['career', 'sandbox'] as const) {
      const summary = await peekSlot(store, slotFor(mode));
      if (summary) saves[mode] = summary;
    }
  }
  return new Promise((resolve) => {
    modeMenu.value = {
      saves,
      savingAvailable: store !== null,
      choose: (choice) => {
        modeMenu.value = null;
        resolve(choice);
      },
    };
  });
}

function dealerStats(id: string): string {
  const { spec } = machineModel(id);
  const parts = [
    `${Math.round(spec.enginePowerW / 1000)} kW`,
    `tiller ${(spec.tillerHalfWidthM * 2).toFixed(1)} m`,
    `blade ${(spec.bladeHalfWidthM * 2).toFixed(1)} m`,
    `${Math.round(spec.maxForwardMs * 3.6)} km/h`,
  ];
  if (spec.winchPullN > 0) parts.push(`winch ${Math.round(spec.winchPullN / 1000)} kN`);
  return parts.join(' · ');
}

export interface StartOptions {
  renderer: WebGPURenderer;
  canvas: HTMLCanvasElement;
  seed: number;
  /** Skips the start menu when set. */
  choice: StartChoice | null;
  store: SaveStore | null;
}

export async function startGame({
  renderer,
  canvas,
  seed,
  choice: requested,
  store,
}: StartOptions): Promise<GameDebug> {
  loadingMessage.value = null;
  const choice = requested ?? (await chooseStart(store));
  loadingMessage.value = choice.resume ? 'Loading your mountain' : 'Shaping the mountain';
  await nextFrame();
  await nextFrame();
  const buildStart = performance.now();
  let world: World | null = null;
  let startNotice: string | null = null;
  if (choice.resume && store) {
    const loaded = await loadSlot(store, slotFor(choice.mode));
    if (loaded) {
      world = loaded.world;
      if (loaded.recoveredFrom) {
        startNotice = `The latest save was damaged; loaded the backup from ${new Date(loaded.recoveredFrom).toLocaleString()}.`;
      }
    } else {
      startNotice = 'The saved game could not be read, and no backup could either. Started a new game.';
    }
  }
  if (!world) {
    const fresh = generateMountain(seed);
    const freshSnow = new Snowpack(fresh);
    freshSnow.fillNatural(seed);
    world = new World(fresh, freshSnow, { mode: choice.mode });
  }
  const { mountain, snow } = world;
  const saves = new SaveManager(store, world, slotFor(choice.mode));
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
  const garage = createGarage();
  garage.position.set(
    mountain.depot.x,
    snow.surfaceAt(mountain.depot.x, mountain.depot.z + 24) - 0.4,
    mountain.depot.z + 24,
  );
  scene.add(garage);
  const fleet = new FleetView();
  scene.add(fleet.group);
  const winches = new WinchView(mountain, snow);
  scene.add(winches.group);
  const particles = new Particles(5000);
  scene.add(particles.mesh);
  const effects = new MachineEffects(particles, snow);
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

  const apply = (command: Command): ReturnType<World['apply']> => {
    const active = world.activeMachine.owned.uid;
    const result = world.apply(command);
    if (result.ok && world.activeMachine.owned.uid !== active) controls.reset();
    garageMessage.value = result.ok ? null : { text: result.reason, ok: false };
    refreshGarage();
    return result;
  };
  garageActions.buyMachine = (model) => {
    if (apply({ type: 'buyMachine', model }).ok) {
      garageSelected.value = world.machines[world.machines.length - 1]!.owned.uid;
      garageMessage.value = { text: `${machineModel(model).name} delivered to the garage.`, ok: true };
    }
  };
  garageActions.buyUpgrade = (machine, upgrade) => {
    if (apply({ type: 'buyUpgrade', machine, upgrade }).ok) {
      garageMessage.value = { text: `${UPGRADES[upgrade]!.name} fitted.`, ok: true };
    }
  };
  garageActions.drive = (machine) => {
    if (apply({ type: 'switchMachine', machine }).ok) garageOpen.value = false;
  };

  const refreshGarage = (): void => {
    const career = world.career;
    const fleetEntries: FleetEntry[] = world.machines.map((machine, index) => {
      const model = machineModel(machine.owned.model);
      return {
        uid: machine.owned.uid,
        name: model.name,
        modelId: model.id,
        driving: index === world.activeIndex,
        atGarage: world.atGarage(machine),
        upgrades: model.upgrades.map((id) => {
          const level = machine.owned.levels[id] ?? 0;
          const def = UPGRADES[id]!;
          return {
            id,
            name: def.name,
            summary: def.summary,
            level,
            maxLevel: def.costFractions.length,
            price: upgradePrice(model, id, level),
          };
        }),
      };
    });
    const dealer: DealerEntry[] = MACHINE_MODELS.map((model) => ({
      id: model.id,
      name: model.name,
      price: model.price,
      description: model.description,
      stats: dealerStats(model.id),
      owned: world.machines.filter((m) => m.owned.model === model.id).length,
    }));
    if (garageSelected.value === null || !fleetEntries.some((f) => f.uid === garageSelected.value)) {
      garageSelected.value = world.activeMachine.owned.uid;
    }
    garageView.value = {
      money: career.money,
      mode: career.mode,
      serviceable: world.atGarage(world.activeMachine),
      fleet: fleetEntries,
      dealer,
    };
  };

  const clock = new FixedStepClock({ stepSeconds: world.stepSeconds, maxStepsPerAdvance: 5 });
  const idle: SnowcatInput = { throttle: 0, steer: 0, bladeLift: 0, tillerDown: false };
  const debug: GameDebug = {
    world,
    rig,
    frames: 0,
    autoInput: null,
    buildMs,
    renderInfo: () => ({
      calls: renderer.info.render.drawCalls,
      triangles: renderer.info.render.triangles,
      particles: particles.activeCount,
    }),
    setCamera: (cameraMode) => rig.setMode(cameraMode),
    apply,
    save: () => saves.save(),
    audio: () => audio.state,
    autoGroom: (steps) => {
      const pilot = new PathFollower(runById(mountain, 'kestrel').line, -1, 0.62);
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
  let noticeId = 0;

  /** Turns earnings into on-screen notices; steady grooming pay adds up in one running notice. */
  const drainEarnings = (now: number): void => {
    if (world.events.length === 0 && notices.value.every((n) => now - n.at < 4500)) return;
    let list = notices.value.filter((n) => now - n.at < 4500);
    for (const event of world.events) {
      const bonus = !event.label.startsWith('Grooming');
      const running = !bonus
        ? list.find((n) => !n.bonus && n.amount !== null && n.text === event.label)
        : undefined;
      if (running)
        list = list.map((n) =>
          n === running ? { ...n, amount: (n.amount ?? 0) + event.amount, at: now } : n,
        );
      else
        list = [
          ...list,
          { id: noticeId++, text: event.label, amount: event.amount, at: now, bonus } satisfies Notice,
        ];
    }
    world.events.length = 0;
    notices.value = list.slice(-5);
  };

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
      cruiseKmh: controls.cruise === null ? null : controls.cruise * cat.spec.maxForwardMs * 3.6,
      winch:
        cat.spec.winchPullN > 0
          ? {
              anchor: world.winchAnchorName(world.activeMachine),
              cableOutM: cat.winchCableOutM,
              setting: cat.winchSetting,
              forceKn: cat.winchForceN / 1000,
              remainingM: cat.winchRemainingM,
            }
          : null,
      pitchDeg: (cat.pitch * 180) / Math.PI,
      rollDeg: (cat.roll * 180) / Math.PI,
      grip: cat.grip,
      sinkCm: cat.sinkM * 100,
      snowTopCm: snow.top[i]! * 100,
      snowBaseCm: snow.base[i]! * 100,
      snowDensity: snow.density[i]!,
      groomedHere: snow.groomed[i]! > 0,
      altitudeM: mountain.datumAltitudeM + cat.body.py,
      pisteGroomed: world.pisteGroomedFraction,
      runs: mountain.runs.map((run, r) => ({
        name: run.name,
        difficulty: run.difficulty,
        groomed: world.runGroomedFraction(r),
        sections: Array.from({ length: run.sectionCount }, (_, k) =>
          world.sectionGroomedFraction(run.firstSection + k),
        ),
      })),
      money: world.career.money,
      mode: world.career.mode,
      atGarage: world.atGarage(world.activeMachine),
      garageDistanceM: Math.hypot(cat.body.px - mountain.depot.x, cat.body.pz - mountain.depot.z),
      camera: rig.mode,
      fps,
      machine: cat.spec.name,
    };
    if (garageOpen.value) refreshGarage();
  };

  await renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    if (input.wasPressed('KeyG')) {
      garageOpen.value = !garageOpen.value;
      garageMessage.value = null;
      if (garageOpen.value) {
        garageSelected.value = world.activeMachine.owned.uid;
        refreshGarage();
      }
    }
    if (input.wasPressed('Escape')) garageOpen.value = false;
    if (input.wasPressed('KeyY') && rig.mode !== 'free' && !garageOpen.value) {
      const machine = world.activeMachine;
      const result = world.apply({
        type: 'winch',
        machine: machine.owned.uid,
        hook: !machine.vehicle.winchAnchor,
      });
      const text = result.ok
        ? machine.vehicle.winchAnchor
          ? `Winch hooked to ${world.winchAnchorName(machine)}`
          : 'Winch unhooked'
        : result.reason;
      notices.value = [
        ...notices.value,
        { id: noticeId++, text, amount: null, at: performance.now(), bonus: false },
      ].slice(-5);
    }
    if (input.wasPressed('F5')) {
      void saves.save().then((ok) => {
        if (ok)
          notices.value = [
            ...notices.value,
            { id: noticeId++, text: 'Game saved', amount: null, at: performance.now(), bonus: false },
          ].slice(-5);
      });
    }
    if (input.wasPressed('KeyC')) rig.cycle();
    if (input.wasPressed('KeyH')) helpVisible.value = !helpVisible.value;
    if (input.wasPressed('KeyM')) audio.muted = !audio.muted;
    const driving = rig.mode !== 'free' && !garageOpen.value;
    const catInput = debug.autoInput ?? controls.read(input, driving, world.cat);
    lastInput = catInput;
    const steps = clock.advance(dt);
    for (let s = 0; s < steps; s++) world.step(catInput);

    const under = snow.grid.nearest(world.cat.body.px, world.cat.body.pz);
    audio.update(dt, world.cat, catInput, {
      camera,
      inCab: rig.mode === 'cab',
      // Hardness from the top layer's density, or the consolidated base where the top is thin.
      snowHardness:
        snow.top[under]! < 0.03 ? 0.9 : Math.min(1, Math.max(0, (snow.density[under]! - 120) / 330)),
      altitudeM: mountain.datumAltitudeM + camera.position.y,
    });
    fleet.sync(world.machines);
    winches.sync(world.machines, fleet);
    effects.update(dt, world.cat);
    fleet.setInteriorView(rig.mode === 'cab' ? world.activeMachine.owned.uid : null);
    rig.update(dt, input, world.cat);
    input.endFrame();

    cameraPosition.copy(camera.position);
    detail.update(rig.focus.x, rig.focus.z, now);
    terrain.update(cameraPosition);
    forest.update(cameraPosition);
    particles.update(dt, camera, snow, 1.2, -0.6);
    environment.update(rig.focus);
    renderer.render(scene, camera);

    saves.tick(now);
    debug.frames++;
    fpsFrames++;
    if (now - fpsStart >= 500) {
      fps = (fpsFrames * 1000) / (now - fpsStart);
      fpsStart = now;
      fpsFrames = 0;
    }
    if (now - hudAt > 100) {
      hudAt = now;
      drainEarnings(now);
      updateHud();
    }
  });

  // Save when the desktop window closes, and when the browser tab is hidden or closed.
  window.corduroyNative?.onBeforeQuit(() => {
    void saves.save().finally(() => window.corduroyNative?.quitReady());
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void saves.save();
  });
  if (startNotice) {
    notices.value = [
      { id: noticeId++, text: startNotice, amount: null, at: performance.now() + 6000, bonus: false },
    ];
  }

  loadingMessage.value = null;
  return debug;
}

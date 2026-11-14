import { PerspectiveCamera, Scene, Vector3, type WebGPURenderer } from 'three/webgpu';
import type { SaveStore } from '../platform/saveStore';
import { createEnvironment, sunDirectionAt } from '../render/environment';
import { FleetView } from '../render/fleetView';
import { createForest } from '../render/forest';
import { createGarage } from '../render/garage';
import { LiftsView } from '../render/liftView';
import { SnowGunsView } from '../render/snowGunsView';
import { MachineEffects } from '../render/machineEffects';
import { resortLights } from '../render/lifts/materials';
import { machineDaylight } from '../render/machines/materials';
import { Particles } from '../render/particles';
import { createResortProps } from '../render/resortProps';
import { createSnowMaterial } from '../render/snowMaterial';
import { SurfaceDetailView } from '../render/surfaceDetail';
import { TerrainView } from '../render/terrainView';
import { WinchView } from '../render/winchView';
import { WorkLights } from '../render/workLights';
import type { GameMode } from '../sim/career';
import { FixedStepClock } from '../sim/clock';
import type { Command, CommandResult } from '../sim/commands';
import { effectiveSpec, machineModel, MACHINE_MODELS, UPGRADES, upgradePrice } from '../sim/machines/catalog';
import { COST_PER_M3, MADE_SNOW_DENSITY } from '../sim/snowmaking';
import { Snowpack } from '../sim/snow/snowpack';
import type { Conditions } from '../sim/weather';
import { generateMountain, runById } from '../sim/terrain/mountain';
import { PathFollower } from '../sim/vehicles/autopilot';
import type { SnowcatInput, SnowcatSpec } from '../sim/vehicles/snowcat';
import { World } from '../sim/world';
import { ClientSession } from '../net/client';
import { HostSession } from '../net/host';
import { HOST_PLAYER, makeRoomCode, mathSignature, type PlayerInfo } from '../net/protocol';
import { MachineAudio } from './sound/machineAudio';
import {
  createTransport,
  decodeFromHost,
  encodeForPeer,
  joinLink,
  menuUrl,
  rememberPlayerName,
  savedPlayerName,
} from './multiplayer';
import { NameTags } from './nameTags';
import { loadSlot, peekSlot, SaveManager, saveStatus, slotFor } from './saving';
import { CameraRig, type CameraMode } from './cameraRig';
import {
  garageActions,
  garageMessage,
  garageOpen,
  garageSelected,
  garageView,
  helpVisible,
  liftActions,
  liftsMessage,
  liftsOpen,
  liftsView,
  snowmakingActions,
  snowmakingMessage,
  snowmakingOpen,
  snowmakingView,
  type LiftEntry,
  type SnowmakingEntry,
  hud,
  loadingMessage,
  modeMenu,
  netActions,
  netEnded,
  netMessage,
  netView,
  notices,
  playOpen,
  type DealerEntry,
  type FleetEntry,
  type MachineSpecs,
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
  /** Named parts of the scene, for profiling (hide one and measure). */
  layers: Record<string, { visible: boolean }>;
  /** Audio state, for tests. */
  audio(): { context: string; synth: boolean };
  /** Saves now; resolves true on success. */
  save(): Promise<boolean>;
  /** Runs simulation steps immediately, without rendering. */
  fastForward(steps: number, input: SnowcatInput): void;
  /** Machine models built so far (each visible upgrade rebuilds one). */
  modelBuilds(): number;
  /** Carriers of a lift drawn in detail and as plain stand-ins last frame. */
  liftDetail(id: string): { near: number; far: number } | null;
}

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** Shows the start menu, with any saved games, and resolves with the player's choice. */
async function chooseStart(
  store: SaveStore | null,
  joinError: string | null = null,
  joinCode: string | null = null,
): Promise<StartChoice> {
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
      joinError,
      joinCode,
      playerName: savedPlayerName(),
      choose: (choice) => {
        modeMenu.value = null;
        resolve(choice);
      },
    };
  });
}

function machineSpecs(spec: SnowcatSpec): MachineSpecs {
  return {
    powerKw: spec.enginePowerW / 1000,
    tillerM: spec.tillerHalfWidthM * 2,
    bladeM: spec.bladeHalfWidthM * 2,
    topKmh: spec.maxForwardMs * 3.6,
    winchKn: spec.winchPullN / 1000,
  };
}

export interface StartOptions {
  renderer: WebGPURenderer;
  canvas: HTMLCanvasElement;
  seed: number;
  /** Skips the start menu when set. */
  choice: StartChoice | null;
  store: SaveStore | null;
  /** A game code from a join link: the menu opens on the join form with it filled in. */
  joinCode?: string | null;
}

export async function startGame({
  renderer,
  canvas,
  seed,
  choice: requested,
  store,
  joinCode = null,
}: StartOptions): Promise<GameDebug> {
  loadingMessage.value = null;
  const choice = requested ?? (await chooseStart(store, null, joinCode));
  let world: World | null = null;
  let startNotice: string | null = null;
  /** Set when playing in someone else's game. */
  let client: ClientSession | null = null;
  const buildStart = performance.now();
  if ('join' in choice) {
    loadingMessage.value = 'Joining the game';
    rememberPlayerName(choice.join.name);
    const session = new ClientSession({
      transport: createTransport(choice.join.code),
      name: choice.join.name,
      math: mathSignature(),
      decode: decodeFromHost,
    });
    try {
      world = await session.join();
      client = session;
    } catch (error) {
      loadingMessage.value = null;
      const reason = error instanceof Error ? error.message : String(error);
      return startGame({
        renderer,
        canvas,
        seed,
        choice: await chooseStart(store, reason, choice.join.code),
        store,
      });
    }
  } else {
    loadingMessage.value = choice.resume ? 'Loading your mountain' : 'Shaping the mountain';
    await nextFrame();
    await nextFrame();
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
  }
  const { mountain, snow } = world;
  // A joined player's game is saved by the host.
  const saves = new SaveManager(client ? null : store, world, slotFor(world.career.mode));
  if (client) saveStatus.value = { state: 'remote', lastSavedAt: null, message: null };
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
  const props = createResortProps(mountain, snow);
  scene.add(props);
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
  const workLights = new WorkLights();
  scene.add(workLights.group);
  const gunsScene = new SnowGunsView(world.snowmaking, snow);
  scene.add(gunsScene.group);
  const liftsScene = new LiftsView(snow);
  scene.add(liftsScene.group);
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

  /** Set while this game is open to friends. */
  let host: HostSession | null = null;
  let noticeId = 0;
  const notify = (text: string): void => {
    notices.value = [
      ...notices.value,
      { id: noticeId++, text, amount: null, at: performance.now(), bonus: false },
    ].slice(-5);
  };

  const sessionSeats = () => host?.seats ?? client?.seats ?? null;
  const localPlayer = (): string => client?.player ?? HOST_PLAYER;
  /** The machine this player drives; null for a joined player who is watching. */
  const localSeat = (): number | null => (client ? client.seat : world.activeMachine.owned.uid);
  const seated = (): boolean => localSeat() !== null;

  /** Shows what a command did in the panel it came from. Runs when the command takes effect. */
  const showResult = (command: Command, result: CommandResult): void => {
    const failed = result.ok ? null : { text: result.reason, ok: false };
    switch (command.type) {
      case 'buyMachine':
        if (result.ok) {
          garageSelected.value = world.machines[world.machines.length - 1]!.owned.uid;
          garageMessage.value = {
            text: `${machineModel(command.model).name} delivered to the garage.`,
            ok: true,
          };
        } else garageMessage.value = failed;
        break;
      case 'buyUpgrade':
        garageMessage.value = result.ok
          ? { text: `${UPGRADES[command.upgrade]!.name} fitted.`, ok: true }
          : failed;
        break;
      case 'switchMachine':
        if (result.ok) {
          garageOpen.value = false;
          controls.reset();
        } else garageMessage.value = failed;
        break;
      case 'buyLift':
        liftsMessage.value = result.ok
          ? { text: `${world.liftById(command.lift)!.line.name} built and running.`, ok: true }
          : failed;
        break;
      case 'liftControl':
        liftsMessage.value = failed;
        break;
      case 'installSnowmaking': {
        const name = mountain.runs.find((r) => r.id === command.run)?.name ?? command.run;
        snowmakingMessage.value = result.ok ? { text: `Snow guns installed on ${name}.`, ok: true } : failed;
        break;
      }
      case 'snowmakingMode':
        snowmakingMessage.value = failed;
        break;
      case 'winch': {
        const machine = world.machines.find((m) => m.owned.uid === command.machine);
        if (!result.ok) notify(result.reason);
        else if (machine)
          notify(command.hook ? `Winch hooked to ${world.winchAnchorName(machine)}` : 'Winch unhooked');
        break;
      }
    }
    if (garageOpen.value) refreshGarage();
    if (liftsOpen.value) refreshLifts();
    if (snowmakingOpen.value) refreshSnowmaking();
  };

  /**
   * Every change a player makes goes through here. Alone it applies at once; in a shared game it
   * goes to the host and takes effect, on every copy of the world, when the host's frame applies it.
   */
  const issue = (command: Command): void => {
    if (client) client.submit(command);
    else if (host) host.submit(command);
    else showResult(command, world.apply(command));
  };
  /** Immediate apply, for tests and tools in a single-player game. */
  const apply = (command: Command): ReturnType<World['apply']> => {
    const result = world.apply(command);
    showResult(command, result);
    return result;
  };
  garageActions.buyMachine = (model) => issue({ type: 'buyMachine', model });
  garageActions.buyUpgrade = (machine, upgrade) => issue({ type: 'buyUpgrade', machine, upgrade });
  garageActions.drive = (machine) => issue({ type: 'switchMachine', machine });

  const refreshLifts = (): void => {
    const lifts: LiftEntry[] = world.lifts.map((lift) => ({
      id: lift.line.id,
      name: lift.line.name,
      type: lift.line.kind,
      kind: lift.type.label,
      built: world.career.lifts.has(lift.line.id),
      price: lift.type.price,
      state: lift.state,
      speedKmh: lift.speedMs * 3.6,
      speedSetting: lift.speedSetting,
      ridersPerHour: world.liftRidersPerHour(lift),
      capacityPerHour: lift.capacityPerHour,
      lengthM: lift.lengthM,
      towers: lift.towers.length - 2,
      serves: lift.line.serves.map((id) => {
        const r = mountain.runs.findIndex((run) => run.id === id);
        return { name: mountain.runs[r]!.name, groomed: world.runGroomedFraction(r) };
      }),
    }));
    liftsView.value = { money: world.career.money, mode: world.career.mode, lifts };
  };
  liftActions.buy = (lift) => issue({ type: 'buyLift', lift });
  liftActions.control = (lift, action, speed) =>
    issue(
      speed === undefined
        ? { type: 'liftControl', lift, action }
        : { type: 'liftControl', lift, action, speed },
    );

  const conditions: Conditions = { tempC: 0, humidity: 0, wetBulbC: 0, windMs: 0, windToward: 0 };
  const sunScratch = new Vector3();
  const refreshSnowmaking = (): void => {
    const making = world.snowmaking;
    const runs: SnowmakingEntry[] = mountain.runs.map((run, r) => {
      const guns = making.guns.map((g, k) => ({ g, k })).filter(({ g }) => g.run === r);
      const output = guns.reduce((sum, { k }) => sum + making.output[k]!, 0);
      const mid = guns[Math.floor(guns.length / 2)]?.g;
      const wet = mid ? world.weather.at(mid.y, conditions).wetBulbC : 0;
      const m3h = (output * 3600) / MADE_SNOW_DENSITY;
      return {
        runId: run.id,
        name: run.name,
        guns: guns.length,
        installed: making.installed[r]!,
        price: making.price(r),
        mode: making.mode[r]!,
        running: guns.filter(({ k }) => making.output[k]! > 0).length,
        outputM3h: m3h,
        costPerHour: m3h * COST_PER_M3,
        cover: world.runCover[r]!,
        wetBulbC: wet,
      };
    });
    snowmakingView.value = {
      money: world.career.money,
      mode: world.career.mode,
      spent: world.snowmakingSpent,
      runs,
    };
  };
  snowmakingActions.install = (run) => issue({ type: 'installSnowmaking', run });
  snowmakingActions.setMode = (run, mode) => issue({ type: 'snowmakingMode', run, mode });

  const refreshGarage = (): void => {
    const career = world.career;
    const fleetEntries: FleetEntry[] = world.machines.map((machine) => {
      const model = machineModel(machine.owned.model);
      return {
        uid: machine.owned.uid,
        name: model.name,
        modelId: model.id,
        driving: machine.owned.uid === localSeat(),
        atGarage: world.atGarage(machine),
        driver: (() => {
          const id = sessionSeats()?.driverOf(machine.owned.uid) ?? null;
          return id === null || id === localPlayer() ? null : (sessionSeats()?.players.get(id)?.name ?? null);
        })(),
        specs: machineSpecs(effectiveSpec(model, machine.owned.levels)),
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
      specs: machineSpecs(machineModel(model.id).spec),
      owned: world.machines.filter((m) => m.owned.model === model.id).length,
    }));
    if (garageSelected.value === null || !fleetEntries.some((f) => f.uid === garageSelected.value)) {
      garageSelected.value = world.activeMachine.owned.uid;
    }
    garageView.value = {
      money: career.money,
      mode: career.mode,
      // A player without a machine has nothing to park first.
      serviceable: !seated() || world.atGarage(world.activeMachine),
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
    layers: {},
    audio: () => audio.state,
    autoGroom: (steps) => {
      const pilot = new PathFollower(runById(mountain, 'kestrel').line, -1, 0.62);
      for (let i = 0; i < steps && !pilot.done; i++) world.step(pilot.update(world.cat, true));
    },
    fastForward: (steps, stepInput) => {
      for (let i = 0; i < steps; i++) world.step(stepInput);
    },
    modelBuilds: () => fleet.builds,
    liftDetail: (id) => liftsScene.drawn(id),
  };

  let lastInput: SnowcatInput = idle;
  const cameraPosition = new Vector3();
  let last = performance.now();
  let hudAt = 0;
  let fpsFrames = 0;
  let fpsStart = last;
  let fps = 0;

  /** Turns earnings into on-screen notices; steady grooming pay adds up in one running notice. */
  const drainEarnings = (now: number): void => {
    if (world.events.length === 0 && notices.value.every((n) => now - n.at < 4500)) return;
    let list = notices.value.filter((n) => now - n.at < 4500);
    for (const event of world.events) {
      // Steady income (grooming, lift tickets) adds up in one running notice; bonuses stand alone.
      const bonus = !event.label.startsWith('Grooming') && event.label !== 'Lift tickets';
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
      coverCm: snow.coverDepth(i) * 100,
      thinCover: snow.coverQuality(i) < 0.7,
      clock: `Day ${world.weather.day} · ${String(Math.floor(world.weather.hour)).padStart(2, '0')}:${String(Math.floor((world.weather.hour % 1) * 60)).padStart(2, '0')}`,
      tempC: world.weather.at(cat.body.py, conditions).tempC,
      wetBulbC: conditions.wetBulbC,
      windMs: conditions.windMs,
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
      modelId: world.activeMachine.owned.model,
      night: sunDirectionAt(world.weather.hour, sunScratch).y < 0,
    };
    if (garageOpen.value) refreshGarage();
    if (liftsOpen.value) refreshLifts();
    if (snowmakingOpen.value) refreshSnowmaking();
  };

  // --- Playing together ---------------------------------------------------------------------
  let roomCode: string | null = 'join' in choice ? choice.join.code : null;
  const nameTags = new NameTags(document.getElementById('ui') ?? document.body);
  const tagged: { id: string; name: string; x: number; y: number; z: number }[] = [];
  const updateNameTags = (): void => {
    const seats = sessionSeats();
    tagged.length = 0;
    if (seats)
      for (const p of seats.players.values()) {
        if (p.id === localPlayer() || p.seat === null) continue;
        const machine = world.machines.find((m) => m.owned.uid === p.seat);
        if (!machine) continue;
        const b = machine.vehicle.body;
        tagged.push({
          id: p.id,
          name: p.name,
          x: b.px,
          y: b.py + 4.2 * (machine.vehicle.spec.bodyLengthM / 8),
          z: b.pz,
        });
      }
    nameTags.update(camera, tagged);
  };
  const isDriven = (uid: number): boolean =>
    uid === localSeat() || (sessionSeats()?.driverOf(uid) ?? null) !== null;
  /** Keeps the camera, controls and HUD on this player's own machine as seats change. */
  const followSeat = (): void => {
    const seat = host ? host.seats.seatOf(HOST_PLAYER) : client ? client.seat : null;
    if (seat === null) return;
    const index = world.machines.findIndex((m) => m.owned.uid === seat);
    if (index >= 0 && index !== world.activeIndex) {
      world.activeIndex = index;
      controls.reset();
    }
  };
  let knownPlayers = new Map<string, string>();
  const announce = (players: readonly PlayerInfo[]): void => {
    const now = new Map(players.map((p) => [p.id, p.name]));
    for (const [id, name] of now)
      if (!knownPlayers.has(id) && id !== localPlayer()) notify(`${name} joined the game`);
    for (const [id, name] of knownPlayers) if (!now.has(id)) notify(`${name} left the game`);
    knownPlayers = now;
  };
  const updateNet = (): void => {
    const seats = sessionSeats();
    if (!seats) {
      netView.value = { role: 'solo', code: null, link: null, players: [] };
      return;
    }
    netView.value = {
      role: host ? 'host' : 'client',
      code: roomCode,
      link: roomCode ? joinLink(roomCode) : null,
      players: seats.list().map((p) => ({
        id: p.id,
        name: p.name,
        machine:
          p.seat === null
            ? null
            : (world.machines.find((m) => m.owned.uid === p.seat)?.vehicle.spec.name ?? null),
        you: p.id === localPlayer(),
        host: p.id === HOST_PLAYER,
      })),
    };
  };
  netActions.open = (name) => {
    if (host || client) return;
    const hostName = name.trim().slice(0, 24) || 'Host';
    rememberPlayerName(hostName);
    roomCode = makeRoomCode();
    const session = new HostSession({
      world,
      transport: createTransport(roomCode),
      hostName,
      math: mathSignature(),
      encode: encodeForPeer,
    });
    session.onCommand = (player, command, result) => {
      if (player === HOST_PLAYER) showResult(command, result);
    };
    session.onPlayers = (players) => {
      announce(players);
      updateNet();
    };
    host = session;
    knownPlayers = new Map(session.players.map((p) => [p.id, p.name]));
    updateNet();
    netMessage.value = { text: 'Your game is open. Send the code to your friends.', ok: true };
  };
  netActions.close = () => {
    if (!host) return;
    host.close();
    host = null;
    roomCode = null;
    knownPlayers.clear();
    updateNet();
    netMessage.value = { text: 'Your game is closed to friends. Everyone else has left.', ok: true };
  };
  netActions.leave = () => {
    client?.close();
    location.assign(menuUrl());
  };
  if (client) {
    const session = client;
    session.onCommand = (player, command, result) => {
      if (player === session.player) showResult(command, result);
    };
    session.onPlayers = (players) => {
      announce(players);
      updateNet();
    };
    session.onClosed = (reason) => {
      netEnded.value = { reason, rejoin: null };
    };
    session.onDesync = () => {
      session.close();
      netEnded.value = {
        reason: "Your copy of the game fell out of step with the host's.",
        rejoin: roomCode ? joinLink(roomCode, savedPlayerName()) : null,
      };
    };
    knownPlayers = new Map(session.seats!.list().map((p) => [p.id, p.name]));
    updateNet();
    followSeat();
  }
  addEventListener('pagehide', () => {
    host?.close();
    client?.close();
  });

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
    if (input.wasPressed('KeyL')) {
      liftsOpen.value = !liftsOpen.value;
      liftsMessage.value = null;
      if (liftsOpen.value) {
        garageOpen.value = false;
        refreshLifts();
      }
    }
    if (input.wasPressed('KeyN')) {
      snowmakingOpen.value = !snowmakingOpen.value;
      snowmakingMessage.value = null;
      if (snowmakingOpen.value) {
        garageOpen.value = false;
        liftsOpen.value = false;
        refreshSnowmaking();
      }
    }
    if (input.wasPressed('Escape')) {
      garageOpen.value = false;
      liftsOpen.value = false;
      snowmakingOpen.value = false;
      playOpen.value = false;
    }
    if (input.wasPressed('KeyY') && rig.mode !== 'free' && !garageOpen.value && seated()) {
      const machine = world.activeMachine;
      issue({ type: 'winch', machine: machine.owned.uid, hook: !machine.vehicle.winchAnchor });
    }
    if (input.wasPressed('F5')) {
      void saves.save().then((ok) => {
        if (ok) notify('Game saved');
      });
    }
    if (input.wasPressed('KeyC')) rig.cycle();
    if (input.wasPressed('KeyH')) helpVisible.value = !helpVisible.value;
    if (input.wasPressed('KeyM')) audio.muted = !audio.muted;
    if (input.wasPressed('KeyP')) {
      playOpen.value = !playOpen.value;
      netMessage.value = null;
      if (playOpen.value) {
        garageOpen.value = false;
        liftsOpen.value = false;
        snowmakingOpen.value = false;
      }
    }
    const driving =
      seated() &&
      rig.mode !== 'free' &&
      !garageOpen.value &&
      !liftsOpen.value &&
      !snowmakingOpen.value &&
      !playOpen.value;
    const catInput = debug.autoInput ?? controls.read(input, driving, world.cat);
    lastInput = catInput;
    if (client) {
      // A joined player sends controls to the host and follows the host's frames.
      client.sendInput(catInput);
      client.advance(dt);
    } else {
      const steps = clock.advance(dt);
      for (let s = 0; s < steps; s++) {
        if (host) host.step(catInput);
        else world.step(catInput);
      }
      host?.flush();
    }
    followSeat();

    const under = snow.grid.nearest(world.cat.body.px, world.cat.body.pz);
    audio.update(dt, world.cat, catInput, {
      camera,
      inCab: rig.mode === 'cab',
      // Hardness from the top layer's density, or the consolidated base where the top is thin.
      snowHardness:
        snow.top[under]! < 0.03 ? 0.9 : Math.min(1, Math.max(0, (snow.density[under]! - 120) / 330)),
      altitudeM: mountain.datumAltitudeM + camera.position.y,
    });
    const lampLevel = Math.max(0, Math.min(1, (environment.darkness - 0.25) / 0.4));
    machineDaylight.value = 1 - environment.darkness;
    resortLights.value = lampLevel;
    fleet.sync(world.machines, {
      active: world.activeIndex,
      isDriven,
      camera: camera.position,
      lights: lampLevel,
      dt,
      rpm: audio.engineRpm,
    });
    winches.sync(world.machines, fleet);
    const drivenModel = fleet.model(world.activeMachine.owned.uid);
    if (drivenModel) rig.cabEye.copy(drivenModel.cabEye);
    effects.update(dt, world.cat, drivenModel?.exhaust);
    liftsScene.update(world.lifts, world.career.lifts, (lift) => world.liftUse(lift), camera.position);
    gunsScene.update(dt, particles, world.weather, camera.position);
    fleet.setInteriorView(rig.mode === 'cab' ? world.activeMachine.owned.uid : null);
    rig.update(dt, input, world.cat);
    input.endFrame();
    if (sessionSeats()) updateNameTags();

    cameraPosition.copy(camera.position);
    detail.update(rig.focus.x, rig.focus.z, now);
    terrain.update(cameraPosition);
    forest.update(cameraPosition);
    particles.update(dt, camera, snow, 1.2, -0.6);
    environment.update(rig.focus, world.weather.hour);
    workLights.update(world.cat, environment.darkness);
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

  debug.layers = {
    props,
    garage,
    lifts: liftsScene.group,
    particles: particles.mesh,
    forest: forest.group,
    fleet: fleet.group,
    terrain: terrain.group,
  };
  debug.layers.shadows = {
    get visible() {
      return renderer.shadowMap.enabled;
    },
    set visible(on: boolean) {
      renderer.shadowMap.enabled = on;
    },
  };

  loadingMessage.value = null;
  return debug;
}

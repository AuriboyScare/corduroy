import { signal } from '@preact/signals';
import type { SaveSummary } from '../platform/saveFile';
import type { GameMode } from '../sim/career';
import type { Difficulty, LiftKind } from '../sim/resort/layout';
import type { CameraMode } from './cameraRig';

export interface RunStatus {
  name: string;
  difficulty: Difficulty;
  /** Groomed share of the whole run, 0..1. */
  groomed: number;
  /** Groomed share of each section from the top, 0..1. */
  sections: number[];
}

/** What the HUD shows; written by the game loop a few times a second. */
export interface HudData {
  speedKmh: number;
  engineLoad: number;
  engineRpm: number;
  muted: boolean;
  bladeHeightCm: number;
  bladeLoadKg: number;
  bladeCapacityKg: number;
  tillerDown: boolean;
  tillerWorking: boolean;
  groomQuality: number;
  /** Set speed when cruise control is engaged. */
  cruiseKmh: number | null;
  /** Winch readout; null for machines without one. */
  winch: {
    anchor: string | null;
    cableOutM: number;
    setting: number;
    forceKn: number;
    remainingM: number;
  } | null;
  pitchDeg: number;
  rollDeg: number;
  grip: number;
  sinkCm: number;
  snowTopCm: number;
  snowBaseCm: number;
  snowDensity: number;
  /** The cell under the machine carries finished grooming. */
  groomedHere: boolean;
  altitudeM: number;
  /** Consolidated cover under the machine, cm, and whether it is too thin to groom well. */
  coverCm: number;
  thinCover: boolean;
  clock: string;
  tempC: number;
  wetBulbC: number;
  windMs: number;
  pisteGroomed: number;
  runs: RunStatus[];
  money: number;
  mode: GameMode;
  atGarage: boolean;
  garageDistanceM: number;
  camera: CameraMode;
  fps: number;
  machine: string;
  /** Machine model id, for its silhouette. */
  modelId: string;
  /** The sun is down. */
  night: boolean;
}

export const hud = signal<HudData | null>(null);
export const loadingMessage = signal<string | null>('Starting');
export const helpVisible = signal(true);

export type StartChoice =
  | {
      mode: GameMode;
      /** Load the saved game for this mode instead of starting fresh. */
      resume: boolean;
    }
  /** Join a friend's game by its code. */
  | { join: { code: string; name: string } };

/** Shown before the world is built, to pick career or sandbox, new or saved, or join a friend. */
export const modeMenu = signal<{
  choose: (choice: StartChoice) => void;
  saves: Partial<Record<GameMode, SaveSummary>>;
  savingAvailable: boolean;
  /** Why the last attempt to join failed. */
  joinError: string | null;
  /** The name this player used last time. */
  playerName: string;
  /** A game code from a join link, to fill in. */
  joinCode: string | null;
} | null>(null);

export interface NetPlayer {
  id: string;
  name: string;
  /** Name of the machine they drive, or null when watching. */
  machine: string | null;
  you: boolean;
  host: boolean;
}

/** The shared-game panel and HUD line. */
export interface NetView {
  role: 'solo' | 'host' | 'client';
  /** Room code while the game is open to friends. */
  code: string | null;
  /** A link that joins the game directly. */
  link: string | null;
  players: NetPlayer[];
}

export const playOpen = signal(false);
export const netView = signal<NetView>({ role: 'solo', code: null, link: null, players: [] });
export const netMessage = signal<{ text: string; ok: boolean } | null>(null);
/** Set by the game; the panel calls these. */
export const netActions = {
  open: (_name: string): void => {},
  close: (): void => {},
  leave: (): void => {},
};
/** The game ended for this player (the host left, or this copy fell out of step). */
export const netEnded = signal<{ reason: string; rejoin: string | null } | null>(null);

export interface Notice {
  id: number;
  text: string;
  /** Money earned; null for plain information. */
  amount: number | null;
  /** performance.now() when last updated; notices fade after a few seconds. */
  at: number;
  bonus: boolean;
}
export const notices = signal<Notice[]>([]);

/** Headline numbers for a machine, after any upgrades. */
export interface MachineSpecs {
  powerKw: number;
  tillerM: number;
  bladeM: number;
  topKmh: number;
  winchKn: number;
}

export interface FleetEntry {
  uid: number;
  name: string;
  modelId: string;
  driving: boolean;
  atGarage: boolean;
  /** Another player driving this machine, by name. */
  driver: string | null;
  specs: MachineSpecs;
  upgrades: {
    id: string;
    name: string;
    summary: string;
    level: number;
    maxLevel: number;
    price: number | null;
  }[];
}

export interface DealerEntry {
  id: string;
  name: string;
  price: number;
  description: string;
  specs: MachineSpecs;
  owned: number;
}

export interface GarageView {
  money: number;
  mode: GameMode;
  /** The machine being driven is parked at the garage, so upgrades and swaps are allowed. */
  serviceable: boolean;
  fleet: FleetEntry[];
  dealer: DealerEntry[];
}

export const garageOpen = signal(false);
export const garageView = signal<GarageView | null>(null);
export const garageSelected = signal<number | null>(null);
export const garageMessage = signal<{ text: string; ok: boolean } | null>(null);

/** Set by the game when it starts; the garage panel calls these. */
export const garageActions = {
  buyMachine: (_model: string): void => {},
  buyUpgrade: (_machine: number, _upgrade: string): void => {},
  drive: (_machine: number): void => {},
};

/** Plain-language name for snow of a given density and treatment. */
export function snowLabel(topCm: number, density: number, groomed: boolean): string {
  if (topCm < 2) return 'Hard base';
  if (groomed) return 'Groomed corduroy';
  if (density < 160) return 'Fresh powder';
  if (density < 260) return 'Settled powder';
  if (density < 400) return 'Packed snow';
  return 'Hard-packed snow';
}

export const formatMoney = (amount: number): string =>
  amount === Infinity ? 'Unlimited' : `$${Math.floor(amount).toLocaleString('en-US')}`;

export interface LiftEntry {
  id: string;
  name: string;
  type: LiftKind;
  kind: string;
  built: boolean;
  price: number;
  state: 'stopped' | 'running' | 'emergency';
  speedKmh: number;
  speedSetting: number;
  ridersPerHour: number;
  capacityPerHour: number;
  lengthM: number;
  towers: number;
  serves: { name: string; groomed: number }[];
}

export const liftsOpen = signal(false);
export const liftsView = signal<{ money: number; mode: GameMode; lifts: LiftEntry[] } | null>(null);
export const liftsMessage = signal<{ text: string; ok: boolean } | null>(null);
export const liftActions = {
  buy: (_lift: string): void => {},
  control: (_lift: string, _action: 'start' | 'stop' | 'emergency' | 'speed', _speed?: number): void => {},
};

export interface SnowmakingEntry {
  runId: string;
  name: string;
  guns: number;
  installed: boolean;
  price: number;
  mode: 'off' | 'auto' | 'on';
  running: number;
  /** Snow being made on the run now, m³ per game hour. */
  outputM3h: number;
  costPerHour: number;
  cover: number;
  wetBulbC: number;
}

export const snowmakingOpen = signal(false);
export const snowmakingView = signal<{
  money: number;
  mode: GameMode;
  spent: number;
  runs: SnowmakingEntry[];
} | null>(null);
export const snowmakingMessage = signal<{ text: string; ok: boolean } | null>(null);
export const snowmakingActions = {
  install: (_run: string): void => {},
  setMode: (_run: string, _mode: 'off' | 'auto' | 'on'): void => {},
};

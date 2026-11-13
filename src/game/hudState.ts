import { signal } from '@preact/signals';
import type { GameMode } from '../sim/career';
import type { Difficulty } from '../sim/resort/layout';
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
  pisteGroomed: number;
  runs: RunStatus[];
  money: number;
  mode: GameMode;
  atGarage: boolean;
  garageDistanceM: number;
  camera: CameraMode;
  fps: number;
  machine: string;
}

export const hud = signal<HudData | null>(null);
export const loadingMessage = signal<string | null>('Starting');
export const helpVisible = signal(true);

/** Shown before the world is built, to pick career or sandbox. */
export const modeMenu = signal<((mode: GameMode) => void) | null>(null);

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

export interface FleetEntry {
  uid: number;
  name: string;
  modelId: string;
  driving: boolean;
  atGarage: boolean;
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
  stats: string;
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

import { signal } from '@preact/signals';
import type { CameraMode } from './cameraRig';

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
  camera: CameraMode;
  fps: number;
  machine: string;
}

export const hud = signal<HudData | null>(null);
export const loadingMessage = signal<string | null>('Starting');
export const helpVisible = signal(true);

/** Plain-language name for snow of a given density and treatment. */
export function snowLabel(topCm: number, density: number, groomed: boolean): string {
  if (topCm < 2) return 'Hard base';
  if (groomed) return 'Groomed corduroy';
  if (density < 160) return 'Fresh powder';
  if (density < 260) return 'Settled powder';
  if (density < 400) return 'Packed snow';
  return 'Hard-packed snow';
}

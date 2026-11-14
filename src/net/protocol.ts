import type { Command } from '../sim/commands';
import type { SnowcatInput } from '../sim/vehicles/snowcat';

/**
 * Multiplayer protocol. The host runs the world and, every fixed step, broadcasts a frame: the
 * inputs of every driven machine and any commands players issued. Every copy of the world applies
 * the same frames in the same order, so they stay identical; a joining player receives the world
 * as save-file bytes and then follows the frames.
 */

/** Bump when frames or messages change shape; mismatched versions are refused. */
export const PROTOCOL_VERSION = 1;
export const HOST_PLAYER = 'host';
/** The host sends a world fingerprint this often, in steps. */
export const HASH_INTERVAL = 120;
/** Most players in one game, host included. */
export const MAX_PLAYERS = 4;

/** Inputs travel as small integers so every copy steps with exactly the same values. */
export type PackedInput = readonly [
  throttle: number,
  steer: number,
  blade: number,
  tiller: number,
  winch: number,
];

const q = (v: number): number => Math.max(-127, Math.min(127, Math.round(v * 127)));

export function packInput(input: SnowcatInput): PackedInput {
  return [
    q(input.throttle),
    q(input.steer),
    q(input.bladeLift),
    input.tillerDown ? 1 : 0,
    q(input.winchAdjust ?? 0),
  ];
}

export function unpackInput(p: PackedInput): SnowcatInput {
  const input: SnowcatInput = {
    throttle: p[0] / 127,
    steer: p[1] / 127,
    bladeLift: p[2] / 127,
    tillerDown: p[3] === 1,
  };
  if (p[4] !== 0) input.winchAdjust = p[4] / 127;
  return input;
}

export const IDLE_INPUT: PackedInput = [0, 0, 0, 0, 0];

/** Something a player did, applied at the same step on every copy. */
export type FrameEvent =
  | { player: string; command: Command }
  /** A player takes a seat in a machine (or none), joins or leaves. */
  | { player: string; seat: number | null; name?: string; left?: boolean };

/** One fixed step: driven machines' inputs and the events applied before stepping. */
export interface Frame {
  /** Machine uid followed by its packed input, for each driven machine. */
  inputs: [uid: number, input: PackedInput][];
  events?: FrameEvent[];
}

export interface PlayerInfo {
  id: string;
  name: string;
  /** Machine uid the player drives, or null when on foot (watching). */
  seat: number | null;
}

export type ToHost =
  | { type: 'hello'; name: string; version: number; math: string }
  | { type: 'input'; input: PackedInput }
  | { type: 'command'; command: Command };

export type ToClient =
  | { type: 'refuse'; reason: string }
  /** Sent with the snapshot: the world as of `tick`; frames follow from `tick + 1`. */
  | { type: 'welcome'; player: string; tick: number; players: PlayerInfo[] }
  | { type: 'frames'; first: number; frames: Frame[] }
  | { type: 'hash'; tick: number; hash: number }
  | { type: 'players'; players: PlayerInfo[] };

/**
 * Fingerprint of this JavaScript engine's floating-point maths. Copies of the world stay identical
 * only when every player's engine computes these functions bit for bit the same.
 */
export function mathSignature(): string {
  const view = new DataView(new ArrayBuffer(8));
  let h = 0x811c9dc5;
  const mix = (value: number): void => {
    view.setFloat64(0, value);
    for (let k = 0; k < 8; k++) h = Math.imul(h ^ view.getUint8(k), 0x01000193);
  };
  for (let k = 1; k <= 40; k++) {
    const x = k * 0.731 - 9.3;
    mix(Math.sin(x));
    mix(Math.cos(x * 1.7));
    mix(Math.exp(x * 0.21));
    mix(Math.pow(Math.abs(x) + 0.5, 1.37));
    mix(Math.atan2(x, 2.1 - x * 0.3));
    mix(Math.log(Math.abs(x) + 0.01));
    mix(Math.hypot(x, x * 0.37 + 1));
    mix(Math.asin(Math.sin(x) * 0.99));
    mix(Math.tanh(x * 0.3));
    mix(Math.cbrt(x));
  }
  return (h >>> 0).toString(16);
}

/** Room codes avoid letters and digits that are easy to confuse. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function makeRoomCode(random: () => number = Math.random): string {
  let code = '';
  for (let k = 0; k < 6; k++) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return code;
}

/** Normalises what a player typed: upper case, no spaces or dashes; null if it cannot be a code. */
export function parseRoomCode(text: string): string | null {
  const code = text.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== 6) return null;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return null;
  return code;
}

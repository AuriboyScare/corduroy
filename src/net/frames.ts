import type { Command, CommandResult } from '../sim/commands';
import type { SnowcatInput } from '../sim/vehicles/snowcat';
import type { World } from '../sim/world';
import { HOST_PLAYER, unpackInput, type Frame, type PlayerInfo } from './protocol';

/** Called for every command a frame applies, with its result, on every copy of the world. */
export type CommandListener = (player: string, command: Command, result: CommandResult) => void;

/**
 * Who is in the game and which machine each drives. It is part of the shared state: it changes
 * only through frame events, so every copy agrees on it.
 */
export class Seats {
  readonly players = new Map<string, PlayerInfo>();

  constructor(hostName: string, hostSeat: number | null) {
    this.players.set(HOST_PLAYER, { id: HOST_PLAYER, name: hostName, seat: hostSeat });
  }

  list(): PlayerInfo[] {
    return [...this.players.values()].map((p) => ({ ...p }));
  }

  static from(players: readonly PlayerInfo[]): Seats {
    const seats = new Seats('', null);
    seats.players.clear();
    for (const p of players) seats.players.set(p.id, { ...p });
    return seats;
  }

  seatOf(player: string): number | null {
    return this.players.get(player)?.seat ?? null;
  }

  /** The player driving a machine, if any. */
  driverOf(uid: number): string | null {
    for (const p of this.players.values()) if (p.seat === uid) return p.id;
    return null;
  }

  /** A machine nobody drives, preferring one parked at the garage; null if every machine is taken. */
  freeMachine(world: World): number | null {
    const free = world.machines.filter((m) => this.driverOf(m.owned.uid) === null);
    return (free.find((m) => world.atGarage(m)) ?? free[0])?.owned.uid ?? null;
  }
}

/**
 * Applies one frame to a world: its events in order, then one fixed step with every listed
 * machine driven by its input. Host and clients both use exactly this, which is what keeps their
 * worlds identical.
 */
export function applyFrame(
  world: World,
  seats: Seats,
  frame: Frame,
  inputs: Map<number, SnowcatInput>,
  onCommand?: CommandListener,
): void {
  for (const event of frame.events ?? []) {
    if ('command' in event) {
      const result = applyCommand(world, seats, event.player, event.command);
      onCommand?.(event.player, event.command, result);
    } else if (event.left) {
      seats.players.delete(event.player);
    } else {
      const existing = seats.players.get(event.player);
      seats.players.set(event.player, {
        id: event.player,
        name: event.name ?? existing?.name ?? 'Player',
        seat: event.seat,
      });
    }
  }
  inputs.clear();
  for (const [uid, packed] of frame.inputs) inputs.set(uid, unpackInput(packed));
  world.stepInputs(inputs);
}

/** A command from a player. Changing machines moves that player's seat, not the shared world. */
function applyCommand(world: World, seats: Seats, player: string, command: Command): CommandResult {
  if (command.type !== 'switchMachine') return world.apply(command);
  const target = world.machines.find((m) => m.owned.uid === command.machine);
  if (!target) return { ok: false, reason: 'Unknown machine.' };
  const current = seats.seatOf(player);
  if (current === command.machine) return { ok: true };
  const driver = seats.driverOf(command.machine);
  if (driver !== null) return { ok: false, reason: 'Someone else is driving that machine.' };
  const own = world.machines.find((m) => m.owned.uid === current);
  if (own && !world.atGarage(own))
    return { ok: false, reason: 'Park your current machine at the garage first.' };
  if (!world.atGarage(target)) return { ok: false, reason: 'That machine is out on the mountain.' };
  const info = seats.players.get(player);
  if (info) info.seat = command.machine;
  return { ok: true };
}

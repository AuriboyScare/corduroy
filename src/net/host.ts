import type { Command } from '../sim/commands';
import { captureWorld, type WorldSnapshot } from '../sim/save/worldSave';
import { worldHash } from '../sim/stateHash';
import type { SnowcatInput } from '../sim/vehicles/snowcat';
import type { World } from '../sim/world';
import { applyFrame, Seats, type CommandListener } from './frames';
import {
  HASH_INTERVAL,
  HOST_PLAYER,
  IDLE_INPUT,
  MAX_PLAYERS,
  packInput,
  PROTOCOL_VERSION,
  type Frame,
  type FrameEvent,
  type PackedInput,
  type PlayerInfo,
  type ToClient,
  type ToHost,
} from './protocol';
import type { Transport } from './transport';

/** Frames kept for players catching up, in steps (20 s). */
const HISTORY = 1200;
/** A player whose input is older than this, in steps, has their machine idle. */
const STALE_INPUT = 120;

interface Remote {
  id: string;
  name: string;
  input: PackedInput;
  /** Step at which their input last arrived. */
  inputAt: number;
  /** 'waiting' to be seated, 'sending' their snapshot, or 'live' following frames. */
  state: 'waiting' | 'sending' | 'live';
  /** Next frame (by step number) to send them. */
  next: number;
}

export interface HostOptions {
  world: World;
  transport: Transport;
  hostName: string;
  /** This engine's maths fingerprint; joining players must match it. */
  math: string;
  /** Turns a world snapshot into the bytes a joining player loads. */
  encode: (snapshot: WorldSnapshot, players: readonly PlayerInfo[]) => Promise<Uint8Array>;
}

/**
 * Runs a game for other players: steps the world from everyone's inputs and streams the frames.
 * It never waits for a player: late input is held, and a slow player catches up from history.
 */
export class HostSession {
  readonly seats: Seats;
  onCommand: CommandListener | null = null;
  /** Called when players join, leave or change machine. */
  onPlayers: ((players: PlayerInfo[]) => void) | null = null;
  private readonly world: World;
  private readonly transport: Transport;
  private readonly remotes = new Map<string, Remote>();
  private readonly pending: FrameEvent[] = [];
  private readonly history: Frame[] = [];
  /** Step number of history[0]. */
  private historyStart: number;
  private readonly hashes: { tick: number; hash: number }[] = [];
  private readonly inputs = new Map<number, SnowcatInput>();
  private closed = false;

  constructor(private readonly options: HostOptions) {
    this.world = options.world;
    this.transport = options.transport;
    this.seats = new Seats(options.hostName, options.world.activeMachine.owned.uid);
    this.historyStart = this.world.stepCount + 1;
    this.transport.onMessage = (data, from) => this.receive(data as ToHost, from);
    this.transport.onPeerLeave = (peer) => this.drop(peer);
  }

  get players(): PlayerInfo[] {
    return this.seats.list();
  }

  /** A command from the host's own interface, applied at the next step. */
  submit(command: Command): void {
    this.pending.push({ player: HOST_PLAYER, command });
  }

  private receive(message: ToHost, from: string): void {
    if (this.closed) return;
    if (message.type === 'hello') {
      if (this.remotes.has(from)) return;
      const refuse = (reason: string): void =>
        this.transport.send({ type: 'refuse', reason } satisfies ToClient, from);
      if (message.version !== PROTOCOL_VERSION)
        return refuse(
          'That game is running a different version of Corduroy. Both players need the latest version.',
        );
      if (message.math !== this.options.math)
        return refuse(
          "Your browser calculates the physics slightly differently from the host's, so your games would drift apart. Use the same browser as the host (Chrome or Edge), or the desktop app.",
        );
      if (this.seats.players.size + this.remotes.size >= MAX_PLAYERS) return refuse('That game is full.');
      const name = message.name.trim().slice(0, 24) || 'Player';
      this.remotes.set(from, {
        id: from,
        name,
        input: IDLE_INPUT,
        inputAt: this.world.stepCount,
        state: 'waiting',
        next: 0,
      });
      return;
    }
    const remote = this.remotes.get(from);
    if (!remote || remote.state === 'waiting') return;
    if (message.type === 'input') {
      remote.input = message.input;
      remote.inputAt = this.world.stepCount;
    } else if (message.type === 'command') {
      this.pending.push({ player: from, command: message.command });
    }
  }

  private drop(peer: string): void {
    const remote = this.remotes.get(peer);
    if (!remote) return;
    this.remotes.delete(peer);
    if (this.seats.players.has(peer)) this.pending.push({ player: peer, seat: null, left: true });
  }

  /** One fixed step of the shared world, with the host's own input. Replaces `world.step`. */
  step(local: SnowcatInput): void {
    const world = this.world;
    const frame: Frame = { inputs: [] };
    // Seat at most one waiting player per step, in the first free machine (or none).
    const joiner = [...this.remotes.values()].find((r) => r.state === 'waiting');
    if (joiner)
      this.pending.push({ player: joiner.id, seat: this.seats.freeMachine(world), name: joiner.name });
    if (this.pending.length > 0) frame.events = this.pending.splice(0);
    for (const p of this.seats.players.values()) {
      if (p.seat === null) continue;
      if (p.id === HOST_PLAYER) frame.inputs.push([p.seat, packInput(local)]);
      else {
        const remote = this.remotes.get(p.id);
        const fresh = remote && world.stepCount - remote.inputAt < STALE_INPUT;
        frame.inputs.push([p.seat, fresh ? remote.input : IDLE_INPUT]);
      }
    }
    applyFrame(world, this.seats, frame, this.inputs, this.onCommand ?? undefined);
    this.history.push(frame);
    if (this.history.length > HISTORY) {
      this.history.shift();
      this.historyStart++;
    }
    if (frame.events?.some((e) => !('command' in e) || e.command.type === 'switchMachine'))
      this.onPlayers?.(this.seats.list());
    if (world.stepCount % HASH_INTERVAL === 0)
      this.hashes.push({ tick: world.stepCount, hash: worldHash(world) });
    if (joiner) this.sendSnapshot(joiner);
  }

  /** Sends a joining player the world as it is now; frames follow from the next step. */
  private sendSnapshot(remote: Remote): void {
    remote.state = 'sending';
    const tick = this.world.stepCount;
    const players = this.seats.list();
    const snapshot = captureWorld(this.world);
    void this.options.encode(snapshot, players).then(
      (bytes) => {
        if (this.closed || this.remotes.get(remote.id) !== remote) return;
        this.transport.send(
          { type: 'welcome', player: remote.id, tick, players } satisfies ToClient,
          remote.id,
        );
        this.transport.sendBytes(bytes, remote.id);
        remote.next = tick + 1;
        remote.state = 'live';
      },
      (error: unknown) => {
        console.error('Could not send the world to a joining player', error);
        this.transport.send(
          { type: 'refuse', reason: 'The host could not send the world.' } satisfies ToClient,
          remote.id,
        );
      },
    );
  }

  /** Sends new frames and fingerprints to every player; call once per rendered frame. */
  flush(): void {
    if (this.closed) return;
    const latest = this.world.stepCount;
    for (const remote of this.remotes.values()) {
      if (remote.state !== 'live' || remote.next > latest) continue;
      if (remote.next < this.historyStart) {
        // Too far behind to catch up from history: start them again from a fresh snapshot.
        this.sendSnapshot(remote);
        continue;
      }
      const frames = this.history.slice(remote.next - this.historyStart, latest - this.historyStart + 1);
      this.transport.send({ type: 'frames', first: remote.next, frames } satisfies ToClient, remote.id);
      remote.next = latest + 1;
    }
    for (const h of this.hashes.splice(0))
      for (const remote of this.remotes.values())
        if (remote.state === 'live')
          this.transport.send({ type: 'hash', ...h } satisfies ToClient, remote.id);
  }

  close(): void {
    this.closed = true;
    this.transport.leave();
  }
}

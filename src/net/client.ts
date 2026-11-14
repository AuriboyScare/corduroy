import type { Command } from '../sim/commands';
import { worldHash } from '../sim/stateHash';
import type { SnowcatInput } from '../sim/vehicles/snowcat';
import type { World } from '../sim/world';
import { applyFrame, Seats, type CommandListener } from './frames';
import {
  HASH_INTERVAL,
  packInput,
  PROTOCOL_VERSION,
  type Frame,
  type PackedInput,
  type PlayerInfo,
  type ToClient,
  type ToHost,
} from './protocol';
import type { Transport } from './transport';

/** Frames kept in hand to ride out network jitter, and the backlog that triggers catching up. */
const TARGET_BUFFER = 3;
const CATCH_UP_ABOVE = 8;
/** Input is re-sent at least this often even when it has not changed, ms. */
const INPUT_HEARTBEAT_MS = 100;

export interface ClientOptions {
  transport: Transport;
  name: string;
  math: string;
  /** Turns the host's snapshot bytes into a world. */
  decode: (bytes: Uint8Array) => Promise<World>;
  /** Wall-clock milliseconds (tests pass a fake clock). */
  now?: () => number;
}

export class JoinError extends Error {}

/** Plays in someone else's game: follows the host's frames and sends this player's input. */
export class ClientSession {
  world: World | null = null;
  seats: Seats | null = null;
  /** This player's id in the game. */
  player: string | null = null;
  onCommand: CommandListener | null = null;
  onPlayers: ((players: PlayerInfo[]) => void) | null = null;
  /** The game ended for this player (host left, or refused). */
  onClosed: ((reason: string) => void) | null = null;
  /** This copy of the world no longer matches the host's. */
  onDesync: ((tick: number) => void) | null = null;
  private readonly transport: Transport;
  private host: string | null = null;
  private welcome: { tick: number; players: PlayerInfo[] } | null = null;
  private snapshot: Uint8Array | null = null;
  /** Frame batches that arrived before the world was ready. */
  private early: { first: number; frames: Frame[] }[] = [];
  private readonly queue: Frame[] = [];
  /** Step number the first queued frame produces. */
  private queueFirst = 0;
  private readonly ownHashes = new Map<number, number>();
  private readonly hostHashes = new Map<number, number>();
  private readonly inputs = new Map<number, SnowcatInput>();
  private accumulator = 0;
  private lastSent: PackedInput | null = null;
  private lastSentAt = -Infinity;
  private closed = false;
  private readonly now: () => number;

  constructor(private readonly options: ClientOptions) {
    this.transport = options.transport;
    this.now = options.now ?? (() => performance.now());
  }

  /** Finds the host, receives the world and gets ready to play; rejects with a reason to show. */
  join(timeoutMs = 25_000): Promise<World> {
    return new Promise((resolve, reject) => {
      const hello: ToHost = {
        type: 'hello',
        name: this.options.name,
        version: PROTOCOL_VERSION,
        math: this.options.math,
      };
      const timer = setTimeout(() => {
        fail(
          'No game answered with that code. Check the code, and that the host has opened their game to friends and is still online.',
        );
      }, timeoutMs);
      const fail = (reason: string): void => {
        clearTimeout(timer);
        this.close();
        reject(new JoinError(reason));
      };
      this.transport.onPeerJoin = (peer) => {
        if (this.host === null) this.transport.send(hello, peer);
      };
      this.transport.onPeerLeave = (peer) => {
        if (peer !== this.host) return;
        if (this.world) this.end('The host has left the game.');
        else fail('The host left before the game could start.');
      };
      this.transport.onMessage = (data, from) => {
        const message = data as ToClient;
        if (this.host !== null && from !== this.host) return;
        switch (message.type) {
          case 'refuse':
            fail(message.reason);
            return;
          case 'welcome':
            this.host = from;
            this.player = message.player;
            this.welcome = { tick: message.tick, players: message.players };
            break;
          case 'frames':
            this.receiveFrames(message.first, message.frames);
            return;
          case 'hash':
            this.hostHashes.set(message.tick, message.hash);
            this.checkHash(message.tick);
            return;
          case 'players':
            return;
        }
        void this.ready().then(
          (world) => {
            if (world) {
              clearTimeout(timer);
              resolve(world);
            }
          },
          (error: unknown) => fail(error instanceof Error ? error.message : String(error)),
        );
      };
      this.transport.onBytes = (bytes, from) => {
        if (this.host !== null && from !== this.host) return;
        this.snapshot = bytes;
        void this.ready().then(
          (world) => {
            if (world) {
              clearTimeout(timer);
              resolve(world);
            }
          },
          (error: unknown) => fail(error instanceof Error ? error.message : String(error)),
        );
      };
    });
  }

  /** Loads the world once both the welcome and the snapshot are here. */
  private async ready(): Promise<World | null> {
    if (!this.welcome || !this.snapshot || this.world) return null;
    const bytes = this.snapshot;
    this.snapshot = null;
    const world = await this.options.decode(bytes);
    if (world.stepCount !== this.welcome.tick) throw new Error('The world the host sent was out of step.');
    this.seats = Seats.from(this.welcome.players);
    this.queueFirst = this.welcome.tick + 1;
    this.world = world;
    for (const batch of this.early.splice(0)) this.receiveFrames(batch.first, batch.frames);
    this.onPlayers?.(this.seats.list());
    return world;
  }

  private receiveFrames(first: number, frames: Frame[]): void {
    if (!this.world) {
      this.early.push({ first, frames });
      return;
    }
    const expected = this.queueFirst + this.queue.length;
    // Drop frames already applied (from before the snapshot); a gap means frames were lost.
    const skip = expected - first;
    if (skip < 0) {
      this.onDesync?.(expected);
      return;
    }
    for (let k = skip; k < frames.length; k++) this.queue.push(frames[k]!);
  }

  private checkHash(tick: number): void {
    const own = this.ownHashes.get(tick);
    const host = this.hostHashes.get(tick);
    if (own === undefined || host === undefined) return;
    this.ownHashes.delete(tick);
    this.hostHashes.delete(tick);
    if (own !== host) this.onDesync?.(tick);
  }

  /** The machine this player drives, or null when watching. */
  get seat(): number | null {
    return this.player && this.seats ? this.seats.seatOf(this.player) : null;
  }

  /** Frames waiting to be applied. */
  get buffered(): number {
    return this.queue.length;
  }

  /**
   * Applies the frames due after `dt` seconds of play, keeping a small buffer against jitter and
   * catching up quickly when far behind. Returns the number of steps taken.
   */
  advance(dt: number): number {
    const world = this.world;
    const seats = this.seats;
    if (!world || !seats || this.closed) return 0;
    this.accumulator += dt;
    let steps = Math.floor(this.accumulator / world.stepSeconds);
    this.accumulator -= steps * world.stepSeconds;
    if (this.queue.length > CATCH_UP_ABOVE) steps += Math.min(this.queue.length - TARGET_BUFFER, 40);
    steps = Math.min(steps, this.queue.length);
    if (this.queue.length === 0) this.accumulator = Math.min(this.accumulator, world.stepSeconds * 2);
    let seatsChanged = false;
    for (let s = 0; s < steps; s++) {
      const frame = this.queue.shift()!;
      this.queueFirst++;
      if (frame.events) seatsChanged = true;
      applyFrame(world, seats, frame, this.inputs, this.onCommand ?? undefined);
      if (world.stepCount % HASH_INTERVAL === 0) {
        this.ownHashes.set(world.stepCount, worldHash(world));
        this.checkHash(world.stepCount);
        for (const tick of this.ownHashes.keys())
          if (tick < world.stepCount - 20 * HASH_INTERVAL) this.ownHashes.delete(tick);
      }
    }
    if (seatsChanged) this.onPlayers?.(seats.list());
    return steps;
  }

  /** Sends this player's controls to the host when they change, and as a heartbeat. */
  sendInput(input: SnowcatInput): void {
    if (!this.host || this.closed) return;
    const packed = packInput(input);
    const now = this.now();
    const same = this.lastSent !== null && packed.every((v, k) => v === this.lastSent![k]);
    if (same && now - this.lastSentAt < INPUT_HEARTBEAT_MS) return;
    this.lastSent = packed;
    this.lastSentAt = now;
    this.transport.send({ type: 'input', input: packed } satisfies ToHost, this.host);
  }

  /** A command from this player's interface; it takes effect when the host's frame applies it. */
  submit(command: Command): void {
    if (!this.host || this.closed) return;
    this.transport.send({ type: 'command', command } satisfies ToHost, this.host);
  }

  private end(reason: string): void {
    if (this.closed) return;
    this.close();
    this.onClosed?.(reason);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.transport.leave();
  }
}

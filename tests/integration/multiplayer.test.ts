import { beforeAll, describe, expect, it } from 'vitest';
import { ClientSession, JoinError } from '../../src/net/client';
import { HostSession } from '../../src/net/host';
import {
  HASH_INTERVAL,
  makeRoomCode,
  mathSignature,
  packInput,
  parseRoomCode,
  unpackInput,
} from '../../src/net/protocol';
import { LoopbackHub } from '../../src/net/transport';
import { decodeSave, encodeSave } from '../../src/platform/saveFile';
import { captureWorld, restoreWorld, type WorldSnapshot } from '../../src/sim/save/worldSave';
import { Snowpack } from '../../src/sim/snow/snowpack';
import { worldHash } from '../../src/sim/stateHash';
import { generateMountain } from '../../src/sim/terrain/mountain';
import type { SnowcatInput } from '../../src/sim/vehicles/snowcat';
import { World } from '../../src/sim/world';

const STEP_MS = 1000 / 60;
const math = mathSignature();

const encode = (snapshot: WorldSnapshot) =>
  encodeSave(snapshot, { savedAt: '', mode: snapshot.meta.mode, money: null, machines: 0, playSeconds: 0 });
const decode = async (bytes: Uint8Array) => restoreWorld((await decodeSave(bytes)).snapshot);
const yieldToAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

let template: WorldSnapshot;

beforeAll(() => {
  const mountain = generateMountain(11);
  const snow = new Snowpack(mountain);
  snow.fillNatural(11);
  template = captureWorld(new World(mountain, snow, { mode: 'sandbox' }));
}, 90_000);

/** A host and a client over a simulated network, stepped one rendered frame at a time. */
class Game {
  readonly hub = new LoopbackHub(40);
  readonly host: HostSession;
  readonly hostWorld = restoreWorld(template);
  client: ClientSession | null = null;
  hostInput: SnowcatInput = { throttle: 0, steer: 0, bladeLift: 0, tillerDown: false };
  clientInput: SnowcatInput = { throttle: 0, steer: 0, bladeLift: 0, tillerDown: false };

  constructor() {
    this.host = new HostSession({
      world: this.hostWorld,
      transport: this.hub.connect('host-peer'),
      hostName: 'Ana',
      math,
      encode,
    });
  }

  join(name = 'Ben', clientMath = math): Promise<World> {
    this.client = new ClientSession({ transport: this.hub.connect('client-peer'), name, math: clientMath, decode });
    return this.client.join(10_000);
  }

  /** One rendered frame: the host steps and sends, the network moves on, the client follows. */
  async frame(hostSteps = 1): Promise<void> {
    for (let k = 0; k < hostSteps; k++) this.host.step(this.hostInput);
    this.host.flush();
    this.client?.sendInput(this.clientInput);
    this.hub.advance(STEP_MS);
    this.client?.advance(STEP_MS / 1000);
    await yieldToAsync();
  }

  async until(done: () => boolean, maxFrames = 2000, hostSteps = 1): Promise<void> {
    for (let k = 0; k < maxFrames && !done(); k++) await this.frame(hostSteps);
    expect(done()).toBe(true);
  }
}

describe('multiplayer', () => {
  it('quantises inputs so every copy steps with the same values', () => {
    const input: SnowcatInput = { throttle: 0.3333, steer: -1, bladeLift: 0.5, tillerDown: true, winchAdjust: 0.25 };
    const once = unpackInput(packInput(input));
    expect(unpackInput(packInput(once))).toEqual(once);
    expect(once.steer).toBe(-1);
    expect(once.tillerDown).toBe(true);
    expect(once.throttle).toBeCloseTo(0.3333, 2);
  });

  it('makes room codes people can read out, and accepts them typed loosely', () => {
    const code = makeRoomCode();
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    expect(parseRoomCode(` ${code.slice(0, 3).toLowerCase()}-${code.slice(3)} `)).toBe(code);
    expect(parseRoomCode('ABC')).toBeNull();
    expect(parseRoomCode('ABCDE0')).toBeNull();
  });

  it('a joining player gets the world as it is, drives their own machine, and stays in step', async () => {
    const game = new Game();
    game.hostInput = { throttle: 0.8, steer: 0.1, bladeLift: 0, tillerDown: true };
    for (let k = 0; k < 90; k++) await game.frame();

    const joined = game.join();
    let world: World | null = null;
    void joined.then((w) => (world = w));
    await game.until(() => world !== null);
    const client = game.client!;
    expect(client.seat).not.toBeNull();
    expect(client.seat).not.toBe(game.host.seats.seatOf('host'));
    expect(game.host.players.map((p) => p.name)).toEqual(['Ana', 'Ben']);

    const theirs = game.hostWorld.machines.find((m) => m.owned.uid === client.seat)!;
    const start = { x: theirs.vehicle.body.px, z: theirs.vehicle.body.pz };
    game.clientInput = { throttle: -0.6, steer: 0.4, bladeLift: 1, tillerDown: false };
    for (let k = 0; k < 6 * HASH_INTERVAL; k++) await game.frame();

    // The client's input moved its machine in the host's world.
    expect(Math.hypot(theirs.vehicle.body.px - start.x, theirs.vehicle.body.pz - start.z)).toBeGreaterThan(5);

    // Stop the host and let the client catch up: both copies must be identical.
    await game.until(() => client.world!.stepCount === game.hostWorld.stepCount, 400, 0);
    expect(worldHash(client.world!)).toBe(worldHash(game.hostWorld));
    expect(client.world!.snow.totalMassKg()).toBeCloseTo(game.hostWorld.snow.totalMassKg(), 6);
  }, 60_000);

  it('applies a player’s commands on every copy, and checks the copies match', async () => {
    const game = new Game();
    let world: World | null = null;
    void game.join().then((w) => (world = w));
    await game.until(() => world !== null);
    const client = game.client!;
    let desynced = false;
    client.onDesync = () => (desynced = true);
    const results: string[] = [];
    client.onCommand = (player, command, result) => results.push(`${player}:${command.type}:${result.ok}`);

    client.submit({ type: 'liftControl', lift: 'meadow-quad', action: 'stop' });
    await game.until(() => client.world!.liftById('meadow-quad')!.state === 'stopped', 200);
    expect(game.hostWorld.liftById('meadow-quad')!.state).toBe('stopped');
    expect(results).toEqual([`client-peer:liftControl:true`]);

    for (let k = 0; k < 3 * HASH_INTERVAL; k++) await game.frame();
    expect(desynced).toBe(false);
  }, 60_000);

  it('moves a player between machines only by the rules', async () => {
    const game = new Game();
    let world: World | null = null;
    void game.join().then((w) => (world = w));
    await game.until(() => world !== null);
    const client = game.client!;
    const hostSeat = game.host.seats.seatOf('host')!;
    const reasons: string[] = [];
    client.onCommand = (_p, _c, result) => {
      if (!result.ok) reasons.push(result.reason);
    };
    client.submit({ type: 'switchMachine', machine: hostSeat });
    for (let k = 0; k < 20; k++) await game.frame();
    expect(reasons).toEqual(['Someone else is driving that machine.']);
    expect(client.seat).not.toBe(hostSeat);
  }, 60_000);

  it('refuses a player whose browser would compute a different world, and says why', async () => {
    const game = new Game();
    const joined = game.join('Cy', 'deadbeef');
    let error: unknown = null;
    void joined.catch((e: unknown) => (error = e));
    await game.until(() => error !== null, 200);
    expect(error).toBeInstanceOf(JoinError);
    expect((error as Error).message).toContain('calculates the physics');
  });

  it('lets a player leave: their seat empties and the host carries on', async () => {
    const game = new Game();
    let world: World | null = null;
    void game.join().then((w) => (world = w));
    await game.until(() => world !== null);
    game.client!.close();
    await game.until(() => game.host.players.length === 1, 200);
    expect(game.host.players[0]!.id).toBe('host');
  }, 60_000);
});

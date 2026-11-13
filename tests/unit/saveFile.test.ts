import { beforeAll, describe, expect, it } from 'vitest';
import {
  decodeSave,
  decodeSections,
  encodeSave,
  encodeSections,
  readSummary,
  SaveFormatError,
} from '../../src/platform/saveFile';
import { captureWorld, restoreWorld } from '../../src/sim/save/worldSave';
import { Snowpack } from '../../src/sim/snow/snowpack';
import { generateMountain, runById } from '../../src/sim/terrain/mountain';
import { PathFollower } from '../../src/sim/vehicles/autopilot';
import type { SnowcatInput } from '../../src/sim/vehicles/snowcat';
import { World } from '../../src/sim/world';

describe('save container', () => {
  const sections = [
    { name: 'a', raw: new TextEncoder().encode('hello hello hello hello') },
    { name: 'b', raw: new Uint8Array(10_000).map((_, i) => i % 7) },
  ];

  it('round-trips sections', async () => {
    const decoded = await decodeSections(await encodeSections(sections));
    expect(new TextDecoder().decode(decoded.get('a'))).toBe('hello hello hello hello');
    expect(decoded.get('b')).toEqual(sections[1]!.raw);
  });

  it('rejects any single flipped byte, a cut-short file and a foreign file', async () => {
    const bytes = await encodeSections(sections);
    for (const at of [0, 9, 14, Math.floor(bytes.length / 2), bytes.length - 6, bytes.length - 1]) {
      const bad = bytes.slice();
      bad[at]! ^= 0x10;
      await expect(decodeSections(bad)).rejects.toBeInstanceOf(SaveFormatError);
    }
    await expect(decodeSections(bytes.slice(0, bytes.length - 20))).rejects.toBeInstanceOf(SaveFormatError);
    await expect(decodeSections(new TextEncoder().encode('{"not":"a save"}'))).rejects.toThrow(
      'not a Corduroy save',
    );
  });
});

describe('world save', () => {
  let world: World;
  const idle: SnowcatInput = { throttle: 0, steer: 0, bladeLift: 0, tillerDown: false };

  beforeAll(() => {
    const mountain = generateMountain(11);
    const snow = new Snowpack(mountain);
    snow.fillNatural(11);
    world = new World(mountain, snow, { mode: 'career' });
    world.career.money = 100_000;
    // Buy and upgrade, groom part of Kestrel, and push some snow with the blade.
    world.apply({ type: 'buyUpgrade', machine: world.activeMachine.owned.uid, upgrade: 'tiller' });
    world.apply({ type: 'buyMachine', model: 'kestrel-600w' });
    const pilot = new PathFollower(runById(mountain, 'kestrel').line, -1, 0.6);
    for (let i = 0; i < 60 * 90; i++) world.step(pilot.update(world.cat, true));
    for (let i = 0; i < 60 * 3; i++) world.step({ ...idle, throttle: 0.4, bladeLift: -1 });
  }, 120_000);

  it('restores the world exactly: snow, machines, money and bonuses', async () => {
    const bytes = await encodeSave(captureWorld(world), {
      savedAt: '2026-11-13T12:00:00.000Z',
      mode: 'career',
      money: world.career.money,
      machines: world.machines.length,
      playSeconds: 90,
    });
    // Only the tiles that were worked on are stored; the rest comes back from the seed.
    expect(bytes.byteLength).toBeLessThan(3_000_000);
    const { snapshot, summary } = await decodeSave(bytes);
    expect(summary.money).toBe(world.career.money);
    const restored = restoreWorld(snapshot);

    const a = world.snow;
    const b = restored.snow;
    for (const key of ['base', 'top', 'density', 'groomed', 'coarse'] as const) {
      expect(Buffer.from(b[key].buffer).equals(Buffer.from(a[key].buffer)), key).toBe(true);
    }
    expect(b.tiles.filter(Boolean).length).toBe(a.tiles.filter(Boolean).length);
    expect(b.groomedPisteCells).toBe(a.groomedPisteCells);
    expect(Array.from(b.groomedBySection)).toEqual(Array.from(a.groomedBySection));
    expect(restored.career.money).toBe(world.career.money);
    expect(restored.career.machines).toEqual(world.career.machines);
    expect(restored.activeIndex).toBe(world.activeIndex);
    expect(restored.cat.spec).toEqual(world.cat.spec);
    expect(restored.cat.body.px).toBe(world.cat.body.px);
    expect(restored.cat.bladeLoadKg).toBe(world.cat.bladeLoadKg);
    expect(Array.from(restored.sectionBonusPaid)).toEqual(Array.from(world.sectionBonusPaid));

    // Both worlds carry on identically.
    const input: SnowcatInput = { throttle: 0.5, steer: 0.3, bladeLift: 0, tillerDown: true };
    for (let i = 0; i < 300; i++) {
      world.step(input);
      restored.step(input);
    }
    expect(restored.cat.body.pz).toBe(world.cat.body.pz);
    expect(restored.career.money).toBe(world.career.money);
    expect(Buffer.from(restored.snow.top.buffer).equals(Buffer.from(world.snow.top.buffer))).toBe(true);
  }, 120_000);

  it('keeps the uid counter so a sold-and-rebought fleet never reuses ids', async () => {
    const restored = restoreWorld(captureWorld(world));
    restored.career.money = 1e6;
    restored.apply({ type: 'buyMachine', model: 'kestrel-420' });
    const uids = restored.machines.map((m) => m.owned.uid);
    expect(new Set(uids).size).toBe(uids.length);
  }, 60_000);

  it('saves a sandbox with unlimited money and a hooked winch', async () => {
    const mountain = generateMountain(11);
    const snow = new Snowpack(mountain);
    snow.fillNatural(11);
    const sandbox = new World(mountain, snow, { mode: 'sandbox' });
    const big = sandbox.machines.find((m) => m.owned.model === 'kestrel-600w')!;
    big.vehicle.place(1372, 1200, Math.PI, snow);
    expect(sandbox.apply({ type: 'winch', machine: big.owned.uid, hook: true })).toEqual({ ok: true });
    const restored = restoreWorld(
      (
        await decodeSave(
          await encodeSave(captureWorld(sandbox), {
            savedAt: '',
            mode: 'sandbox',
            money: null,
            machines: 3,
            playSeconds: 0,
          }),
        )
      ).snapshot,
    );
    expect(restored.career.money).toBe(Infinity);
    const again = restored.machines.find((m) => m.owned.uid === big.owned.uid)!;
    expect(restored.winchAnchorName(again)).toBe('Falcon Face mid');
    expect(again.vehicle.winchAnchor).not.toBeNull();
    const summary = await readSummary(
      await encodeSave(captureWorld(sandbox), {
        savedAt: 'x',
        mode: 'sandbox',
        money: null,
        machines: 3,
        playSeconds: 5,
      }),
    );
    expect(summary).toEqual({ savedAt: 'x', mode: 'sandbox', money: null, machines: 3, playSeconds: 5 });
  }, 60_000);
});

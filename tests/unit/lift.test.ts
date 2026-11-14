import { beforeAll, describe, expect, it } from 'vitest';
import { Lift, type CarrierPose } from '../../src/sim/lifts/lift';
import { Snowpack } from '../../src/sim/snow/snowpack';
import { generateMountain } from '../../src/sim/terrain/mountain';

let snow: Snowpack;
let lifts: Lift[];
const pose = (): CarrierPose => ({ x: 0, y: 0, z: 0, heading: 0, up: true, swing: 0, trip: 0 });
const byKind = (kind: string) => lifts.find((l) => l.line.kind === kind)!;

beforeAll(() => {
  const mountain = generateMountain(11);
  snow = new Snowpack(mountain);
  snow.fillNatural(11);
  lifts = mountain.lifts.map((line) => new Lift(line, snow));
}, 60_000);

const run = (lift: Lift, seconds: number) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) lift.step(1 / 60);
};

describe('lift lines', () => {
  it('places towers so hanging carriers always clear the snow', () => {
    for (const lift of lifts) {
      // Towers are placed from samples every 2 m, so allow half a metre between samples.
      expect(lift.minClearance(snow), lift.line.id).toBeGreaterThan(lift.type.clearanceM - 0.5);
      for (const tower of lift.towers.slice(1, -1)) {
        expect(tower.topY - tower.groundY, lift.line.id).toBeGreaterThanOrEqual(
          lift.type.minTowerHeightM - 1e-6,
        );
        expect(tower.topY - tower.groundY, lift.line.id).toBeLessThan(lift.line.kind === 'tram' ? 120 : 40);
      }
    }
  });

  it('spaces towers by lift type: many short ones for the tow, few tall ones for the tram', () => {
    expect(byKind('ropeTow').towers.length).toBeGreaterThan(5);
    const tram = byKind('tram');
    expect(tram.towers.length - 2).toBeLessThanOrEqual(3);
    expect(byKind('gondola').towers.length - 2).toBeGreaterThan(5);
  });

  it('sags between supports, lowest near mid-span', () => {
    const lift = byKind('chair');
    const [a, b] = [lift.towers[1]!, lift.towers[2]!];
    const mid = (a.s + b.s) / 2;
    expect(lift.ropeY(mid)).toBeLessThan((a.topY + b.topY) / 2);
    expect(lift.ropeY(a.s)).toBeCloseTo(a.topY, 6);
  });
});

describe('lift drive', () => {
  it('ramps up to line speed, stops gently, and stops harder on an emergency stop', () => {
    const lift = new Lift(byKind('chair').line, snow);
    lift.start();
    run(lift, 2);
    expect(lift.speedMs).toBeCloseTo(0.8, 1);
    run(lift, 10);
    expect(lift.speedMs).toBeCloseTo(lift.type.lineSpeedMs, 5);
    lift.stop();
    run(lift, 1);
    const gentle = lift.type.lineSpeedMs - lift.speedMs;
    lift.start();
    run(lift, 10);
    lift.emergencyStop();
    run(lift, 1);
    expect(lift.type.lineSpeedMs - lift.speedMs).toBeGreaterThan(gentle * 2);
    run(lift, 5);
    expect(lift.state).toBe('stopped');
    expect(lift.speedMs).toBe(0);
  });

  it('swings the chairs forward when it stops hard, then settles', () => {
    const lift = new Lift(byKind('chair').line, snow);
    lift.start();
    run(lift, 15);
    lift.emergencyStop();
    let biggest = 0;
    for (let i = 0; i < 180; i++) {
      lift.step(1 / 60);
      biggest = Math.max(biggest, lift.swing);
    }
    expect(biggest).toBeGreaterThan(0.08);
    run(lift, 30);
    expect(Math.abs(lift.swing)).toBeLessThan(0.01);
  });
});

describe('carriers', () => {
  it('fixed-grip chairs keep their spacing all the way round', () => {
    const lift = byKind('chair');
    const a = pose();
    const b = pose();
    lift.carrierPose(3, a);
    lift.carrierPose(4, b);
    const spacing = lift.loopU / lift.carrierCount;
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeCloseTo(spacing, 0);
    expect(spacing).toBeCloseTo(lift.type.carrierSpacingM, 0);
  });

  it('detachable gondola cabins slow down and bunch up in the stations', () => {
    const lift = new Lift(byKind('gondola').line, snow);
    const inStation: number[] = [];
    const p = pose();
    for (let i = 0; i < lift.carrierCount; i++) {
      lift.carrierPose(i, p);
      const s = (p.x - lift.line.bottom.x) * lift.dirX + (p.z - lift.line.bottom.z) * lift.dirZ;
      if (s < lift.type.stationLengthM || s > lift.lengthM - lift.type.stationLengthM) inStation.push(i);
    }
    // Stations are a small share of the line but hold a good share of the cabins.
    const stationShare = (4 * lift.type.stationLengthM) / (2 * lift.lengthM);
    expect(inStation.length / lift.carrierCount).toBeGreaterThan(stationShare * 4);
  });

  it('moves every carrier smoothly, with no jumps at the bullwheels', () => {
    for (const kind of ['ropeTow', 'chair', 'gondola']) {
      const lift = new Lift(byKind(kind).line, snow);
      lift.start();
      const p = pose();
      const q = pose();
      for (let step = 0; step < 4000; step++) {
        lift.carrierPose(0, p);
        lift.travelM += 0.5;
        lift.carrierPose(0, q);
        const moved = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
        expect(moved, `${kind} at step ${step}`).toBeLessThan(
          0.5 / (lift.type.stationSpeedMs / lift.type.lineSpeedMs) + 0.6,
        );
      }
    }
  });

  it('shuttles tram cabins between the stations, passing mid-line, and waits at each end', () => {
    const lift = new Lift(byKind('tram').line, snow);
    lift.start();
    const a = pose();
    const b = pose();
    let fastest = 0;
    let dwelled = false;
    let reachedTop = false;
    for (let i = 0; i < 60 * 600; i++) {
      lift.step(1 / 60);
      fastest = Math.max(fastest, lift.speedMs);
      if (lift.tramDwell > 0) dwelled = true;
      if (lift.tramT > 0.999) reachedTop = true;
      if (Math.abs(lift.tramT - 0.5) < 0.001) {
        lift.carrierPose(0, a);
        lift.carrierPose(1, b);
        // At mid-line the cabins pass each other a gauge apart.
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeCloseTo(lift.type.gaugeM, 0);
      }
    }
    expect(reachedTop).toBe(true);
    expect(dwelled).toBe(true);
    expect(fastest).toBeLessThanOrEqual(lift.type.lineSpeedMs + 1e-6);
    expect(fastest).toBeGreaterThan(lift.type.lineSpeedMs * 0.95);
  });

  it('carries a sensible number of riders per hour', () => {
    expect(byKind('chair').capacityPerHour).toBeCloseTo(2208, -1);
    expect(byKind('gondola').capacityPerHour).toBeCloseTo(1920, -1);
    const tram = byKind('tram').capacityPerHour;
    expect(tram).toBeGreaterThan(800);
    expect(tram).toBeLessThan(2500);
  });
});

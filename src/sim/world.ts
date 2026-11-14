import {
  Career,
  CAREER_START_LIFTS,
  CAREER_START_MACHINE,
  LIFT_USE_GROOMED,
  LIFT_USE_UNGROOMED,
  TICKET_SHARE_PER_RIDE,
  GROOM_RATE,
  RUN_BONUS_SHARE,
  SECTION_BONUS_SHARE,
  SECTION_DONE,
  SECTION_REARM,
  type EarningEvent,
  type GameMode,
  type OwnedMachine,
} from './career';
import { fail, OK, type Command, type CommandResult } from './commands';
import { Lift } from './lifts/lift';
import { Snowmaking } from './snowmaking';
import { Weather } from './weather';
import { effectiveSpec, machineModel, MACHINE_MODELS, upgradePrice } from './machines/catalog';
import type { Snowpack } from './snow/snowpack';
import { TREE_STRIDE, type Mountain } from './terrain/mountain';
import { Snowcat, type ObstacleQuery, type SnowcatInput } from './vehicles/snowcat';

const BUCKET_M = 16;
/** Machines within this distance of the garage, and nearly stopped, can be serviced or swapped. */
export const GARAGE_RANGE_M = 45;
const PARKING_SPACING_M = 11;
/** Steps between payouts; grooming credit accumulates in between. */
const PAYOUT_INTERVAL_STEPS = 30;
/** Height of the ring on a winch anchor post above the ground, m. */
export const WINCH_POST_HEIGHT_M = 1.6;

/** Tree trunks bucketed on a coarse grid for collision queries. */
class TreeIndex implements ObstacleQuery {
  private readonly side: number;
  private readonly start: Int32Array;
  private readonly items: Int32Array;

  constructor(private readonly mountain: Mountain) {
    this.side = Math.ceil(mountain.grid.sizeM / BUCKET_M);
    const counts = new Int32Array(this.side * this.side + 1);
    const { trees, treeCount } = mountain;
    for (let t = 0; t < treeCount; t++)
      counts[this.bucket(trees[t * TREE_STRIDE]!, trees[t * TREE_STRIDE + 1]!) + 1]!++;
    for (let i = 1; i < counts.length; i++) counts[i]! += counts[i - 1]!;
    this.start = counts;
    this.items = new Int32Array(treeCount);
    const cursor = counts.slice(0, -1);
    for (let t = 0; t < treeCount; t++) {
      const bucket = this.bucket(trees[t * TREE_STRIDE]!, trees[t * TREE_STRIDE + 1]!);
      this.items[cursor[bucket]!++] = t;
    }
  }

  private bucket(x: number, z: number): number {
    const bx = Math.max(0, Math.min(this.side - 1, Math.floor(x / BUCKET_M)));
    const bz = Math.max(0, Math.min(this.side - 1, Math.floor(z / BUCKET_M)));
    return bx + bz * this.side;
  }

  forEachNear(
    x: number,
    z: number,
    radius: number,
    visit: (x: number, z: number, radius: number) => void,
  ): void {
    const trees = this.mountain.trees;
    const x0 = Math.max(0, Math.floor((x - radius) / BUCKET_M));
    const x1 = Math.min(this.side - 1, Math.floor((x + radius) / BUCKET_M));
    const z0 = Math.max(0, Math.floor((z - radius) / BUCKET_M));
    const z1 = Math.min(this.side - 1, Math.floor((z + radius) / BUCKET_M));
    for (let bz = z0; bz <= z1; bz++) {
      for (let bx = x0; bx <= x1; bx++) {
        const bucket = bx + bz * this.side;
        for (let k = this.start[bucket]!; k < this.start[bucket + 1]!; k++) {
          const o = this.items[k]! * TREE_STRIDE;
          visit(trees[o]!, trees[o + 1]!, trunkRadiusM(trees[o + 2]!));
        }
      }
    }
  }
}

/** Trunk radius at hull height for a tree of the given height. */
export function trunkRadiusM(heightM: number): number {
  return 0.16 + 0.013 * heightM;
}

/** A machine in the world: what the resort owns, and its simulated body. */
export interface Machine {
  readonly owned: OwnedMachine;
  readonly vehicle: Snowcat;
}

const IDLE: SnowcatInput = { throttle: 0, steer: 0, bladeLift: 0, tillerDown: false };

export interface WorldOptions {
  mode?: GameMode;
  /** Machine models the resort starts with; defaults to the career starter or the whole sandbox fleet. */
  fleet?: readonly string[];
  /** Model of the machine the player starts in. */
  drive?: string;
  /** Lift ids the resort starts with. */
  lifts?: readonly string[];
}

/** Everything that is simulated: the mountain, its snow, the machines and the resort's books. */
export class World {
  readonly mountain: Mountain;
  readonly snow: Snowpack;
  readonly career: Career;
  readonly machines: Machine[] = [];
  /** Every lift line on the mountain; only those in career.lifts are built and run. */
  readonly lifts: Lift[];
  /** Ticket money owed but below a dollar. */
  pendingTickets = 0;
  /** Spent on snowmaking water and power, lifetime. */
  snowmakingSpent = 0;
  readonly weather: Weather;
  readonly snowmaking: Snowmaking;
  /** Per run: share of its cells with enough cover to ski and groom well, refreshed every payout. */
  readonly runCover: Float64Array;
  /** Per run: the grid cells that belong to it. */
  private readonly runCells: Int32Array[];
  /** Index into machines of the one the player drives. */
  activeIndex = 0;
  /** Fixed step length, s. */
  readonly stepSeconds = 1 / 60;
  stepCount = 0;
  /** Earnings since the game last drained them, for on-screen notices. */
  readonly events: EarningEvent[] = [];
  /** Per section: the bonus has been paid and has not re-armed yet. */
  readonly sectionBonusPaid: Uint8Array;
  /** Per run: the bonus has been paid and has not re-armed yet. */
  readonly runBonusPaid: Uint8Array;
  private readonly trees: TreeIndex | null;
  private readonly credit: Float64Array;
  private readonly hookedAnchor = new Map<number, string>();
  /** Money owed but below a dollar, carried to the next payout. */
  pendingPay = 0;
  pendingLabel = '';

  constructor(mountain: Mountain, snow: Snowpack, options: WorldOptions = {}) {
    const mode = options.mode ?? 'career';
    this.mountain = mountain;
    this.snow = snow;
    this.trees = mountain.treeCount > 0 ? new TreeIndex(mountain) : null;
    this.career = new Career(mode);
    this.credit = new Float64Array(mountain.sections.length + 1);
    this.sectionBonusPaid = new Uint8Array(mountain.sections.length);
    this.runBonusPaid = new Uint8Array(mountain.runs.length);
    this.weather = new Weather(
      mountain.seed,
      snow.surfaceAt(mountain.depot.x, mountain.depot.z),
      mountain.datumAltitudeM,
    );
    this.snowmaking = new Snowmaking(mountain, snow);
    const counts = mountain.runs.map(() => 0);
    for (let i = 0; i < mountain.runOf.length; i++) if (mountain.runOf[i]) counts[mountain.runOf[i]! - 1]!++;
    this.runCells = counts.map((c) => new Int32Array(c));
    const fill = mountain.runs.map(() => 0);
    for (let i = 0; i < mountain.runOf.length; i++) {
      const r = mountain.runOf[i]!;
      if (r) this.runCells[r - 1]![fill[r - 1]!++] = i;
    }
    this.runCover = new Float64Array(mountain.runs.length);
    this.refreshCover();
    this.lifts = mountain.lifts.map((line) => new Lift(line, snow));
    for (const id of options.lifts ??
      (mode === 'sandbox' ? mountain.lifts.map((l) => l.id) : CAREER_START_LIFTS)) {
      if (this.lifts.some((l) => l.line.id === id)) this.career.lifts.add(id);
    }
    for (const lift of this.lifts) if (this.career.lifts.has(lift.line.id)) lift.start();
    const fleet =
      options.fleet ?? (mode === 'sandbox' ? MACHINE_MODELS.map((m) => m.id) : [CAREER_START_MACHINE]);
    for (const model of fleet) this.spawn(this.career.addMachine(model));
    const drive = options.drive ?? (mode === 'sandbox' ? 'kestrel-420' : fleet[0]);
    this.activeIndex = Math.max(
      0,
      this.machines.findIndex((m) => m.owned.model === drive),
    );
  }

  /** The machine the player is driving. */
  get cat(): Snowcat {
    return this.machines[this.activeIndex]!.vehicle;
  }

  get activeMachine(): Machine {
    return this.machines[this.activeIndex]!;
  }

  step(input: SnowcatInput): void {
    for (let k = 0; k < this.machines.length; k++) {
      this.machines[k]!.vehicle.step(
        this.stepSeconds,
        k === this.activeIndex ? input : IDLE,
        this.snow,
        this.trees,
      );
    }
    for (const lift of this.lifts) if (this.career.lifts.has(lift.line.id)) lift.step(this.stepSeconds);
    this.weather.advance(this.stepSeconds);
    this.snowmaking.step(this.stepSeconds, this.weather);
    this.stepCount++;
    if (this.stepCount % PAYOUT_INTERVAL_STEPS === 0) this.payOut();
  }

  /** True when a machine is parked at the garage and can be serviced or swapped. */
  atGarage(machine: Machine): boolean {
    const { body } = machine.vehicle;
    const { depot } = this.mountain;
    return (
      Math.hypot(body.px - depot.x, body.pz - depot.z) < GARAGE_RANGE_M &&
      Math.abs(machine.vehicle.forwardSpeed) < 0.5
    );
  }

  apply(command: Command): CommandResult {
    const career = this.career;
    switch (command.type) {
      case 'buyMachine': {
        const model = MACHINE_MODELS.find((m) => m.id === command.model);
        if (!model) return fail('Unknown machine.');
        if (career.mode === 'sandbox') return fail('Every machine is already in the sandbox fleet.');
        if (!career.canAfford(model.price)) return fail(`You need $${model.price.toLocaleString('en-US')}.`);
        career.spend(model.price);
        this.spawn(career.addMachine(model.id));
        return OK;
      }
      case 'buyUpgrade': {
        const machine = this.machines.find((m) => m.owned.uid === command.machine);
        if (!machine) return fail('Unknown machine.');
        if (!this.atGarage(machine)) return fail('Bring the machine to the garage and stop it first.');
        const model = machineModel(machine.owned.model);
        const level = machine.owned.levels[command.upgrade] ?? 0;
        const price = upgradePrice(model, command.upgrade, level);
        if (price === null) return fail('That upgrade is not available.');
        if (!career.canAfford(price)) return fail(`You need $${price.toLocaleString('en-US')}.`);
        career.spend(price);
        machine.owned.levels[command.upgrade] = level + 1;
        machine.vehicle.applySpec(effectiveSpec(model, machine.owned.levels));
        return OK;
      }
      case 'winch': {
        const machine = this.machines.find((m) => m.owned.uid === command.machine);
        if (!machine) return fail('Unknown machine.');
        const cat = machine.vehicle;
        if (!command.hook) {
          cat.unhookWinch();
          return OK;
        }
        if (cat.spec.winchPullN <= 0) return fail('This machine has no winch.');
        const anchor = this.nearestAnchor(cat.body.px, cat.body.pz);
        if (!anchor || anchor.distance > cat.spec.winchCableM - 5) {
          return fail(`No winch anchor within ${cat.spec.winchCableM.toLocaleString('en-US')} m.`);
        }
        cat.hookWinch(anchor.point);
        this.hookedAnchor.set(machine.owned.uid, anchor.name);
        return OK;
      }
      case 'buyLift': {
        const lift = this.liftById(command.lift);
        if (!lift) return fail('Unknown lift.');
        if (career.lifts.has(lift.line.id)) return fail('That lift is already built.');
        if (!career.canAfford(lift.type.price))
          return fail(`You need $${lift.type.price.toLocaleString('en-US')}.`);
        career.spend(lift.type.price);
        career.lifts.add(lift.line.id);
        lift.start();
        return OK;
      }
      case 'liftControl': {
        const lift = this.liftById(command.lift);
        if (!lift || !career.lifts.has(command.lift)) return fail('That lift is not built.');
        if (command.action === 'start') lift.start();
        else if (command.action === 'stop') lift.stop();
        else if (command.action === 'emergency') lift.emergencyStop();
        else lift.speedSetting = Math.max(0.25, Math.min(1, command.speed ?? 1));
        return OK;
      }
      case 'installSnowmaking': {
        const run = this.mountain.runs.findIndex((r) => r.id === command.run);
        if (run < 0) return fail('Unknown run.');
        if (this.snowmaking.installed[run]) return fail('That run already has snowmaking.');
        const price = this.snowmaking.price(run);
        if (!career.canAfford(price)) return fail(`You need $${price.toLocaleString('en-US')}.`);
        career.spend(price);
        this.snowmaking.installed[run] = true;
        return OK;
      }
      case 'snowmakingMode': {
        const run = this.mountain.runs.findIndex((r) => r.id === command.run);
        if (run < 0 || !this.snowmaking.installed[run]) return fail('That run has no snowmaking.');
        this.snowmaking.mode[run] = command.mode;
        return OK;
      }
      case 'switchMachine': {
        const index = this.machines.findIndex((m) => m.owned.uid === command.machine);
        if (index < 0) return fail('Unknown machine.');
        if (index === this.activeIndex) return OK;
        if (!this.atGarage(this.activeMachine)) return fail('Park your current machine at the garage first.');
        if (!this.atGarage(this.machines[index]!)) return fail('That machine is out on the mountain.');
        this.activeIndex = index;
        return OK;
      }
    }
  }

  /** The anchor nearest a position, with the point the cable hooks onto (the top of the post). */
  nearestAnchor(
    x: number,
    z: number,
  ): { name: string; point: { x: number; y: number; z: number }; distance: number } | null {
    let best: { name: string; point: { x: number; y: number; z: number }; distance: number } | null = null;
    for (const a of this.mountain.winchAnchors) {
      const y = this.mountain.grid.sample(this.mountain.ground, a.x, a.z) + WINCH_POST_HEIGHT_M;
      const distance = Math.hypot(a.x - x, a.z - z);
      if (!best || distance < best.distance) best = { name: a.name, point: { x: a.x, y, z: a.z }, distance };
    }
    return best;
  }

  liftById(id: string): Lift | undefined {
    return this.lifts.find((l) => l.line.id === id);
  }

  /** Share of a lift's capacity riders are using: more when the runs it serves are groomed. */
  liftUse(lift: Lift): number {
    const served = lift.line.serves
      .map((id) => this.mountain.runs.findIndex((r) => r.id === id))
      .filter((r) => r >= 0);
    const groomed =
      served.length > 0 ? served.reduce((sum, r) => sum + this.runGroomedFraction(r), 0) / served.length : 0;
    const cover =
      served.length > 0 ? served.reduce((sum, r) => sum + this.runCover[r]!, 0) / served.length : 0;
    // Riders come for grooming, but bare, stony stretches keep many of them away.
    return (LIFT_USE_UNGROOMED + (LIFT_USE_GROOMED - LIFT_USE_UNGROOMED) * groomed) * (0.3 + 0.7 * cover);
  }

  /** Riders per hour a built lift is carrying right now. */
  liftRidersPerHour(lift: Lift): number {
    if (!this.career.lifts.has(lift.line.id)) return 0;
    return lift.capacityPerHour * (lift.speedMs / lift.type.lineSpeedMs) * this.liftUse(lift);
  }

  /** Recomputes each run's share of well-covered cells. */
  refreshCover(): void {
    for (let r = 0; r < this.runCells.length; r++) {
      const cells = this.runCells[r]!;
      let good = 0;
      for (let k = 0; k < cells.length; k++) if (this.snow.coverQuality(cells[k]!) >= 0.99) good++;
      this.runCover[r] = cells.length > 0 ? good / cells.length : 0;
    }
  }

  /** The hook point of a named anchor (the ring on top of its post). */
  nearestAnchorPoint(name: string): { x: number; y: number; z: number } | null {
    const a = this.mountain.winchAnchors.find((anchor) => anchor.name === name);
    if (!a) return null;
    return {
      x: a.x,
      y: this.mountain.grid.sample(this.mountain.ground, a.x, a.z) + WINCH_POST_HEIGHT_M,
      z: a.z,
    };
  }

  /** Name of the anchor a machine's winch is hooked to, if any. */
  winchAnchorName(machine: Machine): string | null {
    return machine.vehicle.winchAnchor ? (this.hookedAnchor.get(machine.owned.uid) ?? null) : null;
  }

  /** Adds a machine restored from a save, with its upgrades applied; the caller restores its state. */
  restoreMachine(owned: OwnedMachine, anchorName: string | null): Machine {
    this.career.restoreMachine(owned);
    const restored = this.career.machines[this.career.machines.length - 1]!;
    const vehicle = new Snowcat(effectiveSpec(machineModel(restored.model), restored.levels));
    const machine = { owned: restored, vehicle };
    this.machines.push(machine);
    if (anchorName) this.hookedAnchor.set(restored.uid, anchorName);
    return machine;
  }

  /** Places a newly owned machine in the next free parking bay beside the garage. */
  private spawn(owned: OwnedMachine): void {
    const model = machineModel(owned.model);
    const vehicle = new Snowcat(effectiveSpec(model, owned.levels));
    const { depot } = this.mountain;
    const bay = this.machines.length;
    // Bays alternate either side of the garage door.
    const offset = (bay % 2 === 0 ? 1 : -1) * Math.ceil(bay / 2) * PARKING_SPACING_M;
    vehicle.place(depot.x + offset, depot.z, depot.heading, this.snow);
    this.machines.push({ owned, vehicle });
  }

  private payOut(): void {
    const { mountain, career } = this;
    this.snow.takeGroomCredit(this.credit);
    const cellArea = mountain.grid.cellM * mountain.grid.cellM;
    let pay = 0;
    let label = '';
    for (let s = 0; s < mountain.sections.length; s++) {
      const credit = this.credit[s + 1]!;
      if (credit > 0) {
        const run = mountain.runs[mountain.sections[s]!.run]!;
        pay += credit * cellArea * GROOM_RATE[run.difficulty];
        label = `Grooming ${run.name}`;
      }
    }
    this.pendingPay += pay;
    if (label) this.pendingLabel = label;
    if (this.pendingPay >= 1) {
      const whole = Math.floor(this.pendingPay);
      career.earn(whole);
      this.events.push({ amount: whole, label: this.pendingLabel });
      this.pendingPay -= whole;
    }

    // Snowmaking: water and power.
    const snowCost = this.snowmaking.takeCost();
    if (snowCost > 0) {
      career.spend(snowCost);
      this.snowmakingSpent += snowCost;
    }
    if (this.stepCount % (PAYOUT_INTERVAL_STEPS * 4) === 0) this.refreshCover();

    // Lift tickets for the riders carried since the last payout.
    const interval = PAYOUT_INTERVAL_STEPS * this.stepSeconds;
    for (const lift of this.lifts) {
      this.pendingTickets += (this.liftRidersPerHour(lift) / 3600) * interval * TICKET_SHARE_PER_RIDE;
    }
    if (this.pendingTickets >= 1) {
      const whole = Math.floor(this.pendingTickets);
      career.earn(whole);
      this.events.push({ amount: whole, label: 'Lift tickets' });
      this.pendingTickets -= whole;
    }

    // Bonuses for finishing sections and whole runs; they re-arm once the grooming wears away.
    for (let s = 0; s < mountain.sections.length; s++) {
      const fraction = this.sectionGroomedFraction(s);
      if (!this.sectionBonusPaid[s] && fraction >= SECTION_DONE) {
        this.sectionBonusPaid[s] = 1;
        const section = mountain.sections[s]!;
        const run = mountain.runs[section.run]!;
        const bonus = Math.round(
          section.cellCount * cellArea * GROOM_RATE[run.difficulty] * SECTION_BONUS_SHARE,
        );
        career.earn(bonus);
        this.events.push({
          amount: bonus,
          label: `${run.name} section ${section.index + 1} of ${run.sectionCount} finished`,
        });
      } else if (this.sectionBonusPaid[s] && fraction < SECTION_REARM) {
        this.sectionBonusPaid[s] = 0;
      }
    }
    for (let r = 0; r < mountain.runs.length; r++) {
      const fraction = this.runGroomedFraction(r);
      if (!this.runBonusPaid[r] && fraction >= SECTION_DONE) {
        this.runBonusPaid[r] = 1;
        const run = mountain.runs[r]!;
        let cells = 0;
        for (let s = run.firstSection; s < run.firstSection + run.sectionCount; s++)
          cells += mountain.sections[s]!.cellCount;
        const bonus = Math.round(cells * cellArea * GROOM_RATE[run.difficulty] * RUN_BONUS_SHARE);
        career.earn(bonus);
        this.events.push({ amount: bonus, label: `${run.name} fully groomed` });
      } else if (this.runBonusPaid[r] && fraction < SECTION_REARM) {
        this.runBonusPaid[r] = 0;
      }
    }
  }

  /** Share of all marked pistes that is currently groomed, 0..1. */
  get pisteGroomedFraction(): number {
    return this.mountain.pisteCellCount > 0 ? this.snow.groomedPisteCells / this.mountain.pisteCellCount : 0;
  }

  /** Share of one run section that is groomed, 0..1. `section` indexes mountain.sections. */
  sectionGroomedFraction(section: number): number {
    const cells = this.mountain.sections[section]!.cellCount;
    return cells > 0 ? this.snow.groomedBySection[section + 1]! / cells : 0;
  }

  /** Share of one run that is groomed, 0..1. `run` indexes mountain.runs. */
  runGroomedFraction(run: number): number {
    const r = this.mountain.runs[run]!;
    let groomed = 0;
    let cells = 0;
    for (let s = r.firstSection; s < r.firstSection + r.sectionCount; s++) {
      groomed += this.snow.groomedBySection[s + 1]!;
      cells += this.mountain.sections[s]!.cellCount;
    }
    return cells > 0 ? groomed / cells : 0;
  }
}

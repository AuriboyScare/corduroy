import {
  Career,
  CAREER_START_MACHINE,
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
}

/** Everything that is simulated: the mountain, its snow, the machines and the resort's books. */
export class World {
  readonly mountain: Mountain;
  readonly snow: Snowpack;
  readonly career: Career;
  readonly machines: Machine[] = [];
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
  /** Money owed but below a cent, carried to the next payout. */
  private pendingPay = 0;
  private pendingLabel = '';

  constructor(mountain: Mountain, snow: Snowpack, options: WorldOptions = {}) {
    const mode = options.mode ?? 'career';
    this.mountain = mountain;
    this.snow = snow;
    this.trees = mountain.treeCount > 0 ? new TreeIndex(mountain) : null;
    this.career = new Career(mode);
    this.credit = new Float64Array(mountain.sections.length + 1);
    this.sectionBonusPaid = new Uint8Array(mountain.sections.length);
    this.runBonusPaid = new Uint8Array(mountain.runs.length);
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

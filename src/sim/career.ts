import type { Difficulty } from './resort/layout';

export type GameMode = 'career' | 'sandbox';

/** A machine the resort owns. `levels` maps upgrade id to the level bought. */
export interface OwnedMachine {
  readonly uid: number;
  readonly model: string;
  readonly levels: Record<string, number>;
}

/** Pay per square metre of newly groomed piste at full quality. */
export const GROOM_RATE: Record<Difficulty, number> = {
  beginner: 0.04,
  easy: 0.05,
  intermediate: 0.065,
  advanced: 0.09,
};

/** A finished section pays this share of what grooming all of it earned, on top. */
export const SECTION_BONUS_SHARE = 0.5;
/** A finished run pays this share of its whole area's grooming value, on top. */
export const RUN_BONUS_SHARE = 0.5;
/** A section counts as finished at this groomed fraction... */
export const SECTION_DONE = 0.9;
/** ...and can earn its bonus again once it has worn back below this. */
export const SECTION_REARM = 0.5;

export const CAREER_START_MONEY = 2_000;
/** Lifts a new career begins with. */
export const CAREER_START_LIFTS = ['nursery-tow'];
/** What the resort keeps from each lift ride. */
export const TICKET_SHARE_PER_RIDE = 1.1;
/** Share of a lift's capacity used with its runs ungroomed, and with them fully groomed. */
export const LIFT_USE_UNGROOMED = 0.2;
export const LIFT_USE_GROOMED = 1;
export const CAREER_START_MACHINE = 'kestrel-260';

export interface EarningEvent {
  readonly amount: number;
  readonly label: string;
}

/** Money and the machine fleet. Changed only through World.apply(). */
export class Career {
  readonly mode: GameMode;
  money: number;
  readonly machines: OwnedMachine[] = [];
  /** Ids of the lifts the resort has built. */
  readonly lifts = new Set<string>();
  /** Lifetime earnings, for the HUD. */
  earned = 0;
  /** The uid the next machine will get; saved so uids are never reused. */
  nextUid = 1;

  constructor(mode: GameMode) {
    this.mode = mode;
    this.money = mode === 'sandbox' ? Infinity : CAREER_START_MONEY;
  }

  /** Re-adds a machine from a save, keeping its uid and upgrades. */
  restoreMachine(machine: OwnedMachine): void {
    this.machines.push({ uid: machine.uid, model: machine.model, levels: { ...machine.levels } });
    this.nextUid = Math.max(this.nextUid, machine.uid + 1);
  }

  addMachine(model: string): OwnedMachine {
    const machine: OwnedMachine = { uid: this.nextUid++, model, levels: {} };
    this.machines.push(machine);
    return machine;
  }

  canAfford(price: number): boolean {
    return this.mode === 'sandbox' || this.money >= price;
  }

  spend(price: number): void {
    if (this.mode === 'career') this.money -= price;
  }

  earn(amount: number): void {
    this.earned += amount;
    if (this.mode === 'career') this.money += amount;
  }
}

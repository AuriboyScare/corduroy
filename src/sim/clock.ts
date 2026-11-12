/**
 * Fixed-step simulation clock. Real time is accumulated and consumed in whole steps so the
 * simulation is deterministic for a given step count, whatever the frame rate.
 */
export interface ClockOptions {
  /** Step length in simulated seconds. */
  stepSeconds: number;
  /** Upper bound on steps per advance(); excess real time is dropped, not queued. */
  maxStepsPerAdvance: number;
}

export class FixedStepClock {
  readonly stepSeconds: number;
  readonly maxStepsPerAdvance: number;
  /** Simulated seconds per real second. 0 pauses. */
  timeScale = 1;
  private accumulator = 0;
  private steps = 0;

  constructor(options: ClockOptions) {
    if (!(options.stepSeconds > 0)) throw new RangeError('stepSeconds must be > 0');
    if (!(options.maxStepsPerAdvance >= 1)) throw new RangeError('maxStepsPerAdvance must be >= 1');
    this.stepSeconds = options.stepSeconds;
    this.maxStepsPerAdvance = Math.floor(options.maxStepsPerAdvance);
  }

  /** Total steps taken since construction or the last restore(). */
  get stepCount(): number {
    return this.steps;
  }

  /** Simulated seconds elapsed, derived from the step count (no float drift). */
  get simSeconds(): number {
    return this.steps * this.stepSeconds;
  }

  /** Fraction of a step accumulated but not yet simulated; used to interpolate rendering. */
  get alpha(): number {
    return this.accumulator / this.stepSeconds;
  }

  /** Adds real elapsed seconds and returns how many steps to simulate now. */
  advance(realSeconds: number): number {
    if (!(realSeconds > 0) || !(this.timeScale > 0)) return 0;
    this.accumulator += realSeconds * this.timeScale;
    let due = Math.floor(this.accumulator / this.stepSeconds);
    if (due > this.maxStepsPerAdvance) {
      // Falling behind (tab was hidden, long hitch): drop the backlog instead of spiralling.
      due = this.maxStepsPerAdvance;
      this.accumulator = 0;
    } else {
      this.accumulator -= due * this.stepSeconds;
    }
    this.steps += due;
    return due;
  }

  /** Restores the step counter from a save. */
  restore(stepCount: number): void {
    if (!Number.isInteger(stepCount) || stepCount < 0) throw new RangeError('invalid stepCount');
    this.steps = stepCount;
    this.accumulator = 0;
  }
}

import type { Snowcat, SnowcatInput } from './snowcat';

/**
 * Steers a snowcat along a polyline of x, z pairs. Used by tests and demonstrations; it is the
 * seed of the AI operator that will run machines the player is not driving.
 */
export class PathFollower {
  /** Index of the path point currently being chased. */
  target: number;
  done = false;
  private readonly input: SnowcatInput = { throttle: 0, steer: 0, bladeLift: 0, tillerDown: false };

  constructor(
    private readonly path: Float32Array,
    /** +1 follows the path in order, -1 in reverse. */
    private readonly direction: 1 | -1,
    private readonly throttle: number,
    private readonly lookAheadM = 14,
  ) {
    this.target = direction === 1 ? 0 : path.length / 2 - 1;
  }

  update(cat: Snowcat, tillerDown: boolean): SnowcatInput {
    const count = this.path.length / 2;
    const { px, pz } = cat.body;
    // Advance the target until it is a look-ahead distance in front of the machine.
    while (true) {
      const dx = this.path[this.target * 2]! - px;
      const dz = this.path[this.target * 2 + 1]! - pz;
      if (dx * dx + dz * dz > this.lookAheadM * this.lookAheadM) break;
      const next = this.target + this.direction;
      if (next < 0 || next >= count) {
        this.done = true;
        break;
      }
      this.target = next;
    }
    const input = this.input;
    input.tillerDown = tillerDown;
    if (this.done) {
      input.throttle = 0;
      input.steer = 0;
      return input;
    }
    const bearing = Math.atan2(this.path[this.target * 2]! - px, this.path[this.target * 2 + 1]! - pz);
    const error = Math.atan2(Math.sin(bearing - cat.heading), Math.cos(bearing - cat.heading));
    input.steer = Math.max(-1, Math.min(1, error * 2.2));
    // Ease off in tight turns so the tracks are not asked to scrub at full speed.
    input.throttle = this.throttle * (1 - 0.5 * Math.min(1, Math.abs(error) / 0.8));
    return input;
  }
}

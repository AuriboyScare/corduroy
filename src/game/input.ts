import type { SnowcatInput } from '../sim/vehicles/snowcat';

/** Keyboard and mouse state, sampled once per frame. */
export class Input {
  private readonly down = new Set<string>();
  /** Presses not yet consumed. A count, so two presses inside one slow frame are not merged. */
  private readonly pressed = new Map<string, number>();
  /** Keys the game asked about this frame. */
  private readonly queried = new Set<string>();
  /** Mouse drag since the last frame, pixels. */
  dragX = 0;
  dragY = 0;
  /** Wheel movement since the last frame. */
  wheel = 0;
  private dragging = false;

  constructor(target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!this.down.has(e.code)) this.pressed.set(e.code, (this.pressed.get(e.code) ?? 0) + 1);
      this.down.add(e.code);
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    target.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      target.setPointerCapture(e.pointerId);
    });
    target.addEventListener('pointerup', (e) => {
      this.dragging = false;
      target.releasePointerCapture(e.pointerId);
    });
    target.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.dragX += e.movementX;
      this.dragY += e.movementY;
    });
    target.addEventListener(
      'wheel',
      (e) => {
        this.wheel += e.deltaY;
        e.preventDefault();
      },
      { passive: false },
    );
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  held(code: string): boolean {
    return this.down.has(code);
  }

  /** True once for each physical key press; extra presses carry over to later frames. */
  wasPressed(code: string): boolean {
    this.queried.add(code);
    const count = this.pressed.get(code) ?? 0;
    if (count === 0) return false;
    if (count === 1) this.pressed.delete(code);
    else this.pressed.set(code, count - 1);
    return true;
  }

  axis(negative: string, positive: string): number {
    return (this.down.has(positive) ? 1 : 0) - (this.down.has(negative) ? 1 : 0);
  }

  endFrame(): void {
    // Extra presses of a key the game is listening for carry over to the next frame. Presses of
    // keys nobody asked about (T while in free fly) are dropped so they do not fire later.
    for (const code of this.pressed.keys()) if (!this.queried.has(code)) this.pressed.delete(code);
    this.queried.clear();
    this.dragX = 0;
    this.dragY = 0;
    this.wheel = 0;
  }
}

/** Operator controls for the snowcat. The tiller is a latching switch. */
export class SnowcatControls {
  tillerDown = false;
  private readonly state: SnowcatInput = { throttle: 0, steer: 0, bladeLift: 0, tillerDown: false };

  read(input: Input, enabled: boolean): SnowcatInput {
    if (enabled && input.wasPressed('KeyT')) this.tillerDown = !this.tillerDown;
    const s = this.state;
    s.throttle = enabled ? input.axis('KeyS', 'KeyW') + input.axis('ArrowDown', 'ArrowUp') : 0;
    s.steer = enabled ? input.axis('KeyD', 'KeyA') + input.axis('ArrowRight', 'ArrowLeft') : 0;
    s.throttle = Math.max(-1, Math.min(1, s.throttle));
    s.steer = Math.max(-1, Math.min(1, s.steer));
    s.bladeLift = enabled ? input.axis('KeyF', 'KeyR') : 0;
    s.tillerDown = this.tillerDown;
    return s;
  }
}

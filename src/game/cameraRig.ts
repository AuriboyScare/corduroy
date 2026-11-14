import { Quaternion, Vector3, type PerspectiveCamera } from 'three/webgpu';
import type { Snowpack } from '../sim/snow/snowpack';
import type { Snowcat } from '../sim/vehicles/snowcat';
import type { Input } from './input';

export type CameraMode = 'chase' | 'cab' | 'free';
export const CAMERA_MODES: readonly CameraMode[] = ['chase', 'cab', 'free'];
export const CAMERA_LABELS: Record<CameraMode, string> = { chase: 'Chase', cab: 'Cab', free: 'Free fly' };

const UP = new Vector3(0, 1, 0);
const RIGHT = new Vector3(1, 0, 0);

/** Chase, in-cab and free-fly cameras for the snowcat. */
export class CameraRig {
  mode: CameraMode = 'chase';
  /** Point the camera is looking after; used to centre shadows and surface detail. */
  readonly focus = new Vector3();

  // Chase: orbit angles relative to the machine's heading, and distance.
  chaseYaw = 0.45;
  chasePitch = 0.3;
  chaseDistance = 15;
  private smoothedHeading = 0;
  // Cab: look offsets from straight ahead.
  private cabYaw = 0;
  private cabPitch = -0.2;
  // Free fly.
  readonly freePosition = new Vector3();
  freeYaw = 0;
  freePitch = -0.2;

  private readonly q = new Quaternion();
  /** Operator's eye position in the driven machine's body coordinates, set from its model. */
  readonly cabEye = new Vector3(0, 1.18, 1.0);
  private readonly q2 = new Quaternion();
  private readonly v = new Vector3();
  private initialised = false;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly snow: Snowpack,
  ) {}

  cycle(): void {
    this.setMode(CAMERA_MODES[(CAMERA_MODES.indexOf(this.mode) + 1) % CAMERA_MODES.length]!);
  }

  setMode(mode: CameraMode): void {
    if (mode === 'free' && this.mode !== 'free') {
      // Start the free camera where the current view is.
      this.freePosition.copy(this.camera.position);
      this.v.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
      this.freeYaw = Math.atan2(-this.v.x, -this.v.z);
      this.freePitch = Math.asin(Math.max(-1, Math.min(1, this.v.y)));
    }
    this.mode = mode;
  }

  update(dt: number, input: Input, cat: Snowcat): void {
    const b = cat.body;
    const camera = this.camera;
    if (!this.initialised) {
      this.smoothedHeading = cat.heading;
      this.initialised = true;
    }
    const sensitivity = 0.0045;

    if (this.mode === 'chase') {
      this.chaseYaw -= input.dragX * sensitivity;
      this.chasePitch = Math.max(-0.05, Math.min(1.35, this.chasePitch + input.dragY * sensitivity));
      this.chaseDistance = Math.max(7, Math.min(120, this.chaseDistance * Math.exp(input.wheel * 0.0012)));
      // Follow the heading with a little lag so turns read as turns.
      const delta = Math.atan2(
        Math.sin(cat.heading - this.smoothedHeading),
        Math.cos(cat.heading - this.smoothedHeading),
      );
      this.smoothedHeading += delta * Math.min(1, dt * 3);
      const yaw = this.smoothedHeading + Math.PI + this.chaseYaw;
      const flat = Math.cos(this.chasePitch) * this.chaseDistance;
      this.focus.set(b.px, b.py + 0.9, b.pz);
      camera.position.set(
        this.focus.x + Math.sin(yaw) * flat,
        this.focus.y + Math.sin(this.chasePitch) * this.chaseDistance,
        this.focus.z + Math.cos(yaw) * flat,
      );
      const floor = this.snow.surfaceAt(camera.position.x, camera.position.z) + 0.7;
      if (camera.position.y < floor) camera.position.y = floor;
      camera.lookAt(this.focus);
    } else if (this.mode === 'cab') {
      this.cabYaw = Math.max(-2.4, Math.min(2.4, this.cabYaw - input.dragX * sensitivity));
      this.cabPitch = Math.max(-0.9, Math.min(0.6, this.cabPitch - input.dragY * sensitivity));
      b.toWorld(this.cabEye.x, this.cabEye.y, this.cabEye.z);
      camera.position.set(b.px + b.ox, b.py + b.oy, b.pz + b.oz);
      // Cameras look down -z; the machine faces +z.
      this.q.set(b.qx, b.qy, b.qz, b.qw);
      this.q.multiply(this.q2.setFromAxisAngle(UP, Math.PI + this.cabYaw));
      this.q.multiply(this.q2.setFromAxisAngle(RIGHT, this.cabPitch));
      camera.quaternion.copy(this.q);
      this.focus.set(b.px, b.py, b.pz);
    } else {
      this.freeYaw -= input.dragX * sensitivity;
      this.freePitch = Math.max(-1.5, Math.min(1.5, this.freePitch - input.dragY * sensitivity));
      const speed = (input.held('ShiftLeft') || input.held('ShiftRight') ? 160 : 32) * dt;
      const forward = input.axis('KeyS', 'KeyW');
      const strafe = input.axis('KeyA', 'KeyD');
      const lift = input.axis('KeyQ', 'KeyE');
      const sy = Math.sin(this.freeYaw);
      const cy = Math.cos(this.freeYaw);
      const cp = Math.cos(this.freePitch);
      this.freePosition.x += (-sy * cp * forward + cy * strafe) * speed;
      this.freePosition.z += (-cy * cp * forward - sy * strafe) * speed;
      this.freePosition.y += (Math.sin(this.freePitch) * forward + lift) * speed;
      const size = this.snow.grid.sizeM;
      const fx = Math.max(0, Math.min(size, this.freePosition.x));
      const fz = Math.max(0, Math.min(size, this.freePosition.z));
      const floor = this.snow.surfaceAt(fx, fz) + 1.2;
      if (this.freePosition.y < floor) this.freePosition.y = floor;
      camera.position.copy(this.freePosition);
      this.q.setFromAxisAngle(UP, this.freeYaw);
      this.q.multiply(this.q2.setFromAxisAngle(RIGHT, this.freePitch));
      camera.quaternion.copy(this.q);
      // Detail and shadows follow what is in front of the camera.
      this.v.set(0, 0, -1).applyQuaternion(camera.quaternion);
      this.focus.copy(camera.position).addScaledVector(this.v, 40);
      this.focus.x = Math.max(0, Math.min(size, this.focus.x));
      this.focus.z = Math.max(0, Math.min(size, this.focus.z));
      this.focus.y = this.snow.surfaceAt(this.focus.x, this.focus.z);
    }
  }
}

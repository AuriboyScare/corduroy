import { attribute, float, instanceColor, length, smoothstep, uv, vec3 } from 'three/tsl';
import {
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicNodeMaterial,
  NormalBlending,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Camera,
} from 'three/webgpu';
import type { Snowpack } from '../sim/snow/snowpack';

const GRAVITY = 9.81;

/** How a kind of particle moves and looks. */
export interface ParticleKind {
  /** Upward acceleration from buoyancy, m/s² (smoke rises). */
  lift: number;
  /** Air drag per second (fraction of velocity lost). */
  drag: number;
  /** Size growth per second, m/s. */
  grow: number;
  /** Opacity at birth. */
  opacity: number;
  /** Dies on touching the snow (snow) or slides over it (smoke). */
  settles: boolean;
}

export const SNOW: ParticleKind = { lift: 0, drag: 1.6, grow: 0.02, opacity: 0.75, settles: true };
export const POWDER: ParticleKind = {
  lift: GRAVITY * 0.85,
  drag: 2.8,
  grow: 0.9,
  opacity: 0.35,
  settles: false,
};
/** Snow-gun mist: fine droplets freezing as they fall, carried by the wind. */
export const MIST: ParticleKind = { lift: 9.81 * 0.82, drag: 0.9, grow: 1.1, opacity: 0.4, settles: false };
export const SMOKE: ParticleKind = {
  lift: GRAVITY * 1.06,
  drag: 1.2,
  grow: 0.7,
  opacity: 0.5,
  settles: false,
};

/**
 * A pool of camera-facing particles drawn as one instanced mesh. Simulation is simple ballistic
 * motion with drag, buoyancy and a snow floor; it is purely visual and never feeds back into the
 * simulation.
 */
export class Particles {
  readonly mesh: InstancedMesh;
  private readonly capacity: number;
  private count = 0;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly age: Float32Array;
  private readonly size: Float32Array;
  private readonly kind: ParticleKind[];
  private readonly color: Float32Array;
  private readonly fade: InstancedBufferAttribute;
  private readonly matrix = new Matrix4();
  private readonly scale = new Vector3();
  private readonly at = new Vector3();
  private readonly tint = new Color();
  private readonly facing = new Quaternion();

  constructor(capacity: number) {
    this.capacity = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.age = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.color = new Float32Array(capacity * 3);
    this.kind = new Array<ParticleKind>(capacity).fill(SNOW);

    const material = new MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
    });
    // Soft round sprite: opaque centre, feathered edge, faded by age.
    const r = length(uv().sub(0.5)).mul(2);
    material.colorNode = vec3(instanceColor);
    material.opacityNode = float(1)
      .sub(smoothstep(0.25, 1, r))
      .mul(attribute('particleFade', 'float'));
    this.mesh = new InstancedMesh(new PlaneGeometry(1, 1), material, capacity);
    this.fade = new InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.fade.setUsage(DynamicDrawUsage);
    this.mesh.geometry.setAttribute('particleFade', this.fade);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.setColorAt(0, this.tint.setRGB(1, 1, 1));
    this.mesh.instanceColor!.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 2;
  }

  /** Adds one particle; silently drops it when the pool is full. */
  emit(
    kind: ParticleKind,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size: number,
    r: number,
    g: number,
    b: number,
  ): void {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.age[i] = 0;
    this.size[i] = size;
    this.kind[i] = kind;
    this.color[i * 3] = r;
    this.color[i * 3 + 1] = g;
    this.color[i * 3 + 2] = b;
  }

  /** Moves every particle, removes the dead, and writes the instance buffers facing the camera. */
  update(dt: number, camera: Camera, snow: Snowpack, windX: number, windZ: number): void {
    let i = 0;
    while (i < this.count) {
      const kind = this.kind[i]!;
      this.age[i]! += dt;
      let dead = this.age[i]! >= this.life[i]!;
      if (!dead) {
        const o = i * 3;
        const drag = Math.exp(-kind.drag * dt);
        // Drag pulls velocity toward the wind, so light particles drift with it.
        this.vel[o] = windX + (this.vel[o]! - windX) * drag;
        this.vel[o + 1] = this.vel[o + 1]! * drag + (kind.lift - GRAVITY) * dt;
        this.vel[o + 2] = windZ + (this.vel[o + 2]! - windZ) * drag;
        this.pos[o]! += this.vel[o]! * dt;
        this.pos[o + 1]! += this.vel[o + 1]! * dt;
        this.pos[o + 2]! += this.vel[o + 2]! * dt;
        this.size[i]! += kind.grow * dt;
        const floor = snow.surfaceAt(this.pos[o]!, this.pos[o + 2]!);
        if (this.pos[o + 1]! < floor) {
          if (kind.settles) dead = true;
          else {
            this.pos[o + 1] = floor;
            this.vel[o + 1] = Math.max(0, this.vel[o + 1]!);
          }
        }
      }
      if (dead) {
        this.swapRemove(i);
        continue;
      }
      i++;
    }

    this.facing.copy(camera.quaternion);
    for (let k = 0; k < this.count; k++) {
      const s = this.size[k]!;
      this.matrix.compose(this.at.fromArray(this.pos, k * 3), this.facing, this.scale.set(s, s, s));
      this.mesh.setMatrixAt(k, this.matrix);
      this.mesh.setColorAt(k, this.tint.fromArray(this.color, k * 3));
      const kind = this.kind[k]!;
      const t = this.age[k]! / this.life[k]!;
      // Snow fades out at the very end; smoke and powder thin out as they spread.
      this.fade.array[k] = kind.settles
        ? kind.opacity * (t > 0.8 ? (1 - t) / 0.2 : 1)
        : kind.opacity * (1 - t) * (1 - t);
    }
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
    this.fade.needsUpdate = true;
  }

  get activeCount(): number {
    return this.count;
  }

  private swapRemove(i: number): void {
    const last = --this.count;
    if (i === last) return;
    for (let c = 0; c < 3; c++) {
      this.pos[i * 3 + c] = this.pos[last * 3 + c]!;
      this.vel[i * 3 + c] = this.vel[last * 3 + c]!;
      this.color[i * 3 + c] = this.color[last * 3 + c]!;
    }
    this.life[i] = this.life[last]!;
    this.age[i] = this.age[last]!;
    this.size[i] = this.size[last]!;
    this.kind[i] = this.kind[last]!;
  }
}

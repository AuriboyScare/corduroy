import { Group, SpotLight, type Object3D } from 'three/webgpu';
import type { Snowcat } from '../sim/vehicles/snowcat';

/** Lamp positions in Kestrel 420 body coordinates: two forward floodlights and one over the tiller. */
const LAMPS = [
  // A light bar above the cab, aimed far down the slope in a narrow beam, so a raised blade
  // close in front does not catch the full glare.
  { x: 0.7, y: 1.78, z: 1.9, aimZ: 28, rear: false },
  { x: -0.7, y: 1.78, z: 1.9, aimZ: 28, rear: false },
  // Mounted at the very back, above the tiller hitch, so it lights the work and not the deck.
  { x: 0, y: 1.0, z: -2.6, aimZ: -12, rear: true },
] as const;

/**
 * The driven machine's working lights: real spotlights that switch on as it gets dark. The work
 * light upgrade makes them brighter and longer-reaching.
 */
export class WorkLights {
  readonly group = new Group();
  private readonly lights: SpotLight[] = [];

  constructor() {
    for (const lamp of LAMPS) {
      const light = new SpotLight(0xfff4e0, 0, 60, lamp.rear ? 1.05 : 0.42, 0.6, 1.6);
      light.castShadow = false;
      this.lights.push(light);
      this.group.add(light, light.target as Object3D);
    }
  }

  update(cat: Snowcat, darkness: number): void {
    const b = cat.body;
    const scale = cat.spec.bodyLengthM / 8;
    const level = cat.spec.workLights;
    const on = Math.max(0, Math.min(1, (darkness - 0.25) / 0.4));
    LAMPS.forEach((lamp, k) => {
      const light = this.lights[k]!;
      b.toWorld(lamp.x * scale, lamp.y * scale, lamp.z * scale);
      light.position.set(b.px + b.ox, b.py + b.oy, b.pz + b.oz);
      b.toWorld(lamp.x * scale, -1.2, lamp.aimZ * (1 + 0.4 * level));
      light.target.position.set(b.px + b.ox, b.py + b.oy, b.pz + b.oz);
      light.target.updateMatrixWorld();
      light.intensity = on * (lamp.rear ? 650 : 1500) * (1 + 0.6 * level);
      light.distance = (lamp.rear ? 35 : 60) * (1 + 0.45 * level);
      light.visible = on > 0;
    });
  }
}

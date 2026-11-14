import { Group, type Vector3 } from 'three/webgpu';
import { machineModel } from '../sim/machines/catalog';
import type { SnowcatSpec } from '../sim/vehicles/snowcat';
import type { Machine } from '../sim/world';
import { SnowcatModel } from './snowcatModel';

/** Paint per machine model. */
const PAINT: Record<string, number> = {
  'kestrel-260': 0xd9a21b,
  'kestrel-420': 0xc22a1c,
  'kestrel-600w': 0x1f4e8c,
};

interface View {
  model: SnowcatModel;
  /** What the model was built from; when it changes, an upgrade changed how the machine looks. */
  look: string;
}

/** Upgrades that change the model as well as the machine. */
const VISIBLE_UPGRADES = ['engine', 'tracks', 'hydraulics', 'finisher', 'lights'] as const;

/** State of the scene the models need each frame. */
export interface FleetFrame {
  /** Index of the machine this player drives (its dashboard runs). */
  active: number;
  /** Whether anyone (this player or another) is driving a machine, by uid: its lights come on. */
  isDriven: (uid: number) => boolean;
  camera: Vector3;
  /** Lamp level for the driven machine, 0 (day) to 1 (night). */
  lights: number;
  dt: number;
  /** Engine speed of the driven machine, for its dashboard. */
  rpm: number;
}

function lookKey(spec: SnowcatSpec, levels: Readonly<Record<string, number>>): string {
  return [
    spec.bladeHalfWidthM,
    spec.tillerHalfWidthM,
    spec.winchPullN,
    ...VISIBLE_UPGRADES.map((id) => levels[id] ?? 0),
  ].join('|');
}

/** Keeps one model per machine in the fleet, rebuilt when an upgrade changes its implements. */
export class FleetView {
  readonly group = new Group();
  /** Models built so far, for tests: an upgrade that shows on the machine rebuilds its model. */
  builds = 0;
  private readonly views = new Map<number, View>();

  /** Poses every machine; adds models for new machines and rebuilds upgraded ones. */
  sync(machines: readonly Machine[], frame: FleetFrame): void {
    machines.forEach((machine, index) => {
      const uid = machine.owned.uid;
      const spec = machine.vehicle.spec;
      const key = lookKey(spec, machine.owned.levels);
      let view = this.views.get(uid);
      if (view && view.look !== key) {
        this.group.remove(view.model.group);
        view.model.dispose();
        view = undefined;
      }
      if (!view) {
        const model = new SnowcatModel({
          name: spec.name,
          model: machine.owned.model,
          paint: PAINT[machine.owned.model] ?? 0xc22a1c,
          scale: machineModel(machine.owned.model).scale,
          bladeHalfWidthM: spec.bladeHalfWidthM,
          tillerHalfWidthM: spec.tillerHalfWidthM,
          winch: spec.winchPullN > 0,
          levels: { ...machine.owned.levels },
        });
        this.builds++;
        view = { model, look: key };
        this.views.set(uid, view);
        this.group.add(model.group);
      }
      const model = view.model;
      const driven = index === frame.active;
      model.sync(machine.vehicle);
      model.setDriven(driven);
      model.setLights(frame.isDriven(uid) ? frame.lights : 0);
      if (driven) model.updateDashboard(frame.dt, machine.vehicle, frame.rpm);
      const b = machine.vehicle.body;
      model.updateDetail(Math.hypot(b.px - frame.camera.x, b.py - frame.camera.y, b.pz - frame.camera.z));
    });
  }

  /** Hides the cab glazing of the machine the camera sits in (null: none). */
  setInteriorView(uid: number | null): void {
    for (const [id, view] of this.views) view.model.setInteriorView(id === uid);
  }

  /** The model of one machine, for camera and winch drawing. */
  model(uid: number): SnowcatModel | undefined {
    return this.views.get(uid)?.model;
  }
}

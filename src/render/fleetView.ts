import { Group } from 'three/webgpu';
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
  /** The spec the view was built from; a new spec object means an upgrade changed the machine. */
  spec: SnowcatSpec;
}

/** Keeps one model per machine in the fleet, rebuilt when an upgrade changes its implements. */
export class FleetView {
  readonly group = new Group();
  private readonly views = new Map<number, View>();

  /** Poses every machine; adds models for new machines and rebuilds upgraded ones. */
  sync(machines: readonly Machine[]): void {
    for (const machine of machines) {
      const uid = machine.owned.uid;
      const spec = machine.vehicle.spec;
      let view = this.views.get(uid);
      if (view && view.spec !== spec && this.looksDifferent(view.spec, spec)) {
        this.group.remove(view.model.group);
        view.model.dispose();
        view = undefined;
      }
      if (!view) {
        const model = new SnowcatModel({
          name: spec.name,
          paint: PAINT[machine.owned.model] ?? 0xc22a1c,
          scale: machineModel(machine.owned.model).scale,
          bladeHalfWidthM: spec.bladeHalfWidthM,
          tillerHalfWidthM: spec.tillerHalfWidthM,
          winch: spec.winchPullN > 0,
        });
        view = { model, spec };
        this.views.set(uid, view);
        this.group.add(model.group);
      }
      view.spec = spec;
      view.model.sync(machine.vehicle);
    }
  }

  /** Hides the cab glazing of the machine the camera sits in (null: none). */
  setInteriorView(uid: number | null): void {
    for (const [id, view] of this.views) view.model.setInteriorView(id === uid);
  }

  /** The model of one machine, for camera and winch drawing. */
  model(uid: number): SnowcatModel | undefined {
    return this.views.get(uid)?.model;
  }

  private looksDifferent(a: SnowcatSpec, b: SnowcatSpec): boolean {
    return (
      a.bladeHalfWidthM !== b.bladeHalfWidthM ||
      a.tillerHalfWidthM !== b.tillerHalfWidthM ||
      a.winchPullN !== b.winchPullN
    );
  }
}

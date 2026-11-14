import {
  CylinderGeometry,
  LatheGeometry,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Material,
  type MeshStandardNodeMaterial,
} from 'three/webgpu';
import { extrudeX, Kit, latheX } from '../machines/kit';
import { chrome } from '../machines/materials';
import {
  cabinGlass,
  cabinRed,
  darkSteel,
  fabricBlue,
  galvanised,
  lampLens,
  mat,
  rubberLiner,
  safetyYellow,
  tramBlue,
  tramWhite,
} from './materials';
import { addSign } from './signs';

/**
 * Carriers drawn per instance: origin at the grip on the rope, hanging down (-y), facing the
 * direction of travel (+z). Riders' seats are given in the same frame.
 */
export interface CarrierDesign {
  parts: [BufferGeometry, Material][];
  /** A plain stand-in drawn for carriers far from the camera. */
  far: [BufferGeometry, Material][];
  /** Chair safety bar, drawn about its hinge so it can be lowered and raised. */
  bar?: { parts: [BufferGeometry, Material][]; hinge: Vector3 };
  seats: { x: number; y: number; z: number }[];
  pose: 'seated' | 'standing' | 'none';
}

/** Detachable grip and carriage on top of a cabin hanger: jaws, springs and station wheels. */
function grip(kit: Kit, wheels: boolean): void {
  kit.rbox(darkSteel, 0.24, 0.26, 0.6, 0.04, 0, -0.06, 0);
  kit.drum(galvanised, 0.07, 0.34, 0, -0.04, 0.18, 10);
  kit.drum(galvanised, 0.07, 0.34, 0, -0.04, -0.18, 10);
  if (wheels)
    for (const z of [-0.22, 0.22]) {
      kit.drum(rubberLiner, 0.09, 0.08, 0.2, 0.06, z, 12);
      kit.drum(rubberLiner, 0.09, 0.08, -0.2, 0.06, z, 12);
    }
}

/** Quad chair: hanger, back frame, cushioned seats and backrest, armrests, and a safety bar. */
export function chairDesign(hanger: number): CarrierDesign {
  const kit = new Kit();
  kit.roundSegments = 1;
  const seatY = -hanger;
  grip(kit, false);
  kit.tube(
    galvanised,
    [
      new Vector3(0, -0.15, 0),
      new Vector3(0, -0.6, -0.05),
      new Vector3(0, -1.0, -0.35),
      new Vector3(0, seatY + 0.95, -0.56),
      new Vector3(0, seatY + 0.74, -0.6),
    ],
    0.045,
  );
  kit.drum(galvanised, 0.04, 2.3, 0, seatY + 0.74, -0.6, 10);
  for (const s of [-1, 1]) {
    // Side frame down from the back bar and forward under the seat, doubling as an armrest.
    kit.tube(
      galvanised,
      [
        new Vector3(s * 1.14, seatY + 0.74, -0.6),
        new Vector3(s * 1.14, seatY + 0.3, -0.52),
        new Vector3(s * 1.14, seatY + 0.02, -0.4),
        new Vector3(s * 1.14, seatY + 0.02, 0.28),
      ],
      0.035,
    );
    kit.rbox(darkSteel, 0.08, 0.06, 0.5, 0.02, s * 1.14, seatY + 0.36, 0.0);
    kit.rod(
      galvanised,
      0.025,
      new Vector3(s * 1.14, seatY + 0.36, -0.2),
      new Vector3(s * 1.14, seatY + 0.05, -0.2),
    );
  }
  for (const z of [-0.3, 0.18]) kit.drum(galvanised, 0.03, 2.28, 0, seatY - 0.07, z, 8);
  // One long cushion and backrest, with seams marking the four places.
  kit.rbox(fabricBlue, 2.14, 0.1, 0.5, 0.04, 0, seatY, -0.05);
  kit.rbox(fabricBlue, 2.14, 0.55, 0.08, 0.035, 0, seatY + 0.38, -0.44, -0.18);
  for (const x of [-0.54, 0, 0.54]) {
    kit.box(darkSteel, 0.012, 0.012, 0.5, x, seatY + 0.052, -0.05);
    kit.box(darkSteel, 0.012, 0.55, 0.012, x, seatY + 0.38, -0.395, -0.18);
  }
  // Safety bar and footrest, drawn lowered, about a hinge at the top of the back frame.
  const bar = new Kit();
  bar.roundSegments = 1;
  const hinge = new Vector3(0, seatY + 0.86, -0.55);
  for (const s of [-1, 1]) {
    bar.tube(
      galvanised,
      [new Vector3(s * 1.08, 0, 0), new Vector3(s * 1.1, -0.08, 0.5), new Vector3(s * 1.08, -0.3, 0.98)],
      0.028,
    );
    bar.rod(galvanised, 0.022, new Vector3(s * 0.55, -0.3, 0.98), new Vector3(s * 0.55, -1.26, 1.08));
  }
  bar.drum(galvanised, 0.028, 2.16, 0, -0.3, 0.98, 8);
  bar.drum(galvanised, 0.03, 1.5, 0, -1.26, 1.08, 8);
  bar.rbox(rubberLiner, 1.4, 0.05, 0.16, 0.02, 0, -1.22, 1.08);
  bar.rbox(safetyYellow, 0.3, 0.06, 0.06, 0.02, 0, -0.3, 0.98);
  const far = new Kit();
  far.add(galvanised, new CylinderGeometry(0.05, 0.05, hanger, 4), 0, -hanger / 2, -0.3);
  far.box(fabricBlue, 2.2, 0.1, 0.5, 0, seatY, -0.05);
  far.box(fabricBlue, 2.2, 0.55, 0.08, 0, seatY + 0.38, -0.44, -0.18);
  far.box(galvanised, 2.25, 0.05, 0.05, 0, seatY + 0.74, -0.6);
  return {
    parts: kit.geometries(),
    far: far.geometries(),
    bar: { parts: bar.geometries(), hinge },
    seats: [-0.81, -0.27, 0.27, 0.81].map((x) => ({ x, y: seatY + 0.05, z: -0.02 })),
    pose: 'seated',
  };
}

/** Eight-seat gondola cabin: painted shell, glazed upper half, door, benches, hanger and grip. */
export function gondolaDesign(hanger: number, signs: MeshStandardNodeMaterial): CarrierDesign {
  const kit = new Kit();
  kit.roundSegments = 1;
  const roof = -hanger + 0.6;
  const floor = roof - 2.05;
  const w = 1.96;
  const l = 1.9;
  grip(kit, true);
  kit.tube(
    darkSteel,
    [
      new Vector3(0, -0.15, 0),
      new Vector3(0.18, -0.9, 0),
      new Vector3(0.24, roof + 0.55, 0),
      new Vector3(0.02, roof + 0.12, 0),
    ],
    0.06,
  );
  // Lower shell, glazed upper, roof with cap.
  kit.rbox(cabinRed, w, 0.98, l, 0.24, 0, floor + 0.49, 0);
  kit.rbox(cabinGlass, w - 0.04, 1.0, l - 0.04, 0.2, 0, floor + 1.45, 0);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      kit.rbox(cabinRed, 0.1, 1.02, 0.1, 0.03, sx * (w / 2 - 0.07), floor + 1.45, sz * (l / 2 - 0.07));
  kit.rbox(cabinRed, w + 0.04, 0.16, l + 0.04, 0.07, 0, roof - 0.04, 0);
  kit.rbox(cabinRed, 1.3, 0.12, 1.2, 0.06, 0, roof + 0.08, 0);
  kit.rbox(darkSteel, 0.5, 0.06, 0.5, 0.03, 0, roof + 0.16, 0);
  // Doors on the boarding side: seams, rubber edge, handles.
  const dx = w / 2 + 0.005;
  kit.box(mat, 0.01, 1.92, 0.02, dx, floor + 1.0, 0);
  for (const z of [-0.46, 0.46]) kit.box(mat, 0.01, 1.92, 0.02, dx, floor + 1.0, z);
  for (const z of [-0.1, 0.1]) kit.box(chrome, 0.03, 0.22, 0.03, dx + 0.015, floor + 1.0, z);
  // Floor, benches at both ends, and a ceiling light.
  kit.rbox(mat, w - 0.12, 0.04, l - 0.12, 0.02, 0, floor + 0.06, 0);
  for (const s of [-1, 1]) {
    kit.rbox(fabricBlue, w - 0.3, 0.1, 0.4, 0.04, 0, floor + 0.48, s * 0.66);
    kit.rbox(fabricBlue, w - 0.3, 0.45, 0.08, 0.03, 0, floor + 0.78, s * 0.86);
  }
  kit.rbox(lampLens, 0.6, 0.03, 0.2, 0.01, 0, roof - 0.13, 0);
  // Maker's mark on both long sides.
  for (const s of [-1, 1])
    addSign(
      kit,
      signs,
      'brand',
      0.13,
      new Vector3(s * (w / 2 + 0.01), floor + 0.7, 0.55 * s),
      new Vector3(s, 0, 0),
    );
  const far = new Kit();
  far.roundSegments = 1;
  far.add(darkSteel, new CylinderGeometry(0.06, 0.06, -roof, 4), 0, roof / 2, 0);
  far.rbox(cabinRed, w, 0.98, l, 0.2, 0, floor + 0.49, 0);
  far.rbox(cabinGlass, w - 0.04, 1.0, l - 0.04, 0.18, 0, floor + 1.45, 0);
  far.rbox(cabinRed, w + 0.04, 0.16, l + 0.04, 0.07, 0, roof - 0.04, 0);
  return { parts: kit.geometries(), far: far.geometries(), seats: [], pose: 'none' };
}

/** Aerial tram: big cabin with a glazed band and livery, hanger arms and a carriage on two track ropes. */
export function tramDesign(hanger: number, signs: MeshStandardNodeMaterial): CarrierDesign {
  const kit = new Kit();
  const roof = -hanger;
  const floor = roof - 2.8;
  const width = 3.4;
  kit.add(
    tramWhite,
    extrudeX(
      [
        [-4.25, floor],
        [4.25, floor],
        [4.55, floor + 1.0],
        [4.3, roof],
        [-4.3, roof],
        [-4.55, floor + 1.0],
      ],
      width,
      0.1,
    ),
  );
  kit.add(
    cabinGlass,
    extrudeX(
      [
        [-4.42, floor + 1.05],
        [4.42, floor + 1.05],
        [4.3, roof - 0.25],
        [-4.3, roof - 0.25],
      ],
      width + 0.06,
      0.02,
    ),
  );
  for (const s of [-1, 1]) {
    for (let z = -3.6; z <= 3.61; z += 1.2)
      kit.box(tramWhite, 0.06, 1.5, 0.12, s * (width / 2 + 0.035), floor + 1.75, z);
    addSign(
      kit,
      signs,
      'brand',
      0.32,
      new Vector3(s * (width / 2 + 0.06), floor + 0.55, -1.8 * s),
      new Vector3(s, 0, 0),
    );
  }
  kit.box(tramBlue, width + 0.08, 0.26, 8.62, 0, floor + 0.86, 0);
  kit.box(tramBlue, width + 0.08, 0.1, 8.62, 0, floor + 0.08, 0);
  kit.rbox(tramWhite, width - 0.2, 0.3, 8.2, 0.12, 0, roof + 0.12, 0);
  for (const z of [-3.2, 3.2]) kit.rbox(lampLens, 0.5, 0.05, 0.3, 0.02, 0, roof - 0.1, z * 0.9);
  // Hanger arms up to the carriage.
  for (const z of [-2.4, 2.4]) {
    kit.rod(darkSteel, 0.14, new Vector3(0, roof + 0.25, z), new Vector3(0, -0.35, z * 0.45));
    kit.rod(darkSteel, 0.07, new Vector3(-1.2, roof + 0.25, z), new Vector3(0, -0.35, z * 0.45));
    kit.rod(darkSteel, 0.07, new Vector3(1.2, roof + 0.25, z), new Vector3(0, -0.35, z * 0.45));
  }
  // Carriage: a beam with four sheaves on each track rope, and the haul rope clamp.
  kit.rbox(darkSteel, 1.25, 0.55, 5.2, 0.08, 0, 0.12, 0);
  const sheave = latheX(
    [
      [0.0, -0.06],
      [0.2, -0.06],
      [0.24, -0.04],
      [0.21, 0],
      [0.24, 0.04],
      [0.2, 0.06],
      [0.0, 0.06],
    ],
    20,
  );
  for (const z of [-1.8, -0.6, 0.6, 1.8])
    for (const x of [-0.45, 0.45]) kit.add(galvanised, sheave, x, 0.42, z);
  kit.rbox(safetyYellow, 0.3, 0.3, 0.6, 0.04, 0, -0.2, 0);
  // Only two cabins: always drawn in full.
  return { parts: kit.geometries(), far: [], seats: [], pose: 'none' };
}

/** Rope tow handle on its drop line. */
export function towDesign(hanger: number): CarrierDesign {
  const kit = new Kit();
  kit.add(galvanised, new CylinderGeometry(0.01, 0.01, hanger, 5), 0, -hanger / 2, 0);
  kit.rbox(darkSteel, 0.1, 0.06, 0.08, 0.02, 0, -0.03, 0);
  kit.add(
    safetyYellow,
    new LatheGeometry(
      [new Vector2(0, -0.13), new Vector2(0.022, -0.12), new Vector2(0.024, 0.12), new Vector2(0, 0.13)],
      8,
    ).rotateZ(Math.PI / 2),
    0,
    -hanger,
    0,
  );
  return { parts: kit.geometries(), far: [], seats: [{ x: 0.5, y: 0, z: 0 }], pose: 'standing' };
}

import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BufferGeometry } from 'three/webgpu';
import {
  BoxGeometry,
  CanvasTexture,
  Group,
  Mesh,
  MeshStandardNodeMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  type Material,
} from 'three/webgpu';

const WIDTH = 72;
const DEPTH = 18;
const EAVE = 7.5;
const RIDGE = 11;
const DOORS = 5;

const timber = new MeshStandardNodeMaterial({ color: 0x5b3f2a, roughness: 0.85, metalness: 0 });
const concrete = new MeshStandardNodeMaterial({ color: 0x8b8a86, roughness: 0.92, metalness: 0 });
const roofMetal = new MeshStandardNodeMaterial({ color: 0x2f3337, roughness: 0.5, metalness: 0.6 });
const snowCap = new MeshStandardNodeMaterial({ color: 0xeef3f8, roughness: 0.85, metalness: 0 });
const door = new MeshStandardNodeMaterial({ color: 0x6f7780, roughness: 0.55, metalness: 0.5 });
const trim = new MeshStandardNodeMaterial({ color: 0x1d2024, roughness: 0.6, metalness: 0.3 });
const lamp = new MeshStandardNodeMaterial({ color: 0xffffff, emissive: 0xfff1d0, emissiveIntensity: 1.2 });
const glass = new MeshStandardNodeMaterial({ color: 0x1c2833, roughness: 0.08, metalness: 0.2 });

function box(w: number, h: number, d: number, x: number, y: number, z: number, rx = 0): BufferGeometry {
  const g = new BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  return g.translate(x, y, z);
}

function signTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 160;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#16191d';
  ctx.fillRect(0, 0, 1024, 160);
  ctx.fillStyle = '#f2f4f6';
  ctx.font = '700 84px "Helvetica Neue", Arial, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText('MACHINE GARAGE', 512, 84);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/**
 * The machine garage: a long timber shed with a door per parking bay, facing uphill (-z) so
 * machines drive straight out onto the mountain. Origin at ground level, centre of the front wall.
 */
export function createGarage(): Group {
  const parts = new Map<Material, BufferGeometry[]>();
  const add = (material: Material, geometry: BufferGeometry): void => {
    const list = parts.get(material);
    if (list) list.push(geometry);
    else parts.set(material, [geometry]);
  };

  const zc = DEPTH / 2;
  add(concrete, box(WIDTH + 1, 0.8, DEPTH + 1, 0, 0.4, zc));
  // Walls, leaving the front open where the doors go.
  add(timber, box(WIDTH, EAVE, 0.3, 0, EAVE / 2, DEPTH));
  add(timber, box(0.3, EAVE, DEPTH, -WIDTH / 2, EAVE / 2, zc));
  add(timber, box(0.3, EAVE, DEPTH, WIDTH / 2, EAVE / 2, zc));
  const bay = WIDTH / DOORS;
  const doorWidth = bay - 2.4;
  const doorHeight = 5.4;
  for (let k = 0; k < DOORS; k++) {
    const x = -WIDTH / 2 + bay * (k + 0.5);
    // Piers between doors and the lintel above.
    add(timber, box(2.4, EAVE, 0.4, x - bay / 2 + 1.2, EAVE / 2, 0));
    add(timber, box(doorWidth, EAVE - doorHeight, 0.4, x, (EAVE + doorHeight) / 2, 0));
    // Roller door with horizontal slats.
    add(door, box(doorWidth, doorHeight, 0.15, x, doorHeight / 2, 0.1));
    for (let s = 1; s < 12; s++) add(trim, box(doorWidth, 0.04, 0.06, x, (doorHeight * s) / 12, -0.02));
    add(trim, box(doorWidth + 0.3, 0.3, 0.3, x, doorHeight + 0.15, -0.05));
    // Work light above each door.
    add(trim, box(0.6, 0.25, 0.4, x, doorHeight + 0.9, -0.3));
    add(lamp, box(0.5, 0.05, 0.3, x, doorHeight + 0.76, -0.3));
  }
  add(timber, box(2.4, EAVE, 0.4, WIDTH / 2 - 1.2, EAVE / 2, 0));
  // Gable ends.
  for (const side of [-1, 1]) {
    const g = new BoxGeometry(0.3, RIDGE - EAVE, DEPTH);
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const z = pos.getZ(i);
      // Pull the top edge into a ridge over the middle of the depth.
      if (y > 0) pos.setY(i, y - (RIDGE - EAVE) * (Math.abs(z) / (DEPTH / 2)));
    }
    g.computeVertexNormals();
    add(timber, g.translate(side * (WIDTH / 2), EAVE + (RIDGE - EAVE) / 2, zc));
  }
  // Roof: two pitched metal planes with the overhang, snow lying on top.
  const pitch = Math.atan2(RIDGE - EAVE, DEPTH / 2);
  const slope = Math.hypot(RIDGE - EAVE, DEPTH / 2) + 1.2;
  for (const side of [-1, 1]) {
    const z = zc + (side * DEPTH) / 4 + side * 0.3;
    const y = (EAVE + RIDGE) / 2 + 0.25;
    add(roofMetal, box(WIDTH + 1.6, 0.25, slope, 0, y, z, side * pitch));
    add(snowCap, box(WIDTH + 1.4, 0.35, slope - 0.6, 0, y + 0.3, z - side * 0.05, side * pitch));
  }
  // Windows along the back wall, visible from the base area.
  for (let k = 0; k < 8; k++) add(glass, box(2.2, 1.2, 0.1, -WIDTH / 2 + 5 + k * 8.9, 5, DEPTH + 0.2));

  const group = new Group();
  for (const [material, list] of parts) {
    const mesh = new Mesh(mergeGeometries(list), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const sign = new Mesh(
    new PlaneGeometry(14, 2.2),
    new MeshStandardNodeMaterial({ map: signTexture(), roughness: 0.6 }),
  );
  sign.position.set(0, EAVE + 1.4, -0.25);
  sign.rotation.y = Math.PI;
  group.add(sign);
  return group;
}

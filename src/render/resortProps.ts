import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  BoxGeometry,
  BufferAttribute,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardNodeMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type BufferGeometry,
} from 'three/webgpu';
import { hash2, smoothstep } from '../sim/rng';
import type { Difficulty } from '../sim/resort/layout';
import type { Snowpack } from '../sim/snow/snowpack';
import type { Mountain, Run } from '../sim/terrain/mountain';

const MARKER_SPACING_M = 28;
const DIFFICULTY_COLOR: Record<Difficulty, number> = {
  beginner: 0x2fa55a,
  easy: 0x2fa55a,
  intermediate: 0x2f6fd6,
  advanced: 0x111317,
};

/** A run-edge pole: orange with black bands, a reflector, and a difficulty-coloured cap. */
function poleGeometry(): { pole: BufferGeometry; bands: BufferGeometry; cap: BufferGeometry } {
  const pole = new CylinderGeometry(0.03, 0.035, 2.2, 8).translate(0, 1.1, 0);
  const bands = mergeGeometries(
    [0.9, 1.4, 1.9].map((y) => new CylinderGeometry(0.037, 0.037, 0.12, 8).translate(0, y, 0)),
  );
  const cap = new CylinderGeometry(0.09, 0.09, 0.05, 12).rotateX(Math.PI / 2).translate(0, 2.05, 0);
  return { pole, bands, cap };
}

/** Draws a trail sign face: the difficulty symbol and the run's name. */
function signTexture(run: Run): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f4f1ea';
  ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = '#2b2b2b';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, 502, 246);
  const cx = 110;
  const cy = 128;
  ctx.fillStyle = `#${DIFFICULTY_COLOR[run.difficulty].toString(16).padStart(6, '0')}`;
  if (run.difficulty === 'intermediate') ctx.fillRect(cx - 52, cy - 52, 104, 104);
  else if (run.difficulty === 'advanced') {
    ctx.beginPath();
    ctx.moveTo(cx, cy - 66);
    ctx.lineTo(cx + 66, cy);
    ctx.lineTo(cx, cy + 66);
    ctx.lineTo(cx - 66, cy);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy, 56, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#1d1d1d';
  ctx.textBaseline = 'middle';
  ctx.font = '700 58px "Helvetica Neue", Arial, sans-serif';
  const words = run.name.split(' ');
  if (words.length > 1 && ctx.measureText(run.name).width > 300) {
    ctx.fillText(words.slice(0, -1).join(' '), 196, 96);
    ctx.fillText(words[words.length - 1]!, 196, 160);
  } else {
    ctx.fillText(run.name, 196, 128);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** A lumpy boulder of unit size, its upper faces snow-covered through vertex colour. */
function boulderGeometry(seed: number): BufferGeometry {
  const geometry = new IcosahedronGeometry(1, 2);
  const pos = geometry.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = 0.8 + 0.35 * hash2(Math.round(v.x * 7) + seed, Math.round(v.y * 7 + v.z * 13), seed);
    v.multiplyScalar(n);
    v.y = v.y * 0.62 - 0.15;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geometry.computeVertexNormals();
  const normal = geometry.getAttribute('normal');
  for (let i = 0; i < pos.count; i++) {
    const up = normal.getY(i);
    const snow = smoothstep(0.35, 0.65, up);
    const rock = 0.2 + 0.08 * hash2(i, seed, 3);
    colors[i * 3] = rock + (0.88 - rock) * snow;
    colors[i * 3 + 1] = rock * 0.97 + (0.91 - rock * 0.97) * snow;
    colors[i * 3 + 2] = rock * 0.93 + (0.96 - rock * 0.93) * snow;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}

/**
 * Resort furniture that makes the mountain read as a ski area: marker poles along both edges of
 * every run, a trail sign at each run's top, and boulders where the cover is thin.
 */
export function createResortProps(mountain: Mountain, snow: Snowpack): Group {
  const group = new Group();
  const matrix = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const at = new Vector3();
  const one = new Vector3(1, 1, 1);

  // Marker poles.
  const placements: { x: number; z: number; color: number }[] = [];
  for (const run of mountain.runs) {
    const line = run.line;
    const samples = line.length / 2;
    const step = Math.max(1, Math.round(MARKER_SPACING_M / 2));
    for (let i = 0; i < samples - 1; i += step) {
      const x = line[i * 2]!;
      const z = line[i * 2 + 1]!;
      const dx = line[Math.min(samples - 1, i + 1) * 2]! - x;
      const dz = line[Math.min(samples - 1, i + 1) * 2 + 1]! - z;
      const len = Math.hypot(dx, dz) || 1;
      for (const side of [-1, 1]) {
        const off = run.halfWidthM + 1.2;
        placements.push({
          x: x + (-dz / len) * off * side,
          z: z + (dx / len) * off * side,
          color: DIFFICULTY_COLOR[run.difficulty],
        });
      }
    }
  }
  const { pole, bands, cap } = poleGeometry();
  const parts: [BufferGeometry, MeshStandardNodeMaterial][] = [
    [pole, new MeshStandardNodeMaterial({ color: 0xff6a13, roughness: 0.5 })],
    [bands, new MeshStandardNodeMaterial({ color: 0x15171a, roughness: 0.5 })],
    [cap, new MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.4 })],
  ];
  const tint = new Color();
  for (const [geometry, material] of parts) {
    const mesh = new InstancedMesh(geometry, material, placements.length);
    placements.forEach((p, k) => {
      at.set(p.x, snow.surfaceAt(p.x, p.z) - 0.4, p.z);
      matrix.compose(at, q.identity(), one);
      mesh.setMatrixAt(k, matrix);
      if (geometry === cap) mesh.setColorAt(k, tint.setHex(p.color));
    });
    mesh.castShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }

  // Trail signs at the top of each run, facing down the run.
  const post = new MeshStandardNodeMaterial({ color: 0x5c4330, roughness: 0.85 });
  for (const run of mountain.runs) {
    const x = run.line[0]!;
    const z = run.line[1]!;
    const dx = run.line[8]! - x;
    const dz = run.line[9]! - z;
    const heading = Math.atan2(dx, dz);
    const side = run.halfWidthM + 3;
    const sx = x + Math.cos(heading) * side;
    const sz = z - Math.sin(heading) * side;
    const sign = new Group();
    const y = snow.surfaceAt(sx, sz);
    sign.position.set(sx, y - 0.3, sz);
    // The board faces up the run, toward people arriving at its top.
    sign.rotation.y = heading + Math.PI;
    for (const px of [-0.85, 0.85]) {
      const leg = new Mesh(new BoxGeometry(0.12, 2.6, 0.12), post);
      leg.position.set(px, 1.3, 0);
      leg.castShadow = true;
      sign.add(leg);
    }
    const board = new Mesh(
      new PlaneGeometry(2, 1),
      new MeshStandardNodeMaterial({ map: signTexture(run), roughness: 0.7 }),
    );
    board.position.set(0, 2.0, 0.07);
    sign.add(board);
    const back = new Mesh(new BoxGeometry(2.08, 1.08, 0.08), post);
    back.position.set(0, 2.0, 0);
    back.castShadow = true;
    sign.add(back);
    const roof = new Mesh(
      new BoxGeometry(2.3, 0.08, 0.4),
      new MeshStandardNodeMaterial({ color: 0xeef2f7, roughness: 0.9 }),
    );
    roof.position.set(0, 2.6, 0);
    sign.add(roof);
    group.add(sign);
  }

  // Boulders: where steep ground thins the cover, and scattered along the treeline.
  const shapes = [0, 1, 2].map((k) => boulderGeometry(101 + k * 37));
  const rockMaterial = new MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.9 });
  const spots: [number, number, number, number][][] = [[], [], []];
  const grid = mountain.grid;
  for (let cz = 2; cz < 255; cz++) {
    for (let cx = 2; cx < 255; cx++) {
      const x = (cx + hash2(cx, cz, 71)) * 8;
      const z = (cz + hash2(cx, cz, 72)) * 8;
      const i = grid.nearest(x, z);
      if (mountain.runOf[i]) continue;
      const depth = snow.base[i]! + snow.top[i]!;
      const chance = depth < 0.25 ? 0.5 : 0.015;
      if (hash2(cx, cz, 73) > chance) continue;
      const size = (depth < 0.25 ? 1 : 0.5) * (0.5 + 1.8 * hash2(cx, cz, 74) ** 2);
      spots[Math.floor(hash2(cx, cz, 75) * 3)]!.push([x, z, size, hash2(cx, cz, 76) * Math.PI * 2]);
    }
  }
  spots.forEach((list, k) => {
    if (list.length === 0) return;
    const mesh = new InstancedMesh(shapes[k]!, rockMaterial, list.length);
    const s = new Vector3();
    list.forEach(([x, z, size, turn], j) => {
      at.set(x, snow.surfaceAt(x, z) - size * 0.2, z);
      q.setFromAxisAngle(up, turn);
      matrix.compose(at, q, s.set(size * 1.3, size, size));
      mesh.setMatrixAt(j, matrix);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  });
  return group;
}

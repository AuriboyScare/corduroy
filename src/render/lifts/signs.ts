import { CanvasTexture, MeshStandardNodeMaterial, SRGBColorSpace, Vector3 } from 'three/webgpu';
import { color } from 'three/tsl';
import { quad, type Kit } from '../machines/kit';
import { resortLights } from './materials';

/**
 * One texture per lift for every sign on it: the name board, operating signs, the lift maker's
 * mark (fictional) and tower numbers, so all of a lift's signs draw in a single call.
 */

const W = 1024;
const H = 512;
const FONT = '"Barlow Condensed", "Arial Narrow", Arial, sans-serif';

const REGIONS = {
  name: [0, 0, 1024, 190],
  load: [0, 200, 330, 120],
  unload: [345, 200, 330, 120],
  tips: [690, 200, 334, 120],
  brand: [0, 330, 500, 80],
  station: [0, 420, 500, 90],
} as const satisfies Record<string, readonly [number, number, number, number]>;

export type SignName = keyof typeof REGIONS | `tower${number}`;

/** Tower number plates sit in a 10 x 3 grid at the right of the sheet. */
function region(name: SignName): readonly [number, number, number, number] {
  if (name.startsWith('tower')) {
    const n = Math.max(0, Math.min(29, Number(name.slice(5)) - 1));
    return [512 + (n % 10) * 51, 330 + Math.floor(n / 10) * 60, 49, 58];
  }
  return REGIONS[name as keyof typeof REGIONS];
}

export function signUv(name: SignName): number[] {
  const [x, y, w, h] = region(name);
  const u0 = x / W;
  const u1 = (x + w) / W;
  const v0 = 1 - (y + h) / H;
  const v1 = 1 - y / H;
  return [u0, v0, u1, v0, u1, v1, u0, v1];
}

export const signAspect = (name: SignName): number => {
  const [, , w, h] = region(name);
  return w / h;
};

export function signMaterial(liftName: string, kindLabel: string): MeshStandardNodeMaterial {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext('2d')!;
  c.clearRect(0, 0, W, H);
  const board = (x: number, y: number, w: number, h: number, fill: string) => {
    c.fillStyle = fill;
    c.beginPath();
    c.roundRect(x + 3, y + 3, w - 6, h - 6, 10);
    c.fill();
  };
  {
    const [x, y, w, h] = REGIONS.name;
    board(x, y, w, h, '#1d4a3a');
    c.strokeStyle = '#e8efe9';
    c.lineWidth = 6;
    c.beginPath();
    c.roundRect(x + 14, y + 14, w - 28, h - 28, 8);
    c.stroke();
    c.fillStyle = '#f4f6f4';
    c.font = `700 104px ${FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(liftName.toUpperCase(), x + w / 2, y + 82);
    c.font = `600 38px ${FONT}`;
    c.fillStyle = '#c8d8cf';
    c.fillText(kindLabel.toUpperCase(), x + w / 2, y + 148);
  }
  const notice = (key: 'load' | 'unload' | 'tips', fill: string, ink: string, lines: string[]) => {
    const [x, y, w, h] = REGIONS[key];
    board(x, y, w, h, fill);
    c.fillStyle = ink;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `700 ${lines.length > 1 ? 42 : 58}px ${FONT}`;
    lines.forEach((line, k) => c.fillText(line, x + w / 2, y + h / 2 + (k - (lines.length - 1) / 2) * 44));
  };
  notice('load', '#1f7a3f', '#ffffff', ['LOAD HERE']);
  notice('unload', '#c9361f', '#ffffff', ['UNLOAD', 'HERE']);
  notice('tips', '#f2c21b', '#16181b', ['KEEP SKI', 'TIPS UP']);
  {
    const [x, y, , h] = REGIONS.brand;
    c.fillStyle = '#f4f6f8';
    c.font = `italic 700 54px ${FONT}`;
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillText('ASTER', x + 20, y + h / 2);
    c.font = `600 30px ${FONT}`;
    c.fillText('ROPEWAYS', x + 180, y + h / 2 + 4);
    c.fillRect(x + 20, y + h - 12, 300, 4);
  }
  {
    const [x, y, w, h] = REGIONS.station;
    board(x, y, w, h, '#1d2a22');
    c.fillStyle = '#f4f6f4';
    c.font = `700 52px ${FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(liftName.toUpperCase(), x + w / 2, y + h / 2 + 2);
  }
  for (let n = 1; n <= 30; n++) {
    const [x, y, w, h] = region(`tower${n}`);
    board(x, y, w, h, '#f2f4f6');
    c.fillStyle = '#16181b';
    c.font = `700 40px ${FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(String(n), x + w / 2, y + h / 2 + 2);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  const m = new MeshStandardNodeMaterial({ map: texture, alphaTest: 0.4, roughness: 0.55 });
  // Signs are floodlit at night.
  m.emissiveNode = color(0x2a2620).mul(resortLights.mul(0.6));
  return m;
}

/** Adds a sign panel: `height` tall, centred at a point, facing `normal` (horizontal). */
export function addSign(
  kit: Kit,
  material: MeshStandardNodeMaterial,
  name: SignName,
  height: number,
  centre: Vector3,
  normal: Vector3,
): void {
  const up = new Vector3(0, 1, 0);
  const right = new Vector3()
    .crossVectors(up, normal)
    .normalize()
    .multiplyScalar((height * signAspect(name)) / 2);
  const u = up.multiplyScalar(height / 2);
  const c = centre.clone().addScaledVector(normal, 0.01);
  kit.add(
    material,
    quad(
      c.clone().sub(right).sub(u),
      c.clone().add(right).sub(u),
      c.clone().add(right).add(u),
      c.clone().sub(right).add(u),
      signUv(name),
    ),
  );
}

import { CanvasTexture, MeshStandardNodeMaterial, SRGBColorSpace } from 'three/webgpu';

/**
 * One texture per machine holding every sticker it carries, so all of a machine's decals draw
 * in one call: maker mark, model badge, warning labels and a pinstripe. All marks are original.
 */

const W = 1024;
const H = 512;

/** Atlas regions in pixels: x, y, width, height. */
export const DECAL = {
  maker: [0, 0, 1024, 150],
  badge: [0, 160, 300, 120],
  keepClear: [320, 160, 220, 200],
  tiller: [560, 160, 220, 200],
  step: [800, 160, 220, 110],
  stripe: [0, 380, 1024, 40],
  hazard: [0, 440, 1024, 60],
} as const satisfies Record<string, readonly [number, number, number, number]>;

export type DecalName = keyof typeof DECAL;

/** UVs for a region, in the corner order used by `quad`: bottom-left, bottom-right, top-right, top-left. */
export function decalUv(name: DecalName): number[] {
  const [x, y, w, h] = DECAL[name];
  const u0 = x / W;
  const u1 = (x + w) / W;
  const v0 = 1 - (y + h) / H;
  const v1 = 1 - y / H;
  return [u0, v0, u1, v0, u1, v1, u0, v1];
}

/** Aspect ratio (width / height) of a region, for sizing its panel. */
export const decalAspect = (name: DecalName): number => DECAL[name][2] / DECAL[name][3];

function warning(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  icon: (cx: number, cy: number) => void,
  text: string,
): void {
  ctx.fillStyle = '#f4f1e6';
  ctx.beginPath();
  ctx.roundRect(x + 4, y + 4, w - 8, h - 8, 10);
  ctx.fill();
  // Yellow triangle with a black border.
  const cx = x + w / 2;
  const top = y + 16;
  const size = h * 0.52;
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.moveTo(cx, top);
  ctx.lineTo(cx + size * 0.62, top + size);
  ctx.lineTo(cx - size * 0.62, top + size);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ffcc1a';
  ctx.beginPath();
  ctx.moveTo(cx, top + 12);
  ctx.lineTo(cx + size * 0.62 - 12, top + size - 6);
  ctx.lineTo(cx - size * 0.62 + 12, top + size - 6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#111';
  icon(cx, top + size * 0.62);
  ctx.font = '700 24px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, y + h - 30);
}

export function decalMaterial(name: string, model: string): MeshStandardNodeMaterial {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  const cond = '"Barlow Condensed", "Arial Narrow", Arial, sans-serif';

  // Maker mark: wordmark with a swept underline and the model number.
  {
    const [x, y] = DECAL.maker;
    ctx.save();
    ctx.translate(x + 30, y + 98);
    ctx.transform(1, 0, -0.22, 1, 0, 0);
    ctx.fillStyle = '#f6f7f8';
    ctx.font = `800 118px ${cond}`;
    ctx.fillText(name.toUpperCase(), 0, 0);
    const width = ctx.measureText(name.toUpperCase()).width;
    ctx.fillRect(0, 16, width, 9);
    ctx.fillStyle = '#1b1b1b';
    ctx.fillRect(width + 26, -86, 6, 112);
    ctx.fillStyle = '#f6f7f8';
    ctx.font = `700 96px ${cond}`;
    ctx.fillText(model, width + 52, 0);
    ctx.restore();
  }
  // Model badge for the cab door.
  {
    const [x, y, w, h] = DECAL.badge;
    ctx.fillStyle = '#16181b';
    ctx.beginPath();
    ctx.roundRect(x + 6, y + 10, w - 12, h - 20, 12);
    ctx.fill();
    ctx.fillStyle = '#f6f7f8';
    ctx.font = `700 74px ${cond}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(model, x + w / 2, y + h / 2 + 4);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
  {
    const [x, y, w, h] = DECAL.keepClear;
    warning(
      ctx,
      x,
      y,
      w,
      h,
      (cx, cy) => {
        ctx.fillRect(cx - 6, cy - 34, 12, 40);
        ctx.fillRect(cx - 6, cy + 14, 12, 12);
      },
      'KEEP CLEAR',
    );
  }
  {
    const [x, y, w, h] = DECAL.tiller;
    warning(
      ctx,
      x,
      y,
      w,
      h,
      (cx, cy) => {
        ctx.beginPath();
        ctx.arc(cx, cy, 20, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffcc1a';
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          ctx.fillRect(cx + Math.cos(a) * 12 - 3, cy + Math.sin(a) * 12 - 3, 6, 6);
        }
        ctx.fillStyle = '#111';
      },
      'ROTATING TILLER',
    );
  }
  {
    const [x, y, w, h] = DECAL.step;
    ctx.fillStyle = '#ffcc1a';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#111';
    ctx.font = `700 40px ${cond}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('STEP HERE', x + w / 2, y + h / 2 + 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
  {
    const [x, y, w, h] = DECAL.stripe;
    ctx.fillStyle = '#16181b';
    ctx.fillRect(x, y + 6, w, h - 20);
    ctx.fillStyle = '#e8eaec';
    ctx.fillRect(x, y + h - 10, w, 4);
  }
  {
    const [x, y, w, h] = DECAL.hazard;
    for (let k = -2; k < w / 40 + 2; k++) {
      ctx.fillStyle = k % 2 === 0 ? '#ffcc1a' : '#141414';
      ctx.beginPath();
      ctx.moveTo(x + k * 40, y + h);
      ctx.lineTo(x + k * 40 + 40, y + h);
      ctx.lineTo(x + k * 40 + 80, y);
      ctx.lineTo(x + k * 40 + 40, y);
      ctx.closePath();
      ctx.fill();
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return new MeshStandardNodeMaterial({ map: texture, alphaTest: 0.45, roughness: 0.45, metalness: 0.05 });
}

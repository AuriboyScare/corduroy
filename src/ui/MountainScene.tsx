/**
 * Start-menu backdrop: the resort at dusk. A starry sky and moon over two ridges, a groomed
 * piste with a groomer working its way up under floodlights, a lift line, forest and a lit lodge.
 * Generated once from a fixed seed so it is the same every time.
 */

const W = 1600;
const H = 900;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A ridgeline from left to right: base curve plus a few octaves of jaggedness. */
function ridge(
  rand: () => number,
  base: (x: number) => number,
  rough: number,
  step = 16,
): [number, number][] {
  const pts: [number, number][] = [];
  const phase = [rand() * 10, rand() * 10, rand() * 10];
  for (let x = -20; x <= W + 20; x += step) {
    const n =
      Math.sin(x * 0.013 + phase[0]!) * 0.5 +
      Math.sin(x * 0.031 + phase[1]!) * 0.3 +
      Math.sin(x * 0.077 + phase[2]!) * 0.2;
    pts.push([x, base(x) + n * rough + (rand() - 0.5) * rough * 0.35]);
  }
  return pts;
}

const toPath = (pts: [number, number][], close = true) =>
  `M${pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L')}${close ? ` L${W + 20} ${H} L-20 ${H} Z` : ''}`;

/** Main massif: a peak at x=1040 with shoulders falling to the valley. */
const peakHeight = (x: number) => {
  const d = (x - 1040) / 520;
  return 250 + 420 * Math.min(1, Math.abs(d) ** 1.25) + (x < 1040 ? 0 : 20 * d);
};

function build() {
  const rand = rng(7);
  const stars = Array.from({ length: 150 }, () => ({
    x: rand() * W,
    y: rand() * 430,
    r: rand() < 0.08 ? 1.6 : 0.5 + rand() * 0.8,
    o: 0.25 + rand() * 0.7,
    twinkle: rand() < 0.15,
  }));
  const far = ridge(rand, (x) => 470 - 90 * Math.sin((x / W) * Math.PI * 1.6 + 0.4), 38, 12);
  const main = ridge(rand, peakHeight, 26, 10);
  // Shadowed east face: from the summit down the right shoulder, offset into the face.
  const summit = main.reduce((best, p) => (p[1] < best[1] ? p : best), main[0]!);
  const shadow: [number, number][] = [summit];
  for (let k = 1; k <= 14; k++) {
    const t = k / 14;
    shadow.push([summit[0] - 40 * t + Math.sin(k * 1.7) * 14, summit[1] + 470 * t]);
  }
  const eastRim = main.filter(([x]) => x > summit[0]);
  // Forest band across the lower slopes and the valley floor.
  const trees: { x: number; y: number; h: number }[] = [];
  for (let k = 0; k < 520; k++) {
    const x = rand() * (W + 40) - 20;
    const band = 655 + rand() * 230;
    const y = Math.max(band, peakHeight(x) + 60 + rand() * 30);
    if (Math.abs(x - pisteX(y)) < pisteHalf(y) + 8) continue;
    if (y > H + 10) continue;
    trees.push({ x, y, h: 10 + (y - 600) * 0.11 + rand() * 9 });
  }
  trees.sort((a, b) => a.y - b.y);
  return { stars, far, main, shadow, eastRim, summit, trees };
}

/** The piste winds down from the summit shoulder to the lodge. */
function pisteX(y: number): number {
  return 990 - (y - 330) * 0.22 + Math.sin((y - 330) / 75) * 55;
}

/** Half-width of the piste, widening towards the viewer. */
const pisteHalf = (y: number) => 7 + (y - 330) * 0.05;

/** A line down the piste at a fraction of its half-width from the centre (-1 left edge, 1 right). */
function pisteLine(frac: number, from = 330, to = 900): string {
  const pts: string[] = [];
  for (let y = from; y <= to; y += 10) pts.push(`${(pisteX(y) + frac * pisteHalf(y)).toFixed(1)} ${y}`);
  return `M${pts.join(' L')}`;
}

function pisteShape(from: number, to: number): string {
  const left: string[] = [];
  const right: string[] = [];
  for (let y = from; y <= to; y += 10) {
    left.push(`${(pisteX(y) - pisteHalf(y)).toFixed(1)} ${y}`);
    right.unshift(`${(pisteX(y) + pisteHalf(y)).toFixed(1)} ${y}`);
  }
  return `M${left.join(' L')} L${right.join(' L')} Z`;
}

const SCENE = build();
const TOWERS = [0, 1, 2, 3, 4, 5].map((k) => {
  const t = k / 5;
  return { x: 400 + 470 * t, y: 815 - 400 * t + Math.sin(t * Math.PI) * 30 };
});

export function MountainScene() {
  const { stars, far, main, shadow, eastRim, summit, trees } = SCENE;
  const catY = 610;
  const catX = pisteX(catY);
  return (
    <svg class="scene" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMaxYMax slice" aria-hidden="true">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#050a12" />
          <stop offset="0.45" stop-color="#0d1a2c" />
          <stop offset="0.75" stop-color="#1d3350" />
          <stop offset="1" stop-color="#36506d" />
        </linearGradient>
        <radialGradient id="moonGlow">
          <stop offset="0" stop-color="#dce8ff" stop-opacity="0.35" />
          <stop offset="1" stop-color="#dce8ff" stop-opacity="0" />
        </radialGradient>
        <linearGradient id="snowLit" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#a9bdd3" />
          <stop offset="1" stop-color="#6c829c" />
        </linearGradient>
        <linearGradient id="farFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#4c6380" />
          <stop offset="1" stop-color="#22324a" />
        </linearGradient>
        <linearGradient id="beam" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ffe7a8" stop-opacity="0.55" />
          <stop offset="1" stop-color="#ffe7a8" stop-opacity="0" />
        </linearGradient>
        <radialGradient id="warm">
          <stop offset="0" stop-color="#ffbe5c" stop-opacity="0.5" />
          <stop offset="1" stop-color="#ffbe5c" stop-opacity="0" />
        </radialGradient>
        <linearGradient id="valleyMist" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#0a121c" stop-opacity="0" />
          <stop offset="1" stop-color="#0a121c" stop-opacity="0.95" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill="url(#sky)" />
      {stars.map((s, k) => (
        <circle
          key={k}
          cx={s.x}
          cy={s.y}
          r={s.r}
          fill="#e8f0ff"
          opacity={s.o}
          class={s.twinkle ? 'twinkle' : undefined}
          style={s.twinkle ? { animationDelay: `${(k % 7) * 0.6}s` } : undefined}
        />
      ))}
      <circle cx="1330" cy="150" r="130" fill="url(#moonGlow)" />
      <circle cx="1330" cy="150" r="27" fill="#eef3ff" />
      <circle cx="1321" cy="143" r="5" fill="#d3dcef" />
      <circle cx="1339" cy="161" r="3.5" fill="#d3dcef" />
      <circle cx="1336" cy="138" r="2.5" fill="#dde5f4" />

      <path d={toPath(far)} fill="url(#farFill)" />
      <path
        d={toPath(
          far.map(([x, y]) => [x, y + 2]),
          false,
        )}
        fill="none"
        stroke="#9fb4cc"
        stroke-opacity="0.35"
        stroke-width="2"
      />

      <path d={toPath(main)} fill="url(#snowLit)" />
      <path
        d={`M${shadow.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L')} L${W + 20} ${H} L${W + 20} ${eastRim[eastRim.length - 1]![1]} ${eastRim
          .slice()
          .reverse()
          .map(([x, y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`)
          .join(' ')} L${summit[0]} ${summit[1]} Z`}
        fill="#3b5068"
        opacity="0.75"
      />

      {/* Piste: fresh snow above the groomer, corduroy down the fall line behind it */}
      <path d={pisteShape(330, 900)} class="scene-piste" />
      <path d={pisteShape(catY, 900)} class="scene-groomed" />
      {[-0.75, -0.45, -0.15, 0.15, 0.45, 0.75].map((f) => (
        <path key={f} d={pisteLine(f, catY + 6)} class="scene-cord" />
      ))}

      {/* Lift line and towers */}
      <path d={`M${TOWERS.map((t) => `${t.x} ${t.y - 34}`).join(' L')}`} class="scene-cable" />
      {TOWERS.map((t, k) => (
        <g key={k}>
          <path d={`M${t.x} ${t.y} V${t.y - 34} M${t.x - 7} ${t.y - 34} H${t.x + 7}`} class="scene-tower" />
          {k < TOWERS.length - 1 && (
            <path
              d={`M${(t.x + TOWERS[k + 1]!.x) / 2} ${(t.y + TOWERS[k + 1]!.y) / 2 - 30} v6 h-4 v4 h8`}
              class="scene-chair"
            />
          )}
        </g>
      ))}

      {/* The groomer, climbing with its lights on */}
      <path
        d={`M${catX - 6} ${catY - 4} L${catX - 60} ${catY - 130} L${catX + 40} ${catY - 130} Z`}
        fill="url(#beam)"
      />
      <circle cx={catX} cy={catY} r="70" fill="url(#warm)" opacity="0.6" />
      <rect x={catX - 11} y={catY - 4} width="22" height="7" rx="3" fill="#10161e" />
      <path
        d={`M${catX - 9} ${catY - 4} V${catY - 11} H${catX + 7} L${catX + 9} ${catY - 4} Z`}
        fill="#f2b632"
      />
      <rect x={catX - 13} y={catY - 13} width="26" height="3" rx="1" fill="#e2a325" />
      <circle cx={catX - 5} cy={catY - 13} r="1.6" fill="#ffd27a" class="beacon" />

      {trees.map((t, k) => (
        <path
          key={k}
          d={`M${t.x.toFixed(1)} ${(t.y - t.h).toFixed(1)} L${(t.x + t.h * 0.32).toFixed(1)} ${t.y.toFixed(1)} L${(t.x - t.h * 0.32).toFixed(1)} ${t.y.toFixed(1)} Z`}
          fill={t.y > 800 ? '#060b10' : t.y > 720 ? '#0a131b' : '#132231'}
        />
      ))}
      <rect y="700" width={W} height="200" fill="url(#valleyMist)" />

      {/* Base lodge with warm windows */}
      <circle cx="1230" cy="842" r="120" fill="url(#warm)" />
      <path d="M1150 860 V826 L1230 790 L1310 826 V860 Z" fill="#0d151d" />
      <path
        d="M1140 828 L1230 786 L1320 828"
        fill="none"
        stroke="#c9d6e4"
        stroke-width="5"
        stroke-linecap="round"
      />
      {[1168, 1192, 1256, 1280].map((x) => (
        <rect key={x} x={x} y="834" width="12" height="10" fill="#ffc46b" />
      ))}
      <rect x="1222" y="830" width="16" height="30" fill="#ffb347" opacity="0.9" />
    </svg>
  );
}

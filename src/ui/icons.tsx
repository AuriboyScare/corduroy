import type { LiftKind } from '../sim/resort/layout';

/** Line icons on a 24-unit grid, drawn with the current text colour. */
const PATHS = {
  close: 'M6 6l12 12M18 6L6 18',
  engine: 'M3 10v5M3 12.5h2M5 9h3l1.5-2.5h5L16 9h1.5l2 2H21v5h-1.5l-2 2H5z',
  tracks:
    'M5 8h14a4 4 0 0 1 0 8H5a4 4 0 0 1 0-8zM6.5 12h.01M12 12h.01M17.5 12h.01M8 5.5v2.5M12 5.5v2.5M16 5.5v2.5',
  tiller:
    'M9 15a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM9 7.5v5M6.8 8.8l4.4 2.4M6.8 11.2l4.4-2.4M14 10h7M16 15l2 4.5M19 15l2 4.5M13 16.5l2 3',
  blade: 'M3 8h18l-1.5 8h-15zM8 8v8M12 8v8M16 8v8M1.5 6.5L3 8M22.5 6.5L21 8M12 16v3',
  hydraulics: 'M3 10h10v4H3zM13 12h7M20 9.5v5M5 10V7.5h6V10M8 14v3',
  finisher: 'M4 4h16v5H4zM6 9v4M9 9v4M12 9v4M15 9v4M18 9v4M5 16.5h14M5 19.5h14',
  lights: 'M5 7h6v10H5zM11 9l2-1v8l-2-1M15 9.5l5-2M15 12h6M15 14.5l5 2M8 17v3M5 20h6',
  cruise: 'M4 17a8 8 0 1 1 16 0M12 17l4-5M6.5 12.5l1 .6M12 9v1.2M17.5 12.5l-1 .6',
  winch: 'M4 7h8v10H4zM6 7v10M10 7v10M12 9h5a3 3 0 0 1 3 3v3M20 15a2 2 0 1 1-2 2',
  snowflake:
    'M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.8 4.6L12 6l2.2-1.4M9.8 19.4L12 18l2.2 1.4M4.6 10.6L6.6 9l-.2-2.6M19.4 13.4l-2-1.6.2 2.6M4.6 13.4l2-1.6-.2 2.6M19.4 10.6l-2 1.6.2-2.6',
  thermometer: 'M10 4.5a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0zM12 9v7.5',
  droplet: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11zM9 14.5a3 3 0 0 0 3 3',
  wind: 'M3 9h11a3 3 0 1 0-3-3M3 13h15a3 3 0 1 1-3 3M3 17h6',
  peak: 'M2 19.5l7-12 4 6.5 3-4 6 9.5zM7.3 10.4l1.7 1.6 1.7-1.6',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4',
  moon: 'M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z',
  disk: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
  camera: 'M4 8h3l2-2.5h6L17 8h3v11H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  sound: 'M4 10h4l5-4v12l-5-4H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11',
  mute: 'M4 10h4l5-4v12l-5-4H4zM16 10l5 5M21 10l-5 5',
  garage: 'M3 20V9l9-5 9 5v11M7 20v-7h10v7M7 16.5h10',
  ropeTow: 'M3 19L21 5M3 19h.01M21 5h.01M8.5 14.7v3.8M7.5 18.5h2M14 10.4v3.8M13 14.2h2',
  chair: 'M2 6.5L22 4M12 5.2V10M6 10h12M7 10v5h10v-5M7 15l-.8 3M17 15l.8 3',
  gondola:
    'M2 5.5L22 3M12 4.2V8M10 8h4M6.5 8h11a1.5 1.5 0 0 1 1.5 1.5V19H5V9.5A1.5 1.5 0 0 1 6.5 8zM7.5 11h9v4h-9z',
  tram: 'M2 4.5L22 2.5M2 6.5L22 4.5M9 5.3h6M12 5.3V8M4 8h16l-1 11H5zM6 11h12v3.5H6z',
  snowgun:
    'M14 14a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM14 7v4M12 9h4M14 14l-4 6.5M14 14l3 6.5M8 20.5h11M3 7.5h2.5M2.5 10.5H5M3 13.5h2.5',
  ticket: 'M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4zM15 7v1.5M15 10.5v1M15 13v1M15 15.5V17',
  bonus: 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.3 6L12 16.4l-5.4 3 1.3-6L3.4 9.3l6-.7z',
  corduroy: 'M8.5 3h7L20 21H4zM10.5 3L9 21M12 3v18M13.5 3L15 21',
  grip: 'M3 7l3.5 5L3 17M9.5 7l3.5 5-3.5 5M16 7l3.5 5-3.5 5',
  sink: 'M12 3v9M8.5 8.5L12 12l3.5-3.5M3 17c3 0 3-2 6-2s3 2 6 2 3-2 6-2M3 20.5h18',
  layers: 'M12 4l9 5-9 5-9-5zM3 14l9 5 9-5',
  plus: 'M12 5v14M5 12h14',
  infinity: 'M7 9a3 3 0 1 0 0 6c3 0 7-6 10-6a3 3 0 1 1 0 6c-3 0-7-6-10-6z',
  keys: 'M3 7h18v10H3zM6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M8 14h8',
  water:
    'M3 8c2 0 2-1.5 4.5-1.5S9.5 8 12 8s2-1.5 4.5-1.5S19 8 21 8M3 13c2 0 2-1.5 4.5-1.5S9.5 13 12 13s2-1.5 4.5-1.5S19 13 21 13M3 18c2 0 2-1.5 4.5-1.5S9.5 18 12 18s2-1.5 4.5-1.5S19 18 21 18',
  coin: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM14.5 9.2c-.5-.8-1.4-1.2-2.5-1.2-1.5 0-2.5.8-2.5 1.9 0 2.6 5 1.4 5 4.1 0 1.1-1 2-2.5 2-1.2 0-2.1-.5-2.6-1.3M12 6.5v1.5M12 16v1.5',
  riders:
    'M8 7.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM16 7.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM4 20v-5.5A3.5 3.5 0 0 1 7.5 11h1a3.5 3.5 0 0 1 3.5 3.5M12 14.5A3.5 3.5 0 0 1 15.5 11h1a3.5 3.5 0 0 1 3.5 3.5V20',
  ruler: 'M3 16l13-13 5 5-13 13zM7 12l2 2M10 9l2 2M13 6l2 2',
  tower: 'M12 3v18M7 21h10M6 6h12M8 6l4 4 4-4M9 13l3-3 3 3',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, class: cls }: { name: IconName; size?: number; class?: string }) {
  return (
    <svg
      class={`icon${cls ? ` ${cls}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

export const LIFT_ICON: Record<LiftKind, IconName> = {
  ropeTow: 'ropeTow',
  chair: 'chair',
  gondola: 'gondola',
  tram: 'tram',
};

export const UPGRADE_ICON: Record<string, IconName> = {
  engine: 'engine',
  tracks: 'tracks',
  tiller: 'tiller',
  blade: 'blade',
  hydraulics: 'hydraulics',
  finisher: 'finisher',
  lights: 'lights',
  cruise: 'cruise',
};

interface Build {
  /** Track run, front and rear, in the 200-wide frame. */
  trackRear: number;
  trackFront: number;
  trackTop: number;
  cabRear: number;
  cabFront: number;
  cabTop: number;
  bladeH: number;
  tillerR: number;
  winch: boolean;
}

const BUILDS: Record<string, Build> = {
  'kestrel-260': {
    trackRear: 54,
    trackFront: 142,
    trackTop: 56,
    cabRear: 94,
    cabFront: 136,
    cabTop: 22,
    bladeH: 30,
    tillerR: 8,
    winch: false,
  },
  'kestrel-420': {
    trackRear: 44,
    trackFront: 150,
    trackTop: 54,
    cabRear: 96,
    cabFront: 144,
    cabTop: 16,
    bladeH: 38,
    tillerR: 9.5,
    winch: false,
  },
  'kestrel-600w': {
    trackRear: 36,
    trackFront: 158,
    trackTop: 52,
    cabRear: 102,
    cabFront: 152,
    cabTop: 14,
    bladeH: 44,
    tillerR: 10.5,
    winch: true,
  },
};

/**
 * Side view of a groomer, blade to the right: tracks with bogie wheels, cab, engine deck, tiller
 * and, on winch machines, the boom. Proportions follow the model so the three read differently.
 */
export function MachineSilhouette({ model, width = 200 }: { model: string; width?: number }) {
  const b = BUILDS[model] ?? BUILDS['kestrel-420']!;
  const ground = 76;
  const trackH = ground - b.trackTop;
  const r = trackH / 2;
  const wheels: number[] = [];
  const count = Math.round((b.trackFront - b.trackRear - 2 * r) / 17) + 1;
  for (let k = 0; k < count; k++)
    wheels.push(b.trackRear + r + ((b.trackFront - b.trackRear - 2 * r) * k) / Math.max(1, count - 1));
  const deck = b.trackTop - 12;
  const bladeX = b.trackFront + 14;
  const bladeTop = ground - b.bladeH;
  const tillerX = b.trackRear - 20;
  const tillerY = ground - b.tillerR - 3;
  return (
    <svg
      class="machine-silhouette"
      width={width}
      height={(width * 84) / 200}
      viewBox="0 0 200 84"
      aria-hidden="true"
    >
      {/* Shadow on the snow */}
      <ellipse
        cx={(b.trackRear + b.trackFront) / 2}
        cy={ground + 3}
        rx={(b.trackFront - b.trackRear) / 1.6}
        ry={3}
        class="ms-shadow"
      />
      {/* Tiller arm, drum, hood and finisher comb */}
      <path d={`M${b.trackRear + 6} ${deck + 6} L${tillerX + 4} ${tillerY - 2}`} class="ms-arm" />
      <circle cx={tillerX} cy={tillerY} r={b.tillerR} class="ms-rubber" />
      <path
        d={`M${tillerX - b.tillerR - 3} ${tillerY} A${b.tillerR + 3} ${b.tillerR + 3} 0 0 1 ${tillerX + b.tillerR + 3} ${tillerY} Z`}
        class="ms-paint"
      />
      <path
        d={`M${tillerX - b.tillerR - 2} ${tillerY + 2} L${tillerX - b.tillerR - 12} ${ground - 1} L${tillerX - b.tillerR - 1} ${ground - 1} Z`}
        class="ms-dark"
      />
      {/* Engine deck and body */}
      <path
        d={`M${b.trackRear + 2} ${b.trackTop} L${b.trackRear + 8} ${deck} H${b.cabRear} V${b.trackTop} Z`}
        class="ms-paint-deep"
      />
      <path d={`M${b.trackRear + 14} ${deck + 3} h${b.cabRear - b.trackRear - 22}`} class="ms-grille" />
      <path d={`M${b.trackRear + 14} ${deck + 6.5} h${b.cabRear - b.trackRear - 22}`} class="ms-grille" />
      <rect x={b.cabRear - 12} y={deck - 16} width={3} height={16} class="ms-dark" />
      <path
        d={`M${b.cabRear - 4} ${b.trackTop} V${deck} L${b.cabRear} ${b.cabTop} H${b.cabFront - 6} L${b.cabFront + 6} ${b.trackTop} Z`}
        class="ms-paint"
      />
      {/* Glass: side window and raked windscreen */}
      <path
        d={`M${b.cabRear + 4} ${b.cabTop + 4} H${b.cabFront - 8} L${b.cabFront} ${deck - 2} H${b.cabRear + 2} Z`}
        class="ms-glass"
      />
      <path d={`M${(b.cabRear + b.cabFront) / 2 - 2} ${b.cabTop + 4} V${deck - 2}`} class="ms-pillar" />
      <path d={`M${b.cabRear + 7} ${b.cabTop + 7} L${b.cabRear + 14} ${b.cabTop + 7}`} class="ms-glint" />
      {/* Roof light bar and beacon */}
      <rect
        x={b.cabRear + 4}
        y={b.cabTop - 4}
        width={b.cabFront - b.cabRear - 12}
        height={3}
        class="ms-dark"
      />
      <rect x={b.cabRear + 8} y={b.cabTop - 7} width={5} height={3} class="ms-beacon" />
      {/* Push frame and blade */}
      <path
        d={`M${b.trackFront - 6} ${b.trackTop + 4} L${bladeX + 2} ${ground - b.bladeH * 0.45}`}
        class="ms-arm"
      />
      <path
        d={`M${bladeX} ${bladeTop} C${bladeX + 10} ${bladeTop + b.bladeH * 0.3} ${bladeX + 10} ${ground - b.bladeH * 0.25} ${bladeX + 3} ${ground}
            L${bladeX + 9} ${ground} C${bladeX + 17} ${ground - b.bladeH * 0.3} ${bladeX + 16} ${bladeTop + b.bladeH * 0.25} ${bladeX + 6} ${bladeTop} Z`}
        class="ms-paint"
      />
      {b.winch && (
        <g>
          <path
            d={`M${b.trackRear + 16} ${deck} L${b.trackRear + 28} ${deck - 30} L${b.trackRear + 40} ${deck}`}
            class="ms-boom"
          />
          <circle cx={b.trackRear + 28} cy={deck - 30} r={2.5} class="ms-dark" />
          <path d={`M${b.trackRear + 28} ${deck - 30} L4 ${deck - 18}`} class="ms-cable" />
          <rect x={b.trackRear + 20} y={deck - 8} width={16} height={8} rx={2} class="ms-dark" />
        </g>
      )}
      {/* Track belt with cleats and bogie wheels */}
      <rect
        x={b.trackRear}
        y={b.trackTop}
        width={b.trackFront - b.trackRear}
        height={trackH}
        rx={r}
        class="ms-rubber"
      />
      <path d={`M${b.trackRear + r} ${b.trackTop + 1} H${b.trackFront - r}`} class="ms-cleats" />
      <path d={`M${b.trackRear + r} ${ground - 1} H${b.trackFront - r}`} class="ms-cleats" />
      {wheels.map((x) => (
        <circle key={x} cx={x} cy={b.trackTop + r} r={r - 4} class="ms-wheel" />
      ))}
    </svg>
  );
}

/** Brand mark: a peak whose lower slope is combed into corduroy. */
export function LogoMark({ size = 44 }: { size?: number }) {
  return (
    <svg class="logo-mark" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path d="M24 5 L45 42 H3 Z" class="logo-peak" />
      <path d="M24 5 L31.5 18 L27.5 16 L24 20 L20.5 16 L16.5 18 Z" class="logo-cap" />
      {[10, 15.5, 21, 26.5, 32, 37.5].map((x) => (
        <path key={x} d={`M${x} 42 L${24 + (x - 24) * 0.45} 25`} class="logo-cord" />
      ))}
    </svg>
  );
}

/** Dashboard instruments drawn in SVG: tachometer, load lamps, inclinometer, snow profile. */

const TACH_MAX = 2400;
const TACH_REDLINE = 2100;
const SWEEP = 270;
const START = 135;

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const [x0, y0] = polar(cx, cy, r, from);
  const [x1, y1] = polar(cx, cy, r, to);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

const angleOf = (rpm: number) => START + (SWEEP * Math.max(0, Math.min(TACH_MAX, rpm))) / TACH_MAX;

const TICKS = Array.from({ length: TACH_MAX / 250 + 1 }, (_, k) => k * 250);

/** Engine speed on a 270° dial, redline marked, with the reading in the middle. */
export function Tachometer({ rpm, size = 104 }: { rpm: number; size?: number }) {
  const c = 50;
  const shown = Math.round(rpm / 10) * 10;
  const hot = rpm >= TACH_REDLINE;
  return (
    <svg class="tach" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <path d={arc(c, c, 44, START, START + SWEEP)} class="tach-track" />
      <path d={arc(c, c, 48.5, angleOf(TACH_REDLINE), START + SWEEP)} class="tach-red" />
      {TICKS.map((t) => {
        const major = t % 500 === 0;
        const [x0, y0] = polar(c, c, major ? 34 : 36.5, angleOf(t));
        const [x1, y1] = polar(c, c, 39.5, angleOf(t));
        return (
          <line key={t} x1={x0} y1={y0} x2={x1} y2={y1} class={major ? 'tach-tick major' : 'tach-tick'} />
        );
      })}
      {TICKS.filter((t) => t % 1000 === 0).map((t) => {
        const [x, y] = polar(c, c, 28, angleOf(t));
        return (
          <text key={t} x={x} y={y + 3} class="tach-num">
            {t / 100}
          </text>
        );
      })}
      {rpm > 0 && (
        <path
          d={arc(c, c, 44, START, Math.max(START + 0.5, angleOf(rpm)))}
          class={`tach-fill${hot ? ' hot' : ''}`}
        />
      )}
      <text x={c} y={c + 7} class="tach-value">
        {shown}
      </text>
      <text x={c} y={c + 31} class="tach-unit">
        rpm
      </text>
    </svg>
  );
}

const LOAD_LEDS = 12;
/** Each lamp is 10 % of rated engine load; the last two mean overload. */
export function LoadLamps({ load }: { load: number }) {
  const lit = Math.round(Math.max(0, Math.min(1.2, load)) * 10);
  return (
    <div class="leds" aria-hidden="true">
      {Array.from({ length: LOAD_LEDS }, (_, k) => (
        <span key={k} class={`led${k < lit ? ' on' : ''}${k >= 10 ? ' red' : k >= 8 ? ' amber' : ''}`} />
      ))}
    </div>
  );
}

/** Whole degrees, without a minus sign on zero. */
const degrees = (v: number) => `${Math.round(v) || 0}°`;

/** Side and rear views of the machine tilted by its pitch and roll. */
export function Inclinometer({ pitchDeg, rollDeg }: { pitchDeg: number; rollDeg: number }) {
  return (
    <div class="incline" aria-label={`Pitch ${degrees(pitchDeg)}, roll ${degrees(rollDeg)}`}>
      <div class="incline-view">
        <svg width="62" height="36" viewBox="0 0 62 36" aria-hidden="true">
          <line x1="0" y1="24" x2="62" y2="24" class="incline-horizon" />
          <g transform={`rotate(${(-pitchDeg).toFixed(1)} 31 24)`}>
            <rect x="13" y="19" width="34" height="7" rx="3.5" class="incline-track" />
            <path d="M15 19 L17 14 H28 L30 6.5 H41 L45 14 H47 V19 Z" class="incline-body" />
            <path d="M31.5 8.5 H40 L42.5 13.5 H31.5 Z" class="incline-glass" />
            <path d="M49 10 C53 13 53 22 50 26 H52.5 C56 21 56 13 51 10 Z" class="incline-body" />
            <path d="M13 17 L8 20" class="incline-arm" />
            <circle cx="7" cy="22.5" r="3.5" class="incline-track" />
          </g>
        </svg>
        <span class="incline-value">{degrees(pitchDeg)}</span>
      </div>
      <div class="incline-view">
        <svg width="46" height="36" viewBox="0 0 46 36" aria-hidden="true">
          <line x1="0" y1="24" x2="46" y2="24" class="incline-horizon" />
          <g transform={`rotate(${rollDeg.toFixed(1)} 23 24)`}>
            <rect x="6" y="18" width="9" height="9" rx="2" class="incline-track" />
            <rect x="31" y="18" width="9" height="9" rx="2" class="incline-track" />
            <path d="M10 18 V14 H36 V18 Z M15 14 L17 5 H29 L31 14 Z" class="incline-body" />
            <path d="M18 7 H28 L29.5 12.5 H16.5 Z" class="incline-glass" />
          </g>
        </svg>
        <span class="incline-value">{degrees(rollDeg)}</span>
      </div>
    </div>
  );
}

/** Profile depth drawn at full scale. */
const PROFILE_CM = 150;

/**
 * Snow pit: the old consolidated base under the loose top layer, to scale, with the top layer
 * shaded by density and striped when it carries finished corduroy.
 */
export function SnowProfile({
  baseCm,
  topCm,
  density,
  groomed,
}: {
  baseCm: number;
  topCm: number;
  density: number;
  groomed: boolean;
}) {
  const scale = (cm: number) => Math.min(100, (Math.max(0, cm) / PROFILE_CM) * 100);
  const base = scale(baseCm);
  const top = Math.min(100 - base, scale(topCm));
  // Light powder is bright and airy; dense snow is greyer.
  const lightness = Math.round(94 - Math.min(1, density / 500) * 22);
  return (
    <div class="profile" aria-hidden="true">
      <div class="profile-scale">
        <span>1.5</span>
        <span>1.0</span>
        <span>0.5</span>
        <span>0 m</span>
      </div>
      <div class="profile-pit">
        <div class="profile-air" style={{ height: `${100 - base - top}%` }} />
        <div
          class={`profile-top${groomed ? ' groomed' : ''}`}
          style={{ height: `${top}%`, backgroundColor: `hsl(208 30% ${lightness}%)` }}
        />
        <div class="profile-base" style={{ height: `${base}%` }} />
      </div>
    </div>
  );
}

/** Horizontal stat bar on a fixed scale, with an optional ghost showing the stock value. */
export function StatBar({ value, max, stock }: { value: number; max: number; stock?: number | undefined }) {
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  return (
    <div class="statbar" aria-hidden="true">
      {stock !== undefined && stock < value && <div class="statbar-gain" style={{ width: pct(value) }} />}
      <div
        class="statbar-fill"
        style={{ width: pct(stock !== undefined ? Math.min(stock, value) : value) }}
      />
    </div>
  );
}

/** Status lamp: steady green, off, amber or flashing red. */
export function Lamp({ state }: { state: 'on' | 'off' | 'warn' | 'alarm' }) {
  return <span class={`lamp lamp-${state}`} aria-hidden="true" />;
}

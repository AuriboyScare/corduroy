import { CAMERA_LABELS } from '../game/cameraRig';
import { formatMoney, helpVisible, hud, loadingMessage, notices, snowLabel } from '../game/hudState';
import type { Difficulty } from '../sim/resort/layout';
import { DIFFICULTY_LABEL } from '../sim/resort/layout';
import { saveStatus } from '../game/saving';
import { GaragePanel } from './Garage';
import { LiftsPanel } from './Lifts';
import { SnowmakingPanel } from './Snowmaking';
import { StartMenu } from './StartMenu';

function Bar({ value, warnAt = 0.85 }: { value: number; warnAt?: number }) {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <div class="bar">
      <div
        class={`bar-fill${value >= 1 ? ' bad' : value >= warnAt ? ' warn' : ''}`}
        style={{ width: `${clamped * 100}%` }}
      />
    </div>
  );
}

function Row({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div class="row">
      <span class="label">{label}</span>
      <span class="value">
        {value}
        {unit && <span class="unit"> {unit}</span>}
      </span>
    </div>
  );
}

/** Trail sign: green circle, blue square, black diamond; the beginner area also uses green. */
function TrailSign({ difficulty }: { difficulty: Difficulty }) {
  return (
    <span
      class={`sign sign-${difficulty}`}
      title={DIFFICULTY_LABEL[difficulty]}
      aria-label={DIFFICULTY_LABEL[difficulty]}
    />
  );
}

const KEYS: [string, string][] = [
  ['W / S', 'Drive forward / reverse'],
  ['A / D', 'Steer (pivots when stopped)'],
  ['R / F', 'Blade up / down'],
  ['T', 'Tiller down and running / up'],
  ['V', 'Cruise control (if fitted)'],
  ['Y', 'Winch hook / unhook (600W)'],
  ['[ / ]', 'Winch tension down / up'],
  ['G', 'Garage: machines and upgrades'],
  ['L', 'Lifts: build and operate'],
  ['N', 'Snowmaking'],
  ['C', 'Camera: chase, cab, free fly'],
  ['Drag', 'Look around'],
  ['Scroll', 'Zoom (chase camera)'],
  ['F5', 'Save now'],
  ['M', 'Sound on / off'],
  ['H', 'Show or hide this list'],
];

function SaveLine() {
  const status = saveStatus.value;
  let text: string;
  if (status.state === 'unavailable') text = 'Saving unavailable in this browser';
  else if (status.state === 'saving') text = 'Saving…';
  else if (status.state === 'error') text = `Save failed: ${status.message ?? 'unknown error'}`;
  else if (status.lastSavedAt === null) text = 'Not saved yet · F5 to save';
  else {
    const seconds = Math.max(0, Math.round((performance.now() - status.lastSavedAt) / 1000));
    text = seconds < 60 ? `Saved ${seconds} s ago` : `Saved ${Math.floor(seconds / 60)} min ago`;
  }
  const bad = status.state === 'error' || status.state === 'unavailable';
  return (
    <div class="row small">
      <span class={`label save-status${bad ? ' bad' : ''}`} data-testid="save-status">
        {text}
      </span>
    </div>
  );
}

function Notices() {
  const list = notices.value;
  if (list.length === 0) return null;
  return (
    <div class="notices" aria-live="polite">
      {list.map((n) => (
        <div class={`notice${n.bonus ? ' bonus' : ''}`} key={n.id}>
          <span>{n.text}</span>
          {n.amount !== null && <span class="notice-amount">+{formatMoney(n.amount)}</span>}
        </div>
      ))}
    </div>
  );
}

export function Hud() {
  const loading = loadingMessage.value;
  if (loading) {
    return (
      <div class="loading" data-testid="loading">
        <div class="loading-title">Corduroy</div>
        <div class="loading-step">{loading}…</div>
      </div>
    );
  }
  const d = hud.value;
  if (!d) return <StartMenu />;
  return (
    <>
      <div class="panel cluster" data-testid="cluster">
        <div class="cluster-head">
          <span class="machine">{d.machine}</span>
          <span class="speed">
            {Math.abs(d.speedKmh).toFixed(1)}
            <span class="unit"> km/h{d.speedKmh < -0.5 ? ' rev' : ''}</span>
          </span>
        </div>
        {d.cruiseKmh !== null && (
          <div class="row">
            <span class="label">Cruise</span>
            <span class="value ok">{d.cruiseKmh.toFixed(1)} km/h</span>
          </div>
        )}
        <div class="row">
          <span class="label">Engine</span>
          <span class="value">
            {Math.round(d.engineRpm / 10) * 10}
            <span class="unit"> rpm</span> · {Math.round(Math.min(1.5, d.engineLoad) * 100)}
            <span class="unit">% load</span>
          </span>
        </div>
        <Bar value={d.engineLoad} />
        <div class="row">
          <span class="label">Blade</span>
          <span class="value">
            {d.bladeHeightCm >= 0 ? '+' : '−'}
            {Math.abs(d.bladeHeightCm).toFixed(0)}
            <span class="unit"> cm</span> · {Math.round(d.bladeLoadKg)}
            <span class="unit"> kg</span>
          </span>
        </div>
        <Bar value={d.bladeLoadKg / d.bladeCapacityKg} warnAt={0.8} />
        <div class="row">
          <span class="label">Tiller</span>
          <span
            class={`value ${d.tillerWorking ? (d.groomQuality > 0.7 ? 'ok' : d.groomQuality > 0 ? 'warn' : '') : ''}`}
          >
            {!d.tillerDown
              ? 'Raised'
              : !d.tillerWorking
                ? 'Lowering'
                : d.groomQuality > 0.7
                  ? 'Grooming'
                  : d.groomQuality > 0
                    ? 'Too fast'
                    : 'Down, idle'}
          </span>
        </div>
        {d.winch && (
          <div class="row">
            <span class="label">Winch</span>
            <span class={`value${d.winch.anchor && d.winch.remainingM < 15 ? ' warn' : ''}`}>
              {d.winch.anchor
                ? `${Math.round(d.winch.cableOutM)} m · ${Math.round(d.winch.forceKn)} kN`
                : 'Not hooked (Y)'}
            </span>
          </div>
        )}
        {d.winch?.anchor && (
          <div class="row">
            <span class="label">{d.winch.remainingM < 15 ? 'Cable end' : 'Tension set'}</span>
            <span class="value">{Math.round(d.winch.setting * 100)}%</span>
          </div>
        )}
        <div class="divider" />
        <Row label="Pitch / roll" value={`${d.pitchDeg.toFixed(0)}° / ${d.rollDeg.toFixed(0)}°`} />
        <Row label="Grip" value={d.grip > 0 ? d.grip.toFixed(2) : 'airborne'} />
        <Row label="Track sink" value={d.sinkCm.toFixed(0)} unit="cm" />
      </div>

      <div class="panel snow" data-testid="snow-panel">
        <div class="snow-type">{snowLabel(d.snowTopCm, d.snowDensity, d.groomedHere)}</div>
        <Row label="Top layer" value={d.snowTopCm.toFixed(0)} unit="cm" />
        <Row label="Density" value={d.snowDensity.toFixed(0)} unit="kg/m³" />
        <Row label="Base" value={d.snowBaseCm.toFixed(0)} unit="cm" />
        <div class="row">
          <span class="label">Cover</span>
          <span class={`value${d.thinCover ? ' warn' : ''}`}>
            {d.coverCm.toFixed(0)}
            <span class="unit"> cm{d.thinCover ? ' · thin' : ''}</span>
          </span>
        </div>
        <div class="divider" />
        <Row label="Air" value={d.tempC.toFixed(1)} unit="°C" />
        <Row label="Wet-bulb" value={d.wetBulbC.toFixed(1)} unit="°C" />
        <Row label="Wind" value={d.windMs.toFixed(0)} unit="m/s" />
        <Row label="Altitude" value={d.altitudeM.toFixed(0)} unit="m" />
      </div>

      <div class="panel job" data-testid="job-panel">
        <div class="job-head">
          <span class="money" data-testid="money">
            {formatMoney(d.money)}
          </span>
          <span class="label" data-testid="clock">
            {d.clock}
          </span>
        </div>
        <div class="runs">
          {d.runs.map((run) => (
            <div class="run" key={run.name}>
              <div class="run-head">
                <TrailSign difficulty={run.difficulty} />
                <span class="run-name">{run.name}</span>
                <span class="value">{Math.round(run.groomed * 100)}%</span>
              </div>
              <div class="sections" aria-hidden="true">
                {run.sections.map((s, k) => (
                  <span key={k} class={`section${s >= 0.9 ? ' done' : s > 0.05 ? ' partial' : ''}`} />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div class="row small">
          <span class="label">
            {d.atGarage ? 'At the garage · G to open' : `Garage ${(d.garageDistanceM / 1000).toFixed(2)} km`}
          </span>
        </div>
        <SaveLine />
        <div class="row small">
          <span class="label">Camera: {CAMERA_LABELS[d.camera]}</span>
          <span class="label">
            {d.muted ? 'Sound off · ' : ''}
            {d.fps.toFixed(0)} fps
          </span>
        </div>
      </div>

      <Notices />

      {helpVisible.value && (
        <div class="panel help" data-testid="help">
          {KEYS.map(([key, action]) => (
            <div class="help-row" key={key}>
              <kbd>{key}</kbd>
              <span>{action}</span>
            </div>
          ))}
          {d.camera === 'free' && (
            <div class="help-note">
              Free fly: W A S D move, Q / E down / up, Shift faster. The machine is parked.
            </div>
          )}
        </div>
      )}

      <GaragePanel />
      <LiftsPanel />
      <SnowmakingPanel />
    </>
  );
}

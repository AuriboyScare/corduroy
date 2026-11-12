import { CAMERA_LABELS } from '../game/cameraRig';
import { helpVisible, hud, loadingMessage, snowLabel } from '../game/hudState';

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

const KEYS: [string, string][] = [
  ['W / S', 'Drive forward / reverse'],
  ['A / D', 'Steer (pivots when stopped)'],
  ['R / F', 'Blade up / down'],
  ['T', 'Tiller down and running / up'],
  ['C', 'Camera: chase, cab, free fly'],
  ['Drag', 'Look around'],
  ['Scroll', 'Zoom (chase camera)'],
  ['H', 'Show or hide this list'],
];

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
  if (!d) return null;
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
        <div class="row">
          <span class="label">Engine load</span>
          <span class="value">{Math.round(Math.min(1.5, d.engineLoad) * 100)}%</span>
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
        <Row label="Altitude" value={d.altitudeM.toFixed(0)} unit="m" />
      </div>

      <div class="panel job" data-testid="job-panel">
        <div class="row">
          <span class="label">Piste groomed</span>
          <span class="value">{(d.pisteGroomed * 100).toFixed(1)}%</span>
        </div>
        <Bar value={d.pisteGroomed} warnAt={2} />
        <div class="row small">
          <span class="label">Camera: {CAMERA_LABELS[d.camera]}</span>
          <span class="label">{d.fps.toFixed(0)} fps</span>
        </div>
      </div>

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
    </>
  );
}

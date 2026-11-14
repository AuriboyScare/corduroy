import { CAMERA_LABELS } from '../game/cameraRig';
import {
  formatMoney,
  helpVisible,
  hud,
  loadingMessage,
  notices,
  snowLabel,
  type Notice,
} from '../game/hudState';
import { saveStatus } from '../game/saving';
import type { Difficulty } from '../sim/resort/layout';
import { DIFFICULTY_LABEL } from '../sim/resort/layout';
import { GaragePanel } from './Garage';
import { Icon, LogoMark, type IconName } from './icons';
import { Inclinometer, Lamp, LoadLamps, SnowProfile, Tachometer } from './instruments';
import { LiftsPanel } from './Lifts';
import { MountainScene } from './MountainScene';
import { SnowmakingPanel } from './Snowmaking';
import { StartMenu } from './StartMenu';

function Row({ label, value, unit, tone }: { label: string; value: string; unit?: string; tone?: string }) {
  return (
    <div class="row">
      <span class="label">{label}</span>
      <span class={`value${tone ? ` ${tone}` : ''}`}>
        {value}
        {unit && <span class="unit"> {unit}</span>}
      </span>
    </div>
  );
}

/** Trail sign: green circle, blue square, black diamond; the beginner area also uses green. */
export function TrailSign({ difficulty }: { difficulty: Difficulty }) {
  return (
    <span
      class={`sign sign-${difficulty}`}
      title={DIFFICULTY_LABEL[difficulty]}
      aria-label={DIFFICULTY_LABEL[difficulty]}
    />
  );
}

const KEY_GROUPS: { title: string; keys: [string[], string][] }[] = [
  {
    title: 'Drive',
    keys: [
      [['W', 'S'], 'Forward / reverse'],
      [['A', 'D'], 'Steer (pivots when stopped)'],
      [['V'], 'Cruise control (if fitted)'],
    ],
  },
  {
    title: 'Implements',
    keys: [
      [['R', 'F'], 'Blade up / down'],
      [['T'], 'Tiller down and running / up'],
      [['Y'], 'Winch hook / unhook (600W)'],
      [['[', ']'], 'Winch tension down / up'],
    ],
  },
  {
    title: 'Resort',
    keys: [
      [['G'], 'Garage: machines and upgrades'],
      [['L'], 'Lifts: build and operate'],
      [['N'], 'Snowmaking'],
    ],
  },
  {
    title: 'View and game',
    keys: [
      [['C'], 'Camera: chase, cab, free fly'],
      [['Drag'], 'Look around'],
      [['Scroll'], 'Zoom (chase camera)'],
      [['F5'], 'Save now'],
      [['M'], 'Sound on / off'],
      [['H'], 'Show or hide this list'],
    ],
  },
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
    <div class={`foot-line${bad ? ' bad' : ''}`}>
      <Icon name="disk" size={14} />
      <span class="save-status" data-testid="save-status">
        {text}
      </span>
    </div>
  );
}

function noticeIcon(n: Notice): IconName {
  if (n.bonus) return 'bonus';
  if (n.text.startsWith('Grooming')) return 'corduroy';
  if (n.text === 'Lift tickets') return 'ticket';
  if (n.text.startsWith('Winch')) return 'winch';
  if (n.text === 'Game saved') return 'disk';
  return 'snowflake';
}

function Notices() {
  const list = notices.value;
  if (list.length === 0) return null;
  return (
    <div class="notices" aria-live="polite">
      {list.map((n) => (
        <div class={`notice${n.bonus ? ' bonus' : ''}`} key={n.id}>
          <span class="notice-icon">
            <Icon name={noticeIcon(n)} size={16} />
          </span>
          <span class="notice-text">{n.text}</span>
          {n.amount !== null && <span class="notice-amount">+{formatMoney(n.amount)}</span>}
        </div>
      ))}
    </div>
  );
}

function tillerState(d: { tillerDown: boolean; tillerWorking: boolean; groomQuality: number }): {
  text: string;
  lamp: 'on' | 'off' | 'warn';
} {
  if (!d.tillerDown) return { text: 'Raised', lamp: 'off' };
  if (!d.tillerWorking) return { text: 'Lowering', lamp: 'warn' };
  if (d.groomQuality > 0.7) return { text: 'Grooming', lamp: 'on' };
  if (d.groomQuality > 0) return { text: 'Too fast', lamp: 'warn' };
  return { text: 'Down, idle', lamp: 'off' };
}

/** Logo, progress stripe and the current step while the world is being built. */
function Loading({ step }: { step: string }) {
  return (
    <div class="loading" data-testid="loading">
      <MountainScene />
      <div class="loading-card">
        <div class="brand">
          <LogoMark size={52} />
          <div>
            <div class="brand-name">Corduroy</div>
            <div class="brand-sub">Mountain operations</div>
          </div>
        </div>
        <div class="loading-bar" aria-hidden="true">
          <span />
        </div>
        <div class="loading-step">{step}…</div>
      </div>
    </div>
  );
}

export function Hud() {
  const loading = loadingMessage.value;
  if (loading) return <Loading step={loading} />;
  const d = hud.value;
  if (!d) return <StartMenu />;
  const tiller = tillerState(d);
  const bladeFill = Math.min(1, d.bladeLoadKg / d.bladeCapacityKg);
  const overall = d.runs.length > 0 ? d.runs.reduce((n, r) => n + r.groomed, 0) / d.runs.length : 0;
  return (
    <>
      <div class="panel cluster" data-testid="cluster">
        <div class="cluster-head">
          <span class="plate">
            <Icon name="tracks" size={15} />
            <span class="machine">{d.machine}</span>
          </span>
          {d.cruiseKmh !== null && (
            <span class="chip ok">
              <Icon name="cruise" size={13} /> Cruise {d.cruiseKmh.toFixed(1)}
            </span>
          )}
        </div>
        <div class="cluster-main">
          <Tachometer rpm={d.engineRpm} />
          <div class="speedo">
            <div class="speed">
              <span class="speed-value">{Math.abs(d.speedKmh).toFixed(1)}</span>
              <span class="speed-unit">
                km/h
                {d.speedKmh < -0.5 && <span class="chip warn">rev</span>}
              </span>
            </div>
            <div class="load">
              <span class="cap-label">Load</span>
              <LoadLamps load={d.engineLoad} />
              <span class={`load-value${d.engineLoad >= 1 ? ' bad' : d.engineLoad >= 0.85 ? ' warn' : ''}`}>
                {Math.round(Math.min(1.5, d.engineLoad) * 100)}%
              </span>
            </div>
          </div>
        </div>
        <div class="implements">
          <div class="impl">
            <Icon name="blade" size={16} />
            <span class="cap-label">Blade</span>
            <span class="impl-value">
              {d.bladeHeightCm >= 0 ? '+' : '−'}
              {Math.abs(d.bladeHeightCm).toFixed(0)}
              <span class="unit"> cm</span>
            </span>
            <span class="impl-meter" title={`${Math.round(d.bladeLoadKg)} kg on the blade`}>
              <span class="mini-bar">
                <span
                  class={bladeFill >= 1 ? 'bad' : bladeFill >= 0.8 ? 'warn' : ''}
                  style={{ width: `${bladeFill * 100}%` }}
                />
              </span>
              <span class="impl-kg">
                {Math.round(d.bladeLoadKg)}
                <span class="unit"> kg</span>
              </span>
            </span>
          </div>
          <div class="impl">
            <Icon name="tiller" size={16} />
            <span class="cap-label">Tiller</span>
            <span class={`impl-state ${tiller.lamp}`}>
              <Lamp state={tiller.lamp} />
              {tiller.text}
            </span>
          </div>
          {d.winch && (
            <div class="impl">
              <Icon name="winch" size={16} />
              <span class="cap-label">Winch</span>
              <span class={`impl-state${d.winch.anchor && d.winch.remainingM < 15 ? ' warn' : ''}`}>
                {d.winch.anchor ? (
                  <>
                    {Math.round(d.winch.cableOutM)} m · {Math.round(d.winch.forceKn)} kN ·{' '}
                    {d.winch.remainingM < 15 ? 'cable end' : 'tension'} {Math.round(d.winch.setting * 100)}%
                  </>
                ) : (
                  'Not hooked (Y)'
                )}
              </span>
            </div>
          )}
        </div>
        <div class="cluster-foot">
          <Inclinometer pitchDeg={d.pitchDeg} rollDeg={d.rollDeg} />
          <div class="foot-stats">
            <div class="foot-stat">
              <Icon name="grip" size={14} />
              <span class="cap-label">Grip</span>
              <span class="value">{d.grip > 0 ? d.grip.toFixed(2) : 'airborne'}</span>
            </div>
            <div class="foot-stat">
              <Icon name="sink" size={14} />
              <span class="cap-label">Sink</span>
              <span class="value">
                {d.sinkCm.toFixed(0)}
                <span class="unit"> cm</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      <div class="panel snow" data-testid="snow-panel">
        <div class="panel-title">
          <Icon name={d.groomedHere ? 'corduroy' : 'snowflake'} size={16} />
          <span class="snow-type">{snowLabel(d.snowTopCm, d.snowDensity, d.groomedHere)}</span>
        </div>
        <div class="snow-body">
          <SnowProfile
            baseCm={d.snowBaseCm}
            topCm={d.snowTopCm}
            density={d.snowDensity}
            groomed={d.groomedHere}
          />
          <div class="snow-rows">
            <Row label="Top layer" value={d.snowTopCm.toFixed(0)} unit="cm" />
            <Row label="Density" value={d.snowDensity.toFixed(0)} unit="kg/m³" />
            <Row label="Base" value={d.snowBaseCm.toFixed(0)} unit="cm" />
            <Row
              label="Cover"
              value={d.coverCm.toFixed(0)}
              unit={d.thinCover ? 'cm · thin' : 'cm'}
              {...(d.thinCover ? { tone: 'warn' } : {})}
            />
          </div>
        </div>
        <div class="wx">
          <div class="wx-cell" title="Air temperature">
            <Icon name="thermometer" size={15} />
            <span class="value">
              {d.tempC.toFixed(1)}
              <span class="unit">°C</span>
            </span>
          </div>
          <div class="wx-cell" title="Wet-bulb temperature: below −2 °C the snow guns work">
            <Icon name="droplet" size={15} />
            <span class="value">
              {d.wetBulbC.toFixed(1)}
              <span class="unit">°C wb</span>
            </span>
          </div>
          <div class="wx-cell" title="Wind">
            <Icon name="wind" size={15} />
            <span class="value">
              {d.windMs.toFixed(0)}
              <span class="unit">m/s</span>
            </span>
          </div>
          <div class="wx-cell" title="Altitude">
            <Icon name="peak" size={15} />
            <span class="value">
              {d.altitudeM.toFixed(0)}
              <span class="unit">m</span>
            </span>
          </div>
        </div>
      </div>

      <div class="panel board" data-testid="job-panel">
        <div class="board-head">
          <span class="money" data-testid="money">
            {formatMoney(d.money)}
          </span>
          <span class={`clock${d.night ? ' night' : ''}`}>
            <Icon name={d.night ? 'moon' : 'sun'} size={15} />
            <span data-testid="clock">{d.clock}</span>
          </span>
        </div>
        <div class="board-title">
          <span>Trail report</span>
          <span class="board-overall">{Math.round(overall * 100)}% groomed</span>
        </div>
        <div class="runs">
          {d.runs.map((run) => (
            <div class={`run${run.groomed >= 0.9 ? ' done' : ''}`} key={run.name}>
              <div class="run-head">
                <TrailSign difficulty={run.difficulty} />
                <span class="run-name">{run.name}</span>
                {run.groomed >= 0.9 && <Icon name="corduroy" size={13} class="run-groomed" />}
                <span class="run-pct">{Math.round(run.groomed * 100)}%</span>
              </div>
              <div class="sections" aria-hidden="true">
                {run.sections.map((s, k) => (
                  <span key={k} class={`section${s >= 0.9 ? ' done' : s > 0.05 ? ' partial' : ''}`} />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div class="board-foot">
          <div class={`foot-line${d.atGarage ? ' ok' : ''}`}>
            <Icon name="garage" size={14} />
            <span>
              {d.atGarage
                ? 'At the garage · G to open'
                : `Garage ${(d.garageDistanceM / 1000).toFixed(2)} km`}
            </span>
          </div>
          <SaveLine />
          <div class="foot-line">
            <Icon name="camera" size={14} />
            <span>Camera: {CAMERA_LABELS[d.camera]}</span>
            <span class="foot-right">
              {d.muted && <Icon name="mute" size={14} />}
              {d.fps.toFixed(0)} fps
            </span>
          </div>
        </div>
      </div>

      <Notices />

      {helpVisible.value ? (
        <div class="panel help" data-testid="help">
          {KEY_GROUPS.map((group) => (
            <div class="help-group" key={group.title}>
              <div class="help-title">{group.title}</div>
              {group.keys.map(([keys, action]) => (
                <div class="help-row" key={action}>
                  <span class="keys">
                    {keys.map((k) => (
                      <kbd key={k}>{k}</kbd>
                    ))}
                  </span>
                  <span>{action}</span>
                </div>
              ))}
            </div>
          ))}
          {d.camera === 'free' && (
            <div class="help-note">
              Free fly: W A S D move, Q / E down / up, Shift faster. The machine is parked.
            </div>
          )}
        </div>
      ) : (
        <div class="help-hint">
          <kbd>H</kbd> Controls
        </div>
      )}

      <GaragePanel />
      <LiftsPanel />
      <SnowmakingPanel />
    </>
  );
}

import {
  formatMoney,
  snowmakingActions,
  snowmakingMessage,
  snowmakingOpen,
  snowmakingView,
} from '../game/hudState';
import { WET_BULB_FULL_C, WET_BULB_START_C } from '../sim/snowmaking';
import { Icon } from './icons';
import { Modal, ResultLine } from './Modal';

const MODES = [
  ['off', 'Off'],
  ['auto', 'Auto'],
  ['on', 'On'],
] as const;

/** Wet-bulb scale on the gauge, warm on the left. */
const SCALE_WARM_C = 2;
const SCALE_COLD_C = -14;
const along = (c: number) =>
  `${Math.max(0, Math.min(100, ((SCALE_WARM_C - c) / (SCALE_WARM_C - SCALE_COLD_C)) * 100))}%`;

/** Where the wet-bulb sits against the snowmaking window: none, partial, full output. */
function WetBulbGauge({ wetBulbC }: { wetBulbC: number }) {
  return (
    <div class="wetbulb" aria-label={`Wet-bulb ${wetBulbC.toFixed(1)} °C`}>
      <div class="wetbulb-scale">
        <span class="wb-zone warm" style={{ left: 0, width: along(WET_BULB_START_C) }} />
        <span
          class="wb-zone ramp"
          style={{
            left: along(WET_BULB_START_C),
            width: `calc(${along(WET_BULB_FULL_C)} - ${along(WET_BULB_START_C)})`,
          }}
        />
        <span class="wb-zone full" style={{ left: along(WET_BULB_FULL_C), right: 0 }} />
        <span class="wb-marker" style={{ left: along(wetBulbC) }} />
      </div>
      <div class="wetbulb-ticks">
        <span style={{ left: along(WET_BULB_START_C) }}>{WET_BULB_START_C}°</span>
        <span style={{ left: along(WET_BULB_FULL_C) }}>{WET_BULB_FULL_C}°</span>
      </div>
    </div>
  );
}

/** Snowmaking: install guns on runs and decide when they run. */
export function SnowmakingPanel() {
  const view = snowmakingView.value;
  if (!snowmakingOpen.value || !view) return null;
  const affordable = (price: number) => view.mode === 'sandbox' || view.money >= price;
  return (
    <Modal
      icon="snowgun"
      title="Snowmaking"
      subtitle={`Guns make snow below a wet-bulb of ${WET_BULB_START_C} °C and run flat out below ${WET_BULB_FULL_C} °C. Auto runs them when it is cold enough and the run still needs cover. Push the piles out with the blade, then groom.`}
      money={view.money}
      onClose={() => (snowmakingOpen.value = false)}
      closeLabel="Close snowmaking (N or Esc)"
      testId="snowmaking"
    >
      <div class="console-list">
        {view.runs.map((run) => (
          <div
            class={`console-card${run.installed ? '' : ' unbuilt'}`}
            key={run.runId}
            data-testid={`snowmaking-${run.runId}`}
          >
            <div class="console-head">
              <span class="console-icon">
                <Icon name="snowgun" size={26} />
              </span>
              <div class="console-titles">
                <div class="console-name">{run.name}</div>
                <div class="console-facts">
                  <span>{run.guns} gun positions</span>
                  <span>
                    <Icon name="layers" size={13} /> good cover on {Math.round(run.cover * 100)}%
                  </span>
                </div>
              </div>
              {run.installed ? (
                <div class="selector" role="group" aria-label={`${run.name} snowmaking mode`}>
                  {MODES.map(([mode, label]) => (
                    <button
                      key={mode}
                      class={run.mode === mode ? `active ${mode}` : ''}
                      aria-pressed={run.mode === mode}
                      onClick={() => snowmakingActions.setMode(run.runId, mode)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              ) : (
                <button
                  class="buy"
                  disabled={!affordable(run.price)}
                  onClick={() => snowmakingActions.install(run.runId)}
                >
                  Install for {formatMoney(run.price)}
                </button>
              )}
            </div>
            <div class="snow-row">
              <div class="snow-cell">
                <span class="cell-label">
                  <Icon name="droplet" size={13} /> Wet-bulb {run.wetBulbC.toFixed(1)} °C
                </span>
                <WetBulbGauge wetBulbC={run.wetBulbC} />
              </div>
              <div class="snow-cell">
                <span class="cell-label">Cover</span>
                <span class="mini-bar wide">
                  <span style={{ width: `${Math.round(run.cover * 100)}%` }} />
                </span>
              </div>
              {run.installed && (
                <div class="snow-cell">
                  <span class="cell-label">
                    {run.running} of {run.guns} guns running
                  </span>
                  <span class="gun-lamps" aria-hidden="true">
                    {Array.from({ length: run.guns }, (_, k) => (
                      <span key={k} class={`gun-lamp${k < run.running ? ' on' : ''}`} />
                    ))}
                  </span>
                </div>
              )}
            </div>
            {run.installed && (
              <div class="console-facts output">
                <span>
                  <Icon name="snowflake" size={13} /> {Math.round(run.outputM3h)} m³ of snow an hour
                </span>
                <span>
                  <Icon name="water" size={13} /> {formatMoney(run.costPerHour)} an hour in water and power
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
      <div class="modal-foot">Spent on snowmaking so far: {formatMoney(view.spent)}</div>
      <ResultLine message={snowmakingMessage.value} />
    </Modal>
  );
}

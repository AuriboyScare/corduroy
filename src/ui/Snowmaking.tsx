import {
  formatMoney,
  snowmakingActions,
  snowmakingMessage,
  snowmakingOpen,
  snowmakingView,
} from '../game/hudState';

const MODES = [
  ['off', 'Off'],
  ['auto', 'Auto'],
  ['on', 'On'],
] as const;

/** Snowmaking: install guns on runs and decide when they run. */
export function SnowmakingPanel() {
  const view = snowmakingView.value;
  if (!snowmakingOpen.value || !view) return null;
  const message = snowmakingMessage.value;
  const affordable = (price: number) => view.mode === 'sandbox' || view.money >= price;
  return (
    <div class="garage-backdrop">
      <div class="panel garage" data-testid="snowmaking" role="dialog" aria-label="Snowmaking">
        <div class="garage-head">
          <div>
            <div class="garage-title">Snowmaking</div>
            <div class="label">
              Guns make snow below a wet-bulb of −2 °C, best below −9 °C. Auto runs them when it is cold
              enough and the run still needs cover. Push the piles out with the blade, then groom.
            </div>
          </div>
          <div class="garage-money">{formatMoney(view.money)}</div>
          <button
            class="close"
            onClick={() => (snowmakingOpen.value = false)}
            aria-label="Close snowmaking (N or Esc)"
          >
            ×
          </button>
        </div>
        <div class="lift-list">
          {view.runs.map((run) => (
            <div class="lift-card" key={run.runId} data-testid={`snowmaking-${run.runId}`}>
              <div class="lift-head">
                <div>
                  <div class="fleet-name">{run.name}</div>
                  <div class="fleet-status">
                    {run.guns} gun positions · cover good on {Math.round(run.cover * 100)}% of the run ·
                    wet-bulb {run.wetBulbC.toFixed(1)} °C
                  </div>
                </div>
                {run.installed ? (
                  <div class="mode-buttons" role="group" aria-label={`${run.name} snowmaking mode`}>
                    {MODES.map(([mode, label]) => (
                      <button
                        key={mode}
                        class={run.mode === mode ? 'primary' : ''}
                        aria-pressed={run.mode === mode}
                        onClick={() => snowmakingActions.setMode(run.runId, mode)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <button
                    disabled={!affordable(run.price)}
                    onClick={() => snowmakingActions.install(run.runId)}
                  >
                    Install for {formatMoney(run.price)}
                  </button>
                )}
              </div>
              {run.installed && (
                <div class="lift-serves">
                  <span>
                    {run.running} of {run.guns} guns running
                  </span>
                  <span>{Math.round(run.outputM3h)} m³ of snow an hour</span>
                  <span>{formatMoney(run.costPerHour)} an hour in water and power</span>
                </div>
              )}
            </div>
          ))}
        </div>
        <div class="row small">
          <span class="label">Spent on snowmaking so far: {formatMoney(view.spent)}</span>
        </div>
        {message && (
          <div class={`garage-message ${message.ok ? 'ok' : 'bad'}`} role="status">
            {message.text}
          </div>
        )}
      </div>
    </div>
  );
}

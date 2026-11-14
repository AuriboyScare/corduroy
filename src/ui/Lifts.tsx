import { formatMoney, liftActions, liftsMessage, liftsOpen, liftsView } from '../game/hudState';

const STATE_LABEL = { running: 'Running', stopped: 'Stopped', emergency: 'Emergency stop' } as const;

/** Lift operations: build lifts, start and stop them, set their speed, see who is riding. */
export function LiftsPanel() {
  const view = liftsView.value;
  if (!liftsOpen.value || !view) return null;
  const message = liftsMessage.value;
  const affordable = (price: number) => view.mode === 'sandbox' || view.money >= price;
  return (
    <div class="garage-backdrop">
      <div class="panel garage" data-testid="lifts" role="dialog" aria-label="Lift operations">
        <div class="garage-head">
          <div>
            <div class="garage-title">Lift operations</div>
            <div class="label">
              Riders follow the grooming: well-groomed runs fill the lifts that serve them.
            </div>
          </div>
          <div class="garage-money">{formatMoney(view.money)}</div>
          <button
            class="close"
            onClick={() => (liftsOpen.value = false)}
            aria-label="Close lift operations (L or Esc)"
          >
            ×
          </button>
        </div>
        <div class="lift-list">
          {view.lifts.map((lift) => (
            <div class="lift-card" key={lift.id} data-testid={`lift-${lift.id}`}>
              <div class="lift-head">
                <div>
                  <div class="fleet-name">{lift.name}</div>
                  <div class="fleet-status">
                    {lift.kind} · {Math.round(lift.lengthM)} m · {lift.towers} towers ·{' '}
                    {Math.round(lift.capacityPerHour)} riders/h max
                  </div>
                </div>
                {lift.built ? (
                  <span class={`lift-state ${lift.state}`}>{STATE_LABEL[lift.state]}</span>
                ) : (
                  <button disabled={!affordable(lift.price)} onClick={() => liftActions.buy(lift.id)}>
                    Build for {formatMoney(lift.price)}
                  </button>
                )}
              </div>
              <div class="lift-serves">
                {lift.serves.map((run) => (
                  <span key={run.name}>
                    {run.name} {Math.round(run.groomed * 100)}% groomed
                  </span>
                ))}
              </div>
              {lift.built && (
                <div class="lift-controls">
                  <span class="value">
                    {lift.speedKmh.toFixed(1)} <span class="unit">km/h</span> ·{' '}
                    {Math.round(lift.ridersPerHour)} <span class="unit">riders/h</span>
                  </span>
                  <label class="lift-speed">
                    <span class="label">Speed</span>
                    <input
                      type="range"
                      min={25}
                      max={100}
                      step={5}
                      value={Math.round(lift.speedSetting * 100)}
                      onInput={(e) =>
                        liftActions.control(
                          lift.id,
                          'speed',
                          Number((e.target as HTMLInputElement).value) / 100,
                        )
                      }
                    />
                    <span class="value">{Math.round(lift.speedSetting * 100)}%</span>
                  </label>
                  {lift.state === 'running' ? (
                    <button onClick={() => liftActions.control(lift.id, 'stop')}>Stop</button>
                  ) : (
                    <button
                      class="primary"
                      disabled={lift.state === 'emergency'}
                      onClick={() => liftActions.control(lift.id, 'start')}
                    >
                      Start
                    </button>
                  )}
                  <button
                    class="danger"
                    disabled={lift.state !== 'running'}
                    onClick={() => liftActions.control(lift.id, 'emergency')}
                  >
                    Emergency stop
                  </button>
                </div>
              )}
            </div>
          ))}
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

import { formatMoney, liftActions, liftsMessage, liftsOpen, liftsView } from '../game/hudState';
import { Icon, LIFT_ICON } from './icons';
import { Lamp } from './instruments';
import { Modal, ResultLine } from './Modal';

const STATE_LABEL = { running: 'Running', stopped: 'Stopped', emergency: 'Emergency stop' } as const;
const STATE_LAMP = { running: 'on', stopped: 'off', emergency: 'alarm' } as const;

/** Lift operations: build lifts, start and stop them, set their speed, see who is riding. */
export function LiftsPanel() {
  const view = liftsView.value;
  if (!liftsOpen.value || !view) return null;
  const affordable = (price: number) => view.mode === 'sandbox' || view.money >= price;
  return (
    <Modal
      icon="chair"
      title="Lift operations"
      subtitle="Riders follow the grooming: well-groomed runs fill the lifts that serve them."
      money={view.money}
      onClose={() => (liftsOpen.value = false)}
      closeLabel="Close lift operations (L or Esc)"
      testId="lifts"
    >
      <div class="console-list">
        {view.lifts.map((lift) => (
          <div
            class={`console-card${lift.built ? '' : ' unbuilt'}${lift.state === 'emergency' ? ' alarm' : ''}`}
            key={lift.id}
            data-testid={`lift-${lift.id}`}
          >
            <div class="console-head">
              <span class="console-icon">
                <Icon name={LIFT_ICON[lift.type]} size={26} />
              </span>
              <div class="console-titles">
                <div class="console-name">{lift.name}</div>
                <div class="console-facts">
                  <span>{lift.kind}</span>
                  <span>
                    <Icon name="ruler" size={13} /> {Math.round(lift.lengthM)} m
                  </span>
                  <span>
                    <Icon name="tower" size={13} /> {lift.towers} towers
                  </span>
                  <span>
                    <Icon name="riders" size={13} /> {Math.round(lift.capacityPerHour)}/h max
                  </span>
                </div>
              </div>
              {lift.built ? (
                <span class={`state-plate ${lift.state}`}>
                  <Lamp state={STATE_LAMP[lift.state]} />
                  {STATE_LABEL[lift.state]}
                </span>
              ) : (
                <button
                  class="buy"
                  disabled={!affordable(lift.price)}
                  onClick={() => liftActions.buy(lift.id)}
                >
                  Build for {formatMoney(lift.price)}
                </button>
              )}
            </div>
            <div class="serves">
              <span class="serves-label">Serves</span>
              {lift.serves.map((run) => (
                <span class="serves-run" key={run.name}>
                  {run.name}
                  <span class="mini-bar">
                    <span style={{ width: `${Math.round(run.groomed * 100)}%` }} />
                  </span>
                  <span class="serves-pct">{Math.round(run.groomed * 100)}% groomed</span>
                </span>
              ))}
            </div>
            {lift.built && (
              <div class="console-controls">
                <div class="readout">
                  <span class="readout-value">{lift.speedKmh.toFixed(1)}</span>
                  <span class="readout-unit">km/h</span>
                </div>
                <div class="readout">
                  <span class="readout-value">{Math.round(lift.ridersPerHour)}</span>
                  <span class="readout-unit">riders/h</span>
                </div>
                <label class="slider">
                  <span class="slider-label">Speed</span>
                  <input
                    type="range"
                    min={25}
                    max={100}
                    step={5}
                    value={Math.round(lift.speedSetting * 100)}
                    style={{ '--fill': `${((lift.speedSetting * 100 - 25) / 75) * 100}%` }}
                    onInput={(e) =>
                      liftActions.control(
                        lift.id,
                        'speed',
                        Number((e.target as HTMLInputElement).value) / 100,
                      )
                    }
                  />
                  <span class="slider-value">{Math.round(lift.speedSetting * 100)}%</span>
                </label>
                <div class="drive-buttons">
                  {lift.state === 'running' ? (
                    <button onClick={() => liftActions.control(lift.id, 'stop')}>Stop</button>
                  ) : (
                    <button
                      class="go"
                      disabled={lift.state === 'emergency'}
                      onClick={() => liftActions.control(lift.id, 'start')}
                    >
                      Start
                    </button>
                  )}
                  <button
                    class="estop"
                    disabled={lift.state !== 'running'}
                    onClick={() => liftActions.control(lift.id, 'emergency')}
                    aria-label="Emergency stop"
                    title="Emergency stop"
                  >
                    <span class="estop-cap">Stop</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      <ResultLine message={liftsMessage.value} />
    </Modal>
  );
}

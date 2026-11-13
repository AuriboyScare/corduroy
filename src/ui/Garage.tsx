import {
  formatMoney,
  garageActions,
  garageMessage,
  garageOpen,
  garageSelected,
  garageView,
} from '../game/hudState';

function Pips({ level, max }: { level: number; max: number }) {
  return (
    <span class="pips" aria-label={`Level ${level} of ${max}`}>
      {Array.from({ length: max }, (_, k) => (
        <span key={k} class={`pip${k < level ? ' on' : ''}`} />
      ))}
    </span>
  );
}

/** The machine garage: the fleet, upgrades for the selected machine, and the dealer. */
export function GaragePanel() {
  const view = garageView.value;
  if (!garageOpen.value || !view) return null;
  const selected = view.fleet.find((m) => m.uid === garageSelected.value) ?? view.fleet[0]!;
  const affordable = (price: number) => view.mode === 'sandbox' || view.money >= price;
  const message = garageMessage.value;
  // Upgrades and swaps happen with both machines parked at the garage.
  const workshopOpen = view.serviceable && selected.atGarage;

  return (
    <div class="garage-backdrop">
      <div class="panel garage" data-testid="garage" role="dialog" aria-label="Machine garage">
        <div class="garage-head">
          <div>
            <div class="garage-title">Machine garage</div>
            {!view.serviceable && (
              <div class="garage-warning">
                Your machine is not parked here. Drive to the garage and stop to service it.
              </div>
            )}
          </div>
          <div class="garage-money" data-testid="garage-money">
            {formatMoney(view.money)}
          </div>
          <button
            class="close"
            onClick={() => (garageOpen.value = false)}
            aria-label="Close garage (G or Esc)"
          >
            ×
          </button>
        </div>

        <div class="garage-body">
          <section class="fleet">
            <h2>Your fleet</h2>
            {view.fleet.map((machine) => {
              const fitted = machine.upgrades.reduce((n, u) => n + u.level, 0);
              const total = machine.upgrades.reduce((n, u) => n + u.maxLevel, 0);
              return (
                <button
                  key={machine.uid}
                  class={`fleet-card${machine.uid === selected.uid ? ' selected' : ''}`}
                  onClick={() => (garageSelected.value = machine.uid)}
                  data-testid={`fleet-${machine.modelId}`}
                >
                  <span class="fleet-name">{machine.name}</span>
                  <span class="fleet-status">
                    {machine.driving
                      ? 'Driving'
                      : machine.atGarage
                        ? 'Parked at garage'
                        : 'Out on the mountain'}
                  </span>
                  <span class="fleet-upgrades">
                    {fitted} of {total} upgrade levels
                  </span>
                </button>
              );
            })}
          </section>

          <section class="upgrades">
            <div class="upgrades-head">
              <h2>{selected.name}</h2>
              {!selected.driving && (
                <button
                  class="primary"
                  disabled={!workshopOpen}
                  onClick={() => garageActions.drive(selected.uid)}
                  data-testid="drive"
                >
                  Drive this machine
                </button>
              )}
            </div>
            <div class="upgrade-list">
              {selected.upgrades.map((upgrade) => {
                const maxed = upgrade.price === null;
                return (
                  <div class="upgrade" key={upgrade.id} data-testid={`upgrade-${upgrade.id}`}>
                    <div class="upgrade-text">
                      <div class="upgrade-name">
                        {upgrade.name} <Pips level={upgrade.level} max={upgrade.maxLevel} />
                      </div>
                      <div class="upgrade-summary">{upgrade.summary}</div>
                    </div>
                    {maxed ? (
                      <span class="maxed">Fully upgraded</span>
                    ) : (
                      <button
                        disabled={!workshopOpen || !affordable(upgrade.price!)}
                        onClick={() => garageActions.buyUpgrade(selected.uid, upgrade.id)}
                      >
                        {view.mode === 'sandbox' ? 'Fit' : formatMoney(upgrade.price!)}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {view.mode === 'career' && (
          <section class="dealer">
            <h2>Dealer</h2>
            <div class="dealer-list">
              {view.dealer.map((offer) => (
                <div class="offer" key={offer.id} data-testid={`offer-${offer.id}`}>
                  <div class="offer-name">
                    {offer.name}
                    {offer.owned > 0 && <span class="owned"> · {offer.owned} owned</span>}
                  </div>
                  <div class="offer-stats">{offer.stats}</div>
                  <div class="offer-text">{offer.description}</div>
                  <button
                    disabled={!affordable(offer.price)}
                    onClick={() => garageActions.buyMachine(offer.id)}
                  >
                    Buy for {formatMoney(offer.price)}
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {message && (
          <div
            class={`garage-message ${message.ok ? 'ok' : 'bad'}`}
            role="status"
            data-testid="garage-message"
          >
            {message.text}
          </div>
        )}
      </div>
    </div>
  );
}

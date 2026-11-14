import {
  formatMoney,
  garageActions,
  garageMessage,
  garageOpen,
  garageSelected,
  garageView,
  type MachineSpecs,
} from '../game/hudState';
import { Icon, MachineSilhouette, UPGRADE_ICON } from './icons';
import { Lamp, StatBar } from './instruments';
import { Modal, ResultLine, SectionHead } from './Modal';

function Pips({ level, max }: { level: number; max: number }) {
  return (
    <span class="pips" aria-label={`Level ${level} of ${max}`}>
      {Array.from({ length: max }, (_, k) => (
        <span key={k} class={`pip${k < level ? ' on' : ''}`} />
      ))}
    </span>
  );
}

/** Fixed scales so machines compare across the fleet and the dealer. */
const SPEC_ROWS: { key: keyof MachineSpecs; label: string; unit: string; max: number; digits: number }[] = [
  { key: 'powerKw', label: 'Power', unit: 'kW', max: 560, digits: 0 },
  { key: 'tillerM', label: 'Tiller', unit: 'm', max: 8, digits: 1 },
  { key: 'bladeM', label: 'Blade', unit: 'm', max: 8, digits: 1 },
  { key: 'topKmh', label: 'Top speed', unit: 'km/h', max: 30, digits: 0 },
  { key: 'winchKn', label: 'Winch', unit: 'kN', max: 60, digits: 0 },
];

function SpecSheet({ specs, stock }: { specs: MachineSpecs; stock?: MachineSpecs | undefined }) {
  return (
    <div class="specs">
      {SPEC_ROWS.filter((row) => row.key !== 'winchKn' || specs.winchKn > 0).map((row) => (
        <div class="spec" key={row.key}>
          <span class="spec-label">{row.label}</span>
          <StatBar value={specs[row.key]} max={row.max} stock={stock?.[row.key]} />
          <span class="spec-value">
            {specs[row.key].toFixed(row.digits)}
            <span class="unit"> {row.unit}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/** The machine garage: the fleet, upgrades for the selected machine, and the dealer. */
export function GaragePanel() {
  const view = garageView.value;
  if (!garageOpen.value || !view) return null;
  const selected = view.fleet.find((m) => m.uid === garageSelected.value) ?? view.fleet[0]!;
  const affordable = (price: number) => view.mode === 'sandbox' || view.money >= price;
  // Upgrades and swaps happen with both machines parked at the garage.
  const workshopOpen = view.serviceable && selected.atGarage;
  const stock = view.dealer.find((d) => d.id === selected.modelId)?.specs;
  const close = () => (garageOpen.value = false);

  return (
    <Modal
      icon="garage"
      title="Machine garage"
      subtitle={
        view.serviceable ? (
          'Parked in the workshop. Fit upgrades or take out another machine.'
        ) : (
          <span class="warn">
            Your machine is not parked here. Drive to the garage and stop to service it.
          </span>
        )
      }
      money={view.money}
      onClose={close}
      closeLabel="Close garage (G or Esc)"
      testId="garage"
      wide
    >
      <div class="garage-body">
        <section class="fleet">
          <SectionHead>Your fleet</SectionHead>
          {view.fleet.map((machine) => {
            const fitted = machine.upgrades.reduce((n, u) => n + u.level, 0);
            const total = machine.upgrades.reduce((n, u) => n + u.maxLevel, 0);
            return (
              <button
                key={machine.uid}
                class={`fleet-card${machine.uid === selected.uid ? ' selected' : ''}`}
                onClick={() => (garageSelected.value = machine.uid)}
                data-testid={`fleet-${machine.modelId}`}
                aria-pressed={machine.uid === selected.uid}
              >
                <MachineSilhouette model={machine.modelId} width={150} />
                <span class="fleet-name">{machine.name}</span>
                <span class="fleet-status">
                  <Lamp state={machine.driving ? 'on' : machine.atGarage ? 'off' : 'warn'} />
                  {machine.driving
                    ? 'Driving'
                    : machine.atGarage
                      ? 'Parked at garage'
                      : 'Out on the mountain'}
                </span>
                <span class="fleet-progress">
                  <span class="fleet-progress-bar">
                    <span style={{ width: `${(fitted / total) * 100}%` }} />
                  </span>
                  {fitted}/{total} upgrades
                </span>
              </button>
            );
          })}
        </section>

        <section class="workshop">
          <div class="workshop-head">
            <div class="workshop-machine">
              <MachineSilhouette model={selected.modelId} width={200} />
            </div>
            <div class="workshop-info">
              <div class="workshop-name">{selected.name}</div>
              <SpecSheet specs={selected.specs} stock={stock} />
              {!selected.driving && (
                <button
                  class="primary"
                  disabled={!workshopOpen || selected.driver !== null}
                  onClick={() => garageActions.drive(selected.uid)}
                  data-testid="drive"
                  title={selected.driver ? `${selected.driver} is driving it` : undefined}
                >
                  Drive this machine
                </button>
              )}
            </div>
          </div>
          <SectionHead>Upgrades</SectionHead>
          <div class="upgrade-list">
            {selected.upgrades.map((upgrade) => {
              const maxed = upgrade.price === null;
              return (
                <div
                  class={`upgrade${maxed ? ' maxed' : ''}`}
                  key={upgrade.id}
                  data-testid={`upgrade-${upgrade.id}`}
                >
                  <span class="upgrade-icon">
                    <Icon name={UPGRADE_ICON[upgrade.id] ?? 'engine'} size={22} />
                  </span>
                  <div class="upgrade-text">
                    <div class="upgrade-name">
                      {upgrade.name} <Pips level={upgrade.level} max={upgrade.maxLevel} />
                    </div>
                    <div class="upgrade-summary">{upgrade.summary}</div>
                  </div>
                  {maxed ? (
                    <span class="maxed-tag">Fully upgraded</span>
                  ) : (
                    <button
                      class="buy"
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
          <SectionHead>Dealer</SectionHead>
          <div class="dealer-list">
            {view.dealer.map((offer) => (
              <div class="offer" key={offer.id} data-testid={`offer-${offer.id}`}>
                <div class="offer-top">
                  <MachineSilhouette model={offer.id} width={130} />
                  {offer.owned > 0 && <span class="owned-tag">{offer.owned} owned</span>}
                </div>
                <div class="offer-name">{offer.name}</div>
                <div class="offer-text">{offer.description}</div>
                <SpecSheet specs={offer.specs} />
                <button
                  class="buy"
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

      <ResultLine message={garageMessage.value} testId="garage-message" />
    </Modal>
  );
}

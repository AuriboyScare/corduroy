import { modeMenu } from '../game/hudState';

/** First screen: choose how to play. */
export function StartMenu() {
  const choose = modeMenu.value;
  if (!choose) return null;
  return (
    <div class="start" data-testid="start-menu">
      <div class="start-inner">
        <div class="start-title">Corduroy</div>
        <div class="start-sub">Mountain operations</div>
        <div class="start-options">
          <button class="start-option" data-testid="start-career" onClick={() => choose('career')}>
            <span class="start-option-name">Career</span>
            <span class="start-option-text">
              Start with a compact groomer and a small budget. Groom runs to earn money, then buy upgrades and
              bigger machines.
            </span>
          </button>
          <button class="start-option" data-testid="start-sandbox" onClick={() => choose('sandbox')}>
            <span class="start-option-name">Sandbox</span>
            <span class="start-option-text">
              Every machine in the garage and unlimited money. Try anything.
            </span>
          </button>
        </div>
        <div class="start-note">Progress is not saved yet: saving is the next feature being built.</div>
      </div>
    </div>
  );
}

import { useState } from 'preact/hooks';
import { formatMoney, modeMenu } from '../game/hudState';
import type { SaveSummary } from '../platform/saveFile';
import type { GameMode } from '../sim/career';

const MODES: { mode: GameMode; name: string; text: string }[] = [
  {
    mode: 'career',
    name: 'New career',
    text: 'Start with a compact groomer and a small budget. Groom runs to earn money, then buy upgrades and bigger machines.',
  },
  {
    mode: 'sandbox',
    name: 'New sandbox',
    text: 'Every machine in the garage and unlimited money. Try anything.',
  },
];

function describeSave(save: SaveSummary): string {
  const minutes = Math.round(save.playSeconds / 60);
  const parts = [
    save.money === null ? 'Unlimited money' : formatMoney(save.money),
    `${save.machines} machine${save.machines === 1 ? '' : 's'}`,
    `${minutes} min played`,
  ];
  return parts.join(' · ');
}

/** First screen: continue a saved game or start a new one. */
export function StartMenu() {
  const menu = modeMenu.value;
  const [confirming, setConfirming] = useState<GameMode | null>(null);
  if (!menu) return null;
  const { choose, saves, savingAvailable } = menu;
  const saved = (Object.entries(saves) as [GameMode, SaveSummary][]).sort((a, b) =>
    b[1].savedAt.localeCompare(a[1].savedAt),
  );

  return (
    <div class="start" data-testid="start-menu">
      <div class="start-inner">
        <div class="start-title">Corduroy</div>
        <div class="start-sub">Mountain operations</div>

        {saved.length > 0 && (
          <div class="start-options start-continue">
            {saved.map(([mode, save]) => (
              <button
                key={mode}
                class="start-option primary-option"
                data-testid={`continue-${mode}`}
                onClick={() => choose({ mode, resume: true })}
              >
                <span class="start-option-name">Continue {mode}</span>
                <span class="start-option-text">{describeSave(save)}</span>
                <span class="start-option-text">Saved {new Date(save.savedAt).toLocaleString()}</span>
              </button>
            ))}
          </div>
        )}

        <div class="start-options">
          {MODES.map(({ mode, name, text }) =>
            confirming === mode ? (
              <div key={mode} class="start-option confirm" role="alertdialog">
                <span class="start-option-name">Replace your saved {mode}?</span>
                <span class="start-option-text">
                  The new game takes over the {mode} save slot at its first save. The old game stays in the
                  backups until five newer saves have been made.
                </span>
                <span class="confirm-buttons">
                  <button
                    class="primary"
                    data-testid={`confirm-${mode}`}
                    onClick={() => choose({ mode, resume: false })}
                  >
                    Start new {mode}
                  </button>
                  <button onClick={() => setConfirming(null)}>Cancel</button>
                </span>
              </div>
            ) : (
              <button
                key={mode}
                class="start-option"
                data-testid={`start-${mode}`}
                onClick={() => (saves[mode] ? setConfirming(mode) : choose({ mode, resume: false }))}
              >
                <span class="start-option-name">{name}</span>
                <span class="start-option-text">{text}</span>
              </button>
            ),
          )}
        </div>
        <div class="start-note">
          {savingAvailable
            ? 'Your game saves automatically every 2 minutes and when you quit. Press F5 to save at any time.'
            : 'This browser cannot store saves, so progress will be lost when you close it. Use the desktop app to keep your game.'}
        </div>
      </div>
    </div>
  );
}

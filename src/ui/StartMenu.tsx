import { useState } from 'preact/hooks';
import { formatMoney, modeMenu } from '../game/hudState';
import type { SaveSummary } from '../platform/saveFile';
import type { GameMode } from '../sim/career';
import { parseRoomCode } from '../net/protocol';
import { Icon, LogoMark, MachineSilhouette } from './icons';
import { MountainScene } from './MountainScene';

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

/** A saved game, drawn as a lift ticket: punched stub with the mode, the details on the right. */
function SaveTicket({ mode, save, onClick }: { mode: GameMode; save: SaveSummary; onClick: () => void }) {
  return (
    <button class={`ticket ${mode}`} data-testid={`continue-${mode}`} onClick={onClick}>
      <span class="ticket-stub">
        <span class="ticket-punch" />
        <span class="ticket-kind">{mode}</span>
      </span>
      <span class="ticket-main">
        <span class="ticket-head">
          <span class="ticket-continue">Continue {mode}</span>
          <Icon name="ticket" size={18} />
        </span>
        <span class="ticket-line">{describeSave(save)}</span>
        <span class="ticket-line dim">Saved {new Date(save.savedAt).toLocaleString()}</span>
        <span class="ticket-code" aria-hidden="true" />
      </span>
    </button>
  );
}

/** Join a friend's game: your name and the code they read out or sent. */
function JoinForm({
  initialName,
  initialCode,
  error,
  onJoin,
  onCancel,
}: {
  initialName: string;
  initialCode: string;
  error: string | null;
  onJoin: (name: string, code: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState(initialCode);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = (e: Event) => {
    e.preventDefault();
    const parsed = parseRoomCode(code);
    if (!parsed) {
      setProblem('A game code is six letters and numbers, like K7RM2P.');
      return;
    }
    onJoin(name.trim().slice(0, 24) || 'Player', parsed);
  };
  return (
    <form class="start-option join-form" onSubmit={submit} data-testid="join-form">
      <span class="start-option-name">Join a friend's game</span>
      <span class="start-option-text">
        Ask the host to press P and open their game to friends, then type the code they give you.
      </span>
      <label class="field">
        <span class="field-label">Your name</span>
        <input
          value={name}
          maxLength={24}
          placeholder="Groomer"
          autoComplete="nickname"
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
          data-testid="join-name"
        />
      </label>
      <label class="field">
        <span class="field-label">Game code</span>
        <input
          class="code-input"
          value={code}
          maxLength={8}
          placeholder="K7RM2P"
          autoComplete="off"
          spellcheck={false}
          onInput={(e) => setCode((e.target as HTMLInputElement).value.toUpperCase())}
          data-testid="join-code"
          autoFocus
        />
      </label>
      {(problem ?? error) && (
        <span class="form-error" role="alert" data-testid="join-error">
          {problem ?? error}
        </span>
      )}
      <span class="confirm-buttons">
        <button class="primary" type="submit" data-testid="join-submit">
          Join game
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </span>
    </form>
  );
}

/** First screen: continue a saved game, start a new one, or join a friend. */
export function StartMenu() {
  const menu = modeMenu.value;
  const [confirming, setConfirming] = useState<GameMode | null>(null);
  const [joining, setJoining] = useState<boolean | null>(null);
  if (!menu) return null;
  const { choose, saves, savingAvailable } = menu;
  // Open the join form when a join link brought us here or the last attempt failed.
  const showJoin = joining ?? (menu.joinError !== null || menu.joinCode !== null);
  const saved = (Object.entries(saves) as [GameMode, SaveSummary][]).sort((a, b) =>
    b[1].savedAt.localeCompare(a[1].savedAt),
  );

  return (
    <div class="start" data-testid="start-menu">
      <MountainScene />
      <div class="start-scrim" />
      <div class="start-inner">
        <div class="brand large">
          <LogoMark size={64} />
          <div>
            <div class="brand-name">Corduroy</div>
            <div class="brand-sub">Mountain operations</div>
          </div>
        </div>
        <p class="start-pitch">
          The lifts have closed and the mountain is yours. Groom the runs, keep the lifts turning and make
          snow before first chair.
        </p>

        {saved.length > 0 && (
          <div class="start-tickets">
            {saved.map(([mode, save]) => (
              <SaveTicket key={mode} mode={mode} save={save} onClick={() => choose({ mode, resume: true })} />
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
                <span class="start-option-art">
                  {mode === 'career' ? (
                    <MachineSilhouette model="kestrel-260" width={96} />
                  ) : (
                    <Icon name="infinity" size={34} />
                  )}
                </span>
                <span class="start-option-copy">
                  <span class="start-option-name">{name}</span>
                  <span class="start-option-text">{text}</span>
                </span>
              </button>
            ),
          )}
        </div>
        <div class="start-options start-join">
          {showJoin ? (
            <JoinForm
              initialName={menu.playerName}
              initialCode={menu.joinCode ?? ''}
              error={menu.joinError}
              onJoin={(name, code) => choose({ join: { code, name } })}
              onCancel={() => setJoining(false)}
            />
          ) : (
            <button class="start-option" data-testid="start-join" onClick={() => setJoining(true)}>
              <span class="start-option-art">
                <Icon name="riders" size={34} />
              </span>
              <span class="start-option-copy">
                <span class="start-option-name">Join a friend</span>
                <span class="start-option-text">
                  Play in someone else's resort with a game code. Up to four players, each driving their own
                  machine.
                </span>
              </span>
            </button>
          )}
        </div>
        <div class="start-note">
          <Icon name="disk" size={14} />
          {savingAvailable
            ? 'Your game saves automatically every 2 minutes and when you quit. Press F5 to save at any time.'
            : 'This browser cannot store saves, so progress will be lost when you close it. Use the desktop app to keep your game.'}
        </div>
      </div>
    </div>
  );
}

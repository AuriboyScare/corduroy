import { useState } from 'preact/hooks';
import { netActions, netEnded, netMessage, netView, playOpen, type NetPlayer } from '../game/hudState';
import { menuUrl, savedPlayerName } from '../game/multiplayer';
import { Icon } from './icons';
import { Lamp } from './instruments';
import { Modal, ResultLine, SectionHead } from './Modal';

function PlayerList({ players }: { players: readonly NetPlayer[] }) {
  return (
    <div class="player-list" data-testid="players">
      {players.map((p) => (
        <div class="player" key={p.id}>
          <Lamp state={p.machine ? 'on' : 'off'} />
          <span class="player-name">
            {p.name}
            {p.you && <span class="player-tag">you</span>}
            {p.host && <span class="player-tag host">host</span>}
          </span>
          <span class="player-machine">{p.machine ?? 'Watching: no free machine'}</span>
        </div>
      ))}
    </div>
  );
}

async function copy(text: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    netMessage.value = { text: `${what} copied.`, ok: true };
  } catch {
    netMessage.value = { text: `Copy it by hand: ${text}`, ok: true };
  }
}

/** Open the game to friends, see who is playing, or leave someone else's game. */
export function PlayPanel() {
  const view = netView.value;
  const [name, setName] = useState(savedPlayerName());
  if (!playOpen.value) return null;
  const close = () => (playOpen.value = false);
  return (
    <Modal
      icon="riders"
      title="Play together"
      subtitle={
        view.role === 'client'
          ? "You are playing in a friend's resort. The host's computer runs and saves the game."
          : 'Friends anywhere online can join your resort with a code. Up to four players.'
      }
      onClose={close}
      closeLabel="Close (P or Esc)"
      testId="play"
    >
      {view.role === 'solo' && (
        <div class="play-open">
          <label class="field">
            <span class="field-label">Your name</span>
            <input
              value={name}
              maxLength={24}
              placeholder="Host"
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
              data-testid="host-name"
            />
          </label>
          <ul class="play-notes">
            <li>Everyone shares the resort and its money; each player drives their own machine.</li>
            <li>
              Buy more machines in the garage so everyone has one. Players without one can watch and run
              lifts.
            </li>
            <li>
              Your computer runs the game and saves it. Keep your game window open and visible while friends
              play: browsers pause hidden tabs.
            </li>
            <li>Everyone needs Chrome or Edge, or the desktop app.</li>
          </ul>
          <button class="primary" onClick={() => netActions.open(name)} data-testid="open-game">
            Open to friends
          </button>
        </div>
      )}
      {view.role === 'host' && view.code && (
        <div class="play-hosting">
          <div class="room-code-box">
            <span class="field-label">Game code</span>
            <span class="room-code" data-testid="room-code">
              {view.code}
            </span>
            <span class="room-actions">
              <button onClick={() => void copy(view.code!, 'Code')}>
                <Icon name="keys" size={15} /> Copy code
              </button>
              {view.link && (
                <button onClick={() => void copy(view.link!, 'Link')}>
                  <Icon name="ticket" size={15} /> Copy invite link
                </button>
              )}
            </span>
          </div>
          <SectionHead>Players</SectionHead>
          <PlayerList players={view.players} />
          <button class="danger-plain" onClick={() => netActions.close()} data-testid="close-game">
            Close to friends
          </button>
        </div>
      )}
      {view.role === 'client' && (
        <div class="play-hosting">
          {view.code && (
            <div class="room-code-box small">
              <span class="field-label">Game code</span>
              <span class="room-code">{view.code}</span>
            </div>
          )}
          <SectionHead>Players</SectionHead>
          <PlayerList players={view.players} />
          <button class="danger-plain" onClick={() => netActions.leave()} data-testid="leave-game">
            Leave game
          </button>
        </div>
      )}
      <ResultLine message={netMessage.value} />
    </Modal>
  );
}

/** Covers the game when a shared game ends for this player. */
export function NetEnded() {
  const ended = netEnded.value;
  if (!ended) return null;
  return (
    <div class="modal-backdrop">
      <div class="panel modal ended" role="alertdialog" data-testid="net-ended">
        <header class="modal-head">
          <span class="modal-icon">
            <Icon name="riders" size={22} />
          </span>
          <div class="modal-titles">
            <div class="modal-title">Game over for now</div>
            <div class="modal-sub">{ended.reason}</div>
          </div>
        </header>
        <div class="modal-body ended-actions">
          {ended.rejoin && (
            <button class="primary" onClick={() => location.assign(ended.rejoin!)}>
              Rejoin the game
            </button>
          )}
          <button onClick={() => location.assign(menuUrl())}>Back to the menu</button>
        </div>
      </div>
    </div>
  );
}

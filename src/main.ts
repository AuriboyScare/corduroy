import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';
import '@fontsource/barlow-condensed/latin-500.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import { h, render } from 'preact';
import { startGame, type GameDebug } from './game/game';
import { parseRoomCode } from './net/protocol';
import { loadingMessage } from './game/hudState';
import { openSaveStore } from './platform/saveStore';
import { createRenderer, type BootInfo } from './render/createRenderer';
import { Hud } from './ui/Hud';

interface DebugBridge {
  boot: BootInfo;
  game?: GameDebug;
}

declare global {
  interface Window {
    __corduroy?: DebugBridge;
  }
}

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;

async function boot(): Promise<void> {
  render(h(Hud, {}), uiRoot);
  const [{ renderer, info }, store] = await Promise.all([
    createRenderer({ canvas, forceWebGL: params.get('gl') === '1' }),
    openSaveStore(),
  ]);
  const bridge: DebugBridge = { boot: info };
  if (params.get('debug') === '1') window.__corduroy = bridge;
  // ?mode=career|sandbox skips the menu with a fresh game; add &resume=1 to load that mode's save.
  // ?join=CODE opens the join form with the code; with &name=... it joins straight away.
  const mode = params.get('mode');
  const joinCode = parseRoomCode(params.get('join') ?? '');
  const joinName = params.get('name');
  bridge.game = await startGame({
    renderer,
    canvas,
    seed: Number(params.get('seed') ?? 11),
    choice:
      joinCode && joinName
        ? { join: { code: joinCode, name: joinName } }
        : mode === 'career' || mode === 'sandbox'
          ? { mode, resume: params.get('resume') === '1' }
          : null,
    store,
    joinCode,
  });
}

boot().catch((error: unknown) => {
  console.error(error);
  loadingMessage.value = null;
  const message = error instanceof Error ? error.message : String(error);
  const box = document.createElement('div');
  box.className = 'panel boot bad';
  box.textContent = `Corduroy could not start: ${message}`;
  uiRoot.replaceChildren(box);
});

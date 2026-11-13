import { h, render } from 'preact';
import { startGame, type GameDebug } from './game/game';
import { loadingMessage } from './game/hudState';
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
  const { renderer, info } = await createRenderer({ canvas, forceWebGL: params.get('gl') === '1' });
  const bridge: DebugBridge = { boot: info };
  if (params.get('debug') === '1') window.__corduroy = bridge;
  bridge.game = await startGame(renderer, canvas, Number(params.get('seed') ?? 11));
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

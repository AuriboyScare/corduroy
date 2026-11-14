import { BroadcastTransport, type Transport } from '../net/transport';
import { TrysteroTransport } from '../net/trysteroTransport';
import type { PlayerInfo } from '../net/protocol';
import { decodeSave, encodeSave } from '../platform/saveFile';
import { restoreWorld, type WorldSnapshot } from '../sim/save/worldSave';
import type { World } from '../sim/world';

/**
 * Online games use WebRTC rooms; `?net=local` keeps a game inside one browser (tabs talk over a
 * BroadcastChannel), which is how the automated tests play together offline.
 */
export function createTransport(code: string): Transport {
  const local = new URLSearchParams(location.search).get('net') === 'local';
  return local ? new BroadcastTransport(code) : new TrysteroTransport(code);
}

/** A joining player receives the world as save-file bytes: checksummed and compressed. */
export function encodeForPeer(snapshot: WorldSnapshot, players: readonly PlayerInfo[]): Promise<Uint8Array> {
  return encodeSave(snapshot, {
    savedAt: new Date().toISOString(),
    mode: snapshot.meta.mode,
    money: snapshot.meta.money,
    machines: snapshot.meta.fleet.length,
    playSeconds: players.length,
  });
}

export async function decodeFromHost(bytes: Uint8Array): Promise<World> {
  return restoreWorld((await decodeSave(bytes)).snapshot);
}

const NAME_KEY = 'corduroy.playerName';

/** The name this player last used, remembered per browser. */
export function savedPlayerName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function rememberPlayerName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Private windows may refuse storage; the name is only a convenience.
  }
}

/** Query parameters kept when moving between the menu and a game (testing switches). */
const KEPT = ['debug', 'net', 'gl'];

function baseUrl(): URL {
  const url = new URL(location.href);
  const keep = KEPT.flatMap((k) => (url.searchParams.has(k) ? [[k, url.searchParams.get(k)!] as const] : []));
  url.search = '';
  url.hash = '';
  for (const [k, v] of keep) url.searchParams.set(k, v);
  return url;
}

/** A link that opens the game and joins this room; with a name it joins straight away. */
export function joinLink(code: string, name?: string): string {
  const url = baseUrl();
  url.searchParams.set('join', code);
  if (name) url.searchParams.set('name', name);
  return url.toString();
}

/** The start menu. */
export function menuUrl(): string {
  return baseUrl().toString();
}

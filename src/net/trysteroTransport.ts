import { joinRoom, selfId } from 'trystero';
import type { Transport } from './transport';

/** Keeps Corduroy's rooms apart from other apps using the same public matchmaking relays. */
const APP_ID = 'corduroy-mountain-operations';

/**
 * Online play: peers find each other through public Nostr relays (no server of our own), then
 * talk directly over WebRTC data channels. The room code doubles as the password that encrypts
 * the connection handshake, so only people with the code can join.
 */
export class TrysteroTransport implements Transport {
  readonly selfId = selfId;
  onMessage: Transport['onMessage'] = null;
  onBytes: Transport['onBytes'] = null;
  onPeerJoin: Transport['onPeerJoin'] = null;
  onPeerLeave: Transport['onPeerLeave'] = null;
  private readonly room;
  private readonly message;
  private readonly bytes;
  private left = false;

  constructor(code: string) {
    this.room = joinRoom({ appId: APP_ID, password: code }, `room-${code}`);
    this.message = this.room.makeAction('msg');
    this.bytes = this.room.makeAction('bin');
    this.message.onMessage = (data, { peerId }) => this.onMessage?.(data, peerId);
    this.bytes.onMessage = (data, { peerId }) => {
      const view =
        data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : ArrayBuffer.isView(data)
            ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
            : null;
      if (view) this.onBytes?.(view, peerId);
    };
    this.room.onPeerJoin = (peer) => this.onPeerJoin?.(peer);
    this.room.onPeerLeave = (peer) => this.onPeerLeave?.(peer);
  }

  send(data: unknown, target?: string): void {
    if (this.left) return;
    void this.message
      .send(data as Parameters<typeof this.message.send>[0], target === undefined ? undefined : { target })
      .catch((error: unknown) => console.warn('Could not send to a player', error));
  }

  sendBytes(data: Uint8Array, target: string): void {
    if (this.left) return;
    void this.bytes
      .send(data, { target })
      .catch((error: unknown) => console.warn('Could not send the world', error));
  }

  leave(): void {
    if (this.left) return;
    this.left = true;
    void this.room.leave();
  }
}

/**
 * How peers in a game reach each other. Messages are reliable and arrive in the order sent.
 * Implementations: a WebRTC room (online play), a BroadcastChannel (tabs in one browser, for
 * tests), and a simulated network with latency (unit tests).
 */
export interface Transport {
  readonly selfId: string;
  /** Sends a JSON-safe message to one peer, or to every peer. */
  send(data: unknown, target?: string): void;
  /** Sends binary data (a world snapshot) to one peer. */
  sendBytes(data: Uint8Array, target: string): void;
  onMessage: ((data: unknown, from: string) => void) | null;
  onBytes: ((data: Uint8Array, from: string) => void) | null;
  onPeerJoin: ((peer: string) => void) | null;
  onPeerLeave: ((peer: string) => void) | null;
  leave(): void;
}

/** A simulated network for tests: delivery after a fixed latency on a clock the test advances. */
export class LoopbackHub {
  private now = 0;
  private readonly queue: { at: number; seq: number; run: () => void }[] = [];
  private seq = 0;
  private readonly peers = new Map<string, LoopbackTransport>();

  constructor(private readonly latencyMs = 40) {}

  connect(id: string): LoopbackTransport {
    const transport = new LoopbackTransport(id, this);
    for (const other of this.peers.values()) {
      this.later(() => other.onPeerJoin?.(id));
      this.later(() => transport.onPeerJoin?.(other.selfId));
    }
    this.peers.set(id, transport);
    return transport;
  }

  disconnect(id: string): void {
    this.peers.delete(id);
    for (const other of this.peers.values()) this.later(() => other.onPeerLeave?.(id));
  }

  deliver(from: string, target: string | undefined, run: (to: LoopbackTransport) => void): void {
    for (const [id, peer] of this.peers) {
      if (id === from || (target !== undefined && id !== target)) continue;
      this.later(() => {
        if (this.peers.get(id) === peer) run(peer);
      });
    }
  }

  private later(run: () => void): void {
    this.queue.push({ at: this.now + this.latencyMs, seq: this.seq++, run });
  }

  /** Moves the clock on, delivering everything due, in order. */
  advance(ms: number): void {
    this.now += ms;
    for (;;) {
      this.queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const next = this.queue[0];
      if (!next || next.at > this.now) return;
      this.queue.shift();
      next.run();
    }
  }
}

export class LoopbackTransport implements Transport {
  onMessage: Transport['onMessage'] = null;
  onBytes: Transport['onBytes'] = null;
  onPeerJoin: Transport['onPeerJoin'] = null;
  onPeerLeave: Transport['onPeerLeave'] = null;

  constructor(
    readonly selfId: string,
    private readonly hub: LoopbackHub,
  ) {}

  send(data: unknown, target?: string): void {
    // Copy, as a real network would.
    const copy = JSON.parse(JSON.stringify(data)) as unknown;
    this.hub.deliver(this.selfId, target, (to) => to.onMessage?.(copy, this.selfId));
  }

  sendBytes(data: Uint8Array, target: string): void {
    const copy = data.slice();
    this.hub.deliver(this.selfId, target, (to) => to.onBytes?.(copy, this.selfId));
  }

  leave(): void {
    this.hub.disconnect(this.selfId);
  }
}

type Envelope =
  | { kind: 'hi' | 'here' | 'bye'; from: string; to?: string }
  | { kind: 'msg'; from: string; to?: string; data: unknown }
  | { kind: 'bin'; from: string; to?: string; data: Uint8Array };

/** Peers in other tabs of the same browser, over a BroadcastChannel named after the room. */
export class BroadcastTransport implements Transport {
  readonly selfId = `tab-${Math.random().toString(36).slice(2, 10)}`;
  onMessage: Transport['onMessage'] = null;
  onBytes: Transport['onBytes'] = null;
  onPeerJoin: Transport['onPeerJoin'] = null;
  onPeerLeave: Transport['onPeerLeave'] = null;
  private readonly channel: BroadcastChannel;
  private readonly known = new Set<string>();
  private closed = false;

  constructor(room: string) {
    this.channel = new BroadcastChannel(`corduroy-room-${room}`);
    this.channel.onmessage = (event: MessageEvent<Envelope>) => this.receive(event.data);
    this.post({ kind: 'hi', from: this.selfId });
    addEventListener('pagehide', () => this.leave());
  }

  private post(envelope: Envelope): void {
    if (!this.closed) this.channel.postMessage(envelope);
  }

  private receive(e: Envelope): void {
    if (e.from === this.selfId || (e.to !== undefined && e.to !== this.selfId)) return;
    if (e.kind === 'bye') {
      if (this.known.delete(e.from)) this.onPeerLeave?.(e.from);
      return;
    }
    if (!this.known.has(e.from)) {
      this.known.add(e.from);
      this.onPeerJoin?.(e.from);
    }
    if (e.kind === 'hi') this.post({ kind: 'here', from: this.selfId, to: e.from });
    else if (e.kind === 'msg') this.onMessage?.(e.data, e.from);
    else if (e.kind === 'bin') this.onBytes?.(e.data, e.from);
  }

  send(data: unknown, target?: string): void {
    this.post(
      target === undefined
        ? { kind: 'msg', from: this.selfId, data }
        : { kind: 'msg', from: this.selfId, to: target, data },
    );
  }

  sendBytes(data: Uint8Array, target: string): void {
    this.post({ kind: 'bin', from: this.selfId, to: target, data });
  }

  leave(): void {
    if (this.closed) return;
    this.post({ kind: 'bye', from: this.selfId });
    this.closed = true;
    this.channel.close();
  }
}

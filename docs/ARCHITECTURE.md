# Architecture

The full design is in [MASTER_PLAN.md](MASTER_PLAN.md). This file records what is actually built and the rules code must follow.

## Layers

| Directory      | Role                                                                            | May import                |
| -------------- | ------------------------------------------------------------------------------- | ------------------------- |
| `src/sim`      | Pure simulation: world model, Commands, clock, terrain and snow data, lifts, AI | nothing outside `src/sim` |
| `src/net`      | Protocol, codec, transports                                                     | `sim`                     |
| `src/render`   | three.js WebGPU rendering                                                       | `sim`, `net`              |
| `src/game`     | Input, cameras, player and vehicle control, editor tools                        | `sim`, `net`, `render`    |
| `src/platform` | Storage backends, Electron bridge                                               | `sim`                     |
| `src/ui`       | Preact interface                                                                | everything above          |
| `electron/`    | Main process: window, `app://` protocol, later file IO and LAN host             | Node, Electron            |

`tsconfig.sim.json` compiles `src/sim` without the DOM library, and `eslint.config.js` restricts imports per layer.

## Built so far

- `src/sim/clock.ts`: fixed-step clock with time scale and backlog drop.
- `src/render/createRenderer.ts`: renderer creation and capability report (`BootInfo`).
- `electron/main.js`: serves `dist` over `app://` with cross-origin isolation headers so SharedArrayBuffer works in the packaged app.
- `?debug=1` exposes `window.__corduroy` for tests.

## Cross-origin isolation

SharedArrayBuffer is how the sim worker shares terrain and snow grids with the renderer. It needs `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` on every response. Vite dev and preview, and the Electron `app://` handler, all send them. Any future host server must too.

## Multiplayer

Host-authoritative deterministic lockstep, in `src/net`:

- **Frames.** The host steps the shared world with `HostSession.step`. Each step builds a `Frame`: every seated player's quantised input (8-bit per axis, so every copy steps with the same values) and any commands or seat changes, then applies it with `applyFrame`. Clients apply the same frames with the same function, so their worlds stay identical. The host never waits for a client: late input is held, and input older than 2 s idles that machine.
- **Joining.** A joining player gets the world as save-file bytes, captured at a step boundary, plus the seat table at that step. Frames follow from the next step. A player too far behind (more than 20 s of history) is sent a fresh snapshot.
- **Checks.** Every 120 steps the host sends `worldHash`. A client whose own hash differs is told its copy fell out of step and offered a rejoin. In the handshake, `mathSignature()` fingerprints the engine's `Math` functions, and players whose engines differ are refused with an explanation.
- **Seats.** `Seats` (who drives which machine) changes only through frame events, so every copy agrees. Changing machine is a seat change with the same rules as single player.
- **Transports.** `TrysteroTransport` (online: Nostr relays for matchmaking, WebRTC data channels, room code as the handshake password), `BroadcastTransport` (tabs in one browser, `?net=local`, used by the browser tests), and `LoopbackHub` (a simulated network with latency for the integration tests).

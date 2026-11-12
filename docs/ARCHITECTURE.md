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

# Development status

Last updated: 2026-11-11 (Phase 0)

## Completed systems

- **Project skeleton**: Vite + TypeScript + Preact + Electron, layered source tree, lint rules that enforce the layer boundaries.
- **Renderer bring-up**: three.js WebGPURenderer initialises in Chrome and Electron and reports what the machine supports; WebGL2 fallback path renders.
- **Fixed-step simulation clock** (`src/sim/clock.ts`), unit tested.
- **Tooling**: Vitest unit tests, Playwright e2e (Chrome WebGPU, WebGL2 fallback, Electron), GitHub Actions CI, Claude Code hooks, 13 agents, 4 project skills.

## In progress

- Phase 1, technical foundation. Nothing of the game itself exists yet: the app shows a renderer check screen.

## Known bugs and issues

- `npm audit` reports a moderate advisory in `minimatch`, pulled in by ESLint 10 (development tooling only, not shipped). The offered fix downgrades ESLint; waiting for an upstream release.

## Performance measurements

| Date       | Scene                 | Preset | Result                                   | Power   | Notes                                            |
| ---------- | --------------------- | ------ | ---------------------------------------- | ------- | ------------------------------------------------ |
| 2026-11-11 | Boot check (one mesh) | n/a    | 59 to 60 fps, Chrome 157 and Electron 45 | Battery | Proves the pipeline only; not a game measurement |

Verified capabilities on the M2 Air: WebGPU on Metal (`apple metal-3`), GPU timestamp queries, ASTC/BC/ETC2 textures, SharedArrayBuffer (cross-origin isolated) in both Chrome and Electron.

## Outstanding tasks

- Project skills still to write, each when its system exists: save-system, terrain-system, snow-simulation, vehicle-physics, lift-systems, multiplayer-architecture.
- Docs still to write when implemented: SAVE_FORMAT, NETWORK_PROTOCOL, ART_BIBLE.
- Packaging to a `.app` (electron-builder) is not set up yet.

## Next priorities

1. Sim core: world model, Commands, host and client over a loopback transport, sim worker.
2. Save system: versioned container, atomic writes, rotating backups, 2-minute autosave, command journal, recovery, kill-during-write fuzz test.
3. Renderer: quality presets, dynamic resolution, perf HUD with GPU timing.
4. Terrain: 2 km test mountain, CDLOD rendering, snow material v1.
5. Sky, sun, shadows, fog; instanced forest with impostors; cameras and on-foot controller.
6. Benchmark and soak harness; record Low/Medium/High/Ultra numbers.

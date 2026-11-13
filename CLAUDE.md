# Corduroy: project guide for Claude Code

Ski resort operations and mountain simulator. three.js r187 WebGPURenderer + TSL, TypeScript (strict), Vite, Electron shell, Rapier physics, Preact UI. Target: M2 MacBook Air, 16 GB, fanless.

Read `DEVELOPMENT_STATUS.md` first for the current state. The approved plan is `docs/MASTER_PLAN.md`.

## Commands

- `npm run dev`: Vite dev server on http://127.0.0.1:5199 (`?debug=1` exposes `window.__corduroy`, `?gl=1` forces WebGL2)
- `npm run app`: Electron on the built `dist` (`CORDUROY_DEV_URL=http://127.0.0.1:5199 npm run app` for the dev server)
- `npm run check:quick`: typecheck + unit tests (the Stop hook runs this)
- `npm run check`: lint + typecheck + tests + build. Must pass before every commit
- `npm run test:e2e`: Playwright on installed Chrome and Electron
- `node tools/shot.mjs <out.png> [--eval js] [--shots json]`: screenshots of the running dev server
- `node tools/bench.mjs`: frame pacing in four scenes (dev server must be running)

## Architecture rules

- `src/sim` is pure TypeScript: no three.js, DOM, Node or imports from other layers. It has its own tsconfig without the DOM lib, and ESLint enforces the imports. It runs in a worker, in Node and in tests.
- Layers, lowest first: `sim` → `net` → `render` / `game` / `platform` → `ui`. Lower layers never import higher ones.
- Every change to the world is a Command validated and applied by the host. Single-player is a host and a client over a loopback transport.
- Hot paths allocate nothing per frame.
- Features that need WebGPU report "reduced" on the WebGL2 fallback; they never fail silently.

## Definition of done

- A test fails without the change, and `npm run check` passes.
- Visual work has a screenshot that was opened and looked at.
- Performance-relevant work has a measurement recorded with preset and power source.
- No placeholder art, dead controls or unreported gaps. Unfinished work is listed in `DEVELOPMENT_STATUS.md`.
- Existing bugs are fixed before new features are added.

## Process

- One branch per phase or system, PR with green CI, tag at each phase exit.
- TypeScript is pinned to 6.0.x because typescript-eslint does not support 7 yet.
- The development Mac's disk is nearly full: keep downloads small and check `df -h /System/Volumes/Data`.

# Corduroy

A ski resort operations and mountain simulator: build and groom the mountain, shape terrain parks, run lifts and snowmaking, drive the machinery, and operate the resort with friends over a local network.

Early development. See [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md) for what exists today and [docs/MASTER_PLAN.md](docs/MASTER_PLAN.md) for the roadmap.

## Run

```
npm install
npm run dev        # browser, http://127.0.0.1:5199
npm run build && npm run app   # desktop app (Electron)
```

## Controls

W/S drive, A/D steer, R/F blade up/down, T tiller, C camera (chase, cab, free fly), drag to look, scroll to zoom, M sound, H help.

Needs a WebGPU-capable browser (Chrome on Apple Silicon is the target). A WebGL2 fallback runs with reduced features.

## Test

```
npm run check      # lint, typecheck, unit tests, build
npm run test:e2e   # browser and Electron tests
```

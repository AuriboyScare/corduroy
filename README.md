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

| Key      | Action                                      |
| -------- | ------------------------------------------- |
| W / S    | Drive forward / reverse                     |
| A / D    | Steer (pivots when stopped)                 |
| R / F    | Blade up / down                             |
| T        | Tiller down and running / up                |
| V        | Cruise control (when fitted)                |
| Y, [ / ] | Winch hook / unhook, tension (Kestrel 600W) |
| G        | Garage: machines and upgrades               |
| L        | Lifts: build and operate                    |
| N        | Snowmaking                                  |
| C        | Camera: chase, cab, free fly                |
| F5       | Save                                        |
| M, H     | Sound, help                                 |

Needs a WebGPU-capable browser (Chrome on Apple Silicon is the target). A WebGL2 fallback runs with reduced features.

## Test

```
npm run check      # lint, typecheck, unit tests, build
npm run test:e2e   # browser and Electron tests
```

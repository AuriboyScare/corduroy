---
name: automated-testing
description: How to test Corduroy. Use when adding or changing tests, when a check fails, or before declaring any feature done.
---

# Automated testing in Corduroy

| Command               | What it runs                                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| `npm run check:quick` | Typecheck (sim layer, then everything) and unit tests. The Stop hook runs this.                                 |
| `npm run check`       | Lint, typecheck, unit and integration tests, production build.                                                  |
| `npm run test:e2e`    | Playwright: builds, serves on 5198, drives installed Chrome (WebGPU), the WebGL2 fallback and the Electron app. |

## Where tests go

- `tests/unit`: pure logic from `src/sim` and `src/net`. Runs in Node, no browser. Most tests belong here.
- `tests/integration`: several parts together in Node (host plus clients, save round trips, kill-during-write).
- `tests/e2e`: the real app. Load with `?debug=1` and read `window.__corduroy` instead of scraping pixels where possible.
- `tests/perf`: benchmark scenes (added in Phase 1).

## Rules

- A feature is not done until a test fails without it.
- Visual work also needs a screenshot you have opened and looked at. `expectRenderedImage` in `tests/e2e/boot.spec.ts` only proves the frame is not blank.
- e2e fails on any console error or failed request. Fix the cause; do not filter the message.
- Local e2e uses installed Chrome (`channel: 'chrome'`), not Playwright's Chromium, to save disk.
- CI sets `CI=1` and runs headless without a GPU. The game renders there in software at about 1 fps, so only the smoke test (`boots, shows the HUD and simulates`) runs in CI. It drives the simulation through `fastForward` instead of real time. Every test that plays in real time or captures frames calls `test.skip(ci, 'needs a GPU')` and runs on the development Mac.
- To reproduce CI locally, point a temporary Playwright config at installed Chrome with `--use-angle=swiftshader --enable-unsafe-swiftshader`, headless, and run with `CI=1`.
- Never wait a fixed time for gameplay to happen. Wait on a condition (`page.waitForFunction`) with a generous timeout; frame rate varies with machine load.
- Use fixed seeds and a frozen clock for anything compared against a baseline.

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
- Local e2e uses installed Chrome (`channel: 'chrome'`), not Playwright's Chromium, to save disk. CI sets `CI=1`, runs headless without a GPU, and so exercises WebGL2 only. The Electron test is skipped there.
- Use fixed seeds and a frozen clock for anything compared against a baseline.

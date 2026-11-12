---
name: performance-m2
description: Performance budgets and measurement rules for Corduroy on the M2 MacBook Air. Use when adding rendering or simulation cost, choosing a technique, or reporting performance.
---

# Performance on the target Mac

Target: MacBook Air M2, 8-core GPU, 16 GB unified memory, no fan. 60 fps where practical, stable 30 fps fallback, 1080p-class internal resolution.

## Budgets (High preset)

| Resource          | Budget |
| ----------------- | ------ |
| GPU frame time    | 12 ms  |
| Main-thread CPU   | 8 ms   |
| Draw calls        | 400    |
| Visible triangles | 4 M    |
| Texture memory    | 1.2 GB |
| JS heap           | 1.5 GB |
| Whole process     | 4 GB   |

## Rules

- The machine throttles after about ten minutes of sustained load. A number from a cold 30-second run is not a result; soak for 20 minutes.
- Record preset, resolution, scene, and whether the Mac was plugged in with every measurement.
- Alpha-tested foliage is expensive on Apple GPUs: use impostors early and budget alpha pixels.
- Simulate by distance; instance everything repeated; allocate nothing per frame in hot paths.
- Do not state a frame rate that was not measured on this machine.

## Measurements so far

- Phase 0 boot scene (one mesh): 59 to 60 fps in Electron and Chrome. This only shows the pipeline works.
- The perf HUD, `npm run bench` and `npm run soak` are built in Phase 1; this file is updated with their commands when they exist.

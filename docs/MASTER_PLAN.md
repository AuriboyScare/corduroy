# Corduroy (working title): Ski Resort Operations & Mountain Simulator. Master Plan

## Context

You want a long-term, high-fidelity, original ski resort operations simulator. Its pillars are terrain-park building, snow and grooming, snowcats, lifts, weather, a living resort, cameras and LAN co-op, and it has to run well on your M2 MacBook Air. The brief assumed Unity 6 was installed. It isn't: only Unity Hub 3.22.3 is, and there are 6.6 GB of free disk. **You chose Three.js WebGPU** over freeing space for Unity. For assets you chose **procedural + CC0, plus other assets from the internet, provided they stay consistently good**. This plan covers that stack. It also covers the architecture that makes networking, saving and performance work from day one, the development organization (agents, skills, hooks, GitHub), and a gated roadmap. Each phase must be playable, tested and measured before the next one starts.

## Environment findings (verified 2026-11-11)

| Item                | State                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hardware            | MacBook Air Mac14,2, M2 (4P+4E CPU, **8-core GPU**, Metal 4), 16 GB, fanless. Display 2560×1664. It was on battery at 30%                                                                                                                                                                                                                                                  |
| OS / browsers       | macOS 27.2, Chrome 157 (WebGPU through Dawn on Metal), Safari 27.2                                                                                                                                                                                                                                                                                                         |
| Disk                | Little free space on the development Mac, so downloads stay small and source textures are not committed                                                                                                                                                                                                                                                                    |
| Toolchain           | node 26.12, npm 11.20, git 2.54, gh 2.102 (logged in as **AuriboyScare**), Homebrew 7, Xcode CLT. **Missing:** git-lfs, dotnet, Blender, cmake, Unity Editor                                                                                                                                                                                                               |
| Latest packages     | three 0.187, rapier3d-compat 0.21, electron 45.3, vite 8.3, typescript 7.0, vitest 5.1, @playwright/test 1.65, ws 8.22                                                                                                                                                                                                                                                     |
| Claude Code         | Installed user skills: 20 `threejs-*` skills (game-director, aaa-graphics-builder with a visual scorecard, debug-profiler, qa-release with a canvas inspector, and others). Plugins: context7 (docs MCP), playwright (MCP), frontend-design, typescript-lsp. **No custom agents, no hooks.** No Tripo, Gemini or ElevenLabs keys, so the generator skills are out of scope |
| Prior work to reuse | Earlier three.js projects by the same author: an M2-tuned dynamic-resolution loop, the pure-core/no-engine-import convention, versioned save validation, a `?debug=1` bridge, a Vitest plus Playwright layout, and a fetch script for Microsoft Rocketbox avatars (MIT)                                                                                                    |

**Disk is a stability risk, not just a space problem.** Chrome, the game and the dev tools on 16 GB will swap, and macOS gets unstable below ~5 GB free. Work stays inside the available space: node_modules plus Electron is ~1 GB, and only 2K/4K source textures are downloaded, gitignored.

## Key technical decisions

1. **Engine: three.js r187 `WebGPURenderer` + TSL (node materials), TypeScript strict, Vite.** WebGPU on macOS runs on Metal through Dawn. When WebGPU is unavailable the WebGL2 backend takes over automatically. Features that need compute shaders show as "reduced" in that mode, not silently broken.
2. **Shipping shell: Electron 45 (arm64), with the same code in the browser for development.** Electron provides:
   - real files for crash-safe saves,
   - a Node `ws` LAN server and UDP-broadcast discovery, the Eaglercraft-style host,
   - native Chromium WebGPU,
   - a packaged `.app` built with electron-builder.
     Day to day I develop against the Vite dev server in Chrome.
3. **Physics: Rapier 3D (WASM)** for rigid bodies and collision. It runs in a worker and in Node. Every vehicle gets its own controller built on top of it: tracked snowcat, snowmobile, side-by-side, utility vehicle. There is no shared generic controller.
4. **UI: Preact + @preact/signals** as an HTML/CSS overlay above the canvas, for crisp, readable simulation-software panels.
5. **Simulation is separate from rendering from Phase 1.** `src/sim` is pure TypeScript with no three.js and no DOM. The rule is enforced by a separate tsconfig with no DOM lib, plus ESLint import boundaries. It runs in a Web Worker, in Node for tests and the headless host, and in Electron.
6. **Host-authoritative from Phase 1.** Single-player is a Host plus a local Client over an in-process loopback transport. Multiplayer swaps in a WebSocket transport. Nothing else changes.

## Architecture

```
corduroy/
  src/sim/       World model, Commands, fixed-step clock, terrain data, snow, weather, snowmaking,
                 lifts, park features, AI, economy, permissions, serializer   (pure TS)
  src/net/       protocol + versioned binary codec, transports: loopback | ws | (future) relay/WebRTC
  src/render/    renderer/presets/dynamic-res, terrain CDLOD, snow material, sky/atmosphere, clouds,
                 forest (instanced + impostors), lifts, vehicles, characters, post, perf HUD
  src/game/      input, camera rigs + camera registry, on-foot/skiing, vehicle controllers, editor tools
  src/ui/        Preact: menus, HUD, Ops Center, construction/terrain/park panels, settings
  src/platform/  storage backends (Electron fs | OPFS), Electron bridge
  src/workers/   sim worker entry
  electron/      main process: window, file IO (atomic), LAN host server, discovery beacon
  tests/         unit (vitest/node) · integration (headless host + N clients, save fuzz) · e2e (playwright) · perf (bench scenes)
  tools/         asset fetchers (Poly Haven / ambientCG APIs), optimizer (gltf-transform, KTX2), lookdev scene
  docs/          ARCHITECTURE, ROADMAP, PERFORMANCE, SAVE_FORMAT, NETWORK_PROTOCOL, ART_BIBLE, CODING_STANDARDS, ASSETS (license manifest)
```

**Core rules**

- **Every world change is a `Command`.** That covers building a lift, a sculpt stroke, placing a park feature, changing a setting. The host validates it (rules and permissions), applies it, writes it to the journal and broadcasts it. One path gives multiplayer sync, undo/redo, crash journaling and permission checks.
- **Continuous state is streamed, not commanded.** A player's own avatar or vehicle is owner-simulated, so driving has no lag. The host checks permissions and plausibility. Everything else is simulated by the host and replicated: snow, lifts, AI, weather, snowmaking.
- **Sim state uses SharedArrayBuffers.** Heightfield and snow grids are struct-of-arrays typed arrays shared between the worker and the main thread with no copying, which needs COOP/COEP headers on Vite, Electron and the host server. The renderer uploads only dirty tiles.
- **Fixed-step simulation with an adjustable game clock** (1×/10×/60×). Fast processes substep, and slow ones (weather, snow metamorphism, sintering) take macro-steps, so high time scales stay stable.
- **Hot paths allocate nothing per frame:** pools and typed arrays, to avoid GC hitches. WebGPU `device.lost` is handled by rebuilding GPU resources from sim state.

**System designs (summaries; each gets a docs section and a project skill when its phase starts)**

- **Terrain:**
  - Maps of 1, 2 or 4 km per side on a **1 m heightfield**. 4096² f32 is 64 MB.
  - GPU CDLOD rendering: instanced grid patches, vertex displacement in TSL with manual bilinear `textureLoad`, so it needs no float32-filterable texture support. Distance morphing prevents cracks and popping.
  - Slope and altitude rock exposure, painted layers, detail normals.
  - A far ring and horizon peaks beyond the map boundary.
  - Brush edits are Commands that update region tiles in both the CPU array and the GPU texture.
- **Snow, at two resolutions:**
  - A coarse 2 m field covers the whole map: depth, SWE (snow water equivalent), density, temperature and wetness, surface type.
  - Sparse fine tiles (32 m tiles at 0.25 m) are allocated only where pistes, the park or activity exist, and paged out when idle. They hold height offset, hardness, groom direction and age, moisture and track mask.
  - CPU rules in the worker conserve mass, which unit tests check:
    - pressure compaction from each vehicle's ground pressure,
    - tiller mixing to ~420 kg/m³,
    - blade carry and deposit volume,
    - sintering and hardening over time, melt and refreeze to ice,
    - skier wear, scraping and mogul growth,
    - snowfall density by temperature, and wind drift.
  - Visuals come from displacement in a near-field high-res ring around the camera, plus synthesized normals, a procedural corduroy pattern driven by groom direction and age, sparkle, and a subsurface tint. Fresh-groomed and untouched slopes look clearly different.
- **Snowcats:**
  - A Rapier chassis.
  - 8 bogie wheels per side, raycast against the snow surface, with sinkage from a simplified Bekker pressure–sinkage model by snow type.
  - Traction limited by Mohr–Coulomb shear: cohesion plus pressure·tanφ.
  - Hydrostatic left/right drive with a diesel torque curve and joystick steering.
  - A 12-way blade (lift, tilt, angle, wings), a tiller (depth, pressure, rpm, finisher), and a winch (anchor, cable length, tension setpoint, catenary visual).
  - Grooming modes: standard piste, finish, redistribution, park, winch-assisted steep, removal.
  - The snowmobile has a separate ski-plus-track model.
- **Lifts:**
  - Types: fixed-grip, detachable, gondola, T-bar, rope tow, conveyor.
  - The route is built from stations and towers, with parabolic or catenary sag from rope tension and carrier load.
  - Construction checks: ground clearance, maximum span, breakover angle (which sets sheave count), slope limits.
  - Mechanics run as 1D drive dynamics: motor torque against the load torque from carrier weight on each side, plus bearing friction.
  - States: start, run, slow, stop, emergency stop, fault.
  - Wear on bearings, sheaves, grips and motor causes failures.
  - Wind-hold limits. Carriers swing like pendulums when the lift stops and when the wind blows.
  - Detachable grips use the station tire conveyor. Passengers flow through queue maze, gates, loading and unloading.
  - Chairs are instanced. Towers, sheave trains and terminals are procedural and parametric.
- **Terrain park:**
  - Parametric features with exact parameters: kicker transition radius and lip angle, table, knuckle, landing angle and length, width, and halfpipe radius, vert and flat.
  - They are rasterized as height functions into 0.125 m park patches and smooth-max blended into the snow, so transitions look natural, not boxy.
  - Rails and boxes are objects with auto-sculpted in-runs and out-runs.
  - Tools: a **speed-check trajectory preview**, wear and degradation, inspection overlays, grooming by park cat, and JSON park presets that can be shared in multiplayer.
- **Weather and environment:**
  - Host-side fronts drive temperature (−6.5 °C/km lapse rate), relative humidity, wind with ridge speed-up, clouds, precipitation and visibility.
  - Valley inversion fog, a diurnal cycle and season progression.
  - Wet-bulb temperature via Stull 2011 controls snowmaking output and quality.
  - Rendering: a physically based sky, CSM shadows, height fog and aerial perspective, low-res temporally reprojected volumetric clouds on High and Ultra (2D layers on Low), GPU compute snowfall in a camera volume, spindrift, and night lighting on pistes, towers, cats and windows.
- **Snowmaking:**
  - A water network graph: reservoir, pumps with head curves, pipes with Hazen–Williams loss, hydrants.
  - Guns and lances with nozzle settings.
  - Output, density and wetness depend on wet-bulb, wind and pressure.
  - Group control and schedules.
- **AI visitors and staff:**
  - A resort graph: pistes as directed edges with difficulty and conditions, lifts with queues, buildings, walkways.
  - Utility-based choices by ability, preference, fatigue, hunger, weather and queue length.
  - Three simulation tiers: up to 40 near agents get full ski-lite physics and procedural animation, up to 400 steer along lanes, and the rest move along the graph on timers.
  - Procedural parametric characters. Helmets, goggles and bulky clothing make procedural skiers credible.
  - Rocketbox avatars (MIT) are evaluated for staff and close-ups.
- **Cameras and Ops Center:**
  - A camera registry: first-person, third-person, chase and interior rigs, free-fly, overview, plus auto-created station, lift-line, park and fixed cameras, and cameras you place.
  - The Ops Center has a 2D map with overlays (lift status, cats, snowmaking, groom-age heatmap, wind) and a monitor wall. Feeds render at low resolution and a capped rate, rotating within a fixed GPU budget.
  - Map selection leads to monitor or "take control".
- **Saves** (top priority):
  - A single-file container per slot: header, table of contents, sections compressed with deflate, CRC32 per section, and a whole-file hash. Schemas are versioned with tested migrations.
  - **Atomic write:** write a temp file, fsync, rename. The Electron backend uses real files; the browser backend uses OPFS generations with a pointer file.
  - Rotating backups. Autosave every 2 minutes runs serialization and compression in the worker, with a main-thread hitch budget under 2 ms.
  - A **command journal**, fsynced every ~2 s between autosaves, means a crash loses seconds, not minutes.
  - An unclean-shutdown flag triggers a Recover dialog: last save plus journal, or a chosen backup.
  - The HUD shows "Last saved Xs ago" and warns loudly when a save fails. Exit triggers a save.
- **Multiplayer (LAN first):**
  - The Electron host runs a `ws` server and a UDP broadcast beacon. Joiners can discover sessions or enter IP:port manually, which covers hotspots that isolate devices.
  - A versioned handshake. Late join streams **the same bytes as a save file**, so there's one serializer.
  - After that: commands are reliable and ordered, entity streams run at 20–30 Hz with interpolation, and interest management limits snow tiles and agents to what each player is near.
  - Roles and permissions are enforced on the host: build, terraform, park, drive, lifts, snowmaking, weather and time, save. Disabled controls are hidden, not left as dead buttons.
  - Starts at **4 players** and rises to 8 after testing. The transport interface leaves room for a future online relay or WebRTC.
  - Plain-browser joiners get WebGL2 only, because WebGPU needs a secure context.
- **Economy:** tickets, food and drink, wages, energy and construction costs in a single panel. Sandbox mode is unlimited.

## Performance strategy (M2 Air, 8-core GPU, fanless)

**Budgets (High preset, 1080p-class internal resolution, 60 fps target with a 30 fps fallback cap):**

| Resource          | Budget   |
| ----------------- | -------- |
| GPU               | ≤ 12 ms  |
| Main-thread CPU   | ≤ 8 ms   |
| Draw calls        | ≤ 400    |
| Visible triangles | ≤ 4 M    |
| Texture memory    | ≤ 1.2 GB |
| JS heap           | ≤ 1.5 GB |
| Whole process     | ≤ 4 GB   |

**Techniques:**

- GPU-driven terrain.
- Instancing everywhere, plus compute-shader frustum culling with indirect draws for trees, carriers and people.
- Octahedral tree impostors baked at load.
- Simulation level of detail by distance.
- Dynamic resolution, ported from flight-808's `adapt()`.
- KTX2/Basis textures transcoded to ASTC, which Apple GPUs decode natively, and meshopt geometry compression.
- Cached far shadow cascades.
- Pipeline warm-up with `compileAsync` on the loading screen.
- Presets Low, Medium, High, Ultra and Custom, plus a "Thermal" mode.

**Biggest risks and their mitigations:**

| Risk                                                                       | Mitigation                                                            |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| (1) Sustained thermal throttling after ~10 min                             | 20-minute soak tests, budget headroom, 30 fps cap, dynamic resolution |
| (2) Alpha-tested foliage defeats Apple's tile-based hidden-surface removal | Impostors early, strict alpha-pixel budget                            |
| (3) Shadow distance in vast vistas                                         | Cached and impostor shadows                                           |
| (4) Snow detail memory                                                     | Sparse paged tiles                                                    |
| (5) Night scenes with many lights                                          | Tiled lighting, shadows only for the player's vehicle                 |
| (6) Crowds plus chairs                                                     | Instancing, simulation tiers                                          |
| (7) Ops Center feed cost                                                   | Fixed feed budget                                                     |
| (8) GC and pipeline-compile hitches                                        | Allocation-free hot paths, pipeline warm-up                           |
| (9) Unified-memory pressure on 16 GB with low disk                         | Hard memory budgets                                                   |

**Measurement:**

- A perf HUD with per-system CPU ms and GPU ms from WebGPU timestamp queries.
- `npm run bench` flies a fixed camera path through scripted scenes: valley at sunset, dense forest, busy station with 300 visitors, a night storm with 6 cats. It runs in headed Chromium and in Electron on this Mac and writes `perf/results/*.json`.
- Plugged-in versus battery is recorded with every result.
- I'll make no performance claims without these numbers.

## Hardest systems, in order of risk

1. Snow simulation, deformation and rendering at mountain scale.
2. Tracked-vehicle physics on deformable snow, including the winch.
3. Parametric park sculpting with natural blending and wear.
4. Lift mechanics, construction validation and detachable passenger flow.
5. Crowds with believable variety and animation quality.
6. Snow and terrain replication with late join.
7. Forest and atmosphere quality inside the thermal budget.
8. Hitch-free crash-safe saves of large worlds.

## Assets and art direction

**Art direction:** grounded realism with physically based lighting.

**Original fictional brands only:** no PistenBully, Prinoth, Doppelmayr or Leitner names or logos, and nothing from the reference games.

**Sources:**

- Procedural, parametric meshes in code for cats, lift towers and stations, buildings, trees, park features and characters.
- CC0 textures, sky images and rock scans from **Poly Haven** and **ambientCG**, fetched by script.
- Other internet assets only under CC0, CC-BY or MIT. No non-commercial-only licenses, unclear licenses or game rips.

**Consistency gate before any asset ships:**

- Each asset is logged in `docs/ASSETS.md` and `assets/manifest.json` with source URL, author, license and date.
- Complete PBR texture sets, source resolution 2K or higher, consistent texel density, physically plausible albedo (snow ≈ 0.85–0.9).
- **Review in a fixed lookdev scene** under day, overcast and night lighting, scored with the installed `threejs-aaa-graphics-builder` visual scorecard. Visible features must have no category below 2 and an average of at least 2.3.

Raw downloads stay gitignored; only optimized runtime assets are committed. git-lfs gets installed if runtime assets grow past ~300 MB.

## Repo, GitHub, QA process

- **Repo:** `~/corduroy`, a **private** GitHub repo `AuriboyScare/corduroy`. You can rename it or make it public later.
- **Branching:** one branch per phase or system, PRs through `gh` with green CI, and a tag at each phase exit (`phase-1-complete`, …). Small, meaningful commits.
- **CI (GitHub Actions):** lint, typecheck, unit, integration (save fuzz and network), build, and a Playwright smoke test on WebGL2, since Linux runners have no GPU. GPU, visual and performance tests run locally on the M2, which is the target device.
- **Bug tracking:** GitHub Issues with severity and system labels, mirrored in the Known Bugs section of `DEVELOPMENT_STATUS.md`. The rule is to fix existing bugs before adding features.
- **Test API:** `?debug=1` exposes `window.__corduroy`: teleport, set time and weather, spawn, run scripted scenarios, query state. It drives e2e and benchmarks.
- **Golden views:** visual baselines per phase with a fixed seed and frozen time, using the qa-release canvas inspector.

## Claude Code organization (what exists vs what I'll create)

**Already available and used:**

- `threejs-game-director`, `threejs-aaa-graphics-builder` (scorecard), `threejs-debug-profiler`, `threejs-qa-release`, plus the threejs fundamentals, shaders, lighting and other reference skills.
- context7 MCP, for current three.js r187, TSL and Rapier docs.
- Playwright MCP and @playwright/test.
- Not used: the generator skills (no keys) and Unity MCP (it doesn't apply).

**To create in the repo:**

- **`.claude/agents/`, 13 agents as you asked:** technical-director, environment-artist, terrain-engineer, snow-sim-engineer, vehicle-engineer, lift-systems-engineer, gameplay-engineer, ai-engineer, multiplayer-engineer, ui-ux-designer, graphics-engineer, performance-engineer, qa-engineer.
  - Each one lists the directories it **owns**, the standards it follows, and the checks it must pass before finishing.
  - qa-engineer and performance-engineer are review-only, with no Write access.
  - **Usage policy, to be honest about cost:** I act as lead and integrator. I dispatch an agent only for well-isolated work packages, each in its own git worktree with disjoint file ownership, and for QA review at phase exits. Core systems never have two writers at once.
- **`.claude/skills/`, 10 project skills:**
  - `threejs-webgpu` (TSL conventions and pitfalls; it complements the installed skills rather than duplicating them),
  - `terrain-system`, `snow-simulation`, `vehicle-physics`, `lift-systems`,
  - `multiplayer-architecture`,
  - `performance-m2` (budgets, bench and soak commands),
  - `automated-testing`,
  - `asset-pipeline` (sourcing rules, license manifest, KTX2/meshopt, lookdev),
  - `save-system`.
  - Phase 0 writes the ones whose content is already real: testing, perf, assets, webgpu, save. Each system's skill is written when its phase starts, from working code, not guesses.
- **Hooks (`.claude/settings.json`):**
  - **PostToolUse** (Edit/Write on `*.ts`/`*.tsx`): Prettier plus ESLint `--fix` on that file.
  - **Stop:** `npm run check:quick` (typecheck plus unit tests). On failure it exits 2 so I fix things before reporting. It respects `stop_hook_active` so it can't loop.
  - **SessionStart:** prints the next priorities from DEVELOPMENT_STATUS and a **disk-free warning** below 5 GB.
  - **PreToolUse (Bash):** blocks force-pushes to `main`.
- **`CLAUDE.md`:** commands, architecture rules (sim purity, Commands, no per-frame allocation), and the definition of done.

## Roadmap with phase exit gates

Every phase exit requires:

- playable in the real app,
- all tests green,
- bench numbers recorded and within budget, or the gap documented,
- golden views and scorecard,
- `DEVELOPMENT_STATUS.md` updated,
- the PR merged and the phase tagged.

| Phase                 | Deliverables                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Exit gate                                                                                                                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **0 Setup**           | Repo, Vite/TS/Electron skeleton, lint and boundaries, Vitest and Playwright, CI, docs, agents, skills, hooks, DEVELOPMENT_STATUS                                                                                                                                                                                                                                                                                                                               | `npm run check` and CI green. An Electron window and Playwright Chromium both report a WebGPU adapter and can screenshot the canvas                                                                          |
| **1 Foundation**      | Renderer with presets, dynamic resolution and perf HUD. Sim worker, Commands, loopback host and client. 2×2 km procedural test mountain with CDLOD terrain and snow material v1. Sky, sun, CSM shadows and fog. One procedural spruce with LOD and impostor, ×50k instanced. Cameras: free-fly, overview, first- and third-person on foot. **The full save system** (atomic, backups, 2-minute autosave, journal, recovery, indicator). Bench and soak harness | A good-looking snowy mountain you can walk and fly around. Measured Low/Med/High/Ultra numbers. Save→load is exact. Kill-during-write fuzz passes (SIGKILL at random points, the previous save always loads) |
| **2 Mountain**        | Main menu, mountain selection, settings. Terrain brushes (raise, lower, smooth, flatten, ridge, valley, bowl, cliff). Forest paint and removal, rocks. Trails with names and difficulty. Boundaries. Weather v1 (snowfall, wind, fog, clouds, temperature). Day/night polish. 2 prebuilt map shells (alpine + family). Custom mountain creation and sandbox                                                                                                    | Create, edit and save a custom mountain. Exit, reload, and it's identical. Weather visibly changes conditions                                                                                                |
| **3 Vehicles & snow** | Snow grid sim, snowcat with blade, tiller and winch, grooming modes, tracks, snowmobile, snowmaking network with wet-bulb, schedules                                                                                                                                                                                                                                                                                                                           | You can groom a piste and see corduroy against untouched powder. Mass-conservation tests pass. Wet-bulb gating is correct. Vehicles feel distinct                                                            |
| **4 Lifts**           | Construction tool with validation, all lift types, mechanics, failures, wind holds, passenger flow, lift operator controls                                                                                                                                                                                                                                                                                                                                     | Build, run, emergency-stop and repair a detachable lift with passengers                                                                                                                                      |
| **5 Terrain park**    | Feature library with exact parameters, sculpt blending, speed check, wear and maintenance, presets, skiing and snowboarding the park                                                                                                                                                                                                                                                                                                                           | Build and ride a slopestyle course. Presets save, load and share                                                                                                                                             |
| **6 Resort**          | Buildings, AI visitors and staff, economy, camera registry, Ops Center                                                                                                                                                                                                                                                                                                                                                                                         | Hundreds of visitors use lifts, trails and buildings within budget                                                                                                                                           |
| **7 Multiplayer**     | LAN host, discovery, manual IP, permissions, late join, shared building and driving                                                                                                                                                                                                                                                                                                                                                                            | Headless 4-client tests with latency and loss injection, then **real Wi-Fi and phone-hotspot tests with you on a second device**                                                                             |
| **8 Polish**          | Asset detail, audio (procedural engine synthesis plus CC0 or royalty-free recordings), animation, UI, profiling, regression and save-fuzz sweeps                                                                                                                                                                                                                                                                                                               | Release candidate `.app`                                                                                                                                                                                     |

Remaining prebuilt resorts (North American, steep freeride, park-focused) are authored as lifts, park and buildings land (Phases 4–6), using the game's own editors.

## Immediate execution after approval

1. Save a memory: the Corduroy project, the engine decision and why, the disk constraint.
2. **Phase 0:**
   1. Scaffold `~/corduroy`.
   2. `npm install` the pinned versions.
   3. Set up tsconfig layers, ESLint boundaries and Prettier.
   4. Electron main and preload with COOP/COEP.
   5. WebGPU adapter check page.
   6. Vitest and Playwright configs.
   7. CI workflow.
   8. docs and DEVELOPMENT_STATUS.
   9. `.claude` agents, skills and hooks.
   10. `gh repo create --private`.
   11. First commit and PR.
3. **Phase 1, in this order:**
   1. Sim core, Commands and loopback.
   2. Save system with tests and fuzzing. It comes early because everything plugs into it.
   3. Renderer, presets and perf HUD.
   4. Terrain data, then CDLOD rendering, then the snow material.
   5. Sky, shadows and fog.
   6. Forest.
   7. Cameras and on-foot controller.
   8. Bench and soak.
   9. Golden views, scorecard, status update.
4. Progress reports at milestones: end of Phase 0, after the save system, after first rendered terrain, and at the Phase 1 exit with measured numbers.

## Verification

| Command                                                           | What it checks                                                                                                                                                                |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                                                   | Lint, typecheck, unit, integration, build. It must be green on every commit, and the Stop hook enforces it                                                                    |
| `npm run test:e2e`                                                | Playwright on headed Chromium (WebGPU) and Electron through `_electron.launch`: boot, menus, camera switching, save, quit, relaunch, identical world                          |
| `npm run test:save-fuzz`                                          | A child process saves in a loop and gets SIGKILLed at random points. Every surviving slot loads, and CRC corruption falls back to a backup                                    |
| `npm run test:net`                                                | Headless host plus N clients with injected latency and loss. Checks world-hash convergence and late join                                                                      |
| `npm run bench -- --scene=<name> --preset=<p>` and `npm run soak` | Results committed to `perf/results/` and summarized in DEVELOPMENT_STATUS with power-source notes                                                                             |
| Visual                                                            | Golden-view screenshots and the qa-release canvas inspector metrics, scored with the aaa-graphics scorecard. I read every capture myself before calling a visual feature done |

## Needs you (not blocking Phase 0–1)

- Optionally free ~15 GB of disk for stability.
- A second device for Phase 7 Wi-Fi and hotspot tests.
- Playtest feedback on feel at each phase exit.
- If you ever share the app: it's unsigned, so friends right-click and choose Open, and macOS will ask for Local Network permission.

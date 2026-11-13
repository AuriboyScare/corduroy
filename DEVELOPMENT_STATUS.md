# Development status

Last updated: 2026-11-13 (playable prototype, on branch `prototype-snowcat`)

## Completed systems

Each of these is covered by automated tests and was checked in screenshots of the running game.

- **Mountain**: procedural 2 km massif with a graded piste (centreline at most 20 degrees), a level depot pad, about 25,000 trees placed off the piste, and low-detail terrain out to the horizon.
- **Snowpack**: two layers (consolidated base, variable-density top) on a 1 m grid. Cutting, filling, compaction and tilling conserve mass. Surface detail (corduroy, track marks, travel direction) is stored in sparse 0.25 m tiles with a 2 m whole-map summary.
- **Snowcat (Kestrel 420)**: ten sprung track contacts, snow-dependent grip, skid steering, engine power limit, sinkage and motion resistance in loose snow, tree collisions. Blade cuts, carries, fills and spills snow. Tiller mills and re-lays the surface, with quality that drops when driven too fast. Tracks compact snow and spoil grooming.
- **Autopilot** that follows a path; it grooms the whole piste up and down in the integration test.
- **Rendering**: chunked terrain with four detail levels, rebuilt where snow changes; snow material that separates powder, track marks and corduroy near and far; sky, sun shadows, haze; instanced forest with two detail levels; procedural snowcat model with animated cleats, wheels, blade linkage and tiller.
- **Game**: chase, cab and free-fly cameras; keyboard driving; instrument HUD; synthesized engine, track, tiller and hydraulic sound.
- **Tooling**: 31 unit and integration tests, 6 browser and Electron tests (one of them also runs in CI), CI, hooks, agents, skills, `tools/shot.mjs` (screenshots) and `tools/bench.mjs` (frame pacing).

## In progress

- Phase 1 foundation items that the prototype skipped (see Outstanding tasks).

## Not built yet (nothing below exists in the game)

- **Saving and loading. Progress is lost when the game closes.** This is the next priority.
- Lifts, terrain park editor, snowmaking, weather and time of day, AI visitors, buildings, economy, multiplayer, menus, settings and graphics presets, skiing and on-foot movement, winch, other vehicles, terrain editing.

## Known bugs and limitations

- Fixed 2026-11-13: two presses of the same key inside one frame counted as one (seen in CI at 1 fps; possible on the Mac during a hitch).

- The simulation runs on the main thread, not in a worker, and there is no host/client command layer yet. The simulation code is already free of rendering and browser dependencies, so this is a wiring task.
- The parked machine creeps slowly on steep slopes (about 1 m per minute at 15 degrees); there is no parking brake.
- Track ruts and corduroy are shading only; the snow surface geometry is 1 m resolution, so ruts are not physically indented at close range.
- Terrain does not cast shadows on itself, and shadows cover only about 120 m around the focus.
- Distant trees are simplified meshes, not impostors; the horizon terrain is coarse and has no trees.
- Blade has lift only (no tilt, angle or float). Tiller has no depth or pressure control.
- Sound has not been judged by ear; it is synthesized from simulation state and may need tuning.
- No dynamic resolution or quality presets. Internal resolution is capped at about 1200 lines.
- Rock is procedural shading; no sourced textures are in use yet.
- `npm audit` reports a moderate advisory in `minimatch`, pulled in by ESLint 10 (development tooling only).

## Performance measurements

| Date       | Scene                         | Result                      | Power   | Notes                                                        |
| ---------- | ----------------------------- | --------------------------- | ------- | ------------------------------------------------------------ |
| 2026-11-12 | Chase camera, grooming uphill | 60 fps, worst frame 17.7 ms | Battery | 1728x1000, Chrome 157, 10 s, 2.3 M triangles, 299 draw calls |
| 2026-11-12 | Cab camera, grooming uphill   | 60 fps, worst frame 17.6 ms | Battery | 2.6 M triangles, 380 draw calls                              |
| 2026-11-12 | Aerial over forest and piste  | 60 fps, worst frame 17.6 ms | Battery | 2.2 M triangles, 379 draw calls                              |
| 2026-11-12 | Low over forest toward summit | 60 fps, worst frame 17.7 ms | Battery | 2.7 M triangles, 258 draw calls                              |

These runs are capped by the display at 60 fps, so they do not show how much headroom is left, and at 10 seconds they say nothing about heat build-up. GPU timing and a 20-minute soak test are still to do. Mountain generation takes about 1.3 s in the browser.

## Outstanding tasks

- Perf HUD with GPU timing, soak test, quality presets, dynamic resolution.
- Move the simulation into a worker behind the host/client command layer.
- Project skills to write: save-system, terrain-system, snow-simulation, vehicle-physics, lift-systems, multiplayer-architecture.
- Docs to write when implemented: SAVE_FORMAT, NETWORK_PROTOCOL, ART_BIBLE.
- Packaging to a `.app`.

## Next priorities

1. Save system: versioned container, atomic writes, rotating backups, 2-minute autosave, recovery, visible last-saved time, kill-during-write test.
2. Snowcat depth: winch, blade tilt and float, tiller depth, parking brake, work lights.
3. Perf HUD with GPU timing, soak test, presets and dynamic resolution.
4. Worker and command layer.
5. Main menu, weather and time of day.

# Development status

Last updated: 2026-11-14 (branch `ui-theme`)

## Completed systems

Each is covered by automated tests (96 unit and integration, 11 browser and Electron) and was checked in screenshots of the running game.

- **Resort layout**: four runs (Nursery, Long Meadow, Kestrel, Falcon Face) graded to their difficulty and split into ~150 m sections; base area; marker poles along every run; trail signs; boulders.
- **Snowpack**: two layers on a 1 m grid; mass-conserving cutting, filling, compaction, tilling, and slumping to the angle of repose; thin natural base low down; tiller finish limited by consolidated cover depth; sparse 0.25 m surface-detail tiles.
- **Machines**: Kestrel 260, 420 and 600W, each with its own size, power and implements; eight upgrade types with levels that change the simulated machine (engine, tracks, tiller width, blade, hydraulics, finisher, work lights, cruise control). Power-limited hydrostatic drive; spawns square to slopes.
- **Winch** (600W): constant tension, auto pay-out, engine load when reeling in, cable-end interlock; three anchors.
- **Career**: money from grooming by quality and difficulty, section and run bonuses, lift tickets; garage for buying machines and upgrades and swapping machines. Sandbox mode.
- **Lifts**: rope tow, fixed-grip quad, detachable gondola, aerial tram. Automatic tower placement with clearance under both ropes; sagging rope; carriers looping round bullwheels; gondola cabins slowing in stations; tram shuttle with dwell; drive with start, stop, emergency stop and speed; swing on hard stops; riders and ticket income that follow grooming and cover.
- **Weather and snowmaking**: game clock (30x), daily temperature swing, fronts, humidity, wind, lapse rate; wet-bulb from the psychrometer equation at altitude. Snow guns per run (off/auto/on), output by wet-bulb, dense snow laid downwind into the run, water and power cost.
- **Day and night**: sun and moon by the clock; the driven machine's work lights at night.
- **Saving**: versioned, checksummed, compressed container; atomic writes with five backups (desktop) or the browser's private file system; autosave every 2 minutes, F5, on quit, on tab hide; recovery from backups; Continue in the start menu. Format version 3 with migrations from 1 and 2. Loaded games continue bit for bit.
- **Sound**: diesel engine, tracks, tiller, blade, hydraulics, winch and reversing alarm synthesized on the audio thread from simulation state, placed in 3D, muffled in the cab; wind.
- **Effects**: tiller spray, track kick-up, blade berm and spill, exhaust, snow-gun mist.
- **Interface**: night-operations theme with bundled Barlow type and original line icons. Start menu over an illustrated dusk mountain, saved games shown as lift tickets. Machine cluster with tachometer, engine-load lamps, implement states and an inclinometer; snow-pit profile with conditions; trail report board with corduroy section bars and a day/night clock; dispatch-style notices; grouped controls card. Garage with machine silhouettes per model, spec bars that show upgrade gains, and an icon per upgrade. Lift console with status lamps, readouts and an emergency-stop button; snowmaking console with a wet-bulb gauge, gun lamps and an Off/Auto/On selector. Panels close on Esc or a click outside.
- **Rendering**: chunked terrain with detail levels; snow material for powder, track marks and corduroy; forest of spruce, fir and pine; garage; lifts; snow guns.

## Not built yet

- Snowmobile with a towed drag (the planned starter machine), other utility vehicles.
- Skiing visitors on the runs (riders exist only on lifts), skier wear on grooming, natural snowfall, AI operators for machines you are not driving.
- Building or moving runs and lifts (they are fixed in the layout), terrain editing, terrain park.
- Multiplayer.

## Known bugs and limitations

- **Draw calls over budget.** The game holds 60 fps in all four bench scenes (2026-11-14), but draws 367-585 calls against a budget of 400. Likely fixes: shadow-pass draw calls, merging small meshes. The earlier 34-55 fps readings were caused by other GPU work on the Mac.
- Riders on lifts are simple shapes that look crude up close; the gondola station is a plain box.
- Snow guns are silent; there is no stars or moon disc in the night sky.
- The parked machine creeps slowly on steep slopes; there is no parking brake.
- Track ruts and corduroy are shading only at close range.
- `npm audit` reports a moderate advisory in `minimatch` via ESLint (development tooling only).

## Performance measurements

| Date       | Scene                  | Result                | Power                | Notes                                  |
| ---------- | ---------------------- | --------------------- | -------------------- | -------------------------------------- |
| 2026-11-12 | Chase, grooming uphill | 60 fps, worst 17.7 ms | Battery              | Before lifts and props; display-capped |
| 2026-11-13 | Chase, grooming uphill | 34 fps, p99 50 ms     | Mains, battery at 5% | Other GPU work running; not reliable   |
| 2026-11-13 | Low over forest        | 52 fps, p99 33 ms     | Mains, battery at 5% | Other GPU work running; not reliable   |
| 2026-11-14 | Chase, grooming uphill | 60 fps, worst 16.7 ms | Mains                | 1728x1000, 496 calls, 3.2 M triangles  |
| 2026-11-14 | Cab, grooming uphill   | 60 fps, worst 16.7 ms | Mains                | 585 calls, 3.7 M triangles             |
| 2026-11-14 | Aerial over forest     | 60 fps, worst 50 ms   | Mains                | 566 calls; one frame over 20 ms        |
| 2026-11-14 | Low over forest        | 60 fps, worst 16.7 ms | Mains                | 367 calls, 4.5 M triangles             |

## Next priorities

1. Bring draw calls under 400 without losing the steady 60 fps.
2. Snowmobile with drag as the starter machine.
3. Skiers on the runs and grooming that wears through the day, so runs need regrooming each night.
4. Rider and station detail; snow gun sound; night sky.

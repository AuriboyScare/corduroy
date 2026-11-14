# Visual audit and overhaul plan

Audit of the running game on 2026-11-14 (commit after PR #4), from close-up screenshots of every machine, lift, snow gun and building, by day and night. It answers why the objects look crude and sets the order of the overhaul.

## Findings

### Machines (Kestrel 260, 420, 600W)

| Problem | Evidence |
| --- | --- |
| One model for all three | The 260 and 600W are the 420's hull scaled by 0.86 and 1.1 with different paint. The silhouettes are identical. |
| Primitive shapes | The engine deck is one box, the cab is a transparent box with four square posts, and the roof is a flat slab. Nothing is chamfered or rounded. |
| Missing mechanical parts | No track frames, bogie arms or suspension; road wheels are plain cylinders; no grilles, service panels, door seams or handles, steps, ladders, hoses, warning decals or mirrors that read at a distance. |
| Implements read as boards | The blade has a curved face but no ribs or push frame. The tiller is a swept shell and two boxes. The winch is a box frame and a drum. |
| Flat materials | Every painted part is one colour at one roughness, with no wear, grime, snow build-up or edge highlights. |
| Weak interior | From the seat the view is the blade top and a wiper line. The dashboard is a dark slab with one lit rectangle; there are no screens, joysticks or seat. |
| Upgrades are invisible | Only blade and tiller width change the model. |

### Lifts

| Problem | Evidence |
| --- | --- |
| Stations are shelters | Chair and gondola stations are a flat roof on four thin posts and a hut. The tram station is a plain grey box. There is no bullwheel, drive, platform, gate, operator cabin or sign. |
| Towers are poles | One thin pole with a bar crossarm, no sheave trains, foundation, ladder or work platform. |
| Rope tow | A small black box with a disc. |
| Carriers are boxes | Chairs and gondola cabins are coloured boxes; riders are simple shapes. |

### Snowmaking, buildings, night

| Problem | Evidence |
| --- | --- |
| Snow gun | A white cylinder on a pole with a crossbar. No fan guard, nozzle ring, yoke, wheels, hydrant or hose. |
| Buildings | The garage and lodge are boxes with flat slab roofs and no windows, doors or trim. |
| Night | Night is daytime dimmed and tinted blue: no stars, no lit windows or station lights, and only the driven machine has lights. |

The terrain, forest and snow surface are an acceptable base and stay as they are.

### Root causes

1. Models are built from axis-aligned boxes and cylinders, with almost no profiles, bevels or sub-parts.
2. One model is scaled for three machines instead of each machine having its own build.
3. Materials have no variation: no wear, grime, trim colours or decals.
4. Lights exist only on the driven machine, so night has nothing to look at.

This is not a texture problem: textures on these shapes would still look like boxes.

## Approach

- **Shapes from profiles.** Panels, cabs, blades and housings are extruded and swept from 2D profiles with bevels, so edges catch the light. Parts are merged per material, as now, so detail does not cost draw calls.
- **Per-model builds.** Each machine has its own build, with its own proportions and equipment: the 260 short and narrow with a single-bar light rack, the 420 a full-size groomer, the 600W long and heavy with a winch tower, a cable drum and double lights.
- **Materials with wear.** Shared node materials add grime toward the tracks, snow on horizontal surfaces, and darker panel seams. Decals carry maker marks and warning stickers.
- **Detail levels.** A detailed near model and a merged far model, switched by distance, for machines, towers, carriers and people.
- **Lights where people work.** Station floodlights, lit cabin and building windows, tower lamps and lights on every running machine.

## Order of work

Each step is its own branch and pull request, playable, tested and measured before the next.

1. **Machines.** New per-model groomers with full exterior detail, working interiors with live screens, visible upgrades and detail levels.
2. **Multiplayer foundation.** Host-authoritative sessions that work from the public web build. Done early so every later system is built for it.
3. **Lifts.** Towers with sheave trains, stations with bullwheels and platforms, chairs, gondola cabins, the tram, lighting.
4. **Skiers and the resort day.** Skiers and snowboarders who ski the runs, queue and ride lifts, and wear the grooming; lifts open by day; grooming at night; adjustable day length; night lighting.
5. **Snowmobiles and progression.** Utility snowmobiles and a tracked utility vehicle as the first stage before the groomers.
6. **Snowmaking network.** Gun types, hydrants, pipes, pumps, water and pressure, per-gun control, zones, schedules, spatial sound.
7. **Terrain park editor.** Brushes and parametric features, undo and redo, saved layouts, groomable and rideable.
8. **Resort appeal.** Guest satisfaction from grooming, trails, park, lifts, queues and snow, with guest comments.

Performance is measured with `tools/bench.mjs` before and after each step. The target remains a steady 60 fps on the M2 MacBook Air.

---
name: asset-pipeline
description: Rules for sourcing, licensing, optimizing and approving art and audio assets in Corduroy. Use before downloading or adding any asset.
---

# Asset pipeline

## Sources, in order of preference

1. Procedural meshes and textures generated in code (vehicles, lift hardware, buildings, trees, park features, characters).
2. CC0 libraries: Poly Haven and ambientCG (textures, HDRIs, rock scans).
3. Other internet assets under CC0, CC-BY or MIT only.

Never use: non-commercial or unclear licences, assets ripped from games, real manufacturer names or logos.

## Gate before an asset is committed

- Recorded in `docs/ASSETS.md` and `assets/manifest.json`: source URL, author, licence, date fetched.
- Complete PBR set (albedo, normal, roughness; AO or height where the material needs it), source at 2K or higher.
- Consistent texel density with its neighbours; physically plausible albedo (fresh snow about 0.85 to 0.9).
- Reviewed in the lookdev scene in day, overcast and night, and scored with the `threejs-aaa-graphics-builder` visual scorecard: no category below 2, average at least 2.3.
- An asset that does not match the rest is rejected, even if it is good on its own.

## Storage

- Raw downloads go in `assets-src/` (gitignored). Only optimized runtime files go in `assets/`.
- The disk on the development Mac is nearly full: fetch only what is about to be used and delete rejected downloads.
- The optimizer, lookdev scene and fetch scripts are built in Phase 1; this file is updated with their commands when they exist.

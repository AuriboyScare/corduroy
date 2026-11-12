---
name: threejs-webgpu
description: Corduroy's conventions for three.js r187 WebGPURenderer and TSL. Use when writing renderer, material or shader code in src/render. Complements the installed threejs-* skills, which mostly describe the older WebGL API.
---

# three.js WebGPU in Corduroy

Pinned to three 0.187.0. Look up current API with the context7 MCP before using anything you have not used in this repo; the WebGPU side changes between releases.

## Imports

- Renderer, scene objects and node materials: `three/webgpu`. Shader nodes: `three/tsl`.
- Never import from bare `three` in the same module graph as `three/webgpu`; it loads a second copy of the library.
- Materials are node materials (`MeshStandardNodeMaterial` and friends). `ShaderMaterial` and `onBeforeCompile` do not work on this renderer.

## Setup (see `src/render/createRenderer.ts`)

- `await renderer.init()` before reading features or rendering. `renderer.backend.isWebGPUBackend` tells you which backend was chosen.
- `?gl=1` forces the WebGL2 backend so the fallback can be tested.
- Verified on the development Mac (Chrome 157 and Electron 45): adapter `apple metal-3`, `timestamp-query`, ASTC, BC and ETC2 compressed textures, cross-origin isolation.

## Rules

- Anything that needs compute shaders must check the backend and report "reduced" on WebGL2, not fail silently.
- Sample float data textures with `textureLoad` and manual filtering; do not depend on `float32-filterable`.
- Warm pipelines on the loading screen with `renderer.compileAsync` so first use does not hitch.
- Handle device loss by rebuilding GPU resources from simulation state.
- Cross-origin isolation is required for SharedArrayBuffer. Vite dev and preview send the headers; Electron serves `dist` through the `app://` protocol with the same headers.

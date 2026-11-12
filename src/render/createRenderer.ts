import { WebGPURenderer } from 'three/webgpu';

export interface BootInfo {
  backend: 'webgpu' | 'webgl2';
  adapter: string;
  crossOriginIsolated: boolean;
  /** GPU frame timing; needed by the perf HUD. */
  timestampQuery: boolean;
  textureCompression: { astc: boolean; bc: boolean; etc2: boolean };
  maxTextureSize: number;
  devicePixelRatio: number;
}

export interface RendererOptions {
  canvas: HTMLCanvasElement;
  /** Skip WebGPU even when available (used to test the fallback path). */
  forceWebGL?: boolean;
}

/** Creates and initialises the renderer, reporting what the device actually supports. */
export async function createRenderer(
  options: RendererOptions,
): Promise<{ renderer: WebGPURenderer; info: BootInfo }> {
  const renderer = new WebGPURenderer({
    canvas: options.canvas,
    antialias: true,
    forceWebGL: options.forceWebGL ?? false,
  });
  await renderer.init();

  const backend = renderer.backend as unknown as { isWebGPUBackend?: boolean; device?: GPUDevice };
  const device = backend.isWebGPUBackend ? backend.device : undefined;
  const info: BootInfo = {
    backend: device ? 'webgpu' : 'webgl2',
    adapter: device ? describeAdapter(device) : describeWebGL(renderer),
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    timestampQuery: device?.features.has('timestamp-query') ?? false,
    textureCompression: {
      astc: device?.features.has('texture-compression-astc') ?? false,
      bc: device?.features.has('texture-compression-bc') ?? false,
      etc2: device?.features.has('texture-compression-etc2') ?? false,
    },
    maxTextureSize: device?.limits.maxTextureDimension2D ?? 0,
    devicePixelRatio: window.devicePixelRatio,
  };
  return { renderer, info };
}

function describeAdapter(device: GPUDevice): string {
  const a = device.adapterInfo;
  return [a.vendor, a.architecture, a.description].filter(Boolean).join(' ') || 'unknown';
}

function describeWebGL(renderer: WebGPURenderer): string {
  const gl = renderer.getContext() as unknown as WebGL2RenderingContext;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
}

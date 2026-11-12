import type { BootInfo } from '../render/createRenderer';

/** Phase 0 diagnostic: shows what the renderer negotiated with this machine. */
export function BootPanel({ info, fps }: { info: BootInfo; fps: number }) {
  const tc = info.textureCompression;
  const formats = [tc.astc && 'ASTC', tc.bc && 'BC', tc.etc2 && 'ETC2'].filter(Boolean).join(', ') || 'none';
  return (
    <div class="panel boot" data-testid="boot-panel">
      <h1>Corduroy: renderer check</h1>
      <dl>
        <dt>Backend</dt>
        <dd class={info.backend === 'webgpu' ? 'ok' : 'warn'} data-testid="backend">
          {info.backend === 'webgpu' ? 'WebGPU' : 'WebGL2 (reduced features)'}
        </dd>
        <dt>Adapter</dt>
        <dd>{info.adapter}</dd>
        <dt>Shared memory</dt>
        <dd class={info.crossOriginIsolated ? 'ok' : 'bad'}>
          {info.crossOriginIsolated ? 'available' : 'unavailable (not cross-origin isolated)'}
        </dd>
        <dt>GPU timing</dt>
        <dd class={info.timestampQuery ? 'ok' : 'warn'}>
          {info.timestampQuery ? 'available' : 'unavailable'}
        </dd>
        <dt>Compressed textures</dt>
        <dd>{formats}</dd>
        <dt>Frame rate</dt>
        <dd>{fps > 0 ? `${fps.toFixed(0)} fps` : 'measuring'}</dd>
      </dl>
    </div>
  );
}

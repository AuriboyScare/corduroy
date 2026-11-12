import preact from '@preact/preset-vite';
import { defineConfig } from 'vitest/config';

// SharedArrayBuffer (sim worker <-> renderer) needs cross-origin isolation.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  base: './',
  plugins: [preact()],
  server: { port: 5199, strictPort: true, headers: isolation },
  preview: { port: 5198, strictPort: true, headers: isolation },
  worker: { format: 'es' },
  build: { target: 'esnext', sourcemap: true, chunkSizeWarningLimit: 2000 },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
  },
});

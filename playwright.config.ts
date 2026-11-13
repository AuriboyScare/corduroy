import { defineConfig } from '@playwright/test';

// GPU tests run headed on the development Mac (WebGPU via Metal). CI sets CI=1 and
// runs the same specs headless, where the renderer falls back to WebGL2.
const ci = !!process.env.CI;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  workers: 1,
  reporter: ci ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5198',
    viewport: { width: 1280, height: 720 },
    headless: ci,
    // Locally use the installed Chrome (the real target browser); CI installs Playwright's Chromium.
    ...(ci ? {} : { channel: 'chrome' }),
    launchOptions: {
      args: ci ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--enable-unsafe-webgpu'],
    },
  },
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://127.0.0.1:5198',
    reuseExistingServer: !ci,
    timeout: 120_000,
  },
});

import { defineConfig } from '@playwright/test';

// Everything runs headless so test windows never take keyboard focus from whoever is using the
// Mac (stray keystrokes into a visible test window made tests fail at random). Headless Chrome
// still gets WebGPU on Metal there. CI runners have no GPU and fall back to WebGL2.
const ci = !!process.env.CI;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  workers: 1,
  reporter: ci ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5198',
    viewport: { width: 1280, height: 720 },
    headless: true,
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

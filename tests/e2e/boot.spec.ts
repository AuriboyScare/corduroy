import { _electron as electron, expect, test, type Page } from '@playwright/test';

const ci = !!process.env.CI;

/** Waits for the app to render frames and returns what the renderer negotiated. */
async function bootState(page: Page) {
  await page.waitForFunction(() => (window.__corduroy?.frames ?? 0) > 30, undefined, { timeout: 30_000 });
  return page.evaluate(() => ({
    ...window.__corduroy!.boot,
    frames: window.__corduroy!.frames,
    simSteps: window.__corduroy!.simSteps,
  }));
}

/** The canvas must show the lit probe, not a blank or single-colour frame. */
async function expectRenderedImage(page: Page, name: string) {
  const shot = await page.screenshot({ path: `test-results/${name}.png` });
  const distinct = await page.evaluate(
    async (dataUrl) => {
      const image = new Image();
      image.src = dataUrl;
      await image.decode();
      const c = new OffscreenCanvas(160, 90);
      const ctx = c.getContext('2d')!;
      ctx.drawImage(image, 0, 0, 160, 90);
      const d = ctx.getImageData(0, 0, 160, 90).data;
      const seen = new Set<number>();
      for (let i = 0; i < d.length; i += 4)
        seen.add(((d[i]! >> 3) << 10) | ((d[i + 1]! >> 3) << 5) | (d[i + 2]! >> 3));
      return seen.size;
    },
    `data:image/png;base64,${shot.toString('base64')}`,
  );
  expect(distinct).toBeGreaterThan(40);
}

test('browser: renders with cross-origin isolation', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?debug=1');
  const state = await bootState(page);
  expect(state.crossOriginIsolated).toBe(true);
  expect(state.simSteps).toBeGreaterThan(0);
  // CI runners have no GPU; on the development Mac WebGPU is required.
  if (!ci) expect(state.backend).toBe('webgpu');
  await expect(page.getByTestId('boot-panel')).toBeVisible();
  await expectRenderedImage(page, 'boot-browser');
  expect(errors).toEqual([]);
});

test('browser: WebGL2 fallback path renders', async ({ page }) => {
  await page.goto('/?debug=1&gl=1');
  const state = await bootState(page);
  expect(state.backend).toBe('webgl2');
  await expect(page.getByTestId('backend')).toContainText('WebGL2');
  await expectRenderedImage(page, 'boot-webgl2');
});

test('electron: packaged build renders with WebGPU and shared memory', async () => {
  test.skip(ci, 'Electron GPU test runs on the development Mac');
  const app = await electron.launch({ args: ['.'], env: { ...process.env, CORDUROY_QUERY: '?debug=1' } });
  try {
    const page = await app.firstWindow();
    const state = await bootState(page);
    expect(state.backend).toBe('webgpu');
    expect(state.crossOriginIsolated).toBe(true);
    await expectRenderedImage(page, 'boot-electron');
  } finally {
    await app.close();
  }
});

import { _electron as electron, expect, test, type Page } from '@playwright/test';

const ci = !!process.env.CI;

/** Waits until the game is rendering and returns what the renderer negotiated. */
async function gameReady(page: Page) {
  await page.waitForFunction(() => (window.__corduroy?.game?.frames ?? 0) > 20, undefined, {
    timeout: 90_000,
  });
  return page.evaluate(() => window.__corduroy!.boot);
}

/** The frame must show a real scene, not a blank or single-colour canvas. */
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
  expect(distinct).toBeGreaterThan(60);
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return errors;
}

test('browser: the snowcat drives, grooms and the HUD follows', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?debug=1');
  const boot = await gameReady(page);
  expect(boot.crossOriginIsolated).toBe(true);
  // CI runners have no GPU; on the development Mac WebGPU is required.
  if (!ci) expect(boot.backend).toBe('webgpu');
  await expect(page.getByTestId('cluster')).toContainText('Kestrel 420');
  await expect(page.getByTestId('snow-panel')).toContainText('Fresh powder');

  const result = await page.evaluate(() => {
    const game = window.__corduroy!.game!;
    const start = game.world.cat.body.pz;
    const mass = game.world.snow.totalMassKg();
    game.fastForward(900, { throttle: 0.6, steer: 0, bladeLift: 0, tillerDown: true });
    game.autoInput = { throttle: 0.6, steer: 0, bladeLift: 0, tillerDown: true };
    const cat = game.world.cat;
    return {
      moved: start - cat.body.pz,
      groomed: game.world.pisteGroomedFraction,
      quality: cat.groomQuality,
      massRatio: (game.world.snow.totalMassKg() + cat.bladeLoadKg) / mass,
    };
  });
  expect(result.moved).toBeGreaterThan(30);
  expect(result.groomed).toBeGreaterThan(0);
  expect(result.quality).toBeGreaterThan(0.9);
  expect(result.massRatio).toBeCloseTo(1, 5);
  await expect(page.getByTestId('cluster')).toContainText('Grooming');
  await expect(page.getByTestId('job-panel')).not.toContainText('0.0%');
  await expectRenderedImage(page, 'game-browser');
  expect(errors).toEqual([]);
});

test('browser: keyboard drives the machine and works the implements', async ({ page }) => {
  await page.goto('/?debug=1');
  await gameReady(page);
  const read = () =>
    page.evaluate(() => {
      const cat = window.__corduroy!.game!.world.cat;
      return { z: cat.body.pz, heading: cat.heading, blade: cat.bladeHeightM, tiller: cat.tillerPos };
    });
  const before = await read();
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2500);
  await page.keyboard.up('KeyW');
  const driven = await read();
  expect(before.z - driven.z).toBeGreaterThan(3);

  await page.keyboard.down('KeyA');
  await page.keyboard.down('KeyF');
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyA');
  await page.keyboard.up('KeyF');
  await page.keyboard.press('KeyT');
  await page.waitForTimeout(1200);
  const worked = await read();
  expect(
    Math.abs(
      Math.atan2(Math.sin(worked.heading - driven.heading), Math.cos(worked.heading - driven.heading)),
    ),
  ).toBeGreaterThan(0.15);
  expect(worked.blade).toBeLessThan(driven.blade - 0.3);
  expect(worked.tiller).toBeGreaterThan(0.95);
  await expect(page.getByTestId('cluster')).toContainText('rpm');
});

test('browser: cameras switch with the keyboard', async ({ page }) => {
  await page.goto('/?debug=1');
  await gameReady(page);
  await expect(page.getByTestId('job-panel')).toContainText('Chase');
  await page.keyboard.press('KeyC');
  await expect(page.getByTestId('job-panel')).toContainText('Cab');
  await page.keyboard.press('KeyC');
  await expect(page.getByTestId('job-panel')).toContainText('Free fly');
  await page.keyboard.press('KeyH');
  await expect(page.getByTestId('help')).toHaveCount(0);
});

test('browser: WebGL2 fallback renders the game', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?debug=1&gl=1');
  const boot = await gameReady(page);
  expect(boot.backend).toBe('webgl2');
  await expectRenderedImage(page, 'game-webgl2');
  expect(errors).toEqual([]);
});

test('electron: packaged build runs the game with WebGPU and shared memory', async () => {
  test.skip(ci, 'Electron GPU test runs on the development Mac');
  const app = await electron.launch({ args: ['.'], env: { ...process.env, CORDUROY_QUERY: '?debug=1' } });
  try {
    const page = await app.firstWindow();
    const boot = await gameReady(page);
    expect(boot.backend).toBe('webgpu');
    expect(boot.crossOriginIsolated).toBe(true);
    await expectRenderedImage(page, 'game-electron');
  } finally {
    await app.close();
  }
});

import { _electron as electron, expect, test, type Page } from '@playwright/test';

const ci = !!process.env.CI;

/** Waits until the game has rendered `frames` frames and returns what the renderer negotiated. */
async function gameReady(page: Page, frames = 20) {
  await page.waitForFunction((n) => (window.__corduroy?.game?.frames ?? 0) > n, frames, { timeout: 90_000 });
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

// Runs everywhere, including CI's GPU-less runners where the game renders at about 1 fps in
// software. It checks only that the build boots and the simulation works inside the page.
test('browser: boots, shows the HUD and simulates', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?debug=1');
  const boot = await gameReady(page, 2);
  expect(boot.crossOriginIsolated).toBe(true);
  await expect(page.getByTestId('cluster')).toContainText('Kestrel 420', { timeout: 30_000 });
  const result = await page.evaluate(() => {
    const game = window.__corduroy!.game!;
    const start = game.world.cat.body.pz;
    const mass = game.world.snow.totalMassKg();
    // 15 s: long enough to leave the depot pad and groom onto the piste.
    game.fastForward(900, { throttle: 0.6, steer: 0, bladeLift: 0, tillerDown: true });
    const cat = game.world.cat;
    return {
      moved: start - cat.body.pz,
      groomed: game.world.pisteGroomedFraction,
      massRatio: (game.world.snow.totalMassKg() + cat.bladeLoadKg) / mass,
    };
  });
  expect(result.moved).toBeGreaterThan(30);
  expect(result.groomed).toBeGreaterThan(0);
  expect(result.massRatio).toBeCloseTo(1, 5);
  // The render loop keeps going after the terrain has been reshaped.
  const frames = await page.evaluate(() => window.__corduroy!.game!.frames);
  await page.waitForFunction((n) => window.__corduroy!.game!.frames > n + 2, frames, { timeout: 60_000 });
  expect(errors).toEqual([]);
});

// The tests below play in real time and capture frames, so they need a GPU. They run on the
// development Mac, which is the target hardware. The skip sits at group level so CI never opens
// a browser page for them.
test.describe('on a GPU', () => {
  test.skip(ci, 'needs a GPU');

  test('browser: the snowcat drives, grooms and the HUD follows', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/?debug=1');
    const boot = await gameReady(page);
    expect(boot.backend).toBe('webgpu');
    await expect(page.getByTestId('cluster')).toContainText('Kestrel 420');
    await expect(page.getByTestId('snow-panel')).toContainText('Fresh powder');

    const result = await page.evaluate(() => {
      const game = window.__corduroy!.game!;
      const start = game.world.cat.body.pz;
      game.fastForward(900, { throttle: 0.6, steer: 0, bladeLift: 0, tillerDown: true });
      game.autoInput = { throttle: 0.6, steer: 0, bladeLift: 0, tillerDown: true };
      const cat = game.world.cat;
      return { moved: start - cat.body.pz, quality: cat.groomQuality };
    });
    expect(result.moved).toBeGreaterThan(30);
    expect(result.quality).toBeGreaterThan(0.9);
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
        return { z: cat.body.pz, heading: cat.heading, blade: cat.bladeHeightM };
      });

    const start = await read();
    await page.keyboard.down('KeyW');
    await page.waitForFunction((z) => z - window.__corduroy!.game!.world.cat.body.pz > 3, start.z, {
      timeout: 20_000,
    });
    await page.keyboard.up('KeyW');

    const driven = await read();
    await page.keyboard.down('KeyA');
    await page.keyboard.down('KeyF');
    await page.waitForFunction(
      ({ heading, blade }) => {
        const cat = window.__corduroy!.game!.world.cat;
        const turned = Math.atan2(Math.sin(cat.heading - heading), Math.cos(cat.heading - heading));
        // A turns left, which is a positive change of heading.
        return turned > 0.15 && cat.bladeHeightM < blade - 0.3;
      },
      driven,
      { timeout: 20_000 },
    );
    await page.keyboard.up('KeyA');
    await page.keyboard.up('KeyF');

    await page.keyboard.press('KeyT');
    await page.waitForFunction(() => window.__corduroy!.game!.world.cat.tillerPos > 0.95, undefined, {
      timeout: 20_000,
    });
    await expect(page.getByTestId('cluster')).toContainText('rpm');
  });

  test('browser: cameras switch with the keyboard, even with two presses in one frame', async ({ page }) => {
    await page.goto('/?debug=1');
    await gameReady(page);
    await expect(page.getByTestId('job-panel')).toContainText('Chase');
    await page.keyboard.press('KeyC');
    await expect(page.getByTestId('job-panel')).toContainText('Cab');
    await page.keyboard.press('KeyC');
    await expect(page.getByTestId('job-panel')).toContainText('Free fly');
    // Two presses delivered between frames must both count: free fly → chase → cab.
    await page.evaluate(() => {
      for (let i = 0; i < 2; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC' }));
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyC' }));
      }
    });
    await expect(page.getByTestId('job-panel')).toContainText('Cab');
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
});

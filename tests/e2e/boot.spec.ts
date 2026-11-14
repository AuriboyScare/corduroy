import { _electron as electron, expect, test, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ci = !!process.env.CI;
const electronSaves = mkdtempSync(path.join(tmpdir(), 'corduroy-e2e-saves-'));

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
  await page.goto('/?debug=1&mode=career');
  const boot = await gameReady(page, 2);
  expect(boot.crossOriginIsolated).toBe(true);
  await expect(page.getByTestId('cluster')).toContainText('Kestrel 260', { timeout: 30_000 });
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
    await page.goto('/?debug=1&mode=career');
    const boot = await gameReady(page);
    expect(boot.backend).toBe('webgpu');
    await expect(page.getByTestId('cluster')).toContainText('Kestrel 260');
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
    await expect(page.getByTestId('money')).not.toHaveText('$2,000');
    await expectRenderedImage(page, 'game-browser');
    expect(errors).toEqual([]);
  });

  test('browser: keyboard drives the machine and works the implements', async ({ page }) => {
    await page.goto('/?debug=1&mode=career');
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
    // The first key press starts audio, and the synthesizer loads on the audio thread.
    await page.waitForFunction(() => window.__corduroy!.game!.audio().synth, undefined, { timeout: 10_000 });
    expect(await page.evaluate(() => window.__corduroy!.game!.audio().context)).toBe('running');
  });

  test('browser: cameras switch with the keyboard, even with two presses in one frame', async ({ page }) => {
    await page.goto('/?debug=1&mode=career');
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

  test('browser: start menu leads into a career', async ({ page }) => {
    await page.goto('/?debug=1');
    await page.getByTestId('start-career').click();
    await gameReady(page);
    await expect(page.getByTestId('money')).toHaveText('$2,000');
    await expect(page.getByTestId('cluster')).toContainText('Kestrel 260');
  });

  test('browser: the garage sells upgrades and machines, and swaps machines', async ({ page }) => {
    await page.goto('/?debug=1&mode=career');
    await gameReady(page);
    await page.evaluate(() => {
      window.__corduroy!.game!.world.career.money = 60_000;
    });
    await page.keyboard.press('KeyG');
    const garage = page.getByTestId('garage');
    await expect(garage).toBeVisible();
    await garage.getByTestId('upgrade-engine').getByRole('button').click();
    await expect(page.getByTestId('garage-message')).toContainText('Engine remap fitted');
    const power = await page.evaluate(() => window.__corduroy!.game!.world.cat.spec.enginePowerW);
    expect(power).toBeCloseTo(175_000 * 1.12);
    await garage.getByTestId('offer-kestrel-420').getByRole('button').click();
    await expect(page.getByTestId('garage-message')).toContainText('Kestrel 420 delivered');
    await expect(garage.getByTestId('fleet-kestrel-420')).toBeVisible();
    await garage.getByTestId('drive').click();
    await expect(garage).toHaveCount(0);
    await expect(page.getByTestId('cluster')).toContainText('Kestrel 420');
    // $60,000 less the remap ($840) and the machine ($38,000).
    await expect(page.getByTestId('money')).toHaveText('$21,160');
  });

  test('browser: lift and snowmaking consoles work their controls', async ({ page }) => {
    await page.goto('/?debug=1&mode=career');
    await gameReady(page);

    await page.keyboard.press('KeyL');
    const tow = page.getByTestId('lift-nursery-tow');
    await expect(tow).toContainText('Running');
    await tow.getByRole('button', { name: 'Emergency stop' }).click();
    await expect(tow).toContainText('Emergency stop');
    await expect(tow.locator('.lamp-alarm')).toHaveCount(1);
    await expect(tow.getByRole('button', { name: 'Emergency stop' })).toBeDisabled();
    // Clicking outside the panel closes it.
    await page.mouse.click(8, 8);
    await expect(page.getByTestId('lifts')).toHaveCount(0);

    await page.evaluate(() => {
      const game = window.__corduroy!.game!;
      game.world.career.money = 10_000;
    });
    await page.keyboard.press('KeyN');
    const nursery = page.getByTestId('snowmaking-nursery');
    await nursery.getByRole('button', { name: /Install for/ }).click();
    const on = nursery.getByRole('button', { name: 'On', exact: true });
    await on.click();
    await expect(on).toHaveAttribute('aria-pressed', 'true');
    await expect(nursery.getByRole('button', { name: 'Auto' })).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('snowmaking')).toHaveCount(0);
  });

  test('browser: the HUD shows night on the clock and a controls hint when help is hidden', async ({
    page,
  }) => {
    await page.goto('/?debug=1&mode=career');
    await gameReady(page);
    await expect(page.locator('.clock')).not.toHaveClass(/night/);
    await page.evaluate(() => {
      window.__corduroy!.game!.world.weather.clockS += 13 * 3600;
    });
    await expect(page.locator('.clock')).toHaveClass(/night/);
    await expect(page.getByTestId('help')).toBeVisible();
    await page.keyboard.press('KeyH');
    await expect(page.getByTestId('help')).toHaveCount(0);
    await expect(page.locator('.help-hint')).toContainText('Controls');
  });

  test('browser: upgrades that show on the machine rebuild its model; others do not', async ({ page }) => {
    await page.goto('/?debug=1&mode=career');
    await gameReady(page);
    const builds = () => page.evaluate(() => window.__corduroy!.game!.modelBuilds());
    await page.evaluate(() => {
      window.__corduroy!.game!.world.career.money = 60_000;
    });
    const start = await builds();
    await page.keyboard.press('KeyG');
    const garage = page.getByTestId('garage');
    await garage.getByTestId('upgrade-cruise').getByRole('button').click();
    await expect(page.getByTestId('garage-message')).toContainText('Cruise control fitted');
    await page.waitForTimeout(300);
    expect(await builds()).toBe(start);
    await garage.getByTestId('upgrade-lights').getByRole('button').click();
    await expect(page.getByTestId('garage-message')).toContainText('Work lights fitted');
    await expect.poll(builds).toBe(start + 1);
  });

  test('browser: two players share a game: join by link, drive, run lifts, host closes', async ({
    context,
  }) => {
    const host = await context.newPage();
    const errors = collectErrors(host);
    await host.goto('/?debug=1&mode=sandbox&net=local');
    await gameReady(host);
    await host.keyboard.press('KeyP');
    await host.getByTestId('host-name').fill('Ana');
    await host.getByTestId('open-game').click();
    const code = (await host.getByTestId('room-code').textContent())!.trim();
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    await host.keyboard.press('Escape');

    const guest = await context.newPage();
    errors.push(...collectErrors(guest));
    await guest.goto(`/?debug=1&net=local&join=${code}&name=Ben`);
    await gameReady(guest);
    await expect(guest.getByTestId('net-line')).toContainText(`Online · ${code} · 1 other player`);
    await expect(host.getByTestId('net-line')).toContainText('1 other player');

    // The guest drives their own machine; it moves in the host's world.
    const seat = await guest.evaluate(() => window.__corduroy!.game!.world.activeMachine.owned.uid);
    const hostSeat = await host.evaluate(() => window.__corduroy!.game!.world.activeMachine.owned.uid);
    expect(seat).not.toBe(hostSeat);
    const where = (uid: number) =>
      host.evaluate((id) => {
        const body = window.__corduroy!.game!.world.machines.find((m) => m.owned.uid === id)!.vehicle.body;
        return { x: body.px, z: body.pz };
      }, uid);
    const before = await where(seat);
    await guest.keyboard.down('KeyW');
    await guest.waitForTimeout(2500);
    await guest.keyboard.up('KeyW');
    await expect
      .poll(async () => {
        const now = await where(seat);
        return Math.hypot(now.x - before.x, now.z - before.z);
      })
      .toBeGreaterThan(3);

    // A command from the guest's lift panel takes effect in both worlds.
    await guest.keyboard.press('KeyL');
    await guest.getByTestId('lift-meadow-quad').getByRole('button', { name: 'Stop', exact: true }).click();
    const quadState = (page: typeof host) =>
      page.evaluate(() => window.__corduroy!.game!.world.liftById('meadow-quad')!.state);
    await expect.poll(() => quadState(host)).toBe('stopped');
    await expect.poll(() => quadState(guest)).toBe('stopped');

    // The host closes the game; the guest is told.
    await host.keyboard.press('KeyP');
    await host.getByTestId('close-game').click();
    await expect(guest.getByTestId('net-ended')).toContainText('The host has left the game');
    expect(errors).toEqual([]);
  });

  test('browser: joining with a code nobody is hosting explains the problem', async ({ page }) => {
    await page.goto('/?debug=1&net=local');
    await page.getByTestId('start-join').click();
    await page.getByTestId('join-name').fill('Cy');
    await page.getByTestId('join-code').fill('ab');
    await page.getByTestId('join-submit').click();
    await expect(page.getByTestId('join-error')).toContainText('six letters and numbers');
  });

  test('browser: lifts draw every carrier once, in detail near the camera and plain far away', async ({
    page,
  }) => {
    await page.goto('/?debug=1&mode=sandbox');
    await gameReady(page);
    const counts = () => page.evaluate(() => window.__corduroy!.game!.liftDetail('meadow-quad')!);
    const total = await page.evaluate(
      () => window.__corduroy!.game!.world.lifts.find((l) => l.line.id === 'meadow-quad')!.carrierCount,
    );
    await page.evaluate(() => {
      const game = window.__corduroy!.game!;
      game.setCamera('free');
      game.rig.freePosition.set(1024, 2500, 1500);
    });
    await expect.poll(async () => (await counts()).near).toBe(0);
    expect((await counts()).far).toBe(total);
    await page.evaluate(() => {
      const game = window.__corduroy!.game!;
      const quad = game.world.lifts.find((l) => l.line.id === 'meadow-quad')!;
      const mid = quad.towers[Math.floor(quad.towers.length / 2)]!;
      game.rig.freePosition.set(mid.x, mid.topY + 5, mid.z);
    });
    await expect.poll(async () => (await counts()).near).toBeGreaterThan(0);
    const mixed = await counts();
    expect(mixed.near + mixed.far).toBe(total);
  });

  test('browser: a saved career continues where it left off', async ({ page }) => {
    await page.goto('/?debug=1&mode=career');
    await gameReady(page);
    const before = await page.evaluate(async () => {
      const game = window.__corduroy!.game!;
      game.fastForward(900, { throttle: 0.6, steer: 0, bladeLift: 0, tillerDown: true });
      // Stop and lift the tiller so nothing changes between this save and leaving the page.
      game.fastForward(300, { throttle: 0, steer: 0, bladeLift: 0, tillerDown: false });
      const ok = await game.save();
      return {
        ok,
        money: game.world.career.money,
        z: game.world.cat.body.pz,
        groomed: game.world.snow.groomedPisteCells,
      };
    });
    expect(before.ok).toBe(true);
    await expect(page.getByTestId('save-status')).toContainText('Saved');
    await page.goto('/?debug=1');
    await expect(page.getByTestId('continue-career')).toContainText(
      `$${before.money.toLocaleString('en-US')}`,
    );
    await page.getByTestId('continue-career').click();
    await gameReady(page);
    const after = await page.evaluate(() => {
      const world = window.__corduroy!.game!.world;
      return { money: world.career.money, z: world.cat.body.pz, groomed: world.snow.groomedPisteCells };
    });
    expect(after.money).toBe(before.money);
    expect(after.groomed).toBe(before.groomed);
    // A parked machine still settles on its suspension by fractions of a millimetre.
    expect(after.z).toBeCloseTo(before.z, 2);
    // Starting a new career over the save asks first.
    await page.goto('/?debug=1');
    await page.getByTestId('start-career').click();
    await expect(page.getByTestId('confirm-career')).toBeVisible();
  });

  test('browser: WebGL2 fallback renders the game', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/?debug=1&mode=career&gl=1');
    const boot = await gameReady(page);
    expect(boot.backend).toBe('webgl2');
    await expectRenderedImage(page, 'game-webgl2');
    expect(errors).toEqual([]);
  });

  test('electron: packaged build runs the game with WebGPU and shared memory', async () => {
    const app = await electron.launch({
      args: ['.'],
      env: {
        ...process.env,
        CORDUROY_QUERY: '?debug=1&mode=sandbox',
        CORDUROY_SAVES_DIR: electronSaves,
        CORDUROY_HIDDEN: '1',
      },
    });
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

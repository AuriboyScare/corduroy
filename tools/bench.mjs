// Measures frame pacing of the running dev server in installed Chrome.
// Usage: node tools/bench.mjs [--size WxH] [--seconds N]
import { chromium } from '@playwright/test';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const [width, height] = opt('size', '1728x1000').split('x').map(Number);
const seconds = Number(opt('seconds', '12'));
const power = /AC Power/.test(execSync('pmset -g batt').toString()) ? 'mains' : 'battery';

const scenes = {
  'chase, grooming uphill': `(() => { const g = window.__corduroy.game; g.setCamera('chase'); g.autoInput = { throttle: 0.6, steer: 0, bladeLift: 0, tillerDown: true }; })()`,
  'cab, grooming uphill': `window.__corduroy.game.setCamera('cab')`,
  'aerial over forest and piste': `(() => { const g = window.__corduroy.game; g.setCamera('free'); g.rig.freePosition.set(1024, 300, 2040); g.rig.freeYaw = 0; g.rig.freePitch = -0.5; })()`,
  'low over forest toward summit': `(() => { const g = window.__corduroy.game; g.rig.freePosition.set(700, 120, 1500); g.rig.freeYaw = -0.4; g.rig.freePitch = -0.05; })()`,
};

const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  args: ['--enable-unsafe-webgpu'],
});
const page = await browser.newPage({ viewport: { width, height } });
await page.goto('http://127.0.0.1:5199/?debug=1');
await page.waitForFunction(() => (window.__corduroy?.game?.frames ?? 0) > 20, undefined, { timeout: 90_000 });
const pixels = await page.evaluate(() => {
  const c = document.getElementById('view');
  return `${c.width}x${c.height}`;
});
console.log(`window ${width}x${height}, rendering ${pixels}, ${power} power`);
for (const [name, setup] of Object.entries(scenes)) {
  await page.evaluate(setup);
  await page.waitForTimeout(2500);
  const r = await page.evaluate(
    (ms) =>
      new Promise((resolve) => {
        const deltas = [];
        let last = performance.now();
        const end = last + ms;
        const tick = (now) => {
          deltas.push(now - last);
          last = now;
          if (now < end) requestAnimationFrame(tick);
          else {
            deltas.sort((a, b) => a - b);
            const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
            const info = window.__corduroy.game.renderInfo();
            resolve({
              fps: +(1000 / mean).toFixed(1),
              p99ms: +deltas[Math.floor(deltas.length * 0.99)].toFixed(1),
              worstMs: +deltas[deltas.length - 1].toFixed(1),
              over20ms: deltas.filter((d) => d > 20).length,
              frames: deltas.length,
              ...info,
            });
          }
        };
        requestAnimationFrame(tick);
      }),
    seconds * 1000,
  );
  console.log(`${name}: ${JSON.stringify(r)}`);
}
await browser.close();

// Drives the running dev server in installed Chrome and saves screenshots.
// Usage: node tools/shot.mjs <out.png> [--query "a=b"] [--eval "js"] [--wait ms] [--size WxH]
//        [--shots '[{"name":"x","eval":"js","wait":500}]']  (extra shots saved as <out>-<name>.png)
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const out = args[0];
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const [width, height] = opt('size', '1600x900').split('x').map(Number);
const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  args: ['--enable-unsafe-webgpu'],
});
const page = await browser.newPage({ viewport: { width, height } });
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on(
  'console',
  (m) =>
    (m.type() === 'error' || m.type() === 'warning') &&
    problems.push(`${m.type()}: ${m.text().slice(0, 400)}`),
);
await page.goto(`http://127.0.0.1:5199/?debug=1&${opt('query', '')}`);
try {
  await page.waitForFunction(() => (window.__corduroy?.game?.frames ?? 0) > 20, undefined, {
    timeout: 90_000,
  });
  const script = opt('eval', '');
  if (script) console.log('eval:', JSON.stringify(await page.evaluate(script)));
  await page.waitForTimeout(Number(opt('wait', '1500')));
  console.log(
    'state:',
    JSON.stringify(
      await page.evaluate(() => {
        const g = window.__corduroy.game;
        return {
          buildMs: Math.round(g.buildMs),
          frames: g.frames,
          ...g.renderInfo(),
          backend: window.__corduroy.boot.backend,
        };
      }),
    ),
  );
} catch (error) {
  console.log('FAILED:', error.message.split('\n')[0]);
}
await page.screenshot({ path: out });
for (const shot of JSON.parse(opt('shots', '[]'))) {
  const result = await page.evaluate(shot.eval);
  if (result !== undefined && result !== null) console.log(`${shot.name}:`, JSON.stringify(result));
  await page.waitForTimeout(shot.wait ?? 600);
  await page.screenshot({ path: out.replace(/\.png$/, `-${shot.name}.png`) });
}
for (const p of [...new Set(problems)].slice(0, 12)) console.log(p);
await browser.close();

const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 480, height: 270 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto(`http://localhost:8765/index.html?w=1920&h=1080`);
  await p.waitForFunction('window.ready', null, { timeout: 120000 });
  const r = await p.evaluate(() => { const o = []; for (let t = 0; t < 30; t += 0.5) o.push(t + ':' + Math.round(blurPx(t, 60))); return o.join(' '); });
  console.log(r); await b.close();
})();

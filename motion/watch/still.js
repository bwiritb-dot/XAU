// usage: node still.js w h t1 t2 ...  -> out/still_<t>.jpg
const { chromium } = require('playwright');
const [w, h, ...ts] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: +w, height: +h } });
  p.on('console', m => console.log('page:', m.text())); p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto(`http://localhost:8765/index.html?w=${w}&h=${h}`);
  await p.waitForFunction('window.ready', null, { timeout: 120000 });
  for (const t of ts) { const s = Date.now(); const K = await p.evaluate(t => renderFrame(t, 60, 3, 10), +t); await p.screenshot({ path: `out/still_${t}.jpg`, type: 'jpeg', quality: 90 }); console.log(t, 'K', K, Date.now() - s, 'ms'); }
  await b.close();
})();

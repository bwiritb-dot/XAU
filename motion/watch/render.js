// usage: node render.js out.mp4 [w h fps t0 t1 minK maxK]   (frames -> ffmpeg, video only)
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const [out = 'out/v.mp4', w = 1920, h = 1080, fps = 60, t0 = 0, t1 = 30, minK = 3, maxK = 10] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: +w, height: +h } });
  p.on('console', m => console.log('page:', m.text())); p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto(`http://localhost:8765/index.html?w=${w}&h=${h}`);
  await p.waitForFunction('window.ready', null, { timeout: 120000 });
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-pix_fmt', 'yuv420p', '-r', String(fps), out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const f0 = Math.round(t0 * fps), f1 = Math.round(t1 * fps);
  const T = Date.now();
  for (let f = f0; f < f1; f++) {
    const K = await p.evaluate(([t, fps, a, b]) => window.renderFrame(t, fps, a, b), [f / fps, +fps, +minK, +maxK]);
    const buf = await p.screenshot({ type: 'jpeg', quality: 94 });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (f % 30 === 0) console.log(`frame ${f}/${f1} K=${K} ${((Date.now() - T) / (f - f0 + 1)).toFixed(0)}ms/f`);
  }
  ff.stdin.end(); await new Promise(r => ff.on('close', r)); await b.close();
})();

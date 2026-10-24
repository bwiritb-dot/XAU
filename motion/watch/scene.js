import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

// ---------- params ----------
const Q = new URLSearchParams(location.search);
const W = +(Q.get('w') || 1920), H = +(Q.get('h') || 1080);
const TL = await (await fetch('timeline.json')).json();
await Promise.all(['300 80px Corm', '500 80px Corm', 'italic 80px CormI', '40px Mono'].map(f => document.fonts.load(f)));

// ---------- math ----------
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const prog = (a, b, t) => clamp((t - a) / (b - a));
const ss = k => k * k * (3 - 2 * k);
const eio = k => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
const eoExpo = k => k >= 1 ? 1 : 1 - Math.pow(2, -10 * k);
const eiCubic = k => k * k * k;
const eoBack = (k, s = 1.4) => 1 + (s + 1) * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2);
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const TAU = Math.PI * 2;

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.setSize(W, H, false);
renderer.domElement.style.cssText = 'width:1920px;height:1080px';
renderer.localClippingEnabled = true;
const stage = document.getElementById('stage');
stage.insertBefore(renderer.domElement, stage.firstChild);
stage.style.transform = `scale(${W / 1920})`;
const LW = H / 1080;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, W / H, 0.1, 200);

// studio environment: dark room with long softboxes -> reflections on gold
{
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x020202);
  const box = (w, h, x, y, z, ry, rx, i, col = 0xffffff) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(i), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.rotation.set(rx, ry, 0); env.add(m);
  };
  box(2.2, 14, -7, 0, 2, Math.PI / 2, 0, 6);
  box(1.4, 14, 7, 1, -1, -Math.PI / 2, 0, 3.5, 0xffe6c8);
  box(14, 1.2, 0, 7, 0, 0, Math.PI / 2, 4);
  box(6, 6, 0, 2, 8, Math.PI, 0, 1.2, 0xfff1dc);
  box(3, 0.6, 3, -5, 4, 0, -Math.PI / 3, 5);
  box(0.6, 6, -3, -2, -7, 0, 0, 2.0, 0xffeedd);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(env, 0.02).texture;
  scene.environmentIntensity = 1.0;
}

// ---------- shared uniforms / clipping ----------
const U = { uSeam: { value: new THREE.Vector4() }, uSeamOn: { value: 0 } };
const seamWorld = new THREE.Plane(new THREE.Vector3(-0.55, 0.75, 0.36).normalize(), -50);
const clipSolid = new THREE.Plane().copy(seamWorld);
const clipLine = new THREE.Plane();

function metal(rgb, rough, extra = {}) {
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(...rgb), metalness: 1, roughness: rough, ...extra });
  return patch(m);
}
function patch(m) {
  m.clippingPlanes = [clipSolid];
  m.onBeforeCompile = sh => {
    sh.uniforms.uSeam = U.uSeam; sh.uniforms.uSeamOn = U.uSeamOn;
    sh.fragmentShader = 'uniform vec4 uSeam; uniform float uSeamOn;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      { float d = dot(-vViewPosition, uSeam.xyz) + uSeam.w;
        totalEmissiveRadiance += vec3(1.0,0.62,0.28) * uSeamOn * (9.0*exp(-d*d*260.0) + 0.9*exp(-max(d,0.0)*7.0)); }`);
  };
  return m;
}
const GOLD = [1.0, 0.766, 0.336];
const M = {
  gold: metal(GOLD, 0.16),
  goldB: metal(GOLD.map(v => v * 0.92), 0.34),
  ceramic: patch(new THREE.MeshPhysicalMaterial({ color: 0x030303, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 })),
  lume: patch(new THREE.MeshPhysicalMaterial({ color: 0xf1ead6, roughness: 0.55, emissive: 0x2a2a20 })),
  brass: metal([0.92, 0.62, 0.32], 0.28),
  rhod: metal([0.72, 0.72, 0.74], 0.24),
  ruby: patch(new THREE.MeshPhysicalMaterial({ color: 0x8a0716, roughness: 0.08, clearcoat: 1 })),
  blue: metal([0.05, 0.1, 0.35], 0.2),
  crystal: patch(new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.02, metalness: 0, transparent: true, opacity: 0.1, depthWrite: false, clearcoat: 1, envMapIntensity: 0.9 })),
};

// ---------- canvas textures ----------
function canvasTex(size, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8; return t;
}
const dialTex = canvasTex(2048, (g, S) => {
  const c = S / 2, R = S / 2;
  const grd = g.createRadialGradient(c * 0.8, c * 0.7, 10, c, c, R);
  grd.addColorStop(0, '#1a1a1a'); grd.addColorStop(1, '#050505');
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  g.translate(c, c);
  for (let i = 0; i < 60; i++) {
    g.save(); g.rotate(i / 60 * TAU);
    g.fillStyle = '#e9e2cf';
    const big = i % 5 === 0;
    if (!big) g.fillRect(-3, -R * 0.985, 6, R * 0.05);
    g.restore();
  }
  g.fillStyle = '#e9e2cf'; g.textAlign = 'center';
  g.font = '500 54px Corm'; g.fillText('AUTOMATIC', 0, R * 0.42);
  g.font = '34px Mono'; g.fillText('300 m · 1000 ft', 0, R * 0.52);
  g.fillStyle = '#d6aa5c'; g.font = 'italic 60px CormI'; g.fillText('line & form', 0, -R * 0.34);
});
const insertTex = canvasTex(2048, (g, S) => {
  const c = S / 2, R = S / 2;
  g.fillStyle = '#060606'; g.fillRect(0, 0, S, S); g.translate(c, c);
  const goldC = '#d9b26a';
  for (let i = 0; i < 60; i++) {
    g.save(); g.rotate(i / 60 * TAU); g.fillStyle = goldC;
    if (i === 0) { g.beginPath(); g.moveTo(0, -R * 0.83); g.lineTo(-36, -R * 0.965); g.lineTo(36, -R * 0.965); g.closePath(); g.fill(); }
    else if (i % 10 === 0) { g.font = '500 92px Corm'; g.textAlign = 'center'; g.fillText(String(i), 0, -R * 0.855); }
    else if (i < 15) g.fillRect(-4, -R * 0.965, 8, R * 0.08);
    else if (i % 5 === 0) g.fillRect(-14, -R * 0.965, 28, R * 0.1);
    g.restore();
  }
});
const paperTex = canvasTex(2048, (g, S) => {
  g.fillStyle = '#efe9dc'; g.fillRect(0, 0, S, S);
  const id = g.getImageData(0, 0, S, S), d = id.data;
  for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * 14; d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.9; }
  g.putImageData(id, 0, 0);
  g.strokeStyle = 'rgba(70,110,150,0.16)'; g.lineWidth = 1.5;
  for (let i = 0; i <= S; i += S / 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, S); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(S, i); g.stroke(); }
  g.strokeStyle = 'rgba(70,110,150,0.28)'; g.lineWidth = 2.5;
  for (let i = 0; i <= S; i += S / 8) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, S); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(S, i); g.stroke(); }
  for (let k = 0; k < 9; k++) { // graphite smudges
    const x = rnd() * S, y = rnd() * S, r = 60 + rnd() * 180;
    const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(60,60,64,0.05)'); gr.addColorStop(1, 'rgba(60,60,64,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
});
paperTex.wrapS = paperTex.wrapT = THREE.RepeatWrapping;

function textPlane(text, font, hUnits, color = '#2b2b30') {
  const c = document.createElement('canvas'), g = c.getContext('2d');
  const px = 160; g.font = font.replace('$', px + 'px');
  const w = Math.ceil(g.measureText(text).width) + 40;
  c.width = w; c.height = Math.ceil(px * 1.4);
  g.font = font.replace('$', px + 'px'); g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(text, 20, c.height / 2);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, wipe: { value: 1 }, op: { value: 1 }, tint: { value: new THREE.Color(1, 1, 1) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `uniform sampler2D map; uniform float wipe, op; uniform vec3 tint; varying vec2 vUv;
      void main(){ vec4 c=texture2D(map,vUv); float m=smoothstep(wipe,wipe-0.04,vUv.x); gl_FragColor=vec4(c.rgb*tint, c.a*m*op); }`,
    transparent: true, depthWrite: false,
  });
  const ph = hUnits * c.height / px;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(ph * c.width / c.height, ph), mat);
  mesh.geometry.translate(mesh.geometry.parameters.width / 2, 0, 0);
  mesh.userData.w = mesh.geometry.parameters.width;
  return mesh;
}

// ---------- geometry helpers ----------
const toZ = g => g.rotateX(Math.PI / 2); // lathe/cylinder Y axis -> Z axis
function lathe(profile, seg = 160) { return toZ(new THREE.LatheGeometry(profile.map(([r, z]) => new THREE.Vector2(r, z)), seg)); }
function ringShape(rOut, rIn, teeth = 0, tDepth = 0, holes = []) {
  const s = new THREE.Shape(), n = teeth ? teeth * 4 : 160;
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU;
    let r = rOut;
    if (teeth) { const ph = i % 4; r = ph === 0 || ph === 3 ? rOut - tDepth : rOut; }
    i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  if (rIn > 0) { const h = new THREE.Path(); h.absarc(0, 0, rIn, 0, TAU, true); s.holes.push(h); }
  holes.forEach(h => s.holes.push(h));
  return s;
}
const extrude = (shape, depth, bevel = 0.01, curve = 64) => new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: curve });
function mesh(geo, mat, parent, pos = [0, 0, 0], rot = [0, 0, 0]) {
  const m = new THREE.Mesh(geo, mat); m.position.set(...pos); m.rotation.set(...rot); parent.add(m); return m;
}

// ---------- watch ----------
const root = new THREE.Group(); scene.add(root);
const P = {}; // explode parts
const part = (name, rest = [0, 0, 0]) => { const g = new THREE.Group(); g.userData.rest = rest; root.add(g); P[name] = g; return g; };
const sketchSrc = {}; // sketch group -> meshes
const sk = (grp, ...ms) => { (sketchSrc[grp] ||= []).push(...ms); return ms[0]; };

// case middle + lugs + crown guards
const caseG = part('case');
sk('case', mesh(lathe([[1.72, -0.42], [1.9, -0.42], [2.0, -0.34], [2.05, -0.12], [2.05, 0.12], [2.0, 0.34], [1.92, 0.44], [1.72, 0.44], [1.72, -0.42]]), M.gold, caseG));
{
  const s = new THREE.Shape();
  [[1.6, -0.36], [2.5, -0.26], [2.66, -0.13], [2.66, 0.05], [2.52, 0.2], [1.6, 0.42]].forEach(([y, z], i) => i ? s.lineTo(y, z) : s.moveTo(y, z));
  const g = extrude(s, 0.34, 0.04, 8);
  g.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
  for (const sx of [-1, 1]) for (const sy of [1, -1]) {
    const m = mesh(g, M.gold, caseG, [sx > 0 ? 1.0 : -1.38, 0, 0], [0, 0, sy < 0 ? Math.PI : 0]);
    if (sy < 0) m.position.x = sx > 0 ? 1.38 : -1.0;
    sk('case', m);
  }
  const gs = new THREE.Shape(); gs.moveTo(-0.5, 0); gs.quadraticCurveTo(-0.1, 0.42, 0.0, 0.42); gs.lineTo(0.12, 0.42); gs.quadraticCurveTo(0.18, 0.2, 0.5, 0); gs.lineTo(-0.5, 0);
  for (const sy of [1, -1]) {
    const m = mesh(extrude(gs, 0.4, 0.03, 8), M.gold, caseG, [1.96, sy * 0.5, -0.2], [0, 0, -Math.PI / 2]);
    m.scale.x = sy;
    sk('case', m);
  }
}
// bracelet (child of case)
const braceRows = [];
for (const s of [1, -1]) {
  let p = new THREE.Vector3(0, s * 2.52, -0.04), phi = 0;
  for (let i = 0; i < 10; i++) {
    const row = new THREE.Group(); caseG.add(row);
    const dir = new THREE.Vector3(0, s, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), -s * phi);
    row.position.copy(p).addScaledVector(dir, 0.28); row.rotation.x = -s * phi;
    row.userData = { rest: row.position.clone(), restRot: row.rotation.x, dir: dir.clone(), i, s };
    const len = 0.5;
    mesh(new RoundedBoxGeometry(0.62, len, 0.24, 2, 0.07), M.gold, row);
    for (const x of [-1, 1]) mesh(new RoundedBoxGeometry(0.64, len, 0.22, 2, 0.05), M.goldB, row, [x * 0.65, 0, -0.01]);
    // sharp proxy boxes give the sketch its outlines (rounded boxes have no hard edges)
    for (const x of [-0.65, 0, 0.65]) { const pr = mesh(new THREE.BoxGeometry(x ? 0.6 : 0.58, len - 0.04, 0.22), M.gold, row, [x, 0, 0]); pr.visible = false; sk('bracelet', pr); }
    braceRows.push(row);
    p.addScaledVector(dir, 0.56); phi += 0.13 + i * 0.012;
  }
}
// crown
const crownG = part('crown');
{
  const g = extrude(ringShape(0.3, 0, 40, 0.025), 0.3, 0.02, 4); g.rotateY(Math.PI / 2);
  sk('crown', mesh(g, M.gold, crownG, [2.04, 0, 0]));
  sk('crown', mesh(toZ(new THREE.CylinderGeometry(0.12, 0.12, 0.2, 24)).rotateY(Math.PI / 2), M.goldB, crownG, [1.98, 0, 0]));
}
// bezel
const bezelG = part('bezel');
sk('bezel', mesh(extrude(ringShape(2.08, 1.6, 120, 0.035), 0.12, 0.025, 96), M.gold, bezelG, [0, 0, 0.44]));
{
  const ins = new THREE.Mesh(new THREE.RingGeometry(1.64, 1.98, 160, 1), patch(new THREE.MeshPhysicalMaterial({ map: insertTex, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.04 })));
  // RingGeometry uv is planar in [-1.98,1.98]; rescale to canvas
  const uv = ins.geometry.attributes.uv, pos = ins.geometry.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 3.96 + 0.5, pos.getY(i) / 3.96 + 0.5);
  ins.position.z = 0.595; bezelG.add(ins); sk('bezel', ins);
}
// crystal
const crystalG = part('crystal');
sk('bezel', mesh(lathe([[0, 0.66], [1.5, 0.655], [1.6, 0.62], [1.6, 0.58], [0, 0.58]], 96), M.crystal, crystalG));
// dial + indices
const dialG = part('dial');
sk('dial', mesh(toZ(new THREE.CylinderGeometry(1.72, 1.72, 0.04, 160)), patch(new THREE.MeshPhysicalMaterial({ map: dialTex, roughness: 0.35, clearcoat: 0.35, clearcoatRoughness: 0.12 })), dialG, [0, 0, 0.28]));
{
  const R = 1.42;
  for (let h = 0; h < 12; h++) {
    const a = Math.PI / 2 - h / 12 * TAU, x = Math.cos(a) * R, y = Math.sin(a) * R;
    const g = new THREE.Group(); g.position.set(x, y, 0.3); g.rotation.z = a - Math.PI / 2; dialG.add(g);
    if (h === 0) {
      const s = new THREE.Shape(); s.moveTo(-0.17, 0.12); s.lineTo(0.17, 0.12); s.lineTo(0, -0.2); s.closePath();
      sk('dial', mesh(extrude(s, 0.03, 0.02, 4), M.gold, g));
      const s2 = new THREE.Shape(); s2.moveTo(-0.11, 0.08); s2.lineTo(0.11, 0.08); s2.lineTo(0, -0.13); s2.closePath();
      mesh(extrude(s2, 0.02, 0.005, 4), M.lume, g, [0, 0, 0.04]);
    } else if (h % 3 === 0) {
      sk('dial', mesh(new RoundedBoxGeometry(0.16, 0.42, 0.06, 2, 0.02), M.gold, g, [0, -0.05, 0.02]));
      mesh(new RoundedBoxGeometry(0.11, 0.36, 0.04, 2, 0.015), M.lume, g, [0, -0.05, 0.045]);
    } else {
      sk('dial', mesh(toZ(new THREE.CylinderGeometry(0.13, 0.13, 0.05, 40)), M.gold, g, [0, 0, 0.02]));
      mesh(toZ(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 40)), M.lume, g, [0, 0, 0.04]);
    }
  }
}
// hands
function handShape(pts) { const s = new THREE.Shape(); pts.forEach(([x, y], i) => i ? s.lineTo(x, y) : s.moveTo(x, y)); s.closePath(); return s; }
function hand(name, pts, z, lumeScale = 0.72) {
  const g = part(name); const piv = new THREE.Group(); piv.position.z = z; g.add(piv); g.userData.piv = piv;
  sk('hands', mesh(extrude(handShape(pts), 0.02, 0.006, 4), M.gold, piv));
  const l = mesh(extrude(handShape(pts.map(([x, y]) => [x * lumeScale, 0.15 + (y - 0.15) * 0.82])), 0.01, 0.003, 4), M.lume, piv, [0, 0.0, 0.022]);
  return g;
}
hand('hour', [[-0.07, -0.22], [0.07, -0.22], [0.12, 0.62], [0, 0.92], [-0.12, 0.62]], 0.36);
hand('min', [[-0.05, -0.28], [0.05, -0.28], [0.085, 1.22], [0, 1.44], [-0.085, 1.22]], 0.39);
{
  const g = part('sec'); const piv = new THREE.Group(); piv.position.z = 0.42; g.add(piv); g.userData.piv = piv;
  sk('hands', mesh(new THREE.BoxGeometry(0.03, 2.0, 0.015).translate(0, 0.55, 0), M.gold, piv));
  sk('hands', mesh(toZ(new THREE.CylinderGeometry(0.075, 0.075, 0.025, 32)), M.gold, piv, [0, 1.08, 0]));
  mesh(toZ(new THREE.CylinderGeometry(0.055, 0.055, 0.02, 32)), M.lume, piv, [0, 1.08, 0.008]);
  sk('hands', mesh(toZ(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 32)), M.gold, piv, [0, 0, 0.01]));
}
// movement
const movG = part('movement');
const gears = [];
function gearGeo(r, teeth, spokes = 5) {
  const holes = [];
  if (spokes) for (let k = 0; k < spokes; k++) {
    const a0 = k / spokes * TAU + 0.12, a1 = (k + 1) / spokes * TAU - 0.12, h = new THREE.Path();
    h.absarc(0, 0, r * 0.78, a0, a1, false); h.absarc(0, 0, r * 0.3, a1, a0, true); holes.push(h);
  }
  return extrude(ringShape(r, 0.03, teeth, r * 0.08, holes), 0.035, 0.004, 12);
}
mesh(toZ(new THREE.CylinderGeometry(1.64, 1.64, 0.12, 128)), M.rhod, movG, [0, 0, -0.24]);
{
  const br = handShape([[-1.4, -0.3], [-0.2, -0.55], [1.3, -0.15], [1.35, 0.3], [0.2, 0.25], [-1.3, 0.45]]);
  mesh(extrude(br, 0.06, 0.02, 4), M.rhod, movG, [0, 0.55, 0.12]);
  const br2 = handShape([[-0.4, -1.45], [0.5, -1.4], [0.9, -0.3], [0.3, -0.1], [-0.6, -0.6]]);
  mesh(extrude(br2, 0.06, 0.02, 4), M.rhod, movG, [0.1, 0, 0.12]);
  const defs = [[0, 0, 0.55, 48, 0, 1], [0.66, 0.5, 0.34, 30, 0.04, -1.6], [-0.15, 0.98, 0.38, 32, 0.08, 2.4], [-0.82, 0.55, 0.22, 15, 0.02, -6],
    [0.6, -0.68, 0.66, 64, -0.08, -0.5], [1.1, 0.2, 0.2, 18, 0.06, 3]];
  for (const [x, y, r, n, z, sp] of defs) {
    const g = new THREE.Group(); g.position.set(x, y, z); movG.add(g); mesh(gearGeo(r, n), M.brass, g); g.userData.sp = sp; gears.push(g);
    mesh(toZ(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 20)), M.ruby, movG, [x, y, z + 0.06]);
  }
  // balance wheel + hairspring
  const bal = new THREE.Group(); bal.position.set(-0.62, -0.72, 0.1); movG.add(bal); movG.userData.bal = bal;
  mesh(extrude(ringShape(0.48, 0.42, 0, 0, []), 0.05, 0.005, 48), M.brass, bal);
  for (let k = 0; k < 3; k++) mesh(new THREE.BoxGeometry(0.84, 0.04, 0.03), M.brass, bal, [0, 0, 0.02], [0, 0, k / 3 * Math.PI]);
  const sp = []; for (let i = 0; i <= 300; i++) { const a = i / 300 * 9 * TAU, r = 0.05 + i / 300 * 0.3; sp.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0.1)); }
  bal.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(sp), new THREE.LineBasicMaterial({ color: 0x223355, clippingPlanes: [clipSolid] })));
  mesh(toZ(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 16)), M.ruby, bal, [0, 0, 0.12]);
  for (const [x, y] of [[-1.1, 0.9], [1.2, -0.8], [0.3, 1.35], [-1.3, -0.2]]) mesh(toZ(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 12)), M.blue, movG, [x, y, 0.2]);
}
const rotorG = part('rotor');
{
  const s = new THREE.Shape(); s.absarc(0, 0, 1.55, 0.05, Math.PI - 0.05, false); s.absarc(0, 0, 0.35, Math.PI - 0.3, 0.3, true);
  const r = new THREE.Group(); r.position.z = -0.36; rotorG.add(r); rotorG.userData.r = r;
  mesh(extrude(s, 0.07, 0.02, 32), M.gold, r, [0, 0, -0.05]);
  mesh(toZ(new THREE.CylinderGeometry(0.22, 0.22, 0.1, 32)), M.rhod, r);
}
const backG = part('caseback');
mesh(lathe([[0, -0.6], [1.2, -0.585], [1.5, -0.57], [1.52, -0.55], [1.8, -0.52], [1.86, -0.44], [1.72, -0.42], [0, -0.42]]), M.gold, backG);

const ORDER = ['crystal', 'bezel', 'sec', 'min', 'hour', 'dial', 'movement', 'rotor', 'case', 'caseback'];
const EXP = { crystal: [0, 0, 3.2, 0.25], bezel: [0, 0, 2.5, 0.9], sec: [0, 0, 1.95, 0.3], min: [0, 0, 1.75, -0.2], hour: [0, 0, 1.55, 0.15],
  dial: [0, 0, 1.05, -0.12], movement: [0, 0, 0.22, 0], rotor: [0, 0, -0.38, 0], case: [0, 0, -1.5, 0], caseback: [0, 0, -2.25, 0.1] };
const LABELS = { crystal: ['01', 'SAPPHIRE CRYSTAL', [1.45, 0.6, 0.66]], bezel: ['02', 'BEZEL · 120 CLICKS', [-1.9, 0.6, 0.6]], sec: ['03', 'HANDS', [0, 1.5, 0.43]],
  dial: ['04', 'DIAL', [-1.6, -0.6, 0.3]], movement: ['05', 'CAL. 01 · 31 JEWELS', [1.5, -0.6, 0.0]], rotor: ['06', 'ROTOR', [-1.4, 0.5, -0.38]],
  case: ['07', 'CASE · 40 MM', [2.04, -0.3, 0]], caseback: ['08', 'CASEBACK', [-1.6, -0.9, -0.55]] };

// ---------- sketch lines ----------
const sketchRoot = new THREE.Group(); scene.add(sketchRoot);
const lineMats = [];
const lineGroups = {};
function segmentsFrom(meshes, mode) {
  root.updateMatrixWorld(true);
  const segs = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  for (const m of meshes) {
    const eg = new THREE.EdgesGeometry(m.geometry, 28), p = eg.attributes.position;
    for (let i = 0; i < p.count; i += 2) {
      a.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld); b.fromBufferAttribute(p, i + 1).applyMatrix4(m.matrixWorld);
      const L2 = a.distanceToSquared(b); if (L2 < 1e-8 || L2 > 1.0) continue;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const key = mode === 'angle' ? ((Math.atan2(mx, my) + TAU) % TAU) + Math.hypot(mx, my) * 0.002
        : mode === 'radial' ? Math.hypot(mx, my) : Math.abs(my) + Math.abs(mx) * 0.1;
      segs.push([key, a.x, a.y, a.z, b.x, b.y, b.z]);
    }
  }
  segs.sort((u, v) => u[0] - v[0]);
  return segs;
}
function makeLines(segs, width, opacity, jitter, parent) {
  const arr = new Float32Array(segs.length * 6);
  segs.forEach((s, i) => { for (let k = 0; k < 6; k++) arr[i * 6 + k] = s[k + 1] + (jitter ? (rnd() - 0.5) * jitter : 0); });
  const g = new LineSegmentsGeometry(); g.setPositions(arr);
  const m = new LineMaterial({ color: 0x2a2a2e, linewidth: width * LW, transparent: true, opacity, depthWrite: false, clippingPlanes: [clipLine] });
  m.userData.baseOp = opacity;
  lineMats.push(m);
  const l = new LineSegments2(g, m); l.frustumCulled = false; l.renderOrder = 2; parent.add(l);
  return l;
}
const SKMODE = { case: 'angle', bezel: 'angle', dial: 'angle', hands: 'radial', crown: 'radial', bracelet: 'dist' };
for (const k in sketchSrc) {
  const segs = segmentsFrom(sketchSrc[k], SKMODE[k]);
  lineGroups[k] = { segs, main: makeLines(segs, 1.9, 0.9, 0, sketchRoot), ghost: makeLines(segs, 1.1, 0.35, 0.02, sketchRoot), n: segs.length };
}

// ---------- paper, construction, desk props ----------
const paperG = new THREE.Group(); scene.add(paperG);
const paperInner = new THREE.Group(); paperG.add(paperInner); // pivot at bottom edge
paperG.position.set(0, -7, -1.0); paperInner.position.set(0, 7, 0);
const paperMat = new THREE.MeshBasicMaterial({ map: paperTex, color: 0xffffff });
const PB = 1.55; // paper is lit hotter than the studio
paperTex.repeat.set(1, 1);
mesh(new THREE.PlaneGeometry(22, 22), paperMat, paperInner);
const sheet2 = mesh(new THREE.PlaneGeometry(9, 12), new THREE.MeshBasicMaterial({ map: paperTex, color: 0xf6f0e4 }), paperInner, [-9.2, 3.5, 0.03], [0, 0, 0.18]);
const conMats = [];
function conLines(pts, parent, w = 1.5, op = 0.7) {
  const g = new LineSegmentsGeometry(); g.setPositions(pts);
  const m = new LineMaterial({ color: 0x3b4150, linewidth: w * LW, transparent: true, opacity: op, depthWrite: false });
  m.userData.baseOp = op; conMats.push(m);
  const l = new LineSegments2(g, m); l.frustumCulled = false; parent.add(l); return l;
}
const construct = [];
{
  const circ = (r, n = 180) => { const a = []; for (let i = 0; i < n; i++) { const a0 = i / n * TAU, a1 = (i + 1) / n * TAU; a.push(Math.sin(a0) * r, Math.cos(a0) * r, 0.02, Math.sin(a1) * r, Math.cos(a1) * r, 0.02); } return a; };
  construct.push(conLines(circ(2.3), paperInner, 1.8, 0.8), conLines(circ(1.0), paperInner, 1.3, 0.5), conLines(circ(2.62), paperInner, 1.3, 0.45));
  construct.push(conLines([-4.2, 0, 0.02, 4.2, 0, 0.02, 0, -5.2, 0.02, 0, 5.2, 0.02], paperInner, 1.3, 0.6));
  construct.push(conLines([-2.9, -2.9, 0.02, 2.9, 2.9, 0.02, -2.9, 2.9, 0.02, 2.9, -2.9, 0.02], paperInner, 1.1, 0.35));
}
const dimLine = conLines([-2.05, -3.3, 0.02, 2.05, -3.3, 0.02, -2.05, -3.15, 0.02, -2.05, -3.45, 0.02, 2.05, -3.15, 0.02, 2.05, -3.45, 0.02,
  -2.05, -3.3, 0.02, -1.85, -3.22, 0.02, -2.05, -3.3, 0.02, -1.85, -3.38, 0.02, 2.05, -3.3, 0.02, 1.85, -3.22, 0.02, 2.05, -3.3, 0.02, 1.85, -3.38, 0.02], paperInner, 1.3, 0.75);
const notes = TL.notes.map(([txt], i) => {
  const m = textPlane(txt, i === 2 ? '$ Mono' : 'italic $ CormI', i === 2 ? 0.2 : 0.42, '#2d2f38');
  paperInner.add(m); m.position.z = 0.025; return m;
});
notes[0].position.set(-4.6, 2.0, 0.025); notes[0].rotation.z = 0.04;
notes[1].position.set(-0.62, -3.75, 0.025);
notes[2].position.set(2.75, 1.4, 0.025);
// ruler in foreground
const rulerTex = canvasTex(1024, (g, S) => {
  g.fillStyle = '#d9d2c2'; g.fillRect(0, 0, S, S); g.fillStyle = '#333';
  for (let i = 0; i < 100; i++) { const x = i / 100 * S; g.fillRect(x, 0, 2, i % 10 ? (i % 5 ? 40 : 70) : 110); }
});
rulerTex.repeat.set(1, 1);
const ruler = mesh(new RoundedBoxGeometry(13, 1.1, 0.12, 2, 0.04), new THREE.MeshBasicMaterial({ map: rulerTex, color: 0xfaf6ee }), paperInner, [3.2, -5.2, 0.35], [0, 0, 0.32]);
// pencil
const pencil = new THREE.Group(); scene.add(pencil);
{
  const body = new THREE.Group(); pencil.add(body);
  const dir = new THREE.Vector3(0.45, 0.42, 0.79).normalize();
  body.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  mesh(new THREE.CylinderGeometry(0.11, 0.11, 4.2, 6).translate(0, 2.55, 0), new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.25, metalness: 0.2 }), body);
  mesh(new THREE.CylinderGeometry(0.11, 0.03, 0.42, 6).translate(0, 0.24, 0), new THREE.MeshStandardMaterial({ color: 0xc9a77a, roughness: 0.8 }), body);
  mesh(new THREE.CylinderGeometry(0.03, 0.004, 0.06, 6).translate(0, 0.03, 0), new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 0.4, metalness: 0.5 }), body);
  mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.35, 16).translate(0, 4.55, 0), metal(GOLD, 0.25), body);
  pencil.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.0));
}
scene.add(new THREE.HemisphereLight(0xfff2e0, 0x202024, 0.6));
const key = new THREE.DirectionalLight(0xfff0dc, 1.4); key.position.set(-4, 6, 8); scene.add(key);

// ---------- studio backdrop + dust + big word ----------
const backMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false,
  uniforms: { mixP: { value: 0 } },
  vertexShader: 'varying vec3 vP; void main(){ vP=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: `varying vec3 vP; uniform float mixP;
    void main(){ float g = smoothstep(-0.4,0.9, dot(vP, normalize(vec3(-0.5,0.6,-0.6))));
      vec3 c = mix(vec3(0.004,0.0035,0.003), vec3(0.06,0.042,0.025), g*g);
      gl_FragColor = vec4(mix(c, vec3(0.80,0.76,0.68), mixP), 1.); }`,
});
scene.add(new THREE.Mesh(new THREE.SphereGeometry(80, 32, 16), backMat));
const dust = (() => {
  const n = 420, p = new Float32Array(n * 3), ph = [];
  for (let i = 0; i < n; i++) { p.set([(rnd() - 0.5) * 26, (rnd() - 0.5) * 16, -14 + rnd() * 22], i * 3); ph.push(rnd() * TAU); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const tex = canvasTex(64, (c, S) => { const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, '#fff'); gr.addColorStop(0.5, '#fff'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, 64, 64); });
  const m = new THREE.PointsMaterial({ map: tex, color: new THREE.Color(1.0, 0.8, 0.55), size: 0.05, transparent: true, alphaTest: 0.35, opacity: 0 });
  const pts = new THREE.Points(g, m); scene.add(pts); pts.userData = { base: p.slice(), ph }; return pts;
})();
const formWord = (() => {
  const g = new THREE.Group(); g.position.set(5.6, -1.2, -9); scene.add(g);
  const letters = []; let x = 0;
  for (const ch of 'FORM') {
    const m = textPlane(ch, '300 $ Corm', 3.8, '#ffffff');
    m.material.uniforms.tint.value.setRGB(0.55, 0.38, 0.2);
    const lg = new THREE.Group(); lg.add(m); m.position.x = -m.userData.w / 2; lg.userData.x = x + m.userData.w / 2; x += m.userData.w * 0.78;
    g.add(lg); letters.push(lg);
  }
  letters.forEach(l => l.userData.x -= x / 2 + 0.6);
  return letters;
})();
// glint flare
const flare = (() => {
  const tex = canvasTex(256, (g, S) => {
    const c = S / 2; const gr = g.createRadialGradient(c, c, 0, c, c, c); gr.addColorStop(0, 'rgba(255,240,215,1)'); gr.addColorStop(0.12, 'rgba(255,220,170,0.5)'); gr.addColorStop(1, 'rgba(255,200,140,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    g.globalCompositeOperation = 'lighter';
    for (const [w, h] of [[S, 3], [3, S * 0.7]]) { const l = g.createLinearGradient(c - w / 2, c - h / 2, c + w / 2, c + h / 2); g.fillStyle = 'rgba(255,235,200,0.9)'; g.fillRect(c - w / 2, c - h / 2, w, h); }
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(2.2, 1.8, 1.3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, opacity: 0 }));
  m.renderOrder = 10; scene.add(m); return m;
})();

// ---------- camera path ----------
const CK = [ // t, pos, target, fov, roll, aperture
  [0.0, [1.3, -2.7, 3.5], [0.0, 0.5, -1.0], 30, 0.16, 1.2],
  [2.6, [1.4, -2.6, 4.4], [0.0, -0.1, -1.0], 32, 0.08, 1.1],
  [5.6, [-0.4, -0.9, 8.6], [0.1, 0.1, -1.0], 36, -0.02, 0.6],
  [7.8, [-1.6, -0.2, 9.2], [0.0, 0.1, -0.6], 36, -0.05, 0.5],
  [9.6, [-4.6, 1.5, 7.2], [0.0, 0.1, 0.0], 32, -0.1, 0.55],
  [11.8, [-4.3, 2.4, 5.9], [0.1, 0.0, 0.1], 30, -0.06, 0.6],
  [13.9, [-1.0, 1.4, 7.4], [0.0, 0.0, 0.2], 32, 0.03, 0.5],
  [16.0, [5.6, 2.4, 8.4], [0.0, 0.0, 0.5], 34, 0.07, 0.3],
  [18.2, [10.4, 2.6, 3.6], [0.0, 0.0, 0.6], 34, 0.06, 0.28],
  [20.4, [8.6, -2.0, 6.6], [0.0, 0.0, 0.3], 33, -0.02, 0.3],
  [22.6, [5.4, -2.3, 8.0], [0.0, 0.0, 0.3], 31, -0.06, 0.4],
  [24.8, [-3.0, -1.2, 7.8], [-0.9, 0.0, 0.0], 29, -0.05, 0.5],
  [27.2, [-4.4, 0.8, 8.8], [-1.55, -0.05, 0.0], 28, -0.02, 0.5],
  [30.0, [-4.8, 1.1, 8.5], [-1.65, -0.05, 0.0], 27.5, 0.0, 0.5],
];
function crSpline(t, idx) {
  let i = 0; while (i < CK.length - 2 && t > CK[i + 1][0]) i++;
  const k0 = CK[Math.max(0, i - 1)], k1 = CK[i], k2 = CK[i + 1], k3 = CK[Math.min(CK.length - 1, i + 2)];
  const u = clamp((t - k1[0]) / (k2[0] - k1[0]));
  const v = j => { const g = k => Array.isArray(k[idx]) ? k[idx][j] : k[idx]; return [g(k0), g(k1), g(k2), g(k3)]; };
  const dt1 = k2[0] - k1[0];
  const tan = (pa, pb, ta, tb) => (pb - pa) / Math.max(1e-3, tb - ta) * dt1;
  const out = [];
  const n = Array.isArray(CK[0][idx]) ? 3 : 1;
  for (let j = 0; j < n; j++) {
    const [p0, p1, p2, p3] = v(j);
    const m1 = tan(p0, p2, k0[0], k2[0]), m2 = tan(p1, p3, k1[0], k3[0]);
    const u2 = u * u, u3 = u2 * u;
    out.push((2 * u3 - 3 * u2 + 1) * p1 + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * p2 + (u3 - u2) * m2);
  }
  return n === 1 ? out[0] : out;
}
const camState = { focus: 8, apt: 0.5 };
function poseCamera(t) {
  const p = crSpline(t, 1), tg = crSpline(t, 2);
  camera.position.set(...p); camera.up.set(0, 1, 0); camera.lookAt(...tg);
  camera.rotateZ(crSpline(t, 4));
  camera.fov = crSpline(t, 3); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  // focus: on watch body during sketch the drawing (z=-1) is the subject
  const focusPt = new THREE.Vector3(...tg);
  camState.focus = camera.position.distanceTo(focusPt);
  camState.apt = crSpline(t, 5);
}

// ---------- pose(t): everything is a pure function of time ----------
const tmpV = new THREE.Vector3();
function explodeAmount(name, t) {
  const te = TL.explode[name], tr = TL.assemble[name];
  if (t < te) return 0;
  if (t < tr - 0.6) { const k = prog(te, te + 1.1, t); return eoBack(k, 1.2); }
  if (t < tr) return 1 - eiCubic(prog(tr - 0.6, tr, t));
  const d = t - tr; return -0.06 * Math.exp(-d * 14) * Math.sin(d * 40);
}
function drawProg(k, t) { const [a, b] = TL.sketch[k]; return ss(prog(a, b, t)); }
function tipTarget(t) {
  // latest started, not finished group -> current drawing point
  let best = null;
  for (const k in lineGroups) { const [a, b] = TL.sketch[k]; if (t >= a - 0.05 && (!best || a > TL.sketch[best][0]) && t <= b + 0.15) best = k; }
  if (!best) { let last = null; for (const k in lineGroups) if (TL.sketch[k][0] <= t && (!last || TL.sketch[k][1] > TL.sketch[last][1])) last = k; best = last || 'case'; }
  const G = lineGroups[best], n = Math.max(1, Math.floor(drawProg(best, t) * G.n)), s = G.segs[Math.min(G.n - 1, n - 1)];
  return new THREE.Vector3(s[4], s[5], -0.95);
}

function pose(t) {
  poseCamera(t);
  // --- sketch draw-on
  for (const k in lineGroups) {
    const G = lineGroups[k], n = Math.floor(drawProg(k, t) * G.n);
    G.main.geometry.instanceCount = n; G.ghost.geometry.instanceCount = Math.max(0, Math.floor(n * 0.98) - 6);
  }
  const cp = ss(prog(...TL.sketch.construct, t));
  construct.forEach((l, i) => { const k = clamp(cp * construct.length - i); l.geometry.instanceCount = Math.floor(k * l.geometry.attributes.instanceStart.count); });
  dimLine.geometry.instanceCount = Math.floor(ss(prog(...TL.dimLine, t)) * 8);
  notes.forEach((m, i) => { m.material.uniforms.wipe.value = lerp(-0.05, 1.05, prog(TL.notes[i][1], TL.notes[i][2], t)); });
  // --- lift: lines leave the paper, graphite turns into light
  const lift = eio(prog(...TL.lift, t));
  const s = lerp(0.015, 1, lift);
  sketchRoot.scale.set(1, 1, s); sketchRoot.position.z = -0.95 * (1 - s);
  const dim = ss(prog(...TL.dim, t));
  const lc = new THREE.Color(0x2a2a2e).lerp(new THREE.Color(2.2, 1.5, 0.75), ss(prog(7.4, 8.6, t)));
  lineMats.forEach(m => { m.color.copy(lc); m.opacity = m.userData.baseOp * (t > TL.sweep[1] + 0.1 ? 0 : 1); });
  sketchRoot.visible = t < TL.sweep[1] + 0.1;
  // --- paper: lights go down, then it falls away
  const pd = 1 - dim * 0.965;
  paperMat.color.setScalar(pd * PB); sheet2.material.color.setRGB(0.96 * pd * PB, 0.94 * pd * PB, 0.9 * pd * PB); ruler.material.color.setScalar(0.98 * pd * PB);
  conMats.forEach(m => { m.opacity = m.userData.baseOp * (1 - dim * 0.85); });
  notes.forEach(m => m.material.uniforms.op.value = 1 - dim * 0.8);
  backMat.uniforms.mixP.value = 1 - dim;
  const fall = eiCubic(prog(...TL.paperFall, t));
  paperG.rotation.x = -fall * 1.25; paperG.position.z = -1.0 - fall * 5;
  paperG.visible = t < TL.paperFall[1] + 0.05;
  // --- pencil: averaged target (smooth hand), lifts out after drawing
  if (t < TL.pencilOut[1] + 0.05) {
    pencil.visible = true;
    const acc = new THREE.Vector3(); const N = 12;
    for (let i = 0; i < N; i++) acc.add(tipTarget(t - i * 0.025));
    acc.multiplyScalar(1 / N);
    const out = eiCubic(prog(...TL.pencilOut, t));
    const hover = 0.04 * Math.max(0, Math.sin(t * 9.0)) * (t > 1.2 ? 1 : 0);
    pencil.position.set(acc.x + out * 6, acc.y + out * 3.5, -0.95 + hover + out * 5);
    pencil.rotation.z = Math.sin(t * 3.1) * 0.03 + out * 0.4;
  } else pencil.visible = false;
  // --- solid reveal sweep
  const sw = eio(prog(...TL.sweep, t));
  const C = lerp(-6.4, 6.4, sw);
  clipSolid.constant = t < TL.sweep[0] ? -50 : (sw >= 1 ? 50 : C);
  clipLine.normal.copy(seamWorld.normal).negate(); clipLine.constant = -clipSolid.constant;
  root.visible = t >= TL.sweep[0];
  U.uSeamOn.value = (t >= TL.sweep[0] && sw < 1) ? 1 : 0;
  // --- watch life: hands, gears, balance, rotor
  const tick = Math.max(0, t - TL.tickStart);
  const sec = Math.floor(tick * 8) / 8 + Math.min(1, (tick * 8 % 1) * 6) / 8;
  P.sec.userData.piv.rotation.z = -sec / 60 * TAU;
  P.min.userData.piv.rotation.z = -(10 + (tick) / 60) / 60 * TAU;
  P.hour.userData.piv.rotation.z = -(10 + 10 / 60) / 12 * TAU;
  gears.forEach((g, i) => { g.rotation.z = g.userData.sp * (tick * 0.6 + (i === 3 ? Math.floor(tick * 8) * 0.05 : 0)); });
  movG.userData.bal.rotation.z = Math.sin(tick * TAU * 3) * 2.2 * clamp(tick * 2);
  rotorG.userData.r.rotation.z = 0.6 * Math.sin(t * 1.1) + 0.3 * Math.sin(t * 2.3 + 1);
  // --- crown unscrew/screw
  const co = eio(prog(...TL.crownOut, t)), ci = eio(prog(...TL.crownIn, t));
  const cAmt = co * (1 - ci);
  P.crown.position.set(cAmt * 1.3, 0, 0); P.crown.rotation.x = (co - ci) * 6 * TAU;
  // --- explode / assemble
  for (const name of ORDER) {
    const g = P[name], e = explodeAmount(name, t), [ex, ey, ez, rz] = EXP[name];
    const float = (t > 15 && t < 21) ? Math.sin(t * 1.6 + ORDER.indexOf(name)) * 0.05 * clamp(e) : 0;
    g.position.set(ex * e, ey * e, ez * e + float);
    g.rotation.set(0.04 * float * 4, -0.03 * float * 4, rz * e);
  }
  // bracelet links breathe apart with the case
  const be = explodeAmount('case', t);
  braceRows.forEach(r => {
    const u = r.userData;
    r.position.copy(u.rest).addScaledVector(u.dir, be * 0.25 * (u.i + 1));
    r.rotation.x = u.restRot + be * 0.12 * Math.sin(u.i * 1.7) * u.s;
  });
  // --- environment drift + glint sweep
  scene.environmentRotation.set(0, 0.6 + t * 0.045 + 1.6 * ss(prog(TL.glint - 0.4, TL.glint + 0.9, t)), 0);
  key.intensity = 1.4 * (1 - 0.6 * (1 - dim));
  // --- big word FORM
  const [f0, f1] = TL.form;
  formWord.forEach((l, i) => {
    const k = eoExpo(prog(f0 + i * 0.16, f0 + i * 0.16 + 1.2, t)), o = ss(prog(f1 - 0.3 + i * 0.05, f1 + 0.25 + i * 0.05, t));
    l.position.set(l.userData.x, -0.6 * (1 - k), -3 * (1 - k) - o * 5);
    l.rotation.y = (1 - k) * 1.1 - o * 0.6;
    l.children[0].material.uniforms.op.value = k * (1 - o);
    l.visible = t > f0 && t < f1 + 1;
  });
  // --- dust
  const dOn = ss(prog(9.4, 11.0, t));
  dust.material.opacity = dOn; dust.visible = dOn > 0;
  { const p = dust.geometry.attributes.position, b = dust.userData.base, ph = dust.userData.ph;
    for (let i = 0; i < ph.length; i++) p.setXYZ(i, b[i * 3] + Math.sin(t * 0.3 + ph[i]) * 0.3 + t * 0.04, b[i * 3 + 1] + Math.cos(t * 0.23 + ph[i]) * 0.25 - t * 0.02, b[i * 3 + 2]);
    p.needsUpdate = true; }
  // --- flare on crystal
  const gl = prog(TL.glint - 0.25, TL.glint + 0.7, t);
  flare.material.opacity = 0.75 * Math.sin(Math.PI * gl) * (gl > 0 && gl < 1 ? 1 : 0);
  tmpV.set(lerp(-1.1, 1.0, gl), lerp(1.0, -0.4, gl), 0.7); flare.position.copy(tmpV);
  flare.quaternion.copy(camera.quaternion); flare.scale.setScalar(0.25 + 0.55 * Math.sin(Math.PI * gl));
  flare.rotation.z += gl * 0.6;
  scene.updateMatrixWorld(true);
}

// ---------- post: accumulation (motion blur + AA) and DOF composite ----------
const rtScene = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(W, H) });
const rtAcc = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthBuffer: false });
const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const fsGeo = new THREE.PlaneGeometry(2, 2);
const accMat = new THREE.ShaderMaterial({
  uniforms: { tex: { value: rtScene.texture }, w: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }',
  fragmentShader: 'uniform sampler2D tex; uniform float w; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(tex,vUv).rgb*w, w); }',
  blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, depthTest: false, depthWrite: false,
});
// post in three passes: CoC at half res -> DOF/bloom gather at half res -> full-res grade (sharp/blurred mix by CoC)
const HW = W >> 1, HH = H >> 1;
const rtCoc = new THREE.WebGLRenderTarget(HW, HH, { type: THREE.HalfFloatType, depthBuffer: false });
const rtBlur = new THREE.WebGLRenderTarget(HW, HH, { type: THREE.HalfFloatType, depthBuffer: false });
const VS = 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }';
const PX = (H / 1080).toFixed(4);
const cocMat = new THREE.ShaderMaterial({
  uniforms: { tex: { value: rtAcc.texture }, dep: { value: rtScene.depthTexture }, focus: { value: 8 }, apt: { value: 0.5 }, near: { value: 0.1 }, far: { value: 200 } },
  vertexShader: VS, depthTest: false, depthWrite: false,
  fragmentShader: `uniform sampler2D tex, dep; uniform float focus, apt, near, far; varying vec2 vUv;
    float lin(float d){ float z=d*2.-1.; return 2.*near*far/(far+near-z*(far-near)); }
    void main(){ float d=lin(texture2D(dep,vUv).x);
      gl_FragColor = vec4(texture2D(tex,vUv).rgb, clamp(apt*abs(1.-focus/d)*22.*${PX}, 0., 26.*${PX})); }`,
});
const blurMat = new THREE.ShaderMaterial({
  uniforms: { src: { value: rtCoc.texture }, res: { value: new THREE.Vector2(HW, HH) } },
  vertexShader: VS, depthTest: false, depthWrite: false,
  fragmentShader: `uniform sampler2D src; uniform vec2 res; varying vec2 vUv;
    void main(){
      vec4 c0 = texture2D(src,vUv); vec3 acc=c0.rgb; float ws=1.; const float ga=2.39996;
      for(int i=1;i<32;i++){
        float r = sqrt(float(i)/32.)*13.*${PX}; float a=float(i)*ga;   // half-res pixels
        vec4 s = texture2D(src, vUv+vec2(cos(a),sin(a))*r/res);
        float w = smoothstep(r-0.8, r+0.3, min(s.a*0.5, max(c0.a*0.5, s.a*0.3)));
        acc += s.rgb*w; ws += w;
      }
      vec3 bl=vec3(0.);
      for(int i=0;i<16;i++){ float r=(3.+float(i)*2.)*${PX}; float a=float(i)*ga*1.3;
        bl += max(texture2D(src, vUv+vec2(cos(a),sin(a))*r/res).rgb-1.2,0.)*exp(-float(i)*0.15); }
      gl_FragColor = vec4(acc/ws + bl*0.07, c0.a);
    }`,
});
const compMat = new THREE.ShaderMaterial({
  uniforms: { tex: { value: rtAcc.texture }, blur: { value: rtBlur.texture }, res: { value: new THREE.Vector2(W, H) }, frame: { value: 0 }, expo: { value: 1 }, fade: { value: 1 },
    focus: { value: 8 }, apt: { value: 0.5 } },
  vertexShader: VS, depthTest: false, depthWrite: false,
  fragmentShader: `uniform sampler2D tex, blur; uniform float frame, expo, fade; uniform vec2 res; varying vec2 vUv;
    vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.); }
    float h(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233))+frame*0.618)*43758.5453); }
    void main(){
      vec4 b = texture2D(blur,vUv);
      vec3 sharp = texture2D(tex,vUv).rgb;
      float m = smoothstep(0.6, 2.5, b.a);
      vec3 col = mix(sharp, b.rgb, m);
      vec2 dc = vUv-.5; float r2 = dot(dc,dc);
      col.r = mix(col.r, texture2D(tex, vUv - dc*r2*0.006).r, 0.5*smoothstep(0.05,0.3,r2)*(1.-m));
      col.b = mix(col.b, texture2D(tex, vUv + dc*r2*0.006).b, 0.5*smoothstep(0.05,0.3,r2)*(1.-m));
      col = aces(col*expo);
      col *= mix(1., 0.62, smoothstep(0.12, 0.62, r2*1.6));
      col = pow(col, vec3(1./2.2));
      col += (h(vUv*res)-.5)*0.028;
      gl_FragColor = vec4(col*fade,1.);
    }`,
});
const fsScene = new THREE.Scene(); const fsQuad = new THREE.Mesh(fsGeo, accMat); fsScene.add(fsQuad);

// pixel speed estimate -> number of motion-blur subframes
const probes = () => {
  const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(1.9, 1.9, 0.5), new THREE.Vector3(-2, -2, 0.5)];
  for (const n of ORDER) pts.push(P[n].getWorldPosition(new THREE.Vector3()));
  if (pencil.visible) pts.push(pencil.getWorldPosition(new THREE.Vector3()));
  return pts;
};
function screenPts(t) { pose(t); return probes().map(p => p.project(camera)); }
function blurSamples(t, fps) {
  const sh = 0.5 / fps;
  const a = screenPts(t - sh / 2), b = screenPts(t + sh / 2);
  let mx = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) mx = Math.max(mx, Math.hypot((a[i].x - b[i].x) * W / 2, (a[i].y - b[i].y) * H / 2));
  return mx;
}
const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };

window.renderFrame = (t, fps = 60, minK = 3, maxK = 10) => {
  const px = minK > 1 ? blurSamples(t, fps) : 0;
  const K = Math.max(minK, Math.min(maxK, Math.ceil(px / 4)));
  window.lastPx = px;
  const sh = 0.5 / fps;
  // centered subframe order, centre last so its depth feeds DOF
  const offs = []; for (let i = 0; i < K; i++) offs.push(K === 1 ? 0 : (i / (K - 1) - 0.5) * sh);
  offs.sort((x, y) => Math.abs(y) - Math.abs(x));
  renderer.setRenderTarget(rtAcc); renderer.setClearColor(0x000000, 0); renderer.clear();
  offs.forEach((o, i) => {
    pose(t + o);
    if (K > 1) camera.setViewOffset(W, H, halton(i + 1, 2) - 0.5, halton(i + 1, 3) - 0.5, W, H); else camera.clearViewOffset();
    const P4 = clipSolid.clone().applyMatrix4(camera.matrixWorldInverse);
    U.uSeam.value.set(P4.normal.x, P4.normal.y, P4.normal.z, P4.constant);
    renderer.setRenderTarget(rtScene); renderer.setClearColor(0x000000, 1); renderer.clear(); renderer.render(scene, camera);
    accMat.uniforms.w.value = 1 / K; renderer.setRenderTarget(rtAcc); renderer.render(fsScene, fsCam);
  });
  camera.clearViewOffset();
  cocMat.uniforms.focus.value = camState.focus; cocMat.uniforms.apt.value = camState.apt;
  fsQuad.material = cocMat; renderer.setRenderTarget(rtCoc); renderer.render(fsScene, fsCam);
  fsQuad.material = blurMat; renderer.setRenderTarget(rtBlur); renderer.render(fsScene, fsCam);
  fsQuad.material = compMat;
  compMat.uniforms.frame.value = Math.round(t * fps);
  compMat.uniforms.fade.value = Math.min(ss(prog(0, 0.5, t)) * 0.9 + 0.1, 1);
  renderer.setRenderTarget(null); renderer.render(fsScene, fsCam);
  fsQuad.material = accMat;
  ui(t);
  const g = renderer.getContext(); const px1 = new Uint8Array(4); g.readPixels(0, 0, 1, 1, g.RGBA, g.UNSIGNED_BYTE, px1);
  return K;
};

// ---------- DOM typography: labels + title ----------
const labs = document.getElementById('labs'), lead = document.getElementById('lead');
const labEls = {};
for (const n in LABELS) { const d = document.createElement('div'); d.className = 'lab'; labs.appendChild(d); labEls[n] = d; }
const titleEl = document.getElementById('title'), subEl = document.getElementById('sub');
const TITLE = 'LINE · FORM · TIME';
titleEl.innerHTML = [...TITLE].map(c => `<span>${c === ' ' ? '&nbsp;' : c}</span>`).join('');
const SUB = 'FIG. 05 — ASSEMBLED, RUNNING';
function ui(t) {
  pose(t);
  let svg = '';
  const [l0, l1] = TL.labels;
  Object.keys(LABELS).forEach((n, i) => {
    const el = labEls[n], [num, txt, anchor] = LABELS[n];
    const k = prog(l0 + i * 0.22, l0 + i * 0.22 + 0.6, t), o = ss(prog(l1, l1 + 0.4, t));
    if (k <= 0 || o >= 1) { el.style.opacity = 0; return; }
    const a = new THREE.Vector3(...anchor).applyMatrix4(P[n].matrixWorld).project(camera);
    const ax = (a.x + 1) * 960, ay = (1 - a.y) * 540;
    // labels sit on two rails (top / bottom) like callouts on a technical drawing
    const side = 1, top = i % 2 === 0;
    const lx = ax, ly = top ? 150 + (i % 4 ? 0 : 0) + ((i >> 1) % 2) * 34 : 930 - ((i >> 1) % 2) * 34;
    const lk = ss(clamp(k * 2));
    svg += `<line x1="${ax}" y1="${ay}" x2="${lerp(ax, lx, lk)}" y2="${lerp(ay, ly, lk)}" stroke="rgba(214,170,92,${0.8 * (1 - o)})" stroke-width="1"/>`;
    svg += `<circle cx="${ax}" cy="${ay}" r="${3 * lk}" fill="rgba(244,228,198,${1 - o})"/>`;
    const nch = Math.floor(clamp((k - 0.3) / 0.7) * txt.length);
    el.innerHTML = `<b>${num}</b>${txt.slice(0, nch)}`;
    el.style.opacity = 1 - o;
    el.style.left = (side > 0 ? lx + 8 : lx - 8 - el.offsetWidth) + 'px';
    el.style.top = (ly - 9) + 'px';
  });
  lead.innerHTML = svg;
  // title: letters gather from wide tracking, blur -> sharp
  const [t0, t1] = TL.title;
  [...titleEl.children].forEach((s, i) => {
    const k = eoExpo(prog(t0 + i * 0.06, t0 + i * 0.06 + 1.3, t));
    s.style.opacity = k;
    s.style.transform = `translate(${(1 - k) * (i - 8) * 18}px, ${(1 - k) * 26}px)`;
    s.style.filter = `blur(${(1 - k) * 10}px)`;
  });
  const sk2 = prog(t1 - 0.6, t1 + 0.8, t);
  subEl.textContent = SUB.slice(0, Math.floor(sk2 * SUB.length));
}

window.DUR = TL.dur;
window.ready = true;
window.blurPx = blurSamples;
console.log(Object.entries(lineGroups).map(([k, g]) => k + "=" + g.n).join(" "));

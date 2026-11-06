// Builds Kairos body-map assets from BodyParts3D 4.0 (IS-A tree OBJ files).
//
//   node build.js <folder with selection.json and an obj/ folder of FJ*.obj files>
//
// Output (in ../../body/):
//   bones.bin, muscles.bin, skin.bin, dermatomes.bin  — quantised meshes
//   manifest.json — structures, byte ranges, scale, nerve paths, landmarks
//
// Coordinates are converted to Three.js style: millimetres, +Y up, +Z anterior,
// the body's right side at -X (so a camera in front sees it on the viewer's left).

const fs = require('fs');
const path = require('path');
const { MeshoptSimplifier } = require('meshoptimizer');
const dermatomes = require('./dermatomes.js');
const nerves = require('./nerves.js');

const SRC = process.argv[2];
const OUT = path.join(__dirname, '..', '..', 'body');
const BUDGET = { bones: 110000, muscles: 140000, skin: 60000 }; // triangles per layer

const sel = JSON.parse(fs.readFileSync(path.join(SRC, 'selection.json'), 'utf8'));
const objDir = findObjDir(path.join(SRC, 'obj'));

function findObjDir(dir) {
  // The archive may unpack into a nested folder; find the one holding FJ*.obj.
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    const items = fs.readdirSync(d, { withFileTypes: true });
    if (items.some((i) => i.isFile() && /^FJ\d+\.obj$/i.test(i.name))) return d;
    for (const i of items) if (i.isDirectory()) stack.push(path.join(d, i.name));
  }
  throw new Error('No FJ*.obj files found under ' + dir);
}

function readObj(file) {
  const text = fs.readFileSync(file, 'utf8');
  const pos = [], idx = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('v ')) {
      const p = line.trim().split(/\s+/);
      pos.push(+p[1], +p[2], +p[3]);
    } else if (line.startsWith('f ')) {
      const p = line.trim().split(/\s+/).slice(1).map((t) => parseInt(t, 10) - 1);
      for (let i = 1; i < p.length - 1; i++) idx.push(p[0], p[i], p[i + 1]);
    }
  }
  return { pos, idx };
}

// ---------- 1. load and merge each structure ----------
const raw = [];
for (const s of sel) {
  const pos = [], idx = [];
  for (const f of s.files) {
    const file = path.join(objDir, f + '.obj');
    if (!fs.existsSync(file)) { console.warn('missing', f, 'for', s.id); continue; }
    const m = readObj(file);
    const base = pos.length / 3;
    for (const v of m.pos) pos.push(v);
    for (const i of m.idx) idx.push(i + base);
  }
  if (idx.length) raw.push({ ...s, pos: new Float32Array(pos), idx: new Uint32Array(idx) });
}

// ---------- 2. work out the axes ----------
function centroid(p) { let x = 0, y = 0, z = 0; const n = p.length / 3; for (let i = 0; i < p.length; i += 3) { x += p[i]; y += p[i + 1]; z += p[i + 2]; } return [x / n, y / n, z / n]; }
const get = (id) => raw.find((r) => r.id === id);
const cR = centroid(get('right_femur').pos), cL = centroid(get('left_femur').pos);
const cSkull = centroid(get('skull').pos), cFoot = centroid(get('right_calcaneus').pos);
const cPat = centroid(get('right_patella').pos);
// Vertical axis: the one with the biggest skull-to-heel difference.
const diff = [0, 1, 2].map((a) => cSkull[a] - cFoot[a]);
const up = diff.map(Math.abs).indexOf(Math.max(...diff.map(Math.abs)));
const upSign = Math.sign(diff[up]);
const lr = [0, 1, 2].filter((a) => a !== up).sort((a, b) => Math.abs(cL[b] - cR[b]) - Math.abs(cL[a] - cR[a]))[0];
const lrSign = Math.sign(cL[lr] - cR[lr]); // left side becomes +X
const ap = [0, 1, 2].find((a) => a !== up && a !== lr);
const apSign = Math.sign(cPat[ap] - cR[ap]); // patella is in front of the femur: anterior becomes +Z
console.log('axes: up', up, upSign, 'lr', lr, lrSign, 'ap', ap, apSign);

for (const r of raw) {
  const p = r.pos;
  for (let i = 0; i < p.length; i += 3) {
    const v = [p[i], p[i + 1], p[i + 2]];
    p[i] = v[lr] * lrSign; p[i + 1] = v[up] * upSign; p[i + 2] = v[ap] * apSign;
  }
}
// Centre the body: feet at y=0, midline at x=0, z centred.
let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
for (const r of raw) for (let i = 0; i < r.pos.length; i += 3) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], r.pos[i + a]); mx[a] = Math.max(mx[a], r.pos[i + a]); }
const shift = [-(mn[0] + mx[0]) / 2, -mn[1], -(mn[2] + mx[2]) / 2];
for (const r of raw) for (let i = 0; i < r.pos.length; i += 3) for (let a = 0; a < 3; a++) r.pos[i + a] += shift[a];
mn = mn.map((v, a) => v + shift[a]); mx = mx.map((v, a) => v + shift[a]);
console.log('body size (mm):', mx.map((v, a) => Math.round(v - mn[a])).join(' x '));

// ---------- 3. simplify ----------
function weld(pos, idx) {
  const map = new Map(), out = [], remap = new Uint32Array(pos.length / 3);
  for (let i = 0; i < pos.length / 3; i++) {
    const k = `${Math.round(pos[i * 3] * 20)},${Math.round(pos[i * 3 + 1] * 20)},${Math.round(pos[i * 3 + 2] * 20)}`;
    let j = map.get(k);
    if (j === undefined) { j = out.length / 3; map.set(k, j); out.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); }
    remap[i] = j;
  }
  const ni = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i++) ni[i] = remap[idx[i]];
  return { pos: new Float32Array(out), idx: ni };
}
function compact(pos, idx) {
  const map = new Map(), out = [], ni = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i++) {
    let j = map.get(idx[i]);
    if (j === undefined) { j = out.length / 3; map.set(idx[i], j); out.push(pos[idx[i] * 3], pos[idx[i] * 3 + 1], pos[idx[i] * 3 + 2]); }
    ni[i] = j;
  }
  return { pos: new Float32Array(out), idx: ni };
}

(async () => {
  await MeshoptSimplifier.ready;
  const layerTris = {};
  for (const r of raw) { const w = weld(r.pos, r.idx); r.pos = w.pos; r.idx = w.idx; layerTris[r.layer] = (layerTris[r.layer] || 0) + r.idx.length / 3; }
  console.log('source triangles:', JSON.stringify(layerTris));
  for (const r of raw) {
    const ratio = Math.min(1, BUDGET[r.layer] / layerTris[r.layer]);
    const target = Math.max(300, Math.floor((r.idx.length / 3) * ratio)) * 3;
    if (target < r.idx.length) {
      const [out] = MeshoptSimplifier.simplify(r.idx, r.pos, 3, target, 0.02, ['LockBorder']);
      const c = compact(r.pos, out);
      r.pos = c.pos; r.idx = c.idx;
    }
  }

  // ---------- 4. landmarks, nerves, dermatomes ----------
  const box = (id) => { const r = get(id); const b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }; for (let i = 0; i < r.pos.length; i += 3) for (let a = 0; a < 3; a++) { b.min[a] = Math.min(b.min[a], r.pos[i + a]); b.max[a] = Math.max(b.max[a], r.pos[i + a]); } return b; };
  const pts = (id) => get(id).pos;
  const L = require('./landmarks.js')({ get, box, pts, centroid });
  const nerveList = nerves(L);
  const skin = get('skin');
  const dermParts = dermatomes(skin, L);
  if (process.env.DEBUG_DERM) { const s = L.side.right; console.log(JSON.stringify({ humTop: s.humTop, humBot: s.humBot, radBot: s.radBot, handTip: s.handTip, acromion: s.acromion, clav: s.clav, chin: L.chin }, (k, v) => typeof v === 'number' ? Math.round(v) : v)); const c = {}; for (const d of dermParts) c[d.seg] = (c[d.seg] || 0) + d.idx.length / 3; console.log(JSON.stringify(c)); }
  const dermStructs = dermParts.map((d) => ({ id: d.id, name: d.name, layer: 'dermatomes', side: d.side, pos: d.pos, idx: d.idx, family: d.family, seg: d.seg }));

  // ---------- 5. quantise and write ----------
  fs.mkdirSync(OUT, { recursive: true });
  const all = [...raw, ...dermStructs];
  let gmax = 0; for (const r of all) for (const v of r.pos) gmax = Math.max(gmax, Math.abs(v - 0));
  const k = gmax / 32767; // mm per unit
  const manifest = { version: 1, k, size: mx.map((v, a) => v - mn[a]), layers: {}, structures: [], nerves: nerveList, landmarks: L.export };
  for (const layer of ['bones', 'muscles', 'skin', 'dermatomes']) {
    const chunks = []; let off = 0; let tris = 0;
    for (const r of all.filter((x) => x.layer === layer)) {
      const q = new Int16Array(r.pos.length);
      for (let i = 0; i < q.length; i++) q[i] = Math.round(r.pos[i] / k);
      const big = r.pos.length / 3 > 65535;
      const ib = big ? new Uint32Array(r.idx) : new Uint16Array(r.idx);
      const vOff = off; chunks.push(Buffer.from(q.buffer)); off += q.byteLength;
      const pad = (4 - (off % 4)) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); off += pad; }
      const iOff = off; chunks.push(Buffer.from(ib.buffer)); off += ib.byteLength;
      const pad2 = (4 - (off % 4)) % 4; if (pad2) { chunks.push(Buffer.alloc(pad2)); off += pad2; }
      tris += r.idx.length / 3;
      const c = centroid(r.pos);
      manifest.structures.push({ id: r.id, name: r.name, layer, side: r.side, family: r.family, v: [vOff, r.pos.length / 3], i: [iOff, r.idx.length, big ? 32 : 16], c: c.map((x) => Math.round(x)) });
    }
    const buf = Buffer.concat(chunks);
    fs.writeFileSync(path.join(OUT, layer + '.bin'), buf);
    manifest.layers[layer] = { file: layer + '.bin', bytes: buf.length, triangles: tris };
    console.log(layer, (buf.length / 1e6).toFixed(2), 'MB', tris, 'triangles');
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest));
  console.log('structures', manifest.structures.length, 'nerves', nerveList.length);
})();

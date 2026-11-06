// Kairos body map: 3D anatomy you can tap to log pain.
// Plain Three.js. Loaded on demand from app.js with import('./body.js').
import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';

const ORDER = ['skin', 'muscles', 'bones', 'nerves', 'dermatomes'];
const LABEL = { skin: 'Skin', muscles: 'Muscles', bones: 'Bones', nerves: 'Nerves', dermatomes: 'Dermatomes' };
// What each layer looks like when you focus on a given layer ("peeling").
const LOOK = {
  skin: { skin: 'solid' },
  muscles: { muscles: 'solid', bones: 'ghost' },
  bones: { bones: 'solid', muscles: 'faint' },
  nerves: { nerves: 'solid', bones: 'ghost', muscles: 'faint' },
  dermatomes: { dermatomes: 'solid', bones: 'ghost' },
};
const BASE = { skin: 0xcfc3b4, muscles: 0xb8675e, bones: 0xebe4d6, nerves: 0xf0b44c };
const DERM = { C: 0x7fb8ff, T: 0x8fdcaa, L: 0xf0b44c, S: 0xc9a0ff, V: 0xff9fb0 };
const GHOST = 0xc3cad4, SELECT = 0xff4d6a, BG = 0x10141b;
const HEAT = [0xf0b44c, 0xff6f61, 0xff3d5a, 0xb0129b];
const TYPES = ['Sharp', 'Dull', 'Burning', 'Tingling', 'Stiffness', 'Other'];
const TIMINGS = ['At rest', 'During session', 'After session'];
const SIDES = ['Left', 'Right', 'Both', 'Midline'];

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const sRGB = (h) => new THREE.Color(h).convertSRGBToLinear();

let root, api, manifest, renderer, scene, camera, controls, stage, canvas;
const meshes = new Map();    // structure id -> mesh
const proxies = new Map();   // nerve id -> invisible hit mesh
const info = new Map();      // structure id -> {id, name, layer, side, ...}
const loaded = new Set(), loading = new Map();
const st = { focus: 'muscles', selected: null, heat: false, win: 30, histScope: 'all', histLayer: 'all', anim: null, visible: false };

export function attach(slot, appApi) {
  api = appApi;
  if (!root) build();
  slot.appendChild(root);
  st.visible = true;
  resize();
  renderer.setAnimationLoop(tick);
  refreshPanels();
  if (api.focusStructure) { const id = api.focusStructure; api.focusStructure = null; whenReady(() => focusOn(id)); }
}
export function detach() {
  st.visible = false;
  if (renderer) renderer.setAnimationLoop(null);
}
export function refresh() { if (root) { applyLook(); refreshPanels(); } }

/* ---------- setup ---------- */
function build() {
  root = document.createElement('div');
  root.className = 'bm';
  root.innerHTML = `
    <div class="bm-stage"><canvas aria-label="3D body map"></canvas>
      <div class="bm-views"><button data-bm="view" data-v="front">Front</button><button data-bm="view" data-v="back">Back</button><button data-bm="view" data-v="side">Side</button></div>
      <div class="bm-loading" hidden></div>
    </div>
    <div class="bm-name"><div class="bm-side"></div><div class="bm-title">tap the body</div></div>
    <div class="bm-actions"></div>
    <div class="bm-layers" role="tablist">${ORDER.map((l) => `<button data-bm="layer" data-l="${l}">${LABEL[l]}</button>`).join('')}</div>
    <div class="bm-heatbar"></div>
    <div class="bm-hist"></div>
    <p class="bm-note">Kairos is a logging tool, not a diagnosis. If pain is severe, keeps getting worse, or comes with numbness, weakness or pins and needles that spread, see a physio or doctor.</p>
    <p class="bm-credit">3D models: BodyParts3D, © The Database Center for Life Science, licensed under CC BY 4.0 (simplified for mobile). Nerve paths and the dermatome map are schematic approximations drawn by Kairos.</p>
    <div class="bm-sheet" hidden></div>`;
  stage = root.querySelector('.bm-stage');
  canvas = root.querySelector('canvas');

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  camera = new THREE.PerspectiveCamera(30, 1, 5, 20000);
  scene.add(new THREE.HemisphereLight(0xeef2f8, 0x23272d, 0.55));
  const L = (c, i, x, y, z) => { const l = new THREE.DirectionalLight(c, i); l.position.set(x, y, z); scene.add(l); };
  L(0xffffff, 1.35, 600, 1000, 1400); L(0xa9c0ff, 0.45, -1200, 200, 600); L(0xffffff, 0.7, 0, 600, -1600); L(0xfff0dc, 0.3, 0, -1200, 600);

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.minDistance = 180;
  controls.maxDistance = 6000;
  controls.zoomSpeed = 0.9;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

  // Tap (not drag) selects
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t;
    down = null;
    if (moved < 8 && dt < 600) pick(e);
  });

  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  new ResizeObserver(resize).observe(stage);
  load();
}

async function load() {
  setLoading('Loading the body map…');
  manifest = await (await fetch('body/manifest.json')).json();
  for (const s of manifest.structures) info.set(s.id, s);
  for (const n of manifest.nerves) info.set(n.id, { ...n, layer: 'nerves' });
  const H = manifest.size[1];
  controls.target.set(0, H * 0.52, 0);
  camera.position.set(0, H * 0.52, (H / 2) / Math.tan(THREE.MathUtils.degToRad(15)) * 1.12);
  controls.update();
  await applyLook();
  setLoading(null);
  readyQueue.splice(0).forEach((f) => f());
}
const readyQueue = [];
function whenReady(f) { if (manifest && loaded.has(st.focus)) f(); else readyQueue.push(f); }

async function ensureLayer(layer) {
  if (loaded.has(layer)) return;
  if (loading.has(layer)) return loading.get(layer);
  const p = (async () => {
    setLoading(`Loading ${LABEL[layer].toLowerCase()}…`);
    if (layer === 'nerves') buildNerves();
    else {
      const buf = await (await fetch(`body/${manifest.layers[layer].file}`)).arrayBuffer();
      for (const s of manifest.structures.filter((x) => x.layer === layer)) {
        const q = new Int16Array(buf, s.v[0], s.v[1] * 3);
        const pos = new Float32Array(q.length);
        for (let i = 0; i < q.length; i++) pos[i] = q[i] * manifest.k;
        const idx = s.i[2] === 32 ? new Uint32Array(buf, s.i[0], s.i[1]) : new Uint16Array(buf, s.i[0], s.i[1]);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setIndex(new THREE.BufferAttribute(idx, 1));
        g.computeVertexNormals();
        g.computeBoundingBox(); g.computeBoundingSphere();
        const m = new THREE.Mesh(g, material());
        m.userData = { id: s.id, layer };
        meshes.set(s.id, m);
        scene.add(m);
      }
    }
    loaded.add(layer);
    setLoading(null);
  })();
  loading.set(layer, p);
  return p;
}

function buildNerves() {
  for (const n of manifest.nerves) {
    const curve = new THREE.CatmullRomCurve3(n.points.map((p) => new THREE.Vector3(...p)));
    const segs = Math.max(24, n.points.length * 14);
    const g = new THREE.TubeGeometry(curve, segs, n.radius, 8, false);
    g.computeBoundingBox(); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material());
    m.userData = { id: n.id, layer: 'nerves' };
    meshes.set(n.id, m); scene.add(m);
    // Nerves are thin: give each a much fatter invisible tube to tap.
    const hit = new THREE.Mesh(new THREE.TubeGeometry(curve, segs, Math.max(n.radius * 3, 14), 6, false), new THREE.MeshBasicMaterial());
    hit.visible = false;
    hit.userData = { id: n.id, layer: 'nerves', proxy: true };
    proxies.set(n.id, hit); scene.add(hit);
  }
}

function material() {
  return new THREE.MeshStandardMaterial({ color: sRGB(0xffffff), roughness: 0.55, metalness: 0, side: THREE.DoubleSide });
}

/* ---------- look ---------- */
function heatScores() {
  const cut = st.win ? ymd(new Date(Date.now() - (st.win - 1) * 86400000)) : '0000';
  const sc = new Map();
  for (const l of api.logs()) {
    if (l.date < cut) continue;
    const s = sc.get(l.structure) || { sum: 0, n: 0, max: 0 };
    s.sum += l.intensity; s.n += 1; s.max = Math.max(s.max, l.intensity);
    sc.set(l.structure, s);
  }
  let top = 0; for (const v of sc.values()) top = Math.max(top, v.sum);
  return { sc, top };
}
function heatColour(f) {
  const t = Math.max(0, Math.min(0.999, f)) * (HEAT.length - 1);
  const i = Math.floor(t);
  return new THREE.Color(HEAT[i]).lerp(new THREE.Color(HEAT[i + 1]), t - i);
}
function baseColour(id, layer) {
  if (layer === 'dermatomes') {
    const s = info.get(id); const seg = id.split('_')[1] || 'T';
    const c = new THREE.Color(DERM[s.family] || 0xffffff);
    const n = parseInt(seg.slice(1), 10) || 0;
    return c.offsetHSL(n % 2 ? 0.025 : -0.025, 0, n % 2 ? 0.1 : -0.08); // alternate shades so neighbouring segments stand apart
  }
  return new THREE.Color(BASE[layer]);
}

async function applyLook() {
  const look = LOOK[st.focus];
  const need = ORDER.filter((l) => look[l]);
  await Promise.all(need.map(ensureLayer));
  const heat = st.heat ? heatScores() : null;
  for (const [id, m] of meshes) {
    const layer = m.userData.layer, mode = look[layer];
    const mat = m.material;
    if (!mode) { m.visible = false; continue; }
    m.visible = true;
    mat.emissive.setHex(0);
    if (mode === 'solid') {
      let c = baseColour(id, layer);
      if (heat) {
        const h = heat.sc.get(id);
        c = h ? heatColour(h.sum / heat.top) : c.clone().lerp(new THREE.Color(0x5a6370), 0.6);
      }
      if (st.selected === id) { c = new THREE.Color(SELECT); mat.emissive.setHex(0x3a0a14); }
      mat.color.copy(c).convertSRGBToLinear();
      mat.transparent = layer === 'dermatomes'; mat.opacity = layer === 'dermatomes' ? 0.92 : 1; mat.depthWrite = true;
    } else {
      mat.color.copy(sRGB(mode === 'ghost' ? GHOST : BASE[layer]));
      mat.transparent = true; mat.opacity = mode === 'ghost' ? 0.14 : 0.06; mat.depthWrite = false;
    }
    m.renderOrder = mode === 'solid' ? 0 : 1;
  }
  root.querySelectorAll('[data-bm="layer"]').forEach((b) => b.classList.toggle('on', b.dataset.l === st.focus));
}

/* ---------- picking and camera ---------- */
const ray = new THREE.Raycaster(), mv = new THREE.Vector2();
function pick(e) {
  const r = canvas.getBoundingClientRect();
  mv.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mv, camera);
  const targets = st.focus === 'nerves' ? [...proxies.values()] : [...meshes.values()].filter((m) => m.visible && m.userData.layer === st.focus);
  const hit = ray.intersectObjects(targets, false)[0];
  select(hit ? hit.object.userData.id : null);
}
function select(id) {
  st.selected = id;
  if (id && st.histScope === 'all') st.histScope = 'all';
  applyLook(); refreshPanels();
}
function animateTo(target, pos) {
  st.anim = { t0: performance.now(), from: { t: controls.target.clone(), p: camera.position.clone() }, to: { t: target, p: pos } };
}
function setView(v) {
  const H = manifest.size[1];
  const t = new THREE.Vector3(0, H * 0.52, 0);
  const d = (H / 2) / Math.tan(THREE.MathUtils.degToRad(15)) * 1.12; // whole body in view
  const p = v === 'back' ? new THREE.Vector3(0, t.y, -d) : v === 'side' ? new THREE.Vector3(-d, t.y, 0) : new THREE.Vector3(0, t.y, d);
  animateTo(t, p);
}
async function focusOn(id) {
  const s = info.get(id);
  if (!s) return;
  if (st.focus !== s.layer) { st.focus = s.layer; await applyLook(); }
  const m = meshes.get(id);
  if (!m) return;
  const box = m.geometry.boundingBox, c = new THREE.Vector3(), size = new THREE.Vector3();
  box.getCenter(c); box.getSize(size);
  const dist = Math.max(size.length() * 2.4, 420);
  // Look from the side the structure faces most: front unless it sits behind the midline.
  const dir = new THREE.Vector3(c.x * 0.6, 0.15, c.z < -20 ? -1 : 1).normalize();
  animateTo(c, c.clone().add(dir.multiplyScalar(dist)));
  select(id);
}
function tick(now) {
  if (st.anim) {
    const a = st.anim, k = Math.min(1, (now - a.t0) / 450), e = 1 - Math.pow(1 - k, 3);
    controls.target.lerpVectors(a.from.t, a.to.t, e);
    camera.position.lerpVectors(a.from.p, a.to.p, e);
    if (k >= 1) st.anim = null;
  }
  controls.update();
  renderer.render(scene, camera);
}
function resize() {
  if (!stage || !renderer) return;
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
function setLoading(msg) {
  const el = root.querySelector('.bm-loading');
  el.hidden = !msg; el.textContent = msg || '';
}

/* ---------- panels ---------- */
function sideText(s) { return s.side === 'midline' ? 'Midline' : cap(s.side); }
function plainName(s) { return s.side === 'midline' ? s.name : s.name.replace(/^(right|left) /, ''); }
function refreshPanels() {
  if (!root || !manifest) return;
  const s = st.selected && info.get(st.selected);
  root.querySelector('.bm-side').textContent = s ? `${sideText(s)} · ${LABEL[s.layer].replace(/s$/, '').toLowerCase()}` : LABEL[st.focus];
  root.querySelector('.bm-title').textContent = s ? plainName(s) : st.focus === 'nerves' ? 'tap a nerve' : st.focus === 'dermatomes' ? 'tap where you feel it' : 'tap the body';
  const back = api.fromCheckin() ? `<button class="bm-btn" data-bm="back">Back to check-in</button>` : '';
  root.querySelector('.bm-actions').innerHTML = s
    ? `<button class="bm-btn primary" data-bm="log">Log pain here</button><button class="bm-btn" data-bm="clear">Clear</button>${back}`
    : back;
  const { sc } = heatScores();
  root.querySelector('.bm-heatbar').innerHTML = `
    <button class="bm-chip ${st.heat ? 'on' : ''}" data-bm="heat">Heat map ${st.heat ? 'on' : 'off'}</button>
    ${[7, 30, 90].map((w) => `<button class="bm-chip ${st.win === w ? 'on' : ''}" data-bm="win" data-w="${w}">${w} days</button>`).join('')}
    ${st.heat ? `<div class="bm-legend"><span>fewer, milder</span><i></i><span>more, worse</span></div><div class="bm-tiny">${sc.size ? `${sc.size} structure${sc.size > 1 ? 's' : ''} logged in the last ${st.win} days. Heat shows on the layer you're viewing.` : `Nothing logged in the last ${st.win} days.`}</div>` : ''}`;
  renderHistory();
}
function renderHistory() {
  const cut = ymd(new Date(Date.now() - (st.win - 1) * 86400000));
  let logs = api.logs().filter((l) => l.date >= cut);
  if (st.histScope === 'this' && st.selected) logs = logs.filter((l) => l.structure === st.selected);
  if (st.histLayer !== 'all') logs = logs.filter((l) => l.layer === st.histLayer);
  logs.sort((a, b) => b.at.localeCompare(a.at));
  const el = root.querySelector('.bm-hist');
  el.innerHTML = `<div class="bm-h">History · last ${st.win} days</div>
    <div class="bm-filters">
      <button class="bm-chip ${st.histScope === 'all' ? 'on' : ''}" data-bm="scope" data-s="all">Everything</button>
      ${st.selected ? `<button class="bm-chip ${st.histScope === 'this' ? 'on' : ''}" data-bm="scope" data-s="this">This structure</button>` : ''}
      <select class="bm-select" data-bm="histlayer"><option value="all">All layers</option>${ORDER.map((l) => `<option value="${l}" ${st.histLayer === l ? 'selected' : ''}>${LABEL[l]}</option>`).join('')}</select>
    </div>
    ${logs.length ? logs.map((l) => `<div class="bm-row" data-bm="row" data-id="${esc(l.id)}">
      <div class="bm-sev" style="--sev:${l.intensity}">${l.intensity}</div>
      <div class="bm-rowtext"><b>${esc(cap(l.name || l.structure))}</b><span>${new Date(l.at).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })} ${new Date(l.at).toTimeString().slice(0, 5)} · ${esc(l.type)} · ${esc(l.timing)}${l.notes ? ' · ' + esc(l.notes) : ''}</span></div>
      <button class="bm-x" data-bm="del" data-id="${esc(l.id)}" aria-label="Delete entry">×</button></div>`).join('') : '<p class="bm-tiny">No entries for this filter.</p>'}`;
}

/* ---------- pain sheet ---------- */
let form = null;
function openSheet() {
  const s = info.get(st.selected);
  if (!s) return;
  form = { structure: s.id, name: s.name, layer: s.layer, side: s.side === 'midline' ? 'Midline' : cap(s.side), intensity: null, type: null, timing: null, notes: '' };
  drawSheet();
}
function drawSheet() {
  const sh = root.querySelector('.bm-sheet');
  if (!form) { sh.hidden = true; sh.innerHTML = ''; return; }
  const chips = (key, opts) => `<div class="bm-chips">${opts.map((o) => `<button class="bm-chip ${form[key] === o ? 'on' : ''}" data-bm="f" data-k="${key}" data-v="${o}">${o}</button>`).join('')}</div>`;
  sh.hidden = false;
  sh.innerHTML = `<div class="bm-sheet-in">
    <div class="bm-sheet-head"><div><div class="bm-side">Log pain · ${new Date().toTimeString().slice(0, 5)} today</div><div class="bm-sheet-title">${esc(cap(plainName(info.get(form.structure))))}</div></div><button class="bm-x" data-bm="cancel" aria-label="Close">×</button></div>
    <div class="bm-q">How bad? <span>0 none · 10 worst imaginable</span></div>
    <div class="bm-scale">${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<button class="${form.intensity === n ? 'on' : ''}" data-bm="f" data-k="intensity" data-v="${n}" style="--sev:${n}">${n}</button>`).join('')}</div>
    <div class="bm-q">What does it feel like?</div>${chips('type', TYPES)}
    <div class="bm-q">When?</div>${chips('timing', TIMINGS)}
    <div class="bm-q">Side</div>${chips('side', SIDES)}
    <div class="bm-q">Notes <span>optional</span></div>
    <textarea class="bm-notes" data-bm="notes" placeholder="Felt it on the bend in the 200, eased after warm-up">${esc(form.notes)}</textarea>
    <div class="bm-err"></div>
    <button class="bm-save" data-bm="save">Save</button>
    <p class="bm-tiny">A log, not a diagnosis. Severe, worsening, or numb/tingling pain that spreads needs a physio or doctor.</p>
  </div>`;
}
async function saveSheet() {
  const err = root.querySelector('.bm-err');
  if (form.intensity == null) { err.textContent = 'Pick how bad it is (0–10).'; return; }
  if (!form.type) { err.textContent = 'Pick what it feels like.'; return; }
  if (!form.timing) { err.textContent = 'Pick when you feel it.'; return; }
  const now = new Date();
  const log = { id: (crypto.randomUUID ? crypto.randomUUID() : String(now.getTime()) + Math.random().toString(16).slice(2)), at: now.toISOString(), updated: now.toISOString(), date: ymd(now), ...form, notes: form.notes.trim() };
  form = null; drawSheet();
  await api.save(log);
  applyLook(); refreshPanels();
  if (api.fromCheckin()) api.back();
}

/* ---------- events ---------- */
function onClick(e) {
  const b = e.target.closest('[data-bm]');
  if (!b) return;
  const a = b.dataset.bm;
  if (a === 'layer') { st.focus = b.dataset.l; if (st.selected && info.get(st.selected).layer !== st.focus) st.selected = null; applyLook().then(refreshPanels); refreshPanels(); }
  else if (a === 'view') setView(b.dataset.v);
  else if (a === 'log') openSheet();
  else if (a === 'clear') select(null);
  else if (a === 'back') api.back();
  else if (a === 'heat') { st.heat = !st.heat; applyLook(); refreshPanels(); }
  else if (a === 'win') { st.win = Number(b.dataset.w); applyLook(); refreshPanels(); }
  else if (a === 'scope') { st.histScope = b.dataset.s; renderHistory(); }
  else if (a === 'row') { if (!e.target.closest('[data-bm="del"]')) { const l = api.logs().find((x) => x.id === b.dataset.id); if (l) { window.scrollTo({ top: 0, behavior: 'smooth' }); focusOn(l.structure); } } }
  else if (a === 'del') { e.stopPropagation(); if (confirm('Delete this pain entry?')) api.remove(b.dataset.id).then(() => { applyLook(); refreshPanels(); }); }
  else if (a === 'f') { const k = b.dataset.k; form[k] = k === 'intensity' ? Number(b.dataset.v) : b.dataset.v; const n = root.querySelector('.bm-notes'); if (n) form.notes = n.value; drawSheet(); }
  else if (a === 'cancel') { form = null; drawSheet(); }
  else if (a === 'save') saveSheet();
}
function onInput(e) {
  const t = e.target;
  if (t.dataset.bm === 'notes' && form) form.notes = t.value;
  if (t.dataset.bm === 'histlayer') { st.histLayer = t.value; renderHistory(); }
}

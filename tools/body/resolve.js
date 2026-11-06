// Resolves structures.js against BodyParts3D's isa_element_parts.txt.
const fs = require('fs');
const { structures } = require('./structures.js');
const src = process.argv[2];
const rows = fs.readFileSync(src + '/isa_element_parts.txt', 'utf8').split(/\r?\n/).slice(1).map((l) => l.split('\t')).filter((r) => r[2]);
const byName = new Map();
for (const [, n, f] of rows) { if (!byName.has(n)) byName.set(n, new Set()); byName.get(n).add(f); }
const missing = [], all = new Set(), out = [];
for (const s of structures) {
  const files = new Set();
  for (const p of s.patterns) for (const [n, set] of byName) if (typeof p === 'string' ? n === p : p.test(n)) set.forEach((f) => files.add(f));
  if (!files.size) { missing.push(s.id); continue; }
  files.forEach((f) => all.add(f));
  out.push({ id: s.id, name: s.name, layer: s.layer, side: s.side, files: [...files] });
}
fs.writeFileSync(src + '/selection.json', JSON.stringify(out));
console.log('structures', out.length, 'element files', all.size, 'missing', missing.join(', ') || 'none');
for (const id of ['right_foot_bones', 'right_hand_bones', 'skull', 'sternum', 'right_ribs', 'right_erector_spinae', 'right_pectoralis_major']) console.log(' ', id, (out.find((s) => s.id === id) || { files: [] }).files.length);

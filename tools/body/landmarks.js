// Anatomical landmarks measured from the bone meshes (Three.js coords, mm).
// Used to place schematic nerve paths and to draw the dermatome map.

module.exports = function landmarks({ get }) {
  const V = (id) => { const p = get(id).pos, out = []; for (let i = 0; i < p.length; i += 3) out.push([p[i], p[i + 1], p[i + 2]]); return out; };
  const mean = (vs) => { const s = [0, 0, 0]; for (const v of vs) { s[0] += v[0]; s[1] += v[1]; s[2] += v[2]; } return s.map((x) => x / Math.max(1, vs.length)); };
  const range = (vs, a) => { let lo = Infinity, hi = -Infinity; for (const v of vs) { lo = Math.min(lo, v[a]); hi = Math.max(hi, v[a]); } return [lo, hi]; };
  // Mean of the vertices in the top/bottom fraction along an axis.
  const end = (vs, a, frac, top = true) => { const [lo, hi] = range(vs, a); const cut = top ? hi - (hi - lo) * frac : lo + (hi - lo) * frac; return mean(vs.filter((v) => (top ? v[a] >= cut : v[a] <= cut))); };
  const L = { side: {} };

  for (const side of ['right', 'left']) {
    const sx = side === 'right' ? -1 : 1; // lateral direction in x
    const lat = (vs, frac, outer = true) => { const k = vs.map((v) => v[0] * sx); const lo = Math.min(...k), hi = Math.max(...k); const cut = outer ? hi - (hi - lo) * frac : lo + (hi - lo) * frac; return mean(vs.filter((v, i) => (outer ? k[i] >= cut : k[i] <= cut))); };
    const femur = V(`${side}_femur`), tibia = V(`${side}_tibia`), fibula = V(`${side}_fibula`), hip = V(`${side}_hip_bone`);
    const calc = V(`${side}_calcaneus`), foot = V(`${side}_foot_bones`), hum = V(`${side}_humerus`), rad = V(`${side}_radius`), uln = V(`${side}_ulna`), hand = V(`${side}_hand_bones`), scap = V(`${side}_scapula`), clav = V(`${side}_clavicle`);
    const fy = range(femur, 1), femTop = femur.filter((v) => v[1] > fy[1] - (fy[1] - fy[0]) * 0.1);
    const head = lat(femTop, 0.4, false), troch = lat(femTop, 0.35, true);
    const knee = end(femur, 1, 0.05, false);
    const hy = range(hip, 1), hz = range(hip, 2);
    const asis = mean(hip.filter((v) => v[1] > hy[0] + (hy[1] - hy[0]) * 0.55).sort((a, b) => b[2] - a[2]).slice(0, 25));
    const crest = end(hip, 1, 0.06, true);
    const ischTub = end(hip, 1, 0.07, false);
    const notch = mean(hip.filter((v) => v[1] > head[1] + 15 && v[1] < head[1] + 70 && v[2] < hz[0] + (hz[1] - hz[0]) * 0.3));
    const obtur = mean(hip.filter((v) => v[1] > ischTub[1] + 10 && v[1] < head[1] - 20 && v[2] > ischTub[2] + 10 && Math.abs(v[0]) < Math.abs(head[0])));
    const tibTop = end(tibia, 1, 0.06, true), medMall = end(tibia, 1, 0.04, false);
    const fibHead = end(fibula, 1, 0.06, true), latMall = end(fibula, 1, 0.04, false);
    const fz = range(foot, 2);
    const toes = foot.filter((v) => v[2] > fz[1] - (fz[1] - fz[0]) * 0.15);
    const humTop = end(hum, 1, 0.06, true), humBot = end(hum, 1, 0.05, false);
    const hb = hum.filter((v) => v[1] < humBot[1] + 25);
    L.side[side] = {
      sx, head, troch, knee, asis, crest, ischTub, notch, obtur, tibTop, medMall, fibHead, latMall,
      heel: end(calc, 2, 0.2, false), calc: mean(calc),
      toesMed: lat(toes, 0.3, false), toesLat: lat(toes, 0.3, true), footMid: mean(foot),
      humTop, humBot, medEpi: lat(hb, 0.15, false), latEpi: lat(hb, 0.15, true),
      radBot: end(rad, 1, 0.05, false), ulnBot: end(uln, 1, 0.05, false),
      hand: mean(hand), handTip: end(hand, 1, 0.08, false), handLat: lat(hand, 0.25, true), handMed: lat(hand, 0.25, false),
      acromion: lat(scap.filter((v) => v[1] > range(scap, 1)[1] - (range(scap, 1)[1] - range(scap, 1)[0]) * 0.25), 0.3, true), clav: mean(clav), clavLat: lat(clav, 0.15, true), clavMed: lat(clav, 0.15, false),
    };
  }
  const vert = (id) => mean(V(id));
  L.vert = {};
  for (const id of ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12', 'L1', 'L2', 'L3', 'L4', 'L5']) L.vert[id] = vert(`${id}_vertebra`);
  const sac = V('sacrum');
  L.sacrum = mean(sac); L.sacrumTop = end(sac, 1, 0.12, true); L.sacrumBot = end(sac, 1, 0.1, false);
  const skull = V('skull');
  L.crown = end(skull, 1, 0.03, true); L.chin = end(skull, 1, 0.03, false);
  const st = V('sternum');
  L.sternumTop = end(st, 1, 0.1, true); L.sternumBot = end(st, 1, 0.1, false);
  L.export = { crown: L.crown, sacrum: L.sacrum, rightHead: L.side.right.head, leftHead: L.side.left.head };
  return L;
};

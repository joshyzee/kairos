// Approximate dermatome map painted onto the skin mesh.
// Each skin triangle is assigned to a spinal segment by where it sits relative to
// bone landmarks, following the usual textbook charts (Keegan & Garrett / ASIA style).
// Dermatomes vary between people and charts overlap, so this is a guide for logging only.

module.exports = function dermatomes(skin, L) {
  const P = skin.pos, I = skin.idx;
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const seg = (p, a, b) => { const ab = sub(b, a); const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / dot(ab, ab))); const c = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]; const d = Math.hypot(...sub(p, c)); return { d, t, c }; };
  const V = L.vert;
  const vertY = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12', 'L1', 'L2', 'L3', 'L4', 'L5'].map((k) => [k, V[k]]);

  function classify(p) {
    const side = p[0] < 0 ? 'right' : 'left';
    const s = L.side[side], sx = s.sx;
    // Head and neck
    if (p[1] > L.chin[1] + 5) return p[2] < V.C1[2] && p[1] < V.C1[1] + 80 ? 'C2' : 'V';
    // Arm
    const wrist = [(s.radBot[0] + s.ulnBot[0]) / 2, (s.radBot[1] + s.ulnBot[1]) / 2, (s.radBot[2] + s.ulnBot[2]) / 2];
    const ua = seg(p, s.humTop, s.humBot), fa = seg(p, s.humBot, wrist), hd = seg(p, wrist, s.handTip);
    const lateralOfShoulder = Math.abs(p[0]) > Math.abs(s.humTop[0]) - 30;
    const best = [['upper', ua, 52], ['fore', fa, 42], ['hand', hd, 40]].filter(([, r, lim]) => r.d < lim).sort((a, b) => a[1].d - b[1].d)[0];
    if (best && lateralOfShoulder && p[1] < s.acromion[1] + 5) {
      const [part, r] = best;
      const lateral = (p[0] - r.c[0]) * sx >= 0;
      if (part === 'upper') return r.t < 0.12 ? 'C4' : lateral ? 'C5' : r.t < 0.35 ? 'T2' : 'T1';
      if (part === 'fore') return lateral ? 'C6' : r.t < 0.3 ? 'T1' : 'C8';
      const u = Math.max(0, Math.min(1, (p[0] - s.handLat[0]) / (s.handMed[0] - s.handLat[0] || 1)));
      return u < 0.4 ? 'C6' : u < 0.65 ? 'C7' : 'C8';
    }
    // Leg
    const isPost = p[2] < s.head[2] - 20;
    const leg = p[1] < s.ischTub[1] - 30 || (!isPost && p[1] < s.head[1] - 15);
    if (leg && Math.abs(p[0]) > 18) {
      const ankleY = Math.min(s.medMall[1], s.latMall[1]);
      if (p[1] < ankleY + 12 && p[2] > s.calc[2] - 45) {
        if (p[2] < s.calc[2] + 15) return 'S1'; // heel
        const u = Math.max(0, Math.min(1, (p[0] - s.toesMed[0]) / (s.toesLat[0] - s.toesMed[0] || 1)));
        if (p[1] < s.footMid[1] - 8) return u > 0.5 ? 'S1' : 'L5'; // sole
        return u < 0.18 ? 'L4' : u > 0.8 ? 'S1' : 'L5'; // top of foot
      }
      const th = seg(p, s.head, s.knee);
      const ankle = [(s.medMall[0] + s.latMall[0]) / 2, ankleY, (s.medMall[2] + s.latMall[2]) / 2];
      const sh = seg(p, s.knee, ankle);
      if (p[1] > s.knee[1] - 15) { // thigh
        const dx = (p[0] - th.c[0]) * sx, dz = p[2] - th.c[2];
        const ang = Math.atan2(dz, dx) * 180 / Math.PI; // 90 front, 0 lateral, ±180 medial, -90 back
        if (ang < -45 && ang > -135) return 'S2';
        if (Math.abs(ang) > 135) return th.t < 0.5 ? 'L2' : 'L3';
        if (ang >= 45) return th.t < 0.28 ? (ang > 100 ? 'L1' : 'L2') : th.t < 0.68 ? 'L2' : 'L3';
        return th.t < 0.6 ? 'L2' : 'L3';
      }
      const dx = (p[0] - sh.c[0]) * sx, dz = p[2] - sh.c[2];
      if (dz > 0) return dx < 0 ? 'L4' : 'L5';
      return dx > 0 ? 'S1' : sh.t < 0.5 ? 'S2' : 'L4';
    }
    // Perineum and buttock
    if (Math.abs(p[0]) <= 18 && p[1] < s.head[1]) return 'S3';
    const torsoMidZ = (y) => { let best = vertY[0][1]; for (const [, v] of vertY) if (Math.abs(v[1] - y) < Math.abs(best[1] - y)) best = v; return best[2] + 70; };
    const front = p[2] > torsoMidZ(p[1]);
    if (!front && p[1] < L.sacrumTop[1] + 10 && p[1] > s.ischTub[1] - 40) {
      if (Math.abs(p[0]) < 45) return 'S3';
      return p[1] > s.head[1] + 35 ? 'L1' : 'S2';
    }
    // Neck and shoulders
    const clavY = s.clav[1];
    if (p[1] > clavY + 45) return 'C3';
    if (p[1] > clavY - 15) return 'C4';
    // Trunk
    if (!front) {
      let best = vertY[0]; for (const v of vertY) if (Math.abs(v[1][1] - 15 - p[1]) < Math.abs(best[1][1] - 15 - p[1])) best = v;
      return best[0];
    }
    const yT2 = clavY - 25;
    const yT4 = L.sternumBot[1] + (L.sternumTop[1] - L.sternumBot[1]) * 0.35;
    const yT10 = V.L3[1];
    const yL1 = s.head[1] + 35;
    const band = (y, hi, lo, a, b) => { const f = (hi - y) / (hi - lo); return Math.round(a + Math.max(0, Math.min(1, f)) * (b - a)); };
    if (p[1] >= yT4) return 'T' + band(p[1], yT2, yT4, 2, 4);
    if (p[1] >= yT10) return 'T' + band(p[1], yT4, yT10, 4, 10);
    if (p[1] >= yL1) { const n = band(p[1], yT10, yL1, 10, 13); return n === 13 ? 'L1' : 'T' + n; }
    return 'L1';
  }

  const groups = new Map();
  for (let f = 0; f < I.length; f += 3) {
    const c = [0, 1, 2].map((a) => (P[I[f] * 3 + a] + P[I[f + 1] * 3 + a] + P[I[f + 2] * 3 + a]) / 3);
    const segName = classify(c);
    const side = c[0] < 0 ? 'right' : 'left';
    const key = `${side}_${segName}`;
    if (!groups.has(key)) groups.set(key, { side, seg: segName, faces: [] });
    groups.get(key).faces.push(I[f], I[f + 1], I[f + 2]);
  }
  const out = [];
  for (const [key, g] of groups) {
    const map = new Map(), pos = [], idx = [];
    for (const v of g.faces) { let j = map.get(v); if (j === undefined) { j = pos.length / 3; map.set(v, j); pos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); } idx.push(j); }
    const label = g.seg === 'V' ? 'face (trigeminal nerve) area' : `${g.seg} dermatome`;
    out.push({ id: `${key}_dermatome`, name: `${g.side} ${label}`, side: g.side, family: g.seg[0], seg: g.seg, pos: new Float32Array(pos), idx: new Uint32Array(idx) });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
};

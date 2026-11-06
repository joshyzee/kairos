// Schematic nerve paths. BodyParts3D has no peripheral nerves, so these are
// drawn as smooth tubes through points placed from bone landmarks.
// They follow textbook courses but are approximate, not dissection-accurate.

module.exports = function nerves(L) {
  const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const o = (p, dx = 0, dy = 0, dz = 0) => [p[0] + dx, p[1] + dy, p[2] + dz];
  const r1 = (p) => p.map((v) => Math.round(v * 10) / 10);
  const out = [];
  const add = (id, name, side, radius, points) => out.push({ id, name, side, radius, points: points.map(r1) });
  const V = L.vert;

  // Spinal cord and cauda equina (midline)
  add('spinal_cord', 'spinal cord', 'midline', 5, ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'T1', 'T3', 'T5', 'T7', 'T9', 'T11', 'T12', 'L1'].map((k) => V[k]));
  add('cauda_equina', 'cauda equina', 'midline', 3, [V.L1, V.L2, V.L3, V.L4, V.L5, L.sacrumTop, L.sacrum]);

  for (const side of ['right', 'left']) {
    const s = L.side[side], x = s.sx;
    const shaftTop = lerp(s.head, s.troch, 0.5);
    const shaft = (t) => lerp(shaftTop, s.knee, t);
    const shank = (t) => lerp(lerp(s.tibTop, s.fibHead, 0.4), lerp(s.medMall, s.latMall, 0.5), t);
    const zBack = (p, d) => [p[0], p[1], p[2] - d];
    const n = (id, name, r, pts) => add(`${side}_${id}`, `${side} ${name}`, side, r, pts);

    // Nerve roots of the lower spine
    for (const k of ['L4', 'L5']) n(`${k}_nerve_root`, `${k} nerve root`, 2.5, [o(V[k], x * 8, 0, -2), o(V[k], x * 30, -12, 8), o(V[k], x * 48, -28, 16)]);
    n('S1_nerve_root', 'S1 nerve root', 2.5, [o(L.sacrumTop, x * 10, -5, -5), o(L.sacrumTop, x * 28, -25, 12), o(L.sacrum, x * 42, -10, 22)]);

    // Sciatic -> tibial / common fibular
    const sciStart = o(L.sacrum, x * 42, -10, 22);
    const bif = zBack(shaft(0.75), 32);
    n('sciatic_nerve', 'sciatic nerve', 6, [sciStart, o(s.notch, 0, 0, -6), [lerp(s.ischTub, s.troch, 0.45)[0], s.head[1] - 45, Math.min(s.ischTub[2], s.troch[2]) - 12], zBack(shaft(0.3), 34), zBack(shaft(0.55), 34), bif]);
    const pop = o(s.knee, 0, 15, -38);
    n('tibial_nerve', 'tibial nerve', 4, [bif, pop, zBack(shank(0.25), 30), zBack(shank(0.6), 26), o(s.medMall, -x * 2, 8, -22), o(s.calc, -x * 12, -12, 22), [s.toesMed[0] + x * 8, s.footMid[1] - 18, (s.footMid[2] + s.toesMed[2]) / 2]]);
    const neck = o(s.fibHead, x * 10, -28, 4);
    n('common_fibular_nerve', 'common fibular nerve', 4, [bif, o(s.knee, x * 32, 22, -28), o(s.fibHead, x * 12, -6, -10), neck]);
    n('superficial_fibular_nerve', 'superficial fibular nerve', 2.5, [neck, o(lerp(s.fibHead, s.latMall, 0.45), x * 12, 0, 6), o(lerp(s.fibHead, s.latMall, 0.85), x * 6, 0, 18), [s.footMid[0], s.footMid[1] + 18, s.footMid[2] + 18], [lerp(s.toesMed, s.toesLat, 0.5)[0], s.footMid[1] + 8, s.toesMed[2] - 10]]);
    n('deep_fibular_nerve', 'deep fibular nerve', 2.5, [neck, o(lerp(s.fibHead, s.tibTop, 0.4), 0, -60, 20), o(shank(0.6), 0, 0, 24), o(lerp(s.medMall, s.latMall, 0.5), 0, 10, 26), [s.toesMed[0] + x * 12, s.footMid[1] + 14, s.toesMed[2] - 18]]);
    n('sural_nerve', 'sural nerve', 2, [pop, zBack(shank(0.35), 42), zBack(lerp(shank(0.7), s.latMall, 0.3), 30), o(s.latMall, x * 4, 4, -22), [s.toesLat[0] + x * 6, s.footMid[1] - 4, s.footMid[2]]]);

    // Femoral and saphenous
    const ing = [(s.head[0] + s.asis[0]) / 2, s.head[1] + 25, s.head[2] + 34];
    n('femoral_nerve', 'femoral nerve', 4, [o(V.L4, x * 30, 0, 14), o(V.L5, x * 55, -10, 30), ing, o(shaft(0.15), 0, 0, 42), o(shaft(0.3), x * 6, 0, 46)]);
    n('saphenous_nerve', 'saphenous nerve', 2, [o(shaft(0.15), 0, 0, 42), o(shaft(0.5), -x * 32, 0, 22), o(s.knee, -x * 38, 40, 0), o(s.tibTop, -x * 36, -10, 0), o(shank(0.5), -x * 30, 0, 6), o(s.medMall, -x * 4, 4, 20), [s.toesMed[0] - x * 4, s.footMid[1] + 4, s.footMid[2] - 10]]);

    // Obturator and lateral femoral cutaneous
    n('obturator_nerve', 'obturator nerve', 2.5, [o(V.L3, x * 25, 0, 10), lerp(o(L.sacrumTop, x * 30, 0, 20), s.obtur, 0.5), s.obtur, o(shaft(0.3), -x * 45, 0, 6)]);
    n('lateral_femoral_cutaneous_nerve', 'lateral femoral cutaneous nerve', 2, [o(V.L2, x * 30, 0, 10), o(s.crest, -x * 10, -30, 10), o(s.asis, -x * 10, -10, 5), o(shaft(0.45), x * 50, 0, 16)]);

    // Brachial plexus and arm nerves
    const A = o(s.humTop, -x * 26, -55, 0);
    const arm = (t) => lerp(s.humTop, s.humBot, t);
    const wrist = lerp(s.radBot, s.ulnBot, 0.5);
    n('brachial_plexus', 'brachial plexus', 4, [o(V.C6, x * 25, 0, 0), o(V.C7, x * 45, -10, 5), o(s.clav, 0, -12, -12), A]);
    n('median_nerve', 'median nerve', 3, [A, o(arm(0.5), -x * 20, 0, 16), o(lerp(s.medEpi, s.latEpi, 0.4), 0, 0, 22), o(lerp(s.humBot, wrist, 0.5), 0, 0, 12), o(wrist, 0, 0, 12), o(s.hand, 0, 0, 10)]);
    n('ulnar_nerve', 'ulnar nerve', 3, [A, o(arm(0.5), -x * 28, 0, -4), o(s.medEpi, -x * 3, 0, -15), o(lerp(s.medEpi, s.ulnBot, 0.5), 0, 0, 5), o(s.ulnBot, 0, 0, 10), s.handMed]);
    n('radial_nerve', 'radial nerve', 3, [A, o(arm(0.45), x * 5, 0, -25), o(s.latEpi, x * 5, 15, 10), o(lerp(s.latEpi, s.radBot, 0.5), x * 8, 0, 5), o(s.radBot, x * 8, 0, 0), s.handLat]);
    n('axillary_nerve', 'axillary nerve', 2.5, [A, o(s.humTop, x * 5, -45, -25), o(s.humTop, x * 25, -50, 0)]);
    n('musculocutaneous_nerve', 'musculocutaneous nerve', 2.5, [A, o(arm(0.5), 0, 0, 25), o(lerp(s.latEpi, s.radBot, 0.3), 0, 0, 15)]);
  }
  return out;
};

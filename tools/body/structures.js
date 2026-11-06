// Which BodyParts3D concepts become tappable structures in Kairos.
// Each entry: [id stem, display name, layer, list of BodyParts3D concept names (or regexes)].
// Paired structures are listed once with "{side}" and expanded to right/left.
// Unpaired structures sit on the midline.

const M = 'muscles', B = 'bones';

const paired = [
  // ---------- bones ----------
  ['hip_bone', 'hip bone', B, ['{side} hip bone']],
  ['femur', 'femur', B, ['{side} femur']],
  ['patella', 'patella', B, ['{side} patella']],
  ['tibia', 'tibia', B, ['{side} tibia']],
  ['fibula', 'fibula', B, ['{side} fibula']],
  ['talus', 'talus', B, ['{side} talus']],
  ['calcaneus', 'calcaneus', B, ['{side} calcaneus']],
  ['foot_bones', 'bones of the foot', B, [/^{side} (cuboid|medial cuneiform|intermediate cuneiform|lateral cuneiform) bone$/, 'navicular bone of {side} foot', /^{side} (first|second|third|fourth|fifth) metatarsal bone$/, /phalanx of {side} (big|second|third|fourth|little) toe$/]],
  ['clavicle', 'clavicle', B, ['{side} clavicle']],
  ['scapula', 'scapula', B, ['{side} scapula']],
  ['humerus', 'humerus', B, ['{side} humerus']],
  ['radius', 'radius', B, ['{side} radius']],
  ['ulna', 'ulna', B, ['{side} ulna']],
  ['hand_bones', 'bones of the hand', B, [/^{side} (scaphoid|lunate|triquetral|triquetrum|pisiform|trapezium|trapezoid|capitate|hamate)( bone)?$/, /^(scaphoid|lunate|triquetral|pisiform|trapezium|trapezoid|capitate|hamate)( bone)? of {side} hand$/, /^{side} (first|second|third|fourth|fifth) metacarpal bone$/, /phalanx of {side} (thumb|index finger|middle finger|ring finger|little finger)$/]],
  ['ribs', 'ribs', B, [/^{side} (first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth) rib$/]],

  // ---------- muscles: hip and thigh ----------
  ['gluteus_maximus', 'gluteus maximus', M, ['{side} gluteus maximus']],
  ['gluteus_medius', 'gluteus medius', M, ['{side} gluteus medius']],
  ['gluteus_minimus', 'gluteus minimus', M, ['{side} gluteus minimus']],
  ['piriformis', 'piriformis', M, ['{side} piriformis']],
  ['deep_hip_rotators', 'deep hip rotators', M, ['{side} obturator internus', '{side} gemellus superior', '{side} gemellus inferior', '{side} quadratus femoris', '{side} obturator externus']],
  ['iliacus', 'iliacus', M, ['{side} iliacus']],
  ['psoas_major', 'psoas major', M, ['{side} psoas major']],
  ['tensor_fasciae_latae', 'tensor fasciae latae', M, ['{side} tensor fasciae latae']],
  ['sartorius', 'sartorius', M, ['{side} sartorius']],
  ['rectus_femoris', 'rectus femoris', M, ['{side} rectus femoris']],
  ['vastus_lateralis', 'vastus lateralis', M, ['{side} vastus lateralis']],
  ['vastus_medialis', 'vastus medialis', M, ['{side} vastus medialis']],
  ['vastus_intermedius', 'vastus intermedius', M, ['{side} vastus intermedius']],
  ['adductor_longus', 'adductor longus', M, ['{side} adductor longus']],
  ['adductor_brevis', 'adductor brevis', M, ['{side} adductor brevis']],
  ['adductor_magnus', 'adductor magnus', M, ['{side} adductor magnus']],
  ['pectineus', 'pectineus', M, ['{side} pectineus']],
  ['gracilis', 'gracilis', M, ['{side} gracilis']],
  ['biceps_femoris_long', 'biceps femoris (long head)', M, ['long head of {side} biceps femoris']],
  ['biceps_femoris_short', 'biceps femoris (short head)', M, ['short head of {side} biceps femoris']],
  ['semitendinosus', 'semitendinosus', M, ['{side} semitendinosus']],
  ['semimembranosus', 'semimembranosus', M, ['{side} semimembranosus']],

  // ---------- muscles: lower leg ----------
  ['gastrocnemius_medial', 'gastrocnemius (medial head)', M, ['medial head of {side} gastrocnemius']],
  ['gastrocnemius_lateral', 'gastrocnemius (lateral head)', M, ['lateral head of {side} gastrocnemius']],
  ['soleus', 'soleus', M, ['{side} soleus']],
  ['plantaris', 'plantaris', M, ['{side} plantaris']],
  ['popliteus', 'popliteus', M, ['{side} popliteus']],
  ['tibialis_anterior', 'tibialis anterior', M, ['{side} tibialis anterior']],
  ['tibialis_posterior', 'tibialis posterior', M, ['{side} tibialis posterior']],
  ['fibularis_longus', 'fibularis longus', M, ['{side} fibularis longus']],
  ['fibularis_brevis', 'fibularis brevis', M, ['{side} fibularis brevis']],
  ['extensor_digitorum_longus', 'extensor digitorum longus', M, ['{side} extensor digitorum longus']],
  ['extensor_hallucis_longus', 'extensor hallucis longus', M, ['{side} extensor hallucis longus']],
  ['flexor_hallucis_longus', 'flexor hallucis longus', M, ['{side} flexor hallucis longus']],
  ['flexor_digitorum_longus', 'flexor digitorum longus', M, ['{side} flexor digitorum longus']],

  // ---------- muscles: trunk, shoulder, arm ----------
  ['external_oblique', 'external oblique', M, ['{side} external oblique']],
  ['erector_spinae', 'erector spinae', M, [/^{side} (iliocostalis|longissimus|spinalis) (lumborum|thoracis|cervicis|capitis)/, /^(iliocostalis|longissimus|spinalis) (lumborum|thoracis|cervicis|capitis) of {side}/]],
  ['serratus_anterior', 'serratus anterior', M, ['{side} serratus anterior']],
  ['pectoralis_major', 'pectoralis major', M, [/part of {side} pectoralis major$/]],
  ['pectoralis_minor', 'pectoralis minor', M, ['{side} pectoralis minor']],
  ['trapezius', 'trapezius', M, [/part of {side} trapezius$/]],
  ['rhomboids', 'rhomboids', M, ['{side} rhomboid major', '{side} rhomboid minor']],
  ['deltoid', 'deltoid', M, [/part of {side} deltoid$/]],
  ['supraspinatus', 'supraspinatus', M, ['{side} supraspinatus']],
  ['infraspinatus', 'infraspinatus', M, [/^{side} infraspinatus/]],
  ['teres_minor', 'teres minor', M, [/^{side} teres minor/]],
  ['teres_major', 'teres major', M, [/^{side} teres major/]],
  ['subscapularis', 'subscapularis', M, ['{side} subscapularis']],
  ['biceps_brachii', 'biceps brachii', M, [/head of {side} biceps brachii$/]],
  ['brachialis', 'brachialis', M, ['{side} brachialis']],
  ['triceps_brachii', 'triceps brachii', M, [/head of {side} triceps brachii$/]],
  ['brachioradialis', 'brachioradialis', M, ['{side} brachioradialis']],
  ['sternocleidomastoid', 'sternocleidomastoid', M, ['{side} sternocleidomastoid']],
];

const ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
const midline = [
  ['skull', 'skull', B, [/^(frontal|parietal|occipital|temporal|sphenoid|ethmoid|nasal|lacrimal|zygomatic|palatine|vomer)( bone)?$/, /^(right|left) (parietal|temporal|nasal|lacrimal|zygomatic|palatine) bone$/, /^(mandible|maxilla|right maxilla|left maxilla|inferior nasal concha|right inferior nasal concha|left inferior nasal concha)$/]],
  ['sternum', 'sternum', B, [/^(manubrium|body of sternum|xiphoid process)$/]],
  ['sacrum', 'sacrum', B, ['sacrum']],
  ['C1_vertebra', 'C1 vertebra (atlas)', B, ['atlas']],
  ['C2_vertebra', 'C2 vertebra (axis)', B, ['axis']],
  ...ORD.slice(2, 7).map((o, i) => [`C${i + 3}_vertebra`, `C${i + 3} vertebra`, B, [`${o} cervical vertebra`]]),
  ...ORD.slice(0, 12).map((o, i) => [`T${i + 1}_vertebra`, `T${i + 1} vertebra`, B, [`${o} thoracic vertebra`]]),
  ...ORD.slice(0, 5).map((o, i) => [`L${i + 1}_vertebra`, `L${i + 1} vertebra`, B, [`${o} lumbar vertebra`]]),
  ['skin', 'skin', 'skin', ['skin']],
];

function expand() {
  const out = [];
  for (const [stem, name, layer, pats] of paired) {
    for (const side of ['right', 'left']) {
      out.push({
        id: `${side}_${stem}`,
        name: `${side} ${name}`,
        layer,
        side,
        patterns: pats.map((p) => typeof p === 'string' ? p.replace('{side}', side) : new RegExp(p.source.replace(/\{side\}/g, side))),
      });
    }
  }
  for (const [id, name, layer, pats] of midline) out.push({ id, name, layer, side: 'midline', patterns: pats });
  return out;
}

module.exports = { structures: expand() };

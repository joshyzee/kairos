/* Kairos — daily wellness check-in. Data lives in a private GitHub repo. */
'use strict';

const CFG = {
  owner: 'joshyzee',
  repo: 'kairos-data',
  vapid: 'BEKha_ib7MkqVDToU4LmtHluHk2UC0VjtANN_z9Fs01Rx950_HTZvvM4ADPylDzUiY1f7xtUdVHRAy7a0uM81W8',
  name: 'Josh',
};

/* ---------- small helpers ---------- */
const LS = {
  get(k, d) { try { const v = localStorage.getItem('kairos.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('kairos.' + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem('kairos.' + k); } catch {} },
};
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d); };
const today = () => ymd(new Date());
const hour = () => new Date().getHours();
const dow = (s) => new Date(s + 'T12:00:00').getDay();
const fmtDay = (s, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => new Date(s + 'T12:00:00').toLocaleDateString('en-ZA', opts);
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r1 = (x) => (x == null ? '–' : (Math.round(x * 10) / 10).toString());
const b64enc = (s) => btoa(unescape(encodeURIComponent(s)));
const b64dec = (s) => decodeURIComponent(escape(atob(s.replace(/\n/g, ''))));
const weekKey = (s) => addDays(s, (7 - dow(s)) % 7); // the Sunday that ends this week
// Before 04:00 you're still in last night: evening check-ins belong to the previous day.
const eveningDay = () => (hour() < 4 ? addDays(today(), -1) : today());

// Bedtime is stored as a label plus minutes after 18:00, so after-midnight times sort correctly.
const BEDTIMES = ['Before 22:00', '22:00', '22:30', '23:00', '23:30', '00:00', '00:30', '01:00', '01:30', '02:00', '02:30+'];
function bedMinOf(label) {
  if (!label) return null;
  if (label === 'Before 22:00') return 210;
  const [h, m] = label.replace('+', '').split(':').map(Number);
  return (h < 18 ? h + 24 : h) * 60 + m - 18 * 60;
}
function bedLabelFromTime(d) { // the half-hour slot at or after a clock time
  let min = (d.getHours() < 18 ? d.getHours() + 24 : d.getHours()) * 60 + d.getMinutes() - 18 * 60;
  min = Math.ceil(min / 30) * 30;
  return BEDTIMES.find((b) => bedMinOf(b) >= min) || '02:30+';
}
const NAPS = ['None', '20 min', '30 min', '45 min', '1h', '1h30', '2h+'];
const napMinOf = (label) => ({ None: 0, '20 min': 20, '30 min': 30, '45 min': 45, '1h': 60, '1h30': 90, '2h+': 120 })[label] ?? null;
// Total sleep for a day: the night before (morning check-in) plus that day's naps (evening check-in).
function totalSleep(d) {
  const m = (S.data.days[d] || {}).morning, e = (S.data.days[d] || {}).evening;
  if (!m || m.sleepHours == null) return null;
  return m.sleepHours + ((e && e.napMin) || 0) / 60;
}
function lastTotals(n) { const out = []; for (let i = 0; i < n; i++) { const v = totalSleep(addDays(today(), -i)); if (v != null) out.push(v); } return out; }
const clockOf = (bedMin) => { const t = (18 * 60 + Math.round(bedMin)) % (24 * 60); return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`; };

// Apple Health values arrive from the Shortcut as numbers or text ("1 hr 15 min", "1:15:00", "8 432", "512 kcal").
function toMinutes(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim().toLowerCase();
  if (s.includes(':')) { const p = s.split(':').map(Number); return p.length === 3 ? p[0] * 60 + p[1] + p[2] / 60 : p[0] + p[1] / 60; }
  const h = s.match(/([\d.,]+)\s*(h|hr|hour)/), m = s.match(/([\d.,]+)\s*(m|min)/), sec = s.match(/([\d.,]+)\s*(s|sec)/);
  if (h || m || sec) return (h ? parseFloat(h[1].replace(',', '.')) * 60 : 0) + (m ? parseFloat(m[1].replace(',', '.')) : 0) + (sec ? parseFloat(sec[1].replace(',', '.')) / 60 : 0);
  const n = parseFloat(s.replace(',', '.'));
  return isNaN(n) ? null : n;
}
function toNumber(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace(/[\s ]/g, '').replace(',', '.'));
  return isNaN(n) ? null : n;
}
function healthFor(d) {
  const h = S.health[d];
  if (!h) return null;
  const mins = toMinutes(h.workoutMinutes);
  return { minutes: mins ? Math.round(mins) : null, type: h.workoutType || null, kcal: toNumber(h.activeKcal), steps: toNumber(h.steps) };
}

/* ---------- state ---------- */
const EMPTY = () => ({ days: {}, weeks: {} });
const S = {
  token: LS.get('token', null),
  data: LS.get('data', EMPTY()),
  sha: LS.get('sha', null),
  dirty: LS.get('dirty', false),
  brief: LS.get('brief', null),
  growth: LS.get('growth', null),
  events: LS.get('events', []),
  health: LS.get('health', {}),
  pain: LS.get('pain', { logs: [] }),
  painSha: LS.get('painSha', null),
  painDirty: LS.get('painDirty', false),
  returnForm: null,
  tab: 'today',
  form: null,
  range: 90,
  jq: '',
  online: navigator.onLine,
};
function persist() {
  LS.set('data', S.data); LS.set('sha', S.sha); LS.set('dirty', S.dirty);
}

/* ---------- GitHub ---------- */
async function gh(path, { method = 'GET', body, raw = false } = {}) {
  const headers = {
    Authorization: `Bearer ${S.token}`,
    Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (body) headers['Content-Type'] = 'application/json';
  return fetch(`https://api.github.com/repos/${CFG.owner}/${CFG.repo}/contents/${path}`, { method, headers, body, cache: 'no-store' });
}
async function getJson(path) {
  const r = await gh(path, { raw: true });
  if (r.status === 404) return null;
  if (!r.ok) throw Object.assign(new Error('GET ' + path + ' ' + r.status), { status: r.status });
  return r.json();
}
async function getWithSha(path) {
  const r = await gh(path);
  if (r.status === 404) return { data: null, sha: null };
  if (!r.ok) throw Object.assign(new Error('GET ' + path + ' ' + r.status), { status: r.status });
  const j = await r.json();
  let text;
  if (j.content && j.encoding === 'base64') text = b64dec(j.content);
  else text = await (await gh(path, { raw: true })).text();
  return { data: JSON.parse(text), sha: j.sha };
}
async function putJson(path, obj, sha, message) {
  const r = await gh(path, { method: 'PUT', body: JSON.stringify({ message, content: b64enc(JSON.stringify(obj, null, 1)), sha: sha || undefined }) });
  if (!r.ok) throw Object.assign(new Error('PUT ' + path + ' ' + r.status), { status: r.status });
  return (await r.json()).content.sha;
}

// Merge: newest section wins, per day and per week.
function merge(remote, local) {
  const out = JSON.parse(JSON.stringify(remote || EMPTY()));
  out.days = out.days || {}; out.weeks = out.weeks || {};
  for (const [d, day] of Object.entries(local.days || {})) {
    out.days[d] = out.days[d] || {};
    for (const [sec, v] of Object.entries(day)) {
      const cur = out.days[d][sec];
      if (!cur || (v && v.at && (!cur.at || v.at > cur.at))) out.days[d][sec] = v;
    }
  }
  for (const [w, v] of Object.entries(local.weeks || {})) {
    const cur = out.weeks[w];
    if (!cur || (v.at && (!cur.at || v.at > cur.at))) out.weeks[w] = v;
  }
  return out;
}

async function pull() {
  const { data, sha } = await getWithSha('data/entries.json');
  S.data = S.dirty ? merge(data, S.data) : (data || EMPTY());
  S.sha = sha;
  persist();
  if (S.dirty) await push();
}
async function push() {
  for (let i = 0; i < 3; i++) {
    try {
      S.sha = await putJson('data/entries.json', S.data, S.sha, `Check-in ${today()}`);
      S.dirty = false; persist();
      return true;
    } catch (e) {
      if (e.status === 409 || e.status === 422) {
        const { data, sha } = await getWithSha('data/entries.json');
        S.data = merge(data, S.data); S.sha = sha;
      } else throw e;
    }
  }
  return false;
}

/* ---------- pain logs (data/pain.json) ---------- */
// Entries are never hard-deleted: a deleted entry keeps a tombstone so both devices agree.
function persistPain() { LS.set('pain', S.pain); LS.set('painSha', S.painSha); LS.set('painDirty', S.painDirty); }
function mergePain(remote, local) {
  const byId = new Map();
  for (const l of [...((remote && remote.logs) || []), ...((local && local.logs) || [])]) {
    const cur = byId.get(l.id);
    if (!cur || (l.updated || l.at) > (cur.updated || cur.at)) byId.set(l.id, l);
  }
  return { logs: [...byId.values()].sort((a, b) => a.at.localeCompare(b.at)) };
}
async function pullPain() {
  const { data, sha } = await getWithSha('data/pain.json');
  S.pain = S.painDirty ? mergePain(data, S.pain) : (data || { logs: [] });
  S.painSha = sha; persistPain();
  if (S.painDirty) await pushPain();
}
async function pushPain() {
  for (let i = 0; i < 3; i++) {
    try {
      S.painSha = await putJson('data/pain.json', S.pain, S.painSha, `Pain log ${today()}`);
      S.painDirty = false; persistPain();
      return true;
    } catch (e) {
      if (e.status === 409 || e.status === 422) {
        const { data, sha } = await getWithSha('data/pain.json');
        S.pain = mergePain(data, S.pain); S.painSha = sha;
      } else throw e;
    }
  }
  return false;
}
const painLogs = () => (S.pain.logs || []).filter((l) => !l.deleted);
async function savePain(log) {
  S.pain = mergePain(S.pain, { logs: [log] });
  S.painDirty = true; persistPain();
  toast('Pain logged');
  try { await pushPain(); } catch { toast('Saved on this device. Will sync later.'); }
}
async function removePain(id) {
  const l = (S.pain.logs || []).find((x) => x.id === id);
  if (!l) return;
  await savePain({ ...l, deleted: true, updated: new Date().toISOString() });
  toast('Entry deleted');
}

/* ---------- body map ---------- */
let bodyMod = null;
const bodyApi = {
  logs: painLogs,
  save: savePain,
  remove: removePain,
  fromCheckin: () => !!S.returnForm,
  back: () => { S.form = S.returnForm; S.returnForm = null; S.tab = 'today'; render(); const el = document.getElementById('pain-today'); if (el) el.scrollIntoView({ block: 'center' }); },
  focusStructure: null,
};
async function mountBody() {
  const slot = document.getElementById('body-slot');
  if (!slot) return;
  try {
    bodyMod = bodyMod || await import('./body.js?v=4');
    if (document.getElementById('body-slot') === slot) bodyMod.attach(slot, bodyApi);
  } catch (e) {
    slot.innerHTML = `<div class="card"><p class="small muted">The body map couldn’t load. Check your connection and try again.</p></div>`;
    console.warn(e);
  }
}

async function loadAll() {
  const t = today(), y = addDays(t, -1);
  const jobs = [
    pull().catch((e) => console.warn(e)),
    pullPain().catch((e) => console.warn(e)),
    getJson('calendar/events.json').then((v) => { if (v) { S.events = v; LS.set('events', v); } }).catch(() => {}),
    getJson('brief/latest.json').then((v) => { if (v) { S.brief = v; LS.set('brief', v); } }).catch(() => {}),
    getJson('growth/latest.json').then((v) => { if (v) { S.growth = v; LS.set('growth', v); } }).catch(() => {}),
    Promise.all([getJson(`health/${t}.json`).catch(() => null), getJson(`health/${y}.json`).catch(() => null)])
      .then(([a, b]) => { S.health = { [t]: a, [y]: b }; LS.set('health', S.health); }),
  ];
  await Promise.all(jobs);
}

/* ---------- content fallbacks ---------- */
const VERSES = [
  { text: 'Because of the LORD’s great love we are not consumed, for his compassions never fail. They are new every morning; great is your faithfulness.', ref: 'Lamentations 3:22–23' },
  { text: 'But those who hope in the LORD will renew their strength. They will soar on wings like eagles; they will run and not grow weary, they will walk and not be faint.', ref: 'Isaiah 40:31' },
  { text: 'Come to me, all you who are weary and burdened, and I will give you rest.', ref: 'Matthew 11:28' },
  { text: 'Do not be anxious about anything, but in every situation, by prayer and petition, with thanksgiving, present your requests to God.', ref: 'Philippians 4:6' },
  { text: 'Trust in the LORD with all your heart and lean not on your own understanding; in all your ways submit to him, and he will make your paths straight.', ref: 'Proverbs 3:5–6' },
  { text: 'Be strong and courageous. Do not be afraid; do not be discouraged, for the LORD your God will be with you wherever you go.', ref: 'Joshua 1:9' },
  { text: 'Whatever you do, work at it with all your heart, as working for the Lord, not for human masters.', ref: 'Colossians 3:23' },
  { text: 'My grace is sufficient for you, for my power is made perfect in weakness.', ref: '2 Corinthians 12:9' },
  { text: 'Let us not become weary in doing good, for at the proper time we will reap a harvest if we do not give up.', ref: 'Galatians 6:9' },
  { text: 'In vain you rise early and stay up late, toiling for food to eat — for he grants sleep to those he loves.', ref: 'Psalm 127:2' },
  { text: 'Be still, and know that I am God.', ref: 'Psalm 46:10' },
];
const FACTS = [
  { type: 'fact', text: 'Eric Liddell refused to run the 100m heats at the 1924 Paris Olympics because they were on a Sunday. He switched to the 400m — and won gold.' },
  { type: 'fact', text: 'Wayde van Niekerk set the 400m world record of 43.03 at Rio 2016 — running from lane 8, blind to everyone behind him.' },
  { type: 'fact', text: 'Octopuses have three hearts and blue blood.' },
  { type: 'fact', text: 'Botanically, bananas are berries and strawberries are not.' },
  { type: 'fact', text: 'A day on Venus is longer than a year on Venus.' },
  { type: 'fact', text: 'Adam Smith published The Wealth of Nations in 1776 — the same year as the American Declaration of Independence.' },
  { type: 'fact', text: '“Economics” comes from the Greek oikonomia: management of a household.' },
  { type: 'fact', text: 'Your brain is about 2% of your body weight but uses roughly 20% of your energy.' },
  { type: 'fact', text: 'Sharks are older than trees. They have been around for over 400 million years.' },
  { type: 'fact', text: 'Nelson Mandela’s prison number, 46664, meant he was the 466th prisoner admitted to Robben Island in 1964.' },
  { type: 'fact', text: 'Table Mountain is several times older than the Himalayas.' },
  { type: 'fact', text: 'Growth hormone, which drives muscle repair, is released mostly during deep sleep. Sleep is training.' },
  { type: 'fact', text: 'In the 200m, the staggered start exists so every lane runs exactly the same distance around the bend.' },
  { type: 'fact', text: 'Vilfredo Pareto noticed about 80% of Italy’s land was owned by about 20% of the people — the origin of the 80/20 rule.' },
  { type: 'fact', text: 'Your heart beats roughly 100,000 times a day.' },
  { type: 'fact', text: 'Cleopatra lived closer in time to the Moon landing than to the building of the Great Pyramid.' },
  { type: 'fact', text: 'South Africa has 12 official languages since South African Sign Language was added in 2023.' },
  { type: 'fact', text: 'The Krugerrand, launched in 1967, was the world’s first modern gold bullion coin.' },
  { type: 'fact', text: 'Next-day muscle soreness isn’t caused by lactic acid. It comes from tiny muscle damage and the repair that follows.' },
  { type: 'fact', text: 'Hummingbirds are the only birds that can fly backwards.' },
  { type: 'fact', text: 'Eliud Kipchoge ran a marathon in 1:59:40 in Vienna in 2019 — the first under two hours, in a specially set-up event.' },
  { type: 'fact', text: 'The Greeks had two words for time: chronos, clock time, and kairos, the right or appointed moment. Mark 1:15 uses kairos: “The time has come.”' },
  { type: 'fact', text: '“Selah” appears 71 times in the Psalms and 3 times in Habakkuk. Many scholars think it marked a pause.' },
  { type: 'fact', text: 'The Johannesburg Stock Exchange was founded in 1887, a year after gold was discovered on the Witwatersrand.' },
  { type: 'fact', text: 'Water expands by about 9% when it freezes, which is why ice floats.' },
  { type: 'fact', text: 'Psalm 117 is the shortest chapter in the Bible. Psalm 119, two chapters later, is the longest.' },
  { type: 'fact', text: 'The Gutenberg Bible, printed around 1455, was the first major book printed in Europe with movable type.' },
  { type: 'quote', text: 'We are what we repeatedly do. Excellence, then, is not an act, but a habit.', source: 'Will Durant, summarising Aristotle' },
  { type: 'quote', text: 'It is not that we have a short time to live, but that we waste a lot of it.', source: 'Seneca, On the Shortness of Life' },
  { type: 'quote', text: 'The impediment to action advances action. What stands in the way becomes the way.', source: 'Marcus Aurelius, Meditations' },
  { type: 'quote', text: 'The unexamined life is not worth living.', source: 'Socrates, in Plato’s Apology' },
  { type: 'quote', text: 'When a measure becomes a target, it ceases to be a good measure.', source: 'Goodhart’s law, as phrased by Marilyn Strathern' },
  { type: 'quote', text: 'Rest is not idleness.', source: 'John Lubbock' },
];
const dayIndex = () => Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);

function brief() {
  const b = S.brief || {};
  const fresh = b.date && daysBetween(b.date, today()) <= 1;
  return {
    verse: b.verse || VERSES[Math.floor(dayIndex() / 7) % VERSES.length],
    fact: (fresh && b.fact) || FACTS[dayIndex() % FACTS.length],
    note: fresh ? b.note : null,
    qow: b.questionOfWeek || null,
    myth: b.myth && b.myth.text ? b.myth : null,
    flags: fresh ? (b.flags || []) : [],
    questions: fresh && b.date === today() ? (b.questions || null) : null,
  };
}

/* ---------- calendar ---------- */
const shortTitle = (t) => t.replace(/\s+—\s+/, ' · ');
function eventsOn(d) { return S.events.filter((e) => e.start.slice(0, 10) === d); }
function upcoming(days = 21) {
  const t = today(), end = addDays(t, days);
  return S.events.filter((e) => e.kind !== 'class' && e.start.slice(0, 10) >= t && e.start.slice(0, 10) <= end);
}
function calendarQuestions(when) {
  const t = today(), qs = [];
  const todays = eventsOn(t).filter((e) => e.kind !== 'class');
  for (const e of todays) {
    const course = e.title.split(' — ')[0];
    const what = e.title.split(' — ')[1] || e.title;
    const time = e.allDay ? '' : ` at ${e.start.slice(11, 16)}`;
    if (when === 'morning' && (e.kind === 'test' || e.kind === 'exam')) qs.push({ id: 'ready-' + course, text: `${course} ${what.toLowerCase()} today${time}. How ready do you feel?`, options: ['Not yet', 'Getting there', 'Ready'] });
    else if (when === 'morning' && e.kind === 'event') qs.push({ id: 'feel-' + e.title.slice(0, 20), text: `${e.title}${time}. How do you feel about it?`, options: ['Uneasy', 'Fine', 'Looking forward'] });
    else if (when === 'evening' && (e.kind === 'test' || e.kind === 'exam')) qs.push({ id: 'went-' + course, text: `How did ${course} ${what.toLowerCase()} go?`, options: ['Rough', 'Okay', 'Good', 'Great'] });
  }
  if (when === 'morning' && !qs.length) {
    const next = upcoming(4).find((e) => e.kind === 'exam' || (e.kind === 'test' && !e.allDay));
    if (next) {
      const n = daysBetween(t, next.start.slice(0, 10));
      if (n > 0) qs.push({ id: 'conf-' + next.title.slice(0, 20), text: `${shortTitle(next.title)} in ${n} day${n > 1 ? 's' : ''}. How confident are you?`, options: ['Low', 'Medium', 'High'] });
    }
  }
  return qs.slice(0, 2);
}
function questionsFor(when) {
  const b = brief();
  if (b.questions) return b.questions.filter((q) => (q.when || 'morning') === when);
  return calendarQuestions(when);
}

/* ---------- analysis ---------- */
function sortedDays() { return Object.keys(S.data.days || {}).sort(); }
function day(d) { return (S.data.days || {})[d] || {}; }
function load(d) { const e = day(d).evening; return e && e.training && e.training.minutes && e.training.rpe ? e.training.minutes * e.training.rpe : 0; }
function acwr() {
  const t = today();
  const days = sortedDays();
  if (!days.length || daysBetween(days[0], t) < 21) return null;
  let a = 0, c = 0;
  for (let i = 0; i < 28; i++) { const l = load(addDays(t, -i)); if (i < 7) a += l; c += l; }
  if (!c) return null;
  return (a / 7) / (c / 28);
}
function streak() {
  let n = 0, d = today();
  const has = (x) => { const v = day(x); return v.morning || v.evening; };
  if (!has(d)) d = addDays(d, -1);
  while (has(d)) { n++; d = addDays(d, -1); }
  return n;
}
function lastN(field, n, sec = 'evening') {
  const out = [];
  for (let i = 0; i < n; i++) { const v = day(addDays(today(), -i))[sec]; if (v && v[field] != null) out.push(v[field]); }
  return out;
}
function phq(w) { return w && w.phq ? w.phq.reduce((a, b) => a + (b || 0), 0) : null; }

function localFlags() {
  const flags = [];
  const moods = lastN('mood', 7);
  const weeks = Object.keys(S.data.weeks || {}).sort().slice(-2).map((k) => S.data.weeks[k]);
  const p = weeks.map(phq).filter((x) => x != null);
  if ((moods.filter((m) => m <= 2).length >= 5) || (p.length === 2 && p[0] >= 6 && p[1] >= 6) || (p.length && p[p.length - 1] >= 9)) {
    flags.push({ id: 'care', level: 'care', title: 'You’ve been carrying a lot', text: 'Your mood has been low for a while. That’s worth talking about — with someone you trust, or a counsellor. UP Careline (24/7): <a href="tel:0800747747">0800 747 747</a>. SADAG Suicide Crisis Line: <a href="tel:0800567567">0800 567 567</a>.', html: true });
  }
  const busy = lastN('busy', 7), stress = lastN('stress', 7), sleep = lastN('sleepHours', 7, 'morning');
  if ((busy.length >= 5 && avg(busy) >= 4) || (sleep.length >= 4 && avg(sleep) < 6.5 && stress.length >= 4 && avg(stress) >= 4)) {
    flags.push({ id: 'break', level: 'warn', title: 'Time for a break', text: 'You’ve been running hot this week. Block two hours with nothing in them — no Kora, no UPCS, no books. Rest is part of the work.' });
  }
  const beds = lastN('bedMin', 5, 'morning');
  const lateN = beds.filter((b) => b >= 360).length; // 360 = midnight
  const napsCovered = lastTotals(5).length >= 3 && avg(lastTotals(5)) >= 7.5;
  if (lateN >= 3) flags.push({ id: 'late', level: napsCovered ? 'info' : 'warn', title: napsCovered ? 'Late nights, but naps are covering' : 'Late nights adding up', text: napsCovered ? `Lights out after midnight on ${lateN} of your last ${beds.length} nights, but with naps you're averaging ${r1(avg(lastTotals(5)))}h a day. Night sleep still does the deepest recovery, so aim for one earlier night.` : `Lights out after midnight on ${lateN} of your last ${beds.length} nights. Sprint speed and exam memory both get built in sleep — pick one night this week for lights out by 22:30.` });
  const s3 = lastTotals(3);
  if (s3.length === 3 && avg(s3) < 6) flags.push({ id: 'sleep', level: 'warn', title: 'Sleep debt building', text: `Counting naps, you’ve averaged ${r1(avg(s3))}h a day over the last 3 days. Aim for an earlier night tonight.` });
  const a = acwr();
  if (a != null && a > 1.5) flags.push({ id: 'acwr', level: 'bad', title: 'Training load spiking', text: `This week’s load is ${Math.round((a - 1) * 100)}% above your monthly average. That’s the injury zone — ease off.` });
  else if (a != null && a > 1.3) flags.push({ id: 'acwr', level: 'warn', title: 'Training load climbing fast', text: `This week’s load is ${Math.round((a - 1) * 100)}% above your monthly average. Build gradually.` });
  return flags;
}
function allFlags() {
  const seen = new Set(), out = [];
  for (const f of [...brief().flags, ...localFlags()]) { if (!seen.has(f.id)) { seen.add(f.id); out.push(f); } }
  return out;
}

/* ---------- UI: shell ---------- */
const $ = (s) => document.querySelector(s);
const app = () => $('#app');
let toastTimer;
function toast(msg) {
  let el = $('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg; el.style.display = 'block';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.style.display = 'none'; }, 2600);
}
const ICONS = {
  today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 16a8 8 0 0 1 16 0"/><path d="M12 4v2M4.9 8.9l1.4 1.4M19.1 8.9l-1.4 1.4M2 20h20"/></svg>',
  trends: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l5-5 4 3 8-8"/><path d="M15 7h5v5"/></svg>',
  body: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="4" r="2"/><path d="M6 8.5l6 1 6-1"/><path d="M12 9.5v5.5"/><path d="M9 21l3-6 3 6"/></svg>',
  journal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M9 9h6M9 13h4"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
};
function tabs() {
  const t = (id, label) => `<button class="${S.tab === id && !S.form ? 'on' : ''}" data-action="tab" data-tab="${id}">${ICONS[id]}${label}</button>`;
  return `<nav class="tabs">${t('today', 'Today')}${t('trends', 'Trends')}${t('body', 'Body')}${t('journal', 'Journal')}${t('settings', 'Settings')}</nav>`;
}
function render() {
  if (!S.token) { app().innerHTML = viewSetup(); return; }
  let body;
  const onBody = !S.form && S.tab === 'body';
  if (!onBody && bodyMod) bodyMod.detach();
  if (S.form) body = viewForm();
  else if (S.tab === 'trends') body = viewTrends();
  else if (onBody) body = viewBody();
  else if (S.tab === 'journal') body = viewJournal();
  else if (S.tab === 'settings') body = viewSettings();
  else body = viewToday();
  app().innerHTML = `<div class="wrap${onBody ? ' wrap-body' : ''}">${body}</div>${tabs()}`;
  if (onBody) mountBody();
}
function viewBody() {
  return `${S.returnForm ? '' : `<div class="top"><div><h1>Body</h1><div class="sub">Tap where it hurts. Drag to turn, pinch to zoom.</div></div></div>`}
    ${S.returnForm ? `<div class="top"><div><h1>Log pain</h1><div class="sub">Tap the structure, then “Log pain here”.</div></div></div>` : ''}
    <div id="body-slot"></div>`;
}

/* ---------- views ---------- */
function viewSetup() {
  return `<div class="wrap setup">
    <img src="icons/icon-192.png" alt="">
    <h1>Kairos</h1>
    <p>Make the moment count.<br>Paste your GitHub key to unlock this device. It stays on this device only.</p>
    <input class="field" id="tok" type="password" autocomplete="off" placeholder="github_pat_…">
    <div class="err" id="tok-err"></div>
    <button class="save" data-action="unlock">Unlock</button>
  </div>`;
}

function greeting() {
  const h = hour();
  return h < 4 ? 'Still up' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function viewToday() {
  const t = today(), d = day(t), y = addDays(t, -1), yd = day(y);
  const b = brief();
  const parts = [];
  parts.push(`<div class="top"><div><h1>${greeting()}, ${CFG.name}</h1><div class="sub">${fmtDay(t, { weekday: 'long', day: 'numeric', month: 'long' })}</div></div>
    <div class="streak"><b>${streak()}</b><span>day streak</span></div></div>`);

  // What's due
  const isWeekend = dow(t) === 0 || (dow(t) === 6 && hour() >= 17) || (dow(t) === 1 && hour() < 12);
  const wk = weekKey(dow(t) === 1 ? addDays(t, -1) : t);
  const ctas = [];
  if (!yd.evening && hour() < 15 && Object.keys(S.data.days).length) ctas.push(cta('evening', y, 'Catch up on last night', '20 seconds. Keep the streak alive.'));
  if (!d.morning && hour() >= 4 && hour() < 15) ctas.push(cta('morning', t, 'Morning check-in', 'About 15 seconds'));
  if (!d.evening && hour() >= 17) ctas.push(cta('evening', t, 'Evening check-in', 'About 45 seconds'));
  if (isWeekend && !(S.data.weeks || {})[wk]) ctas.push(cta('weekly', wk, 'Sunday review', 'About 3 minutes'));
  parts.push(ctas.join(''));
  parts.push(`<div class="done-row">
    <button class="pill-done ${d.morning ? 'ok' : ''}" data-action="open" data-type="morning" data-date="${t}"><span class="dot"></span>Morning${d.morning ? '' : ''}</button>
    <button class="pill-done ${day(eveningDay()).evening ? 'ok' : ''}" data-action="open" data-type="evening" data-date="${eveningDay()}"><span class="dot"></span>Evening${eveningDay() !== t ? ' (last night)' : ''}</button>
  </div>`);

  if (b.note) parts.push(`<div class="card"><p>${esc(b.note)}</p></div>`);

  for (const f of allFlags()) parts.push(`<div class="card flag ${f.level}"><div class="bar"></div><div><b>${esc(f.title)}</b><span class="small muted">${f.html ? f.text : esc(f.text)}</span></div></div>`);

  parts.push(`<div class="card"><h3>Your verse for this season</h3><div class="verse">“${esc(b.verse.text)}”</div><div class="verse-ref">${esc(b.verse.ref)}</div>${b.verse.why ? `<div class="verse-why">${esc(b.verse.why)}</div>` : ''}</div>`);

  const f = b.fact;
  parts.push(`<div class="card interrupt"><div class="kicker">${f.type === 'quote' ? 'Quote of the day' : 'Did you know?'}</div><p>${esc(f.text)}</p>${f.source ? `<div class="tiny" style="margin-top:6px">— ${esc(f.source)}</div>` : ''}</div>`);

  if (b.myth) {
    const m = b.myth;
    const paras = String(m.text).split(/\n\s*\n/).map((p) => `<p>${esc(p)}</p>`).join('');
    parts.push(`<details class="card myth"><summary><h3>Myth of the week</h3><div class="myth-title">${esc(m.title)}</div><div class="tiny">${esc(m.tradition || 'Greek and Roman myth')}${m.source ? ` · ${esc(m.source)}` : ''} · tap to read</div></summary>
      <div class="myth-body">${paras}${m.lesson ? `<p class="myth-lesson">${esc(m.lesson)}</p>` : ''}</div></details>`);
  }
  if (b.qow && b.qow.text) {
    const answered = (S.data.weeks[weekKey(t)] || {}).qowAnswer;
    parts.push(`<div class="card"><h3>Question of the week</h3><div class="verse" style="font-size:18px">${esc(b.qow.text)}</div><div class="tiny" style="margin-top:8px">${answered ? 'You answered this in your Sunday review.' : 'Sit with it. You’ll answer it in your Sunday review.'}</div></div>`);
  }

  // Today + next up
  const todays = eventsOn(t);
  if (todays.length) {
    parts.push(`<div class="card"><h3>Today</h3>${todays.map((e) => evRow(e, true)).join('')}</div>`);
  }
  const next = upcoming(21).filter((e) => e.start.slice(0, 10) > t).slice(0, 6);
  if (next.length) parts.push(`<div class="card"><h3>Coming up</h3>${next.map((e) => evRow(e, false)).join('')}</div>`);

  if (S.growth && S.growth.score != null) {
    parts.push(`<div class="card"><h3>Growth · ${esc(S.growth.monthLabel || S.growth.month)}</h3><div class="score"><div class="num">${S.growth.score}</div><div class="small muted">${esc(S.growth.summary || '')}</div></div>${S.growth.nudge ? `<p class="small" style="margin-top:10px">${esc(S.growth.nudge)}</p>` : ''}</div>`);
  }
  if (S.dirty) parts.push(`<p class="tiny">Some check-ins are saved on this device and will sync when you’re online.</p>`);
  return parts.join('');
}
function cta(type, date, title, sub) {
  return `<button class="cta" data-action="open" data-type="${type}" data-date="${date}"><div><b>${title}</b><span>${sub}</span></div><div class="arrow">→</div></button>`;
}
function evRow(e, timeOnly) {
  const d = e.start.slice(0, 10);
  const n = daysBetween(today(), d);
  const when = timeOnly ? (e.allDay ? 'All day' : e.start.slice(11, 16)) : (n === 1 ? 'Tomorrow' : n < 7 ? fmtDay(d, { weekday: 'short' }) : fmtDay(d, { day: 'numeric', month: 'short' }));
  const label = { exam: 'Exam', test: 'Test', due: 'Due', class: 'Class', event: 'Event' }[e.kind] || 'Event';
  return `<div class="ev"><div class="when">${when}</div><div class="what">${esc(shortTitle(e.title))}${e.location && timeOnly ? `<div class="tiny">${esc(e.location)}</div>` : ''}</div><span class="tag ${e.kind}">${label}${!timeOnly && n > 1 && (e.kind === 'exam') ? ` · ${n}d` : ''}</span></div>`;
}

/* ---------- forms ---------- */
const MOOD = ['Low', '', 'Okay', '', 'Great'];
function scale(field, n, anchors, start = 1) {
  const v = S.form.values[field], pre = S.form.pre.has(field);
  let html = `<div class="scale" data-group="${field}">`;
  for (let i = 0; i < n; i++) {
    const val = start + i;
    html += `<button data-action="pick" data-field="${field}" data-value="${val}" class="${v === val ? (pre ? 'pre' : 'on') : ''}">${val}${anchors && anchors[i] ? `<small>${anchors[i]}</small>` : ''}</button>`;
  }
  return html + '</div>';
}
function choice(field, options, multi = false) {
  const v = S.form.values[field];
  return `<div class="chips" data-group="${field}">${options.map((o) => {
    const on = multi ? (v || []).includes(o) : v === o;
    const cls = on ? (!multi && S.form.pre.has(field) ? 'pre' : 'on') : '';
    return `<button data-action="${multi ? 'toggle' : 'pick'}" data-field="${field}" data-value="${esc(o)}" class="${cls}">${esc(o)}</button>`;
  }).join('')}</div>`;
}
function q(label, inner, hint = '') {
  return `<div class="q"><div class="label">${label}${hint ? `<span class="hint">${hint}</span>` : ''}</div>${inner}</div>`;
}

function openForm(type, date) {
  const existing = type === 'weekly' ? (S.data.weeks || {})[date] : day(date)[type];
  const values = existing ? JSON.parse(JSON.stringify(existing)) : {};
  const pre = new Set();
  if (!existing && type !== 'weekly') {
    const prev = day(addDays(date, -1))[type];
    const carry = type === 'morning' ? ['sleepHours', 'sleepQuality'] : ['mood', 'energy', 'stress', 'anxiety', 'busy'];
    if (prev) for (const k of carry) if (prev[k] != null) { values[k] = prev[k]; pre.add(k); }
    if (type === 'morning' && values.sleepHours == null) values.sleepHours = 7;
    if (type === 'morning') {
      // Lights out: if last night's check-in was saved late, start from that time; otherwise yesterday's answer.
      const lastEve = day(addDays(date, -1)).evening;
      const saved = lastEve && lastEve.at ? new Date(lastEve.at) : null;
      const late = saved && (saved.getHours() >= 22 || saved.getHours() < 4) ? bedLabelFromTime(saved) : null;
      const prevBed = prev && prev.bedtime;
      const guess = late && (!prevBed || bedMinOf(late) > bedMinOf(prevBed)) ? late : prevBed;
      if (guess) { values.bedtime = guess; pre.add('bedtime'); }
      if (late) values._lateHint = `${pad(saved.getHours())}:${pad(saved.getMinutes())}`;
    }
    const h = healthFor(date);
    if (type === 'evening' && h && h.minutes) {
      values.training = { type: null, minutes: h.minutes, rpe: null, fromHealth: true };
    }
  }
  if (type === 'evening') values.training = values.training || {};
  if (type === 'weekly') { values.phq = values.phq || [null, null, null, null]; values.roles = values.roles || {}; }
  values.answers = values.answers || {};
  S.form = { type, date, values, pre, error: '' };
  render(); window.scrollTo(0, 0);
}

function viewForm() {
  const f = S.form, v = f.values;
  const title = { morning: 'Morning', evening: 'Evening', weekly: 'Sunday review' }[f.type];
  const isToday = f.date === today();
  let html = `<div class="form-head"><button class="back" data-action="close" aria-label="Back">←</button><div><h2>${title}</h2><div class="tiny">${isToday ? 'Today' : fmtDay(f.date, { weekday: 'long', day: 'numeric', month: 'short' })}</div></div></div>`;
  if (f.pre.size) html += `<p class="prefill-note">Dashed answers are yesterday’s. Tap to change what’s different.</p>`;

  if (f.type === 'morning') {
    html += q('Lights out last night', choice('bedtime', BEDTIMES), v._lateHint ? `you checked in at ${v._lateHint}` : '');
    html += q('Hours slept', `<div class="slider"><input type="range" min="3" max="11" step="0.25" value="${v.sleepHours}" data-action="slide" data-field="sleepHours"><output id="o-sleepHours">${fmtHours(v.sleepHours)}</output></div>`);
    html += q('Sleep quality', scale('sleepQuality', 5, ['Awful', '', 'Okay', '', 'Deep']));
    html += q('Waking up, I feel', choice('wake', ['Drained', 'Okay', 'Ready']));
    html += questionsBlock('morning');
  }

  if (f.type === 'evening') {
    html += q('Mood', scale('mood', 5, MOOD));
    html += q('Energy', scale('energy', 5, ['Empty', '', '', '', 'Full']));
    html += q('Stress', scale('stress', 5, ['Calm', '', '', '', 'Maxed']));
    html += q('Anxiety', scale('anxiety', 5, ['None', '', '', '', 'Heavy']));
    html += q('How full was today?', scale('busy', 5, ['Light', '', '', '', 'Packed']));
    html += q('Where your energy went', choice('roles', ['Faith', 'Kora', 'UPCS', 'Studies', 'Athletics', 'Relationship', 'Family', 'Rest'], true));
    html += `<div class="section-title">Training</div>`;
    const tr = v.training;
    const h = healthFor(f.date);
    if (h && (h.minutes || h.kcal || h.steps)) {
      const bits = [h.minutes ? `${h.minutes} min workout` : null, h.type ? esc(h.type) : null, h.kcal ? `${Math.round(h.kcal)} kcal active` : null, h.steps ? `${Math.round(h.steps).toLocaleString('en-ZA')} steps` : null].filter(Boolean);
      html += `<div class="ctx">From Apple Health: ${bits.join(' · ')}</div>`;
    }
    html += q('Session', `<div class="chips" data-group="training.type">${['Rest', 'Speed', 'Speed endurance', 'Tempo', 'Race', 'Gym', 'Technogym cardio', 'Recovery', 'Other'].map((o) => `<button data-action="train" data-key="type" data-value="${o}" class="${tr.type === o ? 'on' : ''}">${o}</button>`).join('')}</div>`);
    if (tr.type && tr.type !== 'Rest') {
      html += q('Minutes', `<div class="chips">${[30, 45, 60, 75, 90, 120].map((m) => `<button data-action="train" data-key="minutes" data-value="${m}" class="${tr.minutes === m ? 'on' : ''}">${m}</button>`).join('')}<input class="field" style="width:90px;padding:9px 12px" inputmode="numeric" placeholder="Other" data-action="trainmin" value="${tr.minutes && ![30, 45, 60, 75, 90, 120].includes(tr.minutes) ? tr.minutes : ''}"></div>`);
      html += q('How intense was it?', `<div class="scale" data-group="training.rpe">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<button data-action="train" data-key="rpe" data-value="${n}" class="${tr.rpe === n ? 'on' : ''}" style="min-height:42px">${n}</button>`).join('')}</div><div class="tiny" style="margin-top:6px">1 = barely working · 7 = hard · 10 = everything you had</div>`);
      if (['Speed', 'Speed endurance', 'Tempo', 'Race', 'Other'].includes(tr.type)) html += timesBlock(f, tr);
    }
    html += q('Soreness', `<div class="scale" data-group="training.soreness">${[1, 2, 3, 4, 5].map((n, i) => `<button data-action="train" data-key="soreness" data-value="${n}" class="${tr.soreness === n ? 'on' : ''}">${n}<small>${['None', '', '', '', 'Very'][i]}</small></button>`).join('')}</div>`);
    const pains = painLogs().filter((l) => l.date === f.date);
    html += `<div class="section-title" id="pain-today">Any pain today?</div>
      <div class="ctx">${pains.length ? pains.map((l) => `<div class="pain-line"><span class="pain-sev" style="--sev:${l.intensity}">${l.intensity}</span>${esc(l.name.charAt(0).toUpperCase() + l.name.slice(1))} · ${esc(l.type.toLowerCase())} · ${esc(l.timing.toLowerCase())}</div>`).join('') : '<span class="muted">Nothing logged today.</span>'}
      <button class="btn full" data-action="bodylog" style="margin-top:10px">${pains.length ? 'Log another on the body map' : 'Log pain on the body map'}</button></div>`;
    html += `<div class="section-title">Today I…</div>`;
    html += q('', choice('ticks', ['Had quiet time', 'Prayed', 'Quality time with her', 'Ate well', 'Drank 2L water', 'Screens off before bed'], true));
    html += q('Naps today', choice('nap', NAPS), 'counts towards your sleep');
    html += q('Study hours', choice('study', ['0', '1', '2', '3', '4', '5+']));
    html += questionsBlock('evening');
    html += `<div class="section-title">Journal</div>`;
    html += `<textarea data-action="text" data-field="journal" placeholder="Anything on your mind…">${esc(v.journal || '')}</textarea>
      <label class="toggle"><input type="checkbox" data-action="check" data-field="private" ${v.private ? 'checked' : ''}>Just for me — Claude won’t read this entry</label>`;
  }

  if (f.type === 'weekly') {
    const b = brief();
    html += weekNumbers(f.date);
    html += `<div class="section-title">Over the last two weeks, how often have you…</div>`;
    const items = ['Felt nervous, anxious or on edge', 'Not been able to stop or control worrying', 'Had little interest or pleasure in doing things', 'Felt down, depressed or hopeless'];
    items.forEach((it, i) => {
      html += q(it, `<div class="scale" data-group="phq${i}">${['Not at all', 'Several days', 'Over half', 'Nearly every day'].map((o, j) => `<button data-action="phq" data-i="${i}" data-value="${j}" class="${v.phq[i] === j ? 'on' : ''}" style="font-size:12px">${o}</button>`).join('')}</div>`);
    });
    html += `<div class="section-title">How is each part of life going? (1–5)</div>`;
    for (const [k, label] of [['faith', 'Faith'], ['kora', 'Kora'], ['upcs', 'UPCS'], ['studies', 'Studies'], ['relationship', 'Relationship'], ['athletics', 'Athletics']]) {
      html += q(label, `<div class="scale" data-group="roles.${k}">${[1, 2, 3, 4, 5].map((n) => `<button data-action="role" data-key="${k}" data-value="${n}" class="${v.roles[k] === n ? 'on' : ''}">${n}</button>`).join('')}</div>`);
    }
    html += q('How close do you feel to God right now?', scale('closeness', 5, ['Distant', '', '', '', 'Close']));
    html += q('How connected do you feel to her?', scale('connection', 5, ['Apart', '', '', '', 'Close']));
    if (b.qow && b.qow.text) html += q('Question of the week', `<div class="verse" style="font-size:17px;margin-bottom:10px">${esc(b.qow.text)}</div><textarea data-action="text" data-field="qowAnswer" placeholder="Take your time…">${esc(v.qowAnswer || '')}</textarea>`);
    html += q('One win this week', `<input class="field" data-action="text" data-field="win" value="${esc(v.win || '')}">`);
    html += q('One thing to let go of', `<input class="field" data-action="text" data-field="letGo" value="${esc(v.letGo || '')}">`);
  }

  html += `<div class="err" id="form-err">${esc(f.error)}</div><button class="save" data-action="save">Save</button>`;
  return html;
}
function fmtHours(h) { const hh = Math.floor(h), mm = Math.round((h - hh) * 60); return mm ? `${hh}h${pad(mm)}` : `${hh}h`; }

const DISTS = [60, 100, 150, 200, 250, 300, 350, 400, 500, 600];
const TKINDS = ['Rep', 'Time trial', 'Race'];
function timesBlock(f, tr) {
  const draft = f.values._t || (f.values._t = { dist: null, kind: tr.type === 'Race' ? 'Race' : 'Rep', txt: '' });
  const pb = bests(f.date);
  const list = (tr.times || []).map((t, i) => {
    const isPb = !pb[t.dist] || t.sec < pb[t.dist].sec;
    return `<div class="time-row"><b>${t.dist}m</b><span>${fmtSec(t.sec)}</span><small>${esc(t.kind)}${isPb ? ' · <em>PB</em>' : ''}</small><button class="bm-x" data-action="tdel" data-i="${i}" aria-label="Remove time">×</button></div>`;
  }).join('');
  return q('Times', `${list}
    <div class="chips" data-group="tdist">${DISTS.map((d) => `<button data-action="tdist" data-value="${d}" class="${draft.dist === d ? 'on' : ''}">${d}</button>`).join('')}</div>
    <div class="time-add"><input class="field" data-action="ttime" inputmode="decimal" placeholder="${draft.dist && draft.dist >= 400 ? '52.80 or 1:05.4' : '23.41'}" value="${esc(draft.txt)}">
      <div class="chips">${TKINDS.map((k) => `<button data-action="tkind" data-value="${k}" class="${draft.kind === k ? 'on' : ''}">${k}</button>`).join('')}</div>
      <button class="btn" data-action="tadd">Add time</button></div>
    <div class="err" id="t-err"></div>`, 'optional · reps, time trials or races');
}

// "Your week in numbers": Monday to Sunday ending on the review date, compared with the week before.
function weekNumbers(end) {
  const daysOf = (e) => Array.from({ length: 7 }, (_, i) => addDays(e, -6 + i));
  const stats = (e) => {
    const ds = daysOf(e), m = ds.map((d) => day(d).morning).filter(Boolean), ev = ds.map((d) => day(d).evening).filter(Boolean);
    const val = (arr, k) => arr.map((x) => x[k]).filter((x) => x != null);
    const pains = painLogs().filter((l) => ds.includes(l.date));
    const hot = {}; pains.forEach((l) => { hot[l.name] = (hot[l.name] || 0) + l.intensity; });
    return {
      both: ds.filter((d) => day(d).morning && day(d).evening).length,
      sleep: avg(ds.map(totalSleep).filter((x) => x != null)), naps: val(ev, 'napMin').reduce((a, b) => a + b, 0), napDays: val(ev, 'napMin').filter((x) => x > 0).length, bed: avg(val(m, 'bedMin')), late: val(m, 'bedMin').filter((b) => b >= 360).length,
      mood: avg(val(ev, 'mood')), energy: avg(val(ev, 'energy')), stress: avg(val(ev, 'stress')),
      sessions: ev.filter((x) => x.training && x.training.type && x.training.type !== 'Rest').length,
      load: ds.reduce((a, d) => a + load(d), 0),
      study: val(ev, 'studyHours').reduce((a, b) => a + b, 0),
      quiet: ev.filter((x) => (x.ticks || []).includes('Had quiet time')).length,
      pain: pains.length, hot: Object.entries(hot).sort((a, b) => b[1] - a[1])[0],
      pbs: (() => {
        // One entry per distance: this week's best, if it beat everything before the week
        const before = {}, week = {};
        for (const t of allTimes()) {
          if (t.d < ds[0]) { if (before[t.dist] == null || t.sec < before[t.dist]) before[t.dist] = t.sec; }
          else if (ds.includes(t.d) && (!week[t.dist] || t.sec < week[t.dist].sec)) week[t.dist] = t;
        }
        return Object.values(week).filter((t) => before[t.dist] == null || t.sec < before[t.dist]).sort((a, b) => a.dist - b.dist);
      })(),
    };
  };
  const w = stats(end), p = stats(addDays(end, -7));
  const arrow = (a, b, goodUp = true, digits = 1) => { if (a == null || b == null) return ''; const d = a - b; if (Math.abs(d) < Math.pow(10, -digits) / 2) return ''; const up = d > 0; return `<small class="${up === goodUp ? 'good' : 'bad'}">${up ? '▲' : '▼'} ${Math.abs(d).toFixed(digits)}</small>`; };
  const tile = (k, v, extra = '') => `<div class="stat"><div class="k">${k}</div><div class="v">${v}${extra}</div></div>`;
  const loadPct = p.load ? Math.round((w.load / p.load - 1) * 100) : null;
  const lines = [
    `${w.sessions} training session${w.sessions === 1 ? '' : 's'}${loadPct != null ? `, load ${loadPct >= 0 ? 'up' : 'down'} ${Math.abs(loadPct)}% on last week` : ''}.`,
    w.pbs.length ? `New PB${w.pbs.length > 1 ? 's' : ''}: ${w.pbs.map((t) => `${t.dist}m ${fmtSec(t.sec)}`).join(', ')}.` : null,
    w.bed != null ? `Lights out around ${clockOf(w.bed)} on average — ${w.late} night${w.late === 1 ? '' : 's'} after midnight.` : null,
    w.napDays ? `Naps on ${w.napDays} day${w.napDays === 1 ? '' : 's'}, ${fmtHours(w.naps / 60)} in total (included in average sleep).` : null,
    `${w.study} study hour${w.study === 1 ? '' : 's'} and quiet time on ${w.quiet} day${w.quiet === 1 ? '' : 's'}.`,
    w.pain ? `${w.pain} pain entr${w.pain === 1 ? 'y' : 'ies'}${w.hot ? `, mostly ${w.hot[0]}` : ''}.` : 'No pain logged.',
  ].filter(Boolean);
  return `<div class="card week-card"><h3>Your week in numbers</h3>
    <div class="stats">${tile('Avg sleep', w.sleep != null ? r1(w.sleep) + 'h' : '–', arrow(w.sleep, p.sleep))}${tile('Avg mood', r1(w.mood), arrow(w.mood, p.mood))}${tile('Avg stress', r1(w.stress), arrow(w.stress, p.stress, false))}</div>
    ${lines.map((l) => `<p class="small" style="margin:6px 0 0">${esc(l)}</p>`).join('')}
    <p class="tiny" style="margin-top:8px">${w.both}/7 days fully checked in. Arrows compare with the week before.</p></div>`;
}
function questionsBlock(when) {
  const qs = questionsFor(when);
  if (!qs.length) return '';
  return `<div class="section-title">Quick question${qs.length > 1 ? 's' : ''}</div>` + qs.map((qq) => {
    const cur = S.form.values.answers[qq.id];
    const opts = qq.options && qq.options.length ? qq.options : null;
    const inner = opts
      ? `<div class="chips">${opts.map((o) => `<button data-action="answer" data-id="${esc(qq.id)}" data-value="${esc(o)}" class="${cur === o ? 'on' : ''}">${esc(o)}</button>`).join('')}</div>`
      : `<input class="field" data-action="answertext" data-id="${esc(qq.id)}" value="${esc(cur || '')}">`;
    return `<div class="q"><div class="label" style="font-weight:500">${esc(qq.text)}</div>${inner}</div>`;
  }).join('');
}

function validate() {
  const f = S.form, v = f.values;
  if (f.type === 'morning' && !v.bedtime) return 'Pick roughly when the lights went out.';
  if (f.type === 'morning' && !v.sleepQuality) return 'Rate your sleep quality.';
  if (f.type === 'evening') {
    for (const k of ['mood', 'energy', 'stress']) if (!v[k]) return `Pick a number for ${k}.`;
    if (!v.training.type) return 'Pick a training session, or Rest.';
    if (v.training.type !== 'Rest' && (!v.training.minutes || !v.training.rpe)) return 'Add minutes and how intense the session was.';
  }
  if (f.type === 'weekly' && v.phq.some((x) => x == null)) return 'Answer the four questions at the top.';
  return '';
}
async function saveForm() {
  const err = validate();
  if (err) { S.form.error = err; const el = $('#form-err'); if (el) el.textContent = err; return; }
  const f = S.form;
  const v = { ...f.values, at: new Date().toISOString() };
  delete v._lateHint; delete v._t;
  if (f.type === 'morning') v.bedMin = bedMinOf(v.bedtime);
  let pbMsg = null;
  if (f.type === 'evening' && v.training && v.training.times && v.training.times.length) {
    const pb = bests(f.date);
    const fresh = v.training.times.filter((t) => !pb[t.dist] || t.sec < pb[t.dist].sec);
    if (fresh.length && allTimes().some((t) => t.d !== f.date)) pbMsg = `New PB: ${fresh.map((t) => `${t.dist}m ${fmtSec(t.sec)}`).join(', ')}`;
  }
  if (f.type === 'evening' && v.nap != null) v.napMin = napMinOf(v.nap);
  if (v.study != null) v.studyHours = v.study === '5+' ? 5 : Number(v.study);
  if (f.type === 'evening' && v.training.type === 'Rest') v.training = { type: 'Rest', minutes: 0, rpe: 0, soreness: v.training.soreness || null };
  if (f.type === 'weekly') { v.phqTotal = phq(v); S.data.weeks[f.date] = v; }
  else { S.data.days[f.date] = S.data.days[f.date] || {}; S.data.days[f.date][f.type] = v; }
  S.dirty = true; persist();
  S.form = null; S.tab = 'today'; render(); window.scrollTo(0, 0);
  toast(pbMsg ? `Saved · ${pbMsg} 🔥` : 'Saved');
  try { await push(); render(); } catch (e) { toast('Saved on this device. Will sync later.'); }
}

/* ---------- trends ---------- */
function seriesFor(fn, n) {
  const pts = [];
  for (let i = n - 1; i >= 0; i--) { const d = addDays(today(), -i); const y = fn(d); pts.push({ d, y: y == null ? null : y }); }
  return pts;
}
function rolling(pts, w = 7) {
  return pts.map((p, i) => {
    const win = pts.slice(Math.max(0, i - w + 1), i + 1).map((x) => x.y).filter((x) => x != null);
    return { d: p.d, y: win.length >= Math.min(3, w) ? avg(win) : null };
  });
}
function lineChart(series, { min, max, h = 150, smooth = 7, yfmt = r1 } = {}) {
  const labelW = Math.max(...[min, (min + max) / 2, max].map((g) => String(yfmt(g)).length)) * 5.2 + 6;
  const W = 340, H = h, P = { l: Math.max(22, labelW), r: 6, t: 8, b: 18 };
  const n = series[0].pts.length;
  const x = (i) => P.l + (i / Math.max(1, n - 1)) * (W - P.l - P.r);
  const y = (v) => P.t + (1 - (v - min) / (max - min)) * (H - P.t - P.b);
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">`;
  for (const g of [min, (min + max) / 2, max]) svg += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(g)}" y2="${y(g)}" stroke="rgba(255,255,255,.07)"/><text x="${P.l - 5}" y="${y(g) + 3}" fill="#7D7487" font-size="9" text-anchor="end">${yfmt(g)}</text>`;
  const ticks = [0, Math.floor(n / 2), n - 1];
  for (const i of ticks) svg += `<text x="${x(i)}" y="${H - 4}" fill="#7D7487" font-size="9" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${fmtDay(series[0].pts[i].d, { day: 'numeric', month: 'short' })}</text>`;
  for (const s of series) {
    for (let i = 0; i < n; i++) { const p = s.pts[i]; if (p.y != null) svg += `<circle cx="${x(i)}" cy="${y(p.y)}" r="1.6" fill="${s.color}" opacity=".35"/>`; }
    const sm = rolling(s.pts, smooth);
    let d = '', pen = false;
    sm.forEach((p, i) => { if (p.y == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`; pen = true; });
    svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  return svg + '</svg>';
}
function legend(items) { return `<div class="legend">${items.map(([c, l]) => `<span><i style="background:${c}"></i>${l}</span>`).join('')}</div>`; }
function heatmap(n) {
  const weeks = Math.ceil(n / 7) + 1;
  const end = today();
  const start = addDays(end, -(weeks * 7 - 1));
  const s0 = addDays(start, -dow(start)); // align columns to Sundays
  const cols = [];
  const W = 340, cell = Math.min(14, Math.floor((W - 4) / weeks) - 2), gap = 2;
  const colors = { 1: '#5B2A86', 2: '#8E2A8A', 3: '#D13A6E', 4: '#FF5C3C', 5: '#FF9A1F' };
  let svg = `<svg class="chart" viewBox="0 0 ${weeks * (cell + gap)} ${7 * (cell + gap)}">`;
  for (let w = 0; w < weeks; w++) for (let r = 0; r < 7; r++) {
    const d = addDays(s0, w * 7 + r);
    if (d > end) continue;
    const m = (day(d).evening || {}).mood;
    svg += `<rect x="${w * (cell + gap)}" y="${r * (cell + gap)}" width="${cell}" height="${cell}" rx="2" fill="${m ? colors[m] : 'rgba(255,255,255,.06)'}"><title>${d}${m ? ' · mood ' + m : ''}</title></rect>`;
  }
  cols.push(svg + '</svg>');
  return cols.join('') + legend([[colors[1], '1'], [colors[2], '2'], [colors[3], '3'], [colors[4], '4'], [colors[5], '5 mood'], ['rgba(255,255,255,.12)', 'no entry']]);
}
function links() {
  const out = [];
  const days = sortedDays();
  const pairs = days.map((d) => ({ s: (day(d).morning || {}).sleepHours, m: (day(d).evening || {}).mood, st: (day(d).evening || {}).stress, d }));
  const lo = pairs.filter((p) => p.s != null && p.m != null && p.s < 6.5).map((p) => p.m);
  const hi = pairs.filter((p) => p.s != null && p.m != null && p.s >= 7).map((p) => p.m);
  const bedE = days.map((d) => ({ b: (day(d).morning || {}).bedMin, e: (day(d).evening || {}).energy })).filter((x) => x.b != null && x.e);
  const lateE = bedE.filter((x) => x.b >= 360).map((x) => x.e), earlyE = bedE.filter((x) => x.b <= 300).map((x) => x.e);
  if (lateE.length >= 4 && earlyE.length >= 4) out.push(`After lights out past midnight, your energy that day averages <b>${r1(avg(lateE))}</b>, versus <b>${r1(avg(earlyE))}</b> after nights in bed by 23:00.`);
  if (lo.length >= 5 && hi.length >= 5) out.push(`On nights under 6½ hours, your mood the next evening averages <b>${r1(avg(lo))}</b>, versus <b>${r1(avg(hi))}</b> after 7+ hours.`);
  const testDays = new Set(S.events.filter((e) => e.kind === 'test' || e.kind === 'exam').flatMap((e) => { const d = e.start.slice(0, 10); return [addDays(d, -1), d]; }));
  const st1 = pairs.filter((p) => p.st != null && testDays.has(p.d)).map((p) => p.st);
  const st0 = pairs.filter((p) => p.st != null && !testDays.has(p.d)).map((p) => p.st);
  if (st1.length >= 3 && st0.length >= 5) out.push(`Around tests your stress averages <b>${r1(avg(st1))}</b>, versus <b>${r1(avg(st0))}</b> on other days.`);
  const qt = days.filter((d) => (day(d).evening || {}).ticks);
  const withQ = qt.filter((d) => day(d).evening.ticks.includes('Had quiet time')).map((d) => day(d).evening.mood).filter(Boolean);
  const without = qt.filter((d) => !day(d).evening.ticks.includes('Had quiet time')).map((d) => day(d).evening.mood).filter(Boolean);
  if (withQ.length >= 5 && without.length >= 5) out.push(`On days with quiet time your mood averages <b>${r1(avg(withQ))}</b>, versus <b>${r1(avg(without))}</b> without.`);
  const busyDays = pairs.map((p) => ({ b: (day(p.d).evening || {}).busy, next: (day(addDays(p.d, 1)).morning || {}).sleepQuality })).filter((x) => x.b && x.next);
  const bHi = busyDays.filter((x) => x.b >= 4).map((x) => x.next), bLo = busyDays.filter((x) => x.b <= 2).map((x) => x.next);
  if (bHi.length >= 5 && bLo.length >= 5) out.push(`After packed days your sleep quality averages <b>${r1(avg(bHi))}</b>, versus <b>${r1(avg(bLo))}</b> after light days.`);
  return out;
}
function viewTrends() {
  const n = S.range;
  const ev = (k) => (d) => (day(d).evening || {})[k];
  const mo = (k) => (d) => (day(d).morning || {})[k];
  const logged = sortedDays().filter((d) => daysBetween(d, today()) < n);
  let html = `<div class="top"><div><h1>Trends</h1><div class="sub">${logged.length} days logged in this range</div></div></div>`;
  html += `<div class="range">${[30, 90, 365].map((r) => `<button data-action="range" data-value="${r}" class="${n === r ? 'on' : ''}">${r === 365 ? '1 year' : r + ' days'}</button>`).join('')}</div>`;
  const a = acwr();
  html += `<div class="stats">
    <div class="stat"><div class="k">Avg mood</div><div class="v">${r1(avg(lastN('mood', n)))}</div></div>
    <div class="stat"><div class="k">Avg sleep</div><div class="v">${r1(avg(lastTotals(n)))}h</div></div>
    <div class="stat"><div class="k">Load ratio</div><div class="v" style="color:${a == null ? 'inherit' : a > 1.5 ? 'var(--bad)' : a > 1.3 ? 'var(--warn)' : 'var(--good)'}">${a == null ? '–' : r1(a)}</div></div>
  </div>`;
  if (logged.length < 3) html += `<div class="card"><p class="muted small">Your graphs fill in as you log. Patterns start showing after about three weeks.</p></div>`;
  html += `<div class="card"><h3>Every day, coloured by mood</h3>${heatmap(n === 365 ? 364 : Math.max(n, 84))}</div>`;
  html += `<div class="card"><h3>Mind · 7-day average</h3>${lineChart([{ pts: seriesFor(ev('mood'), n), color: '#FF9A1F' }, { pts: seriesFor(ev('energy'), n), color: '#3DDC97' }, { pts: seriesFor(ev('stress'), n), color: '#FF3D5A' }, { pts: seriesFor(ev('anxiety'), n), color: '#9B8CFF' }], { min: 1, max: 5 })}${legend([['#FF9A1F', 'Mood'], ['#3DDC97', 'Energy'], ['#FF3D5A', 'Stress'], ['#9B8CFF', 'Anxiety']])}</div>`;
  html += `<div class="card"><h3>Sleep</h3>${lineChart([{ pts: seriesFor(mo('sleepHours'), n), color: '#7FB8FF' }, { pts: seriesFor(totalSleep, n), color: '#3DDC97' }], { min: 4, max: 11 })}${legend([['#7FB8FF', 'Night'], ['#3DDC97', 'Night + naps']])}</div>`;
  const bedPts = seriesFor(mo('bedMin'), n);
  if (bedPts.some((p) => p.y != null)) {
    const recent = lastN('bedMin', 7, 'morning');
    html += `<div class="card"><h3>Lights out</h3>${lineChart([{ pts: bedPts, color: '#9B8CFF' }], { min: 210, max: 510, yfmt: clockOf })}${legend([['#9B8CFF', 'Bedtime (higher = later)']])}<p class="tiny" style="margin-top:6px">${recent.length ? `Last 7 nights: average ${clockOf(avg(recent))}, ${recent.filter((b) => b >= 360).length} after midnight.` : ''}</p></div>`;
  }
  html += speedCard(n);
  html += painCard(n);
  // training load bars
  const lp = seriesFor(load, n), maxL = Math.max(400, ...lp.map((p) => p.y || 0));
  const W = 340, H = 130, bw = (W - 8) / n;
  let bars = `<svg class="chart" viewBox="0 0 ${W} ${H}">`;
  lp.forEach((p, i) => { if (p.y) { const hh = (p.y / maxL) * (H - 16); bars += `<rect x="${4 + i * bw}" y="${H - 14 - hh}" width="${Math.max(1, bw - 1)}" height="${hh}" rx="1.5" fill="url(#g)"/>`; } });
  bars += `<defs><linearGradient id="g" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#B0129B"/><stop offset="1" stop-color="#FF8A00"/></linearGradient></defs><text x="4" y="${H - 2}" fill="#7D7487" font-size="9">${fmtDay(lp[0].d, { day: 'numeric', month: 'short' })}</text><text x="${W - 4}" y="${H - 2}" fill="#7D7487" font-size="9" text-anchor="end">Today</text></svg>`;
  html += `<div class="card"><h3>Training load (minutes × intensity)</h3>${bars}<p class="tiny" style="margin-top:6px">Load ratio = this week vs your 4-week average. 0.8–1.3 is the sweet spot; above 1.5 raises injury risk.</p></div>`;
  const weeks = Object.keys(S.data.weeks || {}).sort().filter((w) => daysBetween(w, today()) < n);
  if (weeks.length >= 2) {
    const wp = weeks.map((w) => ({ d: w, y: phq(S.data.weeks[w]) }));
    const roles = ['faith', 'kora', 'upcs', 'studies', 'relationship', 'athletics'];
    html += `<div class="card"><h3>Sunday reviews</h3>${lineChart([{ pts: wp, color: '#9B8CFF' }], { min: 0, max: 12, h: 120, smooth: 1 })}${legend([['#9B8CFF', 'Weekly check score (0–12, lower is better)']])}
      <div style="margin-top:12px">${roles.map((r) => { const vals = weeks.map((w) => (S.data.weeks[w].roles || {})[r]).filter(Boolean); return `<div class="link-row" style="display:flex;justify-content:space-between"><span style="text-transform:capitalize">${r === 'upcs' ? 'UPCS' : r}</span><b>${r1(avg(vals))}</b></div>`; }).join('')}</div></div>`;
  }
  const lk = links();
  html += `<div class="card"><h3>Patterns</h3>${lk.length ? lk.map((l) => `<div class="link-row">${l}</div>`).join('') : '<p class="small muted">Patterns appear once there’s enough data — usually 3–4 weeks.</p>'}</div>`;
  return html;
}

/* ---------- speed: times and PBs ---------- */
function allTimes() {
  const out = [];
  for (const d of sortedDays()) for (const t of (((day(d).evening || {}).training || {}).times || [])) out.push({ ...t, d });
  return out;
}
function fmtSec(s) { if (s == null) return '–'; if (s < 60) return s.toFixed(2); const m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`; }
function parseSec(txt) {
  const s = String(txt || '').trim().replace(',', '.');
  if (!s) return null;
  if (s.includes(':')) { const [m, sec] = s.split(':'); const v = Number(m) * 60 + Number(sec); return isNaN(v) ? null : v; }
  const v = Number(s); return isNaN(v) || v <= 0 ? null : v;
}
function bests(excludeDate) {
  const b = {};
  for (const t of allTimes()) { if (t.d === excludeDate) continue; if (!b[t.dist] || t.sec < b[t.dist].sec) b[t.dist] = t; }
  return b;
}
function speedCard(n) {
  const times = allTimes();
  if (!times.length) return `<div class="card"><h3>Speed</h3><p class="small muted">Add your rep and race times in the evening check-in (Training → Times). Your PBs and speed trend will show here.</p></div>`;
  const pb = bests(null);
  const dists = Object.keys(pb).map(Number).sort((a, b) => a - b);
  const counts = {}; times.forEach((t) => { counts[t.dist] = (counts[t.dist] || 0) + 1; });
  const pick = S.speedDist && pb[S.speedDist] ? S.speedDist : [...dists].sort((a, b) => counts[b] - counts[a] || (b === 400) - (a === 400))[0];
  const inRange = times.filter((t) => t.dist === pick && daysBetween(t.d, today()) < n);
  // Best time per day for the chosen distance
  const perDay = {}; inRange.forEach((t) => { perDay[t.d] = Math.min(perDay[t.d] || Infinity, t.sec); });
  const pts = seriesFor((d) => (perDay[d] != null ? perDay[d] : null), n);
  const vals = Object.values(perDay);
  const lo = vals.length ? Math.min(...vals) : 0, hi = vals.length ? Math.max(...vals) : 1;
  const pad2 = Math.max(0.3, (hi - lo) * 0.15);
  let html = `<div class="card"><h3>Speed · PBs</h3>
    <div class="pb-grid">${dists.map((d) => `<button class="pb ${d === pick ? 'on' : ''}" data-action="speeddist" data-value="${d}"><span>${d}m</span><b>${fmtSec(pb[d].sec)}</b><small>${fmtDay(pb[d].d, { day: 'numeric', month: 'short' })}</small></button>`).join('')}</div>`;
  if (vals.length >= 2) html += `${lineChart([{ pts, color: '#FF8A00' }], { min: Math.max(0, lo - pad2), max: hi + pad2, h: 130, smooth: 1, yfmt: (v) => fmtSec(v) })}${legend([['#FF8A00', `${pick}m best time each day (lower = faster)`]])}`;
  else html += `<p class="tiny" style="margin-top:8px">${vals.length ? 'One time logged in this range. The chart appears from two.' : `No ${pick}m times in this range.`}</p>`;
  return html + '</div>';
}

/* ---------- pain on trends ---------- */
function painCard(n) {
  const cut = addDays(today(), -(n - 1));
  const logs = painLogs().filter((l) => l.date >= cut);
  if (!logs.length) return `<div class="card"><h3>Pain hotspots</h3><p class="small muted">Nothing logged on the body map in this range.</p></div>`;
  const by = {};
  for (const l of logs) { const b = by[l.structure] || (by[l.structure] = { name: l.name, n: 0, sum: 0, recent: [], earlier: [] }); b.n++; b.sum += l.intensity; (daysBetween(l.date, today()) < 7 ? b.recent : b.earlier).push(l.intensity); }
  const top = Object.entries(by).sort((a, b) => b[1].sum - a[1].sum).slice(0, 4);
  const pick = S.painPick && by[S.painPick] ? S.painPick : top[0][0];
  // Chart: daily training load as faint bars, chosen structure's worst pain that day as dots (0–10)
  const W = 340, H = 140, P = { l: 20, r: 6, t: 8, b: 18 };
  const lp = seriesFor(load, n), maxL = Math.max(400, ...lp.map((p) => p.y || 0));
  const painDay = {}; logs.filter((l) => l.structure === pick).forEach((l) => { painDay[l.date] = Math.max(painDay[l.date] || 0, l.intensity); });
  const x = (i) => P.l + (i / Math.max(1, n - 1)) * (W - P.l - P.r);
  const y = (v) => P.t + (1 - v / 10) * (H - P.t - P.b);
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}">`;
  for (const g of [0, 5, 10]) svg += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(g)}" y2="${y(g)}" stroke="rgba(255,255,255,.07)"/><text x="${P.l - 5}" y="${y(g) + 3}" fill="#7D7487" font-size="9" text-anchor="end">${g}</text>`;
  const bw = Math.max(1, (W - P.l - P.r) / n - 1);
  lp.forEach((p, i) => { if (p.y) { const hh = (p.y / maxL) * (H - P.t - P.b); svg += `<rect x="${x(i) - bw / 2}" y="${H - P.b - hh}" width="${bw}" height="${hh}" fill="rgba(255,255,255,.09)" rx="1"/>`; } });
  let path = '', pen = false;
  lp.forEach((p, i) => { const v = painDay[p.d]; if (v == null) return; path += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; });
  if (path) svg += `<path d="${path}" fill="none" stroke="#FF3D5A" stroke-width="1.5" stroke-opacity=".6"/>`;
  lp.forEach((p, i) => { const v = painDay[p.d]; if (v != null) svg += `<circle cx="${x(i)}" cy="${y(v)}" r="3.5" fill="#FF3D5A"/>`; });
  svg += `<text x="${P.l}" y="${H - 4}" fill="#7D7487" font-size="9">${fmtDay(lp[0].d, { day: 'numeric', month: 'short' })}</text><text x="${W - P.r}" y="${H - 4}" fill="#7D7487" font-size="9" text-anchor="end">Today</text></svg>`;
  const trend = (b) => { if (!b.recent.length || !b.earlier.length) return ''; const dlt = avg(b.recent) - avg(b.earlier); return dlt > 0.5 ? '<span class="up">worse</span>' : dlt < -0.5 ? '<span class="down">easing</span>' : '<span>steady</span>'; };
  return `<div class="card"><h3>Pain hotspots</h3>
    ${top.map(([id, b]) => `<button class="hot ${id === pick ? 'on' : ''}" data-action="painpick" data-value="${esc(id)}"><span class="hot-name">${esc(b.name.charAt(0).toUpperCase() + b.name.slice(1))}</span><span class="hot-meta">${b.n}× · avg ${r1(b.sum / b.n)} ${trend(b)}</span></button>`).join('')}
    <div style="margin-top:10px">${svg}</div>${legend([['#FF3D5A', 'Pain that day (0–10)'], ['rgba(255,255,255,.25)', 'Training load']])}
    <button class="btn full" data-action="painbody" data-value="${esc(pick)}" style="margin-top:10px">Show on body map</button></div>`;
}

/* ---------- journal ---------- */
function viewJournal() {
  const items = [];
  for (const d of sortedDays().reverse()) { const e = day(d).evening; if (e && e.journal) items.push({ d, text: e.journal, priv: e.private }); }
  for (const w of Object.keys(S.data.weeks || {})) { const x = S.data.weeks[w]; if (x.qowAnswer) items.push({ d: w, text: x.qowAnswer, kind: 'Question of the week' }); }
  items.sort((a, b) => b.d.localeCompare(a.d));
  const qy = S.jq.toLowerCase();
  const shown = qy ? items.filter((i) => i.text.toLowerCase().includes(qy)) : items;
  let html = `<div class="top"><div><h1>Journal</h1><div class="sub">${items.length} entries</div></div></div>`;
  html += `<input class="field" data-action="search" placeholder="Search your journal" value="${esc(S.jq)}" style="margin-bottom:12px">`;
  html += `<div class="card">${shown.length ? shown.map((i) => `<div class="jentry"><div class="d">${fmtDay(i.d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}${i.kind ? ' · ' + i.kind : ''}${i.priv ? ' · private' : ''}</div><p>${esc(i.text)}</p></div>`).join('') : '<p class="small muted">Your evening journal entries will collect here.</p>'}</div>`;
  return html;
}

/* ---------- settings ---------- */
function viewSettings() {
  const push = LS.get('push', false);
  return `<div class="top"><div><h1>Settings</h1><div class="sub">Data: github.com/${CFG.owner}/${CFG.repo} (private)</div></div></div>
  <div class="card"><h3>Reminders</h3><p class="small muted" style="margin-bottom:12px">06:30 and 21:30, plus a nudge if you miss one. On iPhone this works once Kairos is on your Home Screen.</p>
    <button class="btn full" data-action="push">${push ? 'Reminders on · tap to refresh' : 'Turn on reminders'}</button></div>
  <div class="card"><h3>This device</h3>
    <input class="field" data-action="device" value="${esc(LS.get('device', guessDevice()))}" style="margin-bottom:10px">
    <button class="btn full" data-action="sync" style="margin-bottom:8px">Sync now</button>
    <button class="btn full" data-action="export" style="margin-bottom:8px">Download my data</button>
    <button class="btn full" data-action="lock">Lock this device (removes the key)</button></div>
  <p class="tiny">Kairos · ${S.dirty || S.painDirty ? 'unsynced changes on this device' : 'everything synced'}</p>
  <p class="tiny" style="margin-top:8px">Body map models: BodyParts3D, © The Database Center for Life Science, licensed under CC BY 4.0, simplified for mobile. Nerve paths and dermatomes are schematic. Kairos is a logging tool, not a diagnosis.</p>`;
}
function guessDevice() { return /iPhone|iPad/.test(navigator.userAgent) ? 'iphone' : 'laptop'; }
function urlB64(s) { const p = '='.repeat((4 - (s.length % 4)) % 4); const b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...b].map((c) => c.charCodeAt(0))); }
async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) { toast('Add Kairos to your Home Screen first, then open it from there.'); return; }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { toast('Notifications are blocked. Allow them in Settings.'); return; }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(CFG.vapid) });
  const dev = (LS.get('device', guessDevice()) || 'device').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const path = `push/${dev}.json`;
  const { sha } = await getWithSha(path).catch(() => ({ sha: null }));
  await putJson(path, { device: dev, subscription: sub.toJSON(), at: new Date().toISOString() }, sha, `Reminders on for ${dev}`);
  LS.set('push', true); toast('Reminders are on'); render();
}

/* ---------- events ---------- */
document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action, f = S.form;
  if (a === 'tab') { S.form = null; S.returnForm = null; S.tab = el.dataset.tab; render(); window.scrollTo(0, 0); }
  else if (a === 'bodylog') { S.returnForm = S.form; S.form = null; S.tab = 'body'; render(); window.scrollTo(0, 0); }
  else if (a === 'open') openForm(el.dataset.type, el.dataset.date);
  else if (a === 'close') { S.form = null; render(); }
  else if (a === 'pick') {
    const field = el.dataset.field, raw = el.dataset.value;
    f.values[field] = isNaN(Number(raw)) ? raw : Number(raw);
    f.pre.delete(field);
    el.parentElement.querySelectorAll('button').forEach((b) => b.className = '');
    el.className = 'on';
  } else if (a === 'toggle') {
    const field = el.dataset.field, v = el.dataset.value;
    const arr = f.values[field] || [];
    f.values[field] = arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
    el.classList.toggle('on');
  } else if (a === 'train') {
    const k = el.dataset.key, raw = el.dataset.value;
    f.values.training[k] = isNaN(Number(raw)) ? raw : Number(raw);
    if (k === 'type') render();
    else { el.parentElement.querySelectorAll('button').forEach((b) => b.classList.remove('on')); el.classList.add('on'); }
  } else if (a === 'phq') {
    f.values.phq[Number(el.dataset.i)] = Number(el.dataset.value);
    el.parentElement.querySelectorAll('button').forEach((b) => b.classList.remove('on')); el.classList.add('on');
  } else if (a === 'role') {
    f.values.roles[el.dataset.key] = Number(el.dataset.value);
    el.parentElement.querySelectorAll('button').forEach((b) => b.classList.remove('on')); el.classList.add('on');
  } else if (a === 'answer') {
    f.values.answers[el.dataset.id] = el.dataset.value;
    el.parentElement.querySelectorAll('button').forEach((b) => b.classList.remove('on')); el.classList.add('on');
  } else if (a === 'save') saveForm();
  else if (a === 'range') { S.range = Number(el.dataset.value); render(); }
  else if (a === 'speeddist') { S.speedDist = Number(el.dataset.value); render(); }
  else if (a === 'painpick') { S.painPick = el.dataset.value; render(); }
  else if (a === 'painbody') { bodyApi.focusStructure = el.dataset.value; S.tab = 'body'; render(); window.scrollTo(0, 0); }
  else if (a === 'tdist') { f.values._t.dist = Number(el.dataset.value); render(); const t = $('[data-action="ttime"]'); if (t) t.focus(); }
  else if (a === 'tkind') { f.values._t.kind = el.dataset.value; el.parentElement.querySelectorAll('button').forEach((b) => b.classList.remove('on')); el.classList.add('on'); }
  else if (a === 'tadd') {
    const d = f.values._t, sec = parseSec(d.txt), errEl = $('#t-err');
    if (!d.dist) { if (errEl) errEl.textContent = 'Pick a distance first.'; return; }
    if (sec == null) { if (errEl) errEl.textContent = 'Type a time like 23.41 or 1:05.4.'; return; }
    f.values.training.times = [...(f.values.training.times || []), { dist: d.dist, sec: Math.round(sec * 100) / 100, kind: d.kind }];
    d.txt = ''; render();
  } else if (a === 'tdel') { f.values.training.times.splice(Number(el.dataset.i), 1); render(); }
  else if (a === 'unlock') unlock();
  else if (a === 'push') enablePush().catch((e) => toast('Couldn’t turn on reminders: ' + e.message));
  else if (a === 'sync') { toast('Syncing…'); try { await loadAll(); render(); toast('Up to date'); } catch { toast('Couldn’t reach GitHub'); } }
  else if (a === 'export') {
    const blob = new Blob([JSON.stringify(S.data, null, 1)], { type: 'application/json' });
    const u = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = u; link.download = `kairos-${today()}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(u), 2000);
  } else if (a === 'lock') {
    if (confirm('Remove the key from this device? Your data stays safe on GitHub.')) { LS.del('token'); LS.del('data'); LS.del('sha'); S.token = null; render(); }
  }
});
document.addEventListener('input', (ev) => {
  const el = ev.target, a = el.dataset.action, f = S.form;
  if (a === 'slide') { const v = Number(el.value); f.values[el.dataset.field] = v; f.pre.delete(el.dataset.field); const o = $('#o-' + el.dataset.field); if (o) o.textContent = fmtHours(v); }
  else if (a === 'text') f.values[el.dataset.field] = el.value;
  else if (a === 'ttime') { f.values._t.txt = el.value; const e2 = $('#t-err'); if (e2) e2.textContent = ''; }
  else if (a === 'trainmin') { const n = parseInt(el.value, 10); f.values.training.minutes = isNaN(n) ? null : n; el.parentElement.querySelectorAll('button').forEach((b) => b.classList.remove('on')); }
  else if (a === 'answertext') f.values.answers[el.dataset.id] = el.value;
  else if (a === 'search') { S.jq = el.value; const pos = el.selectionStart; render(); const s = $('[data-action="search"]'); s.focus(); s.setSelectionRange(pos, pos); }
  else if (a === 'device') LS.set('device', el.value.trim());
});
document.addEventListener('change', (ev) => {
  const el = ev.target;
  if (el.dataset.action === 'check') S.form.values[el.dataset.field] = el.checked;
});

async function unlock() {
  const tok = ($('#tok').value || '').trim();
  const err = $('#tok-err');
  if (!tok) { err.textContent = 'Paste your key first.'; return; }
  S.token = tok;
  try {
    const r = await fetch(`https://api.github.com/repos/${CFG.owner}/${CFG.repo}`, { headers: { Authorization: `Bearer ${tok}` } });
    if (!r.ok) throw new Error(r.status === 401 ? 'That key wasn’t accepted.' : r.status === 404 ? 'That key can’t see the kairos-data repo.' : 'GitHub said ' + r.status);
    LS.set('token', tok);
    render(); toast('Unlocked'); await loadAll(); render();
  } catch (e) { S.token = null; err.textContent = e.message; }
}

/* ---------- boot ---------- */
window.addEventListener('online', () => { if (S.token) loadAll().then(render).catch(() => {}); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.token && !S.form) loadAll().then(render).catch(() => {}); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
render();
if (S.token) {
  loadAll().then(() => {
    render();
    const want = new URLSearchParams(location.search).get('open');
    if (want === 'morning' || want === 'evening') { const d = want === 'evening' ? eveningDay() : today(); if (!day(d)[want]) openForm(want, d); }
    if (want === 'weekly') openForm('weekly', weekKey(dow(today()) === 1 ? addDays(today(), -1) : today()));
    if (want) history.replaceState(null, '', location.pathname);
  }).catch(() => render());
}

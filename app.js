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

async function loadAll() {
  const t = today(), y = addDays(t, -1);
  const jobs = [
    pull().catch((e) => console.warn(e)),
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
  const s3 = lastN('sleepHours', 3, 'morning');
  if (s3.length === 3 && avg(s3) < 6) flags.push({ id: 'sleep', level: 'warn', title: 'Sleep debt building', text: `You’ve averaged ${r1(avg(s3))}h over the last 3 nights. Aim for an earlier night tonight.` });
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
  journal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M9 9h6M9 13h4"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
};
function tabs() {
  const t = (id, label) => `<button class="${S.tab === id && !S.form ? 'on' : ''}" data-action="tab" data-tab="${id}">${ICONS[id]}${label}</button>`;
  return `<nav class="tabs">${t('today', 'Today')}${t('trends', 'Trends')}${t('journal', 'Journal')}${t('settings', 'Settings')}</nav>`;
}
function render() {
  if (!S.token) { app().innerHTML = viewSetup(); return; }
  let body;
  if (S.form) body = viewForm();
  else if (S.tab === 'trends') body = viewTrends();
  else if (S.tab === 'journal') body = viewJournal();
  else if (S.tab === 'settings') body = viewSettings();
  else body = viewToday();
  app().innerHTML = `<div class="wrap">${body}</div>${tabs()}`;
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
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
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
  if (!d.morning && hour() < 15) ctas.push(cta('morning', t, 'Morning check-in', 'About 15 seconds'));
  if (!d.evening && hour() >= 17) ctas.push(cta('evening', t, 'Evening check-in', 'About 45 seconds'));
  if (isWeekend && !(S.data.weeks || {})[wk]) ctas.push(cta('weekly', wk, 'Sunday review', 'About 3 minutes'));
  parts.push(ctas.join(''));
  parts.push(`<div class="done-row">
    <button class="pill-done ${d.morning ? 'ok' : ''}" data-action="open" data-type="morning" data-date="${t}"><span class="dot"></span>Morning${d.morning ? '' : ''}</button>
    <button class="pill-done ${d.evening ? 'ok' : ''}" data-action="open" data-type="evening" data-date="${t}"><span class="dot"></span>Evening</button>
  </div>`);

  if (b.note) parts.push(`<div class="card"><p>${esc(b.note)}</p></div>`);

  for (const f of allFlags()) parts.push(`<div class="card flag ${f.level}"><div class="bar"></div><div><b>${esc(f.title)}</b><span class="small muted">${f.html ? f.text : esc(f.text)}</span></div></div>`);

  parts.push(`<div class="card"><h3>Your verse for this season</h3><div class="verse">“${esc(b.verse.text)}”</div><div class="verse-ref">${esc(b.verse.ref)}</div>${b.verse.why ? `<div class="verse-why">${esc(b.verse.why)}</div>` : ''}</div>`);

  const f = b.fact;
  parts.push(`<div class="card interrupt"><div class="kicker">${f.type === 'quote' ? 'Quote of the day' : 'Did you know?'}</div><p>${esc(f.text)}</p>${f.source ? `<div class="tiny" style="margin-top:6px">— ${esc(f.source)}</div>` : ''}</div>`);

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
    return `<button data-action="${multi ? 'toggle' : 'pick'}" data-field="${field}" data-value="${esc(o)}" class="${on ? 'on' : ''}">${esc(o)}</button>`;
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
    const h = S.health[date];
    if (type === 'evening' && h && h.workoutMinutes) {
      values.training = { type: null, minutes: Math.round(h.workoutMinutes), rpe: null, fromHealth: true };
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
    const h = S.health[f.date];
    if (h && h.workoutMinutes) html += `<div class="ctx">From Technogym / Apple Health: ${Math.round(h.workoutMinutes)} min${h.workoutType ? ` · ${esc(h.workoutType)}` : ''}${h.activeKcal ? ` · ${Math.round(h.activeKcal)} kcal` : ''}</div>`;
    html += q('Session', `<div class="chips" data-group="training.type">${['Rest', 'Speed', 'Speed endurance', 'Tempo', 'Gym', 'Technogym cardio', 'Recovery', 'Other'].map((o) => `<button data-action="train" data-key="type" data-value="${o}" class="${tr.type === o ? 'on' : ''}">${o}</button>`).join('')}</div>`);
    if (tr.type && tr.type !== 'Rest') {
      html += q('Minutes', `<div class="chips">${[30, 45, 60, 75, 90, 120].map((m) => `<button data-action="train" data-key="minutes" data-value="${m}" class="${tr.minutes === m ? 'on' : ''}">${m}</button>`).join('')}<input class="field" style="width:90px;padding:9px 12px" inputmode="numeric" placeholder="Other" data-action="trainmin" value="${tr.minutes && ![30, 45, 60, 75, 90, 120].includes(tr.minutes) ? tr.minutes : ''}"></div>`);
      html += q('How intense was it?', `<div class="scale" data-group="training.rpe">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<button data-action="train" data-key="rpe" data-value="${n}" class="${tr.rpe === n ? 'on' : ''}" style="min-height:42px">${n}</button>`).join('')}</div><div class="tiny" style="margin-top:6px">1 = barely working · 7 = hard · 10 = everything you had</div>`);
    }
    html += q('Soreness', `<div class="scale" data-group="training.soreness">${[1, 2, 3, 4, 5].map((n, i) => `<button data-action="train" data-key="soreness" data-value="${n}" class="${tr.soreness === n ? 'on' : ''}">${n}<small>${['None', '', '', '', 'Very'][i]}</small></button>`).join('')}</div>`);
    html += q('Any niggles?', `<input class="field" data-action="text" data-field="niggle" placeholder="Left hamstring tight" value="${esc(v.niggle || '')}">`, 'optional');
    html += `<div class="section-title">Today I…</div>`;
    html += q('', choice('ticks', ['Had quiet time', 'Prayed', 'Quality time with her', 'Ate well', 'Drank 2L water', 'Screens off before bed'], true));
    html += q('Study hours', choice('study', ['0', '1', '2', '3', '4', '5+']));
    html += questionsBlock('evening');
    html += `<div class="section-title">Journal</div>`;
    html += `<textarea data-action="text" data-field="journal" placeholder="Anything on your mind…">${esc(v.journal || '')}</textarea>
      <label class="toggle"><input type="checkbox" data-action="check" data-field="private" ${v.private ? 'checked' : ''}>Just for me — Claude won’t read this entry</label>`;
  }

  if (f.type === 'weekly') {
    const b = brief();
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
  if (v.study != null) v.studyHours = v.study === '5+' ? 5 : Number(v.study);
  if (f.type === 'evening' && v.training.type === 'Rest') v.training = { type: 'Rest', minutes: 0, rpe: 0, soreness: v.training.soreness || null };
  if (f.type === 'weekly') { v.phqTotal = phq(v); S.data.weeks[f.date] = v; }
  else { S.data.days[f.date] = S.data.days[f.date] || {}; S.data.days[f.date][f.type] = v; }
  S.dirty = true; persist();
  S.form = null; S.tab = 'today'; render(); window.scrollTo(0, 0);
  toast('Saved');
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
function lineChart(series, { min, max, h = 150, smooth = 7 } = {}) {
  const W = 340, H = h, P = { l: 22, r: 6, t: 8, b: 18 };
  const n = series[0].pts.length;
  const x = (i) => P.l + (i / Math.max(1, n - 1)) * (W - P.l - P.r);
  const y = (v) => P.t + (1 - (v - min) / (max - min)) * (H - P.t - P.b);
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">`;
  for (const g of [min, (min + max) / 2, max]) svg += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(g)}" y2="${y(g)}" stroke="rgba(255,255,255,.07)"/><text x="${P.l - 5}" y="${y(g) + 3}" fill="#7D7487" font-size="9" text-anchor="end">${r1(g)}</text>`;
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
    <div class="stat"><div class="k">Avg sleep</div><div class="v">${r1(avg(lastN('sleepHours', n, 'morning')))}h</div></div>
    <div class="stat"><div class="k">Load ratio</div><div class="v" style="color:${a == null ? 'inherit' : a > 1.5 ? 'var(--bad)' : a > 1.3 ? 'var(--warn)' : 'var(--good)'}">${a == null ? '–' : r1(a)}</div></div>
  </div>`;
  if (logged.length < 3) html += `<div class="card"><p class="muted small">Your graphs fill in as you log. Patterns start showing after about three weeks.</p></div>`;
  html += `<div class="card"><h3>Every day, coloured by mood</h3>${heatmap(n === 365 ? 364 : Math.max(n, 84))}</div>`;
  html += `<div class="card"><h3>Mind · 7-day average</h3>${lineChart([{ pts: seriesFor(ev('mood'), n), color: '#FF9A1F' }, { pts: seriesFor(ev('energy'), n), color: '#3DDC97' }, { pts: seriesFor(ev('stress'), n), color: '#FF3D5A' }, { pts: seriesFor(ev('anxiety'), n), color: '#9B8CFF' }], { min: 1, max: 5 })}${legend([['#FF9A1F', 'Mood'], ['#3DDC97', 'Energy'], ['#FF3D5A', 'Stress'], ['#9B8CFF', 'Anxiety']])}</div>`;
  html += `<div class="card"><h3>Sleep</h3>${lineChart([{ pts: seriesFor(mo('sleepHours'), n), color: '#7FB8FF' }], { min: 4, max: 10 })}${legend([['#7FB8FF', 'Hours slept']])}</div>`;
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
  <p class="tiny">Kairos · ${S.dirty ? 'unsynced changes on this device' : 'everything synced'}</p>`;
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
  if (a === 'tab') { S.form = null; S.tab = el.dataset.tab; render(); window.scrollTo(0, 0); }
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
    if (want === 'morning' || want === 'evening') { const d = today(); if (!day(d)[want]) openForm(want, d); }
    if (want === 'weekly') openForm('weekly', weekKey(dow(today()) === 1 ? addDays(today(), -1) : today()));
    if (want) history.replaceState(null, '', location.pathname);
  }).catch(() => render());
}

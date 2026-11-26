/* Hot Zone — app shell, search, routing and views. Data lives in /data (built by the pipeline). */
const APP_NAME = 'Hot Zone';
const f = C.f, esc = C.esc;
const state = { index: null, cache: {}, ui: {}, sheet: null };
const $main = () => document.getElementById('main');
const LG = { avg: 0.245, obp: 0.315, slg: 0.405, ops: 0.72, woba: 0.315, xwoba: 0.315, k: 0.225, bb: 0.085, ev: 88.5, era: 4.1 };
const TEAM = { atl: { name: 'Atlanta Braves', short: 'Braves', abbr: 'ATL' }, usm: { name: 'Southern Miss', short: 'Golden Eagles', abbr: 'USM' } };
const ui = (k, d) => (state.ui[k] ?? d);
const store = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ---------- formatting ----------
function fmtStat(key, side, v) {
  const m = (side === 'p' ? STATS.P : STATS.H)[key];
  if (v == null || v === '') return '—';
  const t = m ? m.fmt : 'n1';
  if (t === 'avg') return f.avg(+v);
  if (t === 'pct') return f.pct(+v);
  if (t === 'n2') return (+v).toFixed(2);
  if (t === 'n1') return (+v).toFixed(1);
  if (t === 'ip') { const o = Math.round(+v * 3); return `${Math.floor(o / 3)}.${o % 3}`; }
  return Math.round(+v).toString();
}
const encKey = (k) => k.replace(/%/g, 'pct').replace(/\+/g, 'plus').replace(/\//g, 'per').replace(/ /g, '').replace(/-/g, 'm');
function decKey(side, e) { const reg = side === 'p' ? STATS.P : STATS.H; return Object.keys(reg).find((k) => encKey(k) === e); }

// ---------- tooltip ----------
const tip = () => document.getElementById('tip');
window.showTip = (html, x, y) => {
  const t = tip(); t.innerHTML = html; t.classList.add('on');
  const w = t.offsetWidth, h = t.offsetHeight; let l = x + 14, tp = y + 14;
  if (l + w > innerWidth - 8) l = x - w - 14; if (tp + h > innerHeight - 8) tp = y - h - 14;
  t.style.left = Math.max(8, l) + 'px'; t.style.top = Math.max(8, tp) + 'px';
};
window.hideTip = () => tip().classList.remove('on');
document.addEventListener('pointermove', (e) => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) showTip(el.getAttribute('data-tip'), e.clientX, e.clientY); else if (!(e.target.closest && e.target.closest('svg .hit'))) hideTip(); });
document.addEventListener('pointerdown', (e) => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) showTip(el.getAttribute('data-tip'), e.clientX, e.clientY); });

// ---------- data ----------
async function getJSON(u) { const r = await fetch(u); if (!r.ok) throw new Error(`${u} (${r.status})`); return r.json(); }
async function index() { if (!state.index) state.index = await getJSON('data/index.json'); return state.index; }
async function player(id) { if (!state.cache[id]) state.cache[id] = await getJSON(`data/players/${id}.json`); return state.cache[id]; }
const byId = (id) => state.index.players.find((p) => p.id === id);
const qualified = (c, side) => { const m = STATS.MIN[c.team][side]; return side === 'h' ? (c.s['h.PA'] || 0) >= m : (c.s['p.IP'] || 0) >= m; };
function ranking(team, side, key, qualOnly = true) {
  const meta = (side === 'p' ? STATS.P : STATS.H)[key]; const k = side + '.' + key;
  let pool = state.index.players.filter((c) => c.team === team && c.s[k] != null);
  if (qualOnly && meta && meta.q) pool = pool.filter((c) => qualified(c, side));
  const dir = meta && meta.better === 'low' ? 1 : -1;
  return pool.sort((a, b) => dir * (a.s[k] - b.s[k]));
}
function rankOf(c, side, key) {
  const meta = (side === 'p' ? STATS.P : STATS.H)[key]; if (!meta || !meta.better) return null;
  if (meta.q && !qualified(c, side)) return { unq: true };
  const list = ranking(c.team, side, key); const i = list.findIndex((x) => x.id === c.id);
  return i < 0 ? null : { r: i + 1, of: list.length };
}
const ord = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');

// ---------- team mode ----------
// The whole site is in Braves mode or Southern Miss mode. Each side remembers its last page and scroll
// position in memory only, so a reload starts both sides fresh at their home page.
const MODE = { cur: 'atl', pos: { atl: { hash: '', y: 0 }, usm: { hash: '', y: 0 } } };
const teamOfHash = (h) => { const m = String(h).replace(/^#/, '').match(/^(?:team|p|lead)-(atl|usm)/); return m ? m[1] : null; };
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function setMode(t) {
  MODE.cur = t; document.documentElement.dataset.mode = t; store.set('hz-mode', t);
  document.querySelectorAll('.teamswitch [data-mode]').forEach((b) => { const on = b.dataset.mode === t; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
  const tt = document.getElementById('tabteam'); if (tt) tt.href = '#team-' + t;
  const meta = document.querySelector('meta[name=theme-color]'); if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
}
async function fadeOut() { const m = $main(); if (reduced()) return; m.classList.add('fading'); await wait(170); }
function fadeIn() { $main().classList.remove('fading'); }
async function switchMode(t) {
  if (t === MODE.cur) return;
  MODE.pos[MODE.cur] = { hash: location.hash.replace(/^#/, ''), y: scrollY };
  await fadeOut(); setMode(t);
  const target = MODE.pos[t]; state.restoreY = target.y;
  if (location.hash.replace(/^#/, '') === target.hash) route(); else location.hash = target.hash;
}
let scrollRAF = 0;
addEventListener('scroll', () => { if (scrollRAF) return; scrollRAF = requestAnimationFrame(() => { scrollRAF = 0; if (!state.restoring) MODE.pos[MODE.cur].y = scrollY; }); }, { passive: true });

// ---------- routing ----------
window.addEventListener('hashchange', () => route());
async function route(opt = {}) {
  hideTip(); closeSheet(); closePalette();
  const h = location.hash.replace(/^#\/?/, '');
  const ht = teamOfHash(h);
  if (ht && ht !== MODE.cur) { MODE.pos[MODE.cur].y = scrollY; await fadeOut(); setMode(ht); }
  let m;
  try {
    await index();
    document.body.className = 't-' + MODE.cur;
    if ((m = h.match(/^team-(atl|usm)$/))) await teamView(m[1]);
    else if ((m = h.match(/^p-((?:atl|usm)-[0-9a-z]+)(?:-s-([hp])-(.+))?$/))) await playerView(m[1], m[2], m[3]);
    else if ((m = h.match(/^lead(?:-(atl|usm)-([hp])-(.+))?$/))) leadersView(m[1] || MODE.cur, m[2] || 'h', m[3] ? decKey(m[2], m[3]) : null);
    else homeView();
  } catch (e) { $main().innerHTML = `<div class="empty">This page didn't load: ${esc(e.message)}. Check your connection and reload.</div>`; console.error(e); }
  MODE.pos[MODE.cur].hash = h;
  markNav(h);
  C.mount();
  if (state.restoreY != null) { state.restoring = true; const y = state.restoreY; state.restoreY = null; requestAnimationFrame(() => { scrollTo(0, y); MODE.pos[MODE.cur].y = y; state.restoring = false; }); }
  else if (!opt.keepScroll) scrollTo(0, 0);
  fadeIn();
  maybeTour();
}
function markNav(h) {
  const tab = h.startsWith('team-') ? 'team' : h.startsWith('lead') ? 'lead' : h.startsWith('p-') ? '' : 'home';
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === tab));
}

// ---------- shared pieces ----------
const av = (c, lg) => `<span class="av t-${c.team} ${lg ? 'lg' : ''}" aria-hidden="true">${esc(c.number ?? '')}</span>`;
const badge = (t, sm) => `<span class="badge t-${t} ${sm ? 'sm' : ''}" aria-hidden="true">${TEAM[t].abbr}</span>`;
function spark(vals, color, opt = {}) {
  const v = vals.map((x) => (x == null ? null : +x)); const ok = v.filter((x) => x != null);
  if (ok.length < 2) return '';
  const W = 140, H = opt.h || 30, lo = Math.min(...ok), hi = Math.max(...ok), r = hi - lo || 1;
  let d = '', pen = false;
  v.forEach((x, i) => { if (x == null) { pen = false; return; } const px = (i / (v.length - 1)) * W, py = H - 3 - ((x - lo) / r) * (H - 6); d += (pen ? 'L' : 'M') + px.toFixed(1) + ' ' + py.toFixed(1); pen = true; });
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
}
function chips(group, opts, cur) { return `<div class="chips" role="group">${opts.map(([v, l]) => `<button class="chip ${v === cur ? 'on' : ''}" data-chip="${group}" data-v="${esc(v)}" aria-pressed="${v === cur}">${esc(l)}</button>`).join('')}</div>`; }
const fig = (title, hint, body, cls = '') => `<div class="fig ${cls}"><h3>${title}</h3>${hint ? `<p class="hint">${hint}</p>` : ''}${body}</div>`;
function table(cols, rows, opt = {}) {
  return `<div class="tscroll" style="${opt.maxH ? 'max-height:' + opt.maxH + 'px' : ''}"><table class="tbl"><thead><tr>${cols.map((c) => `<th data-gloss="${esc(c.g || c.h)}">${esc(c.h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map((c) => { const v = c.f ? c.f(r) : r[c.k]; return `<td${c.cls ? ` class="${c.cls(r) || ''}"` : ''}>${v ?? '—'}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function section(id, title, desc, body) { return `<section class="sec" id="${id}" data-sec="${esc(title)}"><header><div><h2>${title}</h2>${desc ? `<p>${desc}</p>` : ''}</div></header>${body}</section>`; }

// ---------- HOME (one team's season highlights) ----------
const HOME = {
  atl: { sub: 'Every Braves hitter and pitcher from the 2026 season, down to the pitch. Search a player, a stat, or both at once.',
    ex: [['Olson barrel rate', 'olson barrel rate'], ['Sale spin', 'sale spin'], ['Acuña sprint speed', 'acuna sprint speed'], ['ERA', 'era'], ['Riley chase rate', 'riley chase'], ['Home runs', 'home runs']],
    leaders: [['h', 'HR'], ['h', 'AVG'], ['p', 'ERA'], ['p', 'K'], ['h', 'xwOBA'], ['p', 'Whiff%'], ['h', 'SprintSpeed'], ['p', 'Velo']], star: [['h', 'wRC+', 'wRC+'], ['p', 'WAR', 'WAR']] },
  usm: { sub: 'Every Golden Eagle from the 2026 season, built from all 61 box scores and the play-by-play. Search a player, a stat, or both at once.',
    ex: [['Urban OPS', 'urban ops'], ['Clark strikeout rate', 'clark strikeout rate'], ['Morrison home runs', 'morrison home runs'], ['First-pitch strike', 'first-pitch strike'], ['Walk rate', 'walk rate'], ['Harris ERA', 'harris era']],
    leaders: [['h', 'AVG'], ['h', 'HR'], ['p', 'ERA'], ['p', 'K'], ['h', 'OPS'], ['p', 'WHIP'], ['h', 'SB'], ['p', 'Strike%']], star: [['h', 'OPS+', 'OPS+'], ['p', 'FIP', 'FIP']] },
};
function teamHighlights(T) {
  const g = T.games.filter((x) => !x.gt || x.gt === 'R');
  let best = 0, run = 0, bestEnd = null;
  g.forEach((x, i) => { if (x.result === 'W') { run++; if (run > best) { best = run; bestEnd = i; } } else run = 0; });
  const big = g.reduce((a, x) => ((x.us - x.them) > (a ? a.us - a.them : -99) ? x : a), null);
  const rec = (xs) => `${xs.filter((x) => x.result === 'W').length}-${xs.filter((x) => x.result === 'L').length}`;
  const home = g.filter((x) => x.home && !x.neutral), away = g.filter((x) => !x.home && !x.neutral);
  const months = {}; g.forEach((x) => { const m = x.date.slice(0, 7); (months[m] = months[m] || []).push(x); });
  const runsFor = g.reduce((a, x) => a + (x.us || 0), 0), runsAg = g.reduce((a, x) => a + (x.them || 0), 0);
  const streakStart = bestEnd != null ? g[bestEnd - best + 1] : null;
  return { best, streakStart, streakEnd: bestEnd != null ? g[bestEnd] : null, big, home: rec(home), away: rec(away), months, runsFor, runsAg, games: g };
}
function homeView() {
  const t = MODE.cur, I = state.index, T = I.teams[t], H = HOME[t], hl = teamHighlights(T);
  let rd = 0; const rdv = hl.games.map((x) => (rd += (x.us ?? 0) - (x.them ?? 0)));
  const md = (d) => new Date(d + 'T12:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const mx = Math.max(...Object.values(hl.months).map((xs) => xs.length));
  const star = (side, key) => ranking(t, side, key)[0];
  const stars = [...H.star.map(([s, k]) => [s, k]), ['h', 'HR'], ['p', 'K']].map(([s, k]) => { const c = star(s, k); return c && { c, s, k }; }).filter(Boolean);
  $main().innerHTML = `
    <div class="homehero">
      <div class="homehead"><h1>Find any stat.</h1><a class="fullstats" href="#team-${t}">Full ${TEAM[t].short} stats <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a></div>
      <p>${esc(H.sub)}</p>
      <button class="bigfind" data-open-find>${ICON.search}<span>Search players and stats</span></button>
      <div class="suggest">${H.ex.map(([l, q]) => `<a class="pill" href="#" data-q="${esc(q)}">${esc(l)}</a>`).join('')}</div>
    </div>
    <a class="board t-${t}" href="#team-${t}" aria-label="${esc(T.name)} full stats">
      <div style="display:flex;gap:14px;align-items:center">${badge(t)}<div><div class="bname">${esc(T.name)}</div><div class="bsub">${esc(T.level)}, ${I.season} season${t === 'atl' ? `; ${esc(T.postseason)} in the postseason` : `; ${esc(T.conf_record)} in conference`}</div></div></div>
      <div class="brec">${esc(T.record)}</div>
      <div class="bspark">${spark(rdv, 'rgba(255,255,255,.85)', { h: 54 })}</div>
      <div class="last10">Last 10&nbsp; ${hl.games.slice(-10).map((x) => `<i style="background:${x.result === 'W' ? '#3ccf6a' : '#ff7a6b'}" title="${x.result} ${x.us}-${x.them}"></i>`).join('')}&nbsp; Run differential ${rd > 0 ? '+' : ''}${rd}</div></a>
    <h2 class="h2" style="margin-top:30px">Season highlights</h2><p class="lede">The 2026 season at a glance.</p>
    <div class="hl">
      <div class="hlcard"><div class="k">Longest win streak</div><div class="v">${hl.best} straight</div><div class="d">${hl.streakStart ? `${md(hl.streakStart.date)} to ${md(hl.streakEnd.date)}` : ''}</div></div>
      <div class="hlcard"><div class="k">Biggest win</div><div class="v">${hl.big ? `${hl.big.us}-${hl.big.them}` : '—'}</div><div class="d">${hl.big ? `${hl.big.home ? 'vs' : 'at'} ${esc(hl.big.opp)}, ${md(hl.big.date)}` : ''}</div></div>
      <div class="hlcard"><div class="k">Home / road</div><div class="v">${hl.home} / ${hl.away}</div><div class="d">${t === 'usm' ? 'Neutral-site games not counted' : 'Regular season'}</div></div>
      <div class="hlcard"><div class="k">Runs scored / allowed</div><div class="v">${hl.runsFor} / ${hl.runsAg}</div><div class="d">${(hl.runsFor / hl.games.length).toFixed(1)} scored per game</div></div>
      <div class="hlcard" style="grid-column:1 / -1;min-width:0"><div class="k">Wins by month</div><div class="months">${Object.entries(hl.months).map(([m, xs]) => { const w = xs.filter((x) => x.result === 'W').length; return `<div ${C.tipAttr(`<b>${new Date(m + '-15').toLocaleString('en-US', { month: 'long' })}</b><br>${w}-${xs.length - w}`)}><span class="num" style="font-size:15px;color:var(--ink)">${w}-${xs.length - w}</span><b style="height:${Math.max(4, (w / mx) * 80)}px"></b>${new Date(m + '-15').toLocaleString('en-US', { month: 'short' })}</div>`; }).join('')}</div></div>
    </div>
    <h2 class="h2">Standouts</h2><p class="lede">The team leaders in the stats that sum up a season.</p>
    <div class="standouts">${stars.map(({ c, s, k }) => `<a class="standout" href="#p-${c.id}-s-${s}-${encKey(k)}">${av(c, true)}<span class="n">${esc(c.name)}<small>${esc(c.pos || '')}</small></span><span class="v">${fmtStat(k, s, c.s[s + '.' + k])}<small>${esc((s === 'p' ? STATS.P : STATS.H)[k].label)}</small></span></a>`).join('')}</div>
    <h2 class="h2">Season leaders</h2><p class="lede">Swipe for more. Tap a name for the player, or a card title for the full list.</p>
    <div class="rail">${H.leaders.map(([s, k]) => leadCard(t, s, k)).join('')}</div>
    <div class="footer">${t === 'atl' ? 'Data from the MLB Stats API and Baseball Savant.' : 'Data from southernmiss.com box scores and play-by-play.'}<br>Updated ${esc(I.built.replace('T', ' ').replace('Z', ' UTC'))}</div>`;
}
function leadCard(t, s, k, n = 5) {
  const meta = (s === 'p' ? STATS.P : STATS.H)[k]; const list = ranking(t, s, k).slice(0, n);
  return `<div class="leadcard"><a class="lt" href="#lead-${t}-${s}-${encKey(k)}"><b>${esc(meta.label)}</b><span>${TEAM[t].short}</span></a>
    ${list.map((c, i) => `<a class="leadrow" href="#p-${c.id}">${av(c)}<span class="n">${esc(c.name)}<small>${esc(c.pos || '')}</small></span><span class="v">${fmtStat(k, s, c.s[s + '.' + k])}</span></a>`).join('')}</div>`;
}

// ---------- TEAM ----------
const COLS = {
  atl: { h: ['G', 'PA', 'AVG', 'OBP', 'SLG', 'HR', 'RBI', 'SB', 'wRC+', 'xwOBA', 'WAR'], p: ['G', 'GS', 'IP', 'ERA', 'FIP', 'WHIP', 'K', 'K%', 'SV', 'Whiff%', 'WAR'] },
  usm: { h: ['G', 'PA', 'AVG', 'OBP', 'SLG', 'HR', 'RBI', 'SB', 'OPS+', 'K%', 'BB%'], p: ['G', 'GS', 'IP', 'ERA', 'FIP', 'WHIP', 'K', 'K%', 'BB%', 'SV', 'Whiff%'] },
};
const HIDE_SM = new Set(['G', 'OBP', 'RBI', 'SB', 'xwOBA', 'WAR', 'GS', 'WHIP', 'K%', 'SV', 'Whiff%', 'BB%', 'OPS+', 'wRC+', 'FIP']);
async function teamView(t) {
  const I = state.index, T = I.teams[t];
  document.body.classList.add('t-' + t);
  const side = ui('tside-' + t, 'h');
  const sortKey = ui(`tsort-${t}-${side}`, side === 'h' ? 'PA' : 'IP'); const asc = ui(`tasc-${t}-${side}`, false);
  const pos = ui(`tpos-${t}-${side}`, 'All'); const q = ui(`tq-${t}`, '');
  let list = I.players.filter((c) => c.team === t && (side === 'p' ? c.role !== 'hitter' : c.role !== 'pitcher'));
  const posOpts = side === 'h' ? ['All', 'C', 'IF', 'OF', 'DH'] : ['All', 'Starters', 'Relievers'];
  const isIF = (p) => /^(1B|2B|3B|SS|INF|IF)/.test(p || ''); const isOF = (p) => /^(LF|CF|RF|OF)/.test(p || '');
  if (pos !== 'All') list = list.filter((c) => side === 'p' ? (pos === 'Starters' ? (c.s['p.GS'] || 0) >= 5 : (c.s['p.GS'] || 0) < 5) : pos === 'C' ? c.pos === 'C' : pos === 'IF' ? isIF(c.pos) : pos === 'OF' ? isOF(c.pos) : /DH/.test(c.pos || ''));
  if (q) list = list.filter((c) => norm(c.name).includes(norm(q)) || String(c.number) === q);
  const k = side + '.' + sortKey;
  list.sort((a, b) => { const x = a.s[k], y = b.s[k]; if (x == null) return 1; if (y == null) return -1; return asc ? x - y : y - x; });
  const games = T.games.filter((g) => !g.gt || g.gt === 'R'); let rd = 0; games.forEach((g) => (rd += (g.us ?? 0) - (g.them ?? 0)));
  const cols = COLS[t][side];
  const leadKeys = side === 'h' ? (t === 'atl' ? ['HR', 'AVG', 'xwOBA', 'SB'] : ['AVG', 'HR', 'OPS', 'SB']) : (t === 'atl' ? ['ERA', 'K', 'Whiff%', 'SV'] : ['ERA', 'K', 'WHIP', 'SV']);
  $main().innerHTML = `
    <div class="teamhead">${badge(t)}<div><h1>${esc(T.name)}</h1><div class="meta">${esc(T.level)}, ${I.season} season</div></div>
      <div class="scoreline"><div><b>${esc(T.record)}</b><span>Record</span></div>${t === 'atl' ? `<div><b>${esc(T.postseason)}</b><span>Postseason</span></div>` : `<div><b>${esc(T.conf_record)}</b><span>Conference</span></div>`}<div><b>${rd > 0 ? '+' : ''}${rd}</b><span>Run differential</span></div></div></div>
    <div class="rail" style="margin-bottom:22px">${leadKeys.map((lk) => leadCard(t, side, lk, 3)).join('')}</div>
    <div class="toolbar">
      <div class="seg" role="tablist">${[['h', 'Hitters'], ['p', 'Pitchers']].map(([v, l]) => `<button role="tab" class="${side === v ? 'on' : ''}" data-tside="${v}" aria-selected="${side === v}">${l}</button>`).join('')}</div>
      <div class="chips" style="margin:0">${posOpts.map((o) => `<button class="chip ${o === pos ? 'on' : ''}" data-tpos="${o}">${o}</button>`).join('')}</div>
      <input class="filter" id="tq" placeholder="Filter by name or number" value="${esc(q)}" autocomplete="off">
    </div>
    <div class="tablewrap"><table class="roster"><thead><tr><th data-sort="Name">Player</th>${cols.map((c) => `<th data-sort="${esc(c)}" class="${c === sortKey ? 'on' + (asc ? ' asc' : '') : ''} ${HIDE_SM.has(c) ? 'hide-sm' : ''}" title="${esc(((side === 'p' ? STATS.P : STATS.H)[c] || {}).label || c)}">${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${list.map((c) => `<tr data-go="#p-${c.id}"><td><span class="who">${av(c)}<span>${esc(c.name)}<small>${esc(c.pos || '')}, ${esc(c.bats || '?')}/${esc(c.throws || '?')}${c.class_short ? ', ' + esc(c.class_short) : ''}</small></span></span></td>${cols.map((col) => `<td class="${col === sortKey ? 'sorted' : ''} ${HIDE_SM.has(col) ? 'hide-sm' : ''}">${fmtStat(col, side, c.s[side + '.' + col])}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length + 1}" class="empty">No players match. Clear the filter to see everyone.</td></tr>`}</tbody></table></div>
    <p class="note">Tap a column to sort; tap again to flip. On phones, swipe the table sideways for more columns.</p>`;
  const rr = () => { teamView(t); C.mount(); };
  $main().querySelectorAll('[data-tside]').forEach((b) => (b.onclick = () => { state.ui['tside-' + t] = b.dataset.tside; rr(); }));
  $main().querySelectorAll('[data-tpos]').forEach((b) => (b.onclick = () => { state.ui[`tpos-${t}-${side}`] = b.dataset.tpos; rr(); }));
  $main().querySelectorAll('[data-sort]').forEach((th) => (th.onclick = () => { const s = th.dataset.sort; if (s === 'Name') return; if (s === sortKey) state.ui[`tasc-${t}-${side}`] = !asc; else { state.ui[`tsort-${t}-${side}`] = s; state.ui[`tasc-${t}-${side}`] = ['ERA', 'FIP', 'WHIP', 'BB%', 'K%'].includes(s) && side === 'p' ? s !== 'K%' : false; } rr(); }));
  $main().querySelectorAll('[data-go]').forEach((tr) => (tr.onclick = () => (location.hash = tr.dataset.go)));
  const inp = document.getElementById('tq'); inp.oninput = () => { state.ui[`tq-${t}`] = inp.value; const pos0 = inp.selectionStart; rr(); const n = document.getElementById('tq'); n.focus(); n.setSelectionRange(pos0, pos0); };
}

// ---------- LEADERS ----------
function leadersView(t, side, key) {
  const reg = side === 'p' ? STATS.P : STATS.H;
  key = key || (side === 'p' ? 'ERA' : 'HR');
  if (!reg[key]) key = side === 'p' ? 'ERA' : 'HR';
  const meta = reg[key];
  const qual = ui('lead-q', true);
  const list = ranking(t, side, key, qual);
  const max = Math.max(...list.map((c) => Math.abs(c.s[side + '.' + key] || 0)), 1e-9);
  const avail = Object.keys(reg).filter((k) => state.index.players.some((c) => c.team === t && c.s[side + '.' + k] != null));
  if (!avail.includes(key)) avail.unshift(key);
  const g = window.gloss(meta.g || key);
  $main().innerHTML = `
    <div class="homehero" style="padding-bottom:12px"><h1 style="font-size:clamp(34px,6vw,56px)">${esc(meta.label)} leaders</h1><p style="margin:-4px 0 8px;color:var(--ink-3)">${esc(TEAM[t].name)}</p><p>${esc(g ? g[1] : '')}</p></div>
    <div class="toolbar">
      <div class="seg">${[['h', 'Hitting'], ['p', 'Pitching']].map(([v, l]) => `<button class="${v === side ? 'on' : ''}" data-ls="${v}">${l}</button>`).join('')}</div>
      <select id="lstat" aria-label="Choose a stat" style="height:42px;border-radius:12px;background:var(--panel);color:var(--ink);border:1px solid var(--rule);padding:0 12px;font:inherit">${avail.map((k) => `<option value="${esc(k)}" ${k === key ? 'selected' : ''}>${esc(reg[k].label)}</option>`).join('')}</select>
      ${meta.q ? `<button class="chip ${qual ? 'on' : ''}" data-lq>${qual ? `Qualified only (${STATS.MIN[t][side]}+ ${side === 'h' ? 'PA' : 'IP'})` : 'Showing everyone'}</button>` : ''}
    </div>
    <div style="display:grid;gap:2px;margin-top:8px">${list.map((c, i) => { const v = c.s[side + '.' + key]; return `<a class="leadrow" href="#p-${c.id}-s-${side}-${encKey(key)}" style="grid-template-columns:34px 34px minmax(0,1fr) minmax(70px,30%) 70px;padding:8px 4px">
      <span class="num" style="color:var(--ink-3);font-size:18px">${i + 1}</span>${av(c)}<span class="n">${esc(c.name)}<small>${esc(c.pos || '')}</small></span>
      <span style="height:10px;background:var(--panel);border-radius:5px;overflow:hidden"><span style="display:block;height:100%;width:${(Math.abs(v) / max) * 100}%;background:${i === 0 ? 'var(--amber)' : 'var(--s1)'};border-radius:5px"></span></span>
      <span class="v" style="text-align:right">${fmtStat(key, side, v)}</span></a>`; }).join('') || `<div class="empty">${state.index.players.some((c) => c.team === t && c.s[side + '.' + key] != null) ? 'Nobody qualifies yet. Turn off "Qualified only" to see everyone.' : esc(TEAM[t].name) + ' doesn\u2019t track this stat. Switch teams at the top to see it for the other side.'}</div>`}</div>`;
  const go = (tt, ss, kk) => (location.hash = `lead-${tt}-${ss}-${encKey(kk)}`);
  $main().querySelectorAll('[data-ls]').forEach((b) => (b.onclick = () => { const r2 = b.dataset.ls === 'p' ? STATS.P : STATS.H; go(t, b.dataset.ls, r2[key] && state.index.players.some((c) => c.team === t && c.s[b.dataset.ls + '.' + key] != null) ? key : (b.dataset.ls === 'p' ? 'ERA' : 'HR')); }));
  document.getElementById('lstat').onchange = (e) => go(t, side, e.target.value);
  const lq = $main().querySelector('[data-lq]'); if (lq) lq.onclick = () => { state.ui['lead-q'] = !qual; leadersView(t, side, key); };
}

// ---------- PLAYER ----------
const KEYS = { atl: { h: ['AVG', 'OBP', 'SLG', 'HR', 'wRC+', 'xwOBA', 'Barrel%', 'K%', 'WAR'], p: ['ERA', 'FIP', 'IP', 'K', 'K%', 'Whiff%', 'WHIP', 'xwOBA', 'Velo'] },
  usm: { h: ['AVG', 'OBP', 'SLG', 'HR', 'OPS+', 'wOBA', 'K%', 'BB%', 'Whiff%'], p: ['ERA', 'FIP', 'IP', 'K', 'K%', 'BB%', 'WHIP', 'Strike%', 'Whiff%'] } };
function series(p, side, trend) {
  const B = side === 'p' ? p.pitching : p.hitting; if (!B || !trend) return null;
  const rows = B.cumulative || []; if (!rows.length || !(trend in rows[rows.length - 1])) return null;
  return { labels: rows.map((r) => r.date), values: rows.map((r) => r[trend]) };
}
async function playerView(id, openSide, openKey) {
  const p = await player(id); const c = byId(id);
  document.body.classList.add('t-' + p.team);
  const recent = store.get('hz-recent', []).filter((x) => x !== id); recent.unshift(id); store.set('hz-recent', recent.slice(0, 8));
  const both = p.hitting && p.pitching;
  const side = openSide || (both ? ui('side-' + id, p.role === 'pitcher' ? 'p' : 'h') : p.pitching && (p.role === 'pitcher' || !p.hitting) ? 'p' : 'h');
  const keys = KEYS[p.team][side];
  const reg = side === 'p' ? STATS.P : STATS.H;
  const keyHTML = keys.filter((k) => c.s[side + '.' + k] != null).map((k) => {
    const rk = rankOf(c, side, k), ser = series(p, side, reg[k].trend);
    return `<button class="key" data-stat="${side}:${esc(k)}"><span class="kl">${esc(reg[k].label)}</span><span class="kv">${fmtStat(k, side, c.s[side + '.' + k])}</span>
      <span class="kr">${rk && rk.r ? `<b>${ord(rk.r)}</b> of ${rk.of} on the team` : rk && rk.unq ? 'Not enough playing time to rank' : '&nbsp;'}</span>${ser ? spark(ser.values, C.v('--amber')) : '<svg aria-hidden="true"></svg>'}</button>`;
  }).join('');
  const facts = p.team === 'atl'
    ? [['Bats/throws', `${p.bats}/${p.throws}`], ['Age', p.age], ['Height', p.height], ['Weight', p.weight ? p.weight + ' lb' : null], ['Born', p.birthplace], ['MLB debut', p.debut]]
    : [['Bats/throws', `${p.bats || '?'}/${p.throws || '?'}`], ['Class', p.class], ['Height', p.height], ['Weight', p.weight ? p.weight + ' lb' : null], ['Hometown', p.hometown], ['Before', p.previous_school]];
  const secs = buildSections(p, side);
  $main().innerHTML = `
    <div class="jersey t-${p.team}">
      <div><a class="teamlink" href="#team-${p.team}">${badge(p.team, true)} ${esc(TEAM[p.team].name)}</a>
        <h1>${esc(p.name)}</h1><div class="role">${esc(p.pos_name || p.pos || '')}${p.team === 'usm' ? ', Southern Miss' : ''}${p.status && p.status !== 'Active' ? ` (${esc(p.status)})` : ''}</div>
        <div class="facts">${facts.filter(([, v]) => v).map(([k, v]) => `<div><span>${esc(k)}</span>${esc(v)}</div>`).join('')}</div></div>
      <div class="back"><div class="ln">${esc(p.last)}</div><div class="no">${esc(p.number ?? '')}</div></div>
    </div>
    ${both ? `<div class="seg sidetoggle">${[['h', 'Hitting'], ['p', 'Pitching']].map(([v, l]) => `<button class="${side === v ? 'on' : ''}" data-pside="${v}">${l}</button>`).join('')}</div>` : ''}
    <div class="keys">${keyHTML}</div>
    <nav class="index" aria-label="Sections">${secs.map((s) => `<a href="#${s.id}" data-jump="${s.id}">${esc(s.nav)}</a>`).join('')}</nav>
    <div id="secs">${secs.map((s) => s.html).join('')}</div>`;
  $main().querySelectorAll('[data-pside]').forEach((b) => (b.onclick = () => { state.ui['side-' + id] = b.dataset.pside; if (location.hash === `#p-${id}`) route({ keepScroll: true }); else location.hash = `p-${id}`; }));
  bindPlayer(p, side);
  if (openKey) { const k = decKey(openSide, openKey); if (k) setTimeout(() => openStat(id, openSide, k), 60); }
}
function bindPlayer(p, side) {
  const root = $main();
  root.querySelectorAll('[data-jump]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); document.getElementById(a.dataset.jump).scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  // scrollspy
  const links = [...root.querySelectorAll('[data-jump]')];
  if (state.spy) state.spy.disconnect();
  state.spy = new IntersectionObserver((ents) => { ents.forEach((en) => { if (en.isIntersecting) links.forEach((l) => { const on = l.dataset.jump === en.target.id; l.classList.toggle('on', on); if (on) l.scrollIntoView({ block: 'nearest', inline: 'center' }); }); }); }, { rootMargin: '-45% 0px -50% 0px' });
  root.querySelectorAll('section.sec').forEach((s) => state.spy.observe(s));
  // per-section re-render for chips/toggles
  root.querySelectorAll('[data-chip]').forEach((b) => (b.onclick = () => { state.ui[b.dataset.chip] = b.dataset.v; rerenderSection(p, side, b.closest('section').id); }));
  root.querySelectorAll('[data-pt-toggle]').forEach((b) => (b.onclick = () => { const off = new Set((state.ui['pt-off'] || '').split(',').filter(Boolean)); const v = b.dataset.ptToggle; off.has(v) ? off.delete(v) : off.add(v); state.ui['pt-off'] = [...off].join(','); rerenderSection(p, side, b.closest('section').id); }));
  root.querySelectorAll('[data-spray]').forEach((b) => (b.onclick = () => { const s = new Set(ui('spray-show', '1B,2B,3B,HR,Out').split(',')); s.has(b.dataset.spray) ? s.delete(b.dataset.spray) : s.add(b.dataset.spray); state.ui['spray-show'] = [...s].join(','); rerenderSection(p, side, b.closest('section').id); }));
  const sf = document.getElementById('statfind');
  if (sf) sf.oninput = () => filterStats(sf.value);
}
function rerenderSection(p, side, sid) {
  const s = buildSections(p, side).find((x) => x.id === sid); if (!s) return;
  const old = document.getElementById(sid); const tmp = document.createElement('div'); tmp.innerHTML = s.html; old.replaceWith(tmp.firstElementChild);
  bindPlayer(p, side); C.mount();
}

// stat list items (tappable when the stat is in the registry)
function statRows(side, rows) {
  const reg = side === 'p' ? STATS.P : STATS.H;
  return `<div class="stats">${rows.filter((r) => r && r[1] != null && r[1] !== '—').map(([label, val, key]) => {
    const k = key && reg[key] ? key : null;
    return `<button class="stat" ${k ? `data-stat="${side}:${esc(k)}"` : `data-gloss="${esc(key || label)}"`} data-name="${esc(norm(label + ' ' + (key || '')))}"><span class="sl">${esc(label)}</span><span class="sv">${val}</span></button>`;
  }).join('')}</div>`;
}
function filterStats(q) {
  const n = norm(q).trim(); let shown = 0;
  document.querySelectorAll('#s-all .stat').forEach((el) => { const hit = !n || el.dataset.name.includes(n); el.style.display = hit ? '' : 'none'; if (hit) shown++; });
  document.querySelectorAll('#s-all .statgroup').forEach((g) => { const any = [...g.querySelectorAll('.stat')].some((e) => e.style.display !== 'none'); g.style.display = any ? '' : 'none'; if (g.tagName === 'DETAILS') g.open = !!n && any; });
  const e = document.getElementById('statnone'); if (e) e.style.display = shown ? 'none' : '';
}

// ===== sections =====
function buildSections(p, side) {
  const S = [];
  const add = (id, nav, title, desc, body) => S.push({ id, nav, html: section(id, title, desc, body) });
  if (p.team === 'atl' && side === 'h') atlHit(p, add);
  else if (p.team === 'atl') atlPit(p, add);
  else if (side === 'h') usmHit(p, add);
  else usmPit(p, add);
  add('s-splits', 'Splits', 'Splits', p.team === 'atl' ? 'Lefties vs. righties, home vs. road, runners on and more.' : 'Handedness and innings come from play-by-play; the rest from box scores.', splits(p, side));
  add('s-games', 'Game log', 'Game log', 'Every game, newest first.', gamelog(p, side));
  add('s-all', 'All stats', 'Every stat', 'Type to find one. Tap any stat for its definition, team rank and season trend.', allStats(p, side));
  return S;
}
const ZONE_M = [['xwoba', 'xwOBA', 0.315, 0.15, f.avg], ['ba', 'AVG', 0.245, 0.15, f.avg], ['slg', 'SLG', 0.405, 0.3, f.avg], ['swing', 'Swing rate', 0.47, 0.35, (v) => f.pct(v, 0)], ['whiff', 'Whiff rate', 0.25, 0.25, (v) => f.pct(v, 0)], ['pct', 'Share of pitches', 0, 0, (v) => f.pct(v, 0)]];
function zoneFig(zones, keyName, side, title, hint, metrics = ZONE_M) {
  const cur = ui(keyName, 'xwoba'); const m = metrics.find((z) => z[0] === cur) || metrics[0];
  return fig(title, hint + (m[0] === 'pct' ? ' Darker = more pitches.' : ' Red = higher than MLB average, blue = lower.'), chips(keyName, metrics.map((z) => [z[0], z[1]]), m[0]) + C.zoneMap(zones, { key: m[0], mid: m[2], span: m[3], fmt: m[4], seq: m[0] === 'pct', side, minN: m[0] === 'pct' ? 1 : 8 }));
}
const HEAT_H = [['pitches', 'Pitches seen'], ['swings', 'Swings'], ['whiffs', 'Whiff rate'], ['hard_hit', 'Hard hits'], ['hits', 'Hits']];
function percentiles(p, type) {
  const pc = p.percentiles[type];
  if (!pc) return '<p class="hint">Savant percentile ranks only exist for players with enough playing time to qualify.</p>';
  const H = (p.hitting && p.hitting.statcast) || {}, P = (p.pitching && p.pitching.statcast) || {};
  const rows = type === 'batting'
    ? [['xwOBA', 'xwoba', f.avg(H.xwoba), 'xwOBA'], ['xBA', 'xba', f.avg(H.xba), 'xBA'], ['xSLG', 'xslg', f.avg(H.xslg), 'xSLG'], ['Exit velo', 'exit_velocity', H.avg_ev, 'EV'], ['Barrel rate', 'brl_percent', f.pct(H.barrel_pct), 'Barrel%'], ['Hard-hit rate', 'hard_hit_percent', f.pct(H.hard_hit_pct), 'HardHit%'],
      ['Bat speed', 'bat_speed', p.bat_tracking_lb ? f.n1(p.bat_tracking_lb.avg_bat_speed) : null, 'BatSpeed'], ['Chase rate', 'chase_percent', f.pct(H.chase_pct), 'Chase%'], ['Whiff rate', 'whiff_percent', f.pct(H.whiff_pct), 'Whiff%'], ['K rate', 'k_percent', f.pct(H.k_pct), 'K%'], ['BB rate', 'bb_percent', f.pct(H.bb_pct), 'BB%'],
      ['Sprint speed', 'sprint_speed', p.running.sprint ? f.n1(p.running.sprint.sprint_speed) : null, 'SprintSpeed'], ['Outs above avg', 'oaa', p.fielding.oaa ? p.fielding.oaa.outs_above_average : null, 'OAA'], ['Arm strength', 'arm_strength', p.fielding.arm ? f.n1(p.fielding.arm.arm_overall) : null, null]]
    : [['xERA', 'xera', null, null], ['xwOBA', 'xwoba', f.avg(P.xwoba), 'xwOBA'], ['xBA', 'xba', f.avg(P.xba), 'xBA'], ['FB velo', 'fb_velocity', null, 'Velo'], ['FB spin', 'fb_spin', null, null], ['Curve spin', 'curve_spin', null, null], ['Exit velo', 'exit_velocity', P.avg_ev, 'EV'],
      ['Barrel rate', 'brl_percent', f.pct(P.barrel_pct), 'Barrel%'], ['Hard-hit rate', 'hard_hit_percent', f.pct(P.hard_hit_pct), 'HardHit%'], ['Chase rate', 'chase_percent', f.pct(P.chase_pct), 'Chase%'], ['Whiff rate', 'whiff_percent', f.pct(P.whiff_pct), 'Whiff%'], ['K rate', 'k_percent', f.pct(P.k_pct), 'K%'], ['BB rate', 'bb_percent', f.pct(P.bb_pct), 'BB%']];
  const side = type === 'batting' ? 'h' : 'p';
  return rows.map(([l, k, raw, sk]) => { const v = pc[k]; if (v == null) return ''; const pct = Math.round(v); const col = C.div((pct - 50) / 50);
    return `<button class="pct" ${sk ? `data-stat="${side}:${esc(sk)}"` : ''}><span class="k">${esc(l)}</span><span class="track"><span class="fill" style="width:${pct}%;background:${col}"></span><span class="dot" style="left:${Math.max(4, Math.min(96, pct))}%;background:${col};color:${C.textOn(col)}">${pct}</span></span><span class="raw">${raw ?? ''}</span></button>`; }).join('') +
    `<p class="note">Rank against every qualified MLB ${type === 'batting' ? 'hitter' : 'pitcher'}; 100 is best. Red means good, blue means poor, already flipped so a low chase rate shows red.</p>`;
}
const resLeg = () => `<div class="legend">${[['single', 'Single'], ['double', 'Double'], ['triple', 'Triple'], ['home_run', 'Home run'], ['field_out', 'Out']].map(([e, l]) => `<span><span class="sw" style="background:${C.resultColor(e)}"></span>${l}</span>`).join('')}</div>`;

function atlHit(p, add) {
  const h = p.hitting, sc = h.statcast || {}, s = h.season;
  add('s-summary', 'Summary', 'How he stacks up', 'Percentile ranks from Baseball Savant, plus his season line.', `<div class="viz">
    ${fig('Percentile ranks', '', percentiles(p, 'batting'))}
    ${fig('Season line', '', statRows('h', [['Games', s.gamesPlayed, 'G'], ['Plate appearances', s.plateAppearances, 'PA'], ['Hits', s.hits, 'H'], ['Doubles', s.doubles, '2B'], ['Home runs', s.homeRuns, 'HR'], ['Runs batted in', s.rbi, 'RBI'], ['Runs', s.runs, 'R'], ['Walks', s.baseOnBalls, 'BB'], ['Strikeouts', s.strikeOuts, 'K'], ['Stolen bases', s.stolenBases, 'SB'], ['Batting average', f.avg(s.avg), 'AVG'], ['On-base %', f.avg(s.obp), 'OBP'], ['Slugging %', f.avg(s.slg), 'SLG'], ['OPS', f.avg(s.ops), 'OPS'], ['wRC+', f.n0((h.sabermetrics || {}).wRcPlus), 'wRC+'], ['WAR', f.n1((h.sabermetrics || {}).war), 'WAR']]))}</div>`);
  if (!h.statcast) return;
  add('s-zone', 'Strike zone', 'Strike zone', 'Where pitchers attacked him and what happened, from catcher’s view.', `<div class="viz swipe">
    ${zoneFig(h.zones, 'zm-h', p.bats, 'Hot and cold zones', 'Results in each of the 13 Statcast zones.')}
    ${(() => { const cur = ui('hm-h', 'pitches'); return fig('Pitch locations', 'Every pitch he saw. Switch to see where he swings, misses and hits it hard.', chips('hm-h', HEAT_H, cur) + C.heat(h.heat, { mat: cur, rateOf: cur === 'whiffs' ? 'swings' : null, szTop: p.sz_top || 3.4, szBot: p.sz_bot || 1.6, label: cur.replace('_', ' ') })); })()}
    ${fig('Count by count', 'wOBA in plate appearances that ended in each count. Red = he did damage.', C.countGrid((b, st) => { const d = h.counts[b + '-' + st]; return d && { n: d.pa_end, v: d.woba, tip: `${d.pa_end} PAs ended here<br>wOBA ${f.avg(d.woba)}, swing ${f.pct(d.swing)}, whiff ${f.pct(d.whiff)}` }; }, { fmt: f.avg }))}</div>`);
  const show = new Set(ui('spray-show', '1B,2B,3B,HR,Out').split(','));
  const evla = (h.spray || []).map(([x, y, ev, la, e, bt, dt]) => ({ x: la, y: ev, c: C.resultColor(e), o: ['single', 'double', 'triple', 'home_run'].includes(e) ? 0.9 : 0.35, tip: `<b>${(e || '').replace(/_/g, ' ')}</b>, ${dt}<br>${ev} mph at ${la}°` }));
  const vpt = (h.vs_pitch_type || []).filter((x) => x.n >= 40);
  add('s-contact', 'Batted balls', 'Batted balls', `All ${h.spray.length} balls he put in play, tracked by Statcast.`, `<div class="viz swipe">
    ${fig('Spray chart', 'Tap a dot for exit velocity, launch angle and distance.', `<div class="chips">${['1B', '2B', '3B', 'HR', 'Out'].map((k) => `<button class="chip ${show.has(k) ? 'on' : ''}" data-spray="${k}">${k === 'Out' ? 'Outs' : k}</button>`).join('')}</div>` + resLeg() + C.spray(h.spray, { show }))}
    ${fig('Exit velocity vs. launch angle', 'The shaded band is the 8°–32° sweet spot; above the dashed line is 95+ mph.', resLeg() + C.scatter({ pts: evla, xr: [-60, 80], yr: [40, 120], xl: 'Launch angle (°)', yl: 'Exit velocity (mph)', bands: [{ x0: 8, x1: 32, label: 'sweet spot' }], guides: [{ y: 95, label: '95 mph' }] }))}
    ${fig('Against each pitch type', 'Expected wOBA (min 40 pitches). Longer bar = more damage.', C.bars(vpt.map((x) => ({ k: x.name, v: x.xwoba, d: f.avg(x.xwoba), c: C.ptColor(x.type), sw: C.ptColor(x.type), tip: `<b>${esc(x.name)}</b><br>${x.n} seen (${f.pct(x.usage)})<br>AVG ${f.avg(x.ba)}, SLG ${f.avg(x.slg)}, whiff ${f.pct(x.whiff_pct)}` })), { max: 0.6, lw: 120 }))}
    ${fig('Contact quality', '', statRows('h', [['Avg exit velocity', sc.avg_ev, 'EV'], ['Max exit velocity', sc.max_ev, 'maxEV'], ['Barrel rate', f.pct(sc.barrel_pct), 'Barrel%'], ['Hard-hit rate', f.pct(sc.hard_hit_pct), 'HardHit%'], ['Sweet-spot rate', f.pct(sc.sweet_spot_pct), 'SweetSpot%'], ['Avg launch angle', sc.avg_la, 'LA'], ['Ground-ball rate', f.pct(sc.gb_pct), 'GB%'], ['Fly-ball rate', f.pct(sc.fb_pct), 'FB%'], ['Pull rate', f.pct(sc.pull_pct), 'Pull%'], ['Expected AVG', f.avg(sc.xba), 'xBA'], ['Expected SLG', f.avg(sc.xslg), 'xSLG'], ['Expected wOBA', f.avg(sc.xwoba), 'xwOBA']]))}</div>`);
  const RM = { ops: ['OPS', f.avg, LG.ops], xwoba: ['xwOBA', f.avg, LG.xwoba], avg: ['AVG', f.avg, LG.avg], k_pct: ['K rate', (v) => f.pct(v), LG.k], bb_pct: ['BB rate', (v) => f.pct(v), LG.bb], avg_ev: ['Exit velo', f.n1, LG.ev], hard_hit_pct: ['Hard-hit rate', (v) => f.pct(v), 0.4] };
  const rm = ui('roll-h', 'ops'); const roll = h.rolling_15g || [], cum = h.cumulative || [];
  add('s-trend', 'Trends', 'How his season moved', 'Hot streaks, slumps and how the slash line settled.', `<div class="viz wide">
    ${fig('Rolling 15 games', 'Each point adds up his last 15 games. Dashed line = MLB average.', chips('roll-h', Object.entries(RM).map(([k, v]) => [k, v[0]]), rm) + C.line({ series: [{ name: RM[rm][0], color: C.v('--amber'), values: roll.map((r) => r[rm]) }], labels: roll.map((r) => r.date), fmt: RM[rm][1], ref: RM[rm][2], refLabel: 'MLB avg' }))}
    ${fig('Season to date', 'AVG, OBP and SLG after every game.', C.line({ series: [{ name: 'AVG', color: C.series(0), values: cum.map((r) => r.avg) }, { name: 'OBP', color: C.series(1), values: cum.map((r) => r.obp) }, { name: 'SLG', color: C.series(2), values: cum.map((r) => r.slg) }], labels: cum.map((r) => r.date), fmt: f.avg }))}</div>`);
}
function atlPit(p, add) {
  const P = p.pitching, s = P.season, sc = P.statcast || {};
  const arsCols = [{ h: 'Pitch', f: (a) => `<span class="sw" style="background:${C.ptColor(a.type)}"></span>${esc(a.name)}` }, { h: 'Usage', f: (a) => f.pct(a.usage) }, { h: 'Velo', k: 'velo' }, { h: 'Max', g: 'Velo', k: 'velo_max' }, { h: 'Spin', k: 'spin' }, { h: 'IVB', k: 'ivb' }, { h: 'HB', k: 'hb' }, { h: 'Ext', k: 'extension' }, { h: 'Whiff%', f: (a) => f.pct(a.whiff_pct) }, { h: 'CSW%', f: (a) => f.pct(a.csw_pct) }, { h: 'Chase%', f: (a) => f.pct(a.chase_pct) }, { h: 'Putaway%', f: (a) => f.pct(a.putaway_pct) }, { h: 'AVG', f: (a) => f.avg(a.ba) }, { h: 'xwOBA', f: (a) => f.avg(a.xwoba) }, { h: 'RV/100', k: 'rv_per_100' }];
  add('s-summary', 'Summary', 'How he stacks up', 'Percentile ranks from Baseball Savant, plus his season line.', `<div class="viz">
    ${fig('Percentile ranks', '', percentiles(p, 'pitching'))}
    ${fig('Season line', '', statRows('p', [['Games', s.gamesPlayed, 'G'], ['Starts', s.gamesStarted, 'GS'], ['Innings', s.inningsPitched, 'IP'], ['Wins', s.wins, 'W'], ['Losses', s.losses, 'L'], ['Saves', s.saves, 'SV'], ['ERA', f.n2(s.era), 'ERA'], ['FIP', f.n2((P.sabermetrics || {}).fip), 'FIP'], ['WHIP', f.n2(s.whip), 'WHIP'], ['Strikeouts', s.strikeOuts, 'K'], ['Walks', s.baseOnBalls, 'BB'], ['Home runs', s.homeRuns, 'HR'], ['K per 9', f.n2(s.strikeoutsPer9Inn), 'K/9'], ['Opponent AVG', f.avg(s.avg), 'OPP AVG'], ['WAR', f.n1((P.sabermetrics || {}).war), 'WAR']]))}</div>`);
  if (!P.statcast) return;
  const off = new Set((state.ui['pt-off'] || '').split(',').filter(Boolean));
  const legend = `<div class="legend">${(P.arsenal || []).map((a) => `<button class="${off.has(a.type) ? 'off' : ''}" data-pt-toggle="${a.type}"><span class="sw" style="background:${C.ptColor(a.type)}"></span>${esc(a.name)}</button>`).join('')}</div>`;
  const mv = (P.movement || []).filter((m) => !off.has(m[0])).map(([t, hb, ivb, v]) => ({ x: hb, y: ivb, c: C.ptColor(t), o: 0.5, r: 2.6, tip: `<b>${C.PT_NAMES[t] || t}</b> ${v} mph<br>${hb} in sideways, ${ivb} in rise` }));
  const cents = (P.arsenal || []).filter((a) => !off.has(a.type) && a.hb != null).map((a) => ({ x: a.hb, y: a.ivb, c: C.ptColor(a.type), label: a.type, tip: `<b>${esc(a.name)} average</b><br>${a.velo} mph, ${a.spin} rpm` }));
  const rel = (P.release || []).filter((m) => !off.has(m[0])).map(([t, x, z]) => ({ x, y: z, c: C.ptColor(t), o: 0.55, r: 2.6, tip: `<b>${C.PT_NAMES[t] || t}</b><br>${x} ft side, ${z} ft high` }));
  const types = (P.arsenal || []).map((a) => a.type);
  const vsR = Object.fromEntries((P.arsenal_vs.vs_RHB || []).map((x) => [x.type, x.usage])), vsL = Object.fromEntries((P.arsenal_vs.vs_LHB || []).map((x) => [x.type, x.usage]));
  add('s-arsenal', 'Arsenal', 'His arsenal', 'Every pitch type: speed, spin, movement and results.', `<div class="viz wide">${fig('Pitch by pitch type', 'Tap a column name for what it means.', table(arsCols, P.arsenal))}</div><div class="viz swipe" style="margin-top:14px">
    ${fig('Movement', 'Catcher’s view, gravity removed. Up = "rise", sideways = run or sweep. Tap a pitch name to hide or show it.', legend + C.scatter({ pts: mv, centroids: cents, xr: [-25, 25], yr: [-25, 25], xl: 'Horizontal break (in)', yl: 'Induced vertical break (in)', guides: [{ x: 0 }, { y: 0 }], height: 360 }))}
    ${fig('Mix vs. righties and lefties', 'How often he throws each pitch to each side.', C.bars(types.flatMap((t) => [{ k: `${t} vs RHB`, v: vsR[t] || 0, d: f.pct(vsR[t] || 0), c: C.ptColor(t), sw: C.ptColor(t) }, { k: `${t} vs LHB`, v: vsL[t] || 0, d: f.pct(vsL[t] || 0), c: C.ptColor(t) }]), { max: 1, lw: 96 }))}
    ${fig('Release point', 'Where the ball leaves his hand. A tight cluster means a repeatable delivery.', legend + C.scatter({ pts: rel, xr: [-4.5, 4.5], yr: [3, 7.5], xl: 'Side (ft)', yl: 'Height (ft)', guides: [{ x: 0 }] }))}</div>`);
  const lt = ui('loc-type', 'ALL'); const locH = lt === 'ALL' ? P.heat : { ...P.heat, pitches: P.heat_by_type[lt] };
  const ZP = ZONE_M.filter((z) => ['xwoba', 'ba', 'whiff', 'swing', 'pct'].includes(z[0]));
  add('s-zone', 'Location', 'Where he throws it', 'Catcher’s view of every pitch, and what hitters did in each zone.', `<div class="viz swipe">
    ${fig('Pitch locations', 'Pick a pitch type to see how he locates it.', chips('loc-type', [['ALL', 'All'], ...Object.keys(P.heat_by_type || {}).map((t) => [t, t])], lt) + C.heat(locH, { mat: 'pitches', szTop: 3.4, szBot: 1.6, label: 'pitches' }))}
    ${zoneFig(P.zones, 'zm-p', null, 'Results by zone', 'What hitters did against him in each zone.', ZP)}
    ${fig('Count by count', 'Opponent wOBA in plate appearances that ended in each count. Blue = he won it.', C.countGrid((b, st) => { const d = P.counts[b + '-' + st]; return d && { n: d.pa_end, v: d.woba, tip: `${d.pa_end} PAs ended here<br>wOBA ${f.avg(d.woba)}, ${d.k} strikeouts` }; }, { fmt: f.avg }))}
    ${fig('Balls in play against him', `${P.spray_allowed.length} batted balls.`, resLeg() + C.spray(P.spray_allowed))}</div>`);
  const gl = (P.gamelog || []).filter((g) => g.gt === 'R' && g.sc);
  const top = (P.arsenal || []).filter((a) => a.usage >= 0.08).slice(0, 4).map((a) => a.type);
  const RM = { erafip: ['ERA and FIP', [['era', 'ERA'], ['fip', 'FIP']], f.n2, LG.era], kbb: ['K and BB rate', [['k_pct', 'K rate'], ['bb_pct', 'BB rate']], (v) => f.pct(v), null], whiff: ['Whiff and CSW', [['whiff_pct', 'Whiff rate'], ['csw_pct', 'CSW']], (v) => f.pct(v), null], xwoba: ['xwOBA allowed', [['xwoba', 'xwOBA']], f.avg, LG.xwoba] };
  const rm = ui('roll-p', 'erafip'); const rows = P.rolling.rows;
  add('s-trend', 'Trends', 'How his season moved', 'Velocity outing by outing, and rolling results.', `<div class="viz wide">
    ${fig('Velocity by outing', 'Average speed of his main pitches each game.', C.line({ series: top.map((t) => ({ name: C.PT_NAMES[t] || t, color: C.ptColor(t), values: gl.map((g) => g.sc.velo[t] ?? null) })), labels: gl.map((g) => g.date), fmt: (v) => v.toFixed(1), extra: (i) => `<br>vs ${esc(gl[i].opp)}, ${gl[i].inningsPitched} IP, ${gl[i].sc.pitches} pitches` }))}
    ${fig(`Rolling ${P.rolling.window_games} outings`, `Each point adds up his last ${P.rolling.window_games} appearances.`, chips('roll-p', Object.entries(RM).map(([k, v]) => [k, v[0]]), rm) + C.line({ series: RM[rm][1].map(([k, l], i) => ({ name: l, color: i ? C.series(1) : C.v('--amber'), values: rows.map((r) => r[k]) })), labels: rows.map((r) => r.date), fmt: RM[rm][2], ref: RM[rm][3], refLabel: RM[rm][3] ? 'MLB avg' : '' }))}</div>`);
}
const RES_NAMES = { K_S: 'Strikeout swinging', K_L: 'Strikeout looking', K: 'Strikeout', BB: 'Walk', IBB: 'Intentional walk', HBP: 'Hit by pitch', '1B': 'Single', '2B': 'Double', '3B': 'Triple', HR: 'Home run', GO: 'Ground out', GIDP: 'Double play', FO: 'Fly out', LO: 'Line out', PO: 'Pop out', FL: 'Foul out', SF: 'Sacrifice fly', SH: 'Sacrifice bunt', FC: "Fielder's choice", ROE: 'Reached on error', CI: 'Catcher interference' };
function resultsBars(res, pitcher) {
  const tot = Object.values(res || {}).reduce((a, b) => a + b, 0) || 1; const good = new Set(['1B', '2B', '3B', 'HR', 'BB', 'IBB', 'HBP', 'ROE']);
  return C.bars(Object.entries(res || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ k: RES_NAMES[k] || k, v, d: `${v} (${f.pct(v / tot, 0)})`, c: good.has(k) !== pitcher ? 'var(--amber)' : 'var(--ink-3)' })), { lw: 140 }) + `<p class="note">Amber = good for the ${pitcher ? 'pitcher' : 'hitter'}.</p>`;
}
const usmNote = (p) => `<p class="note">${(p.notes || []).map(esc).join(' ')}</p>`;
const pitchMix = (o) => C.bars([['Balls', o.balls, 'var(--ink-3)'], ['Called strikes', o.called_strikes, 'var(--s4)'], ['Swinging strikes', o.swinging_strikes, 'var(--s8)'], ['Fouls', o.fouls, 'var(--s3)'], ['Put in play', o.in_play, 'var(--s1)']].map(([k, v, c]) => ({ k, v, d: `${v} (${f.pct(v / o.pitches, 0)})`, c })), { lw: 130 });
function usmHit(p, add) {
  const h = p.hitting, s = h.season, pd = h.plate_discipline, sp = h.spray, d = h.direction || {}, af = pd.after_first_pitch || {};
  add('s-summary', 'Summary', 'Season line', 'Totals and rates from all 61 box scores.', `<div class="viz">
    ${fig('Hitting', '', statRows('h', [['Games', s.G, 'G'], ['Plate appearances', s.PA, 'PA'], ['Hits', s.H, 'H'], ['Doubles', s['2B'], '2B'], ['Triples', s['3B'], '3B'], ['Home runs', s.HR, 'HR'], ['Runs batted in', s.RBI, 'RBI'], ['Runs', s.R, 'R'], ['Walks', s.BB, 'BB'], ['Strikeouts', s.K, 'K'], ['Stolen bases', s.SB, 'SB'], ['Batting average', f.avg(s.AVG), 'AVG'], ['On-base %', f.avg(s.OBP), 'OBP'], ['Slugging %', f.avg(s.SLG), 'SLG'], ['OPS', f.avg(s.OPS), 'OPS'], ['OPS+ (team = 100)', f.n0(s['OPS+']), 'OPS+'], ['wOBA', f.avg(s.wOBA), 'wOBA'], ['Isolated power', f.avg(s.ISO), 'ISO']]))}
    ${fig('How his plate appearances ended', '', resultsBars(h.results, false))}</div>`);
  add('s-spray', 'Spray', 'Where he hits it', `Built from the play-by-play wording of ${sp.located} balls in play.`, `<div class="viz swipe">
    ${fig('Spray zones', 'Darker = more balls in play. Tap a zone for hits and extra-base hits.', C.wedgeSpray(sp))}
    ${fig('Batted-ball mix', '', statRows('h', [['Ground-ball rate', f.pct(sp.gb_pct), 'GB%'], ['Line-drive rate', f.pct(sp.ld_pct), 'LD%'], ['Fly-ball rate', f.pct(sp.fb_pct), 'FB%'], ['Pop-up rate', f.pct(sp.pu_pct), 'PU%'], ['Pull rate', f.pct(d.pull_pct), 'Pull%'], ['Center', f.pct(d.center_pct), 'Pull%'], ['Opposite field', f.pct(d.oppo_pct), 'Oppo%']]))}</div>`);
  add('s-approach', 'Approach', 'At-bat approach', `From the scorer’s ball-and-strike sequences (${f.pct(pd.coverage, 0)} of his plate appearances).`, `<div class="viz swipe">
    ${fig('Count by count', 'wOBA in plate appearances that ended in each count.', C.countGrid((b, st) => { const x = h.counts_pa_ended[b + '-' + st]; return x && { n: x.PA, v: x.wOBA, tip: `${x.PA} PA<br>AVG ${f.avg(x.AVG)}, OBP ${f.avg(x.OBP)}, SLG ${f.avg(x.SLG)}` }; }, { fmt: f.avg }))}
    ${fig('After the first pitch', 'wOBA after getting ahead 1-0, falling behind 0-1, or swinging at pitch one.', C.bars([['first_pitch_in_play', 'First pitch in play'], ['1-0', 'After 1-0'], ['0-1', 'After 0-1']].filter(([k]) => af[k]).map(([k, l], i) => ({ k: l, v: af[k].wOBA, d: f.avg(af[k].wOBA), c: [C.series(0), 'var(--amber)', C.series(1)][i], tip: `<b>${l}</b><br>${af[k].PA} PA, AVG ${f.avg(af[k].AVG)}, OBP ${f.avg(af[k].OBP)}, SLG ${f.avg(af[k].SLG)}` })), { max: 0.7, lw: 140 }))}
    ${fig('Pitches he saw', `${pd.pitches} pitches tracked.`, pitchMix(pd))}
    ${fig('Discipline', '', statRows('h', [['Pitches per PA', pd.pitches_per_pa, 'P/PA'], ['Swing rate', f.pct(pd.swing_pct), 'Swing%'], ['Whiff rate', f.pct(pd.whiff_pct), 'Whiff%'], ['Contact rate', f.pct(pd.contact_pct), 'Contact%'], ['First-pitch swing rate', f.pct(pd.first_pitch_swing_pct), '1st Swing%'], ['Strikeout rate', f.pct(s['K%']), 'K%'], ['Walk rate', f.pct(s['BB%']), 'BB%'], ['Full-count PAs', pd.full_count_pa, 'PA'], ['7+ pitch PAs', pd.long_pa_7plus, 'P/PA']]))}</div>`);
  const roll = h.rolling_10g, cum = h.cumulative; const rm = ui('roll-u', 'ops'); const T = state.index.teams.usm.hitting;
  const RM = { ops: ['OPS', f.avg, T.OPS], woba: ['wOBA', f.avg, T.wOBA], avg: ['AVG', f.avg, T.AVG], k_pct: ['K rate', (v) => f.pct(v), T['K%']], bb_pct: ['BB rate', (v) => f.pct(v), T['BB%']] };
  add('s-trend', 'Trends', 'How his season moved', 'Dashed line = Southern Miss team average.', `<div class="viz wide">
    ${fig('Rolling 10 games', '', chips('roll-u', Object.entries(RM).map(([k, v]) => [k, v[0]]), rm) + C.line({ series: [{ name: RM[rm][0], color: C.v('--amber'), values: roll.map((r) => r[rm]) }], labels: roll.map((r) => r.date), fmt: RM[rm][1], ref: RM[rm][2], refLabel: 'team avg' }))}
    ${fig('Season to date', 'AVG, OBP and SLG after every game.', C.line({ series: [{ name: 'AVG', color: C.series(0), values: cum.map((r) => r.avg) }, { name: 'OBP', color: C.series(1), values: cum.map((r) => r.obp) }, { name: 'SLG', color: C.series(2), values: cum.map((r) => r.slg) }], labels: cum.map((r) => r.date), fmt: f.avg }))}</div>${usmNote(p)}`);
}
function usmPit(p, add) {
  const P = p.pitching, s = P.season, ps = P.pitch_sequence, af = ps.after_first_pitch || {};
  add('s-summary', 'Summary', 'Season line', 'Totals and rates from all 61 box scores.', `<div class="viz">
    ${fig('Pitching', '', statRows('p', [['Games', s.APP, 'G'], ['Starts', s.GS, 'GS'], ['Innings', s.IP, 'IP'], ['Wins', s.W, 'W'], ['Losses', s.L, 'L'], ['Saves', s.SV, 'SV'], ['ERA', f.n2(s.ERA), 'ERA'], ['FIP', f.n2(s.FIP), 'FIP'], ['WHIP', f.n2(s.WHIP), 'WHIP'], ['Strikeouts', s.K, 'K'], ['Walks', s.BB, 'BB'], ['Home runs', s.HR, 'HR'], ['K per 9', f.n2(s['K/9']), 'K/9'], ['BB per 9', f.n2(s['BB/9']), 'BB/9'], ['Strikeout rate', f.pct(s['K%']), 'K%'], ['Walk rate', f.pct(s['BB%']), 'BB%'], ['K% minus BB%', f.pct(s['K-BB%']), 'K-BB%'], ['Opponent AVG', f.avg(s.OPP_AVG), 'OPP AVG']]))}
    ${fig('How batters’ plate appearances ended', '', resultsBars(P.results, true))}</div>`);
  add('s-approach', 'Pitching', 'How he attacks hitters', `From the scorer’s ball-and-strike sequences (${f.pct(ps.coverage, 0)} coverage).`, `<div class="viz swipe">
    ${fig('Count by count', 'Opponent wOBA in plate appearances that ended in each count. Blue = he won it.', C.countGrid((b, st) => { const x = P.counts_pa_ended[b + '-' + st]; return x && { n: x.PA, v: x.wOBA, tip: `${x.PA} PA<br>AVG ${f.avg(x.AVG)}, ${x.K} K, ${x.BB} BB` }; }, { fmt: f.avg }))}
    ${fig('Winning the first pitch', 'Opponent wOBA after he got ahead 0-1 vs. fell behind 1-0. Lower is better.', C.bars([['0-1', 'After 0-1'], ['1-0', 'After 1-0'], ['first_pitch_in_play', 'First pitch in play']].filter(([k]) => af[k]).map(([k, l], i) => ({ k: l, v: af[k].wOBA, d: f.avg(af[k].wOBA), c: ['var(--amber)', C.series(1), C.series(0)][i], tip: `<b>${l}</b><br>${af[k].PA} PA, AVG ${f.avg(af[k].AVG)}, K rate ${f.pct(af[k]['K%'])}` })), { max: 0.7, lw: 140 }))}
    ${fig('What his pitches became', `${ps.pitches} pitches tracked.`, pitchMix(ps))}
    ${fig('Where batters hit it', `${P.spray_allowed.located} balls in play.`, C.wedgeSpray(P.spray_allowed))}</div>`);
  const rows = P.rolling.rows, gl = P.gamelog; const rm = ui('roll-up', 'erafip');
  const RM = { erafip: ['ERA and FIP', [['era', 'ERA'], ['fip', 'FIP']], f.n2], kbb: ['K and BB rate', [['k_pct', 'K rate'], ['bb_pct', 'BB rate']], (v) => f.pct(v)], whip: ['WHIP', [['whip', 'WHIP']], f.n2], ppi: ['Pitches per inning', [['pitches_per_ip', 'Pitches/inning']], f.n1] };
  add('s-trend', 'Trends', 'How his season moved', '', `<div class="viz wide">
    ${fig(`Rolling ${P.rolling.window_games} outings`, '', chips('roll-up', Object.entries(RM).map(([k, v]) => [k, v[0]]), rm) + C.line({ series: RM[rm][1].map(([k, l], i) => ({ name: l, color: i ? C.series(1) : C.v('--amber'), values: rows.map((r) => r[k]) })), labels: rows.map((r) => r.date), fmt: RM[rm][2] }))}
    ${fig('Workload', 'Pitches thrown each outing.', C.line({ series: [{ name: 'Pitches', color: C.series(0), values: gl.map((g) => g.pitches) }], labels: gl.map((g) => g.date), fmt: (v) => Math.round(v), extra: (i) => `<br>vs ${esc(gl[i].opp)}, ${gl[i].IP} IP, ${gl[i].K} K, ${gl[i].ER} ER` }))}</div>${usmNote(p)}`);
}

// ===== splits / game log / all stats =====
function splits(p, side) {
  if (p.team === 'atl') {
    const B = side === 'h' ? p.hitting : p.pitching; const S = B.splits || {};
    const rows = ['vl', 'vr', 'h', 'a', 'd', 'n', 'risp', 'ron', 'r0', 'lc', 'e'].filter((k) => S[k]).map((k) => ({ split: S[k].label, ...S[k] }));
    const cols = side === 'h'
      ? [{ h: 'Split', k: 'split' }, { h: 'PA', k: 'plateAppearances' }, { h: 'AVG', f: (r) => f.avg(r.avg) }, { h: 'OBP', f: (r) => f.avg(r.obp) }, { h: 'SLG', f: (r) => f.avg(r.slg) }, { h: 'OPS', f: (r) => f.avg(r.ops) }, { h: 'HR', k: 'homeRuns' }, { h: 'RBI', k: 'rbi' }, { h: 'BB', k: 'baseOnBalls' }, { h: 'K', k: 'strikeOuts' }]
      : [{ h: 'Split', k: 'split' }, { h: 'BF', k: 'battersFaced' }, { h: 'IP', k: 'inningsPitched' }, { h: 'ERA', f: (r) => f.n2(r.era) }, { h: 'OPP AVG', f: (r) => f.avg(r.avg) }, { h: 'OBP', f: (r) => f.avg(r.obp) }, { h: 'SLG', f: (r) => f.avg(r.slg) }, { h: 'K', k: 'strikeOuts' }, { h: 'BB', k: 'baseOnBalls' }, { h: 'HR', k: 'homeRuns' }];
    const mcols = [{ h: 'Month', f: (r) => new Date(2026, (r.month || 1) - 1, 1).toLocaleString('en-US', { month: 'long' }) }, ...cols.slice(1)];
    return `<div class="viz wide">${fig('Situations', '', table(cols, rows))}${fig('By month', '', table(mcols, B.months || []))}</div>`;
  }
  const mo = (m) => new Date(2026, +m - 1, 1).toLocaleString('en-US', { month: 'long' });
  if (side === 'h') {
    const S = p.hitting.splits;
    const rows = [['vs. right-handed pitchers', S.vs_RHP], ['vs. left-handed pitchers', S.vs_LHP], ['Home', S.home], ['Away', S.away], ['Neutral site', S.neutral], ['Conference', S.conference], ['Non-conference', S.non_conference],
      ...Object.entries(S.by_inning_group).map(([k, v]) => ['Innings ' + k, v]), ...Object.entries(S.by_month).map(([m, v]) => [mo(m), v]), ...Object.entries(S.by_lineup_spot).map(([k, v]) => [`Batting ${ord(+k)}`, v])].filter(([, v]) => v && v.PA).map(([split, v]) => ({ split, ...v }));
    return `<div class="viz wide">${fig('Splits', '', table([{ h: 'Split', k: 'split' }, { h: 'PA', k: 'PA' }, { h: 'H', k: 'H' }, { h: 'HR', k: 'HR' }, { h: 'BB', k: 'BB' }, { h: 'K', k: 'K' }, { h: 'AVG', f: (r) => f.avg(r.AVG) }, { h: 'OBP', f: (r) => f.avg(r.OBP) }, { h: 'SLG', f: (r) => f.avg(r.SLG) }, { h: 'wOBA', f: (r) => f.avg(r.wOBA) }, { h: 'K%', f: (r) => f.pct(r['K%']) }, { h: 'BB%', f: (r) => f.pct(r['BB%']) }], rows))}</div>`;
  }
  const S = p.pitching.splits;
  const prow = [['As a starter', S.as_starter], ['As a reliever', S.as_reliever], ['Home', S.home], ['Away', S.away], ['Conference', S.conference], ['Non-conference', S.non_conference], ...Object.entries(S.by_month).map(([m, v]) => [mo(m), v])].filter(([, v]) => v && v.APP).map(([split, v]) => ({ split, ...v }));
  const hrow = [['vs. right-handed batters', S.vs_RHB], ['vs. left-handed batters', S.vs_LHB], ...Object.entries(S.by_inning_group).map(([k, v]) => ['Innings ' + k, v])].filter(([, v]) => v && v.PA).map(([split, v]) => ({ split, ...v }));
  return `<div class="viz wide">${fig('Box-score splits', '', table([{ h: 'Split', k: 'split' }, { h: 'G', k: 'APP' }, { h: 'IP', k: 'IP' }, { h: 'ERA', f: (r) => f.n2(r.ERA) }, { h: 'WHIP', f: (r) => f.n2(r.WHIP) }, { h: 'K', k: 'K' }, { h: 'BB', k: 'BB' }, { h: 'K%', f: (r) => f.pct(r['K%']) }, { h: 'OPP AVG', f: (r) => f.avg(r.OPP_AVG) }, { h: 'FIP', f: (r) => f.n2(r.FIP) }], prow))}
    ${fig('Opponents (play-by-play)', '', table([{ h: 'Split', k: 'split' }, { h: 'PA', g: 'BF', k: 'PA' }, { h: 'AVG', f: (r) => f.avg(r.AVG) }, { h: 'OBP', f: (r) => f.avg(r.OBP) }, { h: 'SLG', f: (r) => f.avg(r.SLG) }, { h: 'wOBA', f: (r) => f.avg(r.wOBA) }, { h: 'K%', f: (r) => f.pct(r['K%']) }, { h: 'BB%', f: (r) => f.pct(r['BB%']) }], hrow))}</div>`;
}
const opp = (r) => (r.home && !r.neutral ? 'vs ' : r.neutral ? 'vs ' : '@ ') + esc(r.opp);
function gamelog(p, side) {
  if (p.team === 'atl') {
    if (side === 'h') return fig('Game by game', 'Postseason games are marked P. xwOBA and max exit velo are from Statcast.', table([
      { h: 'Date', f: (r) => r.date.slice(5) + (r.gt === 'P' ? ' P' : '') }, { h: 'Opponent', f: opp }, { h: 'Result', f: (r) => (r.win ? 'W' : 'L'), cls: (r) => (r.win ? 'w' : 'l') },
      { h: 'AB', k: 'atBats' }, { h: 'H', k: 'hits' }, { h: '2B', k: 'doubles' }, { h: 'HR', k: 'homeRuns' }, { h: 'R', k: 'runs' }, { h: 'RBI', k: 'rbi' }, { h: 'BB', k: 'baseOnBalls' }, { h: 'K', k: 'strikeOuts' }, { h: 'SB', k: 'stolenBases' },
      { h: 'xwOBA', f: (r) => (r.sc && r.sc.woba_den ? f.avg(r.sc.xwoba_num / r.sc.woba_den) : '—') }, { h: 'max EV', f: (r) => (r.sc ? r.sc.max_ev ?? '—' : '—') }], [...p.hitting.gamelog].reverse(), { maxH: 620 }));
    return fig('Outing by outing', 'Velo is average 4-seam (or sinker) speed that day.', table([
      { h: 'Date', f: (r) => r.date.slice(5) + (r.gt === 'P' ? ' P' : '') }, { h: 'Opponent', f: opp }, { h: 'Dec', f: (r) => (r.wins ? 'W' : r.losses ? 'L' : r.saves ? 'SV' : r.holds ? 'HLD' : ''), cls: (r) => (r.wins ? 'w' : r.losses ? 'l' : '') },
      { h: 'IP', k: 'inningsPitched' }, { h: 'H', k: 'hits' }, { h: 'ER', g: 'ERA', k: 'earnedRuns' }, { h: 'BB', k: 'baseOnBalls' }, { h: 'K', k: 'strikeOuts' }, { h: 'HR', k: 'homeRuns' }, { h: 'Pitches', k: 'numberOfPitches' },
      { h: 'CSW%', f: (r) => (r.sc ? f.pct((r.sc.whiffs + r.sc.called) / r.sc.pitches, 0) : '—') }, { h: 'Velo', f: (r) => (r.sc && r.sc.velo ? r.sc.velo.FF ?? r.sc.velo.SI ?? '—' : '—') }], [...p.pitching.gamelog].reverse(), { maxH: 620 }));
  }
  if (side === 'h') {
    const cum = p.hitting.cumulative; const rows = p.hitting.gamelog.map((g, i) => ({ ...g, cavg: cum[i] && cum[i].avg, cops: cum[i] && cum[i].ops })).reverse();
    return fig('Game by game', 'AVG and OPS are season-to-date after that game. Conference games are marked *.', table([
      { h: 'Date', f: (r) => r.date.slice(5) }, { h: 'Opponent', f: (r) => opp(r) + (r.conf ? ' *' : '') }, { h: 'Result', f: (r) => r.result + ' ' + r.score, cls: (r) => (r.result === 'W' ? 'w' : 'l') },
      { h: 'Spot', g: 'G', k: 'spot' }, { h: 'AB', k: 'AB' }, { h: 'R', k: 'R' }, { h: 'H', k: 'H' }, { h: '2B', k: '2B' }, { h: 'HR', k: 'HR' }, { h: 'RBI', k: 'RBI' }, { h: 'BB', k: 'BB' }, { h: 'K', k: 'K' }, { h: 'AVG', f: (r) => f.avg(r.cavg) }, { h: 'OPS', f: (r) => f.avg(r.cops) }], rows, { maxH: 620 }));
  }
  return fig('Outing by outing', '', table([
    { h: 'Date', f: (r) => r.date.slice(5) }, { h: 'Opponent', f: (r) => opp(r) + (r.conf ? ' *' : '') }, { h: 'Dec', g: 'W', k: 'dec' }, { h: 'Start', g: 'GS', f: (r) => (r.start ? 'Yes' : '') },
    { h: 'IP', k: 'IP' }, { h: 'H', k: 'H' }, { h: 'ER', g: 'ERA', k: 'ER' }, { h: 'BB', k: 'BB' }, { h: 'K', k: 'K' }, { h: 'HR', k: 'HR' }, { h: 'BF', k: 'BF' }, { h: 'Pitches', k: 'pitches' }], [...p.pitching.gamelog].reverse(), { maxH: 620 }));
}
function allStats(p, side) {
  const B = side === 'h' ? p.hitting : p.pitching; const c = byId(p.id); const reg = side === 'p' ? STATS.P : STATS.H;
  const groups = [];
  const known = Object.keys(reg).filter((k) => c.s[side + '.' + k] != null).map((k) => [reg[k].label, fmtStat(k, side, c.s[side + '.' + k]) + (reg[k].unit ? ` ${reg[k].unit}` : ''), k]);
  groups.push(['Key stats (tap for rank and trend)', statRows(side, known)]);
  const pretty = (k) => k.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\bpct\b/g, '%').replace(/^./, (m) => m.toUpperCase());
  const flat = (title, o) => { if (!o) return; const rows = Object.entries(o).filter(([, v]) => v != null && typeof v !== 'object').map(([k, v]) => [pretty(k), typeof v === 'number' && !Number.isInteger(v) ? +v.toFixed(3) : v, null]); if (rows.length) groups.push([title, statRows(side, rows)]); };
  if (p.team === 'atl') { flat('Season', B.season); flat('Advanced', B.advanced); flat('Sabermetrics', B.sabermetrics); flat('Statcast', B.statcast); if (side === 'h') { flat('Bat tracking', p.bat_tracking_lb); flat('Swing decisions (run value)', p.swing_take); } flat('Sprint speed', p.running.sprint); flat('Outs above average', p.fielding.oaa); flat('Arm strength', p.fielding.arm); flat('Catcher framing', p.fielding.framing); flat('Pop time', p.fielding.poptime); }
  else { flat('Season', B.season); flat(side === 'h' ? 'Plate discipline' : 'Pitch sequence', side === 'h' ? B.plate_discipline : B.pitch_sequence); flat('Fielding', p.fielding); }
  return `<input class="statfind" id="statfind" type="search" placeholder="Find a stat on this page, e.g. chase" autocomplete="off">
    ${groups.map(([t, html], i) => i === 0 ? `<div class="statgroup"><h3>${esc(t)}</h3>${html}</div>` : `<details class="statgroup"><summary>${esc(t)}</summary>${html}</details>`).join('')}<div class="empty" id="statnone" style="display:none">No stat matches that. Try a shorter word, like "spin" or "walk".</div>
    <p class="note"><a href="data/players/${p.id}.json" target="_blank" rel="noopener" style="text-decoration:underline">Raw data for this player</a> (machine-readable).</p>`;
}

// ---------- stat sheet ----------
document.addEventListener('click', (e) => {
  const st = e.target.closest && e.target.closest('[data-stat]');
  if (st) { const m = location.hash.match(/^#p-((?:atl|usm)-[0-9a-z]+)/); if (m) { const [s, k] = st.dataset.stat.split(':'); openStat(m[1], s, k); } return; }
  const g = e.target.closest && e.target.closest('[data-gloss]');
  if (g) { const d = window.gloss(g.dataset.gloss); if (d) openSheetHTML(`<div class="grab"></div><button class="sx" data-close aria-label="Close">×</button><h2>${esc(d[0])}</h2><p class="def">${esc(d[1])}</p>`); }
});
async function openStat(id, side, key) {
  const c = byId(id); const p = await player(id); const reg = side === 'p' ? STATS.P : STATS.H; const m = reg[key]; if (!m) return;
  const v = c.s[side + '.' + key]; const rk = rankOf(c, side, key); const g = window.gloss(m.g || key);
  const list = ranking(c.team, side, key); const vals = list.map((x) => x.s[side + '.' + key]);
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  const ser = series(p, side, m.trend);
  state.sheet = { id, side, key };
  openSheetHTML(`<div class="grab"></div><button class="sx" data-close aria-label="Close">×</button>
    <div class="who">${esc(c.name)}, ${esc(TEAM[c.team].short)}</div><h2>${esc(m.label)}</h2>
    <div class="big"><b>${fmtStat(key, side, v)}</b><span>${m.unit ? esc(m.unit) : ''}${avg != null && m.q ? ` Team average among qualified players: ${fmtStat(key, side, avg)}` : ''}</span></div>
    ${rk && rk.r ? `<div class="rank"><b>${ord(rk.r)}</b> of ${rk.of} on the ${esc(TEAM[c.team].short)}${m.q ? ' (qualified)' : ''}</div>` : rk && rk.unq ? `<div class="rank">Not enough playing time to rank (${STATS.MIN[c.team][side]}+ ${side === 'h' ? 'PA' : 'IP'})</div>` : ''}
    <p class="def">${esc(g ? g[1] : '')}</p>
    ${ser ? `<div style="margin-top:4px">${C.line({ series: [{ name: m.label, color: C.v('--amber'), values: ser.values }], labels: ser.labels, fmt: (x) => fmtStat(key, side, x), height: 180, title: m.label + ' season to date' })}</div><p class="note">Season to date after every game.</p>` : ''}
    <div class="acts"><a class="pill" href="#lead-${c.team}-${side}-${encKey(key)}">See team leaders</a>${!location.hash.startsWith('#p-' + id) ? `<a class="pill" href="#p-${id}">Open ${esc(c.name)}</a>` : ''}</div>`);
  C.mount();
}
function openSheetHTML(html) { const s = document.getElementById('sheet'); s.innerHTML = html; s.classList.add('on'); document.getElementById('scrim').classList.add('on'); s.querySelector('[data-close]').onclick = closeSheet; }
function closeSheet() { const s = document.getElementById('sheet'); if (!s) return; s.classList.remove('on'); if (!document.getElementById('palette').classList.contains('on')) document.getElementById('scrim').classList.remove('on'); }

// ---------- search palette ----------
const ICON = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
};
function openPalette(q = '') {
  const pl = document.getElementById('palette'); pl.classList.add('on'); document.getElementById('scrim').classList.add('on');
  const inp = document.getElementById('pq'); inp.value = q; renderResults(q); setTimeout(() => inp.focus(), 30);
}
function closePalette() { const pl = document.getElementById('palette'); if (!pl) return; pl.classList.remove('on'); if (!document.getElementById('sheet').classList.contains('on')) document.getElementById('scrim').classList.remove('on'); }
function statMatches(qn) {
  const out = []; if (!qn) return out;
  for (const [side, reg] of [['h', STATS.H], ['p', STATS.P]]) for (const [k, m] of Object.entries(reg)) {
    const names = [norm(k), norm(m.label)]; const alias = Object.entries(STATS.ALIAS).filter(([, v]) => v === k).map(([a]) => a);
    let score = 0;
    for (const n of [...names, ...alias]) { if (n === qn) score = Math.max(score, 3); else if (n.startsWith(qn) || qn.includes(n) && n.length > 2) score = Math.max(score, 2); else if (n.includes(qn) && qn.length > 2) score = Math.max(score, 1); }
    if (score) out.push({ side, k, m, score });
  }
  return out.sort((a, b) => b.score - a.score);
}
function renderResults(q) {
  const I = state.index; const qn = norm(q).trim(); const box = document.getElementById('pres'); let items = [];
  if (!qn) {
    const rec = store.get('hz-recent', []).map(byId).filter(Boolean).slice(0, 5);
    if (rec.length) items.push(['Recently viewed', rec.map((c) => ({ go: `#p-${c.id}`, html: `${av(c)}<span class="main"><b>${esc(c.name)}</b><small>${esc(c.pos || '')}, ${TEAM[c.team].short}</small></span>` }))]);
    const tryEx = MODE.cur === 'atl' ? [['olson barrel', 'One player\u2019s stat'], ['spin', 'Leaders for a stat'], ['urban', 'A Southern Miss player'], ['28', 'Search by jersey number']] : [['urban ops', 'One player\u2019s stat'], ['walk rate', 'Leaders for a stat'], ['olson', 'A Braves player'], ['1', 'Search by jersey number']];
    items.push(['Try typing', tryEx.map(([t, d]) => ({ q: t, html: `<span class="ico">${ICON.search}</span><span class="main"><b>${esc(t)}</b><small>${esc(d)}</small></span>` }))]);
  } else {
    const words = qn.split(/\s+/);
    // split query into player part + stat part
    const players = I.players.map((c) => { const n = norm(c.name); const hits = words.filter((w) => (w.length > 1 && n.split(/\s+/).some((part) => part.startsWith(w))) || (/^\d+$/.test(w) && String(c.number) === w)); return { c, hits }; }).filter((x) => x.hits.length)
      .sort((a, b) => b.hits.length - a.hits.length || (b.c.team === MODE.cur) - (a.c.team === MODE.cur) || (b.c.sort || 0) - (a.c.sort || 0));
    const usedWords = players.length ? players[0].hits : [];
    const statQ = words.filter((w) => !usedWords.includes(w)).join(' ');
    const stats = statMatches(statQ || (players.length ? '' : qn));
    if (players.length && stats.length) {
      const combo = [];
      for (const pl of players.slice(0, 3)) for (const st of stats.slice(0, 4)) { const v = pl.c.s[st.side + '.' + st.k]; if (v != null) combo.push({ go: `#p-${pl.c.id}-s-${st.side}-${encKey(st.k)}`, html: `${av(pl.c)}<span class="main"><b>${esc(pl.c.name)}</b><small>${esc(st.m.label)}</small></span><span class="rv">${fmtStat(st.k, st.side, v)}</span>` }); }
      if (combo.length) items.push(['Best match', combo.slice(0, 5)]);
    }
    if (players.length) items.push(['Players', players.slice(0, 8).map(({ c }) => ({ go: `#p-${c.id}`, html: `${av(c)}<span class="main"><b>${esc(c.name)}</b><small>${esc(c.pos || '')}, ${TEAM[c.team].short}</small></span><span class="rv">${c.role === 'pitcher' ? fmtStat('ERA', 'p', c.s['p.ERA']) : fmtStat('AVG', 'h', c.s['h.AVG'])}</span>` }))]);
    if (stats.length && !players.length) {
      const rows = [];
      for (const st of stats.slice(0, 4)) for (const t of [MODE.cur, MODE.cur === 'atl' ? 'usm' : 'atl']) { const top = ranking(t, st.side, st.k)[0]; if (top) rows.push({ go: `#lead-${t}-${st.side}-${encKey(st.k)}`, html: `<span class="ico t-${t}">${TEAM[t].abbr}</span><span class="main"><b>${esc(st.m.label)} leaders</b><small>${TEAM[t].short} ${st.side === 'p' ? 'pitching' : 'hitting'}; leader: ${esc(top.name)}</small></span><span class="rv">${fmtStat(st.k, st.side, top.s[st.side + '.' + st.k])}</span>` }); }
      items.push(['Stats', rows]);
    }
  }
  if (qn && !items.length) {
    const G = window.GLOSSARY; const hits = Object.entries(G).filter(([k, v]) => norm(k).includes(qn) || norm(v[0]).includes(qn)).slice(0, 5);
    if (hits.length) items.push(['What that means', hits.map(([k, v]) => ({ gl: k, html: `<span class="ico">?</span><span class="main"><b>${esc(v[0])}</b><small>${esc(v[1].slice(0, 90))}${v[1].length > 90 ? '…' : ''}</small></span>` }))]);
  }
  const flatItems = items.flatMap(([, xs]) => xs);
  box.innerHTML = flatItems.length ? items.map(([g, xs]) => `<div class="grp">${esc(g)}</div>${xs.map((x) => `<button class="item" data-pgo="${esc(x.go || '')}" data-pq="${esc(x.q || '')}" data-pgl="${esc(x.gl || '')}">${x.html}</button>`).join('')}`).join('')
    : `<div class="empty">Nothing matches “${esc(q)}”. Try a last name, a jersey number, or a stat like “walk rate” or “spin”.</div>`;
  state.sel = 0; markSel();
  box.querySelectorAll('.item').forEach((b) => (b.onclick = () => pick(b)));
}
function markSel() { const its = [...document.querySelectorAll('#pres .item')]; its.forEach((x, i) => x.classList.toggle('sel', i === state.sel)); if (its[state.sel]) its[state.sel].scrollIntoView({ block: 'nearest' }); }
function pick(b) { if (b.dataset.pgl) { closePalette(); const d = window.gloss(b.dataset.pgl); openSheetHTML(`<div class="grab"></div><button class="sx" data-close aria-label="Close">×</button><h2>${esc(d[0])}</h2><p class="def">${esc(d[1])}</p><p class="note">Find it in “Every stat” at the bottom of a player page.</p>`); return; } if (b.dataset.pq) { document.getElementById('pq').value = b.dataset.pq; renderResults(b.dataset.pq); return; } closePalette(); if (location.hash === b.dataset.pgo) route(); else location.hash = b.dataset.pgo; }

// ---------- tutorial ----------
const TOUR = () => {
  const atl = MODE.cur === 'atl';
  const ex = atl ? [['Olson barrel rate', 'one player\u2019s stat'], ['Sale spin', 'one player\u2019s stat'], ['ERA', 'team leaders'], ['Joey Urban', 'works for both teams']]
    : [['Urban OPS', 'one player\u2019s stat'], ['Clark strikeout rate', 'one player\u2019s stat'], ['walk rate', 'team leaders'], ['Matt Olson', 'works for both teams']];
  return [
    { h: 'Search anything', p: 'Type a player, a stat, or both together. Results come from both teams. Tap an example to try it:', demo: ex.map(([q, d]) => `<button class="ex" data-tq="${esc(q)}">${ICON.search}<code>${esc(q)}</code><span>${esc(d)}</span></button>`).join('') },
    { h: 'Tap any number', p: 'Every stat on a player page opens a card that explains what it means, where he ranks on his team, and how it changed over the season.', demo: `<div class="key" style="pointer-events:none;max-width:220px"><span class="kl">${atl ? 'Batting average' : 'Batting average'}</span><span class="kv">${atl ? '.251' : '.320'}</span><span class="kr"><b>${atl ? '6th' : '2nd'}</b> of ${atl ? 9 : 7} on the team</span></div>` },
    { h: 'Braves or Southern Miss', p: 'The switch at the top right flips the whole site between the two teams. Each side remembers the page you were on until you reload.', demo: `<div class="teamswitch" style="pointer-events:none;justify-self:start"><button class="t-atl ${atl ? 'on' : ''}"><i></i>Braves</button><button class="t-usm ${atl ? '' : 'on'}"><i></i>Southern Miss</button></div>` },
    { h: 'Inside a player page', p: 'Use the bar under the key stats to jump to the strike zone, spray chart, trends, splits or game log. On a phone, swipe charts sideways. “Every stat” at the bottom has its own search box.', demo: '' },
  ];
};
function openTour(i = 0) {
  const steps = TOUR(); const st = steps[i]; const el = document.getElementById('tour');
  el.innerHTML = `<div class="step">${i + 1} of ${steps.length}</div><h2>${esc(st.h)}</h2><p>${esc(st.p)}</p>${st.demo ? `<div class="demo">${st.demo}</div>` : ''}
    <div class="nav"><div class="dots">${steps.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div><div>${i > 0 ? '<button class="prev">Back</button>' : '<button class="prev skip">Skip</button>'}<button class="next">${i === steps.length - 1 ? 'Start exploring' : 'Next'}</button></div></div>`;
  el.classList.add('on'); document.getElementById('scrim').classList.add('on'); store.set('hz-toured', true);
  el.querySelector('.next').onclick = () => (i === steps.length - 1 ? closeTour() : openTour(i + 1));
  el.querySelector('.prev').onclick = () => (i > 0 ? openTour(i - 1) : closeTour());
  el.querySelectorAll('[data-tq]').forEach((b) => (b.onclick = () => { closeTour(); openPalette(b.dataset.tq); }));
  setTimeout(() => el.querySelector('.next').focus(), 30);
}
function closeTour() { const el = document.getElementById('tour'); if (!el || !el.classList.contains('on')) return; el.classList.remove('on'); if (!document.getElementById('palette').classList.contains('on') && !document.getElementById('sheet').classList.contains('on')) document.getElementById('scrim').classList.remove('on'); }
function maybeTour() { if (!state.tourChecked) { state.tourChecked = true; if (!store.get('hz-toured', false)) setTimeout(() => openTour(0), 500); } }

// ---------- boot ----------
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-open-find]')) { e.preventDefault(); openPalette(); }
  const q = e.target.closest('[data-q]'); if (q) { e.preventDefault(); openPalette(q.dataset.q); }
  if (e.target.id === 'scrim') { closePalette(); closeSheet(); closeTour(); }
});
document.addEventListener('keydown', (e) => {
  const open = document.getElementById('palette').classList.contains('on');
  if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !open && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) { e.preventDefault(); openPalette(); return; }
  if (e.key === 'Escape') { closePalette(); closeSheet(); closeTour(); return; }
  if (open) {
    const n = document.querySelectorAll('#pres .item').length;
    if (e.key === 'ArrowDown') { e.preventDefault(); state.sel = Math.min(n - 1, state.sel + 1); markSel(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); state.sel = Math.max(0, state.sel - 1); markSel(); }
    if (e.key === 'Enter') { const b = document.querySelectorAll('#pres .item')[state.sel]; if (b) { e.preventDefault(); pick(b); } }
  }
});
document.getElementById('pq').addEventListener('input', (e) => renderResults(e.target.value));
document.getElementById('theme').addEventListener('click', () => {
  const cur = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = cur; store.set('hz-theme', cur); setMode(MODE.cur); route({ keepScroll: true });
});
(() => { const t = store.get('hz-theme', null); if (t) document.documentElement.dataset.theme = t; })();
setMode(teamOfHash(location.hash) || store.get('hz-mode', 'atl'));
document.querySelectorAll('.teamswitch [data-mode]').forEach((b) => (b.onclick = () => switchMode(b.dataset.mode)));
document.getElementById('help').onclick = () => openTour(0);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
route();

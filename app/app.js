/* Hot Zone — app shell, routing and views. Data lives in /data (built by the pipeline). */
const APP_NAME = 'Hot Zone';
const f = C.f, esc = C.esc;
const state = { index: null, cache: {}, ui: {} };
const $main = () => document.getElementById('main');
const LG = { avg: 0.245, obp: 0.315, slg: 0.405, ops: 0.72, woba: 0.315, xwoba: 0.315, k: 0.225, bb: 0.085, ev: 88.5, era: 4.1, whiff: 0.25 };

// ---------- tooltip + glossary ----------
const tip = () => document.getElementById('tip');
window.showTip = (html, x, y) => {
  const t = tip(); t.innerHTML = html; t.classList.add('on');
  const w = t.offsetWidth, h = t.offsetHeight;
  let left = x + 14, top = y + 14;
  if (left + w > innerWidth - 8) left = x - w - 14;
  if (top + h > innerHeight - 8) top = y - h - 14;
  t.style.left = Math.max(8, left) + 'px'; t.style.top = Math.max(8, top) + 'px';
};
window.hideTip = () => tip().classList.remove('on');
document.addEventListener('pointermove', (e) => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) showTip(el.getAttribute('data-tip'), e.clientX, e.clientY); else if (!e.target.closest('svg .hit')) hideTip(); });
document.addEventListener('pointerdown', (e) => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) showTip(el.getAttribute('data-tip'), e.clientX, e.clientY); });
document.addEventListener('click', (e) => {
  const g = e.target.closest && e.target.closest('[data-gloss]');
  if (g) { const d = window.gloss(g.getAttribute('data-gloss')); if (d) { const box = document.getElementById('gloss'); box.querySelector('.t').textContent = d[0] + (g.getAttribute('data-gloss') !== d[0] ? ` (${g.getAttribute('data-gloss')})` : ''); box.querySelector('.d').textContent = d[1]; box.classList.add('on'); } }
});
const G = (label, key) => `<span data-gloss="${esc(key || label)}">${esc(label)}</span>`;

// ---------- data ----------
async function getJSON(u) { const r = await fetch(u); if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); }
async function index() { if (!state.index) state.index = await getJSON('data/index.json'); return state.index; }
async function player(id) { if (!state.cache[id]) state.cache[id] = await getJSON(`data/players/${id}.json`); return state.cache[id]; }

// ---------- routing ----------
function nav(h) { location.hash = h; }
window.addEventListener('hashchange', route);
async function route() {
  hideTip(); document.getElementById('gloss').classList.remove('on');
  // plain #names (works on Vercel and inside a claude.ai artifact): #team-atl, #p-atl-621566
  const h = location.hash.replace(/^#\/?/, '');
  let view = '', arg = '';
  if (h.startsWith('team-') || h.startsWith('team/')) { view = 'team'; arg = h.slice(5); }
  else if (h.startsWith('p-') || h.startsWith('p/')) { view = 'p'; arg = h.slice(2); }
  const back = document.getElementById('back');
  back.style.display = view ? '' : 'none';
  try {
    await index();
    if (view === 'team') await teamView(arg);
    else if (view === 'p') await playerView(arg);
    else homeView();
  } catch (e) { $main().innerHTML = `<div class="empty">Couldn't load data (${esc(e.message)}). Check your connection and pull to refresh.</div>`; console.error(e); }
  C.mount();
}

// ---------- shared bits ----------
const teamName = (t) => (t === 'atl' ? 'Atlanta Braves' : 'Southern Miss');
function card(c) {
  const L = c.line || {};
  const keys = c.role === 'pitcher' ? ['ERA', 'IP', 'K', c.team === 'atl' ? 'FIP' : 'WHIP'] : ['AVG', 'OPS', 'HR', c.team === 'atl' ? 'wRC+' : 'OPS+'];
  const fmt = (k, v) => (v == null ? '—' : ['AVG', 'OBP', 'SLG', 'OPS', 'xwOBA', 'wOBA', 'OPP_AVG'].includes(k) ? f.avg(+v) : ['ERA', 'FIP', 'WHIP'].includes(k) ? f.n2(+v) : v);
  return `<a class="pcard team-${c.team}" href="#p-${c.id}">
    <div class="jersey">${esc(c.number ?? '')}</div>
    <div><div class="nm">${esc(c.name)}</div>
    <div class="meta">${esc(c.pos || '')} · B/T ${esc(c.bats || '?')}/${esc(c.throws || '?')}${c.class_short ? ' · ' + esc(c.class_short) : c.age ? ' · Age ' + c.age : ''}</div>
    <div class="mini">${keys.map((k) => `<div><div class="k">${k}</div><div class="v">${fmt(k, L[k])}</div></div>`).join('')}</div></div></a>`;
}
function kv(rows) { return `<div class="kv">${rows.filter((r) => r).map(([k, v, g]) => `<div><div class="k" data-gloss="${esc(g || k)}">${esc(k)}</div><div class="v">${v ?? '—'}</div></div>`).join('')}</div>`; }
function table(cols, rows, opt = {}) {
  return `<div class="tablewrap" style="${opt.maxH ? 'max-height:' + opt.maxH + 'px' : ''}"><table><thead><tr>${cols.map((c) => `<th data-gloss="${esc(c.g || c.h)}">${esc(c.h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map((c) => { const v = c.f ? c.f(r) : r[c.k]; return `<td${c.cls ? ` class="${c.cls(r) || ''}"` : ''}>${v ?? '—'}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
}
const panel = (title, hint, body, cls = '') => `<section class="panel ${cls}"><h3>${title}</h3>${hint ? `<p class="hint">${hint}</p>` : ''}${body}</section>`;
function chips(group, opts, cur, attr = 'data-chip') { return `<div class="chips">${opts.map(([v, l]) => `<button class="chip ${v === cur ? 'on' : ''}" ${attr}="${group}" data-v="${esc(v)}">${esc(l)}</button>`).join('')}</div>`; }
function bindChips(root, rerender) {
  root.querySelectorAll('[data-chip]').forEach((b) => b.addEventListener('click', () => { state.ui[b.dataset.chip] = b.dataset.v; rerender(); }));
}
const ui = (k, d) => (state.ui[k] ?? d);

// ---------- HOME ----------
function homeView() {
  const I = state.index; const T = I.teams;
  $main().innerHTML = `
    <div class="hero-title">${APP_NAME}</div>
    <p class="sub">Every player, every stat — 2026 season. Tap a team, or search any player. Tap any stat name to learn what it means.</p>
    <div class="teamtiles">
      ${['atl', 'usm'].map((t) => `<a class="teamtile ${t}" href="#team-${t}"><div class="stripe"></div>
        <div><div class="tname">${esc(T[t].name)}</div><div class="tmeta">${esc(T[t].level)} · ${I.season}${t === 'atl' ? ' · Postseason ' + T.atl.postseason : ' · Conf ' + T.usm.conf_record}</div></div>
        <div class="trec">${esc(T[t].record)}</div></a>`).join('')}
    </div>
    <input class="search" id="q" placeholder="Search players (e.g. Olson, Urban, Sale)…" autocomplete="off">
    <div class="results cards" id="res"></div>
    <div class="footer">Data: MLB Stats API & Baseball Savant (Braves) · southernmiss.com box scores (Southern Miss)<br>Built ${esc(I.built)} · Proof of concept on the 2026 season</div>`;
  const q = document.getElementById('q'), res = document.getElementById('res');
  q.addEventListener('input', () => {
    const s = q.value.trim().toLowerCase();
    res.innerHTML = s.length < 2 ? '' : I.players.filter((p) => p.name.toLowerCase().includes(s) || String(p.number) === s).slice(0, 24).map(card).join('') || '<div class="empty">No players found.</div>';
  });
}

// ---------- TEAM ----------
async function teamView(t) {
  const I = state.index, T = I.teams[t];
  const players = I.players.filter((p) => p.team === t);
  const tab = ui('teamtab-' + t, 'hitters');
  const sortKey = ui('sort-' + t + tab, tab === 'pitchers' ? 'IP' : 'PA');
  const games = T.games.filter((g) => !g.gt || g.gt === 'R');
  let rd = 0; const rdv = games.map((g) => (rd += (g.us ?? 0) - (g.them ?? 0)));
  const list = players.filter((p) => (tab === 'pitchers' ? p.role !== 'hitter' : p.role !== 'pitcher'));
  const num = (v) => (v == null || v === '—' ? -Infinity : parseFloat(v));
  const asc = ['ERA', 'WHIP', 'FIP', 'OPP_AVG'].includes(sortKey);
  list.sort((a, b) => (sortKey === 'Name' ? a.last.localeCompare(b.last) : sortKey === '#' ? (+a.number || 99) - (+b.number || 99) :
    asc ? (num(a.line[sortKey]) === -Infinity ? 1 : num(b.line[sortKey]) === -Infinity ? -1 : num(a.line[sortKey]) - num(b.line[sortKey])) : num(b.line[sortKey]) - num(a.line[sortKey])));
  const sorts = tab === 'pitchers' ? ['IP', 'ERA', 'K', 'WHIP', 'FIP', 'SV', 'W', 'Whiff%', 'Name', '#'] : ['PA', 'AVG', 'OPS', 'HR', 'RBI', 'SB', t === 'atl' ? 'wRC+' : 'OPS+', t === 'atl' ? 'WAR' : 'wOBA', 'Name', '#'];
  // leaders
  const lead = (pool, k, n, minK, minV, lowGood) => pool.filter((p) => num(p.line[minK]) >= minV && p.line[k] != null).sort((a, b) => (lowGood ? 1 : -1) * (num(a.line[k]) - num(b.line[k]))).slice(0, n);
  const hitters = players.filter((p) => p.role !== 'pitcher'), pitchers = players.filter((p) => p.role !== 'hitter');
  const minPA = t === 'atl' ? 200 : 100, minIP = t === 'atl' ? 50 : 25;
  const leaderBox = (title, rows, k, fm) => `<div><div style="font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px" data-gloss="${k}">${title}</div>${rows.map((p, i) => `<a href="#p-${p.id}" style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line);font-size:14px"><span>${i + 1}. ${esc(p.name)}</span><b class="num">${fm(p.line[k])}</b></a>`).join('')}</div>`;
  $main().innerHTML = `
    <div class="profile ${t}" style="margin-bottom:14px"><div class="bar"></div>
      <div class="pname">${esc(T.name)}</div><div class="ppos">${esc(T.level)} · 2026 season</div>
      <div class="headline">
        <div class="tile"><div class="k">Record</div><div class="v">${esc(T.record)}</div></div>
        ${t === 'atl' ? `<div class="tile"><div class="k">Postseason</div><div class="v">${esc(T.postseason)}</div></div>` : `<div class="tile"><div class="k">Conference</div><div class="v">${esc(T.conf_record)}</div></div>
        <div class="tile"><div class="k" data-gloss="AVG">Team AVG</div><div class="v">${f.avg(T.hitting.AVG)}</div></div><div class="tile"><div class="k" data-gloss="OPS">Team OPS</div><div class="v">${f.avg(T.hitting.OPS)}</div></div><div class="tile"><div class="k" data-gloss="ERA">Team ERA</div><div class="v">${f.n2(T.pitching.ERA)}</div></div>`}
        <div class="tile"><div class="k">Run diff</div><div class="v">${rd > 0 ? '+' : ''}${rd}</div></div>
      </div></div>
    <div class="grid2">
      ${panel('Every game', 'Green = win, red = loss. Taller bars = bigger margin. Tap a bar for the score.', C.strip(games), 'full')}
      ${panel('Run differential over the season', 'Runs scored minus runs allowed, added up game by game.', C.line({ series: [{ name: 'Run differential', color: C.series(0), values: rdv }], labels: games.map((g) => g.date), fmt: (v) => (v > 0 ? '+' : '') + Math.round(v), ref: 0, height: 220, extra: (i) => `<br>${games[i].home ? 'vs' : '@'} ${esc(games[i].opp)} ${games[i].result} ${games[i].us}-${games[i].them}` }), 'full')}
      ${panel('Team leaders', `Minimum ${minPA} PA / ${minIP} IP.`, `<div class="grid2" style="gap:16px">
        ${leaderBox('Batting average', lead(hitters, 'AVG', 5, 'PA', minPA), 'AVG', f.avg)}
        ${leaderBox('Home runs', lead(hitters, 'HR', 5, 'PA', 1), 'HR', f.int)}
        ${leaderBox('ERA', lead(pitchers, 'ERA', 5, 'IP', minIP, true), 'ERA', f.n2)}
        ${leaderBox('Strikeouts', lead(pitchers, 'K', 5, 'IP', 1), 'K', f.int)}</div>`, 'full')}
    </div>
    <div class="tabs">${[['hitters', `Hitters (${hitters.length})`], ['pitchers', `Pitchers (${pitchers.length})`]].map(([v, l]) => `<button class="tab ${tab === v ? 'on' : ''}" data-tab="${v}">${l}</button>`).join('')}</div>
    <div class="sortbar"><span style="color:var(--text-secondary);font-size:13px">Sort by</span><select id="sort">${sorts.map((s) => `<option ${s === sortKey ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
    <div class="cards" style="margin-top:12px">${list.map(card).join('')}</div>`;
  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { state.ui['teamtab-' + t] = b.dataset.tab; route(); }));
  document.getElementById('sort').addEventListener('change', (e) => { state.ui['sort-' + t + tab] = e.target.value; route(); });
}

// ---------- PLAYER ----------
async function playerView(id) {
  const p = await player(id);
  const both = p.hitting && p.pitching;
  const side = both ? ui('side-' + id, p.role === 'pitcher' ? 'pitching' : 'hitting') : p.pitching && (p.role === 'pitcher' || !p.hitting) ? 'pitching' : 'hitting';
  const tab = ui('ptab', 'overview');
  const tabs = [['overview', 'Overview'], ['charts', 'Charts'], ['splits', 'Splits'], ['log', 'Game log'], ['all', 'All stats']];
  $main().innerHTML = profileCard(p, side) +
    (both ? chips('side-' + id, [['hitting', 'Hitting'], ['pitching', 'Pitching']], side) : '') +
    `<div class="tabs">${tabs.map(([v, l]) => `<button class="tab ${tab === v ? 'on' : ''}" data-ptab="${v}">${l}</button>`).join('')}</div><div id="pbody"></div>`;
  document.querySelectorAll('[data-ptab]').forEach((b) => b.addEventListener('click', () => { state.ui.ptab = b.dataset.ptab; route(); }));
  bindChips($main(), route);
  const body = document.getElementById('pbody');
  const render = () => {
    const fn = { overview: overview, charts: charts, splits: splits, log: gamelog, all: allStats }[tab];
    body.innerHTML = fn(p, side);
    bindChips(body, () => { render(); C.mount(); });
    bindLegendToggles(body, () => { render(); C.mount(); });
  };
  render();
}

function profileCard(p, side) {
  const facts = p.team === 'atl'
    ? [['Bats/Throws', `${p.bats}/${p.throws}`], ['Age', p.age], ['Height', p.height], ['Weight', p.weight ? p.weight + ' lb' : null], ['Born', p.birthplace], ['MLB debut', p.debut], ['Status', p.status]]
    : [['Bats/Throws', `${p.bats || '?'}/${p.throws || '?'}`], ['Class', p.class], ['Height', p.height], ['Weight', p.weight ? p.weight + ' lb' : null], ['Hometown', p.hometown], ['Previous school', p.previous_school], ['Games / starts', `${p.games} / ${p.starts}`]];
  let tiles = [];
  if (side === 'hitting' && p.hitting) {
    const h = p.hitting;
    if (p.team === 'atl') { const s = h.season, sb = h.sabermetrics || {}, sc = h.statcast || {};
      tiles = [['AVG', f.avg(s.avg)], ['OBP', f.avg(s.obp)], ['SLG', f.avg(s.slg)], ['HR', s.homeRuns], ['RBI', s.rbi], ['SB', s.stolenBases], ['wRC+', f.n0(sb.wRcPlus)], ['WAR', f.n1(sb.war)], ['xwOBA', f.avg(sc.xwoba)], ['Barrel%', f.pct(sc.barrel_pct)]];
    } else { const s = h.season; tiles = [['AVG', f.avg(s.AVG)], ['OBP', f.avg(s.OBP)], ['SLG', f.avg(s.SLG)], ['HR', s.HR], ['RBI', s.RBI], ['SB', s.SB], ['OPS+', f.n0(s['OPS+'])], ['wOBA', f.avg(s.wOBA)], ['K%', f.pct(s['K%'])], ['BB%', f.pct(s['BB%'])]]; }
  } else if (p.pitching) {
    const P = p.pitching;
    if (p.team === 'atl') { const s = P.season, sb = P.sabermetrics || {}, sc = P.statcast || {};
      tiles = [['ERA', f.n2(s.era)], ['IP', s.inningsPitched], ['W-L', `${s.wins}-${s.losses}`], ['SV', s.saves], ['K', s.strikeOuts], ['WHIP', f.n2(s.whip)], ['FIP', f.n2(sb.fip)], ['WAR', f.n1(sb.war)], ['K%', f.pct(sc.k_pct)], ['Whiff%', f.pct(sc.whiff_pct)]];
    } else { const s = P.season; tiles = [['ERA', f.n2(s.ERA)], ['IP', s.IP], ['W-L', `${s.W}-${s.L}`], ['SV', s.SV], ['K', s.K], ['WHIP', f.n2(s.WHIP)], ['FIP', f.n2(s.FIP)], ['K%', f.pct(s['K%'])], ['K-BB%', f.pct(s['K-BB%'])], ['OPP AVG', f.avg(s.OPP_AVG)]]; }
  }
  return `<div class="profile ${p.team}"><div class="bignum">${esc(p.number ?? '')}</div><div class="bar"></div>
    <div class="pname">${esc(p.name)}</div>
    <div class="ppos">#${esc(p.number ?? '—')} · ${esc(p.pos_name || p.pos || '')} · ${esc(teamName(p.team))} <span class="badge" style="background:rgba(255,255,255,.12);color:#fff">${esc(p.level)}</span></div>
    <div class="facts">${facts.filter(([, v]) => v).map(([k, v]) => `<div><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join('')}</div>
    <div class="headline">${tiles.map(([k, v]) => `<div class="tile"><div class="k" data-gloss="${esc(k)}">${esc(k)}</div><div class="v">${v ?? '—'}</div></div>`).join('')}</div></div>`;
}

function bindLegendToggles(root, rerender) {
  root.querySelectorAll('[data-pt-toggle]').forEach((b) => b.addEventListener('click', () => {
    const k = 'pt-off'; const off = new Set((state.ui[k] || '').split(',').filter(Boolean)); const v = b.dataset.ptToggle;
    off.has(v) ? off.delete(v) : off.add(v); state.ui[k] = [...off].join(','); rerender();
  }));
}

// ===== OVERVIEW =====
function overview(p, side) {
  if (p.team === 'atl') return side === 'hitting' ? atlHitOverview(p) : atlPitOverview(p);
  return side === 'hitting' ? usmHitOverview(p) : usmPitOverview(p);
}
function percentileBlock(p, type) {
  const pc = p.percentiles[type];
  if (!pc) return '<div class="empty">Savant percentile rankings only exist for players with enough playing time to qualify.</div>';
  const H = p.hitting && p.hitting.statcast || {}, P = p.pitching && p.pitching.statcast || {};
  const rows = type === 'batting'
    ? [['xwOBA', 'xwoba', f.avg(H.xwoba)], ['xBA', 'xba', f.avg(H.xba)], ['xSLG', 'xslg', f.avg(H.xslg)], ['Avg Exit Velo', 'exit_velocity', H.avg_ev, 'avg EV'], ['Barrel%', 'brl_percent', f.pct(H.barrel_pct)], ['Hard Hit%', 'hard_hit_percent', f.pct(H.hard_hit_pct)],
      ['Bat Speed', 'bat_speed', p.bat_tracking_lb ? f.n1(p.bat_tracking_lb.avg_bat_speed) : null], ['Squared-up%', 'squared_up_rate', null, 'Contact%'], ['Chase%', 'chase_percent', f.pct(H.chase_pct)], ['Whiff%', 'whiff_percent', f.pct(H.whiff_pct)], ['K%', 'k_percent', f.pct(H.k_pct)], ['BB%', 'bb_percent', f.pct(H.bb_pct)],
      ['Sprint Speed', 'sprint_speed', p.running.sprint ? f.n1(p.running.sprint.sprint_speed) : null], ['OAA', 'oaa', p.fielding.oaa ? p.fielding.oaa.outs_above_average : null], ['Arm Strength', 'arm_strength', p.fielding.arm ? f.n1(p.fielding.arm.arm_overall) : null]]
    : [['xERA', 'xera', null, 'ERA'], ['xwOBA', 'xwoba', f.avg(P.xwoba)], ['xBA', 'xba', f.avg(P.xba)], ['FB Velo', 'fb_velocity', null, 'Velo'], ['FB Spin', 'fb_spin', null, 'Spin'], ['Curve Spin', 'curve_spin', null, 'Spin'], ['Avg Exit Velo', 'exit_velocity', P.avg_ev, 'avg EV'],
      ['Barrel%', 'brl_percent', f.pct(P.barrel_pct)], ['Hard Hit%', 'hard_hit_percent', f.pct(P.hard_hit_pct)], ['Chase%', 'chase_percent', f.pct(P.chase_pct)], ['Whiff%', 'whiff_percent', f.pct(P.whiff_pct)], ['K%', 'k_percent', f.pct(P.k_pct)], ['BB%', 'bb_percent', f.pct(P.bb_pct)]];
  return rows.map(([l, k, raw, g]) => C.pctBar(l, pc[k] == null ? null : Math.round(pc[k]), raw, g || l)).join('') +
    `<p class="note">Percentile vs. every MLB ${type === 'batting' ? 'hitter' : 'pitcher'} who qualified (100 = best in MLB). Red = great, blue = poor — already flipped so "good" is always red (e.g. low chase rate = red). From Baseball Savant.</p>`;
}
function atlHitOverview(p) {
  const h = p.hitting, s = h.season, sc = h.statcast || {}, sb = h.sabermetrics || {}, adv = h.advanced || {}, bt = p.bat_tracking_lb || {}, sp = p.running.sprint || {};
  return `<div class="grid2">
    ${panel('Savant percentile rankings', '', percentileBlock(p, 'batting'))}
    ${panel('Quality of contact (Statcast)', 'How hard and how well he hits the ball.', kv([['Avg exit velo', sc.avg_ev ? sc.avg_ev + ' mph' : null, 'avg EV'], ['Max exit velo', sc.max_ev ? sc.max_ev + ' mph' : null, 'max EV'], ['EV50', sc.ev50, 'EV50'], ['Avg launch angle', sc.avg_la != null ? sc.avg_la + '°' : null, 'LA'],
      ['Barrel%', f.pct(sc.barrel_pct)], ['Barrels', sc.barrels, 'Barrel%'], ['Hard Hit%', f.pct(sc.hard_hit_pct)], ['Sweet Spot%', f.pct(sc.sweet_spot_pct)], ['xBA', f.avg(sc.xba)], ['xSLG', f.avg(sc.xslg)], ['xwOBA', f.avg(sc.xwoba)], ['xwOBAcon', f.avg(sc.xwobacon)],
      ['GB%', f.pct(sc.gb_pct)], ['LD%', f.pct(sc.ld_pct)], ['FB%', f.pct(sc.fb_pct)], ['PU%', f.pct(sc.pu_pct)], ['Pull%', f.pct(sc.pull_pct)], ['Oppo%', f.pct(sc.oppo_pct)], ['Max distance', sc.max_distance ? sc.max_distance + ' ft' : null, 'HR']]))}
    ${panel('Plate discipline', 'What he swings at and how often he misses.', kv([['Swing%', f.pct(sc.swing_pct)], ['Whiff%', f.pct(sc.whiff_pct)], ['Chase%', f.pct(sc.chase_pct)], ['Z-Swing%', f.pct(sc.zone_swing_pct)], ['Z-Contact%', f.pct(sc.zone_contact_pct)], ['1st Swing%', f.pct(sc.first_pitch_swing_pct)], ['K%', f.pct(sc.k_pct)], ['BB%', f.pct(sc.bb_pct)], ['P/PA', sc.pitches_per_pa], ['Run Value', sc.run_value]]))}
    ${panel('Swing & speed', 'Bat tracking (Savant leaderboard) and running.', kv([['Bat Speed', bt.avg_bat_speed ? f.n1(bt.avg_bat_speed) + ' mph' : sc.bat_speed], ['Fast Swing%', bt.hard_swing_rate != null ? f.pct(bt.hard_swing_rate) : f.pct(sc.fast_swing_pct)], ['Swing Length', bt.swing_length ? f.n1(bt.swing_length) + ' ft' : sc.swing_length], ['Attack Angle', sc.attack_angle != null ? sc.attack_angle + '°' : null],
      ['Squared-up %', bt.squared_up_per_swing != null ? f.pct(bt.squared_up_per_swing) : null, 'Contact%'], ['Blasts / swing', bt.blast_per_swing != null ? f.pct(bt.blast_per_swing) : null, 'Barrel%'], ['Sprint Speed', sp.sprint_speed ? sp.sprint_speed + ' ft/s' : null], ['Home to 1st', sp.hp_to_1b ? sp.hp_to_1b + ' s' : null, 'Sprint Speed'], ['Bolts (30+ ft/s)', sp.bolts, 'Sprint Speed'], ['SB-CS', `${s.stolenBases ?? 0}-${s.caughtStealing ?? 0}`, 'SB']]))}
    ${panel('Season line', '', kv([['G', s.gamesPlayed], ['PA', s.plateAppearances], ['AB', s.atBats], ['H', s.hits], ['2B', s.doubles], ['3B', s.triples], ['HR', s.homeRuns], ['R', s.runs], ['RBI', s.rbi], ['BB', s.baseOnBalls], ['K', s.strikeOuts], ['AVG', f.avg(s.avg)], ['OBP', f.avg(s.obp)], ['SLG', f.avg(s.slg)], ['OPS', f.avg(s.ops)], ['ISO', f.avg(adv.iso)], ['BABIP', f.avg(s.babip)], ['wOBA', f.avg(sb.woba)], ['wRC+', f.n0(sb.wRcPlus)], ['WAR', f.n1(sb.war)]]), 'full')}
    ${careerPanel(p)}</div>`;
}
function atlPitOverview(p) {
  const P = p.pitching, s = P.season, sc = P.statcast || {}, sb = P.sabermetrics || {}, adv = P.advanced || {};
  return `<div class="grid2">
    ${panel('Savant percentile rankings', '', percentileBlock(p, 'pitching'))}
    ${panel('Arsenal at a glance', 'How often he throws each pitch.', arsenalBars(P))}
    ${panel('Stuff & results (Statcast)', '', kv([['Whiff%', f.pct(sc.whiff_pct)], ['CSW%', f.pct(sc.csw_pct)], ['Chase%', f.pct(sc.chase_pct)], ['Zone%', f.pct(sc.zone_pct)], ['F-Strike%', f.pct(sc.first_pitch_strike_pct)], ['K%', f.pct(sc.k_pct)], ['BB%', f.pct(sc.bb_pct)], ['xwOBA', f.avg(sc.xwoba)], ['xBA', f.avg(sc.xba)], ['Avg EV allowed', sc.avg_ev, 'avg EV'], ['Barrel%', f.pct(sc.barrel_pct)], ['Hard Hit%', f.pct(sc.hard_hit_pct)], ['GB%', f.pct(sc.gb_pct)], ['Run Value', sc.run_value]]))}
    ${panel('Season line', '', kv([['G', s.gamesPlayed], ['GS', s.gamesStarted], ['IP', s.inningsPitched], ['W', s.wins], ['L', s.losses], ['SV', s.saves], ['HLD', s.holds], ['ERA', f.n2(s.era)], ['FIP', f.n2(sb.fip)], ['xFIP', f.n2(sb.xfip)], ['WHIP', f.n2(s.whip)], ['K', s.strikeOuts], ['BB', s.baseOnBalls], ['HR', s.homeRuns], ['K/9', f.n2(s.strikeoutsPer9Inn)], ['BB/9', f.n2(s.walksPer9Inn)], ['K-BB%', f.pct(adv.strikeoutsMinusWalksPercentage)], ['OPP AVG', f.avg(s.avg)], ['BABIP', f.avg(adv.babip)], ['QS', adv.qualityStarts], ['P/IP', f.n1(s.pitchesPerInning)], ['WAR', f.n1(sb.war)]]), 'full')}
    ${careerPanel(p)}</div>`;
}
function careerPanel(p) {
  const rows = (p.career || []).filter((r) => r.level === 'MLB');
  if (!rows.length) return '';
  const pit = p.role === 'pitcher';
  const cols = pit ? [{ h: 'Season', k: 'season' }, { h: 'Team', k: 'team' }, { h: 'G', k: 'gamesPlayed' }, { h: 'IP', k: 'inningsPitched' }, { h: 'ERA', f: (r) => f.n2(r.era) }, { h: 'K', k: 'strikeOuts' }, { h: 'BB', k: 'baseOnBalls' }, { h: 'WHIP', f: (r) => f.n2(r.whip) }]
    : [{ h: 'Season', k: 'season' }, { h: 'Team', k: 'team' }, { h: 'G', k: 'gamesPlayed' }, { h: 'PA', k: 'plateAppearances' }, { h: 'HR', k: 'homeRuns' }, { h: 'AVG', f: (r) => f.avg(r.avg) }, { h: 'OBP', f: (r) => f.avg(r.obp) }, { h: 'SLG', f: (r) => f.avg(r.slg) }, { h: 'OPS', f: (r) => f.avg(r.ops) }];
  return panel('MLB career by season', '', table(cols, rows), 'full');
}
function arsenalBars(P) {
  return C.bars((P.arsenal || []).map((a) => ({ k: a.name || a.type, v: a.usage, d: f.pct(a.usage), c: C.ptColor(a.type), sw: C.ptColor(a.type), tip: `<b>${esc(a.name)}</b><br>${a.n} thrown · ${a.velo} mph avg (max ${a.velo_max})<br>Whiff% ${f.pct(a.whiff_pct)} · xwOBA ${f.avg(a.xwoba)}` })), { max: 1, lw: 120 });
}
function usmNote(p) { return `<p class="note">${(p.notes || []).map(esc).join(' ')}</p>`; }
function usmHitOverview(p) {
  const h = p.hitting, s = h.season, pd = h.plate_discipline, sp = h.spray, dir = h.direction || {};
  return `<div class="grid2">
    ${panel('Season line', '', kv([['G', s.G], ['GS', s.GS], ['PA', s.PA], ['AB', s.AB], ['H', s.H], ['2B', s['2B']], ['3B', s['3B']], ['HR', s.HR], ['R', s.R], ['RBI', s.RBI], ['BB', s.BB], ['HBP', s.HBP], ['K', s.K], ['SB', s.SB], ['AVG', f.avg(s.AVG)], ['OBP', f.avg(s.OBP)], ['SLG', f.avg(s.SLG)], ['OPS', f.avg(s.OPS)], ['ISO', f.avg(s.ISO)], ['BABIP', f.avg(s.BABIP)], ['wOBA', f.avg(s.wOBA)], ['OPS+', f.n0(s['OPS+'])], ['RC', s.RC], ['BB/K', s['BB/K']]]), 'full')}
    ${panel('Plate discipline', `From the pitch-by-pitch ball/strike sequences (${f.pct(pd.coverage, 0)} of his plate appearances had them).`, kv([['P/PA', pd.pitches_per_pa], ['Swing%', f.pct(pd.swing_pct)], ['Whiff%', f.pct(pd.whiff_pct)], ['Contact%', f.pct(pd.contact_pct)], ['1st Swing%', f.pct(pd.first_pitch_swing_pct)], ['Called strike %', f.pct(pd.called_strike_pct), 'CSW%'], ['Foul % of swings', f.pct(pd.foul_pct_of_swings), 'Contact%'], ['2-strike fouls / PA', pd.fouls_per_two_strike_pa, 'P/PA'], ['Full-count PAs', pd.full_count_pa, 'PA'], ['7+ pitch PAs', pd.long_pa_7plus, 'P/PA'], ['K%', f.pct(s['K%'])], ['BB%', f.pct(s['BB%'])]]))}
    ${panel('Batted balls', `Based on ${sp.bip} balls in play described in play-by-play.`, kv([['GB%', f.pct(sp.gb_pct)], ['LD%', f.pct(sp.ld_pct)], ['FB%', f.pct(sp.fb_pct)], ['PU%', f.pct(sp.pu_pct)], ['Pull%', f.pct(dir.pull_pct)], ['Center%', f.pct(dir.center_pct), 'Pull%'], ['Oppo%', f.pct(dir.oppo_pct)], ['GO/AO', s['GO/AO']]]))}
    ${panel('How his plate appearances ended', '', resultsBars(h.results, false))}
  </div>${usmNote(p)}`;
}
function usmPitOverview(p) {
  const P = p.pitching, s = P.season, ps = P.pitch_sequence, sp = P.spray_allowed;
  return `<div class="grid2">
    ${panel('Season line', '', kv([['G', s.APP], ['GS', s.GS], ['IP', s.IP], ['W', s.W], ['L', s.L], ['SV', s.SV], ['ERA', f.n2(s.ERA)], ['FIP', f.n2(s.FIP)], ['WHIP', f.n2(s.WHIP)], ['H', s.H], ['ER', s.ER, 'ERA'], ['BB', s.BB], ['K', s.K], ['HR', s.HR], ['HBP', s.HBP], ['K/9', f.n2(s['K/9'])], ['BB/9', f.n2(s['BB/9'])], ['K%', f.pct(s['K%'])], ['BB%', f.pct(s['BB%'])], ['K-BB%', f.pct(s['K-BB%'])], ['OPP AVG', f.avg(s.OPP_AVG)], ['BABIP', f.avg(s.BABIP)], ['P/IP', s['P/IP']], ['IRS%', f.pct(s['IR_scored%'])]]), 'full')}
    ${panel('Pitch sequence profile', `From scorer ball/strike sequences (${f.pct(ps.coverage, 0)} coverage).`, kv([['Pitches', ps.pitches], ['Strike%', f.pct(ps.strike_pct)], ['F-Strike%', f.pct(ps.first_pitch_strike_pct)], ['Whiff%', f.pct(ps.whiff_pct)], ['CSW%', f.pct(ps.csw_pct)], ['Swing%', f.pct(ps.swing_pct)], ['Putaway%', f.pct(ps.putaway_pct)], ['P/PA', ps.pitches_per_pa], ['3-ball counts', ps.three_ball_pa, 'BB%'], ['Full counts', ps.full_count_pa, 'BB%']]))}
    ${panel('Batted balls allowed', '', kv([['GB%', f.pct(sp.gb_pct)], ['LD%', f.pct(sp.ld_pct)], ['FB%', f.pct(sp.fb_pct)], ['PU%', f.pct(sp.pu_pct)], ['GO/AO', s['GO/AO']], ['HR/9', f.n2(s['HR/9'])]]))}
    ${panel('How batters’ plate appearances ended', '', resultsBars(P.results, true))}
  </div>${usmNote(p)}`;
}
const RES_NAMES = { K_S: 'Strikeout swinging', K_L: 'Strikeout looking', K: 'Strikeout', BB: 'Walk', IBB: 'Intentional walk', HBP: 'Hit by pitch', '1B': 'Single', '2B': 'Double', '3B': 'Triple', HR: 'Home run', GO: 'Ground out', GIDP: 'Double play', FO: 'Fly out', LO: 'Line out', PO: 'Pop out', FL: 'Foul out', SF: 'Sacrifice fly', SH: 'Sacrifice bunt', FC: "Fielder's choice", ROE: 'Reached on error', CI: 'Catcher interference' };
function resultsBars(res, pitcher) {
  const tot = Object.values(res || {}).reduce((a, b) => a + b, 0) || 1;
  const good = new Set(['1B', '2B', '3B', 'HR', 'BB', 'IBB', 'HBP', 'ROE']);
  return C.bars(Object.entries(res || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ k: RES_NAMES[k] || k, v, d: `${v} (${f.pct(v / tot, 0)})`, c: good.has(k) !== pitcher ? 'var(--s1)' : 'var(--text-muted)' })), { lw: 130 }) +
    `<p class="note">Blue = good for the ${pitcher ? 'pitcher' : 'hitter'}.</p>`;
}

// ===== CHARTS =====
function charts(p, side) {
  if (p.team === 'atl') return side === 'hitting' ? atlHitCharts(p) : atlPitCharts(p);
  return side === 'hitting' ? usmHitCharts(p) : usmPitCharts(p);
}
const ZONE_METRICS_H = [['xwoba', 'xwOBA', 0.315, 0.15, f.avg], ['ba', 'AVG', 0.245, 0.15, f.avg], ['slg', 'SLG', 0.405, 0.3, f.avg], ['swing', 'Swing%', 0.47, 0.35, (v) => f.pct(v, 0)], ['whiff', 'Whiff%', 0.25, 0.25, (v) => f.pct(v, 0)], ['pct', 'Pitches %', 0, 0, (v) => f.pct(v, 0)]];
function zonePanel(zones, keyName, side, who) {
  const cur = ui(keyName, 'xwoba'); const m = ZONE_METRICS_H.find((z) => z[0] === cur);
  const body = chips(keyName, ZONE_METRICS_H.map((z) => [z[0], z[1]]), cur) + C.zoneMap(zones, { key: m[0], mid: m[2], span: m[3], fmt: m[4], seq: m[0] === 'pct', side, minN: m[0] === 'pct' ? 1 : 8 });
  return panel('Strike-zone hot & cold map', `${who} in each of the 13 Statcast zones. Red = higher than MLB average, blue = lower${cur === 'pct' ? ' (darker = more pitches)' : ''}. The bold box is the strike zone; the 4 outer pieces are just off the plate.`, body);
}
const HEAT_H = [['pitches', 'Pitches seen'], ['swings', 'Swings'], ['whiffs', 'Whiff rate'], ['hard_hit', 'Hard hits (95+)'], ['hits', 'Hits']];
function heatPanel(H, keyName, p, opts, title, hint) {
  const cur = ui(keyName, opts[0][0]);
  const rate = cur === 'whiffs' ? 'swings' : null;
  return panel(title, hint, chips(keyName, opts, cur) + C.heat(H, { mat: cur, rateOf: rate, szTop: p.sz_top || 3.4, szBot: p.sz_bot || 1.6, label: cur.replace('_', ' ') }));
}
function atlHitCharts(p) {
  const h = p.hitting; if (!h.statcast) return '<div class="empty">No Statcast data for this player.</div>';
  const show = new Set((ui('spray-show', '1B,2B,3B,HR,Out')).split(','));
  const sprayChips = `<div class="chips">${['1B', '2B', '3B', 'HR', 'Out'].map((k) => `<button class="chip ${show.has(k) ? 'on' : ''}" data-spray="${k}">${k === 'Out' ? 'Outs' : k}</button>`).join('')}</div>`;
  const resLeg = `<div class="legend">${[['single', 'Single'], ['double', 'Double'], ['triple', 'Triple'], ['home_run', 'Home run'], ['field_out', 'Out']].map(([e, l]) => `<span><span class="sw" style="background:${C.resultColor(e)}"></span>${l}</span>`).join('')}</div>`;
  const evla = (h.spray || []).map(([x, y, ev, la, e, bt, dt]) => ({ x: la, y: ev, c: C.resultColor(e), o: e && ['single', 'double', 'triple', 'home_run'].includes(e) ? 0.9 : 0.35, tip: `<b>${(e || '').replace(/_/g, ' ')}</b> · ${dt}<br>${ev} mph at ${la}°` }));
  const rm = ui('roll-h', 'ops');
  const RM = { ops: ['OPS', f.avg, LG.ops], xwoba: ['xwOBA', f.avg, LG.xwoba], avg: ['AVG', f.avg, LG.avg], k_pct: ['K%', (v) => f.pct(v), LG.k], bb_pct: ['BB%', (v) => f.pct(v), LG.bb], avg_ev: ['Avg exit velo', f.n1, LG.ev], hard_hit_pct: ['Hard Hit%', (v) => f.pct(v), 0.4] };
  const roll = h.rolling_15g || [];
  const cum = h.cumulative || [];
  const vpt = (h.vs_pitch_type || []).filter((x) => x.n >= 40);
  return `<div class="grid2">
    ${zonePanel(h.zones, 'zm-h', p.bats, 'How he does on pitches')}
    ${heatPanel(h.heat, 'hm-h', p, HEAT_H, 'Where pitchers threw to him', 'Every pitch he saw, by location. Switch to see where he swings, misses, and hits the ball hard.')}
    ${panel('Spray chart', `All ${h.spray.length} balls he put in play (Statcast coordinates). Tap a dot for exit velo, launch angle and distance.`, sprayChips + resLeg + C.spray(h.spray, { show }))}
    ${panel('Exit velocity vs. launch angle', 'Each dot is a batted ball. The shaded band (8°–32°) is the "sweet spot"; dots above the dashed line were hit 95+ mph.', resLeg + C.scatter({ pts: evla, xr: [-60, 80], yr: [40, 120], xl: 'Launch angle (°)', yl: 'Exit velocity (mph)', bands: [{ x0: 8, x1: 32, label: 'sweet spot' }], guides: [{ y: 95, label: '95 mph' }] }))}
    ${panel('Rolling 15-game trend', 'Each point = his last 15 games added together. Dashed line = MLB average.', chips('roll-h', Object.entries(RM).map(([k, v]) => [k, v[0]]), rm) + C.line({ series: [{ name: RM[rm][0], color: C.series(0), values: roll.map((r) => r[rm]) }], labels: roll.map((r) => r.date), fmt: RM[rm][1], ref: RM[rm][2], refLabel: 'MLB avg' }), 'full')}
    ${panel('Season-to-date AVG / OBP / SLG', 'How his slash line built up over the season.', C.line({ series: [{ name: 'AVG', color: C.series(0), values: cum.map((r) => r.avg) }, { name: 'OBP', color: C.series(1), values: cum.map((r) => r.obp) }, { name: 'SLG', color: C.series(2), values: cum.map((r) => r.slg) }], labels: cum.map((r) => r.date), fmt: f.avg }), 'full')}
    ${panel('Results by pitch type faced', 'xwOBA against each pitch type (min 40 pitches). Longer bar = more damage.', C.bars(vpt.map((x) => ({ k: x.name, v: x.xwoba, d: f.avg(x.xwoba), c: C.ptColor(x.type), sw: C.ptColor(x.type), tip: `<b>${esc(x.name)}</b><br>${x.n} pitches seen (${f.pct(x.usage)})<br>AVG ${f.avg(x.ba)} · SLG ${f.avg(x.slg)} · Whiff% ${f.pct(x.whiff_pct)}<br>Run value ${x.run_value}` })), { max: 0.6, lw: 120 }))}
    ${panel('Count by count', 'wOBA in plate appearances that ended in each count. Red = he did damage, blue = he struggled.', C.countGrid((b, s) => { const d = h.counts[b + '-' + s]; return d && { n: d.pa_end, v: d.woba, tip: `${d.pa_end} PAs ended here · wOBA ${f.avg(d.woba)}<br>${d.pitches} pitches seen · swing ${f.pct(d.swing)} · whiff ${f.pct(d.whiff)}` }; }, { fmt: f.avg }))}
  </div>`;
}
function atlPitCharts(p) {
  const P = p.pitching; if (!P.statcast) return '<div class="empty">No Statcast data for this pitcher.</div>';
  const off = new Set((state.ui['pt-off'] || '').split(',').filter(Boolean));
  const types = (P.arsenal || []).map((a) => a.type);
  const legend = `<div class="legend">${(P.arsenal || []).map((a) => `<button class="${off.has(a.type) ? 'off' : ''}" data-pt-toggle="${a.type}"><span class="sw" style="background:${C.ptColor(a.type)}"></span>${esc(a.name)}</button>`).join('')}</div>`;
  const mv = (P.movement || []).filter((m) => !off.has(m[0])).map(([t, hb, ivb, v]) => ({ x: hb, y: ivb, c: C.ptColor(t), o: 0.5, r: 2.6, tip: `<b>${C.PT_NAMES[t] || t}</b> ${v} mph<br>HB ${hb} in · IVB ${ivb} in` }));
  const cents = (P.arsenal || []).filter((a) => !off.has(a.type) && a.hb != null).map((a) => ({ x: a.hb, y: a.ivb, c: C.ptColor(a.type), label: a.type, tip: `<b>${esc(a.name)} average</b><br>${a.velo} mph · ${a.spin} rpm<br>HB ${a.hb} in · IVB ${a.ivb} in` }));
  const rel = (P.release || []).filter((m) => !off.has(m[0])).map(([t, x, z]) => ({ x, y: z, c: C.ptColor(t), o: 0.55, r: 2.6, tip: `<b>${C.PT_NAMES[t] || t}</b><br>release ${x} ft side, ${z} ft high` }));
  const lt = ui('loc-type', 'ALL');
  const locOpts = [['ALL', 'All pitches'], ...Object.keys(P.heat_by_type || {}).map((t) => [t, t])];
  const locH = lt === 'ALL' ? P.heat : { ...P.heat, pitches: P.heat_by_type[lt] };
  const gl = (P.gamelog || []).filter((g) => g.gt === 'R' && g.sc);
  const topTypes = (P.arsenal || []).filter((a) => a.usage >= 0.08).slice(0, 4).map((a) => a.type);
  const rm = ui('roll-p', 'erafip'); const rows = P.rolling.rows;
  const RM = { erafip: ['ERA & FIP', [['era', 'ERA'], ['fip', 'FIP']], f.n2, LG.era], kbb: ['K% & BB%', [['k_pct', 'K%'], ['bb_pct', 'BB%']], (v) => f.pct(v), null], whiff: ['Whiff% & CSW%', [['whiff_pct', 'Whiff%'], ['csw_pct', 'CSW%']], (v) => f.pct(v), null], xwoba: ['xwOBA allowed', [['xwoba', 'xwOBA']], f.avg, LG.xwoba] };
  const zm = ui('zm-p', 'xwoba');
  const ZP = ZONE_METRICS_H.filter((z) => ['xwoba', 'ba', 'whiff', 'swing', 'pct'].includes(z[0]));
  const m = ZP.find((z) => z[0] === zm) || ZP[0];
  const arsCols = [{ h: 'Pitch', f: (a) => `<span class="sw" style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${C.ptColor(a.type)};margin-right:6px"></span>${esc(a.name)}` }, { h: 'Usage', f: (a) => f.pct(a.usage) }, { h: '#', g: 'Pitches', k: 'n' }, { h: 'Velo', k: 'velo' }, { h: 'Max', g: 'Velo', k: 'velo_max' }, { h: 'Spin', k: 'spin' }, { h: 'IVB', k: 'ivb' }, { h: 'HB', k: 'hb' }, { h: 'Ext', k: 'extension' }, { h: 'Arm Angle', k: 'arm_angle' }, { h: 'Whiff%', f: (a) => f.pct(a.whiff_pct) }, { h: 'CSW%', f: (a) => f.pct(a.csw_pct) }, { h: 'Chase%', f: (a) => f.pct(a.chase_pct) }, { h: 'Zone%', f: (a) => f.pct(a.zone_pct) }, { h: 'Putaway%', f: (a) => f.pct(a.putaway_pct) }, { h: 'AVG', f: (a) => f.avg(a.ba) }, { h: 'xwOBA', f: (a) => f.avg(a.xwoba) }, { h: 'Hard Hit%', f: (a) => f.pct(a.hard_hit_pct) }, { h: 'RV/100', k: 'rv_per_100' }];
  const vsR = Object.fromEntries((P.arsenal_vs.vs_RHB || []).map((x) => [x.type, x.usage])), vsL = Object.fromEntries((P.arsenal_vs.vs_LHB || []).map((x) => [x.type, x.usage]));
  return `<div class="grid2">
    ${panel('Arsenal', 'Every pitch type he throws. Tap any column name for what it means.', table(arsCols, P.arsenal), 'full')}
    ${panel('Pitch movement', 'How each pitch moves (catcher’s view, gravity removed). Up = "rise", left/right = run or sweep. Big circles = averages. Tap names to hide/show.', legend + C.scatter({ pts: mv, centroids: cents, xr: [-25, 25], yr: [-25, 25], xl: 'Horizontal break (in)', yl: 'Induced vertical break (in)', guides: [{ x: 0 }, { y: 0 }], height: 360 }))}
    ${panel('Pitch mix: righties vs. lefties', 'Usage of each pitch against right-handed and left-handed batters.', C.bars(types.flatMap((t) => [{ k: `${t} vs RHB`, v: vsR[t] || 0, d: f.pct(vsR[t] || 0), c: C.ptColor(t), sw: C.ptColor(t) }, { k: `${t} vs LHB`, v: vsL[t] || 0, d: f.pct(vsL[t] || 0), c: C.ptColor(t) }]), { max: 1, lw: 96 }))}
    ${panel('Where he throws it', 'Pitch locations, catcher’s view. Pick a pitch type to see how he locates it.', chips('loc-type', locOpts, lt) + C.heat(locH, { mat: 'pitches', szTop: 3.4, szBot: 1.6, label: 'pitches' }))}
    ${panel('Zone map: results allowed', 'What hitters did against him in each zone. Red = higher than MLB average.', chips('zm-p', ZP.map((z) => [z[0], z[1]]), m[0]) + C.zoneMap(P.zones, { key: m[0], mid: m[2], span: m[3], fmt: m[4], seq: m[0] === 'pct', minN: m[0] === 'pct' ? 1 : 8 }))}
    ${panel('Release point', 'Where the ball leaves his hand (catcher’s view, feet). Tight clusters = consistent delivery.', legend + C.scatter({ pts: rel, xr: [-4.5, 4.5], yr: [3, 7.5], xl: 'Side (ft)', yl: 'Height (ft)', guides: [{ x: 0 }] }))}
    ${panel('Velocity by game', 'Average speed of his main pitches each outing.', C.line({ series: topTypes.map((t) => ({ name: C.PT_NAMES[t] || t, color: C.ptColor(t), values: gl.map((g) => g.sc.velo[t] ?? null) })), labels: gl.map((g) => g.date), fmt: (v) => v.toFixed(1) + '', extra: (i) => `<br>vs ${esc(gl[i].opp)} · ${gl[i].inningsPitched} IP · ${gl[i].sc.pitches} pitches` }), 'full')}
    ${panel(`Rolling ${P.rolling.window_games}-game trend`, `Each point = his last ${P.rolling.window_games} appearances combined.`, chips('roll-p', Object.entries(RM).map(([k, v]) => [k, v[0]]), rm) + C.line({ series: RM[rm][1].map(([k, l], i) => ({ name: l, color: C.series(i), values: rows.map((r) => r[k]) })), labels: rows.map((r) => r.date), fmt: RM[rm][2], ref: RM[rm][3], refLabel: RM[rm][3] ? 'MLB avg' : '' }), 'full')}
    ${panel('Balls in play against him', `${P.spray_allowed.length} batted balls.`, C.spray(P.spray_allowed))}
    ${panel('Count by count', 'wOBA allowed in plate appearances that ended in each count. Blue = he won those counts.', C.countGrid((b, s) => { const d = P.counts[b + '-' + s]; return d && { n: d.pa_end, v: d.woba, tip: `${d.pa_end} PAs ended here · wOBA ${f.avg(d.woba)} · ${d.k} K` }; }, { fmt: f.avg }))}
  </div>`;
}
function usmHitCharts(p) {
  const h = p.hitting, pd = h.plate_discipline;
  const af = pd.after_first_pitch || {};
  const roll = h.rolling_10g, cum = h.cumulative;
  const rm = ui('roll-u', 'ops');
  const RM = { ops: ['OPS', f.avg], woba: ['wOBA', f.avg], avg: ['AVG', f.avg], k_pct: ['K%', (v) => f.pct(v)], bb_pct: ['BB%', (v) => f.pct(v)] };
  const sp = h.splits;
  return `<div class="grid2">
    ${panel('Spray zones', `Where his ${h.spray.located} located balls in play went, from the play-by-play ("singled to left center", "grounded out to ss"). Darker = more balls; number = count. Tap a zone for hits.`, C.wedgeSpray(h.spray))}
    ${panel('After the first pitch', 'How he hit after falling behind 0-1 vs. getting ahead 1-0, and when he put the first pitch in play.', C.bars([['first_pitch_in_play', 'Swung 1st pitch, in play'], ['1-0', 'After 1-0 (ahead)'], ['0-1', 'After 0-1 (behind)']].filter(([k]) => af[k]).map(([k, l], i) => ({ k: l, v: af[k].wOBA, d: f.avg(af[k].wOBA), c: C.series(i), tip: `<b>${l}</b><br>${af[k].PA} PA · ${af[k].AVG != null ? 'AVG ' + f.avg(af[k].AVG) : ''} · OBP ${f.avg(af[k].OBP)} · SLG ${f.avg(af[k].SLG)}<br>K% ${f.pct(af[k]['K%'])}` })), { max: 0.7, lw: 150 }) + '<p class="note">Bars show wOBA. Tap for AVG/OBP/SLG.</p>')}
    ${panel('Count by count', 'wOBA in plate appearances that ended in each count (the count before the last pitch).', C.countGrid((b, s) => { const d = h.counts_pa_ended[b + '-' + s]; return d && { n: d.PA, v: d.wOBA, tip: `${d.PA} PA · AVG ${f.avg(d.AVG)} · OBP ${f.avg(d.OBP)} · SLG ${f.avg(d.SLG)}` }; }, { fmt: f.avg }))}
    ${panel('Pitches he saw', `${pd.pitches} pitches across ${pd.pa_with_pitch_data} plate appearances.`, C.bars([['Balls', pd.balls, 'var(--text-muted)'], ['Called strikes', pd.called_strikes, 'var(--s4)'], ['Swinging strikes', pd.swinging_strikes, 'var(--s8)'], ['Fouls', pd.fouls, 'var(--s3)'], ['Put in play', pd.in_play, 'var(--s1)']].map(([k, v, c]) => ({ k, v, d: `${v} (${f.pct(v / pd.pitches, 0)})`, c })), { lw: 120 }))}
    ${panel('Rolling 10-game trend', 'Each point = his last 10 games combined.', chips('roll-u', Object.entries(RM).map(([k, v]) => [k, v[0]]), rm) + C.line({ series: [{ name: RM[rm][0], color: C.series(0), values: roll.map((r) => r[rm]) }], labels: roll.map((r) => r.date), fmt: RM[rm][1], ref: ['ops', 'woba', 'avg'].includes(rm) ? { ops: state.index.teams.usm.hitting.OPS, woba: state.index.teams.usm.hitting.wOBA, avg: state.index.teams.usm.hitting.AVG }[rm] : null, refLabel: 'team avg' }), 'full')}
    ${panel('Season-to-date AVG / OBP / SLG', '', C.line({ series: [{ name: 'AVG', color: C.series(0), values: cum.map((r) => r.avg) }, { name: 'OBP', color: C.series(1), values: cum.map((r) => r.obp) }, { name: 'SLG', color: C.series(2), values: cum.map((r) => r.slg) }], labels: cum.map((r) => r.date), fmt: f.avg }), 'full')}
    ${panel('vs. right-handed and left-handed pitchers', 'Built from play-by-play, using the opposing pitcher’s throwing hand.', C.bars([['vs_RHP', 'vs RHP'], ['vs_LHP', 'vs LHP']].flatMap(([k, l], i) => [{ k: l + ' OPS', v: (sp[k].OBP || 0) + (sp[k].SLG || 0), d: f.avg((sp[k].OBP || 0) + (sp[k].SLG || 0)), c: C.series(i), tip: `<b>${l}</b><br>${sp[k].PA} PA · AVG ${f.avg(sp[k].AVG)} · OBP ${f.avg(sp[k].OBP)} · SLG ${f.avg(sp[k].SLG)}<br>K% ${f.pct(sp[k]['K%'])} · BB% ${f.pct(sp[k]['BB%'])}` }]), { max: 1.4, lw: 100 }))}
    ${panel('Batted-ball mix', '', C.bars([['GB%', 'Ground balls'], ['ld_pct', 'Line drives'], ['fb_pct', 'Fly balls'], ['pu_pct', 'Pop-ups']].map(([k, l], i) => { const v = { 'GB%': h.spray.gb_pct }[k] ?? h.spray[k]; return { k: l, v, d: f.pct(v), c: C.series(i) }; }), { max: 1 }))}
  </div>${usmNote(p)}`;
}
function usmPitCharts(p) {
  const P = p.pitching, ps = P.pitch_sequence, af = ps.after_first_pitch || {};
  const rows = P.rolling.rows, gl = P.gamelog;
  const rm = ui('roll-up', 'erafip');
  const RM = { erafip: ['ERA & FIP', [['era', 'ERA'], ['fip', 'FIP']], f.n2], kbb: ['K% & BB%', [['k_pct', 'K%'], ['bb_pct', 'BB%']], (v) => f.pct(v)], whip: ['WHIP', [['whip', 'WHIP']], f.n2], ppi: ['Pitches / inning', [['pitches_per_ip', 'P/IP']], f.n1] };
  return `<div class="grid2">
    ${panel('Where batters hit it', `Spray zones of ${P.spray_allowed.located} balls in play against him (from play-by-play).`, C.wedgeSpray(P.spray_allowed))}
    ${panel('Winning the first pitch', 'How batters did after he got ahead 0-1 vs. fell behind 1-0.', C.bars([['0-1', 'After 0-1 (ahead)'], ['1-0', 'After 1-0 (behind)'], ['first_pitch_in_play', '1st pitch put in play']].filter(([k]) => af[k]).map(([k, l], i) => ({ k: l, v: af[k].wOBA, d: f.avg(af[k].wOBA), c: C.series(i), tip: `<b>${l}</b><br>${af[k].PA} PA · AVG ${f.avg(af[k].AVG)} · K% ${f.pct(af[k]['K%'])} · BB% ${f.pct(af[k]['BB%'])}` })), { max: 0.7, lw: 150 }) + '<p class="note">Bars = opponents’ wOBA (lower is better for him).</p>')}
    ${panel('Count by count', 'Opponent wOBA in plate appearances that ended in each count. Blue = he won those.', C.countGrid((b, s) => { const d = P.counts_pa_ended[b + '-' + s]; return d && { n: d.PA, v: d.wOBA, tip: `${d.PA} PA · AVG ${f.avg(d.AVG)} · ${d.K} K · ${d.BB} BB` }; }, { fmt: f.avg }))}
    ${panel('What his pitches turned into', `${ps.pitches} pitches tracked.`, C.bars([['Balls', ps.balls, 'var(--text-muted)'], ['Called strikes', ps.called_strikes, 'var(--s4)'], ['Swinging strikes', ps.swinging_strikes, 'var(--s8)'], ['Fouls', ps.fouls, 'var(--s3)'], ['Put in play', ps.in_play, 'var(--s1)']].map(([k, v, c]) => ({ k, v, d: `${v} (${f.pct(v / ps.pitches, 0)})`, c })), { lw: 120 }))}
    ${panel(`Rolling ${P.rolling.window_games}-game trend`, '', chips('roll-up', Object.entries(RM).map(([k, v]) => [k, v[0]]), rm) + C.line({ series: RM[rm][1].map(([k, l], i) => ({ name: l, color: C.series(i), values: rows.map((r) => r[k]) })), labels: rows.map((r) => r.date), fmt: RM[rm][2] }), 'full')}
    ${panel('Workload by outing', 'Pitches thrown each appearance.', C.line({ series: [{ name: 'Pitches', color: C.series(0), values: gl.map((g) => g.pitches) }], labels: gl.map((g) => g.date), fmt: (v) => Math.round(v), extra: (i) => `<br>vs ${esc(gl[i].opp)} · ${gl[i].IP} IP · ${gl[i].K} K · ${gl[i].ER} ER` }), 'full')}
    ${panel('vs. right-handed and left-handed batters', '', C.bars([['vs_RHB', 'vs RHB'], ['vs_LHB', 'vs LHB']].map(([k, l], i) => { const s = P.splits[k]; return { k: l + ' OPS', v: (s.OBP || 0) + (s.SLG || 0), d: f.avg((s.OBP || 0) + (s.SLG || 0)), c: C.series(i), tip: `<b>${l}</b><br>${s.PA} PA · AVG ${f.avg(s.AVG)} · K% ${f.pct(s['K%'])} · BB% ${f.pct(s['BB%'])}` }; }), { max: 1.2, lw: 100 }))}
  </div>${usmNote(p)}`;
}

// ===== SPLITS =====
function splits(p, side) {
  if (p.team === 'atl') {
    const B = side === 'hitting' ? p.hitting : p.pitching; const S = B.splits || {};
    const order = ['vl', 'vr', 'h', 'a', 'd', 'n', 'risp', 'ron', 'r0', 'lc', 'e'];
    const rows = order.filter((k) => S[k]).map((k) => ({ split: S[k].label, ...S[k] }));
    const cols = side === 'hitting'
      ? [{ h: 'Split', k: 'split' }, { h: 'PA', k: 'plateAppearances' }, { h: 'AVG', f: (r) => f.avg(r.avg) }, { h: 'OBP', f: (r) => f.avg(r.obp) }, { h: 'SLG', f: (r) => f.avg(r.slg) }, { h: 'OPS', f: (r) => f.avg(r.ops) }, { h: 'HR', k: 'homeRuns' }, { h: 'RBI', k: 'rbi' }, { h: 'BB', k: 'baseOnBalls' }, { h: 'K', k: 'strikeOuts' }, { h: 'BABIP', f: (r) => f.avg(r.babip) }]
      : [{ h: 'Split', k: 'split' }, { h: 'BF', k: 'battersFaced' }, { h: 'IP', k: 'inningsPitched' }, { h: 'ERA', f: (r) => f.n2(r.era) }, { h: 'OPP AVG', f: (r) => f.avg(r.avg) }, { h: 'OBP', f: (r) => f.avg(r.obp) }, { h: 'SLG', f: (r) => f.avg(r.slg) }, { h: 'K', k: 'strikeOuts' }, { h: 'BB', k: 'baseOnBalls' }, { h: 'HR', k: 'homeRuns' }, { h: 'WHIP', f: (r) => f.n2(r.whip) }];
    const mcols = [{ h: 'Month', f: (r) => new Date(2026, (r.month || 1) - 1, 1).toLocaleString('en-US', { month: 'long' }) }, ...cols.slice(1)];
    const vs = B.statcast_vs || {};
    const vsRows = Object.entries(vs).map(([k, v]) => ({ split: k.replace('_', ' '), ...v }));
    const vsCols = [{ h: 'Split', k: 'split' }, { h: 'Pitches', k: 'pitches' }, { h: 'PA', k: 'pa' }, { h: 'xwOBA', f: (r) => f.avg(r.xwoba) }, { h: 'wOBA', f: (r) => f.avg(r.woba) }, { h: 'Whiff%', f: (r) => f.pct(r.whiff_pct) }, { h: 'Chase%', f: (r) => f.pct(r.chase_pct) }, { h: 'K%', f: (r) => f.pct(r.k_pct) }, { h: 'BB%', f: (r) => f.pct(r.bb_pct) }, { h: 'avg EV', k: 'avg_ev' }, { h: 'Barrel%', f: (r) => f.pct(r.barrel_pct) }];
    return `<div class="grid2">${panel('Situational splits', 'vs. LHP/RHP, home/away, day/night, runners on, and more (MLB Stats API).', table(cols, rows), 'full')}
      ${panel('By month', '', table(mcols, B.months || []), 'full')}
      ${panel('Statcast by handedness', '', table(vsCols, vsRows), 'full')}
      ${B.postseason ? panel('2026 Postseason', '', kv(Object.entries(B.postseason).filter(([k, v]) => ['gamesPlayed', 'plateAppearances', 'avg', 'obp', 'slg', 'ops', 'homeRuns', 'rbi', 'inningsPitched', 'era', 'strikeOuts', 'whip'].includes(k) && v != null).map(([k, v]) => [k.replace(/([A-Z])/g, ' $1'), typeof v === 'number' && v < 2 && !Number.isInteger(v) ? f.avg(v) : v])), 'full') : ''}</div>`;
  }
  if (side === 'hitting') {
    const S = p.hitting.splits;
    const rows = [['vs RHP', S.vs_RHP], ['vs LHP', S.vs_LHP], ['Home', S.home], ['Away', S.away], ['Neutral site', S.neutral], ['Conference', S.conference], ['Non-conference', S.non_conference],
      ...Object.entries(S.by_inning_group).map(([k, v]) => ['Innings ' + k, v]), ...Object.entries(S.by_month).map(([m, v]) => [new Date(2026, +m - 1, 1).toLocaleString('en-US', { month: 'long' }), v]), ...Object.entries(S.by_lineup_spot).map(([k, v]) => ['Batting ' + k + (k === '1' ? 'st' : k === '2' ? 'nd' : k === '3' ? 'rd' : 'th'), v])]
      .filter(([, v]) => v && v.PA).map(([split, v]) => ({ split, ...v }));
    const cols = [{ h: 'Split', k: 'split' }, { h: 'PA', k: 'PA' }, { h: 'AB', k: 'AB' }, { h: 'H', k: 'H' }, { h: 'HR', k: 'HR' }, { h: 'BB', k: 'BB' }, { h: 'K', k: 'K' }, { h: 'AVG', f: (r) => f.avg(r.AVG) }, { h: 'OBP', f: (r) => f.avg(r.OBP) }, { h: 'SLG', f: (r) => f.avg(r.SLG) }, { h: 'wOBA', f: (r) => f.avg(r.wOBA) }, { h: 'K%', f: (r) => f.pct(r['K%']) }, { h: 'BB%', f: (r) => f.pct(r['BB%']) }];
    return panel('Splits', 'Handedness and inning splits come from play-by-play; the rest from box scores.', table(cols, rows), 'full') + usmNote(p);
  }
  const S = p.pitching.splits;
  const prow = [['As starter', S.as_starter], ['As reliever', S.as_reliever], ['Home', S.home], ['Away', S.away], ['Conference', S.conference], ['Non-conference', S.non_conference], ...Object.entries(S.by_month).map(([m, v]) => [new Date(2026, +m - 1, 1).toLocaleString('en-US', { month: 'long' }), v])].filter(([, v]) => v && v.APP).map(([split, v]) => ({ split, ...v }));
  const pcols = [{ h: 'Split', k: 'split' }, { h: 'G', k: 'APP' }, { h: 'IP', k: 'IP' }, { h: 'ERA', f: (r) => f.n2(r.ERA) }, { h: 'WHIP', f: (r) => f.n2(r.WHIP) }, { h: 'K', k: 'K' }, { h: 'BB', k: 'BB' }, { h: 'HR', k: 'HR' }, { h: 'K%', f: (r) => f.pct(r['K%']) }, { h: 'BB%', f: (r) => f.pct(r['BB%']) }, { h: 'OPP AVG', f: (r) => f.avg(r.OPP_AVG) }, { h: 'FIP', f: (r) => f.n2(r.FIP) }];
  const hrow = [['vs RHB', S.vs_RHB], ['vs LHB', S.vs_LHB], ...Object.entries(S.by_inning_group).map(([k, v]) => ['Innings ' + k, v])].filter(([, v]) => v && v.PA).map(([split, v]) => ({ split, ...v }));
  const hcols = [{ h: 'Split', k: 'split' }, { h: 'PA', g: 'BF', k: 'PA' }, { h: 'AVG', f: (r) => f.avg(r.AVG) }, { h: 'OBP', f: (r) => f.avg(r.OBP) }, { h: 'SLG', f: (r) => f.avg(r.SLG) }, { h: 'wOBA', f: (r) => f.avg(r.wOBA) }, { h: 'K%', f: (r) => f.pct(r['K%']) }, { h: 'BB%', f: (r) => f.pct(r['BB%']) }, { h: 'HR', k: 'HR' }];
  return `<div class="grid2">${panel('Box-score splits', '', table(pcols, prow), 'full')}${panel('Opponent splits (play-by-play)', '', table(hcols, hrow), 'full')}</div>` + usmNote(p);
}

// ===== GAME LOG =====
function gamelog(p, side) {
  if (p.team === 'atl') {
    if (side === 'hitting') {
      const rows = [...p.hitting.gamelog].reverse();
      return panel('Game log', 'Every game, newest first. "P" = postseason. xwOBA and max EV come from Statcast for that game.', table([
        { h: 'Date', f: (r) => r.date.slice(5) + (r.gt === 'P' ? ' <span class="badge">P</span>' : '') }, { h: 'Opp', f: (r) => (r.home ? 'vs ' : '@ ') + esc((r.opp || '').split(' ').slice(-1)[0]) }, { h: 'W/L', f: (r) => (r.win ? 'W' : 'L'), cls: (r) => (r.win ? 'w' : 'l') },
        { h: 'PA', k: 'plateAppearances' }, { h: 'AB', k: 'atBats' }, { h: 'H', k: 'hits' }, { h: '2B', k: 'doubles' }, { h: '3B', k: 'triples' }, { h: 'HR', k: 'homeRuns' }, { h: 'R', k: 'runs' }, { h: 'RBI', k: 'rbi' }, { h: 'BB', k: 'baseOnBalls' }, { h: 'K', k: 'strikeOuts' }, { h: 'SB', k: 'stolenBases' },
        { h: 'xwOBA', f: (r) => (r.sc && r.sc.woba_den ? f.avg(r.sc.xwoba_num / r.sc.woba_den) : '—') }, { h: 'max EV', f: (r) => (r.sc ? r.sc.max_ev ?? '—' : '—') }, { h: 'Pitches', f: (r) => r.numberOfPitches }], rows), { maxH: 640 }, 'full');
    }
    const rows = [...p.pitching.gamelog].reverse();
    return panel('Game log', 'Every outing, newest first. Velo = average 4-seam (or sinker) speed that day.', table([
      { h: 'Date', f: (r) => r.date.slice(5) + (r.gt === 'P' ? ' <span class="badge">P</span>' : '') }, { h: 'Opp', f: (r) => (r.home ? 'vs ' : '@ ') + esc((r.opp || '').split(' ').slice(-1)[0]) }, { h: 'Dec', f: (r) => (r.wins ? 'W' : r.losses ? 'L' : r.saves ? 'SV' : r.holds ? 'HLD' : ''), cls: (r) => (r.wins ? 'w' : r.losses ? 'l' : '') },
      { h: 'IP', k: 'inningsPitched' }, { h: 'H', k: 'hits' }, { h: 'R', k: 'runs' }, { h: 'ER', g: 'ERA', k: 'earnedRuns' }, { h: 'BB', k: 'baseOnBalls' }, { h: 'K', k: 'strikeOuts' }, { h: 'HR', k: 'homeRuns' }, { h: 'Pitches', k: 'numberOfPitches' },
      { h: 'Whiffs', g: 'Whiff%', f: (r) => (r.sc ? r.sc.whiffs : '—') }, { h: 'CSW%', f: (r) => (r.sc ? f.pct((r.sc.whiffs + r.sc.called) / r.sc.pitches, 0) : '—') }, { h: 'Velo', f: (r) => (r.sc && r.sc.velo ? r.sc.velo.FF ?? r.sc.velo.SI ?? '—' : '—') }, { h: 'Game ERA', g: 'ERA', f: (r) => f.n2(r.era) }], rows), { maxH: 640 }, 'full');
  }
  if (side === 'hitting') {
    const cum = Object.fromEntries(p.hitting.cumulative.map((c, i) => [i, c]));
    const rows = p.hitting.gamelog.map((g, i) => ({ ...g, cavg: cum[i] && cum[i].avg, cops: cum[i] && cum[i].ops })).reverse();
    return panel('Game log', 'Newest first. AVG and OPS are season-to-date after that game.', table([
      { h: 'Date', f: (r) => r.date.slice(5) }, { h: 'Opp', f: (r) => (r.neutral ? 'vs ' : r.home ? 'vs ' : '@ ') + esc(r.opp) + (r.conf ? ' *' : '') }, { h: 'W/L', f: (r) => r.result + ' ' + r.score, cls: (r) => (r.result === 'W' ? 'w' : 'l') },
      { h: 'Spot', g: 'G', k: 'spot' }, { h: 'Pos', g: 'G', k: 'pos' }, { h: 'AB', k: 'AB' }, { h: 'R', k: 'R' }, { h: 'H', k: 'H' }, { h: '2B', k: '2B' }, { h: '3B', k: '3B' }, { h: 'HR', k: 'HR' }, { h: 'RBI', k: 'RBI' }, { h: 'BB', k: 'BB' }, { h: 'K', k: 'K' }, { h: 'SB', k: 'SB' }, { h: 'AVG', f: (r) => f.avg(r.cavg) }, { h: 'OPS', f: (r) => f.avg(r.cops) }], rows), { maxH: 640 }, 'full') + '<p class="note">* = conference game</p>';
  }
  const rows = [...p.pitching.gamelog].reverse();
  return panel('Game log', 'Newest first.', table([
    { h: 'Date', f: (r) => r.date.slice(5) }, { h: 'Opp', f: (r) => (r.home ? 'vs ' : '@ ') + esc(r.opp) + (r.conf ? ' *' : '') }, { h: 'Team', g: 'W', f: (r) => r.result + ' ' + r.score, cls: (r) => (r.result === 'W' ? 'w' : 'l') }, { h: 'Dec', g: 'W', k: 'dec' }, { h: 'GS', f: (r) => (r.start ? '✓' : '') },
    { h: 'IP', k: 'IP' }, { h: 'H', k: 'H' }, { h: 'R', k: 'R' }, { h: 'ER', g: 'ERA', k: 'ER' }, { h: 'BB', k: 'BB' }, { h: 'K', k: 'K' }, { h: 'HR', k: 'HR' }, { h: 'BF', k: 'BF' }, { h: 'Pitches', k: 'pitches' }], rows), { maxH: 640 }, 'full');
}

// ===== ALL STATS =====
function allStats(p, side) {
  const B = side === 'hitting' ? p.hitting : p.pitching;
  const blocks = [];
  const flat = (title, o) => { if (!o) return; const rows = Object.entries(o).filter(([, v]) => v != null && typeof v !== 'object').map(([k, v]) => [k, typeof v === 'number' && !Number.isInteger(v) ? +v.toFixed(3) : v, k]); if (rows.length) blocks.push(panel(title, '', kv(rows), 'full')); };
  if (p.team === 'atl') { flat('Season (MLB Stats API)', B.season); flat('Advanced', B.advanced); flat('Sabermetrics', B.sabermetrics); flat('Statcast (computed from every pitch)', B.statcast); flat('Expected stats (MLB)', B.expected_api); flat('Bat tracking leaderboard', side === 'hitting' ? p.bat_tracking_lb : null); flat('Swing/take run values', side === 'hitting' ? p.swing_take : null); flat('Sprint speed', p.running.sprint); flat('Outs above average', p.fielding.oaa); flat('Arm strength', p.fielding.arm); flat('Catcher framing', p.fielding.framing); flat('Pop time', p.fielding.poptime); (p.fielding.by_position || []).forEach((fp) => flat('Fielding — ' + fp.position, fp)); }
  else { flat('Season', B.season); flat(side === 'hitting' ? 'Plate discipline' : 'Pitch sequence', side === 'hitting' ? B.plate_discipline : B.pitch_sequence); flat('Fielding', p.fielding); }
  return `<div class="grid2">${blocks.join('')}${panel('Data for agents', 'The full machine-readable profile behind this page.', `<a class="chip" href="data/players/${p.id}.json" target="_blank" rel="noopener">Open raw JSON</a>`, 'full')}</div>`;
}

// ---------- boot ----------
document.getElementById('back').addEventListener('click', () => (history.length > 1 ? history.back() : nav('')));
document.getElementById('theme').addEventListener('click', () => {
  const cur = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = cur; try { localStorage.setItem('theme', cur); } catch (e) {}
  route();
});
document.querySelector('#gloss .x').addEventListener('click', () => document.getElementById('gloss').classList.remove('on'));
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-spray]'); if (!b) return;
  const s = new Set(ui('spray-show', '1B,2B,3B,HR,Out').split(',')); s.has(b.dataset.spray) ? s.delete(b.dataset.spray) : s.add(b.dataset.spray);
  state.ui['spray-show'] = [...s].join(','); route();
});
try { const t = localStorage.getItem('theme'); if (t) document.documentElement.dataset.theme = t; else if (matchMedia('(prefers-color-scheme: light)').matches) document.documentElement.dataset.theme = 'light'; } catch (e) {}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
route();

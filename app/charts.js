// Tiny SVG chart kit — no dependencies. Every chart returns an HTML string; interactive
// hooks are registered with C.after() and run by C.mount() once the HTML is in the page.
(function () {
  const C = (window.C = {});
  let hooks = [];
  let uid = 0;
  C.id = () => 'c' + ++uid;
  C.after = (fn) => hooks.push(fn);
  C.mount = () => { const h = hooks; hooks = []; h.forEach((f) => { try { f(); } catch (e) { console.error(e); } }); };

  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const hex2rgb = (h) => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
  const mix = (a, b, t) => { const A = hex2rgb(a), B = hex2rgb(b); return 'rgb(' + A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',') + ')'; };
  const ramp = (stops, t) => { t = Math.max(0, Math.min(1, t)); const n = stops.length - 1; const i = Math.min(n - 1, Math.floor(t * n)); return mix(stops[i], stops[i + 1], t * n - i); };
  C.seq = (t) => ramp(['--seq-0', '--seq-1', '--seq-2', '--seq-3', '--seq-4', '--seq-5'].map(css), t);
  // diverging: t in [-1, 1]; blue = low, gray = middle, red = high
  C.div = (t) => { const s = ['--cold-3', '--cold-2', '--cold-1', '--mid', '--hot-1', '--hot-2', '--hot-3'].map(css); return ramp(s, (t + 1) / 2); };
  C.textOn = (rgb) => { const m = rgb.match(/\d+/g); if (!m) return css('--text-primary'); const [r, g, b] = m.map(Number); return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#111' : '#fff'; };
  C.series = (i) => css('--s' + (((i % 8) + 8) % 8 + 1));

  // Fixed pitch-type colors: color follows the pitch, never its rank.
  const PT = { FF: 8, SI: 2, FC: 5, SL: 4, ST: 3, SV: 1, CU: 1, KC: 7, CS: 1, CH: 6, FS: 6, FO: 6, SC: 6 };
  C.ptColor = (t) => (PT[t] ? css('--s' + PT[t]) : css('--text-muted'));
  C.PT_NAMES = { FF: '4-Seam Fastball', SI: 'Sinker', FC: 'Cutter', SL: 'Slider', ST: 'Sweeper', SV: 'Slurve', CU: 'Curveball', KC: 'Knuckle Curve', CS: 'Slow Curve', CH: 'Changeup', FS: 'Splitter', FO: 'Forkball', SC: 'Screwball', KN: 'Knuckleball', EP: 'Eephus', PO: 'Pitchout' };

  C.f = {
    avg: (v) => (v == null ? '—' : (v >= 1 ? v.toFixed(3) : v.toFixed(3).replace(/^0/, ''))),
    pct: (v, d = 1) => (v == null ? '—' : (v * 100).toFixed(d) + '%'),
    n1: (v) => (v == null ? '—' : Number(v).toFixed(1)),
    n2: (v) => (v == null ? '—' : Number(v).toFixed(2)),
    n0: (v) => (v == null ? '—' : Math.round(v).toString()),
    int: (v) => (v == null ? '—' : String(v)),
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  C.esc = esc;
  const tipAttr = (html) => ` data-tip="${esc(html)}"`;
  C.tipAttr = tipAttr;

  // ---------- Strike-zone map (13 Statcast zones, catcher's view) ----------
  C.zoneMap = function (zones, opt) {
    const { key, mid, span, fmt, minN = 5, seq = false, side } = opt;
    const X0 = 75, Y0 = 55, S = 50;
    const val = (z) => { const d = zones[z] || {}; return d.n >= minN ? d[key] : null; };
    const maxV = seq ? Math.max(...Object.keys(zones).map((z) => val(z) || 0), 0.0001) : 1;
    const fill = (v) => (v == null ? css('--surface-3') : seq ? C.seq(0.12 + 0.88 * (v / maxV)) : C.div((v - mid) / span));
    const tip = (z) => { const d = zones[z] || {}; return `<b>Zone ${z}</b>${+z > 10 ? ' (outside)' : ''}<br>Pitches: ${d.n || 0}${d.pct != null ? ' (' + C.f.pct(d.pct) + ')' : ''}<br>Swing%: ${C.f.pct(d.swing)} · Whiff%: ${C.f.pct(d.whiff)}<br>AVG ${C.f.avg(d.ba)} · SLG ${C.f.avg(d.slg)} · xwOBA ${C.f.avg(d.xwoba)}${d.ev ? '<br>Avg EV ' + d.ev + ' mph' : ''}`; };
    let s = `<svg viewBox="0 0 300 330" width="100%" style="max-width:340px;display:block;margin:0 auto" role="img" aria-label="Strike zone map">`;
    const quads = { 11: [[30, 10], [150, 10], [150, Y0], [X0, Y0], [X0, 130], [30, 130]], 12: [[150, 10], [270, 10], [270, 130], [225, 130], [225, Y0], [150, Y0]],
      13: [[30, 130], [X0, 130], [X0, 205], [150, 205], [150, 250], [30, 250]], 14: [[225, 130], [270, 130], [270, 250], [150, 250], [150, 205], [225, 205]] };
    const qlab = { 11: [52, 32], 12: [248, 32], 13: [52, 236], 14: [248, 236] };
    for (const z of [11, 12, 13, 14]) {
      const v = val(z), c = fill(v);
      s += `<polygon points="${quads[z].map((p) => p.join(',')).join(' ')}" fill="${c}" stroke="${css('--surface-1')}" stroke-width="2"${tipAttr(tip(z))}/>`;
      s += `<text x="${qlab[z][0]}" y="${qlab[z][1]}" text-anchor="middle" class="val" style="fill:${C.textOn(c)};font-size:11px;pointer-events:none">${v == null ? '' : fmt(v)}</text>`;
    }
    for (let i = 0; i < 9; i++) {
      const z = i + 1, x = X0 + (i % 3) * S, y = Y0 + Math.floor(i / 3) * S, v = val(z), c = fill(v);
      s += `<rect x="${x}" y="${y}" width="${S}" height="${S}" fill="${c}" stroke="${css('--surface-1')}" stroke-width="2" rx="3"${tipAttr(tip(z))}/>`;
      s += `<text x="${x + S / 2}" y="${y + S / 2 + 4}" text-anchor="middle" class="val" style="fill:${C.textOn(c)};pointer-events:none">${v == null ? '·' : fmt(v)}</text>`;
    }
    s += `<rect x="${X0}" y="${Y0}" width="${S * 3}" height="${S * 3}" fill="none" stroke="${css('--text-primary')}" stroke-width="1.5" rx="3" pointer-events="none"/>`;
    s += `<path d="M130 282 L170 282 L170 292 L150 304 L130 292 Z" fill="none" stroke="${css('--text-muted')}" stroke-width="1.5"/>`;
    if (side) {
      const bx = side === 'L' ? 245 : 30;
      s += `<text x="${bx + 12}" y="296" text-anchor="middle" class="lbl">${side === 'L' ? 'LHB' : side === 'R' ? 'RHB' : ''}</text>`;
    }
    s += `<text x="150" y="324" text-anchor="middle" class="lbl">catcher's view · gray = fewer than ${minN} pitches</text></svg>`;
    return s;
  };

  // ---------- Location heat map (10x10 grid) ----------
  C.heat = function (H, opt) {
    const { mat, szTop = 3.4, szBot = 1.6, label = 'pitches', rateOf } = opt;
    const xe = H.x_edges, ze = H.z_edges, rows = H.pitches.length, cols = H.pitches[0].length;
    const W = 260, Ht = 260, P = 20;
    const sx = (x) => P + ((x - xe[0]) / (xe[xe.length - 1] - xe[0])) * W;
    const sz = (z) => P + (1 - (z - ze[0]) / (ze[ze.length - 1] - ze[0])) * Ht;
    let grid = [];
    for (let r = 0; r < rows; r++) { grid.push([]); for (let c = 0; c < cols; c++) {
      let v;
      if (rateOf) { const num = H[mat][r][c], den = H[rateOf][r][c]; v = den >= 4 ? num / den : null; }
      else v = H[mat][r][c];
      grid[r].push(v);
    } }
    const max = Math.max(...grid.flat().filter((v) => v != null), 0.0001);
    const cw = W / cols, ch = Ht / rows;
    let s = `<svg viewBox="0 0 ${W + 2 * P} ${Ht + 2 * P + 26}" width="100%" style="max-width:330px;display:block;margin:0 auto" role="img" aria-label="Location heat map">`;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const v = grid[r][c];
      const fill = v == null || v === 0 ? css('--surface-2') : C.seq(0.1 + 0.9 * (v / max));
      const zTop = ze[ze.length - 1 - r], zBot = ze[ze.length - 2 - r];
      const t = rateOf ? `${C.f.pct(v)} (${H[mat][r][c]} of ${H[rateOf][r][c]})` : `${v} ${label}`;
      s += `<rect x="${P + c * cw}" y="${P + r * ch}" width="${cw + 0.5}" height="${ch + 0.5}" fill="${fill}"${tipAttr(`<b>${t}</b><br>height ${zBot.toFixed(1)}–${zTop.toFixed(1)} ft · side ${xe[c].toFixed(1)} to ${xe[c + 1].toFixed(1)} ft`)}/>`;
    }
    s += `<rect x="${sx(-0.83)}" y="${sz(szTop)}" width="${sx(0.83) - sx(-0.83)}" height="${sz(szBot) - sz(szTop)}" fill="none" stroke="${css('--text-primary')}" stroke-width="2" pointer-events="none"/>`;
    s += `<path d="M${sx(-0.71)} ${Ht + P + 8} h${sx(0.71) - sx(-0.71)} v5 l${-(sx(0.71) - sx(-0.71)) / 2} 7 l${-(sx(0.71) - sx(-0.71)) / 2} -7 z" fill="none" stroke="${css('--text-muted')}"/>`;
    s += `<text x="${P + W / 2}" y="${Ht + 2 * P + 22}" text-anchor="middle" class="lbl">catcher's view · darker = more${rateOf ? ' (rate)' : ''}</text></svg>`;
    return s;
  };

  // ---------- Field + spray chart (Statcast hit coordinates, feet) ----------
  function field(scale, ox, oy) {
    const p = (x, y) => `${(ox + x * scale).toFixed(1)},${(oy - y * scale).toFixed(1)}`;
    const d45 = Math.SQRT1_2;
    const lf = [-345 * d45, 345 * d45], rf = [345 * d45, 345 * d45];
    let s = `<path d="M${p(0, 0)} L${p(lf[0], lf[1])} C${p(-130, 470)} ${p(130, 470)} ${p(rf[0], rf[1])} Z" fill="${css('--surface-2')}" stroke="${css('--line')}"/>`;
    s += `<path d="M${p(0, 0)} L${p(-95 * d45, 95 * d45)} Q${p(0, 175)} ${p(95 * d45, 95 * d45)} Z" fill="${css('--surface-3')}" stroke="none"/>`;
    s += `<path d="M${p(0, 0)} L${p(63.6, 63.6)} L${p(0, 127.3)} L${p(-63.6, 63.6)} Z" fill="none" stroke="${css('--text-muted')}" stroke-width="1"/>`;
    s += `<line x1="${p(0, 0).split(',')[0]}" y1="${p(0, 0).split(',')[1]}" x2="${p(lf[0], lf[1]).split(',')[0]}" y2="${p(lf[0], lf[1]).split(',')[1]}" stroke="${css('--text-muted')}"/>`;
    s += `<line x1="${p(0, 0).split(',')[0]}" y1="${p(0, 0).split(',')[1]}" x2="${p(rf[0], rf[1]).split(',')[0]}" y2="${p(rf[0], rf[1]).split(',')[1]}" stroke="${css('--text-muted')}"/>`;
    return s;
  }
  const RES = { single: ['1B', 1], double: ['2B', 3], triple: ['3B', 4], home_run: ['HR', 8] };
  C.resultColor = (e) => (RES[e] ? css('--s' + RES[e][1]) : css('--text-muted'));
  C.spray = function (pts, opt = {}) {
    const W = 340, H = 300, sc = 0.62, ox = 170, oy = 288;
    const show = opt.show || null;
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:420px;display:block;margin:0 auto" role="img" aria-label="Spray chart">` + field(sc, ox, oy);
    const sorted = [...pts].sort((a, b) => (RES[a[4]] ? 1 : 0) - (RES[b[4]] ? 1 : 0));
    for (const [x, y, ev, la, e, bt, dt] of sorted) {
      if (x == null) continue;
      const cat = RES[e] ? RES[e][0] : 'Out';
      if (show && !show.has(cat)) continue;
      const hit = !!RES[e];
      s += `<circle cx="${(ox + x * sc).toFixed(1)}" cy="${(oy - y * sc).toFixed(1)}" r="${hit ? 4.2 : 3.2}" fill="${C.resultColor(e)}" fill-opacity="${hit ? 0.95 : 0.45}" stroke="${css('--surface-1')}" stroke-width="1"${tipAttr(`<b>${(e || '').replace(/_/g, ' ')}</b> · ${dt}<br>${ev ? ev + ' mph' : '—'} · ${la != null ? la + '°' : '—'} · ${Math.round(Math.hypot(x, y))} ft`)}/>`;
    }
    return s + '</svg>';
  };

  // ---------- Zone-wedge spray for college (no coordinates) ----------
  const WEDGE = { LL: [-45, -37, 'OF'], LF: [-37, -21, 'OF'], LC: [-21, -7, 'OF'], CF: [-7, 7, 'OF'], RC: [7, 21, 'OF'], RF: [21, 37, 'OF'], RL: [37, 45, 'OF'],
    '3B': [-45, -27, 'IF'], 'IF-L': [-27, -21, 'IF'], SS: [-21, -5, 'IF'], 'IF-M': [-5, 5, 'IF'], '2B': [5, 21, 'IF'], 'IF-R': [21, 27, 'IF'], '1B': [27, 45, 'IF'] };
  const ZNAME = { LL: 'LF line', LF: 'Left field', LC: 'Left-center', CF: 'Center field', RC: 'Right-center', RF: 'Right field', RL: 'RF line', '3B': 'Third base', 'IF-L': 'Through the left side', SS: 'Shortstop', 'IF-M': 'Up the middle', '2B': 'Second base', 'IF-R': 'Through the right side', '1B': 'First base', P: 'Pitcher', C: 'Catcher' };
  C.wedgeSpray = function (sp, opt = {}) {
    const W = 340, H = 300, sc = 0.62, ox = 170, oy = 288;
    const zs = sp.zones || {}, tot = sp.located || 1;
    const max = Math.max(...Object.values(zs).map((z) => z.n), 1);
    const pt = (ang, r) => { const a = (ang * Math.PI) / 180; return [ox + Math.sin(a) * r * sc, oy - Math.cos(a) * r * sc]; };
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:420px;display:block;margin:0 auto" role="img" aria-label="Spray zones">` + field(sc, ox, oy);
    for (const [k, [a0, a1, depth]] of Object.entries(WEDGE)) {
      const z = zs[k] || { n: 0, hits: 0, xbh: 0, hr: 0 };
      const [r0, r1] = depth === 'OF' ? [165, k === 'CF' ? 395 : k === 'LC' || k === 'RC' ? 370 : 330] : [55, 150];
      const A = pt(a0, r0), B = pt(a0, r1), Cc = pt(a1, r1), D = pt(a1, r0);
      const fill = z.n ? C.seq(0.15 + 0.85 * (z.n / max)) : css('--surface-2');
      const tip = `<b>${ZNAME[k]}</b><br>${z.n} balls in play (${C.f.pct(z.n / tot, 0)})<br>${z.hits} hits · ${z.xbh} extra-base · ${z.hr} HR`;
      s += `<path d="M${A} L${B} A${r1 * sc} ${r1 * sc} 0 0 1 ${Cc} L${D} A${r0 * sc} ${r0 * sc} 0 0 0 ${A} Z" fill="${fill}" fill-opacity="${z.n ? 0.92 : 0.4}" stroke="${css('--surface-1')}" stroke-width="2"${tipAttr(tip)}/>`;
      if (z.n) { const m = pt((a0 + a1) / 2, (r0 + r1) / 2); s += `<text x="${m[0]}" y="${m[1] + 4}" text-anchor="middle" class="val" style="font-size:${depth === 'IF' && (a1 - a0) < 10 ? 9 : 12}px;fill:${C.textOn(fill)};pointer-events:none">${z.n}</text>`; }
    }
    const pc = (zs.P ? zs.P.n : 0) + (zs.C ? zs.C.n : 0);
    if (pc) s += `<circle cx="${ox}" cy="${oy - 55 * sc}" r="10" fill="${C.seq(0.15 + 0.85 * pc / max)}"${tipAttr(`<b>Pitcher / catcher</b><br>${pc} balls in play`)}/><text x="${ox}" y="${oy - 55 * sc + 4}" text-anchor="middle" class="val" style="font-size:10px;pointer-events:none;fill:${C.textOn(C.seq(0.15 + 0.85 * pc / max))}">${pc}</text>`;
    return s + '</svg>';
  };

  // ---------- Line chart with crosshair ----------
  C.line = function (opt) {
    const id = C.id();
    const { series, labels, fmt = C.f.avg, ref, refLabel, yMin, yMax, height = 230 } = opt;
    const W = Math.round(Math.min(680, Math.max(300, (window.innerWidth || 680) - 60))), H = Math.round(W < 500 ? Math.max(170, height * 0.85) : height), L = 46, R = 14, T = 14, B = 28;
    const all = series.flatMap((s) => s.values.filter((v) => v != null));
    if (!all.length) return '<div class="empty">Not enough data yet.</div>';
    let lo = yMin != null ? yMin : Math.min(...all, ref != null ? ref : Infinity), hi = yMax != null ? yMax : Math.max(...all, ref != null ? ref : -Infinity);
    const pad = (hi - lo) * 0.08 || 0.01; const nonneg = Math.min(...all) >= 0; lo -= yMin != null ? 0 : pad; hi += yMax != null ? 0 : pad; if (nonneg && lo < 0) lo = 0;
    const n = labels.length;
    const x = (i) => L + (n <= 1 ? (W - L - R) / 2 : (i / (n - 1)) * (W - L - R));
    const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    let s = `<svg id="${id}" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(opt.title || 'line chart')}" style="touch-action:pan-y">`;
    for (let k = 0; k <= 4; k++) { const v = lo + ((hi - lo) * k) / 4; s += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="gridl"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" class="lbl">${fmt(v)}</text>`; }
    const months = {};
    labels.forEach((d, i) => { const m = String(d).slice(0, 7); if (!(m in months)) months[m] = i; });
    let lastX = -999;
    for (const [m, i] of Object.entries(months)) { if (x(i) - lastX < 34) continue; lastX = x(i); const dt = new Date(m + '-15T12:00'); s += `<text x="${x(i)}" y="${H - 8}" class="lbl">${dt.toLocaleString('en-US', { month: 'short' })}</text>`; }
    if (ref != null) s += `<line x1="${L}" x2="${W - R}" y1="${y(ref)}" y2="${y(ref)}" stroke="${css('--text-muted')}" stroke-dasharray="4 4"/><text x="${W - R}" y="${y(ref) - 5}" text-anchor="end" class="lbl">${esc(refLabel || '')}</text>`;
    series.forEach((se) => {
      let d = '', pen = false;
      se.values.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); pen = true; });
      s += `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    });
    s += `<line class="xh" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="${css('--text-muted')}" style="display:none"/>`;
    series.forEach((se, k) => (s += `<circle class="xd${k}" r="4.5" fill="${se.color}" stroke="${css('--surface-1')}" stroke-width="2" style="display:none"/>`));
    s += `<rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" class="hit"/></svg>`;
    C.after(() => {
      const el = document.getElementById(id); if (!el) return;
      const hit = el.querySelector('.hit'), xh = el.querySelector('.xh');
      const move = (ev) => {
        const r = el.getBoundingClientRect(); const px = ((ev.clientX - r.left) / r.width) * W;
        const i = Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - R)) * (n - 1))));
        xh.setAttribute('x1', x(i)); xh.setAttribute('x2', x(i)); xh.style.display = '';
        let html = `<b>${esc(labels[i])}</b>` + (opt.extra ? opt.extra(i) : '');
        series.forEach((se, k) => {
          const dot = el.querySelector('.xd' + k), v = se.values[i];
          if (v == null) { dot.style.display = 'none'; return; }
          dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(v)); dot.style.display = '';
          html += `<br><span class="sw" style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${se.color};margin-right:5px"></span>${esc(se.name)}: <b>${fmt(v)}</b>`;
        });
        window.showTip(html, ev.clientX, ev.clientY);
      };
      const leave = () => { xh.style.display = 'none'; el.querySelectorAll('[class^=xd]').forEach((d) => (d.style.display = 'none')); window.hideTip(); };
      hit.addEventListener('pointermove', move); hit.addEventListener('pointerdown', move); hit.addEventListener('pointerleave', leave);
    });
    const leg = series.length > 1 ? `<div class="legend">${series.map((se) => `<span><span class="sw" style="background:${se.color}"></span>${esc(se.name)}</span>`).join('')}</div>` : '';
    return leg + s;
  };

  // ---------- Scatter ----------
  C.scatter = function (opt) {
    const { pts, xr, yr, xl, yl, height = 300, bands = [], guides = [], r = 3, centroids = [] } = opt;
    const W = 420, H = height, L = 40, R = 12, T = 12, B = 34;
    const x = (v) => L + ((v - xr[0]) / (xr[1] - xr[0])) * (W - L - R);
    const y = (v) => T + (1 - (v - yr[0]) / (yr[1] - yr[0])) * (H - T - B);
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:520px;display:block;margin:0 auto" role="img" aria-label="${esc(opt.title || 'scatter')}">`;
    for (const b of bands) s += `<rect x="${x(b.x0 ?? xr[0])}" y="${y(b.y1 ?? yr[1])}" width="${x(b.x1 ?? xr[1]) - x(b.x0 ?? xr[0])}" height="${y(b.y0 ?? yr[0]) - y(b.y1 ?? yr[1])}" fill="${css('--surface-3')}" opacity=".7"/>` + (b.label ? `<text x="${x(b.x0 ?? xr[0]) + 4}" y="${y(b.y1 ?? yr[1]) + 12}" class="lbl">${esc(b.label)}</text>` : '');
    const tick = (lo, hi) => { const st = Math.pow(10, Math.floor(Math.log10((hi - lo) / 4))); const m = [1, 2, 2.5, 5, 10].find((k) => (hi - lo) / (st * k) <= 6) * st; const out = []; for (let v = Math.ceil(lo / m) * m; v <= hi + 1e-9; v += m) out.push(+v.toFixed(6)); return out; };
    for (const v of tick(...yr)) s += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="gridl"/><text x="${L - 5}" y="${y(v) + 4}" text-anchor="end" class="lbl">${v}</text>`;
    for (const v of tick(...xr)) s += `<text x="${x(v)}" y="${H - B + 14}" text-anchor="middle" class="lbl">${v}</text>`;
    for (const g of guides) s += g.x != null ? `<line x1="${x(g.x)}" x2="${x(g.x)}" y1="${T}" y2="${H - B}" stroke="${css('--text-muted')}" stroke-dasharray="3 4"/>` : `<line x1="${L}" x2="${W - R}" y1="${y(g.y)}" y2="${y(g.y)}" stroke="${css('--text-muted')}" stroke-dasharray="3 4"/>` + (g.label ? `<text x="${W - R}" y="${y(g.y) - 4}" text-anchor="end" class="lbl">${esc(g.label)}</text>` : '');
    s += `<text x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle" class="lbl">${esc(xl)}</text><text transform="translate(11 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle" class="lbl">${esc(yl)}</text>`;
    for (const p of pts) {
      if (p.x == null || p.y == null || p.x < xr[0] || p.x > xr[1] || p.y < yr[0] || p.y > yr[1]) continue;
      s += `<circle cx="${x(p.x).toFixed(1)}" cy="${y(p.y).toFixed(1)}" r="${p.r || r}" fill="${p.c}" fill-opacity="${p.o ?? 0.7}" stroke="${css('--surface-1')}" stroke-width=".8"${p.tip ? tipAttr(p.tip) : ''}/>`;
    }
    for (const c of centroids) s += `<circle cx="${x(c.x)}" cy="${y(c.y)}" r="9" fill="${c.c}" stroke="${css('--text-primary')}" stroke-width="2"${tipAttr(c.tip || '')}/><text x="${x(c.x)}" y="${y(c.y) - 13}" text-anchor="middle" class="val" style="font-size:11px">${esc(c.label)}</text>`;
    return s + '</svg>';
  };

  // ---------- Horizontal bars ----------
  C.bars = function (rows, opt = {}) {
    const max = opt.max || Math.max(...rows.map((r) => Math.abs(r.v || 0)), 0.0001);
    return `<div style="display:grid;gap:7px">` + rows.map((r) => `
      <div style="display:grid;grid-template-columns:${opt.lw || 110}px 1fr ${opt.vw || 86}px;align-items:center;gap:8px;font-size:13px"${r.tip ? tipAttr(r.tip) : ''}>
        <div style="color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.sw ? `<span class="sw" style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${r.sw};margin-right:6px;vertical-align:-1px"></span>` : ''}${esc(r.k)}</div>
        <div style="height:12px;background:var(--surface-2);border-radius:4px;overflow:hidden"><div style="height:100%;width:${Math.max(0, (Math.abs(r.v || 0) / max) * 100)}%;background:${r.c || 'var(--s1)'};border-radius:0 4px 4px 0"></div></div>
        <div style="text-align:right;font-weight:700;font-variant-numeric:tabular-nums">${r.d}</div></div>`).join('') + '</div>';
  };

  // ---------- Count grid (balls x strikes) ----------
  C.countGrid = function (getter, opt = {}) {
    const mid = opt.mid ?? 0.315, span = opt.span ?? 0.2;
    let s = `<div style="display:grid;grid-template-columns:44px repeat(3,1fr);gap:4px;font-size:12px;max-width:380px;margin:0 auto"><div></div>`;
    for (let k = 0; k < 3; k++) s += `<div style="text-align:center;color:var(--text-muted)">${k} strike${k === 1 ? '' : 's'}</div>`;
    for (let b = 0; b < 4; b++) {
      s += `<div style="color:var(--text-muted);display:flex;align-items:center">${b} ball${b === 1 ? '' : 's'}</div>`;
      for (let k = 0; k < 3; k++) {
        const d = getter(b, k);
        const ok = d && d.n >= (opt.minN || 3) && d.v != null;
        const c = ok ? C.div((d.v - mid) / span) : css('--surface-2');
        s += `<div style="background:${c};color:${ok ? C.textOn(c) : 'var(--text-muted)'};border-radius:8px;padding:8px 4px;text-align:center"${tipAttr(`<b>Count ${b}-${k}</b><br>${d ? d.tip : 'no data'}`)}><div style="font-weight:800;font-size:15px">${ok ? opt.fmt(d.v) : '—'}</div><div style="opacity:.8;font-size:10.5px">${d ? d.n : 0} ${opt.unit || 'PA'}</div></div>`;
      }
    }
    return s + '</div>';
  };

  // ---------- Percentile bar (Savant style) ----------
  C.pctBar = function (label, pct, raw, gkey) {
    if (pct == null) return '';
    const c = C.div((pct - 50) / 50);
    return `<div class="pct"><div class="k" data-gloss="${esc(gkey || label)}">${esc(label)}</div><div class="track"><div class="fill" style="width:${pct}%;background:${c};opacity:.5"></div><div class="dot" style="left:${Math.max(4, Math.min(96, pct))}%;background:${c};color:${C.textOn(c)}">${pct}</div></div><div class="raw">${raw ?? ''}</div></div>`;
  };

  // ---------- W/L strip ----------
  C.strip = function (games) {
    return `<div style="display:flex;flex-wrap:wrap;gap:2px">` + games.map((g) => {
      const w = g.result === 'W'; const diff = (g.us ?? 0) - (g.them ?? 0);
      return `<div style="width:9px;height:${10 + Math.min(18, Math.abs(diff) * 2)}px;align-self:${w ? 'flex-end' : 'flex-start'};background:${w ? 'var(--s6)' : 'var(--s8)'};border-radius:2px"${tipAttr(`<b>${g.date}</b> ${g.home ? 'vs' : '@'} ${esc(g.opp)}<br>${w ? 'W' : 'L'} ${g.us}-${g.them}`)}></div>`;
    }).join('') + '</div>';
  };
})();

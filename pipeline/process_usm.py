"""Build per-player JSON for Southern Miss baseball 2026 from Sidearm box scores + play-by-play.
Input: raw/usm/usm_2026_raw.json (made by .pipeline/extract_usm.py on the vault machine)
Output: out/players/usm-<rosterPlayerId>.json + out/usm_index.json + out/usm_team.json"""
import json, re, os, collections, math
import os as _os
W = _os.environ.get('CB_WORK', '/home/claude/cb')

RAW = W + '/raw/usm/usm_2026_raw.json'
OUT = W + '/out/players'
os.makedirs(OUT, exist_ok=True)
LW = {'bb': .691, 'hbp': .722, '1b': .882, '2b': 1.252, '3b': 1.584, 'hr': 2.037}  # MLB-style linear weights (approx.)

def r(x, n=3):
    if x is None: return None
    if isinstance(x, float) and (math.isnan(x) or math.isinf(x)): return None
    return round(x, n)
def div(a, b, n=3): return r(a / b, n) if b else None
def num(v):
    try: return float(v)
    except (TypeError, ValueError): return 0.0
norm = lambda s: re.sub(r'[^a-z]', '', (s or '').lower())

def name_keys(full):
    """'Last, First' -> set of normalized ways a scorer might write it"""
    if ',' in full: last, first = [x.strip() for x in full.split(',', 1)]
    else:
        parts = full.split(); first, last = (parts[0], ' '.join(parts[1:])) if len(parts) > 1 else ('', full)
    keys = {norm(last + first), norm(first + last), norm(first[:1] + last), norm(last)}
    return {k for k in keys if k}, norm(last)

def ip_outs(ip):
    ip = num(ip); w = int(ip); return w * 3 + round((ip - w) * 10)

RESULT_PATTERNS = [
    (r'struck out swinging', 'K_S'), (r'struck out looking', 'K_L'), (r'struck out', 'K'),
    (r'intentionally walked', 'IBB'), (r'walked', 'BB'), (r'hit by pitch', 'HBP'),
    (r'homered', 'HR'), (r'tripled', '3B'), (r'doubled', '2B'), (r'singled', '1B'),
    (r'into double play|into a double play', 'GIDP'), (r'into triple play', 'GIDP'),
    (r'grounded out|out at first', 'GO'), (r'flied out|flied into', 'FO'), (r'lined out|lined into', 'LO'),
    (r'popped up|popped out|popped into', 'PO'), (r'fouled out|fouled into', 'FL'),
    (r'sacrifice fly', 'SF'), (r'sacrifice bunt|sacrifice hit', 'SH'),
    (r"fielder's choice", 'FC'), (r'reached on an? (?:throwing |fielding )?error|reached on a .*?error|reached first on an error', 'ROE'),
    (r"catcher's interference", 'CI'), (r'dropped third strike|reached first on a wild pitch|reached on a passed ball', 'K'),
]
PA_RX = [(re.compile(p), c) for p, c in RESULT_PATTERNS]
IN_PLAY = {'HR', '3B', '2B', '1B', 'GIDP', 'GO', 'FO', 'LO', 'PO', 'FL', 'SF', 'SH', 'FC', 'ROE'}
AB_RES = {'K_S', 'K_L', 'K', 'HR', '3B', '2B', '1B', 'GIDP', 'GO', 'FO', 'LO', 'PO', 'FL', 'FC', 'ROE'}
HIT_RES = {'HR': 4, '3B': 3, '2B': 2, '1B': 1}

def classify(text):
    first = text.split(';')[0]
    best = None
    for rx, c in PA_RX:
        m = rx.search(first)
        if m and (best is None or m.start() < best[0]): best = (m.start(), c, m)
    if not best: return None, None, first
    return best[1], first[:best[0]].strip().rstrip(','), first

ZONE_ANG = {'LL': -40, 'LF': -28, 'LC': -14, 'CF': 0, 'RC': 14, 'RF': 28, 'RL': 40,
            'IF-L': -24, 'IF-M': 0, 'IF-R': 24, '3B': -33, 'SS': -14, '2B': 14, '1B': 33, 'P': 0, 'C': 0}
def field_zone(first):
    t = first.lower()
    for pat, z in [(r'left center|left-center', 'LC'), (r'right center|right-center', 'RC'), (r'(left field|lf) line', 'LL'), (r'(right field|rf) line', 'RL'),
                   (r'left field', 'LF'), (r'center field', 'CF'), (r'right field', 'RF'), (r'through the left side', 'IF-L'),
                   (r'up the middle', 'IF-M'), (r'through the right side', 'IF-R')]:
        if re.search(pat, t): return z
    m = re.search(r'(?:\bto|,|\bby)\s+(lf|cf|rf|ss|2b|3b|1b|p|c)\b', t)
    if m: return {'lf': 'LF', 'cf': 'CF', 'rf': 'RF', 'ss': 'SS', '2b': '2B', '3b': '3B', '1b': '1B', 'p': 'P', 'c': 'C'}[m.group(1)]
    m = re.search(r'to (third|second|first|short)', t)
    if m: return {'third': '3B', 'second': '2B', 'first': '1B', 'short': 'SS'}[m.group(1)]
    return None

def bb_type(res, first):
    t = first.lower()
    if 'bunt' in t: return 'BU'
    if res in ('GO', 'GIDP') or re.search(r'ground|through the|up the middle|infield single', t): return 'GB'
    if res in ('LO',) or 'line drive' in t or 'lined' in t: return 'LD'
    if res in ('PO', 'FL') or 'pop' in t: return 'PU'
    if res in ('FO', 'SF') or 'fly' in t or 'flied' in t: return 'FB'
    if res == 'HR': return 'AIR'
    return None

def full_seq(seq, res):
    if seq is None: return None
    s = seq.replace('N', '')
    if res in IN_PLAY: return s + 'X'
    if res == 'HBP': return s + 'H'
    return s

def build():
    D = json.load(open(RAW))
    for g in D['games']:
        y, m, d = g['date'].split('-'); g['date'] = f'{int(y):04d}-{int(m):02d}-{int(d):02d}'
    games = sorted(D['games'], key=lambda g: (g['date'], g['id']))
    gmap = {g['id']: g for g in games}
    roster = {str(p['rosterPlayerId']): p for p in D['roster']}
    players = {}  # rid -> info
    for g in games:
        for p in g['players']:
            if p.get('gamePlayed') != '1': continue
            rid = str(p.get('rosterPlayerId') or norm(p['name']))
            P = players.setdefault(rid, {'rid': rid, 'name': p['name'], 'uniform': p.get('uniform'), 'bats': p.get('bats'), 'throws': p.get('throws'), 'lines': []})
            P['lines'].append((g, p))
    # ---------- play-by-play attribution ----------
    pa_rows = collections.defaultdict(list)  # (role, rid) -> list
    cover = collections.Counter()
    for pl in D['pbp']:
        g = gmap[pl['g']]
        res, subj, first = classify(pl['text'])
        if not res: continue
        if pl['bat_team'] == 'us':
            cands = [(p, name_keys(p['name'])) for p in g['players'] if p.get('hitting')]
            s = norm(subj)
            hit = [p for p, (ks, ln) in cands if s in ks] or [p for p, (ks, ln) in cands if s and (s.startswith(ln) or s.endswith(ln)) and len(ln) > 2]
            if len(hit) != 1:
                cover['bat_unmatched'] += 1; continue
            p = hit[0]; rid = str(p.get('rosterPlayerId') or norm(p['name']))
            opp_hand = pl.get('p_throws')
            row = dict(g=g['id'], date=g['date'], res=res, zone=field_zone(first) if res in IN_PLAY else None, bbt=bb_type(res, first) if res in IN_PLAY else None,
                       b=pl['balls'], s=pl['strikes'], seq=full_seq(pl['seq'], res), hand=opp_hand, inn=pl['inn'], text=first)
            pa_rows[('bat', rid)].append(row); cover['bat_ok'] += 1
        else:
            pname = pl.get('pitcher')
            cands = [(p, name_keys(p['name'])) for p in g['players'] if p.get('pitching')]
            s = norm(pname)
            hit = [p for p, (ks, ln) in cands if s in ks or norm(p['name']) == s] or [p for p, (ks, ln) in cands if s and ln and ln in s]
            if len(hit) != 1:
                cover['pit_unmatched'] += 1; continue
            p = hit[0]; rid = str(p.get('rosterPlayerId') or norm(p['name']))
            # batter hand from opponent box
            okeys = [(o, name_keys(o['name'])) for o in g['opp_players']]
            sb = norm(subj)
            ob = [o for o, (ks, ln) in okeys if sb in ks] or [o for o, (ks, ln) in okeys if sb and ln and (sb.startswith(ln) or sb.endswith(ln))]
            hand = ob[0].get('bats') if len(ob) == 1 else None
            row = dict(g=g['id'], date=g['date'], res=res, zone=field_zone(first) if res in IN_PLAY else None, bbt=bb_type(res, first) if res in IN_PLAY else None,
                       b=pl['balls'], s=pl['strikes'], seq=full_seq(pl['seq'], res), hand=hand, inn=pl['inn'], text=first)
            pa_rows[('pit', rid)].append(row); cover['pit_ok'] += 1
    print('pbp attribution', dict(cover))

    # team totals for league-proxy context
    def hit_tot(lines):
        t = collections.Counter()
        for g, p in lines:
            h = p.get('hitting') or {}
            for k, v in h.items(): t[k] += num(v)
        return t
    def slash(t):
        ab, h, bb, hbp, sf = t['atBats'], t['hits'], t['walks'], t['hitByPitch'], t['sacrificeFlies']
        b1 = h - t['doubles'] - t['triples'] - t['homeRuns']
        tb = b1 + 2 * t['doubles'] + 3 * t['triples'] + 4 * t['homeRuns']
        pa = ab + bb + hbp + sf + t['sacrificeHits'] + t['reachedOnCatchersInteference']
        obp = div(h + bb + hbp, ab + bb + hbp + sf); slg = div(tb, ab)
        woba = div(LW['bb'] * (bb - t['intentionalWalks']) + LW['hbp'] * hbp + LW['1b'] * b1 + LW['2b'] * t['doubles'] + LW['3b'] * t['triples'] + LW['hr'] * t['homeRuns'],
                   ab + bb - t['intentionalWalks'] + sf + hbp)
        return {'PA': int(pa), 'AB': int(ab), 'R': int(t['runsScored']), 'H': int(h), '1B': int(b1), '2B': int(t['doubles']), '3B': int(t['triples']), 'HR': int(t['homeRuns']),
                'RBI': int(t['runsBattedIn']), 'BB': int(bb), 'IBB': int(t['intentionalWalks']), 'HBP': int(hbp), 'K': int(t['strikeouts']), 'K_looking': int(t['strikeoutsLooking']),
                'SB': int(t['stolenBases']), 'CS': int(t['caughtStealing']), 'SH': int(t['sacrificeHits']), 'SF': int(t['sacrificeFlies']), 'GDP': int(t['groundedIntoDoublePlay']),
                'ROE': int(t['reachedOnError']), 'GO': int(t['groundOuts']), 'FO': int(t['flyOuts']), 'TB': int(tb), 'XBH': int(t['doubles'] + t['triples'] + t['homeRuns']),
                'AVG': div(h, ab), 'OBP': obp, 'SLG': slg, 'OPS': r((obp or 0) + (slg or 0)) if ab else None, 'ISO': r((slg or 0) - (div(h, ab) or 0)) if ab else None,
                'BABIP': div(h - t['homeRuns'], ab - t['strikeouts'] - t['homeRuns'] + sf), 'K%': div(t['strikeouts'], pa), 'BB%': div(bb, pa),
                'BB/K': div(bb, t['strikeouts'], 2), 'GO/AO': div(t['groundOuts'], t['flyOuts'], 2), 'SB%': div(t['stolenBases'], t['stolenBases'] + t['caughtStealing']),
                'wOBA': woba, 'RC': r((h + bb) * tb / (ab + bb), 1) if ab + bb else None, 'HR%': div(t['homeRuns'], pa), 'AB/HR': div(ab, t['homeRuns'], 1)}
    def pit_tot(lines):
        t = collections.Counter(); app = 0
        for g, p in lines:
            pp = p.get('pitching')
            if not pp: continue
            app += 1
            for k, v in pp.items():
                if k == 'inningsPitched': t['outs'] += ip_outs(v)
                elif k in ('wins', 'losses'): t[k] += 0 if str(v) in ('0', '', 'None') else 1
                elif k != 'orderOfAppearance': t[k] += num(v)
        t['app'] = app
        return t
    team_hit = slash(hit_tot([(g, p) for g in games for p in g['players']]))
    tp = pit_tot([(g, p) for g in games for p in g['players']])
    team_era = tp['earnedRunsAllowed'] * 27 / tp['outs']
    fip_c = team_era - (13 * tp['homerunsAllowed'] + 3 * (tp['walksAllowed'] + tp['hitBatters']) - 2 * tp['strikeouts']) / (tp['outs'] / 3)
    def pline(t):
        ip = t['outs'] / 3; bf = t['battersFaced']
        fipr = div(13 * t['homerunsAllowed'] + 3 * (t['walksAllowed'] + t['hitBatters']) - 2 * t['strikeouts'], ip, 2)
        return {'APP': int(t['app']), 'GS': int(t['gamesStarted']), 'W': int(t['wins']), 'L': int(t['losses']), 'SV': int(t['saves']), 'CG': int(t['gamesCompleted']), 'SHO': int(t['shutouts']),
                'IP': f"{int(t['outs'] // 3)}.{int(t['outs'] % 3)}", 'IP_dec': r(ip, 2), 'H': int(t['hitsAllowed']), 'R': int(t['runsAllowed']), 'ER': int(t['earnedRunsAllowed']),
                'BB': int(t['walksAllowed']), 'IBB': int(t['intentionalWalks']), 'K': int(t['strikeouts']), 'K_looking': int(t['strikeoutsLooking']), 'HR': int(t['homerunsAllowed']),
                '2B': int(t['doublesAllowed']), '3B': int(t['triplesAllowed']), 'HBP': int(t['hitBatters']), 'WP': int(t['wildPitches']), 'BK': int(t['balks']), 'BF': int(bf),
                'AB': int(t['opponentAtBats']), 'pitches': int(t['pitches']), 'GO': int(t['groundouts']), 'FO': int(t['flyouts']),
                'IR': int(t['inheritedRunners']), 'IRS': int(t['inheritedRunnersThatScored']),
                'ERA': div(t['earnedRunsAllowed'] * 9, ip, 2), 'RA9': div(t['runsAllowed'] * 9, ip, 2), 'WHIP': div(t['walksAllowed'] + t['hitsAllowed'], ip, 2),
                'K/9': div(t['strikeouts'] * 9, ip, 2), 'BB/9': div(t['walksAllowed'] * 9, ip, 2), 'H/9': div(t['hitsAllowed'] * 9, ip, 2), 'HR/9': div(t['homerunsAllowed'] * 9, ip, 2),
                'K%': div(t['strikeouts'], bf), 'BB%': div(t['walksAllowed'], bf), 'K-BB%': div(t['strikeouts'] - t['walksAllowed'], bf), 'K/BB': div(t['strikeouts'], t['walksAllowed'], 2),
                'OPP_AVG': div(t['hitsAllowed'], t['opponentAtBats']),
                'OPP_OBP': div(t['hitsAllowed'] + t['walksAllowed'] + t['hitBatters'], t['opponentAtBats'] + t['walksAllowed'] + t['hitBatters'] + t['sacrificeFliesAllowed']),
                'BABIP': div(t['hitsAllowed'] - t['homerunsAllowed'], t['opponentAtBats'] - t['strikeouts'] - t['homerunsAllowed'] + t['sacrificeFliesAllowed']),
                'FIP': r(fipr + fip_c, 2) if fipr is not None else None, 'GO/AO': div(t['groundouts'], t['flyouts'], 2),
                'P/IP': div(t['pitches'], ip, 1), 'P/BF': div(t['pitches'], bf, 2), 'IR_scored%': div(t['inheritedRunnersThatScored'], t['inheritedRunners'])}
    team_pit = pline(tp)

    def seq_metrics(rows, pitcher):
        rs = [x for x in rows if x['seq'] is not None and x['res'] not in ('IBB', 'CI')]
        c = collections.Counter(); fp = collections.Counter(); after1 = collections.defaultdict(list)
        long_pa = 0; two_strike = 0; two_strike_fouls = 0; full = 0; full_res = collections.Counter(); three_ball = 0
        for x in rs:
            s = x['seq']
            for ch in s: c[ch] += 1
            if s:
                fp['n'] += 1; f = s[0]
                if f in 'SFX': fp['swing'] += 1
                if f in 'KSFX': fp['strike'] += 1
                if f == 'X': fp['in_play'] += 1
                after1['1-0' if f == 'B' else ('0-1' if f in 'KSF' else 'first_pitch_in_play')].append(x)
            if len(s) >= 7: long_pa += 1
            # walk through counts
            b = st = 0; reached2 = False; reached3b = False
            for ch in s:
                if st == 2: reached2 = True
                if b == 3: reached3b = True
                if st == 2 and ch == 'F': two_strike_fouls += 1
                if ch in 'BI': b += 1
                elif ch in 'KS': st += 1
                elif ch == 'F' and st < 2: st += 1
            if reached2: two_strike += 1
            if reached3b: three_ball += 1
            if x['b'] == 3 and x['s'] == 2: full += 1; full_res[x['res']] += 1
        pitches = sum(len(x['seq']) for x in rs)
        sw = c['S'] + c['F'] + c['X']
        strikes = c['K'] + c['S'] + c['F'] + c['X']
        out = {'pa_with_pitch_data': len(rs), 'pa_total': len(rows), 'coverage': div(len(rs), len(rows)),
               'pitches': pitches, 'pitches_per_pa': div(pitches, len(rs), 2), 'balls': c['B'], 'called_strikes': c['K'], 'swinging_strikes': c['S'], 'fouls': c['F'], 'in_play': c['X'],
               'strike_pct': div(strikes, pitches), 'swing_pct': div(sw, pitches), 'whiff_pct': div(c['S'], sw), 'contact_pct': div(c['F'] + c['X'], sw),
               'foul_pct_of_swings': div(c['F'], sw), 'called_strike_pct': div(c['K'], pitches), 'csw_pct': div(c['K'] + c['S'], pitches),
               'first_pitch_swing_pct': div(fp['swing'], fp['n']), 'first_pitch_strike_pct': div(fp['strike'], fp['n']), 'first_pitch_in_play_pct': div(fp['in_play'], fp['n']),
               'long_pa_7plus': long_pa, 'two_strike_pa': two_strike, 'two_strike_fouls': two_strike_fouls, 'fouls_per_two_strike_pa': div(two_strike_fouls, two_strike, 2),
               'three_ball_pa': three_ball, 'full_count_pa': full, 'full_count_results': dict(full_res),
               'putaway_pct': div(sum(1 for x in rs if x['res'].startswith('K')), two_strike)}
        out['after_first_pitch'] = {k: pa_slash(v) for k, v in after1.items()}
        return out

    def pa_slash(rows):
        t = collections.Counter(x['res'] for x in rows)
        ab = sum(t[k] for k in AB_RES); h = sum(t[k] for k in HIT_RES); tb = sum(t[k] * v for k, v in HIT_RES.items())
        bb = t['BB'] + t['IBB']; pa = len(rows)
        ks = t['K_S'] + t['K_L'] + t['K']
        woba_d = ab + t['BB'] + t['SF'] + t['HBP']
        woba = div(LW['bb'] * t['BB'] + LW['hbp'] * t['HBP'] + LW['1b'] * t['1B'] + LW['2b'] * t['2B'] + LW['3b'] * t['3B'] + LW['hr'] * t['HR'], woba_d)
        return {'PA': pa, 'AB': ab, 'H': h, 'HR': t['HR'], 'BB': bb, 'K': ks, 'AVG': div(h, ab), 'OBP': div(h + bb + t['HBP'], ab + bb + t['HBP'] + t['SF']),
                'SLG': div(tb, ab), 'wOBA': woba, 'K%': div(ks, pa), 'BB%': div(bb, pa)}

    def spray_profile(rows):
        bip = [x for x in rows if x['res'] in IN_PLAY and x['res'] != 'SH']
        z = collections.Counter(x['zone'] for x in bip if x['zone'])
        zr = {}
        for zn in ZONE_ANG:
            xs = [x for x in bip if x['zone'] == zn]
            if xs: zr[zn] = {'n': len(xs), 'hits': sum(1 for x in xs if x['res'] in HIT_RES), 'xbh': sum(1 for x in xs if x['res'] in ('2B', '3B', 'HR')),
                             'hr': sum(1 for x in xs if x['res'] == 'HR'), 'angle': ZONE_ANG[zn], 'depth': 'OF' if zn in ('LL', 'LF', 'LC', 'CF', 'RC', 'RF', 'RL') else 'IF'}
        bt = collections.Counter(x['bbt'] for x in bip if x['bbt'])
        known = sum(v for k, v in bt.items() if k in ('GB', 'LD', 'FB', 'PU'))
        return {'bip': len(bip), 'located': sum(z.values()), 'zones': zr,
                'batted_ball': dict(bt), 'gb_pct': div(bt['GB'], known), 'ld_pct': div(bt['LD'], known), 'fb_pct': div(bt['FB'], known), 'pu_pct': div(bt['PU'], known),
                'zone_angles_deg': ZONE_ANG}

    def pull_split(rows, hand):
        bip = [x for x in rows if x['zone'] and x['res'] in IN_PLAY]
        if not hand or not bip: return None
        a = [ZONE_ANG[x['zone']] for x in bip if x['zone'] not in ('P', 'C')]
        if hand == 'L': a = [-v for v in a]
        n = len(a)
        return {'pull_pct': div(sum(1 for v in a if v < -10), n), 'center_pct': div(sum(1 for v in a if -10 <= v <= 10), n), 'oppo_pct': div(sum(1 for v in a if v > 10), n), 'n': n}

    def count_table(rows):
        out = {}
        for x in rows:
            if x['b'] is None: continue
            k = f"{x['b']}-{x['s']}"; out.setdefault(k, []).append(x)
        return {k: pa_slash(v) for k, v in sorted(out.items())}

    index = []
    for rid, P in players.items():
        ro = roster.get(rid, {})
        lines = P['lines']
        hit_lines = [(g, p) for g, p in lines if p.get('hitting') and (num(p['hitting'].get('atBats')) + num(p['hitting'].get('walks')) + num(p['hitting'].get('hitByPitch')) + num(p['hitting'].get('sacrificeFlies')) + num(p['hitting'].get('sacrificeHits')) > 0 or (p.get('gameStarted') == '1' and (p.get('position') or '').lower() not in ('p', '')))]
        pit_lines = [(g, p) for g, p in lines if p.get('pitching')]
        if not hit_lines and not pit_lines:
            hit_lines = [(g, p) for g, p in lines if p.get('hitting')]
            if not hit_lines: continue
        positions = collections.Counter(p.get('position') for g, p in lines if p.get('position'))
        last, first = (P['name'].split(', ', 1) + [''])[:2] if ', ' in P['name'] else (P['name'], '')
        o = {'id': f'usm-{rid}', 'team': 'usm', 'level': 'NCAA D1', 'season': 2026,
             'name': f"{ro.get('firstName') or first} {ro.get('lastName') or last}".strip(), 'first': ro.get('firstName') or first, 'last': ro.get('lastName') or last,
             'number': ro.get('jerseyNumber') or P['uniform'], 'pos': ro.get('positionShort') or (positions.most_common(1)[0][0].upper() if positions else None),
             'bats': P['bats'], 'throws': P['throws'], 'class': ro.get('academicYearLong'), 'class_short': ro.get('academicYearShort'),
             'height': f"{ro['heightFeet']}' {ro['heightInches']}\"" if ro.get('heightFeet') else None, 'weight': ro.get('weight'),
             'hometown': ro.get('hometown'), 'high_school': ro.get('highSchool'), 'previous_school': ro.get('previousSchool'),
             'positions_played': dict(positions), 'games': len(lines), 'starts': sum(1 for g, p in lines if p.get('gameStarted') == '1'),
             'on_current_roster_page': bool(ro),
             'sources': ['southernmiss.com box scores + play-by-play (Sidearm Stats)'],
             'notes': ['College baseball has no public pitch-tracking (no velocity, spin, exit velo or pitch location). Pitch-sequence stats come from the scorer\'s ball/strike sequence in play-by-play; spray zones come from play descriptions.',
                       'wOBA uses MLB-style linear weights; FIP uses a constant calibrated so Southern Miss team FIP = team ERA; OPS+ is relative to Southern Miss team totals (team = 100).']}
        is_p = bool(pit_lines) and (o['pos'] in ('P', 'RHP', 'LHP') or len(pit_lines) >= len(hit_lines))
        o['role'] = 'pitcher' if is_p else 'hitter'
        if hit_lines and pit_lines and len(hit_lines) >= 5 and len(pit_lines) >= 3: o['role'] = 'two-way'
        if hit_lines:
            t = hit_tot(hit_lines); season = slash(t)
            season['G'] = len(hit_lines); season['GS'] = sum(1 for g, p in hit_lines if p.get('gameStarted') == '1')
            season['LOB'] = int(sum(num(p.get('hittingSummary', {}) and p['hittingSummary'].get('runnersLeftOnBase')) for g, p in hit_lines)) if False else None
            season['OPS+'] = r(100 * ((season['OBP'] or 0) / team_hit['OBP'] + (season['SLG'] or 0) / team_hit['SLG'] - 1), 0) if season['AB'] else None
            rows = sorted(pa_rows.get(('bat', rid), []), key=lambda x: (x['date'], x['inn']))
            gl = []
            for g, p in hit_lines:
                h = p['hitting']
                gl.append({'date': g['date'], 'opp': g['opp'], 'home': g['home'], 'neutral': g['neutral'], 'conf': g['conf'], 'result': g['result'], 'score': f"{g['us']}-{g['them']}",
                           'spot': p.get('spot'), 'pos': p.get('position'), 'start': p.get('gameStarted') == '1',
                           **{k: int(num(h.get(v))) for k, v in [('AB', 'atBats'), ('R', 'runsScored'), ('H', 'hits'), ('2B', 'doubles'), ('3B', 'triples'), ('HR', 'homeRuns'), ('RBI', 'runsBattedIn'),
                                                                 ('BB', 'walks'), ('IBB', 'intentionalWalks'), ('K', 'strikeouts'), ('HBP', 'hitByPitch'), ('SB', 'stolenBases'), ('CS', 'caughtStealing'), ('SF', 'sacrificeFlies'), ('SH', 'sacrificeHits')]}})
            # cumulative + rolling 10
            def roll(rows_, win):
                out = []
                for i in range(len(rows_)):
                    w = rows_[max(0, i - win + 1): i + 1]
                    s = collections.Counter()
                    for x in w:
                        for k in ('AB', 'H', '2B', '3B', 'HR', 'BB', 'HBP', 'SF', 'K', 'SH', 'IBB'): s[k] += x[k]
                    b1 = s['H'] - s['2B'] - s['3B'] - s['HR']; tb = b1 + 2 * s['2B'] + 3 * s['3B'] + 4 * s['HR']
                    pa = s['AB'] + s['BB'] + s['HBP'] + s['SF'] + s['SH']
                    obp = div(s['H'] + s['BB'] + s['HBP'], s['AB'] + s['BB'] + s['HBP'] + s['SF'])
                    out.append({'date': rows_[i]['date'], 'avg': div(s['H'], s['AB']), 'obp': obp, 'slg': div(tb, s['AB']),
                                'ops': r((obp or 0) + (div(tb, s['AB']) or 0)) if s['AB'] else None, 'k_pct': div(s['K'], pa), 'bb_pct': div(s['BB'], pa), 'hr': s['HR'], 'pa': pa,
                                'woba': div(LW['bb'] * (s['BB'] - s['IBB']) + LW['hbp'] * s['HBP'] + LW['1b'] * b1 + LW['2b'] * s['2B'] + LW['3b'] * s['3B'] + LW['hr'] * s['HR'], s['AB'] + s['BB'] - s['IBB'] + s['SF'] + s['HBP'])})
                return out
            H = {'season': season, 'gamelog': gl, 'cumulative': roll(gl, 10_000), 'rolling_10g': roll(gl, 10),
                 'splits': {'vs_RHP': pa_slash([x for x in rows if x['hand'] == 'R']), 'vs_LHP': pa_slash([x for x in rows if x['hand'] == 'L']),
                            'home': slash(hit_tot([(g, p) for g, p in hit_lines if g['home'] and not g['neutral']])),
                            'away': slash(hit_tot([(g, p) for g, p in hit_lines if not g['home'] and not g['neutral']])),
                            'neutral': slash(hit_tot([(g, p) for g, p in hit_lines if g['neutral']])),
                            'conference': slash(hit_tot([(g, p) for g, p in hit_lines if g['conf']])),
                            'non_conference': slash(hit_tot([(g, p) for g, p in hit_lines if not g['conf']])),
                            'by_month': {m: slash(hit_tot([(g, p) for g, p in hit_lines if g['date'][5:7] == m])) for m in sorted({g['date'][5:7] for g, p in hit_lines})},
                            'by_lineup_spot': {s_: slash(hit_tot([(g, p) for g, p in hit_lines if p.get('spot') == s_])) for s_ in sorted({p.get('spot') for g, p in hit_lines if p.get('spot')}, key=lambda z: int(z) if z.isdigit() else 99)},
                            'by_inning_group': {'1-3': pa_slash([x for x in rows if x['inn'] <= 3]), '4-6': pa_slash([x for x in rows if 4 <= x['inn'] <= 6]), '7+': pa_slash([x for x in rows if x['inn'] >= 7])}},
                 'pbp': pa_slash(rows), 'plate_discipline': seq_metrics(rows, False), 'spray': spray_profile(rows), 'direction': pull_split(rows, 'L' if P['bats'] == 'L' else 'R' if P['bats'] == 'R' else None),
                 'counts_pa_ended': count_table(rows), 'results': dict(collections.Counter(x['res'] for x in rows)),
                 'pa_log': [{k: x[k] for k in ('date', 'inn', 'res', 'zone', 'bbt', 'b', 's', 'seq', 'hand')} for x in rows]}
            o['hitting'] = H
        if pit_lines:
            t = pit_tot(pit_lines); season = pline(t)
            rows = sorted(pa_rows.get(('pit', rid), []), key=lambda x: (x['date'], x['inn']))
            gl = []
            for g, p in pit_lines:
                pp = p['pitching']
                gl.append({'date': g['date'], 'opp': g['opp'], 'home': g['home'], 'neutral': g['neutral'], 'conf': g['conf'], 'result': g['result'], 'score': f"{g['us']}-{g['them']}",
                           'start': pp.get('gamesStarted') == '1', 'dec': 'W' if str(pp.get('wins')) not in ('0', '', 'None') else 'L' if str(pp.get('losses')) not in ('0', '', 'None') else 'S' if pp.get('saves') == '1' else '',
                           'IP': pp.get('inningsPitched'), 'outs': ip_outs(pp.get('inningsPitched')),
                           **{k: int(num(pp.get(v))) for k, v in [('H', 'hitsAllowed'), ('R', 'runsAllowed'), ('ER', 'earnedRunsAllowed'), ('BB', 'walksAllowed'), ('K', 'strikeouts'), ('HR', 'homerunsAllowed'),
                                                                  ('HBP', 'hitBatters'), ('BF', 'battersFaced'), ('pitches', 'pitches'), ('WP', 'wildPitches'), ('GO', 'groundouts'), ('FO', 'flyouts')]}})
            def proll(rows_, win):
                out = []
                for i in range(len(rows_)):
                    w = rows_[max(0, i - win + 1): i + 1]; s = collections.Counter()
                    for x in w:
                        for k in ('outs', 'H', 'ER', 'BB', 'K', 'HR', 'HBP', 'BF', 'pitches'): s[k] += x[k]
                    ip = s['outs'] / 3
                    fr = div(13 * s['HR'] + 3 * (s['BB'] + s['HBP']) - 2 * s['K'], ip, 2)
                    out.append({'date': rows_[i]['date'], 'era': div(s['ER'] * 9, ip, 2), 'whip': div(s['BB'] + s['H'], ip, 2), 'k_pct': div(s['K'], s['BF']), 'bb_pct': div(s['BB'], s['BF']),
                                'fip': r(fr + fip_c, 2) if fr is not None else None, 'ip': r(ip, 1), 'pitches_per_ip': div(s['pitches'], ip, 1)})
                return out
            win = 4 if season['GS'] >= 4 else 8
            Pj = {'season': season, 'gamelog': gl, 'cumulative': proll(gl, 10_000), 'rolling': {'window_games': win, 'rows': proll(gl, win)},
                  'splits': {'vs_RHB': pa_slash([x for x in rows if x['hand'] == 'R']), 'vs_LHB': pa_slash([x for x in rows if x['hand'] == 'L']),
                             'home': pline(pit_tot([(g, p) for g, p in pit_lines if g['home'] and not g['neutral']])), 'away': pline(pit_tot([(g, p) for g, p in pit_lines if not g['home'] and not g['neutral']])),
                             'conference': pline(pit_tot([(g, p) for g, p in pit_lines if g['conf']])), 'non_conference': pline(pit_tot([(g, p) for g, p in pit_lines if not g['conf']])),
                             'as_starter': pline(pit_tot([(g, p) for g, p in pit_lines if p['pitching'].get('gamesStarted') == '1'])),
                             'as_reliever': pline(pit_tot([(g, p) for g, p in pit_lines if p['pitching'].get('gamesStarted') != '1'])),
                             'by_month': {m: pline(pit_tot([(g, p) for g, p in pit_lines if g['date'][5:7] == m])) for m in sorted({g['date'][5:7] for g, p in pit_lines})},
                             'by_inning_group': {'1-3': pa_slash([x for x in rows if x['inn'] <= 3]), '4-6': pa_slash([x for x in rows if 4 <= x['inn'] <= 6]), '7+': pa_slash([x for x in rows if x['inn'] >= 7])}},
                  'opponents_pbp': pa_slash(rows), 'pitch_sequence': seq_metrics(rows, True), 'spray_allowed': spray_profile(rows),
                  'counts_pa_ended': count_table(rows), 'results': dict(collections.Counter(x['res'] for x in rows)),
                  'pa_log': [{k: x[k] for k in ('date', 'inn', 'res', 'zone', 'bbt', 'b', 's', 'seq', 'hand')} for x in rows]}
            o['pitching'] = Pj
        f = collections.Counter()
        for g, p in lines:
            for k, v in (p.get('fielding') or {}).items():
                if k != 'fieldingPercentage': f[k] += num(v)
        o['fielding'] = {**{k: int(v) for k, v in f.items()}, 'fpct': div(f['putouts'] + f['assists'], f['totalChances'])}
        json.dump(o, open(f'{OUT}/usm-{rid}.json', 'w'), separators=(',', ':'))
        index.append(card(o))
    team = {'team': 'usm', 'name': 'Southern Miss Golden Eagles', 'season': 2026, 'record': f"{sum(g['result']=='W' for g in games)}-{sum(g['result']=='L' for g in games)}",
            'conf_record': f"{sum(g['result']=='W' and g['conf'] for g in games)}-{sum(g['result']=='L' and g['conf'] for g in games)}",
            'games': [{k: g[k] for k in ('id', 'date', 'opp', 'home', 'neutral', 'conf', 'us', 'them', 'result', 'innings', 'line_us', 'line_them')} for g in games],
            'hitting': team_hit, 'pitching': team_pit, 'fip_constant': r(fip_c, 3), 'pbp_attribution': dict(cover)}
    return index, team

def card(o):
    c = {k: o.get(k) for k in ['id', 'team', 'name', 'first', 'last', 'number', 'pos', 'role', 'bats', 'throws', 'class_short', 'height', 'weight', 'hometown']}
    if 'hitting' in o and o['role'] != 'pitcher':
        s = o['hitting']['season']; pdx = o['hitting']['plate_discipline']
        c['line'] = {'G': s['G'], 'PA': s['PA'], 'AVG': s['AVG'], 'OBP': s['OBP'], 'SLG': s['SLG'], 'OPS': s['OPS'], 'HR': s['HR'], 'RBI': s['RBI'], 'SB': s['SB'],
                     'OPS+': s['OPS+'], 'wOBA': s['wOBA'], 'K%': s['K%'], 'BB%': s['BB%'], 'Whiff%': pdx['whiff_pct']}
        c['sort'] = s['PA']
    else:
        s = o['pitching']['season']; ps = o['pitching']['pitch_sequence']
        c['line'] = {'G': s['APP'], 'GS': s['GS'], 'IP': s['IP'], 'W': s['W'], 'L': s['L'], 'SV': s['SV'], 'ERA': s['ERA'], 'WHIP': s['WHIP'], 'K': s['K'], 'K/9': s['K/9'],
                     'FIP': s['FIP'], 'OPP_AVG': s['OPP_AVG'], 'Strike%': ps['strike_pct'], 'Whiff%': ps['whiff_pct']}
        c['sort'] = s['IP_dec'] * 3 * 2
    return c

if __name__ == '__main__':
    idx, team = build()
    json.dump(idx, open(W + '/out/usm_index.json', 'w'))
    json.dump(team, open(W + '/out/usm_team.json', 'w'))
    print(len(idx), 'players', team['record'], team['conf_record'])

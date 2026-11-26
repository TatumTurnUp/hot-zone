"""Build per-player JSON for Atlanta Braves 2026 from MLB Stats API + Baseball Savant.
Inputs: raw/roster_full.json, raw/players/*.json, raw/sc/*.csv, raw/lb/*.csv
Output: out/atl/<id>.json and returns index rows."""
import json, glob, os, math
import os as _os
W = _os.environ.get('CB_WORK', '/home/claude/cb')
import numpy as np, pandas as pd

RAW = W + '/raw'
OUT = W + '/out/players'
os.makedirs(OUT, exist_ok=True)
TEAM_ID = 144

def r(x, n=3):
    if x is None: return None
    try:
        if isinstance(x, str):
            x = float(x) if x.strip() not in ('', '-.--', '.---', '-') else None
            if x is None: return None
        if isinstance(x, (float, np.floating)) and (math.isnan(x) or math.isinf(x)): return None
        return round(float(x), n)
    except Exception:
        return None

def div(a, b, n=3):
    return r(a / b, n) if b else None

# ---------------- Statcast ----------------
def load_sc(kind):
    fs = sorted(glob.glob(f'{RAW}/sc/{kind}_*.csv'))
    df = pd.concat([pd.read_csv(f, low_memory=False) for f in fs if os.path.getsize(f) > 100], ignore_index=True)
    df.columns = [c.replace('﻿', '').strip('"') for c in df.columns]
    df = df.drop_duplicates(subset=['game_pk', 'at_bat_number', 'pitch_number'])
    txt = {'pitch_type', 'game_date', 'player_name', 'events', 'description', 'des', 'game_type', 'stand', 'p_throws', 'home_team', 'away_team',
           'type', 'bb_type', 'inning_topbot', 'pitch_name', 'if_fielding_alignment', 'of_fielding_alignment', 'umpire', 'sv_id'}
    for c in df.columns:
        if c not in txt: df[c] = pd.to_numeric(df[c], errors='coerce')
    return df

SWING = {'swinging_strike', 'swinging_strike_blocked', 'foul', 'foul_tip', 'hit_into_play', 'foul_bunt', 'missed_bunt', 'bunt_foul_tip'}
WHIFF = {'swinging_strike', 'swinging_strike_blocked', 'foul_tip', 'missed_bunt'}
NON_AB = {'walk', 'hit_by_pitch', 'sac_fly', 'sac_bunt', 'catcher_interf', 'intent_walk', 'sac_fly_double_play', 'sac_bunt_double_play', 'truncated_pa'}
HITS = {'single', 'double', 'triple', 'home_run'}
TB = {'single': 1, 'double': 2, 'triple': 3, 'home_run': 4}

def prep(df):
    df = df.copy()
    df['is_swing'] = df['description'].isin(SWING)
    df['is_whiff'] = df['description'].isin(WHIFF)
    df['is_called'] = df['description'].eq('called_strike')
    df['in_zone'] = df['zone'].between(1, 9)
    df['is_bip'] = df['type'].eq('X')
    df['is_pa'] = df['events'].notna() & ~df['events'].eq('truncated_pa')
    df['is_ab'] = df['is_pa'] & ~df['events'].isin(NON_AB)
    df['is_hit'] = df['events'].isin(HITS)
    df['tb'] = df['events'].map(TB).fillna(0)
    df['hard'] = df['is_bip'] & (df['launch_speed'] >= 95)
    df['barrel'] = df['is_bip'] & (df['launch_speed_angle'] == 6)
    df['sweet'] = df['is_bip'] & df['launch_angle'].between(8, 32)
    # xwOBA numerator per PA: est_woba for BIP else woba_value
    est = df['estimated_woba_using_speedangle']
    df['xwoba_num'] = np.where(df['is_bip'] & est.notna(), est, df['woba_value'].fillna(0))
    df['xwoba_num'] = np.where(df['woba_denom'].fillna(0) > 0, df['xwoba_num'], 0)
    df['xba_num'] = np.where(df['is_bip'], df['estimated_ba_using_speedangle'].fillna(0), 0)
    df['xslg_num'] = np.where(df['is_bip'], df['estimated_slg_using_speedangle'].fillna(0), 0)
    # spray in feet from home plate (x right-field positive from catcher view, y toward CF)
    df['sx'] = (df['hc_x'] - 125.42) * 2.5
    df['sy'] = (198.27 - df['hc_y']) * 2.5
    ang = np.degrees(np.arctan2(df['sx'], df['sy']))  # negative = left field
    df['spray_angle'] = ang
    # pull/center/oppo: for RHB pull = left (angle < -15)
    rhb = df['stand'].eq('R')
    df['dir'] = np.select([
        (rhb & (ang < -15)) | (~rhb & (ang > 15)),
        ang.abs() <= 15,
        (rhb & (ang > 15)) | (~rhb & (ang < -15))], ['pull', 'center', 'oppo'], default='')
    df['ivb'] = df['pfx_z'] * 12
    df['hb'] = df['pfx_x'] * 12
    return df

def core(df, pitcher=False):
    """Plate discipline + batted ball + expected stats for a set of pitches."""
    n = len(df)
    if n == 0: return {}
    sw = int(df.is_swing.sum()); wh = int(df.is_whiff.sum()); cs = int(df.is_called.sum())
    z = df[df.in_zone]; oz = df[~df.in_zone & df.zone.notna()]
    bip = df[df.is_bip]; pa = df[df.is_pa]; ab = df[df.is_ab]
    first = df[df.pitch_number == 1]
    ev = bip['launch_speed'].dropna()
    bbt = bip['bb_type'].value_counts()
    nb = len(bip)
    out = {
        'pitches': n, 'pa': int(len(pa)), 'ab': int(len(ab)), 'bip': nb,
        'swing_pct': div(sw, n), 'whiff_pct': div(wh, sw), 'csw_pct': div(cs + wh, n), 'called_strike_pct': div(cs, n),
        'zone_pct': div(len(z), len(z) + len(oz)), 'zone_swing_pct': div(z.is_swing.sum(), len(z)),
        'zone_contact_pct': div(z.is_swing.sum() - z.is_whiff.sum(), z.is_swing.sum()),
        'chase_pct': div(oz.is_swing.sum(), len(oz)), 'chase_contact_pct': div(oz.is_swing.sum() - oz.is_whiff.sum(), oz.is_swing.sum()),
        'first_pitch_swing_pct': div(first.is_swing.sum(), len(first)),
        'first_pitch_strike_pct': div((first.is_swing | first.is_called | first.description.isin(['foul', 'foul_tip'])).sum() + 0, len(first)),
        'k_pct': div(pa.events.isin(['strikeout', 'strikeout_double_play']).sum(), len(pa)),
        'bb_pct': div(pa.events.isin(['walk', 'intent_walk']).sum(), len(pa)),
        'avg_ev': r(ev.mean(), 1), 'max_ev': r(ev.max(), 1), 'ev50': r(ev[ev >= ev.median()].mean(), 1) if len(ev) else None,
        'avg_la': r(bip['launch_angle'].mean(), 1), 'la_sd': r(bip['launch_angle'].std(), 1),
        'avg_distance': r(bip['hit_distance_sc'].mean(), 0), 'max_distance': r(bip['hit_distance_sc'].max(), 0),
        'hard_hit_pct': div(bip.hard.sum(), nb), 'barrel_pct': div(bip.barrel.sum(), nb), 'barrels': int(bip.barrel.sum()),
        'barrel_per_pa': div(bip.barrel.sum(), len(pa)), 'sweet_spot_pct': div(bip.sweet.sum(), nb),
        'gb_pct': div(bbt.get('ground_ball', 0), nb), 'ld_pct': div(bbt.get('line_drive', 0), nb),
        'fb_pct': div(bbt.get('fly_ball', 0), nb), 'pu_pct': div(bbt.get('popup', 0), nb),
        'pull_pct': div((bip.dir == 'pull').sum(), (bip.dir != '').sum()), 'center_pct': div((bip.dir == 'center').sum(), (bip.dir != '').sum()),
        'oppo_pct': div((bip.dir == 'oppo').sum(), (bip.dir != '').sum()),
        'ba': div(ab.is_hit.sum(), len(ab)), 'slg': div(ab.tb.sum(), len(ab)),
        'woba': div(df.woba_value.fillna(0).sum(), df.woba_denom.fillna(0).sum()),
        'xba': div(ab.xba_num.sum(), len(ab)), 'xslg': div(ab.xslg_num.sum(), len(ab)),
        'xwoba': div(df.xwoba_num.sum(), df.woba_denom.fillna(0).sum()),
        'xwobacon': div(bip.xwoba_num.sum(), len(bip)),
        'run_value': r(df.delta_run_exp.sum() * (-1 if pitcher else 1), 1),
        'pitches_per_pa': div(n, len(pa), 2),
    }
    bs = df['bat_speed'].dropna()
    if not pitcher and len(bs) > 5:
        comp = df[df.bat_speed.notna()]
        out.update({'bat_speed': r(bs.mean(), 1), 'max_bat_speed': r(bs.max(), 1), 'fast_swing_pct': div((bs >= 75).sum(), len(bs)),
                    'swing_length': r(comp.swing_length.mean(), 2), 'attack_angle': r(comp.attack_angle.mean(), 1),
                    'attack_direction': r(comp.attack_direction.mean(), 1), 'swing_path_tilt': r(comp.swing_path_tilt.mean(), 1),
                    'tracked_swings': int(len(bs))})
    return out

ZONES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14]
def zone_table(df, pitcher=False):
    out = {}
    for zn in ZONES:
        d = df[df.zone == zn]
        if not len(d): out[str(zn)] = {'n': 0}; continue
        ab = d[d.is_ab]; sw = d.is_swing.sum()
        out[str(zn)] = {'n': int(len(d)), 'pct': div(len(d), len(df)), 'swing': div(sw, len(d)), 'whiff': div(d.is_whiff.sum(), sw),
                        'ba': div(ab.is_hit.sum(), len(ab)), 'slg': div(ab.tb.sum(), len(ab)),
                        'xwoba': div(d.xwoba_num.sum(), d.woba_denom.fillna(0).sum()),
                        'ev': r(d[d.is_bip].launch_speed.mean(), 1), 'rv': r(d.delta_run_exp.sum() * (-1 if pitcher else 1), 1)}
    return out

XB = np.linspace(-2, 2, 11); ZB = np.linspace(0.5, 4.5, 11)
def heat(df):
    d = df.dropna(subset=['plate_x', 'plate_z'])
    def h(mask):
        H, _, _ = np.histogram2d(d.plate_z[mask], d.plate_x[mask], bins=[ZB, XB])
        return H[::-1].astype(int).tolist()  # row 0 = top (high z)
    allm = np.ones(len(d), bool)
    return {'x_edges': XB.round(2).tolist(), 'z_edges': ZB.round(2).tolist(), 'row0': 'top', 'view': 'catcher',
            'pitches': h(allm), 'swings': h(d.is_swing.values), 'whiffs': h(d.is_whiff.values),
            'called_strikes': h(d.is_called.values), 'bip': h(d.is_bip.values), 'hard_hit': h(d.hard.values),
            'hits': h(d.is_hit.values)}

def spray(df):
    b = df[df.is_bip & df.hc_x.notna()]
    return [[r(x, 0), r(y, 0), r(ev, 1), r(la, 0), e, (bt or '')[:2] if isinstance(bt, str) else '', dt]
            for x, y, ev, la, e, bt, dt in zip(b.sx, b.sy, b.launch_speed, b.launch_angle, b.events.fillna(''), b.bb_type, b.game_date)]

def counts(df, pitcher=False):
    out = {}
    for (b, s), d in df.groupby(['balls', 'strikes']):
        if b > 3 or s > 2: continue
        pa = d[d.is_pa]
        out[f'{b}-{s}'] = {'pitches': int(len(d)), 'swing': div(d.is_swing.sum(), len(d)), 'whiff': div(d.is_whiff.sum(), d.is_swing.sum()),
                           'pa_end': int(len(pa)), 'woba': div(pa.woba_value.fillna(0).sum(), pa.woba_denom.fillna(0).sum()),
                           'k': int(pa.events.isin(['strikeout', 'strikeout_double_play']).sum())}
    return out

def by_pitch_type(df, pitcher=False):
    out = []
    tot = len(df)
    for pt, d in df.groupby('pitch_type'):
        if pd.isna(pt): continue
        c = core(d, pitcher)
        row = {'type': pt, 'name': d.pitch_name.iloc[0], 'n': int(len(d)), 'usage': div(len(d), tot),
               'velo': r(d.release_speed.mean(), 1), 'velo_max': r(d.release_speed.max(), 1), 'spin': r(d.release_spin_rate.mean(), 0),
               'ivb': r(d.ivb.mean(), 1), 'hb': r(d.hb.mean(), 1), 'extension': r(d.release_extension.mean(), 2),
               'spin_axis': r(d.spin_axis.mean(), 0), 'arm_angle': r(d.arm_angle.mean(), 1),
               'rel_x': r(d.release_pos_x.mean(), 2), 'rel_z': r(d.release_pos_z.mean(), 2),
               'rv_per_100': r(c.get('run_value', 0) / len(d) * 100, 2) if len(d) else None}
        for k in ['whiff_pct', 'csw_pct', 'chase_pct', 'zone_pct', 'ba', 'slg', 'woba', 'xba', 'xslg', 'xwoba', 'hard_hit_pct', 'avg_ev', 'avg_la', 'gb_pct', 'run_value', 'k_pct', 'pa']:
            row[k] = c.get(k)
        # put-away: 2-strike pitches that end in K
        two = d[d.strikes == 2]
        row['putaway_pct'] = div(two.events.isin(['strikeout', 'strikeout_double_play']).sum(), len(two))
        out.append(row)
    return sorted(out, key=lambda x: -x['n'])

def movement_points(df, cap=900):
    d = df.dropna(subset=['hb', 'ivb'])
    if len(d) > cap: d = d.sample(cap, random_state=7)
    return [[pt, r(h, 1), r(v, 1), r(s, 1)] for pt, h, v, s in zip(d.pitch_type, d.hb, d.ivb, d.release_speed)]

def location_points(df, cap=1200):
    d = df.dropna(subset=['plate_x', 'plate_z'])
    if len(d) > cap: d = d.sample(cap, random_state=7)
    res = np.select([d.is_whiff, d.is_called, d.is_bip & d.is_hit, d.is_bip, d.description.str.startswith('foul'), d.type.eq('B')], ['whiff', 'called', 'hit', 'out', 'foul', 'ball'], 'other')
    return [[pt, r(x, 2), r(z, 2), rs] for pt, x, z, rs in zip(d.pitch_type, d.plate_x, d.plate_z, res)]

def per_game_sc(df, pitcher=False):
    rows = []
    for (g, dt), d in df.groupby(['game_pk', 'game_date']):
        bip = d[d.is_bip]
        row = {'date': dt, 'game_pk': int(g), 'pitches': int(len(d)), 'swings': int(d.is_swing.sum()), 'whiffs': int(d.is_whiff.sum()),
               'called': int(d.is_called.sum()), 'bip': int(len(bip)), 'avg_ev': r(bip.launch_speed.mean(), 1), 'max_ev': r(bip.launch_speed.max(), 1),
               'hard': int(bip.hard.sum()), 'barrels': int(bip.barrel.sum()), 'xwoba_num': r(d.xwoba_num.sum(), 3),
               'woba_den': int(d.woba_denom.fillna(0).sum()), 'chase_sw': int((~d.in_zone & d.zone.notna() & d.is_swing).sum()),
               'oz': int((~d.in_zone & d.zone.notna()).sum()), 'rv': r(d.delta_run_exp.sum() * (-1 if pitcher else 1), 2)}
        if pitcher:
            row['velo'] = {pt: r(x.release_speed.mean(), 1) for pt, x in d.groupby('pitch_type')}
            row['mix'] = {pt: int(len(x)) for pt, x in d.groupby('pitch_type')}
        else:
            bs = d.bat_speed.dropna()
            row['bat_speed'] = r(bs.mean(), 1) if len(bs) else None
        rows.append(row)
    return sorted(rows, key=lambda x: x['date'])

# ---------------- Stats API helpers ----------------
def stats_of(block, typ):
    for s in block.get('stats', []):
        if s['type']['displayName'] == typ: return s['splits']
    return []

def team_split(splits):
    """Pick the split for TEAM_ID; fall back to total when player only played for us."""
    t = [s for s in splits if s.get('team', {}).get('id') == TEAM_ID]
    if t: return t[0]['stat']
    if len(splits) == 1 and not splits[0].get('team'): return splits[0]['stat']
    nt = [s for s in splits if not s.get('team')]
    return nt[0]['stat'] if nt and len(splits) == 1 else (splits[0]['stat'] if len(splits) == 1 else None)

def clean(stat):
    if not stat: return None
    out = {}
    for k, v in stat.items():
        if isinstance(v, dict): continue
        if isinstance(v, str):
            try: v = float(v) if v not in ('-.--', '.---', '') else None
            except ValueError: pass
        out[k] = v
    return out

def gamelog(block, post_block=None):
    rows = []
    for gtype, blk in (('R', block), ('P', post_block or {})):
        for s in stats_of(blk, 'gameLog'):
            if s.get('team', {}).get('id') != TEAM_ID: continue
            st = clean(s['stat']); st.pop('summary', None)
            rows.append({'date': s['date'], 'game_pk': s.get('game', {}).get('gamePk'), 'opp': s.get('opponent', {}).get('name'),
                         'opp_id': s.get('opponent', {}).get('id'), 'home': s.get('isHome'), 'win': s.get('isWin'), 'gt': gtype, **st})
    return sorted(rows, key=lambda x: (x['date'], x['gt']))

def splits_table(block):
    out = {}
    for s in stats_of(block, 'statSplits'):
        if s.get('team', {}).get('id') != TEAM_ID: continue
        out[s['split']['code']] = {'label': s['split']['description'], **clean(s['stat'])}
    return out

def months(block):
    out = []
    for s in stats_of(block, 'byMonth'):
        if s.get('team', {}).get('id') not in (TEAM_ID, None): continue
        if s.get('team', {}).get('id') is None and len(stats_of(block, 'season')) > 1: continue
        out.append({'month': s.get('month'), **clean(s['stat'])})
    return sorted(out, key=lambda x: x['month'] or 0)

def ip_to_outs(ip):
    if ip is None: return 0
    ip = float(ip); w = int(ip); return w * 3 + round((ip - w) * 10)

def rolling(rows, keyfn, win):
    """rows already in date order; keyfn returns dict of summable values; returns list of window sums"""
    out = []
    for i in range(len(rows)):
        w = rows[max(0, i - win + 1): i + 1]
        agg = {}
        for x in w:
            for k, v in keyfn(x).items(): agg[k] = agg.get(k, 0) + (v or 0)
        out.append(agg)
    return out

def lb(name, idcol='player_id'):
    df = pd.read_csv(f'{RAW}/lb/{name}.csv', low_memory=False)
    df.columns = [c.replace('﻿', '').strip('"') for c in df.columns]
    return {int(k): {c: (None if pd.isna(v) else (v.item() if hasattr(v, 'item') else v)) for c, v in row.items()} for k, row in zip(df[idcol], df.to_dict('records')) if not pd.isna(k)}

def build():
    bat = prep(load_sc('batter')); pit = prep(load_sc('pitcher'))
    batR = bat[bat.game_type == 'R']; pitR = pit[pit.game_type == 'R']
    LB = {'sprint': lb('sprint'), 'oaa': lb('oaa'), 'arm': lb('arm'), 'pct_bat': lb('pct_bat'), 'pct_pit': lb('pct_pit'),
          'framing': lb('framing', 'id'), 'poptime': lb('poptime', 'entity_id'), 'battrack': lb('battrack', 'id'),
          'swingtake': lb('run_value_bat'), 'ev': lb('ev')}
    ars = pd.read_csv(f'{RAW}/lb/arsenal_pit.csv'); ars.columns = [c.replace('﻿', '') for c in ars.columns]
    # league context from statcast leaderboards for percentile-ish comparisons
    index = []
    for f in sorted(glob.glob(f'{RAW}/players/*.json')):
        d = json.load(open(f)); p = d['person']; pid = p['id']
        hs = clean(team_split(stats_of(d['hitting'], 'season'))) or {}
        ps = clean(team_split(stats_of(d['pitching'], 'season'))) or {}
        glh = gamelog(d['hitting'], d.get('hitting_post')); glp = gamelog(d['pitching'], d.get('pitching_post'))
        glh_r = [g for g in glh if g['gt'] == 'R']; glp_r = [g for g in glp if g['gt'] == 'R']
        is_pitcher = p['primaryPosition']['type'] == 'Pitcher' or p['primaryPosition']['abbreviation'] == 'TWP'
        played_h = bool(glh) and sum(g.get('plateAppearances', 0) or 0 for g in glh) > 0
        played_p = bool(glp) and sum(g.get('battersFaced', 0) or 0 for g in glp) > 0
        if not played_h and not played_p:
            continue
        role = 'pitcher' if is_pitcher else 'hitter'
        two_way = played_h and played_p and not (is_pitcher and sum(g.get('plateAppearances', 0) for g in glh) < 10) and not (not is_pitcher and sum(g.get('battersFaced', 0) for g in glp) < 30)
        ro = d['roster']
        out = {
            'id': f'atl-{pid}', 'mlbam': pid, 'team': 'atl', 'level': 'MLB', 'season': 2026,
            'name': p['fullName'], 'first': p.get('useName') or p['firstName'], 'last': p.get('useLastName') or p['lastName'],
            'number': ro.get('jerseyNumber') or p.get('primaryNumber'), 'pos': p['primaryPosition']['abbreviation'],
            'pos_name': p['primaryPosition']['name'], 'role': 'two-way' if two_way else role,
            'bats': p['batSide']['code'], 'throws': p['pitchHand']['code'], 'age': p.get('currentAge'), 'birth_date': p.get('birthDate'),
            'birthplace': ', '.join(x for x in [p.get('birthCity'), p.get('birthStateProvince'), p.get('birthCountry')] if x),
            'height': p.get('height'), 'weight': p.get('weight'), 'debut': p.get('mlbDebutDate'), 'nickname': p.get('nickName'),
            'draft_year': p.get('draftYear'), 'status': ro['status']['description'],
            'sz_top': r(p.get('strikeZoneTop'), 2), 'sz_bot': r(p.get('strikeZoneBottom'), 2),
            'sources': ['MLB Stats API (statsapi.mlb.com)', 'Baseball Savant / Statcast (baseballsavant.mlb.com)'],
        }
        # ---------- hitting ----------
        if played_h:
            sab = clean(team_split(stats_of(d['hitting'], 'sabermetrics')))
            adv = clean(team_split(stats_of(d['hitting'], 'seasonAdvanced')))
            mine = batR[batR.batter == pid]
            H = {'season': hs, 'advanced': adv, 'sabermetrics': sab, 'expected_api': clean((stats_of(d['hitting'], 'expectedStatistics') or [{}])[0].get('stat')),
                 'postseason': clean(team_split(stats_of(d.get('hitting_post', {}), 'season'))),
                 'splits': splits_table(d.get('hitting_splits', {})), 'months': months(d['hitting'])}
            if len(mine):
                H['statcast'] = core(mine)
                H['statcast_vs'] = {'vs_RHP': core(mine[mine.p_throws == 'R']), 'vs_LHP': core(mine[mine.p_throws == 'L'])}
                H['zones'] = zone_table(mine); H['heat'] = heat(mine); H['spray'] = spray(mine)
                H['counts'] = counts(mine); H['vs_pitch_type'] = by_pitch_type(mine)
                H['locations'] = location_points(mine, 900)
                pg = {g['game_pk']: g for g in per_game_sc(bat[bat.batter == pid])}
            else:
                pg = {}
            for g in glh:
                sc = pg.get(g['game_pk'])
                if sc:
                    g['sc'] = {k: sc[k] for k in ['pitches', 'swings', 'whiffs', 'bip', 'avg_ev', 'max_ev', 'hard', 'barrels', 'xwoba_num', 'woba_den', 'chase_sw', 'oz', 'rv', 'bat_speed']}
            H['gamelog'] = glh
            # rolling 15-game and cumulative
            def hk(g):
                sc = g.get('sc', {})
                return {'pa': g.get('plateAppearances'), 'ab': g.get('atBats'), 'h': g.get('hits'), 'bb': g.get('baseOnBalls'), 'hbp': g.get('hitByPitch'),
                        'sf': g.get('sacFlies'), 'tb': g.get('totalBases'), 'k': g.get('strikeOuts'), 'hr': g.get('homeRuns'),
                        'xn': sc.get('xwoba_num'), 'xd': sc.get('woba_den'), 'evs': (sc.get('avg_ev') or 0) * (sc.get('bip') or 0) if sc.get('avg_ev') else 0,
                        'bip': sc.get('bip') if sc.get('avg_ev') else 0, 'hard': sc.get('hard')}
            def rates(a):
                obp_d = (a['ab'] + a['bb'] + a['hbp'] + a['sf'])
                return {'avg': div(a['h'], a['ab']), 'obp': div(a['h'] + a['bb'] + a['hbp'], obp_d), 'slg': div(a['tb'], a['ab']),
                        'ops': r((div(a['h'] + a['bb'] + a['hbp'], obp_d) or 0) + (div(a['tb'], a['ab']) or 0), 3) if a['ab'] else None,
                        'xwoba': div(a['xn'], a['xd']), 'k_pct': div(a['k'], a['pa']), 'bb_pct': div(a['bb'], a['pa']),
                        'avg_ev': div(a['evs'], a['bip'], 1), 'hard_hit_pct': div(a['hard'], a['bip']), 'hr': a['hr'], 'pa': a['pa']}
            H['rolling_15g'] = [{'date': g['date'], **rates(a)} for g, a in zip(glh_r, rolling(glh_r, hk, 15))]
            H['cumulative'] = [{'date': g['date'], **rates(a)} for g, a in zip(glh_r, rolling(glh_r, hk, 10_000))]
            out['hitting'] = H
        # ---------- pitching ----------
        if played_p:
            sab = clean(team_split(stats_of(d['pitching'], 'sabermetrics')))
            adv = clean(team_split(stats_of(d['pitching'], 'seasonAdvanced')))
            mine = pitR[pitR.pitcher == pid]
            P = {'season': ps, 'advanced': adv, 'sabermetrics': sab, 'expected_api': clean((stats_of(d['pitching'], 'expectedStatistics') or [{}])[0].get('stat')),
                 'postseason': clean(team_split(stats_of(d.get('pitching_post', {}), 'season'))),
                 'splits': splits_table(d.get('pitching_splits', {})), 'months': months(d['pitching'])}
            if len(mine):
                P['statcast'] = core(mine, True)
                P['statcast_vs'] = {'vs_RHB': core(mine[mine.stand == 'R'], True), 'vs_LHB': core(mine[mine.stand == 'L'], True)}
                P['arsenal'] = by_pitch_type(mine, True)
                P['arsenal_vs'] = {'vs_RHB': [{k: x[k] for k in ('type', 'n', 'usage')} for x in by_pitch_type(mine[mine.stand == 'R'], True)],
                                   'vs_LHB': [{k: x[k] for k in ('type', 'n', 'usage')} for x in by_pitch_type(mine[mine.stand == 'L'], True)]}
                P['zones'] = zone_table(mine, True); P['heat'] = heat(mine)
                P['heat_by_type'] = {pt: heat(x)['pitches'] for pt, x in mine.groupby('pitch_type') if len(x) >= 30}
                P['spray_allowed'] = spray(mine); P['counts'] = counts(mine, True)
                P['movement'] = movement_points(mine); P['locations'] = location_points(mine)
                rel = mine.dropna(subset=['release_pos_x', 'release_pos_z'])
                rel = rel.sample(min(len(rel), 400), random_state=3)
                P['release'] = [[pt, r(x, 2), r(z, 2)] for pt, x, z in zip(rel.pitch_type, rel.release_pos_x, rel.release_pos_z)]
                P['savant_arsenal'] = [{k: (None if pd.isna(v) else v) for k, v in row.items() if k not in ('last_name, first_name', 'player_id', 'team_name_alt')}
                                       for row in ars[ars.player_id == pid].to_dict('records')]
                pg = {g['game_pk']: g for g in per_game_sc(pit[pit.pitcher == pid], True)}
            else:
                pg = {}
            for g in glp:
                sc = pg.get(g['game_pk'])
                if sc:
                    g['sc'] = {k: sc[k] for k in ['pitches', 'swings', 'whiffs', 'called', 'bip', 'avg_ev', 'hard', 'barrels', 'xwoba_num', 'woba_den', 'rv', 'velo', 'mix']}
            P['gamelog'] = glp
            def pk(g):
                sc = g.get('sc', {})
                return {'outs': ip_to_outs(g.get('inningsPitched')), 'er': g.get('earnedRuns'), 'bf': g.get('battersFaced'), 'k': g.get('strikeOuts'),
                        'bb': g.get('baseOnBalls'), 'hr': g.get('homeRuns'), 'hbp': g.get('hitByPitch'), 'h': g.get('hits'),
                        'xn': sc.get('xwoba_num'), 'xd': sc.get('woba_den'), 'sw': sc.get('swings'), 'wh': sc.get('whiffs'), 'pi': sc.get('pitches'), 'cs': sc.get('called')}
            def prates(a):
                ip = a['outs'] / 3
                return {'era': div(a['er'] * 9, ip, 2), 'whip': div(a['bb'] + a['h'], ip, 2), 'k_pct': div(a['k'], a['bf']), 'bb_pct': div(a['bb'], a['bf']),
                        'fip_raw': div(13 * a['hr'] + 3 * (a['bb'] + a['hbp']) - 2 * a['k'], ip, 2), 'xwoba': div(a['xn'], a['xd']),
                        'whiff_pct': div(a['wh'], a['sw']), 'csw_pct': div(a['wh'] + a['cs'], a['pi']), 'ip': r(ip, 1)}
            win = 5 if (ps.get('gamesStarted') or 0) >= 5 else 10
            P['rolling'] = {'window_games': win, 'rows': [{'date': g['date'], **prates(a)} for g, a in zip(glp_r, rolling(glp_r, pk, win))]}
            P['cumulative'] = [{'date': g['date'], **prates(a)} for g, a in zip(glp_r, rolling(glp_r, pk, 10_000))]
            # convert raw FIP to real FIP using the constant implied by the season FIP
            cst = 3.1
            if sab and sab.get('fip') is not None and P['cumulative'] and P['cumulative'][-1]['fip_raw'] is not None:
                cst = sab['fip'] - P['cumulative'][-1]['fip_raw']
            for row in P['rolling']['rows'] + P['cumulative']:
                fr = row.pop('fip_raw'); row['fip'] = r(fr + cst, 2) if fr is not None else None
            P['fip_constant'] = r(cst, 3)
            out['pitching'] = P
        # ---------- fielding / running / extras ----------
        fs = [clean(s['stat']) | {'position': s['stat']['position']['abbreviation']} for s in stats_of(d['fielding'], 'season') if s.get('team', {}).get('id') == TEAM_ID]
        out['fielding'] = {'by_position': fs, 'oaa': LB['oaa'].get(pid), 'arm': LB['arm'].get(pid), 'framing': LB['framing'].get(pid), 'poptime': LB['poptime'].get(pid)}
        out['running'] = {'sprint': LB['sprint'].get(pid), 'sb': hs.get('stolenBases'), 'cs': hs.get('caughtStealing')}
        out['bat_tracking_lb'] = LB['battrack'].get(pid); out['swing_take'] = LB['swingtake'].get(pid); out['ev_lb'] = LB['ev'].get(pid)
        out['percentiles'] = {'batting': LB['pct_bat'].get(pid), 'pitching': LB['pct_pit'].get(pid)}
        out['career'] = [{'season': s['season'], 'team': s.get('team', {}).get('abbreviation') or s.get('team', {}).get('name'), 'level': s.get('sport', {}).get('abbreviation'), **{k: v for k, v in clean(s['stat']).items()}}
                         for s in stats_of(d['career'], 'yearByYear')]
        json.dump(out, open(f'{OUT}/atl-{pid}.json', 'w'), separators=(',', ':'), allow_nan=False, default=lambda o: None)
        index.append(card(out))
    return index

def card(o):
    c = {k: o.get(k) for k in ['id', 'team', 'name', 'first', 'last', 'number', 'pos', 'role', 'bats', 'throws', 'age', 'height', 'weight', 'status']}
    if 'hitting' in o and o['role'] != 'pitcher':
        s = o['hitting']['season']; sc = o['hitting'].get('statcast', {}); sb = o['hitting'].get('sabermetrics') or {}
        c['line'] = {'G': s.get('gamesPlayed'), 'PA': s.get('plateAppearances'), 'AVG': s.get('avg'), 'OBP': s.get('obp'), 'SLG': s.get('slg'), 'OPS': s.get('ops'),
                     'HR': s.get('homeRuns'), 'RBI': s.get('rbi'), 'SB': s.get('stolenBases'), 'wRC+': r(sb.get('wRcPlus'), 0), 'WAR': r(sb.get('war'), 1),
                     'xwOBA': sc.get('xwoba'), 'EV': sc.get('avg_ev'), 'Barrel%': sc.get('barrel_pct')}
        c['sort'] = s.get('plateAppearances') or 0
    else:
        s = o['pitching']['season']; sc = o['pitching'].get('statcast', {}); sb = o['pitching'].get('sabermetrics') or {}
        ff = next((a for a in o['pitching'].get('arsenal', []) if a['type'] in ('FF', 'SI')), None)
        c['line'] = {'G': s.get('gamesPlayed'), 'GS': s.get('gamesStarted'), 'IP': s.get('inningsPitched'), 'W': s.get('wins'), 'L': s.get('losses'), 'SV': s.get('saves'),
                     'ERA': s.get('era'), 'WHIP': s.get('whip'), 'K': s.get('strikeOuts'), 'K/9': s.get('strikeoutsPer9Inn'), 'FIP': r(sb.get('fip'), 2), 'WAR': r(sb.get('war'), 1),
                     'xwOBA': sc.get('xwoba'), 'Whiff%': sc.get('whiff_pct'), 'FB velo': ff['velo'] if ff else None}
        c['sort'] = ip_to_outs(s.get('inningsPitched')) * 2
    return c

if __name__ == '__main__':
    idx = build()
    json.dump(idx, open(W + '/out/atl_index.json', 'w'))
    print(len(idx), 'players')

import json, urllib.request, shutil, os, glob, datetime
import os as _os
W = _os.environ.get('CB_WORK', '/home/claude/cb')
OUT=_os.environ.get('CB_DATA_OUT', W + '/app/data')
os.makedirs(OUT+'/players', exist_ok=True)
def get(u):
    with urllib.request.urlopen(u, timeout=60) as r: return json.load(r)
sch = get("https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=144&season=2026&gameType=R,F,D,L,W")
games=[]
for dt in sch['dates']:
    for g in dt['games']:
        if g['status']['codedGameState'] != 'F' and g['status']['abstractGameState']!='Final': continue
        home = g['teams']['home']['team']['id']==144
        us = g['teams']['home' if home else 'away']; them = g['teams']['away' if home else 'home']
        games.append({'id':g['gamePk'],'date':g['officialDate'],'opp':them['team']['name'],'home':home,'us':us.get('score'),'them':them.get('score'),
                      'result':'W' if us.get('isWinner') else 'L','gt':g['gameType'],'dh':g.get('doubleHeader')})
games.sort(key=lambda g:(g['date'],g['id'])); seen=set(); games=[g for g in games if not (g['id'] in seen or seen.add(g['id']))]
reg=[g for g in games if g['gt']=='R']; post=[g for g in games if g['gt']!='R']
atl={'team':'atl','name':'Atlanta Braves','short':'Braves','level':'MLB','season':2026,
     'record':f"{sum(g['result']=='W' for g in reg)}-{sum(g['result']=='L' for g in reg)}",
     'postseason':f"{sum(g['result']=='W' for g in post)}-{sum(g['result']=='L' for g in post)}",'games':games}
usm=json.load(open(W + '/out/usm_team.json')); usm['short']='Golden Eagles'; usm['level']='NCAA D1 (Sun Belt)'
ai=json.load(open(W + '/out/atl_index.json')); ui=json.load(open(W + '/out/usm_index.json'))
def flat(pid):
    p=json.load(open(W + f'/out/players/{pid}.json'))
    o={}
    def put(k,v):
        if v is not None and v != '': o[k]=v
    if p['team']=='atl':
        h=p.get('hitting')
        if h:
            s=h['season']; sb=h.get('sabermetrics') or {}; sc=h.get('statcast') or {}; adv=h.get('advanced') or {}
            bt=p.get('bat_tracking_lb') or {}; sp=(p.get('running') or {}).get('sprint') or {}; oaa=(p.get('fielding') or {}).get('oaa') or {}
            for k,v in [('G',s.get('gamesPlayed')),('PA',s.get('plateAppearances')),('AB',s.get('atBats')),('H',s.get('hits')),('AVG',s.get('avg')),('OBP',s.get('obp')),('SLG',s.get('slg')),('OPS',s.get('ops')),
                        ('HR',s.get('homeRuns')),('RBI',s.get('rbi')),('R',s.get('runs')),('SB',s.get('stolenBases')),('BB',s.get('baseOnBalls')),('K',s.get('strikeOuts')),('2B',s.get('doubles')),('3B',s.get('triples')),
                        ('ISO',adv.get('iso')),('BABIP',s.get('babip')),('wOBA',sb.get('woba')),('wRC+',sb.get('wRcPlus')),('WAR',sb.get('war')),('xBA',sc.get('xba')),('xSLG',sc.get('xslg')),('xwOBA',sc.get('xwoba')),
                        ('EV',sc.get('avg_ev')),('maxEV',sc.get('max_ev')),('Barrel%',sc.get('barrel_pct')),('HardHit%',sc.get('hard_hit_pct')),('SweetSpot%',sc.get('sweet_spot_pct')),('LA',sc.get('avg_la')),
                        ('K%',sc.get('k_pct')),('BB%',sc.get('bb_pct')),('Whiff%',sc.get('whiff_pct')),('Chase%',sc.get('chase_pct')),('Swing%',sc.get('swing_pct')),('Pull%',sc.get('pull_pct')),('GB%',sc.get('gb_pct')),('FB%',sc.get('fb_pct')),
                        ('BatSpeed',bt.get('avg_bat_speed')),('SprintSpeed',sp.get('sprint_speed')),('OAA',oaa.get('outs_above_average'))]: put('h.'+k,v)
        P=p.get('pitching')
        if P:
            s=P['season']; sb=P.get('sabermetrics') or {}; sc=P.get('statcast') or {}; adv=P.get('advanced') or {}
            fb=next((a for a in P.get('arsenal',[]) if a['type'] in ('FF','SI')),None)
            outs=lambda ip: (int(float(ip))*3+round((float(ip)-int(float(ip)))*10)) if ip not in (None,'') else 0
            for k,v in [('G',s.get('gamesPlayed')),('GS',s.get('gamesStarted')),('IP',round(outs(s.get('inningsPitched'))/3,2)),('W',s.get('wins')),('L',s.get('losses')),('SV',s.get('saves')),('HLD',s.get('holds')),
                        ('ERA',s.get('era')),('FIP',sb.get('fip')),('xFIP',sb.get('xfip')),('WHIP',s.get('whip')),('K',s.get('strikeOuts')),('BB',s.get('baseOnBalls')),('HR',s.get('homeRuns')),
                        ('K/9',s.get('strikeoutsPer9Inn')),('BB/9',s.get('walksPer9Inn')),('K%',sc.get('k_pct')),('BB%',sc.get('bb_pct')),('K-BB%',adv.get('strikeoutsMinusWalksPercentage')),
                        ('Whiff%',sc.get('whiff_pct')),('CSW%',sc.get('csw_pct')),('Chase%',sc.get('chase_pct')),('xwOBA',sc.get('xwoba')),('xBA',sc.get('xba')),('EV',sc.get('avg_ev')),
                        ('Barrel%',sc.get('barrel_pct')),('HardHit%',sc.get('hard_hit_pct')),('GB%',sc.get('gb_pct')),('Velo',fb['velo'] if fb else None),('WAR',sb.get('war')),('OPP AVG',s.get('avg'))]: put('p.'+k,v)
    else:
        h=p.get('hitting')
        if h:
            s=h['season']; pd=h['plate_discipline']; sp=h['spray']; d=h.get('direction') or {}
            for k,v in [('G',s['G']),('PA',s['PA']),('AB',s['AB']),('H',s['H']),('AVG',s['AVG']),('OBP',s['OBP']),('SLG',s['SLG']),('OPS',s['OPS']),('HR',s['HR']),('RBI',s['RBI']),('R',s['R']),('SB',s['SB']),
                        ('BB',s['BB']),('K',s['K']),('2B',s['2B']),('3B',s['3B']),('ISO',s['ISO']),('BABIP',s['BABIP']),('wOBA',s['wOBA']),('OPS+',s['OPS+']),('K%',s['K%']),('BB%',s['BB%']),
                        ('Whiff%',pd['whiff_pct']),('Swing%',pd['swing_pct']),('Contact%',pd['contact_pct']),('1st Swing%',pd['first_pitch_swing_pct']),('P/PA',pd['pitches_per_pa']),
                        ('GB%',sp['gb_pct']),('FB%',sp['fb_pct']),('Pull%',d.get('pull_pct'))]: put('h.'+k,v)
        P=p.get('pitching')
        if P:
            s=P['season']; ps=P['pitch_sequence']
            for k,v in [('G',s['APP']),('GS',s['GS']),('IP',s['IP_dec']),('W',s['W']),('L',s['L']),('SV',s['SV']),('ERA',s['ERA']),('FIP',s['FIP']),('WHIP',s['WHIP']),('K',s['K']),('BB',s['BB']),('HR',s['HR']),
                        ('K/9',s['K/9']),('BB/9',s['BB/9']),('K%',s['K%']),('BB%',s['BB%']),('K-BB%',s['K-BB%']),('OPP AVG',s['OPP_AVG']),('Strike%',ps['strike_pct']),('F-Strike%',ps['first_pitch_strike_pct']),
                        ('Whiff%',ps['whiff_pct']),('CSW%',ps['csw_pct']),('Putaway%',ps['putaway_pct']),('P/IP',s['P/IP'])]: put('p.'+k,v)
    return o
for c in ai+ui: c['s']=flat(c['id'].split('-',1)[0]+'-'+c['id'].split('-',1)[1])
idx={'built':datetime.datetime.now(datetime.UTC).strftime('%Y-%m-%dT%H:%MZ'),'season':2026,
     'teams':{'atl':{k:v for k,v in atl.items()},'usm':{k:v for k,v in usm.items()}},
     'players':sorted(ai+ui,key=lambda c:(c['team'],-c['sort']))}
json.dump(idx,open(OUT+'/index.json','w'),separators=(',',':'))
for f in glob.glob(W + '/out/players/*.json'): shutil.copy(f, OUT+'/players/')
print(atl['record'],atl['postseason'],len(idx['players']), os.path.getsize(OUT+'/index.json'))

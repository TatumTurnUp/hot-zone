import json,re,glob,sys,os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from nuxt import load
OUT=sys.argv[1]
norm=lambda s:re.sub(r'[^a-z]','',(s or '').lower())
roster=load('roster.html')
rp=list(roster['pinia']['roster']['roster'].values())[0]['players']
ros=[]
for p in rp:
    ros.append({k:p.get(k) for k in ['rosterPlayerId','firstName','lastName','hometown','highSchool','previousSchool','positionShort','heightFeet','heightInches','weight','academicYearShort','academicYearLong','jerseyNumber']})
games=[]; pbp=[]
for f in sorted(glob.glob('box/*.html'),key=lambda x:int(re.findall(r'\d+',x)[0])):
    gid=int(re.findall(r'(\d+)\.html',f)[0])
    r=load(f); b=list(r['pinia']['boxscore']['boxscore'].values())[0]
    usm_home=b['homeTeamId']=='USM' or b['homeTeam'].get('isTenantTeam')
    us=b['homeTeam'] if usm_home else b['visitingTeam']; them=b['visitingTeam'] if usm_home else b['homeTeam']
    m,d,y=b['gameDate'].split('/')
    g={'id':gid,'date':f'{y}-{m}-{d}','opp':them['name'],'opp_code':them['code'],'home':bool(usm_home),'neutral':b.get('isNeutral'),
       'conf':b.get('isALeagueGame'),'venue':b.get('venue'),'us':int(us['score']),'them':int(them['score']),
       'result':'W' if int(us['score'])>int(them['score']) else 'L','innings':len(b['playByPlayInnings']),
       'line_us':[x for x in (b['periodScoresHome'] if usm_home else b['periodScoresAway']) or []],
       'line_them':[x for x in (b['periodScoresAway'] if usm_home else b['periodScoresHome']) or []],
       'players':[],'opp_players':[]}
    for p in us['players']:
        g['players'].append({k:p.get(k) for k in ['name','rosterPlayerId','uniform','spot','substitute','position','bats','throws','gamePlayed','gameStarted','hitting','pitching','fielding']})
    for p in them['players']:
        g['opp_players'].append({k:p.get(k) for k in ['name','position','bats','throws','pitching']})
    # pitcher tracking
    def starter(team):
        ps=[p for p in team['players'] if p.get('pitching') and p['pitching'].get('orderOfAppearance')=='1']
        return ps[0]['name'] if ps else None
    cur={'us':starter(us),'them':starter(them)}
    hands={'us':{norm(p['name']):(p.get('throws'),p.get('bats')) for p in us['players']},'them':{norm(p['name']):(p.get('throws'),p.get('bats')) for p in them['players']}}
    for inn in b['playByPlayInnings']:
        for side in ('visitingPlays','homePlays'):
            bat='us' if (side=='homePlays')==bool(usm_home) else 'them'
            fld='them' if bat=='us' else 'us'
            for pl in inn[side] or []:
                t=pl['narrative']
                mm=re.match(r'(\w+) pitching change: (.+?) replaces (.+?)\.?$',t)
                if mm:
                    team='us' if mm.group(1)=='USM' else 'them'
                    cur[team]=mm.group(2).replace(',',', ',1) if ', ' not in mm.group(2) else mm.group(2)
                    continue
                if pl['isASubstitutePlay']: continue
                cm=re.search(r'\((\d)-(\d)(?: ([A-Z]+))?\)',t.split(';')[0])
                pbp.append({'g':gid,'inn':int(inn['number']),'half':'top' if side=='visitingPlays' else 'bot','bat_team':bat,
                    'pitcher':cur[fld],'p_throws':hands[fld].get(norm(cur[fld]),(None,None))[0] if cur[fld] else None,
                    'text':t,'scored':pl.get('numberScored',0),
                    'balls':int(cm.group(1)) if cm else None,'strikes':int(cm.group(2)) if cm else None,'seq':(cm.group(3) or '') if cm else None})
    games.append(g)
json.dump({'roster':ros,'games':games,'pbp':pbp},open(OUT,'w'))
print(len(games),len(pbp),sum(1 for p in pbp if p['seq'] is not None))

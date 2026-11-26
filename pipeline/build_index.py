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
idx={'built':datetime.datetime.now(datetime.UTC).strftime('%Y-%m-%dT%H:%MZ'),'season':2026,
     'teams':{'atl':{k:v for k,v in atl.items()},'usm':{k:v for k,v in usm.items()}},
     'players':sorted(ai+ui,key=lambda c:(c['team'],-c['sort']))}
json.dump(idx,open(OUT+'/index.json','w'),separators=(',',':'))
for f in glob.glob(W + '/out/players/*.json'): shutil.copy(f, OUT+'/players/')
print(atl['record'],atl['postseason'],len(idx['players']), os.path.getsize(OUT+'/index.json'))

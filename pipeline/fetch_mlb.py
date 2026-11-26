"""Download everything the Braves side needs: roster, per-player Stats API data,
every 2026 Statcast pitch (Braves hitting + pitching) and Savant leaderboards."""
import json, os, datetime as dt, urllib.request, concurrent.futures as cf
W = os.environ.get('CB_WORK', '/home/claude/cb'); RAW = W + '/raw'
SEASON = int(os.environ.get('CB_SEASON', '2026')); TEAM = 144; ABBR = 'ATL'
for d in ('players', 'sc', 'lb'): os.makedirs(f'{RAW}/{d}', exist_ok=True)
B = 'https://statsapi.mlb.com/api/v1'
def get(u, raw=False, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'hot-zone-stats/1.0 (+https://github.com/TatumTurnUp/hot-zone)'}), timeout=170) as r:
                b = r.read(); return b if raw else json.loads(b)
        except Exception as e: err = e
    raise RuntimeError(f'{u}: {err}')
ros = get(f'{B}/teams/{TEAM}/roster?rosterType=fullSeason&season={SEASON}&hydrate=person')
json.dump(ros, open(f'{RAW}/roster_full.json', 'w'))
def player(p):
    pid = p['person']['id']; isP = p['position']['type'] == 'Pitcher'; d = {'roster': p}
    d['person'] = get(f'{B}/people/{pid}?hydrate=currentTeam')['people'][0]
    for g in ('hitting', 'pitching', 'fielding'):
        d[g] = get(f'{B}/people/{pid}/stats?stats=season,sabermetrics,expectedStatistics,seasonAdvanced,gameLog,byMonth&group={g}&season={SEASON}&gameType=R')
        d[g + '_post'] = get(f'{B}/people/{pid}/stats?stats=season,gameLog&group={g}&season={SEASON}&gameType=P')
        if g != 'fielding':
            d[g + '_splits'] = get(f'{B}/people/{pid}/stats?stats=statSplits&group={g}&season={SEASON}&sitCodes=vl,vr,h,a,risp,d,n,ron,r0,e,lc&gameType=R')
    d['career'] = get(f'{B}/people/{pid}/stats?stats=yearByYear&group={"pitching" if isP else "hitting"}')
    json.dump(d, open(f'{RAW}/players/{pid}.json', 'w'))
with cf.ThreadPoolExecutor(10) as ex: list(ex.map(player, ros['roster']))
print('players', len(ros['roster']))
# Statcast pitch-by-pitch in 10-day windows (Savant caps one export at 25k rows)
def sc(job):
    pt, a, b = job
    u = (f'https://baseballsavant.mlb.com/statcast_search/csv?all=true&hfGT=R%7CF%7CD%7CL%7CW%7C&hfSea={SEASON}%7C&player_type={pt}'
         f'&team={ABBR}&type=details&game_date_gt={a}&game_date_lt={b}&min_pitches=0&min_results=0&group_by=name&sort_col=pitches&sort_order=desc&min_pas=0')
    data = get(u, raw=True)
    if not data.lstrip(b'\xef\xbb\xbf').startswith(b'"pitch_type"') and len(data) > 50: raise RuntimeError('bad statcast csv ' + u)
    open(f'{RAW}/sc/{pt}_{a}.csv', 'wb').write(data)
jobs = []; d0 = dt.date(SEASON, 3, 15); end = dt.date(SEASON, 11, 10)
while d0 < end:
    d1 = d0 + dt.timedelta(days=9)
    jobs += [(pt, d0.isoformat(), d1.isoformat()) for pt in ('batter', 'pitcher')]
    d0 = d1 + dt.timedelta(days=1)
with cf.ThreadPoolExecutor(6) as ex: list(ex.map(sc, jobs))
print('statcast windows', len(jobs))
S = SEASON; LB = {
 'sprint': f'https://baseballsavant.mlb.com/leaderboard/sprint_speed?min_season={S}&max_season={S}&position=&team=&min=0&csv=true',
 'oaa': f'https://baseballsavant.mlb.com/leaderboard/outs_above_average?type=Fielder&startYear={S}&endYear={S}&split=no&team=&range=year&min=q&pos=&roles=&viz=hide&csv=true',
 'arm': f'https://baseballsavant.mlb.com/leaderboard/arm-strength?type=player&year={S}&minThrows=50&pos=&team=&csv=true',
 'pct_bat': f'https://baseballsavant.mlb.com/leaderboard/percentile-rankings?type=batter&year={S}&position=&team=&csv=true',
 'pct_pit': f'https://baseballsavant.mlb.com/leaderboard/percentile-rankings?type=pitcher&year={S}&position=&team=&csv=true',
 'framing': f'https://baseballsavant.mlb.com/leaderboard/catcher-framing?type=catcher&seasonStart={S}&seasonEnd={S}&team=&min=q&sortColumn=rv_tot&sortDirection=desc&csv=true',
 'poptime': f'https://baseballsavant.mlb.com/leaderboard/poptime?year={S}&team=&min2b=5&min3b=0&csv=true',
 'arsenal_pit': f'https://baseballsavant.mlb.com/leaderboard/pitch-arsenal-stats?type=pitcher&pitchType=&year={S}&team=&min=10&csv=true',
 'battrack': f'https://baseballsavant.mlb.com/leaderboard/bat-tracking?attackZone=&batSide=&contactType=&count=&dateStart={S}-03-01&dateEnd={S}-11-15&gameType=&isHardHit=&minSwings=1&minGroupSwings=1&pitchHand=&pitchType=&seasonStart={S}&seasonEnd={S}&team=&type=batter&csv=true',
 'run_value_bat': f'https://baseballsavant.mlb.com/leaderboard/swing-take?year={S}&team=&leverage=Neutral&group=Batter&type=All&sub_type=null&min=q&csv=true',
 'ev': f'https://baseballsavant.mlb.com/leaderboard/statcast?type=batter&year={S}&position=&team=&min=1&sort=barrels_per_pa&sortDir=desc&csv=true'}
for k, u in LB.items(): open(f'{RAW}/lb/{k}.csv', 'wb').write(get(u, raw=True))
print('leaderboards', len(LB))

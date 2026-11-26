"""Download Southern Miss roster + every box score from southernmiss.com, then extract to raw JSON."""
import os, re, sys, time, subprocess, urllib.request
W = os.environ.get('CB_WORK', '/home/claude/cb'); SEASON = os.environ.get('CB_SEASON', '2026')
D = W + '/usm_html'; os.makedirs(D + '/box', exist_ok=True); os.makedirs(W + '/raw/usm', exist_ok=True)
SITE = 'https://southernmiss.com'
def get(u):
    for i in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'hot-zone-stats/1.0 (+https://github.com/TatumTurnUp/hot-zone)'}), timeout=60) as r: return r.read()
        except Exception as e: err = e; time.sleep(2)
    raise RuntimeError(f'{u}: {err}')
stats = get(f'{SITE}/sports/baseball/stats/{SEASON}').decode('utf-8', 'replace')
open(D + '/stats.html', 'w').write(stats)
open(D + '/roster.html', 'wb').write(get(f'{SITE}/sports/baseball/roster/{SEASON}'))
urls = sorted(set(re.findall(rf'href="(/sports/baseball/stats/{SEASON}/[^"]+/boxscore/\d+)"', stats)), key=lambda u: int(u.rsplit('/', 1)[1]))
for u in urls:
    p = f'{D}/box/{u.rsplit("/", 1)[1]}.html'
    if not os.path.exists(p): open(p, 'wb').write(get(SITE + u)); time.sleep(0.3)
print('box scores', len(urls))
here = os.path.dirname(os.path.abspath(__file__))
subprocess.run([sys.executable, os.path.join(here, 'extract_usm.py'), f'{W}/raw/usm/usm_{SEASON}_raw.json'], cwd=D, check=True)

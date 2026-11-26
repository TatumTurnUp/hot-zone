// Stat registry: how each stat is labeled, formatted, ranked, and which season-trend series it maps to.
// fmt: avg (.300), pct (25.0%), n2 (3.21), n1 (92.5), int (41)
window.STATS = (function () {
  const S = (label, fmt, better, extra = {}) => ({ label, fmt, better, ...extra });
  const H = {
    G: S('Games', 'int', 'high'), PA: S('Plate appearances', 'int', 'high'), AB: S('At bats', 'int', 'high'), H: S('Hits', 'int', 'high'),
    AVG: S('Batting average', 'avg', 'high', { q: 1, trend: 'avg', g: 'AVG' }), OBP: S('On-base %', 'avg', 'high', { q: 1, trend: 'obp', g: 'OBP' }),
    SLG: S('Slugging %', 'avg', 'high', { q: 1, trend: 'slg', g: 'SLG' }), OPS: S('OPS', 'avg', 'high', { q: 1, trend: 'ops', g: 'OPS' }),
    HR: S('Home runs', 'int', 'high', { g: 'HR' }), RBI: S('Runs batted in', 'int', 'high', { g: 'RBI' }), R: S('Runs', 'int', 'high', { g: 'R' }),
    SB: S('Stolen bases', 'int', 'high', { g: 'SB' }), BB: S('Walks', 'int', 'high', { g: 'BB' }), K: S('Strikeouts', 'int', 'low', { g: 'K' }),
    '2B': S('Doubles', 'int', 'high', { g: '2B' }), '3B': S('Triples', 'int', 'high', { g: '3B' }),
    ISO: S('Isolated power', 'avg', 'high', { q: 1, g: 'ISO' }), BABIP: S('BABIP', 'avg', null, { q: 1, g: 'BABIP' }),
    wOBA: S('wOBA', 'avg', 'high', { q: 1, trend: 'woba', g: 'wOBA' }), 'wRC+': S('wRC+', 'int', 'high', { q: 1, g: 'wRC+' }),
    'OPS+': S('OPS+', 'int', 'high', { q: 1, g: 'OPS+' }), WAR: S('WAR', 'n1', 'high', { g: 'WAR' }),
    xBA: S('Expected AVG', 'avg', 'high', { q: 1, g: 'xBA' }), xSLG: S('Expected SLG', 'avg', 'high', { q: 1, g: 'xSLG' }),
    xwOBA: S('Expected wOBA', 'avg', 'high', { q: 1, trend: 'xwoba', g: 'xwOBA' }),
    EV: S('Avg exit velocity', 'n1', 'high', { q: 1, trend: 'avg_ev', unit: 'mph', g: 'avg EV' }), maxEV: S('Max exit velocity', 'n1', 'high', { unit: 'mph', g: 'max EV' }),
    'Barrel%': S('Barrel rate', 'pct', 'high', { q: 1, g: 'Barrel%' }), 'HardHit%': S('Hard-hit rate', 'pct', 'high', { q: 1, trend: 'hard_hit_pct', g: 'Hard Hit%' }),
    'SweetSpot%': S('Sweet-spot rate', 'pct', 'high', { q: 1, g: 'Sweet Spot%' }), LA: S('Avg launch angle', 'n1', null, { q: 1, unit: '°', g: 'LA' }),
    'K%': S('Strikeout rate', 'pct', 'low', { q: 1, trend: 'k_pct', g: 'K%' }), 'BB%': S('Walk rate', 'pct', 'high', { q: 1, trend: 'bb_pct', g: 'BB%' }),
    'Whiff%': S('Whiff rate', 'pct', 'low', { q: 1, g: 'Whiff%' }), 'Chase%': S('Chase rate', 'pct', 'low', { q: 1, g: 'Chase%' }),
    'Swing%': S('Swing rate', 'pct', null, { q: 1, g: 'Swing%' }), 'Contact%': S('Contact rate', 'pct', 'high', { q: 1, g: 'Contact%' }),
    '1st Swing%': S('First-pitch swing rate', 'pct', null, { q: 1, g: '1st Swing%' }), 'P/PA': S('Pitches per PA', 'n2', 'high', { q: 1, g: 'P/PA' }),
    'Pull%': S('Pull rate', 'pct', null, { q: 1, g: 'Pull%' }), 'GB%': S('Ground-ball rate', 'pct', null, { q: 1, g: 'GB%' }), 'FB%': S('Fly-ball rate', 'pct', null, { q: 1, g: 'FB%' }),
    BatSpeed: S('Bat speed', 'n1', 'high', { unit: 'mph', g: 'Bat Speed' }), SprintSpeed: S('Sprint speed', 'n1', 'high', { unit: 'ft/s', g: 'Sprint Speed' }),
    OAA: S('Outs above average', 'int', 'high', { g: 'OAA' }),
  };
  const P = {
    G: S('Games', 'int', 'high'), GS: S('Games started', 'int', 'high', { g: 'GS' }), IP: S('Innings pitched', 'ip', 'high', { g: 'IP' }),
    W: S('Wins', 'int', 'high', { g: 'W' }), L: S('Losses', 'int', 'low', { g: 'L' }), SV: S('Saves', 'int', 'high', { g: 'SV' }), HLD: S('Holds', 'int', 'high', { g: 'HLD' }),
    ERA: S('ERA', 'n2', 'low', { q: 1, trend: 'era', g: 'ERA' }), FIP: S('FIP', 'n2', 'low', { q: 1, trend: 'fip', g: 'FIP' }), xFIP: S('xFIP', 'n2', 'low', { q: 1, g: 'xFIP' }),
    WHIP: S('WHIP', 'n2', 'low', { q: 1, trend: 'whip', g: 'WHIP' }), K: S('Strikeouts', 'int', 'high', { g: 'K' }), BB: S('Walks allowed', 'int', 'low', { g: 'BB' }), HR: S('Home runs allowed', 'int', 'low', { g: 'HR' }),
    'K/9': S('Strikeouts per 9', 'n2', 'high', { q: 1, g: 'K/9' }), 'BB/9': S('Walks per 9', 'n2', 'low', { q: 1, g: 'BB/9' }),
    'K%': S('Strikeout rate', 'pct', 'high', { q: 1, trend: 'k_pct', g: 'K%' }), 'BB%': S('Walk rate', 'pct', 'low', { q: 1, trend: 'bb_pct', g: 'BB%' }),
    'K-BB%': S('K% minus BB%', 'pct', 'high', { q: 1, g: 'K-BB%' }), 'Whiff%': S('Whiff rate', 'pct', 'high', { q: 1, trend: 'whiff_pct', g: 'Whiff%' }),
    'CSW%': S('Called strikes + whiffs', 'pct', 'high', { q: 1, trend: 'csw_pct', g: 'CSW%' }), 'Chase%': S('Chase rate', 'pct', 'high', { q: 1, g: 'Chase%' }),
    xwOBA: S('Expected wOBA allowed', 'avg', 'low', { q: 1, trend: 'xwoba', g: 'xwOBA' }), xBA: S('Expected AVG allowed', 'avg', 'low', { q: 1, g: 'xBA' }),
    EV: S('Avg exit velo allowed', 'n1', 'low', { q: 1, unit: 'mph', g: 'avg EV' }), 'Barrel%': S('Barrel rate allowed', 'pct', 'low', { q: 1, g: 'Barrel%' }),
    'HardHit%': S('Hard-hit rate allowed', 'pct', 'low', { q: 1, g: 'Hard Hit%' }), 'GB%': S('Ground-ball rate', 'pct', 'high', { q: 1, g: 'GB%' }),
    Velo: S('Fastball velocity', 'n1', 'high', { q: 1, unit: 'mph', g: 'Velo' }), Spin: S('Fastball spin rate', 'int', 'high', { q: 1, unit: 'rpm', g: 'Spin' }),
    Ext: S('Extension', 'n1', 'high', { q: 1, unit: 'ft', g: 'Ext' }), IVB: S('Fastball rise (IVB)', 'n1', 'high', { q: 1, unit: 'in', g: 'IVB' }), WAR: S('WAR', 'n1', 'high', { g: 'WAR' }), 'OPP AVG': S('Opponent AVG', 'avg', 'low', { q: 1, g: 'OPP AVG' }),
    'Strike%': S('Strike rate', 'pct', 'high', { q: 1, g: 'Strike%' }), 'F-Strike%': S('First-pitch strike rate', 'pct', 'high', { q: 1, g: 'F-Strike%' }),
    'Putaway%': S('Put-away rate', 'pct', 'high', { q: 1, g: 'Putaway%' }), 'P/IP': S('Pitches per inning', 'n1', 'low', { q: 1, g: 'P/IP' }),
  };
  // search aliases -> stat key
  const ALIAS = { 'batting average': 'AVG', average: 'AVG', 'home run': 'HR', homers: 'HR', homeruns: 'HR', 'home runs': 'HR', rbis: 'RBI', steals: 'SB', 'stolen bases': 'SB',
    walks: 'BB', strikeouts: 'K', ks: 'K', 'exit velo': 'EV', 'exit velocity': 'EV', velo: 'Velo', velocity: 'Velo', spin: 'Spin', 'spin rate': 'Spin', rpm: 'Spin', extension: 'Ext', ride: 'IVB', rise: 'IVB', 'vertical break': 'IVB', 'induced vertical break': 'IVB', ivb: 'IVB', 'fastball velocity': 'Velo', 'mph': 'Velo', barrel: 'Barrel%', barrels: 'Barrel%', 'hard hit': 'HardHit%',
    whiff: 'Whiff%', whiffs: 'Whiff%', chase: 'Chase%', 'sweet spot': 'SweetSpot%', 'launch angle': 'LA', 'bat speed': 'BatSpeed', 'sprint speed': 'SprintSpeed', speed: 'SprintSpeed',
    'k rate': 'K%', 'walk rate': 'BB%', 'strikeout rate': 'K%', saves: 'SV', wins: 'W', innings: 'IP', 'on base': 'OBP', slugging: 'SLG', defense: 'OAA', 'outs above average': 'OAA',
    'first pitch strike': 'F-Strike%', 'strike rate': 'Strike%', putaway: 'Putaway%', 'put away': 'Putaway%', csw: 'CSW%', 'ground ball': 'GB%', groundball: 'GB%', 'fly ball': 'FB%', pull: 'Pull%', war: 'WAR' };
  const MIN = { atl: { h: 250, p: 50 }, usm: { h: 100, p: 25 } };
  return { H, P, ALIAS, MIN };
})();

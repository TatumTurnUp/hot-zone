# Hot Zone

Season stats app for the **Atlanta Braves** and **Southern Miss Golden Eagles** — every player gets a profile card, strike-zone hot/cold maps, spray charts, pitch movement, rolling trends, splits and game logs. Built for phones (add to Home Screen) and laptops.

## How it works
- `app/` — the static app (vanilla JS + hand-built SVG charts, no build step). `app/data/` holds the last committed data snapshot.
- `pipeline/` — pulls and processes the data:
  - `fetch_mlb.py` — MLB Stats API (roster, season/advanced/sabermetric stats, splits, game logs) + every Baseball Savant Statcast pitch for the Braves + Savant leaderboards (percentiles, sprint speed, OAA, arm strength, bat tracking, framing, pop time).
  - `fetch_usm.py` + `extract_usm.py` — Southern Miss roster and every box score / play-by-play from southernmiss.com.
  - `process_atl.py`, `process_usm.py` — compute per-player JSON (zones, heat grids, spray, arsenal, counts, rolling windows…).
  - `build_index.py` — team summaries + roster index.
  - `build_vault.py` — writes the Campbell Baseball Obsidian vault (profiles + Technical Stats blocks) from the same data.
- **Every Vercel deploy refreshes the data** (`pipeline/build.sh`). If a source is down, the deploy still ships with the committed snapshot. Set `CB_SKIP_REFRESH=1` to skip the refresh.
- Season is set by `CB_SEASON` (default `2026`).

## Updating during the season
Trigger a redeploy after games (Vercel deploy hook or a scheduled task) — the build pulls the newest stats automatically.

#!/usr/bin/env bash
# Vercel build: refresh all stats from the sources, then publish app + data to ./public.
# If any source fails, the build still ships using the last committed data in app/data.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export CB_WORK="$ROOT/.work"; export CB_DATA_OUT="$CB_WORK/app/data"
rm -rf "$ROOT/public" "$CB_WORK"; mkdir -p "$CB_WORK/out/players" "$CB_DATA_OUT/players"
cp -r "$ROOT/app" "$ROOT/public"
if [ "${CB_SKIP_REFRESH:-0}" = "1" ]; then echo "Refresh skipped; using committed data."; exit 0; fi
python3 -c "import pandas" 2>/dev/null || python3 -m pip install --quiet pandas numpy || pip install --quiet pandas numpy
if python3 "$ROOT/pipeline/fetch_mlb.py" && python3 "$ROOT/pipeline/fetch_usm.py" \
   && python3 "$ROOT/pipeline/process_atl.py" && python3 "$ROOT/pipeline/process_usm.py" && python3 "$ROOT/pipeline/build_index.py"; then
  rm -rf "$ROOT/public/data" && cp -r "$CB_DATA_OUT" "$ROOT/public/data"
  echo "Fresh data published."
else
  echo "WARNING: data refresh failed — shipping last committed data."
fi
exit 0

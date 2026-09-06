#!/bin/bash
# Weekly Chess.com refresh + macOS banner.
# Usage: ./update_games.sh [--notify-only]
set -euo pipefail

ROOT="/Users/jigar/projects/Done/tiny-vibe-utils/download_chesscom_games"
PYTHON="$HOME/pyenv/download_chesscom_games/bin/python"
BASE="$ROOT/chess_games"
USERS=(george_burdell darshak05 liminalvellichor)
MONTH="$(date +%Y-%m)"

mkdir -p "$ROOT/.download_logs"
exec >>"$ROOT/.download_logs/weekly.log" 2>&1
echo "===== $(date '+%Y-%m-%d %H:%M:%S') ====="

# 1. Download latest games (unless testing notifications only)
if [[ "${1:-}" != "--notify-only" ]]; then
  for u in "${USERS[@]}"; do
    rm -f "$BASE/$u/${MONTH}.pgn"
  done
  "$PYTHON" "$ROOT/download_chesscom_games.py" "${USERS[@]}" "$BASE"
fi

# 2. Count games played in the last 7 days and compute date range
DATE_RANGE="$("$PYTHON" -c '
from datetime import date, timedelta
today = date.today()
cutoff = today - timedelta(days=6)
print(cutoff.strftime("%b %-d") + " – " + today.strftime("%b %-d"))
')"

SUMMARY="$("$PYTHON" - "$BASE" "${USERS[@]}" <<'PY'
from datetime import date, timedelta
from pathlib import Path
import re, sys
root, users, cutoff = Path(sys.argv[1]), sys.argv[2:], date.today() - timedelta(days=6)
pat = re.compile(r'\[UTCDate "(\d{4})\.(\d{2})\.(\d{2})"\]')
for user in users:
    n = 0
    user_dir = root / user
    if user_dir.is_dir():
        for pgn in user_dir.glob("*.pgn"):
            for y, m, d in pat.findall(pgn.read_text(errors="replace")):
                if date(int(y), int(m), int(d)) >= cutoff:
                    n += 1
    print(f"{user}: {n}")
PY
)"

echo "Date range: $DATE_RANGE"
echo "Summary:"
echo "$SUMMARY"

# 3. Display banner notification with each user on a new line and date range subtitle.
osascript - "$SUMMARY" "$DATE_RANGE" <<'APPLESCRIPT'
on run argv
	display notification (item 1 of argv) with title "Chess.com weekly" subtitle (item 2 of argv)
end run
APPLESCRIPT

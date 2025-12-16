#!/usr/bin/env bash
set -Eeuo pipefail

# Always run from the repo root (the directory of this script)
cd "$(dirname "$0")"

LOG_LEVEL="info"
BOT_MODE="all"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --debug)
  LOG_LEVEL="debug"
  echo "===> Using debug log level"
      shift
      ;;
    --staging)
      BOT_MODE="staging"
      echo "===> Enabling staging-only mode"
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

echo "===> Updating repo"
git fetch origin
# Ensure main is checked out and exactly matches remote
git checkout -f main
git reset --hard origin/main
# Optional: nuke untracked if you want truly clean
# git clean -fdx

echo "===> Installing deps and building"
if command -v pnpm >/dev/null 2>&1; then
  pnpm install --frozen-lockfile
  pnpm run build
else
  npm ci
  npm run build
fi

echo "===> Restarting app (tmux)"
SESSION="ethan-discord-bot"
RUNTIME_EXPORT="LOG_LEVEL=\"$LOG_LEVEL\""

if [[ "$BOT_MODE" != "all" ]]; then
  RUNTIME_EXPORT+=" BOT_MODE=\"$BOT_MODE\""
fi

if [[ "$BOT_MODE" == "staging" ]]; then
  SESSION="ethan-discord-bot-staging"
fi

if tmux has-session -t "$SESSION" 2>/dev/null; then
  tmux kill-session -t "$SESSION"
fi
tmux new-session -d -s "$SESSION" "bash -lc 'while true; do $RUNTIME_EXPORT node dist/index.js; echo Restarting in 2s...; sleep 2; done'"

echo "===> Deployed commit $(git rev-parse --short HEAD)"
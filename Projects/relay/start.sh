#!/bin/bash
# Start Relay: the daemon (API + WS event spine, port 5182) and the
# dashboard dev server (mission control UI, port 5183). Two processes,
# one command — the dashboard's vite.config.ts proxies /api and /stream
# to the daemon on 5182, so both must be up for the UI to work.
ROOT="$(cd "$(dirname "$0")" && pwd)"

lsof -ti:5182 | xargs kill -9 2>/dev/null
lsof -ti:5183 | xargs kill -9 2>/dev/null

if [ ! -f "$ROOT/packages/daemon/dist/index.js" ]; then
  echo "Building Relay (first run)..."
  (cd "$ROOT" && npm install && npm run build)
fi

echo "Starting Relay daemon on http://localhost:5182 ..."
(cd "$ROOT" && node packages/daemon/dist/index.js) &
DAEMON_PID=$!

echo "Starting Relay dashboard on http://localhost:5183 ..."
(cd "$ROOT" && npm run dev --workspace=@relay/dashboard -- --port 5183) &
DASHBOARD_PID=$!

echo ""
echo "✓ Relay running — open http://localhost:5183"
echo "  Press Ctrl+C to stop."

trap "kill $DAEMON_PID $DASHBOARD_PID 2>/dev/null; exit" INT TERM
wait

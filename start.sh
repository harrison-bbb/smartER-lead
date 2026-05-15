#!/bin/bash

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Starting Outreach Platform..."

# Kill anything already running on these ports
lsof -ti:3001,3000 | xargs kill -9 2>/dev/null
pkill -f "tsx watch\|next dev" 2>/dev/null
sleep 1

# Make sure Docker containers are up
docker compose up -d db redis 2>/dev/null
sleep 2

# Start API
cd "$PROJECT_DIR/apps/api"
pnpm dev > /tmp/outreach-api.log 2>&1 &
echo "Starting API..."
sleep 5

# Start Worker
pnpm dev:worker > /tmp/outreach-worker.log 2>&1 &
echo "Starting Worker..."
sleep 2

# Start Frontend
cd "$PROJECT_DIR/apps/web"
WATCHPACK_POLLING=true pnpm dev > /tmp/outreach-web.log 2>&1 &
echo "Starting Frontend..."
sleep 8

# Check everything
API=$(curl -s http://localhost:3001/health 2>/dev/null)
WEB=$(curl -s http://localhost:3000/ 2>/dev/null | grep -o "<title>[^<]*</title>")

if [[ "$API" == *"ok"* ]]; then
  echo "✅ API running at http://localhost:3001"
else
  echo "❌ API failed to start — check /tmp/outreach-api.log"
fi

if [[ "$WEB" == *"Outreach"* ]]; then
  echo "✅ Frontend running at http://localhost:3000"
else
  echo "❌ Frontend failed to start — check /tmp/outreach-web.log"
fi

echo "✅ Worker running (background)"
echo ""
echo "All done! Open http://localhost:3000"

#!/bin/bash

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Starting SmartER Lead..."

# Kill anything already running on these ports
lsof -ti:3001,3000 | xargs kill -9 2>/dev/null
pkill -f "tsx watch\|next dev" 2>/dev/null
sleep 1

# Make sure Docker containers are up
echo "Starting database and Redis..."
docker compose up -d db redis 2>/dev/null

# Wait for Postgres to be ready (up to 30s)
echo "Waiting for database to be ready..."
for i in $(seq 1 30); do
  if docker compose exec -T db pg_isready -U outreach -q 2>/dev/null; then
    echo "Database ready."
    break
  fi
  sleep 1
done

# Run database migrations (safe to run every time — skips existing tables)
echo "Running database migrations..."
cd "$PROJECT_DIR/apps/api"
pnpm db:push --accept-data-loss 2>/dev/null || pnpm db:push
echo "Migrations done."

# Start API
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

if [[ "$WEB" == *"SmartER"* ]] || [[ "$WEB" == *"Outreach"* ]] || [[ -n "$WEB" ]]; then
  echo "✅ Frontend running at http://localhost:3000"
else
  echo "❌ Frontend failed to start — check /tmp/outreach-web.log"
fi

echo "✅ Worker running (background)"
echo ""
echo "All done! Open http://localhost:3000"

#!/bin/bash
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"
export HOME="/home/admins"
export PM2_HOME="/home/admins/.pm2"

# Start PostgreSQL service if not already running
service postgresql status >/dev/null 2>&1 || sudo service postgresql start

# Wait for PostgreSQL to be ready
for i in {1..10}; do
  pg_isready -q && break
  sleep 1
done

mkdir -p /opt/ledgr/logs
mkdir -p /opt/ledgr/backend/uploads

cd /opt/ledgr/backend

# If process is registered in PM2, restart it, otherwise start it
if pm2 describe ledgr >/dev/null 2>&1; then
  pm2 restart ledgr
else
  pm2 start src/index.js \
    --name "ledgr" \
    --node-args="--env-file=.env" \
    --max-memory-restart 512M \
    --log /opt/ledgr/logs/app.log \
    --time
  pm2 save
fi

#!/bin/bash
set -e

echo "=== 1. Syncing project files to /opt/ledgr ==="
mkdir -p /opt/ledgr/logs
SRC_DIR="/mnt/c/BT Ledgr — Invoice Intelligence"
if [ ! -d "$SRC_DIR" ]; then
  SRC_DIR="/mnt/c/BT Ledgr Invoice Intelligence"
fi
if [ ! -d "$SRC_DIR" ]; then
  SRC_DIR="/mnt/c/Bills---statements-master"
fi

rsync -av --delete \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude 'dist' \
  --exclude 'logs' \
  --exclude 'uploads' \
  "$SRC_DIR/" /opt/ledgr/

mkdir -p /opt/ledgr/logs
mkdir -p /opt/ledgr/backend/uploads/invoices
mkdir -p /opt/ledgr/backend/uploads/statements
touch /opt/ledgr/logs/app.log
chown -R admins:admins /opt/ledgr

echo "=== 2. Installing Backend Dependencies ==="
cd /opt/ledgr/backend
sudo -u admins npm install --omit=dev

echo "=== 3. Prisma Client Generation & Migrations ==="
sudo -u admins npx prisma generate
sudo -u admins npx prisma migrate deploy

echo "=== 4. Installing Frontend Dependencies & Building ==="
cd /opt/ledgr/frontend
sudo -u admins npm install
sudo -u admins npm run build

echo "=== 5. Setting up /opt/ledgr/start.sh ==="
cat << 'EOF' > /opt/ledgr/start.sh
#!/bin/bash
# Start PostgreSQL service if not already running
service postgresql status >/dev/null 2>&1 || sudo service postgresql start

# Wait for PostgreSQL
for i in {1..10}; do
  pg_isready -q && break
  sleep 1
done

# Start or reload PM2 process as admins
export HOME=/home/admins
export PM2_HOME=/home/admins/.pm2

if pm2 describe ledgr >/dev/null 2>&1; then
  pm2 restart ledgr
else
  cd /opt/ledgr/backend
  pm2 start src/index.js \
    --name "ledgr" \
    --node-args="--env-file=.env" \
    --max-memory-restart 512M \
    --log /opt/ledgr/logs/app.log \
    --time
  pm2 save
fi
EOF

chmod +x /opt/ledgr/start.sh
chown admins:admins /opt/ledgr/start.sh

echo "=== 6. Starting application via PM2 ==="
sudo -u admins bash /opt/ledgr/start.sh

echo "=== Deployment script complete ==="

#!/bin/bash
set -e

# Start postgresql service
service postgresql start

# Create user if not exists or update password
sudo -u postgres psql -c "CREATE USER ledgr_user WITH PASSWORD 'ledgr_secure_2026';" || \
sudo -u postgres psql -c "ALTER USER ledgr_user WITH PASSWORD 'ledgr_secure_2026';"

# Create database if not exists
sudo -u postgres psql -c "CREATE DATABASE ledgr_db OWNER ledgr_user;" || \
sudo -u postgres psql -c "ALTER DATABASE ledgr_db OWNER TO ledgr_user;"

sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ledgr_db TO ledgr_user;"
sudo -u postgres psql -d ledgr_db -c "GRANT ALL ON SCHEMA public TO ledgr_user;"

echo "PostgreSQL setup completed successfully."

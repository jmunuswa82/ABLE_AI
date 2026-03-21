#!/usr/bin/env bash
# Start the API server only if port 8080 is not already bound.
# If another process (e.g. the "API Server" workflow) already owns the port,
# just wait silently so the artifact system sees port 8080 as ready.
if python3 -c "
import socket, sys
s = socket.socket()
s.settimeout(0.5)
try:
    s.connect(('127.0.0.1', 8080))
    s.close()
    sys.exit(0)   # port is open
except:
    sys.exit(1)   # port is not open
" 2>/dev/null; then
  echo "[api-dev] Port 8080 already in use — deferring to existing server"
  exec tail -f /dev/null
else
  echo "[api-dev] Starting API server on port 8080"
  exec env PORT=8080 pnpm --filter @workspace/api-server run dev
fi

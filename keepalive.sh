#!/bin/bash
LOGFILE="$HOME/fleet-keepalive.log"
export XDG_RUNTIME_DIR="/run/user/$(id -u)"

# Check fleet tracker app via systemd
APP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 http://localhost:8080 2>/dev/null)
if [ "$APP_STATUS" != "200" ]; then
  echo "$(date) - App down (status: $APP_STATUS), restarting systemd service..." >> "$LOGFILE"
  systemctl --user restart fleet-tracker.service 2>> "$LOGFILE"
  sleep 3
fi

# Check tunnel via systemd
TUNNEL_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 https://fleet.renecon.com 2>/dev/null)
if [ "$TUNNEL_STATUS" != "200" ]; then
  echo "$(date) - Tunnel down (status: $TUNNEL_STATUS), restarting systemd service..." >> "$LOGFILE"
  systemctl --user restart fleet-tunnel.service 2>> "$LOGFILE"
  sleep 5
fi

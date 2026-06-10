#!/bin/bash
# Fleet Tracker keepalive script
# Checks and restarts the app and tunnel if they're down

# App check
if ! curl -s -o /dev/null -w "" http://localhost:8080 2>/dev/null; then
  PORT=8080 node /var/lib/freelancer/projects/40336233/fleet-tracker/server/index.js &
fi

# Tunnel check
if ! pgrep -f "cloudflared.*tunnel.*run" > /dev/null 2>&1; then
  TUNNEL_TOKEN="eyJhIjoiY2VlODQ5ZDNhY2M5ZjhlNGRkOGJhOWY3NzNmNWQxYzIiLCJ0IjoiYzM0YTM2MTMtNWY0ZS00Mzk1LTk2ZGMtYjdkMWRiYjVkYzhkIiwicyI6IkpwcHdYdUJIUE9XZlpmZzdoWFQ1SnY5VVlOVmd4K0Z6dlBQc21Kd3VuS3c9In0="
  /tmp/cloudflared tunnel run --token "$TUNNEL_TOKEN" > /dev/null 2>&1 &
fi

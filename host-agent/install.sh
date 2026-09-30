#!/bin/sh
# Install the OmniGrok host agent as a background service.
#
# The agent binds to 127.0.0.1 only. Nothing is reachable from outside this
# machine until you separately point a cloudflared tunnel at it, which this
# script prints instructions for but deliberately does not do: opening a
# machine to the internet should be a decision you make explicitly.
#
# Usage:  sh install.sh [--roots /path:/other] [--read-only]
set -e

AGENT_DIR="${OMNIGROK_HOST_DIR:-$HOME/.omnigrok}"
PORT="${OMNIGROK_HOST_PORT:-8787}"
ROOTS="$HOME"
READ_ONLY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --roots) ROOTS="$2"; shift 2 ;;
    --read-only) READ_ONLY=1; shift ;;
    --port) PORT="$2"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

command -v node >/dev/null 2>&1 || { echo "node is required" >&2; exit 1; }

mkdir -p "$AGENT_DIR"
cp "$(dirname "$0")/omnigrok-host.mjs" "$AGENT_DIR/omnigrok-host.mjs"

TOKEN_FILE="$AGENT_DIR/token"
if [ ! -f "$TOKEN_FILE" ]; then
  node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))" > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
fi
TOKEN="$(cat "$TOKEN_FILE")"
NAME="$(hostname | cut -d. -f1)"

case "$(uname -s)" in
  Darwin)
    PLIST="$HOME/Library/LaunchAgents/work.damineweb.omnigrok-host.plist"
    mkdir -p "$HOME/Library/LaunchAgents"
    cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>work.damineweb.omnigrok-host</string>
  <key>ProgramArguments</key><array>
    <string>$(command -v node)</string>
    <string>$AGENT_DIR/omnigrok-host.mjs</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>OMNIGROK_HOST_TOKEN</key><string>$TOKEN</string>
    <key>OMNIGROK_HOST_PORT</key><string>$PORT</string>
    <key>OMNIGROK_HOST_NAME</key><string>$NAME</string>
    <key>OMNIGROK_HOST_ROOTS</key><string>$ROOTS</string>
    <key>OMNIGROK_HOST_RO</key><string>$READ_ONLY</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$AGENT_DIR/out.log</string>
  <key>StandardErrorPath</key><string>$AGENT_DIR/err.log</string>
</dict></plist>
PLISTEOF
    launchctl unload "$PLIST" 2>/dev/null || true
    launchctl load "$PLIST"
    SERVICE="launchctl unload $PLIST   # to stop"
    ;;
  Linux)
    UNIT_DIR="$HOME/.config/systemd/user"
    mkdir -p "$UNIT_DIR"
    cat > "$UNIT_DIR/omnigrok-host.service" <<UNITEOF
[Unit]
Description=OmniGrok host agent
After=network.target

[Service]
ExecStart=$(command -v node) $AGENT_DIR/omnigrok-host.mjs
Environment=OMNIGROK_HOST_TOKEN=$TOKEN
Environment=OMNIGROK_HOST_PORT=$PORT
Environment=OMNIGROK_HOST_NAME=$NAME
Environment=OMNIGROK_HOST_ROOTS=$ROOTS
Environment=OMNIGROK_HOST_RO=$READ_ONLY
Restart=always

[Install]
WantedBy=default.target
UNITEOF
    systemctl --user daemon-reload
    systemctl --user enable --now omnigrok-host.service
    SERVICE="systemctl --user stop omnigrok-host   # to stop"
    ;;
  *)
    echo "Unsupported platform. Run manually:"
    echo "  OMNIGROK_HOST_TOKEN=$TOKEN node $AGENT_DIR/omnigrok-host.mjs"
    exit 0
    ;;
esac

sleep 1
echo
echo "Host agent installed and running on 127.0.0.1:$PORT"
echo "  name:  $NAME"
echo "  roots: $ROOTS"
echo "  token: $TOKEN_FILE  (paste its contents into the OmniGrok Devices panel)"
echo "  $SERVICE"
echo
echo "It is NOT reachable from outside this machine yet. To expose it:"
echo "  1. cloudflared tunnel route dns <tunnel> $NAME.damineweb.work"
echo "  2. add to your tunnel config:"
echo "       - hostname: $NAME.damineweb.work"
echo "         service: http://127.0.0.1:$PORT"
echo "  3. put a Cloudflare Access application in front of that hostname"
echo "  4. create an Access service token and add it, with the host token above,"
echo "     to the OmniGrok Devices panel"

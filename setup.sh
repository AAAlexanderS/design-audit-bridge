#!/usr/bin/env bash
# Claude Control Bridge — One-click setup
# Usage: ./setup.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RESET='\033[0m'
ok()   { echo -e "${GREEN}✅ $1${RESET}"; }
step() { echo -e "${CYAN}▶  $1${RESET}"; }
warn() { echo -e "${YELLOW}⚠️  $1${RESET}"; }

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  Claude Control Bridge  Setup"
echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""

# 1. Install dependencies
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
  step "Installing dependencies..."
  npm install --silent
  ok "Dependencies installed"
else
  ok "Dependencies already installed"
fi

# 2. Build plugin
step "Building plugin..."
npm run build --silent
ok "Plugin built (dist/)"

# 3. Register MCP server with Claude Code
step "Registering MCP server..."
if claude mcp add figma-control-bridge -- node "$SCRIPT_DIR/mcp-server.js" 2>/dev/null; then
  ok "MCP server registered: figma-control-bridge"
else
  ok "MCP server already registered"
fi

# 4. Start bridge server (idempotent)
if pgrep -f "node.*bridge-server.js" > /dev/null 2>&1; then
  ok "Bridge server already running on port 7879"
else
  step "Starting bridge server..."
  nohup node "$SCRIPT_DIR/bridge-server.js" > /tmp/bridge-server.log 2>&1 &
  sleep 1
  if pgrep -f "node.*bridge-server.js" > /dev/null 2>&1; then
    ok "Bridge server started on http://localhost:7879"
  else
    warn "Bridge server failed to start — check /tmp/bridge-server.log"
    exit 1
  fi
fi

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  Setup complete! One step remaining:"
echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
echo "  Open Figma Desktop:"
echo "  Plugins → Development → Claude Control Bridge"
echo ""
echo "  Then ask Claude:"
echo "  \"What is selected in Figma?\""
echo ""

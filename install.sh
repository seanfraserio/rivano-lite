#!/bin/sh
# Rivano Lite Installer
# Usage: curl -fsSL https://get.rivano.ai | sh
set -e

REPO="rivano-ai/rivano-lite"
IMAGE="ghcr.io/${REPO}"
INSTALL_DIR="/usr/local/bin"
DATA_DIR="$HOME/.rivano"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { printf "${CYAN}[rivano]${NC} %s\n" "$1"; }
ok()    { printf "${GREEN}[rivano]${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}[rivano]${NC} %s\n" "$1"; }
fail()  { printf "${RED}[rivano]${NC} %s\n" "$1"; exit 1; }

cat << 'EOF'

  ┌─────────────────────────────────────┐
  │       Rivano Lite Installer         │
  │   Open Source AI Operations Platform │
  └─────────────────────────────────────┘

EOF

# ── Platform detection ──────────────────────────────────────
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$OS" in
  darwin) OS_NAME="macOS" ;;
  linux)  OS_NAME="Linux" ;;
  *)      fail "Unsupported OS: $OS (only macOS and Linux are supported)" ;;
esac

case "$ARCH" in
  x86_64)       ARCH="amd64"; ARCH_NAME="Intel/AMD 64-bit" ;;
  aarch64|arm64) ARCH="arm64"; ARCH_NAME="ARM 64-bit" ;;
  *)            fail "Unsupported architecture: $ARCH" ;;
esac

info "Detected: $OS_NAME ($ARCH_NAME)"

# ── Check Docker ────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  fail "Docker is required but not installed.

  Install Docker:
    macOS:  https://docs.docker.com/desktop/install/mac-install/
    Linux:  https://docs.docker.com/engine/install/

  Then re-run:
    curl -fsSL https://get.rivano.ai | sh"
fi

if ! docker info >/dev/null 2>&1; then
  fail "Docker is installed but not running. Please start Docker and try again."
fi

ok "Docker is available"

# ── Check for existing installation ─────────────────────────
if command -v rivano >/dev/null 2>&1; then
  warn "Rivano Lite is already installed — updating..."
  UPDATING=true
else
  UPDATING=false
fi

# ── Create data directory ───────────────────────────────────
mkdir -p "$DATA_DIR"
ok "Data directory: $DATA_DIR"

# ── Pull container image ────────────────────────────────────
info "Pulling Rivano Lite container image..."
docker pull "${IMAGE}:latest" || fail "Failed to pull image. Check your internet connection."
ok "Container image pulled"

# ── Install CLI wrapper ─────────────────────────────────────
info "Installing rivano CLI to ${INSTALL_DIR}/rivano..."

NEED_SUDO=false
if [ ! -w "$INSTALL_DIR" ]; then
  NEED_SUDO=true
  warn "Need sudo to write to $INSTALL_DIR"
fi

# Download the CLI wrapper
TEMP_CLI=$(mktemp)
cat > "$TEMP_CLI" << 'CLIEOF'
#!/bin/sh
# Rivano Lite CLI — thin wrapper around Docker
set -e

IMAGE="ghcr.io/rivano-ai/rivano-lite"
CONTAINER="rivano-lite"
DATA_DIR="$HOME/.rivano"
VERSION="0.1.0"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
NC='\033[0m'

is_running() {
  docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true
}

case "${1:-help}" in
  start)
    if is_running; then
      printf "${YELLOW}Rivano Lite is already running${NC}\n"
      printf "  WebUI:    http://localhost:9000\n"
      printf "  Proxy:    http://localhost:4000\n"
      printf "  Observer: http://localhost:4100\n"
      exit 0
    fi

    # Remove stopped container if exists
    docker rm "$CONTAINER" 2>/dev/null || true

    printf "${CYAN}Starting Rivano Lite...${NC}\n"

    DOCKER_ARGS="-d --name $CONTAINER"
    DOCKER_ARGS="$DOCKER_ARGS -p 9000:9000 -p 4000:4000 -p 4100:4100"
    DOCKER_ARGS="$DOCKER_ARGS -v $DATA_DIR:/data"
    DOCKER_ARGS="$DOCKER_ARGS --restart unless-stopped"

    # Pass through env file if exists
    if [ -f "$DATA_DIR/.env" ]; then
      DOCKER_ARGS="$DOCKER_ARGS --env-file $DATA_DIR/.env"
    fi

    # macOS: allow access to host services (Ollama, etc.)
    if [ "$(uname -s)" = "Darwin" ]; then
      DOCKER_ARGS="$DOCKER_ARGS --add-host=host.docker.internal:host-gateway"
    fi

    eval docker run $DOCKER_ARGS "${IMAGE}:latest"

    # Wait for health check
    printf "${DIM}Waiting for services to start...${NC}\n"
    RETRIES=0
    while [ $RETRIES -lt 30 ]; do
      if curl -sf http://localhost:9000/health >/dev/null 2>&1; then
        printf "\n${GREEN}Rivano Lite is running!${NC}\n\n"
        printf "  WebUI:    http://localhost:9000\n"
        printf "  Proxy:    http://localhost:4000\n"
        printf "  Observer: http://localhost:4100\n"
        printf "\n  Config:   $DATA_DIR/rivano.yaml\n"
        printf "  Data:     $DATA_DIR/\n\n"
        printf "${DIM}Point your AI SDK at http://localhost:4000/v1${NC}\n"
        exit 0
      fi
      sleep 1
      RETRIES=$((RETRIES + 1))
      printf "."
    done
    printf "\n${YELLOW}Services are starting up (may take a moment)${NC}\n"
    printf "Check status with: rivano status\n"
    ;;

  stop)
    if ! is_running; then
      printf "${YELLOW}Rivano Lite is not running${NC}\n"
      exit 0
    fi
    printf "${CYAN}Stopping Rivano Lite...${NC}\n"
    docker stop "$CONTAINER" >/dev/null
    printf "${GREEN}Stopped${NC}\n"
    ;;

  restart)
    $0 stop
    $0 start
    ;;

  status)
    if is_running; then
      printf "${GREEN}Rivano Lite is running${NC}\n\n"
      # Get health info
      HEALTH=$(curl -sf http://localhost:9000/health 2>/dev/null || echo '{}')
      if [ "$HEALTH" != '{}' ]; then
        printf "  Services:\n"
        echo "$HEALTH" | grep -o '"proxy":"[^"]*"' | sed 's/"proxy":"/    Proxy:    /' | sed 's/"//'
        echo "$HEALTH" | grep -o '"observer":"[^"]*"' | sed 's/"observer":"/    Observer: /' | sed 's/"//'
        echo "$HEALTH" | grep -o '"agents":[0-9]*' | sed 's/"agents":/    Agents:   /'
      fi
      printf "\n  Ports:\n"
      printf "    WebUI:    http://localhost:9000\n"
      printf "    Proxy:    http://localhost:4000\n"
      printf "    Observer: http://localhost:4100\n"
      printf "\n  Data: $DATA_DIR/\n"

      # Container stats
      printf "\n  Container:\n"
      docker stats --no-stream --format "    CPU: {{.CPUPerc}}  Memory: {{.MemUsage}}" "$CONTAINER" 2>/dev/null
    else
      printf "${YELLOW}Rivano Lite is not running${NC}\n"
      printf "Start with: rivano start\n"
    fi
    ;;

  logs)
    if ! docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
      printf "${YELLOW}No Rivano Lite container found${NC}\n"
      exit 1
    fi
    shift
    if [ $# -eq 0 ]; then
      docker logs --follow --tail 100 "$CONTAINER"
    else
      docker logs "$@" "$CONTAINER"
    fi
    ;;

  config)
    if command -v open >/dev/null 2>&1; then
      open "http://localhost:9000"
    elif command -v xdg-open >/dev/null 2>&1; then
      xdg-open "http://localhost:9000"
    else
      printf "Open http://localhost:9000 in your browser\n"
    fi
    ;;

  update)
    printf "${CYAN}Pulling latest Rivano Lite image...${NC}\n"
    docker pull "${IMAGE}:latest"
    if is_running; then
      printf "${CYAN}Restarting with new image...${NC}\n"
      $0 stop
      docker rm "$CONTAINER" 2>/dev/null || true
      $0 start
    else
      printf "${GREEN}Image updated. Run 'rivano start' to use the new version.${NC}\n"
    fi
    ;;

  uninstall)
    printf "${YELLOW}Uninstalling Rivano Lite...${NC}\n"
    printf "\nThis will remove:\n"
    printf "  - Container and image\n"
    printf "  - CLI (/usr/local/bin/rivano)\n"
    printf "\nYour data in $DATA_DIR will NOT be removed.\n"
    printf "\nContinue? [y/N] "
    read -r CONFIRM
    case "$CONFIRM" in
      [yY]|[yY][eE][sS])
        docker stop "$CONTAINER" 2>/dev/null || true
        docker rm "$CONTAINER" 2>/dev/null || true
        docker rmi "${IMAGE}:latest" 2>/dev/null || true
        if [ -w /usr/local/bin/rivano ]; then
          rm -f /usr/local/bin/rivano
        else
          sudo rm -f /usr/local/bin/rivano
        fi
        printf "${GREEN}Uninstalled.${NC} Data remains at $DATA_DIR\n"
        ;;
      *)
        printf "Cancelled.\n"
        ;;
    esac
    ;;

  export)
    EXPORT_FILE="rivano-export-$(date +%Y%m%d-%H%M%S).tar.gz"
    printf "${CYAN}Exporting Rivano Lite data...${NC}\n"
    tar -czf "$EXPORT_FILE" -C "$DATA_DIR" .
    printf "${GREEN}Exported to $EXPORT_FILE${NC}\n"
    printf "Import into Rivano Cloud at https://rivano.ai/import\n"
    ;;

  version)
    printf "Rivano Lite v$VERSION\n"
    if is_running; then
      HEALTH=$(curl -sf http://localhost:9000/health 2>/dev/null)
      IMAGE_VERSION=$(echo "$HEALTH" | grep -o '"version":"[^"]*"' | sed 's/"version":"//' | sed 's/"//')
      if [ -n "$IMAGE_VERSION" ]; then
        printf "Container: v$IMAGE_VERSION\n"
      fi
    fi
    ;;

  help|--help|-h)
    cat << HELPEOF
Rivano Lite — Open Source AI Operations Platform

Usage: rivano <command>

Commands:
  start       Start Rivano Lite container
  stop        Stop the container
  restart     Restart the container
  status      Show service status and stats
  logs        Stream container logs (--tail N, --follow)
  config      Open WebUI in browser
  update      Pull latest image and restart
  export      Export config and data as tarball
  version     Show version info
  uninstall   Remove container, image, and CLI
  help        Show this help

Configuration:
  Edit ~/.rivano/rivano.yaml or use the WebUI at http://localhost:9000

Proxy:
  Point your AI SDK at http://localhost:4000/v1

Documentation:
  https://github.com/rivano-ai/rivano-lite

Upgrade to Rivano Cloud:
  https://rivano.ai
HELPEOF
    ;;

  *)
    printf "${RED}Unknown command: $1${NC}\n"
    printf "Run 'rivano help' for usage\n"
    exit 1
    ;;
esac
CLIEOF

if [ "$NEED_SUDO" = true ]; then
  sudo install -m 755 "$TEMP_CLI" "${INSTALL_DIR}/rivano"
else
  install -m 755 "$TEMP_CLI" "${INSTALL_DIR}/rivano"
fi
rm -f "$TEMP_CLI"

ok "CLI installed: $(which rivano)"

# ── Seed default config ─────────────────────────────────────
if [ ! -f "$DATA_DIR/rivano.yaml" ]; then
  # Extract default config from the container
  TEMP_CONTAINER=$(docker create "${IMAGE}:latest" 2>/dev/null)
  if [ -n "$TEMP_CONTAINER" ]; then
    docker cp "${TEMP_CONTAINER}:/rivano/defaults/rivano.yaml" "$DATA_DIR/rivano.yaml" 2>/dev/null || true
    docker rm "$TEMP_CONTAINER" >/dev/null 2>&1 || true
  fi

  # Fallback: create minimal config
  if [ ! -f "$DATA_DIR/rivano.yaml" ]; then
    cat > "$DATA_DIR/rivano.yaml" << 'YAMLEOF'
version: "1"

providers:
  # Uncomment and add your API key:
  # anthropic:
  #   api_key: ${ANTHROPIC_API_KEY}
  # openai:
  #   api_key: ${OPENAI_API_KEY}
  ollama:
    base_url: "http://host.docker.internal:11434"

proxy:
  port: 4000
  default_provider: ollama
  cache:
    enabled: true
    ttl: 3600
  rate_limit:
    requests_per_minute: 120
  policies: []

observer:
  port: 4100
  storage: sqlite
  retention_days: 30
  evaluators:
    - latency
    - cost

agents: []
YAMLEOF
  fi
  ok "Default config created: $DATA_DIR/rivano.yaml"
fi

# ── Done ────────────────────────────────────────────────────
if [ "$UPDATING" = true ]; then
  ok "Rivano Lite updated successfully!"
else
  ok "Rivano Lite installed successfully!"
fi

cat << EOF

  Get started:
    ${GREEN}rivano start${NC}           Start Rivano Lite
    ${GREEN}rivano config${NC}           Open WebUI in browser
    ${GREEN}rivano status${NC}           Check service health

  Configure providers:
    Edit ~/.rivano/rivano.yaml or use the WebUI

  Connect your app:
    Point your AI SDK at http://localhost:4000/v1

  Documentation:
    https://github.com/rivano-ai/rivano-lite

EOF

#!/usr/bin/env bash
# ==============================================================================
# LearnHarness Subpath Deployer for Remote VM
# Compiles LearnHarness locally with BASE_PATH=/learn and deploys the build
# to the remote VM without taxing VM resources.
#
# Usage:
#   ./scripts/deploy-to-vm.sh [user@vm-ip] [options]
# Options:
#   --skip-build        Skip local build step and deploy existing .next folder
#   --target <target>   Override VM SSH target (default: sohamtilekar233@35.209.219.191)
#   --archive-only      Only generate the build tarball (learnharness-build.tar.gz)
#   -h, --help          Show help message
# ==============================================================================

set -euo pipefail

# ANSI Colors
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
MAGENTA='\033[0;35m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

TARGET="sohamtilekar233@35.209.219.191"
SKIP_BUILD=false
ARCHIVE_ONLY=false
OVERWRITE_DATA=false

for arg in "$@"; do
  case "$arg" in
    -h|--help)
      echo "Usage: $0 [user@vm-ip] [--skip-build] [--archive-only] [--overwrite-data]"
      exit 0
      ;;
    --skip-build)     SKIP_BUILD=true ;;
    --archive-only)   ARCHIVE_ONLY=true ;;
    --overwrite-data) OVERWRITE_DATA=true ;;
    --target)         TARGET="$2"; shift ;;
    *)
      if [[ "$arg" =~ @ ]]; then
        TARGET="$arg"
      fi
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TAR_FILE="/tmp/learnharness-build.tar.gz"

cd "${REPO_DIR}"

echo -e "${BOLD}${CYAN}================================================================================${NC}"
echo -e "${BOLD}${CYAN}🚀 LearnHarness Subpath Deployer -> ${TARGET}${NC}"
echo -e "${BOLD}${CYAN}================================================================================${NC}\n"

# 1. Pre-flight verification
echo -e "${BOLD}${BLUE}[Step 1/4] Pre-flight pi-antigravity verification...${NC}"
node scripts/verify-antigravity.mjs

# 2. Local Next.js build
if [ "${SKIP_BUILD}" = false ]; then
  echo -e "\n${BOLD}${BLUE}[Step 2/4] Compiling Next.js with BASE_PATH=/learn locally...${NC}"
  BASE_PATH=/learn npm run build
else
  echo -e "\n${YELLOW}ℹ️  Skipping local build (--skip-build flag set).${NC}"
fi

# 3. Create lightweight tarball
echo -e "\n${BOLD}${BLUE}[Step 3/4] Packaging build bundle (excluding dev/cache)...${NC}"
BUNDLE_TARGETS=(".next")
if [ "${OVERWRITE_DATA}" = true ]; then
  echo -e "  ${YELLOW}⚠️  --overwrite-data flag active: Local data/ (chats & graph) WILL be included in bundle.${NC}"
  BUNDLE_TARGETS+=("data")
else
  echo -e "  ${GREEN}✔ [Data Preservation Active] Only .next/ bundle will be uploaded; remote data/ is preserved.${NC}"
fi

tar \
  --exclude='.next/cache' \
  --exclude='.next/dev' \
  --exclude='.next/standalone' \
  -czf "${TAR_FILE}" \
  -C "${REPO_DIR}" "${BUNDLE_TARGETS[@]}"

TAR_SIZE=$(du -h "${TAR_FILE}" | awk '{print $1}')
echo -e "  ${GREEN}✔ Build bundle ready: ${TAR_FILE} (${TAR_SIZE})${NC}"

if [ "${ARCHIVE_ONLY}" = true ]; then
  echo -e "\n${GREEN}✅ Archive created at ${TAR_FILE}. Exiting (--archive-only).${NC}"
  exit 0
fi

# 4. Fast Transfer & VM Extraction
echo -e "\n${BOLD}${BLUE}[Step 4/4] Uploading & deploying bundle to VM...${NC}"
echo -e "  ${MAGENTA}▶ [Subcommand] Fast SCP transfer (${TAR_SIZE})...${NC}"
scp "${TAR_FILE}" "${TARGET}:/tmp/learnharness-build.tar.gz"

echo -e "  ${MAGENTA}▶ [Subcommand] Extracting on VM and reloading PM2...${NC}"
ssh -t "${TARGET}" bash -c "'
  set -e
  REMOTE_LEARN=\"\${HOME}/learnharness\"
  mkdir -p \"\${REMOTE_LEARN}\"
  if [ "${OVERWRITE_DATA}" = true ]; then
    echo \"==> [Warning] Overwrite data active: extracting both .next and data/...\"
  else
    echo \"==> Preserving existing LearnHarness data and sessions...\"
    mkdir -p \"\${REMOTE_LEARN}/data/chats\" \"\${REMOTE_LEARN}/data/graph\"
  fi
  tar -xzf /tmp/learnharness-build.tar.gz -C \"\${REMOTE_LEARN}\"
  rm -f /tmp/learnharness-build.tar.gz
  if [ "${OVERWRITE_DATA}" = true ]; then
    echo \"✔ [Done] LearnHarness bundle and data synchronized to VM.\"
  else
    echo \"✔ [Safety] LearnHarness data directory (\${REMOTE_LEARN}/data) untouched and preserved.\"
  fi

  echo \"==> Reloading PM2 process (mcp-server)...\"
  pm2 reload mcp-server || true
'"

# 5. Clean up local tarball
rm -f "${TAR_FILE}"

# 6. Verification Probe
echo -e "\n${BOLD}${CYAN}================================================================================${NC}"
echo -e "${BOLD}${CYAN}🔍 Probing Live Endpoints on ${TARGET}...${NC}"
echo -e "${BOLD}${CYAN}================================================================================${NC}"

HEALTH_STATUS=$(ssh "${TARGET}" 'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/health || echo "FAILED"')
LEARN_STATUS=$(ssh "${TARGET}" 'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/learn || echo "FAILED"')

echo -e "  Automata MCP Health (/health): HTTP ${HEALTH_STATUS}"
echo -e "  LearnHarness UI (/learn):       HTTP ${LEARN_STATUS}"

if [ "${LEARN_STATUS}" == "200" ]; then
  echo -e "\n${BOLD}${GREEN}✅ LearnHarness is successfully live at https://automata.mywire.org/learn !${NC}\n"
else
  echo -e "\n${YELLOW}⚠️ Notice: /learn returned HTTP ${LEARN_STATUS}. Check 'pm2 logs mcp-server' if unexpected.${NC}\n"
fi
